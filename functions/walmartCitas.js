/**
 * walmartCitas.js — Procesa los correos "Citas ALANIS" de Walmart.
 *
 * Flujo:
 *   VBA de Outlook  ──crea──▶  walmart_correos/{messageId}   (filas crudas, estado "RECIBIDO")
 *   Esta función    ──lee──▶   interpreta filas, arma viajes/repartos y compara contra lo existente
 *                   ──escribe▶ walmart_entregas/{PO_DESTINO}   (una por entrega/parada)
 *                              walmart_viajes/{viajeId}        (un viaje = un pedimento, con sus paradas)
 *                              walmart_avisos/{autoId}         (un aviso por viaje cuando algo cambió)
 *                              walmart_correos/{id}            (resumen + estado "PROCESADO")
 *
 * Regla de oro: esta función SOLO escribe campos que vienen de Walmart. Nunca toca lo que
 * captura Alanis (tractor, llegada, salida, estatus operativo, comentarios, etc.).
 *
 * Instalación: agregar al final de functions/index.js
 *   exports.procesarCorreoWalmart = require("./walmartCitas").procesarCorreoWalmart;
 */

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");

if (!getApps().length) initializeApp();

const COL_CORREOS = "walmart_correos";
const COL_ENTREGAS = "walmart_entregas";
const COL_VIAJES = "walmart_viajes";
const COL_AVISOS = "walmart_avisos";

// Horario de cita: se asume hora del centro (UTC-6, CDMX/MTY/GDL/TPJ, sin horario de verano).
// PENDIENTE: CEDIS en otra zona (p. ej. CLN Culiacán, UTC-7) → catálogo de CEDIS con zona horaria.
const OFFSET_HORAS_CITA = 6;

// Campos de la entrega que se comparan para generar avisos (la caja se compara a nivel viaje).
const CAMPOS_COMPARABLES = [
  ["citaFecha", "Fecha de cita"],
  ["citaHora", "Hora de cita"],
  ["confirmacion", "Confirmación Scheduler"],
  ["descripcion", "Descripción"],
  ["cajas", "Cantidad (cajas)"],
  ["ruta", "Ruta"],
  ["linea", "Línea"],
  ["oc", "OC"],
  ["ocNota", "Nota OC"],
  ["pedimento", "Pedimento"],
];

// ───────────────────────────── Interpretación de filas (funciones puras) ─────────────────────────────

const limpiar = (v) => String(v ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const sinEspacios = (v) => limpiar(v).replace(/\s+/g, "");
const vacio = (v) => ["", "-", "N/A", "NA", "#N/A"].includes(limpiar(v).toUpperCase());

/** Clave segura para ID de documento: "ARCOSA JUQ" → "ARCOSA_JUQ". */
const claveId = (v) => limpiar(v).toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** "04/10/2026" (dd/mm/aaaa), "4/10/26" o "2026-10-04" → "2026-10-04". */
function parseFecha(v) {
  const s = limpiar(v);
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    let [, d, mes, a] = m;
    if (a.length === 2) a = "20" + a;
    if (+mes < 1 || +mes > 12 || +d < 1 || +d > 31) return null;
    return `${a}-${mes.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** "14:00", "9:30", "14:00:00" → "14:00". Si viene una fecha u otra cosa → null. */
function parseHora(v) {
  const m = limpiar(v).match(/^(\d{1,2}):(\d{2})(?::\d{2})?(\s*[ap]\.?\s*m\.?)?$/i);
  if (!m) return null;
  let h = +m[1];
  const ampm = (m[3] || "").toLowerCase().replace(/[\s.]/g, "");
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  if (h > 23 || +m[2] > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/** "6335580128-6335580134-..." → ["6335580128","6335580134",...]; "N/A" → []. */
const parseOC = (v) => (vacio(v) ? [] : (limpiar(v).match(/\d{6,}/g) || []));

const parseEntero = (v) => {
  const n = parseInt(sinEspacios(v).replace(/[,]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};

/**
 * Convierte las filas crudas del correo en entregas normalizadas.
 * @param {Array<Object>} filas  — mapas {PO, OC, LINEA, NOCAJA, DESTINO, FECHACITASCHEDULER, ...} (strings)
 * @param {Object} meta          — { correoId, fechaCorreo: "AAAAMMDD" }
 * @returns {{entregas: Array, advertencias: Array<string>}}
 */
function construirEntregas(filas, meta) {
  const entregas = [];
  const advertencias = [];
  const vistos = new Set();

  filas.forEach((f, i) => {
    const n = i + 1;
    const po = sinEspacios(f.PO);
    const destino = limpiar(f.DESTINO).toUpperCase();
    if (vacio(po) || vacio(destino)) {
      advertencias.push(`Fila ${n}: sin PO o sin destino, no se registró.`);
      return;
    }
    if (f._INCOMPLETA === "1") advertencias.push(`Fila ${n} (PO ${po}): trae menos columnas que el encabezado, revisar.`);

    const esNoProg = (v) => /NO\s*PROGRAMABLE/i.test(limpiar(v));
    const citaNoProgramable = esNoProg(f.FECHACITASCHEDULER) || esNoProg(f.HORACITASCHEDULER);
    const citaFecha = citaNoProgramable ? null : parseFecha(f.FECHACITASCHEDULER);
    if (!citaFecha && !citaNoProgramable) advertencias.push(`Fila ${n} (PO ${po}): fecha de cita no válida "${limpiar(f.FECHACITASCHEDULER)}".`);
    const horaTxt = limpiar(f.HORACITASCHEDULER);
    const citaHora = citaNoProgramable ? null : parseHora(horaTxt);
    if (!citaHora && horaTxt && !citaNoProgramable) advertencias.push(`Fila ${n} (PO ${po}): hora de cita no válida "${horaTxt}".`);
    const horaPorConfirmar = !citaNoProgramable && (!citaHora || citaHora === "00:00");

    const confTxt = limpiar(f.CONFIRMACIONSCHEDULER);
    const confirmacion = vacio(confTxt) || esNoProg(confTxt) ? null : confTxt;
    if (confirmacion && parseFecha(confirmacion)) advertencias.push(`Fila ${n} (PO ${po}): la confirmación parece una fecha "${confirmacion}".`);

    const pedimento = vacio(f.PEDIMENTO) ? null : sinEspacios(f.PEDIMENTO);
    const caja = vacio(f.NOCAJA) ? null : sinEspacios(f.NOCAJA);
    const viajeId = pedimento ? claveId(pedimento.replace(/\D/g, "")) || claveId(pedimento)
      : `SINPED_${claveId(caja || "SINCAJA")}_${meta.fechaCorreo}`;
    if (!pedimento) advertencias.push(`Fila ${n} (PO ${po}): sin pedimento; viaje agrupado por caja.`);

    const entregaId = `${claveId(po)}_${claveId(destino)}`;
    if (vistos.has(entregaId)) {
      advertencias.push(`Fila ${n}: PO ${po} con destino ${destino} viene repetido en el mismo correo; se tomó la primera.`);
      return;
    }
    vistos.add(entregaId);

    let citaTs = null;
    if (citaFecha) {
      const [a, m, d] = citaFecha.split("-").map(Number);
      const [h, mi] = (citaHora || "00:00").split(":").map(Number);
      citaTs = new Date(Date.UTC(a, m - 1, d, h + OFFSET_HORAS_CITA, mi));
    }

    entregas.push({
      entregaId, viajeId, po, destino, caja, pedimento, confirmacion,
      oc: parseOC(f.OC),
      ocNota: !vacio(f.OC) && parseOC(f.OC).length === 0 ? limpiar(f.OC).toUpperCase() : null,
      citaNoProgramable,
      linea: limpiar(f.LINEA).toUpperCase() || null,
      citaFecha, citaHora, horaPorConfirmar, citaTs,
      descripcion: limpiar(f.DESCRIPCION).toUpperCase() || null,
      cajas: parseEntero(f.CAJAS),
      ruta: limpiar(f.RUTA).toUpperCase() || null,
    });
  });
  return { entregas, advertencias };
}

const claveOrden = (p) => `${p.citaFecha || "9999-99-99"} ${p.citaHora || "99:99"} ${p.destino}`;
const mostrar = (v) => (v === null || v === undefined || v === "" ? "(vacío)"
  : Array.isArray(v) ? (v.length ? v.join(", ") : "(vacío)") : String(v));
const igual = (a, b) => mostrar(a) === mostrar(b);
/** Valor visible de un campo; las citas "no programables" se muestran así en vez de "(vacío)". */
const valorDe = (doc, campo) => (doc?.citaNoProgramable && ["citaFecha", "citaHora", "confirmacion"].includes(campo)
  ? "NO PROGRAMABLE" : doc?.[campo] ?? null);
const paradaDe = (e) => ({ entregaId: e.entregaId, po: e.po, destino: e.destino,
  citaFecha: e.citaFecha || null, citaHora: e.citaHora || null });

/**
 * Compara un viaje entrante contra lo que ya existe y devuelve los cambios detectados.
 * @param {Object} p
 * @param {Array}  p.entrantes        entregas del correo para este viaje
 * @param {Object|null} p.viajePrevio doc de walmart_viajes (o null si es nuevo)
 * @param {Object} p.previas          mapa entregaId → doc existente de walmart_entregas
 * @returns {{cambios, paradas, reemplazadas: Array<{anterior, nueva}>, nuevo: boolean}}
 */
function compararViaje({ entrantes, viajePrevio, previas }) {
  const cambios = [];
  const reemplazadas = [];
  const add = (c) => cambios.push(c);
  const diffCampos = (prev, e) => {
    for (const [campo, etiqueta] of CAMPOS_COMPARABLES) {
      if (campo === "pedimento") continue; // se reporta aparte (CAMBIO_PEDIMENTO)
      const antes = valorDe(prev, campo), ahora = valorDe(e, campo);
      if (!igual(antes, ahora)) {
        add({ tipo: campo.startsWith("cita") ? "CAMBIO_CITA" : "CAMBIO_DATO", entregaId: e.entregaId,
          po: e.po, destino: e.destino, campo, anterior: antes, nuevo: ahora,
          texto: `PO ${e.po} (${e.destino}) — ${etiqueta}: ${mostrar(antes)} → ${mostrar(ahora)}` });
      }
    }
  };

  const todasPrevias = (viajePrevio?.paradas || []).filter((p) => !p.reemplazadaPor);
  // Paradas ya reportadas antes como "no incluidas": se conservan en silencio (no se vuelve a avisar)
  const yaAusentes = todasPrevias.filter((p) => p.noIncluidaEnUltimoCorreo);
  const prevParadas = todasPrevias.filter((p) => !p.noIncluidaEnUltimoCorreo);
  const consumidas = new Set();

  // 1) Remolque / caja a nivel viaje
  const cajaNueva = entrantes.find((e) => e.caja)?.caja || null;
  if (viajePrevio && !igual(viajePrevio.caja, cajaNueva)) {
    add({ tipo: "CAMBIO_REMOLQUE", campo: "caja", anterior: viajePrevio.caja ?? null, nuevo: cajaNueva,
      texto: `Cambio de remolque: ${mostrar(viajePrevio.caja)} → ${mostrar(cajaNueva)}` });
  }

  // 2) Entrega por entrega
  for (const e of entrantes) {
    const prev = previas[e.entregaId];
    if (prev) {
      consumidas.add(e.entregaId);
      if (yaAusentes.some((p) => p.entregaId === e.entregaId)) {
        add({ tipo: "PARADA_REINCORPORADA", entregaId: e.entregaId, po: e.po, destino: e.destino,
          texto: `La parada PO ${e.po} → ${e.destino} vuelve a aparecer en el correo` });
      }
      if (prev.viajeId && prev.viajeId !== e.viajeId) {
        add({ tipo: "CAMBIO_PEDIMENTO", entregaId: e.entregaId, po: e.po, destino: e.destino, campo: "pedimento",
          anterior: prev.pedimento ?? null, nuevo: e.pedimento,
          texto: `PO ${e.po} (${e.destino}) pasó a otro pedimento: ${mostrar(prev.pedimento)} → ${mostrar(e.pedimento)}` });
      }
      diffCampos(prev, e);
      continue;
    }
    if (!viajePrevio) continue; // viaje nuevo: no hay contra qué comparar

    // Entrega nueva dentro de un viaje que ya existía: ¿cambió PO, destino, o es parada nueva?
    const libres = prevParadas.filter((p) => !consumidas.has(p.entregaId) && !entrantes.some((x) => x.entregaId === p.entregaId));
    const mismoPO = libres.find((p) => p.po === e.po);
    const mismoDestino = !mismoPO && libres.find((p) => p.destino === e.destino);
    if (mismoPO) {
      consumidas.add(mismoPO.entregaId);
      reemplazadas.push({ anterior: mismoPO.entregaId, nueva: e.entregaId });
      add({ tipo: "CAMBIO_DESTINO", entregaId: e.entregaId, entregaAnterior: mismoPO.entregaId, po: e.po, destino: e.destino,
        campo: "destino", anterior: mismoPO.destino, nuevo: e.destino,
        texto: `PO ${e.po} cambió de destino: ${mismoPO.destino} → ${e.destino}` });
      if (previas[mismoPO.entregaId]) diffCampos(previas[mismoPO.entregaId], e);
    } else if (mismoDestino) {
      consumidas.add(mismoDestino.entregaId);
      reemplazadas.push({ anterior: mismoDestino.entregaId, nueva: e.entregaId });
      add({ tipo: "CAMBIO_PO", entregaId: e.entregaId, entregaAnterior: mismoDestino.entregaId, po: e.po, destino: e.destino,
        campo: "po", anterior: mismoDestino.po, nuevo: e.po,
        texto: `Destino ${e.destino} cambió de PO: ${mismoDestino.po} → ${e.po}` });
      if (previas[mismoDestino.entregaId]) diffCampos(previas[mismoDestino.entregaId], e);
    } else {
      add({ tipo: "NUEVA_PARADA", entregaId: e.entregaId, po: e.po, destino: e.destino,
        texto: `Nueva parada: PO ${e.po} → ${e.destino} (${mostrar(e.citaFecha)} ${mostrar(e.citaHora)})` });
    }
  }

  // 3) Paradas que existían y ya no vienen en el correo
  const noIncluidas = prevParadas.filter((p) => !consumidas.has(p.entregaId) && !entrantes.some((x) => x.entregaId === p.entregaId));
  for (const p of noIncluidas) {
    add({ tipo: "PARADA_NO_INCLUIDA", entregaId: p.entregaId, po: p.po, destino: p.destino,
      texto: `La parada PO ${p.po} → ${p.destino} ya no viene en este correo (posible cancelación o correo parcial)` });
  }

  // 4) Nueva lista de paradas: entrantes + previas no incluidas (se conservan marcadas, no se borran)
  const siguenAusentes = yaAusentes.filter((p) => !entrantes.some((x) => x.entregaId === p.entregaId));
  const paradas = [
    ...entrantes.map(paradaDe),
    ...[...noIncluidas, ...siguenAusentes].map((p) => ({ ...p, noIncluidaEnUltimoCorreo: true })),
  ].sort((a, b) => claveOrden(a).localeCompare(claveOrden(b)))
    .map((p, i) => ({ ...p, orden: i + 1 }));

  // 5) Cantidad y orden de repartos (solo paradas activas)
  if (viajePrevio) {
    const ordenar = (arr) => [...arr].sort((a, b) => claveOrden(a).localeCompare(claveOrden(b)));
    const antesP = ordenar(prevParadas);
    const ahoraP = paradas.filter((p) => !p.noIncluidaEnUltimoCorreo);
    if (antesP.length !== ahoraP.length) {
      add({ tipo: "CAMBIO_CANTIDAD_REPARTOS", campo: "totalRepartos", anterior: antesP.length, nuevo: ahoraP.length,
        texto: `Cantidad de repartos: ${antesP.length} → ${ahoraP.length}` });
    }
    // Orden relativo de las paradas que existen antes y ahora (los reemplazos de PO/destino cuentan como la misma)
    const mapa = Object.fromEntries(reemplazadas.map((x) => [x.anterior, x.nueva]));
    const ahoraIds = new Set(ahoraP.map((p) => p.entregaId));
    const antesComunes = antesP.map((p) => mapa[p.entregaId] || p.entregaId).filter((id) => ahoraIds.has(id));
    const comunes = new Set(antesComunes);
    const ahoraComunes = ahoraP.map((p) => p.entregaId).filter((id) => comunes.has(id));
    if (antesComunes.join(">") !== ahoraComunes.join(">")) {
      const destinoDe = Object.fromEntries(ahoraP.map((p) => [p.entregaId, p.destino]));
      const txtAntes = antesComunes.map((id) => destinoDe[id]).join(" → ");
      const txtAhora = ahoraComunes.map((id) => destinoDe[id]).join(" → ");
      add({ tipo: "CAMBIO_ORDEN_REPARTOS", campo: "orden", anterior: txtAntes, nuevo: txtAhora,
        texto: `Orden de repartos: ${txtAntes}  ⇒  ${txtAhora}` });
    }
  }
  return { cambios, paradas, reemplazadas, nuevo: !viajePrevio };
}

// ───────────────────────────── Cloud Function ─────────────────────────────

exports.procesarCorreoWalmart = onDocumentCreated(
  { document: `${COL_CORREOS}/{correoId}`, region: "us-central1", maxInstances: 1, retry: false },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const db = getFirestore();
    const correoId = event.params.correoId;
    const correo = snap.data();
    if (correo.estado !== "RECIBIDO") return;

    try {
      const recibido = correo.recibido?.toDate ? correo.recibido.toDate() : new Date();
      const fechaCorreo = recibido.toISOString().slice(0, 10).replace(/-/g, "");
      const { entregas, advertencias } = construirEntregas(correo.filas || [], { correoId, fechaCorreo });

      // Agrupar por viaje
      const porViaje = new Map();
      for (const e of entregas) {
        if (!porViaje.has(e.viajeId)) porViaje.set(e.viajeId, []);
        porViaje.get(e.viajeId).push(e);
      }

      // Lecturas: entregas entrantes + viajes entrantes
      const refsEntregas = entregas.map((e) => db.collection(COL_ENTREGAS).doc(e.entregaId));
      const refsViajes = [...porViaje.keys()].map((id) => db.collection(COL_VIAJES).doc(id));
      const [snapsE, snapsV] = await Promise.all([
        refsEntregas.length ? db.getAll(...refsEntregas) : [],
        refsViajes.length ? db.getAll(...refsViajes) : [],
      ]);
      const previas = Object.fromEntries(snapsE.filter((s) => s.exists).map((s) => [s.id, s.data()]));
      const viajesPrevios = Object.fromEntries(snapsV.filter((s) => s.exists).map((s) => [s.id, s.data()]));

      // También las entregas de las paradas previas de esos viajes (para comparar si cambió PO o destino)
      const faltantes = [...new Set(Object.values(viajesPrevios).flatMap((v) => (v.paradas || []).map((p) => p.entregaId)))]
        .filter((id) => id && !previas[id]);
      if (faltantes.length) {
        const extra = await db.getAll(...faltantes.map((id) => db.collection(COL_ENTREGAS).doc(id)));
        extra.filter((s) => s.exists).forEach((s) => { previas[s.id] = s.data(); });
      }

      // Viajes "de origen" de entregas que se movieron de pedimento (para quitarles la parada)
      const viajesOrigen = [...new Set(Object.values(previas)
        .filter((p) => p.viajeId && !porViaje.has(p.viajeId)).map((p) => p.viajeId))];
      const snapsOrigen = viajesOrigen.length ? await db.getAll(...viajesOrigen.map((id) => db.collection(COL_VIAJES).doc(id))) : [];

      const esRespuesta = correo.esRespuesta === true;
      const msRecibido = recibido.getTime();
      const msDe = (t) => (t?.toMillis ? t.toMillis() : 0);
      let omitidosAntiguos = 0;

      const batch = db.batch();
      const ahora = FieldValue.serverTimestamp();
      const origen = { correoId, asunto: correo.asunto || null, recibido: correo.recibido || null, esRespuesta };
      let nuevas = 0, actualizadas = 0, sinCambios = 0, avisos = 0;

      for (const [viajeId, todasEntrantes] of porViaje) {
        const viajePrevio = viajesPrevios[viajeId] || null;
        // Protección de orden: nunca dejar que un correo más viejo pise datos de uno más nuevo
        if (viajePrevio && msDe(viajePrevio.ultimoCorreoRecibido) > msRecibido) {
          omitidosAntiguos++;
          advertencias.push(`Viaje ${viajeId}: este correo es más antiguo que el último procesado; se omitió.`);
          continue;
        }
        const entrantes = todasEntrantes.filter((e) => !(msDe(previas[e.entregaId]?.ultimoCorreoRecibido) > msRecibido));
        if (entrantes.length < todasEntrantes.length) {
          advertencias.push(`Viaje ${viajeId}: ${todasEntrantes.length - entrantes.length} entrega(s) ya tenían datos de un correo más reciente; se omitieron.`);
        }
        if (!entrantes.length) continue;
        const r = compararViaje({ entrantes, viajePrevio, previas });
        if (esRespuesta && !viajePrevio) {
          r.cambios.push({ tipo: "VIAJE_EN_RESPUESTA", texto: `Viaje ${viajeId} aparece en una respuesta y no estaba registrado (no se dio de alta)` });
        }
        const activas = r.paradas.filter((p) => !p.noIncluidaEnUltimoCorreo);
        const ordenDe = Object.fromEntries(r.paradas.map((p) => [p.entregaId, p.orden]));
        const muestra = entrantes[0];

        // Respuestas (RE:/RV:/FW:): modo solo aviso, no se escribe nada en entregas ni viajes
        if (esRespuesta) {
          if (r.cambios.length) {
            avisos++;
            batch.set(db.collection(COL_AVISOS).doc(), {
              viajeId, pedimento: muestra.pedimento, caja: entrantes.find((e) => e.caja)?.caja || null,
              ruta: muestra.ruta, origen, soloAviso: true,
              tipos: [...new Set(r.cambios.map((c) => c.tipo))], cambios: r.cambios,
              resumen: "Detectado en una RESPUESTA (no se aplicó):\n" + r.cambios.map((c) => c.texto).join("\n"),
              estatus: "PENDIENTE", revisadoPor: null, revisadoEn: null, creadoEn: ahora,
            });
          }
          continue;
        }

        // Entregas (solo campos de Walmart)
        for (const e of entrantes) {
          const ref = db.collection(COL_ENTREGAS).doc(e.entregaId);
          const datosWalmart = {
            po: e.po, destino: e.destino, caja: e.caja, pedimento: e.pedimento, oc: e.oc, linea: e.linea,
            citaFecha: e.citaFecha, citaHora: e.citaHora, horaPorConfirmar: e.horaPorConfirmar,
            citaNoProgramable: e.citaNoProgramable, ocNota: e.ocNota,
            citaTs: e.citaTs ? Timestamp.fromDate(e.citaTs) : null,
            confirmacion: e.confirmacion, descripcion: e.descripcion, cajas: e.cajas, ruta: e.ruta,
            viajeId, orden: ordenDe[e.entregaId] || null, totalRepartos: activas.length,
            ultimoCorreoId: correoId, ultimoCorreoRecibido: Timestamp.fromDate(recibido), actualizadoWalmartEn: ahora,
          };
          if (previas[e.entregaId]) {
            const huboCambio = r.cambios.some((c) => c.entregaId === e.entregaId);
            huboCambio ? actualizadas++ : sinCambios++;
            batch.set(ref, datosWalmart, { merge: true });
          } else {
            nuevas++;
            batch.set(ref, { ...datosWalmart, estatus: "PROGRAMADA", primerCorreoId: correoId, creadoEn: ahora });
          }
        }
        // Entregas reemplazadas (cambio de PO o destino): se conservan, marcadas
        for (const rep of r.reemplazadas) {
          batch.set(db.collection(COL_ENTREGAS).doc(rep.anterior),
            { reemplazadaPor: rep.nueva, estatusWalmart: "REEMPLAZADA", actualizadoWalmartEn: ahora }, { merge: true });
        }

        // Viaje
        batch.set(db.collection(COL_VIAJES).doc(viajeId), {
          pedimento: muestra.pedimento, caja: entrantes.find((e) => e.caja)?.caja || null,
          ruta: muestra.ruta, linea: muestra.linea,
          paradas: r.paradas, totalRepartos: activas.length,
          ultimoCorreoId: correoId, ultimoCorreoRecibido: Timestamp.fromDate(recibido), actualizadoEn: ahora,
          ...(viajePrevio ? {} : { creadoEn: ahora, primerCorreoId: correoId }),
        }, { merge: true });

        // Aviso consolidado por viaje
        if (r.cambios.length) {
          avisos++;
          batch.set(db.collection(COL_AVISOS).doc(), {
            viajeId, pedimento: muestra.pedimento, caja: entrantes.find((e) => e.caja)?.caja || null,
            ruta: muestra.ruta, origen,
            tipos: [...new Set(r.cambios.map((c) => c.tipo))],
            cambios: r.cambios,
            resumen: r.cambios.map((c) => c.texto).join("\n"),
            estatus: "PENDIENTE", revisadoPor: null, revisadoEn: null, creadoEn: ahora,
          });
        }
      }

      // Quitar paradas movidas de su viaje anterior
      for (const s of (esRespuesta ? [] : snapsOrigen)) {
        if (!s.exists) continue;
        const movidas = new Set(entregas.filter((e) => previas[e.entregaId]?.viajeId === s.id).map((e) => e.entregaId));
        const paradas = (s.data().paradas || []).filter((p) => !movidas.has(p.entregaId)).map((p, i) => ({ ...p, orden: i + 1 }));
        batch.set(s.ref, { paradas, totalRepartos: paradas.filter((p) => !p.noIncluidaEnUltimoCorreo).length, actualizadoEn: ahora }, { merge: true });
      }

      batch.update(snap.ref, {
        estado: "PROCESADO", procesadoEn: ahora,
        resumen: { filas: (correo.filas || []).length, entregas: entregas.length, viajes: porViaje.size,
          nuevas, actualizadas, sinCambios, avisos, omitidosAntiguos, modo: esRespuesta ? "SOLO_AVISO" : "NORMAL" },
        advertencias,
      });
      await batch.commit();
    } catch (err) {
      console.error("procesarCorreoWalmart", correoId, err);
      await snap.ref.update({ estado: "ERROR", error: String(err?.message || err), procesadoEn: FieldValue.serverTimestamp() });
    }
  }
);

// Exportadas para pruebas
exports._internas = { construirEntregas, compararViaje, parseFecha, parseHora, parseOC, claveId };