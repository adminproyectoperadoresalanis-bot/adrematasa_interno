// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/public/js/asignacion.js
// ##########################################################################
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";
import { suscribirEspejo, alSalirDePantalla } from "./espejosOperadores.js";

// ============================================================================
// Tráfico → Asignación (2026-10-27, pedido de Ivan). Reemplaza la asignación
// del panel admin de Alanis Operadores (admin2.js).
//
// 1. Se pega el renglón de despacho del Adrematasa oficial. Se lee IGUAL que
//    admin2.js (procesarAsignacion): última línea con tabuladores que no sea
//    el encabezado ("Instruccion"); columnas base 0: destino 5, línea 9,
//    remolque 10, cliente 14, fecha cita 15 + hora 16, unidad 19, operador 20.
// 2. Vista previa con el estatus en vivo (espejos) y lo que revisa el servidor
//    (verificarAsignacionOperador): operador activo, OT abierta, avisos
//    activos y otras asignaciones pendientes.
//      - Rojo BLOQUEA: sin operador activo, en taller (OT abierta).
//      - Ámbar solo avisa: nombre distinto, Disponible vencido o sin
//        reportarse, sin avisos activos, otra asignación pendiente.
// 3. crearAsignacionOperador la crea en Alanis Operadores; allá avisoAsignacion
//    le manda el aviso push. Ya NO abre WhatsApp. Solo en celular, si el
//    operador no tiene avisos activos, se ofrece el botón de WhatsApp.
// 4. Lista en vivo (espejo_op_asignaciones). Cancelar una pendiente: solo admin
//    o Coordinador (cancelarAsignacionOperador).
// ============================================================================

const funciones = getFunctions(undefined, "us-central1");
const fnVerificar = httpsCallable(funciones, "verificarAsignacionOperador");
const fnCrear = httpsCallable(funciones, "crearAsignacionOperador");
const fnCancelar = httpsCallable(funciones, "cancelarAsignacionOperador");

const HORAS_VIGENCIA_CORTA = 4; // igual que Turnos
const REDIBUJO_MS = 30 * 1000;  // solo redibuja ("hace N min"); no lee nada
const ETQ_ESTATUS = {
  disponible: "Disponible", taller: "En taller", enfermo: "Enfermo", permiso: "Permiso",
  vacaciones: "Vacaciones", incapacitado: "Incapacitado", liberado_taller: "Liberado de taller",
};
const ETQ_RUTA = { larga: "Larga", corta: "Corta", local: "Local", circuito: "Circuito" };

// Turnos → "Asignar →" deja aquí la unidad antes de cambiar de pestaña.
let unidadPreparada = "";
export function prepararAsignacion(unidad) { unidadPreparada = String(unidad || "").trim(); }

function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}
function norm(t) {
  return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
function normUnidad(u) { return String(u || "").trim().toUpperCase(); }
function hora(ms) {
  return ms ? new Date(ms).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false }) : "";
}
function fechaHora(ms) {
  return ms ? new Date(ms).toLocaleString("es-MX", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "";
}
function minutos(desdeMs) { return Math.max(0, Math.round((Date.now() - desdeMs) / 60000)); }
function textoMin(m) { return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; }
function esCelular() {
  return /iphone|ipad|ipod|android|mobi/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function puedeCancelar(u) {
  const t = (v) => norm(v).toLowerCase();
  return !!u && (u.rol === "admin" || t(u.puesto).includes("coordinador") || t(u.area).includes("coordinador"));
}
// Los nombres coinciden si comparten al menos 2 palabras (o uno contiene al otro).
function nombresCoinciden(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return true;
  if (x.includes(y) || y.includes(x)) return true;
  const px = new Set(x.split(" ").filter(p => p.length > 2));
  return y.split(" ").filter(p => p.length > 2 && px.has(p)).length >= 2;
}

// Igual que admin2.js → procesarAsignacion().
export function leerRenglonDespacho(raw) {
  const lineas = String(raw || "").split("\n").filter(l => l.indexOf("\t") !== -1);
  let lineaDatos = null;
  for (let i = lineas.length - 1; i >= 0; i--) {
    if (lineas[i].indexOf("Instruccion") === -1) { lineaDatos = lineas[i]; break; }
  }
  if (!lineaDatos) return null;
  const cols = lineaDatos.split("\t");
  const c = (i) => (cols[i] || "").trim();
  return {
    destino: c(5), linea: c(9), remolque: c(10), cliente: c(14),
    cita: (c(15) + " " + c(16)).trim(), unidad: c(19), operador_erp: c(20),
  };
}

function mensajeWhatsApp(a) {
  return "*AUTOTRANSPORTES ALANIS*\nNueva asignacion de viaje:\n\n" +
    "Cliente: " + (a.cliente || "-") + "\nDestino: " + (a.destino || "-") +
    "\nRemolque: " + (a.remolque || "-") + "\nLinea: " + (a.linea || "-") +
    "\nCita: " + (a.cita || "-") + "\n\nIngresa a la app para aceptar tu viaje.";
}
function urlWhatsApp(lada, telefono, a) {
  return "https://wa.me/" + (lada || "52") + telefono + "?text=" + encodeURIComponent(mensajeWhatsApp(a));
}

function inyectarEstilos() {
  if (document.getElementById("estilos-asignacion")) return;
  const s = document.createElement("style");
  s.id = "estilos-asignacion";
  s.textContent = `
    .as-pegar { width: 100%; box-sizing: border-box; min-height: 70px; font-family: monospace; font-size: 11.5px; white-space: pre; }
    .as-prev { border: 1px solid #e2ddd5; border-radius: 12px; padding: 14px; margin-top: 12px; background: #fff; }
    .as-tit { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; flex-wrap: wrap; }
    .as-uni { font-size: 20px; font-weight: 800; }
    .as-op { font-size: 13px; color: #6b5f52; }
    .as-datos { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 14px; font-size: 13px; margin-top: 10px; }
    .as-datos span { display: block; color: #8a7f73; font-size: 11px; }
    .as-checks { margin-top: 12px; font-size: 12.5px; line-height: 1.85; }
    .as-ok::before { content: "✓ "; color: #3B7A1E; font-weight: 800; }
    .as-warn::before { content: "! "; color: #B45309; font-weight: 800; }
    .as-no::before { content: "✕ "; color: #C0392B; font-weight: 800; }
    .as-chip { display: inline-block; font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 11px; white-space: nowrap; }
    .as-verde { background: #EAF3DE; color: #3B7A1E; } .as-rojo { background: #FBE4E1; color: #A32D2D; }
    .as-ambar { background: #FBE3A8; color: #7a3e06; } .as-azul { background: #CFE2F7; color: #185FA5; }
    .as-gris { background: #ECE9E4; color: #5c5045; }
    .as-btn-full { display: block; width: 100%; margin-top: 12px; }
    .as-ok-panel { border: 1px solid #3B7A1E; background: #EAF3DE; border-radius: 12px; padding: 12px 14px; margin-top: 12px; font-size: 13.5px; }
    .as-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
    .as-filtros { display: flex; gap: 6px; flex-wrap: wrap; }
    .as-f { background: #fff; border: 1px solid #e2ddd5; border-radius: 14px; padding: 5px 11px; font: inherit; font-size: 12px; color: #6b5f52; cursor: pointer; }
    .as-f.activo { background: #2c1e0f; border-color: #2c1e0f; color: #fff; }
    .as-it { border-top: 1px solid #e2ddd5; padding: 11px 0; display: grid; grid-template-columns: 56px 1fr auto; gap: 10px; align-items: center; font-size: 13px; }
    .as-it:first-child { border-top: 0; }
    .as-it .u { font-weight: 800; font-size: 16px; }
    .as-it small { display: block; color: #8a7f73; font-size: 11.5px; margin-top: 2px; }
    .as-der { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
    .as-cancelar { font-size: 12px; padding: 4px 9px; }
    .as-cancel-box { grid-column: 1 / -1; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .as-cancel-box input { flex: 1; min-width: 180px; }
  `;
  document.head.appendChild(s);
}

export function iniciarAsignacion(contenedor, datosUsuario) {
  inyectarEstilos();
  contenedor.innerHTML = `
    <section class="panel">
      <h2 style="margin:0 0 6px;">Nueva asignación</h2>
      <p class="nota" style="margin:0 0 8px;">Copia del Adrematasa oficial el renglón de despacho (puede ir con la fila de títulos) y pégalo aquí.</p>
      <div id="as-preparada" class="nota" style="margin:0 0 6px;"></div>
      <textarea class="as-pegar" id="as-pegar" placeholder="Pega aquí el renglón de despacho…"></textarea>
      <div id="as-error" class="error" style="margin-top:6px;"></div>
      <div id="as-prev"></div>
    </section>
    <section class="panel" style="margin-top:14px;">
      <div class="as-top">
        <h2 style="margin:0;">Asignaciones</h2>
        <div class="as-filtros" id="as-periodo"></div>
      </div>
      <div class="as-filtros" id="as-estados" style="margin:10px 0 4px;"></div>
      <div id="as-lista-error" class="error"></div>
      <div id="as-lista"><p class="nota">Cargando…</p></div>
    </section>
  `;
  const $ = (s) => contenedor.querySelector(s);
  const cancelar = puedeCancelar(datosUsuario);

  // ---- Espejos en vivo ----
  const espejo = { operadores: null, estatus: null, asignaciones: null, otAbiertas: null };
  const cancelaciones = ["operadores", "estatus", "asignaciones", "otAbiertas"].map(nombre =>
    suscribirEspejo(nombre, (docs) => {
      espejo[nombre] = docs;
      if (nombre === "asignaciones") { $("#as-lista-error").textContent = ""; renderLista(); }
      else if (actual) renderPrev();
    }, (err) => {
      if (nombre === "asignaciones") $("#as-lista-error").textContent = "No se pudieron leer las asignaciones: " + err.message;
    }));
  const reloj = setInterval(() => { renderLista(); }, REDIBUJO_MS);
  alSalirDePantalla(contenedor, () => { clearInterval(reloj); cancelaciones.forEach(c => c()); });

  // ---- Nueva asignación ----
  let actual = null;       // datos del renglón
  let verif = null;        // respuesta del servidor (o { cargando:true } / { error })
  let creada = null;       // resultado de crear
  let guardando = false;

  if (unidadPreparada) {
    $("#as-preparada").innerHTML = `Unidad elegida desde Turnos: <b>${esc(unidadPreparada)}</b>. Pega el renglón de su viaje.`;
  }

  function operadorEnEspejo(unidad) {
    const u = normUnidad(unidad);
    return (espejo.operadores || []).find(o => o.activo === true && normUnidad(o.numero) === u) || null;
  }
  function estatusDe(op) {
    if (!op) return null;
    const e = (espejo.estatus || []).find(x => x._id === op._id);
    if (!e) return { clave: "sin", txt: "SIN REPORTARSE", clase: "as-gris" };
    if ((espejo.otAbiertas || []).some(o => o.uid === op._id)) return { clave: "taller", txt: "EN TALLER", clase: "as-rojo" };
    if (e.id === "disponible") {
      if (op.tipoRuta === "corta" || op.tipoRuta === "circuito") {
        const vence = e.ms + HORAS_VIGENCIA_CORTA * 3600 * 1000;
        if (Date.now() > vence) return { clave: "vencido", txt: `DISPONIBLE VENCIDO · ${hora(vence)}`, clase: "as-ambar" };
      }
      return { clave: "disponible", txt: `DISPONIBLE · desde ${hora(e.ms)}`, clase: "as-verde" };
    }
    const rojo = ["taller", "enfermo", "incapacitado", "permiso", "vacaciones"].includes(e.id);
    return { clave: e.id, txt: `${(ETQ_ESTATUS[e.id] || e.id).toUpperCase()} · ${fechaHora(e.ms)}`, clase: rojo ? "as-rojo" : "as-gris" };
  }

  async function leer() {
    const raw = $("#as-pegar").value;
    creada = null;
    $("#as-error").textContent = "";
    if (!raw.trim()) { actual = null; verif = null; renderPrev(); return; }
    const d = leerRenglonDespacho(raw);
    if (!d) { actual = null; verif = null; $("#as-error").textContent = "No encontré un renglón de datos (debe venir con tabuladores, copiado del Adrematasa)."; renderPrev(); return; }
    if (!d.unidad) { actual = null; verif = null; $("#as-error").textContent = "El renglón no trae unidad (columna 20)."; renderPrev(); return; }
    actual = d;
    verif = { cargando: true };
    renderPrev();
    const pedida = d;
    try {
      const r = await fnVerificar({ unidad: d.unidad });
      if (actual !== pedida) return; // ya pegaron otro
      verif = r.data || {};
    } catch (e) {
      if (actual !== pedida) return;
      verif = { error: e.message || String(e) };
    }
    renderPrev();
  }
  $("#as-pegar").addEventListener("input", () => { clearTimeout(leer._t); leer._t = setTimeout(leer, 250); });

  function renderPrev() {
    const caja = $("#as-prev");
    if (creada) {
      const wa = esCelular() && !creada.avisos && creada.telefono
        ? `<a class="boton" style="display:inline-block;margin-top:8px;" target="_blank" rel="noopener" href="${esc(urlWhatsApp(creada.lada, creada.telefono, creada.datos))}">Avisar por WhatsApp</a>` : "";
      caja.innerHTML = `<div class="as-ok-panel"><b>Asignación creada para ${esc(creada.operadorNombre)} (unidad ${esc(creada.datos.unidad)}).</b><br>
        ${creada.avisos ? "Le llegó el aviso a su teléfono." : "No tiene avisos activos: avísale por teléfono o WhatsApp."}${wa}</div>`;
      return;
    }
    if (!actual) { caja.innerHTML = ""; return; }
    const op = operadorEnEspejo(actual.unidad);
    const est = estatusDe(op);
    const nombreApp = op ? (op.nombreOficial || op.nombre) : (verif && verif.operador ? (verif.operador.nombreOficial || verif.operador.nombre) : "");
    const checks = [];
    let bloquea = false;
    let avisa = false;

    if (unidadPreparada && normUnidad(unidadPreparada) !== normUnidad(actual.unidad)) {
      checks.push(`<div class="as-warn">Elegiste la unidad ${esc(unidadPreparada)} en Turnos, pero el renglón es de la unidad ${esc(actual.unidad)}</div>`);
      avisa = true;
    }
    if (verif && verif.cargando) {
      checks.push(`<div class="nota">Verificando con Alanis Operadores…</div>`);
    } else if (verif && verif.error) {
      checks.push(`<div class="as-no">No se pudo verificar: ${esc(verif.error)}</div>`);
      bloquea = true;
    } else if (verif) {
      if (!verif.operador) {
        checks.push(`<div class="as-no">La unidad ${esc(actual.unidad)} no tiene operador activo en la app</div>`);
        bloquea = true;
      } else {
        checks.push(`<div class="as-ok">Unidad ${esc(actual.unidad)} tiene operador activo en la app</div>`);
        if (verif.otAbierta) {
          checks.push(`<div class="as-no">Está en taller (OT ${esc(verif.otAbierta.folio || verif.otAbierta.id)}): no se puede asignar hasta que terminen su OT</div>`);
          bloquea = true;
        }
        const nombreOk = nombresCoinciden(actual.operador_erp, verif.operador.nombreOficial || verif.operador.nombre);
        if (nombreOk) checks.push(`<div class="as-ok">El nombre del renglón coincide con el de la app</div>`);
        else { checks.push(`<div class="as-warn">El renglón dice ${esc(actual.operador_erp || "—")}; en la app la unidad es de ${esc(verif.operador.nombreOficial || verif.operador.nombre)}</div>`); avisa = true; }
        if (est && est.clave === "vencido") { checks.push(`<div class="as-warn">Su Disponible ya venció (ruta corta)</div>`); avisa = true; }
        else if (est && est.clave !== "disponible" && est.clave !== "taller") { checks.push(`<div class="as-warn">No está Disponible (${esc(est.txt.toLowerCase())})</div>`); avisa = true; }
        if (verif.avisos > 0) {
          const pl = (verif.plataformas || []).map(p => p === "ios" ? "iPhone" : p === "android" ? "Android" : "otro").join(", ");
          checks.push(`<div class="as-ok">Avisos activos en su teléfono${pl ? " (" + esc(pl) + ")" : ""} — le llegará la notificación</div>`);
        } else {
          const wa = esCelular() && verif.operador.telefono
            ? ` <a target="_blank" rel="noopener" href="${esc(urlWhatsApp(verif.operador.lada, verif.operador.telefono, actual))}">Abrir WhatsApp</a>` : "";
          checks.push(`<div class="as-warn">Sin avisos activos: llámale o mándale WhatsApp${wa}</div>`);
          avisa = true;
        }
        const pend = verif.pendientes || [];
        if (pend.length) {
          const p = pend[0];
          checks.push(`<div class="as-warn">Ya tiene ${pend.length === 1 ? "una asignación pendiente" : pend.length + " asignaciones pendientes"} (${esc([p.cliente, p.destino].filter(Boolean).join(" → "))}${p.timestampMs ? ", hace " + textoMin(minutos(p.timestampMs)) : ""})</div>`);
          avisa = true;
        } else {
          checks.push(`<div class="as-ok">No tiene otra asignación pendiente</div>`);
        }
      }
    }

    const listo = verif && !verif.cargando && !verif.error;
    const nombreBoton = nombreApp || ("unidad " + actual.unidad);
    const boton = !listo ? "" : bloquea
      ? `<button type="button" class="as-btn-full" disabled>No se puede asignar</button>`
      : `<button type="button" class="as-btn-full" id="as-asignar"${guardando ? " disabled" : ""}>${guardando ? "Asignando…" : (avisa ? "Asignar de todos modos" : `Asignar a ${esc(nombreBoton)} (unidad ${esc(actual.unidad)})`)}</button>`;

    caja.innerHTML = `
      <div class="as-prev">
        <div class="as-tit">
          <div><div class="as-uni">Unidad ${esc(actual.unidad)}</div>
            <div class="as-op">${esc(nombreApp || "—")}${op && op.tipoRuta ? " · Ruta <b>" + esc(ETQ_RUTA[op.tipoRuta] || op.tipoRuta) + "</b>" : ""}</div></div>
          ${est ? `<span class="as-chip ${est.clase}">${esc(est.txt)}</span>` : ""}
        </div>
        <div class="as-datos">
          <div><span>Cliente</span>${esc(actual.cliente || "—")}</div>
          <div><span>Destino</span>${esc(actual.destino || "—")}</div>
          <div><span>Remolque</span>${esc(actual.remolque || "—")}</div>
          <div><span>Línea</span>${esc(actual.linea || "—")}</div>
          <div><span>Cita</span>${esc(actual.cita || "—")}</div>
          <div><span>Operador en el renglón</span>${esc(actual.operador_erp || "—")}</div>
        </div>
        <div class="as-checks">${checks.join("")}</div>
        ${boton}
      </div>`;
    const b = caja.querySelector("#as-asignar");
    if (b) b.addEventListener("click", asignar);
  }

  async function asignar() {
    if (!actual || guardando) return;
    guardando = true;
    $("#as-error").textContent = "";
    renderPrev();
    const datos = actual;
    try {
      const r = await fnCrear(datos);
      creada = { ...(r.data || {}), datos };
      actual = null; verif = null; unidadPreparada = "";
      $("#as-pegar").value = "";
      $("#as-preparada").innerHTML = "";
    } catch (e) {
      $("#as-error").textContent = e.message || String(e);
    }
    guardando = false;
    renderPrev();
  }

  // ---- Lista ----
  let periodo = "hoy";
  let filtroEstado = "todas";
  const ETQ_EST = { pendiente: "Pendientes", aceptada: "Aceptadas", rechazada: "Rechazadas", cancelada: "Canceladas" };

  function inicioPeriodo() {
    const d = new Date();
    if (periodo === "hoy") { d.setHours(0, 0, 0, 0); return d.getTime(); }
    if (periodo === "7") return Date.now() - 7 * 864e5;
    return 0;
  }

  let editandoId = null; // mientras se escribe un motivo de cancelación, no se redibuja
  function renderLista() {
    if (editandoId) return;
    const lista = espejo.asignaciones;
    $("#as-periodo").innerHTML = [["hoy", "Hoy"], ["7", "7 días"], ["30", "30 días"]]
      .map(([k, t]) => `<button type="button" class="as-f${periodo === k ? " activo" : ""}" data-p="${k}">${t}</button>`).join("");
    $("#as-periodo").querySelectorAll(".as-f").forEach(b => b.addEventListener("click", () => { periodo = b.dataset.p; renderLista(); }));
    if (!lista) return;
    const desde = inicioPeriodo();
    const delPeriodo = lista.filter(a => (a.timestampMs || 0) >= desde).sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));
    const cuenta = (k) => k === "todas" ? delPeriodo.length : delPeriodo.filter(a => (a.estado || "pendiente") === k).length;
    $("#as-estados").innerHTML = [["todas", "Todas"], ...Object.entries(ETQ_EST)]
      .filter(([k]) => k === "todas" || k === "pendiente" || cuenta(k) > 0)
      .map(([k, t]) => `<button type="button" class="as-f${filtroEstado === k ? " activo" : ""}" data-e="${k}">${t} ${cuenta(k)}</button>`).join("");
    $("#as-estados").querySelectorAll(".as-f").forEach(b => b.addEventListener("click", () => { filtroEstado = b.dataset.e; renderLista(); }));
    const visibles = delPeriodo.filter(a => filtroEstado === "todas" || (a.estado || "pendiente") === filtroEstado);
    const opPorUid = new Map((espejo.operadores || []).map(o => [o._id, o]));
    $("#as-lista").innerHTML = visibles.length === 0
      ? `<p class="nota">Sin asignaciones ${periodo === "hoy" ? "hoy" : "en este periodo"}${filtroEstado !== "todas" ? " con este filtro" : ""}.</p>`
      : visibles.map(a => {
          const estado = a.estado || "pendiente";
          const op = opPorUid.get(a.uidOperador);
          const nombre = (op && (op.nombreOficial || op.nombre)) || a.operadorNombre || "—";
          const viaje = [[a.cliente, a.destino].filter(Boolean).join(" → "), a.remolque ? "Rem " + a.remolque : "", a.cita ? "Cita " + a.cita : ""].filter(Boolean).join(" · ");
          const origen = a.creadaDesde === "ADREMATASA" ? (a.asignadoPorNombre ? `asignó ${a.asignadoPorNombre}` : "desde ADREMATASA") : "desde Alanis Operadores";
          let chip = "", detalle = `${esc(nombre)} · ${esc(origen)} ${esc(hora(a.timestampMs))}`;
          if (estado === "pendiente") chip = `<span class="as-chip as-ambar">PENDIENTE · ${textoMin(minutos(a.timestampMs || Date.now()))}</span>`;
          else if (estado === "aceptada") {
            chip = `<span class="as-chip as-azul">ACEPTADA</span>`;
            if (a.respuestaMs) detalle += ` · aceptó ${esc(hora(a.respuestaMs))}${a.timestampMs ? " (" + textoMin(Math.max(0, Math.round((a.respuestaMs - a.timestampMs) / 60000))) + " después)" : ""}`;
          } else if (estado === "rechazada") {
            chip = `<span class="as-chip as-rojo">RECHAZADA</span>`;
            detalle += `${a.respuestaMs ? " · rechazó " + esc(hora(a.respuestaMs)) : ""}${a.motivoRechazo ? ` · Motivo: "${esc(a.motivoRechazo)}"` : ""}`;
          } else if (estado === "cancelada") {
            chip = `<span class="as-chip as-gris">CANCELADA</span>`;
            detalle += ` · canceló ${esc(a.canceladaPorNombre || "")} ${esc(hora(a.canceladaMs))}${a.motivoCancelacion ? ` · "${esc(a.motivoCancelacion)}"` : ""}`;
          } else chip = `<span class="as-chip as-gris">${esc(estado.toUpperCase())}</span>`;
          const btn = cancelar && estado === "pendiente" ? `<button type="button" class="secundario as-cancelar" data-id="${esc(a._id)}">Cancelar</button>` : "";
          return `<div class="as-it" data-fila="${esc(a._id)}"><div class="u">${esc(a.unidad || "—")}</div>
            <div>${esc(viaje || "—")}<small>${detalle}</small></div>
            <div class="as-der">${chip}${btn}</div></div>`;
        }).join("");
    $("#as-lista").querySelectorAll(".as-cancelar").forEach(b => b.addEventListener("click", () => abrirCancelar(b.dataset.id)));
  }

  function abrirCancelar(id) {
    const fila = $("#as-lista").querySelector(`[data-fila="${CSS.escape(id)}"]`);
    if (!fila || fila.querySelector(".as-cancel-box")) return;
    editandoId = id;
    const box = document.createElement("div");
    box.className = "as-cancel-box";
    box.innerHTML = `<input type="text" maxlength="200" placeholder="Motivo de la cancelación (obligatorio)">
      <button type="button" class="as-conf">Cancelar asignación</button>
      <button type="button" class="secundario as-no-conf">No</button>
      <span class="error as-cerr"></span>`;
    fila.appendChild(box);
    const input = box.querySelector("input");
    input.focus();
    const cerrar = () => { box.remove(); editandoId = null; renderLista(); };
    box.querySelector(".as-no-conf").addEventListener("click", cerrar);
    box.querySelector(".as-conf").addEventListener("click", async () => {
      const motivo = input.value.trim();
      if (!motivo) { box.querySelector(".as-cerr").textContent = "Escribe el motivo."; return; }
      box.querySelectorAll("button").forEach(x => x.disabled = true);
      try {
        await fnCancelar({ id, motivo });
        cerrar();
      } catch (e) {
        box.querySelector(".as-cerr").textContent = e.message || String(e);
        box.querySelectorAll("button").forEach(x => x.disabled = false);
      }
    });
  }

  renderLista();
}