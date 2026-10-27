// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/functions/operadoresAlanis.js
// ##########################################################################
// ============================================================================
// Utilidades → Operadores (2026-10-13, pedido de Ivan).
//
// Usuarios de ADREMATASA Interno operan sobre Alanis Operadores sin que los
// dos proyectos compartan base de datos ni reglas: el navegador de ADREMATASA
// NUNCA toca alanis-operadores — llama a estas funciones, que leen/escriben
// allá con la cuenta de servicio (la misma app "alanis" que ya usan
// sincronizarOrigenNuevos, generarEnlaceCheckpoint, etc.).
//
// Paridad estricta con el panel admin de Alanis Operadores (js/admin2.js,
// el que carga admin.html) — no se agrega nada que allá no exista:
//   - listarSolicitudesOperadores  ≈ cargarSolicitudes()
//   - resolverSolicitudOperador    ≈ aprobarSolicitud(uid,'operador') / rechazarSolicitud(uid)
//   - listarOrdenesTrabajo         ≈ cargarOTs() / filtrarOTsPorFecha()
// Fuera a propósito: aprobar como admin (solo superadmin, allá).
// Crear/editar OT: agregado 2026-10-14 (guardarOrdenTrabajo, más abajo).
//
// Quién puede usarlas: usuario activo de ADREMATASA y (admin, o su área tiene
// "Operadores" marcada en configuracion/accesosUtilidades). Es el mismo
// criterio que la tabla de Configuración, pero aplicado aquí en el servidor.
// Tráfico (2026-10-27): las funciones de Asignación piden la opción "trafico"
// (leerActor_(request, ["trafico"])); las demás siguen pidiendo "operadores".
// ============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { getApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const REGION = "us-central1";
const dbLocal = getFirestore();                 // appadrematasainterno
const dbAlanis = getFirestore(getApp("alanis")); // alanis-operadores (inicializada en index.js)

const ID_OPCION = "operadores";
const COL_BITACORA = "bitacora_acciones_operadores"; // en appadrematasainterno

// Tipo de ruta del operador (2026-10-15, pedido de Ivan): se define al aceptar
// el ingreso y se edita en Operadores registrados. Se guarda en
// usuarios/{uid}.tipoRuta de alanis-operadores. Base para la fase 2 (tablero
// de turnos por ruta y pago diario de ruta corta según disponibilidad).
const TIPOS_RUTA = ["larga", "corta", "local", "circuito"]; // circuito: 2026-10-22
function leerTipoRuta_(valor, obligatorio) {
  const v = typeof valor === "string" ? valor.trim().toLowerCase() : "";
  if (TIPOS_RUTA.includes(v)) return v;
  if (obligatorio || v !== "") throw new HttpsError("invalid-argument", "Elige el tipo de ruta: Larga, Corta, Local o Circuito.");
  return null;
}

// ---- Permisos ---------------------------------------------------------------
async function leerActor_(request, opciones) {
  const permitidas = Array.isArray(opciones) && opciones.length ? opciones : [ID_OPCION];
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
  const uid = request.auth.uid;
  const snapUsuario = await dbLocal.collection("usuarios").doc(uid).get();
  const u = snapUsuario.exists ? snapUsuario.data() : null;
  const activo = !!u && u.estatus === "activo" && ["admin", "supervisor", "empleado"].includes(u.rol);
  if (!activo) {
    throw new HttpsError("permission-denied", "Tu cuenta no está activa.");
  }
  if (u.rol !== "admin") {
    const snapAccesos = await dbLocal.collection("configuracion").doc("accesosUtilidades").get();
    // Igual que auth.js / firestore.rules: sin documento guardado, todos ven todo.
    if (snapAccesos.exists) {
      const porArea = snapAccesos.data().porArea || {};
      const lista = porArea[u.area || ""];
      if (!Array.isArray(lista) || !permitidas.some((o) => lista.includes(o))) {
        throw new HttpsError("permission-denied", permitidas.includes("trafico")
          ? "Tu área no tiene acceso a Tráfico." : "Tu área no tiene acceso a Operadores.");
      }
    }
  }
  return {
    uid,
    nombre: u.nombre || null,
    correo: u.email || request.auth.token.email || null,
    rol: u.rol || null,
    area: u.area || null,
    puesto: u.puesto || null,
  };
}

function aMillis_(ts) {
  return ts && typeof ts.toMillis === "function" ? ts.toMillis() : null;
}

// ---- Aceptación de ingreso --------------------------------------------------

// Misma consulta que admin2.js: solicitudes pendientes, más recientes primero.
exports.listarSolicitudesOperadores = onCall({ region: REGION }, async (request) => {
  await leerActor_(request);
  try {
    const snap = await dbAlanis.collection("solicitudes")
      .where("estado", "==", "pendiente")
      .orderBy("timestamp", "desc")
      .get();
    const solicitudes = snap.docs.map((d) => {
      const x = d.data();
      return {
        uid: d.id,
        nombre: x.nombre || "",
        correo: x.correo || "",
        // 2026-10-13: lo que el operador capturó al inscribirse (pendiente.html
        // de Alanis Operadores) — se prellena en el modal de aprobación.
        unidad: x.unidad || "",
        lada: x.lada === "1" ? "1" : "52",
        telefono: x.telefono || "",
        timestampMs: aMillis_(x.timestamp),
      };
    });
    return { ok: true, solicitudes };
  } catch (error) {
    logger.error(`[listarSolicitudesOperadores] ${error.message}`);
    throw new HttpsError("internal", "No se pudieron cargar las solicitudes.");
  }
});

// entrada: { uid, accion: "aprobar" | "rechazar", numero?, nombreOficial?, lada?, telefono? }
exports.resolverSolicitudOperador = onCall({ region: REGION }, async (request) => {
  const actor = await leerActor_(request);
  const e = request.data || {};
  const uid = typeof e.uid === "string" ? e.uid.trim() : "";
  const accion = e.accion;
  if (!uid || uid.includes("/")) {
    throw new HttpsError("invalid-argument", "Falta la solicitud.");
  }
  if (accion !== "aprobar" && accion !== "rechazar") {
    throw new HttpsError("invalid-argument", "Acción no válida.");
  }

  const refSolicitud = dbAlanis.collection("solicitudes").doc(uid);
  const refUsuario = dbAlanis.collection("usuarios").doc(uid);

  try {
    const [snapSol, snapUsr] = await Promise.all([refSolicitud.get(), refUsuario.get()]);
    if (!snapSol.exists) {
      throw new HttpsError("not-found", "La solicitud ya no existe.");
    }
    const sol = snapSol.data();
    if (sol.estado !== "pendiente") {
      throw new HttpsError("failed-precondition", "Esta solicitud ya fue resuelta por alguien más.");
    }
    const nombre = sol.nombre || "";
    const correo = sol.correo || "";

    if (accion === "rechazar") {
      await refSolicitud.update({ estado: "rechazado" });
    } else {
      // Candado de seguridad (no existe en admin2.js, pero allá el que aprueba
      // es admin de esa app): desde ADREMATASA nunca se sobrescribe a alguien
      // que ya es admin/superadmin en Alanis Operadores.
      if (snapUsr.exists && snapUsr.data().rol && snapUsr.data().rol !== "operador") {
        throw new HttpsError("failed-precondition", "Esta cuenta ya existe en Alanis Operadores con otro rol. Resuélvela desde allá.");
      }
      const numero = typeof e.numero === "string" ? e.numero.trim() : "";
      const nombreOficial = typeof e.nombreOficial === "string" ? e.nombreOficial.trim() : "";
      const tipoRuta = leerTipoRuta_(e.tipoRuta, true);
      const lada = e.lada === "1" ? "1" : "52";
      const telefono = typeof e.telefono === "string" ? e.telefono.replace(/\D/g, "") : "";
      if (telefono !== "" && telefono.length !== 10) {
        throw new HttpsError("invalid-argument", "El teléfono debe tener 10 dígitos.");
      }

      // Misma validación que admin2.js al aprobar (2026-10-13): una unidad no
      // puede quedar en dos operadores activos.
      if (numero !== "") {
        const otro = await unidadOcupadaPorOtro_(numero, uid);
        if (otro) {
          throw new HttpsError("failed-precondition", `La unidad ${numero} ya está asignada a ${otro}. Corrige el número económico antes de aprobar.`);
        }
      }

      // Mismos campos que aprobarSolicitud() de admin2.js (set completo).
      const datos = {
        nombre, correo, numero, nombreOficial, tipoRuta,
        rol: "operador", activo: true,
        timestamp: FieldValue.serverTimestamp(),
      };
      if (telefono !== "") { datos.lada = lada; datos.telefono = telefono; }

      // A diferencia de admin2.js (dos escrituras sueltas), aquí van juntas:
      // o quedan las dos, o ninguna.
      const lote = dbAlanis.batch();
      lote.set(refUsuario, datos);
      lote.update(refSolicitud, { estado: "aprobado" });
      await lote.commit();
      // Al quedar rol:'operador' + activo:true, sincronizarOperadoresAlanis
      // (en alanis-operadores) lo copia solo a operadores_alanis de aquí.
    }

    await dbLocal.collection(COL_BITACORA).add({
      tipo: accion === "aprobar" ? "solicitud_aprobada" : "solicitud_rechazada",
      operadorUid: uid,
      operadorNombre: nombre,
      operadorCorreo: correo,
      realizadoPor: actor,
      timestamp: FieldValue.serverTimestamp(),
    });

    logger.info(`[resolverSolicitudOperador] ${uid} → ${accion} por ${actor.uid}`);
    return { ok: true, nombre };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error(`[resolverSolicitudOperador] ${uid}: ${error.message}`);
    throw new HttpsError("internal", "No se pudo resolver la solicitud. Intenta de nuevo.");
  }
});

// ---- Órdenes de trabajo (solo consulta) -------------------------------------

// entrada: { desde: "yyyy-mm-dd", hasta: "yyyy-mm-dd" }
// Misma consulta que admin2.js: las 200 más recientes (por fecha y hora) y
// luego se filtran por rango — así no se necesita ningún índice nuevo en
// alanis-operadores. Misma limitación que allá: un rango muy viejo puede
// quedar fuera de esas 200.
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
exports.listarOrdenesTrabajo = onCall({ region: REGION }, async (request) => {
  await leerActor_(request);
  const e = request.data || {};
  const desde = typeof e.desde === "string" ? e.desde : "";
  const hasta = typeof e.hasta === "string" ? e.hasta : "";
  if (!RE_FECHA.test(desde) || !RE_FECHA.test(hasta)) {
    throw new HttpsError("invalid-argument", "Selecciona ambas fechas.");
  }
  try {
    const snap = await dbAlanis.collection("ordenes_trabajo")
      .orderBy("fecha", "desc").orderBy("timestamp", "desc").limit(200).get();
    const ordenes = snap.docs
      .map((d) => {
        const o = d.data();
        return {
          id: d.id,
          folio: o.folio || "",
          uid: o.uid || "",
          operador: o.operador || "",
          unidad: o.unidad || "",
          fecha: o.fecha || "",
          hora: o.hora || "",
          estado: o.estado || null,
          // id/cat/custom se agregan (2026-10-14) para poder EDITAR la OT sin
          // perder de qué renglón del catálogo viene cada falla.
          fallas: (o.fallas || []).map((f) => ({
            id: f.id ?? null, cat: f.cat || "", name: f.name || "", sev: f.sev || "", custom: !!f.custom,
          })),
          creadaDesde: o.creadaDesde || null,
          creadoPorNombre: (o.creadoPorAdrematasa && o.creadoPorAdrematasa.nombre) || null,
        };
      })
      .filter((o) => o.fecha >= desde && o.fecha <= hasta);
    return { ok: true, ordenes };
  } catch (error) {
    logger.error(`[listarOrdenesTrabajo] ${error.message}`);
    throw new HttpsError("internal", "No se pudieron cargar las órdenes de trabajo.");
  }
});

// ---- Crear / editar orden de trabajo (2026-10-14) ----------------------------
// Paridad con editarOT()/guardarOT() de admin2.js (mismos campos), con dos
// diferencias pedidas por Ivan:
//   1) Folio CONSECUTIVO de 5 dígitos + año a 2 dígitos ("00001-26"), en vez
//      del número al azar de allá. El contador vive en alanis-operadores
//      (contadores/ordenes_trabajo_<año>) para que, si después la app del
//      operador y admin2.js se cambian a usarlo, todos compartan la misma
//      numeración. Se reinicia cada año. Se toma dentro de una transacción:
//      dos personas creando al mismo tiempo nunca obtienen el mismo folio.
//   2) Queda registrado quién la creó/editó desde ADREMATASA (esa persona no
//      tiene cuenta en Alanis Operadores), además de la bitácora.
//
// entrada: { id?: string, operadorUid?: string, operador: string, unidad: string,
//            fallas: [{ id, cat, name, sev, custom? }] }
//
// operadorUid (2026-10-14, pedido de Ivan): si el operador se eligió de la
// lista de operadores registrados, la OT queda ligada a SU cuenta (campo uid),
// igual que cuando él mismo la crea desde su app (operador4.js). Si se
// escribió a mano, uid queda con quien la creó, como en admin2.js.
const SEVERIDADES = ["alta", "media", "baja"];

function limpiarFallas_(lista) {
  if (!Array.isArray(lista) || lista.length === 0) {
    throw new HttpsError("invalid-argument", "Debe haber al menos una falla.");
  }
  if (lista.length > 60) {
    throw new HttpsError("invalid-argument", "Demasiadas fallas en una sola orden.");
  }
  return lista.map((f) => {
    const name = f && typeof f.name === "string" ? f.name.trim().slice(0, 150) : "";
    if (!name) throw new HttpsError("invalid-argument", "Hay una falla sin nombre.");
    const limpia = {
      id: typeof f.id === "number" && isFinite(f.id) ? f.id : null,
      cat: typeof f.cat === "string" ? f.cat.trim().slice(0, 80) : "Sin clasificar",
      name,
      sev: SEVERIDADES.includes(f.sev) ? f.sev : "media",
    };
    if (f.custom) limpia.custom = true;
    return limpia;
  });
}

exports.guardarOrdenTrabajo = onCall({ region: REGION }, async (request) => {
  const actor = await leerActor_(request);
  const e = request.data || {};
  const id = typeof e.id === "string" ? e.id.trim() : "";
  if (id.includes("/")) throw new HttpsError("invalid-argument", "Orden no válida.");
  const operador = typeof e.operador === "string" ? e.operador.trim().slice(0, 120) : "";
  const unidad = typeof e.unidad === "string" ? e.unidad.trim().slice(0, 20) : "";
  if (!operador) throw new HttpsError("invalid-argument", "El operador no puede estar vacío.");
  const fallas = limpiarFallas_(e.fallas);
  const quien = { uid: actor.uid, nombre: actor.nombre, correo: actor.correo };
  const operadorUid = typeof e.operadorUid === "string" && e.operadorUid.trim() ? e.operadorUid.trim() : "";
  if (operadorUid) await leerOperador_(operadorUid); // que exista y sea operador

  try {
    let folio;
    let refOT;
    if (id) {
      refOT = dbAlanis.collection("ordenes_trabajo").doc(id);
      const snap = await refOT.get();
      if (!snap.exists) throw new HttpsError("not-found", "La orden ya no existe.");
      folio = snap.data().folio || "";
      // Mismos campos que actualiza guardarOT() de admin2.js al editar.
      await refOT.update({
        operador, unidad, numero: unidad, fallas,
        ...(operadorUid ? { uid: operadorUid } : {}),
        editadaDesdeAdrematasa: { ...quien, timestamp: FieldValue.serverTimestamp() },
      });
    } else {
      const { fecha, hora } = fechaHoraLocal_();
      const anio = Number(fecha.slice(0, 4));
      const refContador = dbAlanis.collection("contadores").doc(`ordenes_trabajo_${anio}`);
      refOT = dbAlanis.collection("ordenes_trabajo").doc();
      folio = await dbAlanis.runTransaction(async (tx) => {
        const snapC = await tx.get(refContador);
        const siguiente = (snapC.exists ? Number(snapC.data().ultimo) || 0 : 0) + 1;
        if (siguiente > 99999) throw new HttpsError("resource-exhausted", "Se llegó al límite de folios del año.");
        const nuevoFolio = `${String(siguiente).padStart(5, "0")}-${String(anio).slice(-2)}`;
        tx.set(refContador, { ultimo: siguiente, anio, actualizado: FieldValue.serverTimestamp() }, { merge: true });
        // Mismos campos que crea guardarOT() de admin2.js.
        tx.set(refOT, {
          folio: nuevoFolio, anio, uid: operadorUid || actor.uid,
          operador, numero: unidad, unidad, fallas,
          fecha, hora,
          timestamp: FieldValue.serverTimestamp(),
          creadaDesde: "ADREMATASA",
          creadoPorAdrematasa: quien,
        });
        return nuevoFolio;
      });
    }

    await dbLocal.collection(COL_BITACORA).add({
      tipo: id ? "ot_editada" : "ot_creada",
      otId: refOT.id,
      folio,
      operadorNombre: operador,
      unidad,
      totalFallas: fallas.length,
      realizadoPor: actor,
      timestamp: FieldValue.serverTimestamp(),
    });

    logger.info(`[guardarOrdenTrabajo] ${id ? "editada" : "creada"} ${folio} por ${actor.uid}`);
    return { ok: true, id: refOT.id, folio };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error(`[guardarOrdenTrabajo] ${error.message}`);
    throw new HttpsError("internal", "No se pudo guardar la orden de trabajo. Intenta de nuevo.");
  }
});

// ---- Operadores registrados (2026-10-13) -------------------------------------
// Paridad con la pestaña "Operadores registrados" de admin2.js
// (cargarOperadores, guardarDatosOperador, toggleActivoOperador,
// verHistorialUnidad), menos "Promover a admin". Solo actúa sobre usuarios con
// rol:'operador' — nunca toca admins/superadmins de Alanis Operadores.

const TZ_OPERACION = "America/Matamoros";
const RE_TELEFONO = /^[0-9]{10}$/;

function fechaHoraLocal_() {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_OPERACION, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const v = (t) => (partes.find((p) => p.type === t) || {}).value || "";
  const hora = v("hour") === "24" ? "00" : v("hour");
  return { fecha: `${v("year")}-${v("month")}-${v("day")}`, hora: `${hora}:${v("minute")}` };
}

async function leerOperador_(uid) {
  if (typeof uid !== "string" || !uid.trim() || uid.includes("/")) {
    throw new HttpsError("invalid-argument", "Falta el operador.");
  }
  const ref = dbAlanis.collection("usuarios").doc(uid.trim());
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "El operador ya no existe.");
  const d = snap.data();
  if (d.rol !== "operador") {
    throw new HttpsError("failed-precondition", "Esta cuenta no es de operador. Adminístrala desde Alanis Operadores.");
  }
  return { ref, d };
}

// Una unidad no puede quedar en dos operadores activos (mismo criterio que admin2.js).
async function unidadOcupadaPorOtro_(numero, uid) {
  const dup = await dbAlanis.collection("usuarios")
    .where("numero", "==", numero).where("activo", "==", true).get();
  const otro = dup.docs.find((x) => x.id !== uid);
  return otro ? (otro.data().nombreOficial || otro.data().nombre || otro.id) : null;
}

exports.listarOperadoresRegistrados = onCall({ region: REGION }, async (request) => {
  await leerActor_(request);
  try {
    const snap = await dbAlanis.collection("usuarios").where("rol", "==", "operador").get();
    const operadores = snap.docs.map((d) => {
      const o = d.data();
      return {
        uid: d.id,
        nombre: o.nombre || "",
        correo: o.correo || "",
        nombreOficial: o.nombreOficial || "",
        numero: o.numero || "",
        tipoRuta: TIPOS_RUTA.includes(o.tipoRuta) ? o.tipoRuta : null,
        lada: o.lada || "52",
        telefono: o.telefono || "",
        activo: o.activo === true,
      };
    }).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    return { ok: true, operadores };
  } catch (error) {
    logger.error(`[listarOperadoresRegistrados] ${error.message}`);
    throw new HttpsError("internal", "No se pudieron cargar los operadores.");
  }
});

// entrada: { uid, numero, nombreOficial, lada, telefono }
exports.guardarDatosOperador = onCall({ region: REGION }, async (request) => {
  const actor = await leerActor_(request);
  const e = request.data || {};
  try {
    const { ref, d } = await leerOperador_(e.uid);
    const uid = ref.id;
    const numero = typeof e.numero === "string" ? e.numero.trim() : "";
    const nombreOficial = typeof e.nombreOficial === "string" ? e.nombreOficial.trim() : "";
    const lada = e.lada === "1" ? "1" : "52";
    const telefono = typeof e.telefono === "string" ? e.telefono.replace(/\D/g, "") : "";
    const tipoRuta = leerTipoRuta_(e.tipoRuta, false); // opcional: null = no se cambia
    if (!numero) throw new HttpsError("invalid-argument", "Ingresa un número de unidad.");
    if (numero.length > 10) throw new HttpsError("invalid-argument", "El número de unidad es demasiado largo.");
    if (telefono !== "" && !RE_TELEFONO.test(telefono)) {
      throw new HttpsError("invalid-argument", "El teléfono debe tener 10 dígitos.");
    }

    // La unidad anterior se toma de la base, no de lo que mande el navegador.
    const unidadAnterior = d.numero || "";
    if (numero !== unidadAnterior) {
      const otro = await unidadOcupadaPorOtro_(numero, uid);
      if (otro) {
        throw new HttpsError("failed-precondition", `La unidad ${numero} ya está asignada a ${otro}. Corrígela antes de guardar.`);
      }
    }

    // Mismo criterio que admin2.js: nombreOficial se guarda siempre (aunque
    // quede vacío); el teléfono solo si se capturó.
    const update = { numero, nombreOficial };
    if (telefono !== "") { update.lada = lada; update.telefono = telefono; }
    if (tipoRuta) update.tipoRuta = tipoRuta;
    await ref.update(update);

    if (numero !== unidadAnterior) {
      const { fecha, hora } = fechaHoraLocal_();
      await ref.collection("historial_unidades").add({
        unidad_anterior: unidadAnterior || "(ninguna)",
        unidad_nueva: numero,
        fecha, hora,
        timestamp: FieldValue.serverTimestamp(),
        cambiadoPor: { uid: actor.uid, nombre: actor.nombre, proyecto: "appadrematasainterno" },
      });
    }

    await dbLocal.collection(COL_BITACORA).add({
      tipo: "datos_actualizados",
      operadorUid: uid,
      operadorNombre: d.nombre || "",
      antes: { numero: unidadAnterior, nombreOficial: d.nombreOficial || "", lada: d.lada || null, telefono: d.telefono || null, tipoRuta: d.tipoRuta || null },
      despues: { numero, nombreOficial, lada: telefono !== "" ? lada : (d.lada || null), telefono: telefono !== "" ? telefono : (d.telefono || null), tipoRuta: tipoRuta || d.tipoRuta || null },
      realizadoPor: actor,
      timestamp: FieldValue.serverTimestamp(),
    });

    logger.info(`[guardarDatosOperador] ${uid} por ${actor.uid}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error(`[guardarDatosOperador] ${error.message}`);
    throw new HttpsError("internal", "No se pudieron guardar los datos. Intenta de nuevo.");
  }
});

// entrada: { uids: [uid...], tipoRuta: "larga" | "corta" | "local" | "circuito" }
// Modo "Asignar rutas" de Operadores registrados: aplica el mismo tipo de ruta
// a varios operadores en un solo paso (todo o nada). Solo cuentas con
// rol:'operador'; nunca toca admins de Alanis Operadores.
exports.asignarRutaOperadores = onCall({ region: REGION }, async (request) => {
  const actor = await leerActor_(request);
  const e = request.data || {};
  const tipoRuta = leerTipoRuta_(e.tipoRuta, true);
  const uids = Array.isArray(e.uids) ? [...new Set(e.uids.filter(u => typeof u === "string" && u.trim() && !u.includes("/")))] : [];
  if (uids.length === 0) throw new HttpsError("invalid-argument", "Selecciona al menos un operador.");
  if (uids.length > 200) throw new HttpsError("invalid-argument", "Demasiados operadores en un solo paso.");
  try {
    const refs = uids.map(u => dbAlanis.collection("usuarios").doc(u));
    const snaps = await dbAlanis.getAll(...refs);
    const lote = dbAlanis.batch();
    const cambios = [];
    snaps.forEach((snap) => {
      if (!snap.exists || snap.data().rol !== "operador") return;
      lote.update(snap.ref, { tipoRuta });
      cambios.push({ uid: snap.id, nombre: snap.data().nombreOficial || snap.data().nombre || "", antes: snap.data().tipoRuta || null });
    });
    if (cambios.length === 0) throw new HttpsError("failed-precondition", "Ninguna de las cuentas seleccionadas es de operador.");
    await lote.commit();
    await dbLocal.collection(COL_BITACORA).add({
      tipo: "ruta_asignada",
      tipoRuta,
      operadores: cambios,
      realizadoPor: actor,
      timestamp: FieldValue.serverTimestamp(),
    });
    logger.info(`[asignarRutaOperadores] ${cambios.length} → ${tipoRuta} por ${actor.uid}`);
    return { ok: true, total: cambios.length };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error(`[asignarRutaOperadores] ${error.message}`);
    throw new HttpsError("internal", "No se pudo asignar la ruta. Intenta de nuevo.");
  }
});

// ---- Turnos (2026-10-16, fase 2 de rutas) ------------------------------------
// Lo que cada operador ya reporta desde su app de Alanis Operadores, para el
// tablero de Turnos de ADREMATASA (que ordena por la Fecha en Patio del
// reporte pegado del Adrematasa oficial):
//   - eventos: último estatus de PATIO (disponible, taller, enfermo, permiso,
//     vacaciones, incapacitado) de los últimos 14 días.
//   - asignaciones: la más reciente (pendiente / aceptada / rechazada).
//   - ordenes_trabajo: la más reciente (para "En taller").
// Solo lectura; no cambia nada en Alanis Operadores.
const ESTATUS_PATIO = ["disponible", "taller", "enfermo", "permiso", "vacaciones", "incapacitado"];
const DIAS_TURNOS = 14;

exports.estadoTurnosOperadores = onCall({ region: REGION }, async (request) => {
  await leerActor_(request);
  try {
    const desde = new Date(Date.now() - DIAS_TURNOS * 24 * 60 * 60 * 1000);
    const [snapOps, snapEv, snapAsig, snapOT] = await Promise.all([
      dbAlanis.collection("usuarios").where("rol", "==", "operador").get(),
      dbAlanis.collection("eventos").where("timestamp", ">=", desde).orderBy("timestamp", "desc").limit(3000).get(),
      dbAlanis.collection("asignaciones").orderBy("timestamp", "desc").limit(400).get(),
      dbAlanis.collection("ordenes_trabajo").orderBy("timestamp", "desc").limit(400).get(),
    ]);

    const estado = {};
    snapOps.docs.forEach((d) => {
      const o = d.data();
      estado[d.id] = {
        uid: d.id,
        nombre: o.nombre || "",
        nombreOficial: o.nombreOficial || "",
        numero: o.numero || "",
        tipoRuta: TIPOS_RUTA.includes(o.tipoRuta) ? o.tipoRuta : null,
        lada: o.lada || "52",
        telefono: o.telefono || "",
        activo: o.activo === true,
        estatus: null, asignacion: null, ot: null,
      };
    });

    // Vienen del más reciente al más viejo: el primero que se ve por operador es el último.
    snapEv.docs.forEach((d) => {
      const ev = d.data();
      const e = estado[ev.uid];
      if (!e || e.estatus) return;
      const id = ev.estatus || (Array.isArray(ev.estatus_ids) ? ev.estatus_ids[0] : "");
      if (!ESTATUS_PATIO.includes(id)) return;
      e.estatus = {
        id, ms: aMillis_(ev.timestamp), fecha: ev.fecha || "", hora: ev.hora || "",
        fechaRegreso: ev.fecha_regreso || ev.vac_fin || "", autorizo: ev.autorizo || "",
        dias: ev.dias_incapacidad || "",
        fallas: (ev.fallas || []).map((f) => f && f.name).filter(Boolean).slice(0, 5),
      };
    });
    snapAsig.docs.forEach((d) => {
      const a = d.data();
      const e = estado[a.uid_operador];
      if (!e || e.asignacion) return;
      e.asignacion = {
        id: d.id, estado: a.estado || "pendiente", ms: aMillis_(a.timestamp),
        cliente: a.cliente || "", destino: a.destino || "", remolque: a.remolque || "",
        cita: a.cita || "", motivoRechazo: a.motivo_rechazo || "",
        creadaDesde: a.creadaDesde || null,
      };
    });
    snapOT.docs.forEach((d) => {
      const o = d.data();
      const e = estado[o.uid];
      if (!e || e.ot) return;
      e.ot = {
        id: d.id, folio: o.folio || "", ms: aMillis_(o.timestamp), fecha: o.fecha || "", hora: o.hora || "",
        fallas: (o.fallas || []).map((f) => f && f.name).filter(Boolean).slice(0, 3),
      };
    });

    return { ok: true, operadores: Object.values(estado), generadoMs: Date.now() };
  } catch (error) {
    logger.error(`[estadoTurnosOperadores] ${error.message}`);
    throw new HttpsError("internal", "No se pudo cargar el estado de los operadores.");
  }
});

// ---- Espejos en vivo: copia inicial / resincronizar (2026-10-16) --------------
// Los triggers de alanis-operadores (espejosAdrematasa.js) copian cada CAMBIO.
// Esta función llena los espejos con lo que YA existe (una sola vez al
// estrenarlos, o para reparar si algo quedó desfasado). Solo admin.
// Usa la misma forma de los espejos que los triggers (espejosOperadoresComun.js,
// archivo idéntico en los dos proyectos).
const comunEspejos = require("./espejosOperadoresComun");
const DIAS_ESPEJO_ORDENES = 120;
const DIAS_ESPEJO_ASIGNACIONES = 60;
const DIAS_ESPEJO_EVENTOS = 14;

async function escribirEnLotes_(coleccion, pares) {
  // pares: [[id, datos|null]]; null = borrar el espejo
  for (let i = 0; i < pares.length; i += 400) {
    const lote = dbLocal.batch();
    pares.slice(i, i + 400).forEach(([id, datos]) => {
      const ref = dbLocal.collection(coleccion).doc(id);
      if (datos) lote.set(ref, { ...datos, espejoMs: Date.now() });
      else lote.delete(ref);
    });
    await lote.commit();
  }
}

exports.poblarEspejosOperadores = onCall({ region: REGION, timeoutSeconds: 300, memory: "512MiB" }, async (request) => {
  const actor = await leerActor_(request);
  if (actor.rol !== "admin") throw new HttpsError("permission-denied", "Solo un administrador puede resincronizar los espejos.");
  const dias = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  try {
    const [snapSol, snapUsr, snapOT, snapAsig, snapEv, espejoSol] = await Promise.all([
      dbAlanis.collection("solicitudes").where("estado", "==", "pendiente").get(),
      dbAlanis.collection("usuarios").where("rol", "==", "operador").get(),
      dbAlanis.collection("ordenes_trabajo").where("timestamp", ">=", dias(DIAS_ESPEJO_ORDENES)).get(),
      dbAlanis.collection("asignaciones").where("timestamp", ">=", dias(DIAS_ESPEJO_ASIGNACIONES)).get(),
      dbAlanis.collection("eventos").where("timestamp", ">=", dias(DIAS_ESPEJO_EVENTOS)).orderBy("timestamp", "desc").get(),
      dbLocal.collection(comunEspejos.COL.solicitudes).get(),
    ]);

    // Solicitudes: además de copiar las pendientes, borra espejos de las que ya se resolvieron.
    const pendientes = new Set(snapSol.docs.map((d) => d.id));
    const paresSol = snapSol.docs.map((d) => [d.id, comunEspejos.solicitud(d.data())]);
    espejoSol.docs.forEach((d) => { if (!pendientes.has(d.id)) paresSol.push([d.id, null]); });

    const ultimos = new Map();
    snapEv.docs.forEach((d) => {
      const ev = d.data();
      if (!ev.uid || ultimos.has(ev.uid)) return;
      const est = comunEspejos.estatus(ev);
      if (est) ultimos.set(ev.uid, est);
    });

    const conteo = {
      solicitudes: paresSol.length,
      operadores: snapUsr.size,
      ordenes: snapOT.size,
      asignaciones: snapAsig.size,
      estatus: ultimos.size,
    };
    await escribirEnLotes_(comunEspejos.COL.solicitudes, paresSol);
    await escribirEnLotes_(comunEspejos.COL.operadores, snapUsr.docs.map((d) => [d.id, comunEspejos.operador(d.data())]));
    await escribirEnLotes_(comunEspejos.COL.ordenes, snapOT.docs.map((d) => [d.id, comunEspejos.orden(d.data())]));
    await escribirEnLotes_(comunEspejos.COL.asignaciones, snapAsig.docs.map((d) => [d.id, comunEspejos.asignacion(d.data())]));
    await escribirEnLotes_(comunEspejos.COL.estatus, [...ultimos.entries()]);

    await dbLocal.collection(COL_BITACORA).add({
      tipo: "espejos_resincronizados", conteo, realizadoPor: actor, timestamp: FieldValue.serverTimestamp(),
    });
    logger.info(`[poblarEspejosOperadores] ${JSON.stringify(conteo)} por ${actor.uid}`);
    return { ok: true, conteo };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error(`[poblarEspejosOperadores] ${error.message}`);
    throw new HttpsError("internal", "No se pudieron llenar los espejos: " + error.message);
  }
});

// entrada: { uid, activo: boolean }
exports.cambiarEstadoOperador = onCall({ region: REGION }, async (request) => {
  const actor = await leerActor_(request);
  const e = request.data || {};
  if (typeof e.activo !== "boolean") throw new HttpsError("invalid-argument", "Estado no válido.");
  try {
    const { ref, d } = await leerOperador_(e.uid);
    // Protección extra (no existe en admin2.js): al reactivar, que su unidad
    // no se haya asignado mientras tanto a otro operador activo.
    if (e.activo && d.numero) {
      const otro = await unidadOcupadaPorOtro_(d.numero, ref.id);
      if (otro) {
        throw new HttpsError("failed-precondition", `No se puede activar: su unidad ${d.numero} ya está asignada a ${otro}. Cámbiale la unidad primero.`);
      }
    }
    await ref.update({ activo: e.activo });
    // sincronizarOperadoresAlanis (alanis-operadores) lo agrega o quita solo de
    // operadores_alanis → aparece/desaparece del selector de QR.
    await dbLocal.collection(COL_BITACORA).add({
      tipo: e.activo ? "operador_activado" : "operador_desactivado",
      operadorUid: ref.id,
      operadorNombre: d.nombre || "",
      realizadoPor: actor,
      timestamp: FieldValue.serverTimestamp(),
    });
    logger.info(`[cambiarEstadoOperador] ${ref.id} → activo:${e.activo} por ${actor.uid}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error(`[cambiarEstadoOperador] ${error.message}`);
    throw new HttpsError("internal", "No se pudo cambiar el estado. Intenta de nuevo.");
  }
});

// entrada: { uid } → últimos 10 cambios de unidad
exports.historialUnidadOperador = onCall({ region: REGION }, async (request) => {
  await leerActor_(request);
  const e = request.data || {};
  try {
    const { ref } = await leerOperador_(e.uid);
    const snap = await ref.collection("historial_unidades").orderBy("timestamp", "desc").limit(10).get();
    const cambios = snap.docs.map((x) => {
      const h = x.data();
      return { fecha: h.fecha || "", hora: h.hora || "", anterior: h.unidad_anterior || "", nueva: h.unidad_nueva || "" };
    });
    return { ok: true, cambios };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error(`[historialUnidadOperador] ${error.message}`);
    throw new HttpsError("internal", "No se pudo cargar el historial.");
  }
});

// ---- Control de taller (2026-10-19, pedido de Ivan) ---------------------------
// Terminar una OT libera al operador de "En taller" (lo hace el trigger
// estatusOperadorPorOT en alanis-operadores al ver estado:'terminada').
// Solo admin o un Coordinador (puesto o área que diga "Coordinador").
// entrada: { id, fechaMs, comentario? }
function normalizarTexto_(t) {
  return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
function puedeTerminarOT_(actor) {
  return actor.rol === "admin"
    || normalizarTexto_(actor.puesto).includes("coordinador")
    || normalizarTexto_(actor.area).includes("coordinador");
}

exports.terminarOrdenTrabajo = onCall({ region: REGION }, async (request) => {
  const actor = await leerActor_(request);
  if (!puedeTerminarOT_(actor)) {
    throw new HttpsError("permission-denied", "Solo un Coordinador o un administrador puede terminar órdenes de trabajo.");
  }
  const e = request.data || {};
  const id = typeof e.id === "string" ? e.id.trim() : "";
  if (!id || id.includes("/")) throw new HttpsError("invalid-argument", "Orden no válida.");
  const fechaMs = Number(e.fechaMs);
  if (!isFinite(fechaMs) || fechaMs <= 0) throw new HttpsError("invalid-argument", "Indica la fecha y hora en que se terminó.");
  if (fechaMs > Date.now() + 2 * 60 * 1000) throw new HttpsError("invalid-argument", "La fecha de término no puede ser futura.");
  const comentario = typeof e.comentario === "string" ? e.comentario.trim().slice(0, 300) : "";

  const ref = dbAlanis.collection("ordenes_trabajo").doc(id);
  try {
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "La orden ya no existe.");
    const o = snap.data();
    if (o.estado === "terminada") throw new HttpsError("failed-precondition", "Esta orden ya estaba terminada.");
    const creadaMs = aMillis_(o.timestamp);
    if (creadaMs && fechaMs < creadaMs - 60 * 1000) {
      throw new HttpsError("invalid-argument", "La fecha de término no puede ser anterior a la creación de la orden.");
    }
    const terminadaPor = { uid: actor.uid, nombre: actor.nombre, puesto: actor.puesto };
    await ref.update({
      estado: "terminada",
      terminadaEn: Timestamp.fromMillis(fechaMs),
      terminadaPor,
      comentarioCierre: comentario,
      terminadaRegistradaEn: FieldValue.serverTimestamp(),
    });
    await dbLocal.collection(COL_BITACORA).add({
      tipo: "ot_terminada",
      otId: id,
      folio: o.folio || "",
      operadorNombre: o.operador || "",
      unidad: o.unidad || o.numero || "",
      terminadaMs: fechaMs,
      comentario,
      realizadoPor: actor,
      timestamp: FieldValue.serverTimestamp(),
    });
    logger.info(`[terminarOrdenTrabajo] ${o.folio || id} por ${actor.uid}`);
    return { ok: true, folio: o.folio || "" };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error(`[terminarOrdenTrabajo] ${error.message}`);
    throw new HttpsError("internal", "No se pudo terminar la orden. Intenta de nuevo.");
  }
});

// Entradas a patio → Alanis Operadores (2026-10-19): cada vez que se pega el
// reporte de patio en Turnos (turnos_patio/actual), se copia a
// entradas_patio/{UNIDAD} allá la fecha de entrada de cada unidad. La app del
// operador la usa para dejarlo (o no) ponerse Disponible. Las unidades que ya
// no vienen en el reporte se borran: sin entrada, no hay Disponible.
exports.copiarEntradasPatio = onDocumentWritten({ document: "turnos_patio/{id}", region: REGION }, async (event) => {
  if (event.params.id !== "actual") return;
  const despues = event.data.after.exists ? event.data.after.data() : null;
  const reporteMs = despues ? Number(despues.importadoMs) || Date.now() : null;
  const porUnidad = new Map();
  ((despues && Array.isArray(despues.filas)) ? despues.filas : []).forEach((r) => {
    const unidad = String((r && r.unidad) || "").trim().toUpperCase();
    const ms = Number(r && r.fechaPatioMs);
    if (!unidad || unidad.includes("/") || unidad.length > 20 || !isFinite(ms)) return;
    if (!porUnidad.has(unidad) || porUnidad.get(unidad) < ms) porUnidad.set(unidad, ms);
  });
  try {
    const col = dbAlanis.collection("entradas_patio");
    const existentes = await col.get();
    const ops = [];
    existentes.docs.forEach((d) => { if (!porUnidad.has(d.id)) ops.push((b) => b.delete(d.ref)); });
    porUnidad.forEach((ms, unidad) => {
      ops.push((b) => b.set(col.doc(unidad), { unidad, fechaPatioMs: ms, reporteMs, copiadoEn: FieldValue.serverTimestamp() }));
    });
    for (let i = 0; i < ops.length; i += 400) {
      const lote = dbAlanis.batch();
      ops.slice(i, i + 400).forEach((op) => op(lote));
      await lote.commit();
    }
    // Historial (2026-10-20, Asistencia): cada entrada queda guardada aquí
    // (appadrematasainterno) para saber qué días tuvo entrada a patio cada
    // unidad. Mismo id por unidad + fecha de entrada: volver a pegar el mismo
    // reporte no duplica nada.
    const hist = [...porUnidad.entries()];
    for (let i = 0; i < hist.length; i += 400) {
      const lote = dbLocal.batch();
      hist.slice(i, i + 400).forEach(([unidad, ms]) => {
        lote.set(dbLocal.collection(COL_HIST_ENTRADAS).doc(`${unidad}_${ms}`), { unidad, fechaPatioMs: ms, reporteMs }, { merge: true });
      });
      await lote.commit();
    }
    logger.info(`[copiarEntradasPatio] ${porUnidad.size} unidades`);
  } catch (error) {
    logger.error(`[copiarEntradasPatio] ${error.message}`);
    throw error;
  }
});

// ============================================================================
// ASISTENCIA ruta corta (2026-10-20, pedido de Ivan)
// ============================================================================
// Semana de VIERNES a JUEVES (hora de Nuevo Laredo; cambio 2026-10-22). Pago
// SEMANAL según tipo de ruta (Configuración): Corta y Circuito, proporcional a
// los días pagables (monto ÷ 7 × días). Un día es PAGABLE si el
// operador tuvo entrada a patio (historial_entradas_patio) y además:
//   - aceptó un viaje ese día, o
//   - estuvo en taller en algún momento del día, o
//   - estuvo Disponible y lo mantuvo vigente: cada Disponible dura
//     HORAS_VIGENCIA_ASIST; si vence antes de la hora de corte del día sin
//     reconfirmar (ni pasar a viaje/taller/otro estatus) => "vencido": se
//     guarda en el historial pero NO se paga.
// Quien revisa (Coordinador/Supervisor/Auxiliar o admin) puede ajustar un día
// (pagar / no pagar) con motivo, y autorizar la semana: queda congelada.
// Reabrir: admin o los puestos marcados en Configuración.
const COL_HIST_ENTRADAS = "historial_entradas_patio";
const COL_ASIST_SEMANAS = "asistencia_semanas";
const COL_ASIST_AJUSTES = "asistencia_ajustes";
const HORAS_VIGENCIA_ASIST = 4; // igual que Turnos y la app del operador
const PUESTOS_REVISAN = ["coordinador", "supervisor", "auxiliar"];
const DIA_MS = 24 * 60 * 60 * 1000;
const RE_FECHA_ASIST = /^\d{4}-\d{2}-\d{2}$/;

function offsetTZ_(ms) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ_OPERACION, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms));
  const v = (t) => Number((p.find((x) => x.type === t) || {}).value);
  return Date.UTC(v("year"), v("month") - 1, v("day"), v("hour") % 24, v("minute"), v("second")) - Math.floor(ms / 1000) * 1000;
}
// "2026-10-19" + minutos del día (hora local) -> ms
function msLocal_(fecha, minutos) {
  const [y, m, d] = fecha.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d) + minutos * 60000;
  let ms = base - offsetTZ_(base);
  ms = base - offsetTZ_(ms);
  return ms;
}
function sumarDias_(fecha, n) {
  const [y, m, d] = fecha.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return x.toISOString().slice(0, 10);
}
function horaLocal_(ms) {
  return new Intl.DateTimeFormat("es-MX", { timeZone: TZ_OPERACION, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
}
function minutosCorte_(txt) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(txt || ""));
  if (!m) return 18 * 60;
  return Math.min(23 * 60 + 59, Number(m[1]) * 60 + Number(m[2]));
}
function normPuesto_(t) {
  return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}
function puedeRevisarAsistencia_(actor) {
  if (actor.rol === "admin") return true;
  const p = normPuesto_(actor.puesto);
  return PUESTOS_REVISAN.some((x) => p.includes(x));
}
async function leerConfigAsistencia_() {
  const s = await dbLocal.collection("configuracion").doc("asistencia").get();
  const c = s.exists ? s.data() : {};
  return {
    montoSemana: {
      corta: typeof c.montoSemanaCorta === "number" && c.montoSemanaCorta >= 0 ? c.montoSemanaCorta : 0,
      circuito: typeof c.montoSemanaCircuito === "number" && c.montoSemanaCircuito >= 0 ? c.montoSemanaCircuito : 0,
    },
    horaCorte: typeof c.horaCorte === "string" ? c.horaCorte : "18:00",
    reabrenPuestos: Array.isArray(c.reabrenPuestos) ? c.reabrenPuestos.map(normPuesto_) : [],
  };
}
function validarInicio_(viernes) {
  if (typeof viernes !== "string" || !RE_FECHA_ASIST.test(viernes)) throw new HttpsError("invalid-argument", "Semana no válida.");
  const [y, m, d] = viernes.split("-").map(Number);
  if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== 5) throw new HttpsError("invalid-argument", "La semana debe empezar en viernes.");
  return viernes;
}

const PATIO_ASIST = ["disponible", "taller", "enfermo", "permiso", "vacaciones", "incapacitado", "liberado_taller"];
const ETQ_ASIST = { disponible: "Disponible", taller: "Taller", enfermo: "Enfermo", permiso: "Permiso", vacaciones: "Vacaciones", incapacitado: "Incapacitado", liberado_taller: "Liberado de taller" };

async function calcularSemana_(viernes, cfg) {
  const fechas = [0, 1, 2, 3, 4, 5, 6].map((i) => sumarDias_(viernes, i));
  const inicio = msLocal_(fechas[0], 0);
  const fin = msLocal_(sumarDias_(viernes, 7), 0);
  const ahora = Date.now();
  const corteMin = minutosCorte_(cfg.horaCorte);
  const vig = HORAS_VIGENCIA_ASIST * 3600 * 1000;

  const [snapOps, snapEv, snapAsig, snapEnt, snapAj] = await Promise.all([
    dbAlanis.collection("usuarios").where("rol", "==", "operador").get(),
    dbAlanis.collection("eventos").where("timestamp", ">=", new Date(inicio - 14 * DIA_MS)).where("timestamp", "<", new Date(fin)).get(),
    dbAlanis.collection("asignaciones").where("timestamp", ">=", new Date(inicio - 14 * DIA_MS)).get(),
    dbLocal.collection(COL_HIST_ENTRADAS).where("fechaPatioMs", ">=", inicio - 60 * DIA_MS).where("fechaPatioMs", "<", fin).get(),
    dbLocal.collection(COL_ASIST_AJUSTES).where("semana", "==", viernes).get(),
  ]);

  const ops = snapOps.docs.map((d) => ({ uid: d.id, ...d.data() }))
    .filter((o) => o.tipoRuta === "corta" || o.tipoRuta === "circuito")
    .map((o) => ({ uid: o.uid, unidad: String(o.numero || "").trim().toUpperCase(), nombre: o.nombreOficial || o.nombre || "", activo: o.activo === true, tipoRuta: o.tipoRuta }))
    .sort((a, b) => a.unidad.localeCompare(b.unidad, "es", { numeric: true }));
  const uids = new Set(ops.map((o) => o.uid));

  const evPorUid = new Map();
  snapEv.docs.forEach((d) => {
    const e = d.data();
    if (!uids.has(e.uid)) return;
    const id = e.estatus || (Array.isArray(e.estatus_ids) ? e.estatus_ids[0] : "");
    if (!PATIO_ASIST.includes(id)) return;
    const ms = aMillis_(e.timestamp);
    if (!ms) return;
    if (!evPorUid.has(e.uid)) evPorUid.set(e.uid, []);
    evPorUid.get(e.uid).push({ id, ms, precision: e.gps && typeof e.gps.precision === "number" ? e.gps.precision : null, otFolio: e.otFolio || "" });
  });
  evPorUid.forEach((l) => l.sort((a, b) => a.ms - b.ms));

  const viajesPorUid = new Map();
  snapAsig.docs.forEach((d) => {
    const a = d.data();
    if (!uids.has(a.uid_operador) || a.estado !== "aceptada") return;
    const ms = aMillis_(a.fecha_respuesta) || aMillis_(a.timestamp);
    if (!ms) return;
    if (!viajesPorUid.has(a.uid_operador)) viajesPorUid.set(a.uid_operador, []);
    viajesPorUid.get(a.uid_operador).push({ ms, txt: [a.remolque, a.cliente, a.destino].filter(Boolean).join(" · ") });
  });

  const entPorUnidad = new Map();
  snapEnt.docs.forEach((d) => {
    const x = d.data();
    if (!entPorUnidad.has(x.unidad)) entPorUnidad.set(x.unidad, []);
    entPorUnidad.get(x.unidad).push(x.fechaPatioMs);
  });
  entPorUnidad.forEach((l) => l.sort((a, b) => a - b));

  const ajustes = new Map();
  snapAj.docs.forEach((d) => { const a = d.data(); ajustes.set(`${a.uid}_${a.fecha}`, a); });

  const filas = ops.map((op) => {
    const evs = evPorUid.get(op.uid) || [];
    const viajes = viajesPorUid.get(op.uid) || [];
    const entradas = entPorUnidad.get(op.unidad) || [];
    const dias = fechas.map((fecha) => {
      const ini = msLocal_(fecha, 0);
      const finDia = msLocal_(sumarDias_(fecha, 1), 0);
      const corte = msLocal_(fecha, corteMin);
      if (ini > ahora) return { fecha, codigo: "futuro", paga: false, detalle: [] };
      const detalle = [];
      const entrada = entradas.filter((ms) => ms < finDia).pop() || null;
      if (entrada) detalle.push({ ms: entrada, txt: `Entrada a patio${entrada < ini ? " (" + new Intl.DateTimeFormat("es-MX", { timeZone: TZ_OPERACION, day: "2-digit", month: "2-digit" }).format(new Date(entrada)) + ")" : ""}` });
      const delDia = evs.filter((e) => e.ms >= ini && e.ms < finDia);
      delDia.forEach((e) => detalle.push({ ms: e.ms, txt: ETQ_ASIST[e.id] + (e.precision != null ? ` · ± ${e.precision} m` : "") + (e.otFolio ? ` · OT ${e.otFolio}` : "") + (e.id === "disponible" ? ` · vence ${horaLocal_(e.ms + vig)}` : "") }));
      const viajesDia = viajes.filter((v) => v.ms >= ini && v.ms < finDia);
      viajesDia.forEach((v) => detalle.push({ ms: v.ms, txt: "Aceptó viaje" + (v.txt ? " · " + v.txt : "") }));
      detalle.sort((a, b) => a.ms - b.ms);

      let codigo = "nada";
      if (!entrada) codigo = "sin_entrada";
      else {
        const previo = evs.filter((e) => e.ms < ini).pop();
        const enTaller = (previo && previo.id === "taller") || delDia.some((e) => e.id === "taller");
        const viajeOk = viajesDia.some((v) => v.ms >= entrada);
        const disp = delDia.filter((e) => e.id === "disponible" && e.ms >= entrada);
        if (viajeOk) codigo = "viaje";
        else if (enTaller) codigo = "taller";
        else if (disp.length) {
          // ¿Mantuvo el Disponible vigente hasta la hora de corte?
          let vencido = false;
          const limite = Math.min(corte, ahora);
          let vence = disp[0].ms + vig;
          const siguientes = delDia.filter((e) => e.ms > disp[0].ms).map((e) => ({ ms: e.ms, id: e.id }))
            .concat(viajesDia.filter((v) => v.ms > disp[0].ms).map((v) => ({ ms: v.ms, id: "viaje" })))
            .sort((a, b) => a.ms - b.ms);
          for (const s of siguientes) {
            if (vence >= limite) break;
            if (s.ms > vence) { vencido = true; break; }
            if (s.id === "disponible") vence = s.ms + vig;
            else { vence = Infinity; break; } // pasó a viaje/taller/otro estatus antes de vencer
          }
          if (!vencido && vence < limite) vencido = true;
          codigo = vencido ? "vencido" : "disponible";
        }
      }
      const pagaCalc = ["viaje", "taller", "disponible"].includes(codigo);
      const aj = ajustes.get(`${op.uid}_${fecha}`) || null;
      const paga = aj ? aj.pagar === true : pagaCalc;
      return {
        fecha, codigo, paga, pagaCalculado: pagaCalc,
        ajuste: aj ? { pagar: aj.pagar === true, motivo: aj.motivo || "", porNombre: (aj.por && aj.por.nombre) || "", ms: aj.ms || null } : null,
        detalle,
      };
    });
    const totalDias = dias.filter((d) => d.paga).length;
    const pagoSemana = cfg.montoSemana[op.tipoRuta] || 0;
    const monto = Math.round((pagoSemana / 7) * totalDias * 100) / 100;
    return { uid: op.uid, unidad: op.unidad, nombre: op.nombre, activo: op.activo, tipoRuta: op.tipoRuta, pagoSemana, dias, totalDias, monto };
  });
  return {
    semana: viernes, fechas, montoSemana: cfg.montoSemana, horaCorte: cfg.horaCorte, filas,
    totales: { dias: filas.reduce((s, f) => s + f.totalDias, 0), monto: Math.round(filas.reduce((s, f) => s + f.monto, 0) * 100) / 100 },
    calculadoMs: Date.now(),
  };
}

// entrada: { viernes: "YYYY-MM-DD" }
exports.calcularAsistenciaSemana = onCall({ region: REGION, timeoutSeconds: 120 }, async (request) => {
  const actor = await leerActor_(request);
  const viernes = validarInicio_((request.data || {}).viernes);
  try {
    const cfg = await leerConfigAsistencia_();
    const snapSem = await dbLocal.collection(COL_ASIST_SEMANAS).doc(viernes).get();
    const sem = snapSem.exists ? snapSem.data() : null;
    const permisos = {
      revisar: puedeRevisarAsistencia_(actor),
      reabrir: actor.rol === "admin" || cfg.reabrenPuestos.some((p) => p && normPuesto_(actor.puesto) === p),
    };
    if (sem && sem.estado === "autorizada") {
      return { ok: true, ...sem.calculo, estado: "autorizada", autorizadaPor: sem.autorizadaPor || null, autorizadaMs: sem.autorizadaMs || null, correo: sem.correo || null, permisos };
    }
    const calc = await calcularSemana_(viernes, cfg);
    return { ok: true, ...calc, estado: "abierta", reabiertaPor: (sem && sem.reabiertaPor) || null, permisos };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error(`[calcularAsistenciaSemana] ${error.message}`);
    throw new HttpsError("internal", "No se pudo calcular la asistencia: " + error.message);
  }
});

// entrada: { viernes, uid, fecha, pagar: boolean|null, motivo }  (pagar null = quitar el ajuste)
exports.ajustarAsistenciaDia = onCall({ region: REGION }, async (request) => {
  const actor = await leerActor_(request);
  if (!puedeRevisarAsistencia_(actor)) throw new HttpsError("permission-denied", "Solo Coordinador, Supervisor, Auxiliar o admin pueden ajustar la asistencia.");
  const e = request.data || {};
  const viernes = validarInicio_(e.viernes);
  const fecha = typeof e.fecha === "string" && RE_FECHA_ASIST.test(e.fecha) ? e.fecha : "";
  const uid = typeof e.uid === "string" && e.uid && !e.uid.includes("/") ? e.uid : "";
  if (!fecha || !uid || fecha < viernes || fecha > sumarDias_(viernes, 6)) throw new HttpsError("invalid-argument", "Día no válido.");
  const sem = await dbLocal.collection(COL_ASIST_SEMANAS).doc(viernes).get();
  if (sem.exists && sem.data().estado === "autorizada") throw new HttpsError("failed-precondition", "La semana ya está autorizada. Primero hay que reabrirla.");
  const ref = dbLocal.collection(COL_ASIST_AJUSTES).doc(`${viernes}_${uid}_${fecha}`);
  if (e.pagar === null || e.pagar === undefined) {
    await ref.delete();
  } else {
    const motivo = typeof e.motivo === "string" ? e.motivo.trim().slice(0, 300) : "";
    if (!motivo) throw new HttpsError("invalid-argument", "Escribe el motivo del ajuste.");
    await ref.set({ semana: viernes, uid, fecha, pagar: e.pagar === true, motivo, por: { uid: actor.uid, nombre: actor.nombre }, ms: Date.now() });
  }
  await dbLocal.collection(COL_BITACORA).add({ tipo: "asistencia_ajuste", semana: viernes, uid, fecha, pagar: e.pagar ?? null, realizadoPor: actor, timestamp: FieldValue.serverTimestamp() });
  return { ok: true };
});

// entrada: { viernes }
exports.autorizarAsistenciaSemana = onCall({ region: REGION, timeoutSeconds: 120 }, async (request) => {
  const actor = await leerActor_(request);
  if (!puedeRevisarAsistencia_(actor)) throw new HttpsError("permission-denied", "Solo Coordinador, Supervisor, Auxiliar o admin pueden autorizar la semana.");
  const viernes = validarInicio_((request.data || {}).viernes);
  if (msLocal_(sumarDias_(viernes, 7), 0) > Date.now()) throw new HttpsError("failed-precondition", "La semana todavía no termina (cierra el jueves a medianoche).");
  const ref = dbLocal.collection(COL_ASIST_SEMANAS).doc(viernes);
  const prev = await ref.get();
  if (prev.exists && prev.data().estado === "autorizada") throw new HttpsError("failed-precondition", "Esta semana ya estaba autorizada.");
  const cfg = await leerConfigAsistencia_();
  const calculo = await calcularSemana_(viernes, cfg);
  const autorizadaPor = { uid: actor.uid, nombre: actor.nombre, puesto: actor.puesto };
  await ref.set({
    semana: viernes, estado: "autorizada", calculo, autorizadaPor, autorizadaMs: Date.now(),
    historial: FieldValue.arrayUnion({ accion: "autorizada", por: autorizadaPor, ms: Date.now() }),
  }, { merge: true });
  await dbLocal.collection(COL_BITACORA).add({ tipo: "asistencia_autorizada", semana: viernes, totales: calculo.totales, realizadoPor: actor, timestamp: FieldValue.serverTimestamp() });
  return { ok: true, totales: calculo.totales };
});

// entrada: { viernes, motivo }
exports.reabrirAsistenciaSemana = onCall({ region: REGION }, async (request) => {
  const actor = await leerActor_(request);
  const cfg = await leerConfigAsistencia_();
  const puede = actor.rol === "admin" || cfg.reabrenPuestos.some((p) => p && normPuesto_(actor.puesto) === p);
  if (!puede) throw new HttpsError("permission-denied", "No tienes permiso para reabrir semanas autorizadas.");
  const e = request.data || {};
  const viernes = validarInicio_(e.viernes);
  const motivo = typeof e.motivo === "string" ? e.motivo.trim().slice(0, 300) : "";
  if (!motivo) throw new HttpsError("invalid-argument", "Escribe el motivo para reabrir.");
  const ref = dbLocal.collection(COL_ASIST_SEMANAS).doc(viernes);
  const s = await ref.get();
  if (!s.exists || s.data().estado !== "autorizada") throw new HttpsError("failed-precondition", "Esta semana no está autorizada.");
  const por = { uid: actor.uid, nombre: actor.nombre, puesto: actor.puesto };
  await ref.set({
    estado: "abierta", reabiertaPor: { ...por, motivo, ms: Date.now() },
    historial: FieldValue.arrayUnion({ accion: "reabierta", por, motivo, ms: Date.now() }),
  }, { merge: true });
  await dbLocal.collection(COL_BITACORA).add({ tipo: "asistencia_reabierta", semana: viernes, motivo, realizadoPor: actor, timestamp: FieldValue.serverTimestamp() });
  return { ok: true };
});

// ---- Correo automático al autorizar la semana (2026-10-21) --------------------
// Cuando una semana pasa a "autorizada" se manda por Brevo (mismo secreto
// BREVO_API_KEY que enviarResetContrasena) el resumen + el Excel adjunto a
// configuracion/asistencia.destinatarios / cc. Si se reabre y se vuelve a
// autorizar, sale otro correo con los datos nuevos.
const brevoApiKeyAsistencia = defineSecret("BREVO_API_KEY");
const REMITENTE_ASISTENCIA = { name: "Ivan Landa", email: "ilanda@alanis.com.mx" };
const DIAS_LARGOS = ["viernes", "sábado", "domingo", "lunes", "martes", "miércoles", "jueves"];
const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const LARGO_CODIGO = { disponible: "Disponible", viaje: "Aceptó viaje", taller: "En taller", vencido: "Disponible vencido", sin_entrada: "Sin entrada a patio", nada: "No se reportó", futuro: "" };

function fechaLarga_(f) {
  const [y, m, d] = f.split("-").map(Number);
  return `${d} de ${MESES_LARGOS[m - 1]} de ${y}`;
}
function dineroMx_(n) {
  return "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function escHtml_(t) {
  return String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function listaCorreos_(v) {
  return (Array.isArray(v) ? v : String(v || "").split(/[,;\s]+/)).map((x) => String(x).trim()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
}

async function excelAsistencia_(calc, autorizadaPor, autorizadaMs) {
  const ExcelJS = require("exceljs");
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet("Asistencia");
  const dias = ["Vie", "Sáb", "Dom", "Lun", "Mar", "Mié", "Jue"];
  hoja.addRow([`Asistencia ruta corta · semana del ${fechaLarga_(calc.fechas[0])} al ${fechaLarga_(calc.fechas[6])}`]).font = { bold: true, size: 13 };
  hoja.addRow([`Autorizada por ${(autorizadaPor && autorizadaPor.nombre) || ""} · ${new Intl.DateTimeFormat("es-MX", { timeZone: TZ_OPERACION, dateStyle: "short", timeStyle: "short" }).format(new Date(autorizadaMs))}`]);
  hoja.addRow([`Pago semanal: Corta ${dineroMx_(calc.montoSemana.corta)} · Circuito ${dineroMx_(calc.montoSemana.circuito)} (proporcional a los días pagados, ÷ 7)`]);
  hoja.addRow([]);
  const cab = hoja.addRow(["Unidad", "Operador", "Ruta", ...calc.fechas.map((f, i) => `${dias[i]} ${f.slice(8)}/${f.slice(5, 7)}`), "Días pagados", "Pago"]);
  cab.font = { bold: true };
  cab.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDE7DE" } }; });
  calc.filas.forEach((f) => {
    const fila = hoja.addRow([f.unidad, f.nombre, f.tipoRuta === "circuito" ? "Circuito" : "Corta", ...f.dias.map((x) => (x.paga ? "PAGA" : LARGO_CODIGO[x.codigo] || "") + (x.ajuste ? " (ajuste)" : "")), f.totalDias, f.monto]);
    f.dias.forEach((x, i) => {
      const c = fila.getCell(4 + i);
      const color = x.paga ? "FFB9E3A0" : x.codigo === "vencido" ? "FFFBE3A8" : null;
      if (color) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
    });
    fila.getCell(12).numFmt = '"$"#,##0.00';
  });
  const tot = hoja.addRow(["", "TOTAL", "", "", "", "", "", "", "", "", calc.totales.dias, calc.totales.monto]);
  tot.font = { bold: true };
  tot.getCell(12).numFmt = '"$"#,##0.00';
  hoja.columns = [{ width: 9 }, { width: 34 }, { width: 10 }, ...calc.fechas.map(() => ({ width: 15 })), { width: 13 }, { width: 13 }];
  const ajustes = [];
  calc.filas.forEach((f) => f.dias.forEach((x) => { if (x.ajuste) ajustes.push([f.unidad, f.nombre, x.fecha, x.ajuste.pagar ? "Pagar" : "No pagar", x.ajuste.motivo, x.ajuste.porNombre]); }));
  if (ajustes.length) {
    const h2 = libro.addWorksheet("Ajustes");
    h2.addRow(["Unidad", "Operador", "Fecha", "Ajuste", "Motivo", "Ajustó"]).font = { bold: true };
    ajustes.forEach((a) => h2.addRow(a));
    h2.columns = [{ width: 9 }, { width: 34 }, { width: 12 }, { width: 10 }, { width: 50 }, { width: 28 }];
  }
  return Buffer.from(await libro.xlsx.writeBuffer());
}

exports.correoAsistenciaAutorizada = onDocumentWritten(
  { document: `${COL_ASIST_SEMANAS}/{viernes}`, region: REGION, secrets: [brevoApiKeyAsistencia], memory: "512MiB" },
  async (event) => {
    const antes = event.data.before.exists ? event.data.before.data() : null;
    const despues = event.data.after.exists ? event.data.after.data() : null;
    if (!despues || despues.estado !== "autorizada" || (antes && antes.estado === "autorizada")) return;
    const viernes = event.params.viernes;
    const ref = event.data.after.ref;
    try {
      const cfgSnap = await dbLocal.collection("configuracion").doc("asistencia").get();
      const cfg = cfgSnap.exists ? cfgSnap.data() : {};
      const para = listaCorreos_(cfg.destinatarios);
      const cc = listaCorreos_(cfg.cc).filter((x) => !para.includes(x));
      if (!para.length) {
        await ref.set({ correo: { estado: "sin_destinatarios", ms: Date.now() } }, { merge: true });
        logger.warn(`[correoAsistenciaAutorizada] ${viernes}: sin destinatarios configurados`);
        return;
      }
      const calc = despues.calculo;
      const quien = (despues.autorizadaPor && despues.autorizadaPor.nombre) || "";
      const cuando = new Intl.DateTimeFormat("es-MX", { timeZone: TZ_OPERACION, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(despues.autorizadaMs || Date.now()));
      const fIni = calc.fechas[0], fFin = calc.fechas[6];
      const reautorizada = Array.isArray(despues.historial) && despues.historial.some((h) => h && h.accion === "reabierta");
      const asunto = `Asistencia ruta corta · semana del ${fechaLarga_(fIni)} al ${fechaLarga_(fFin)}${reautorizada ? " · actualizada" : ""}`;
      const filasHtml = calc.filas.map((f) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;">${escHtml_(f.unidad)}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;">${escHtml_(f.nombre)}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;">${f.tipoRuta === "circuito" ? "Circuito" : "Corta"}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:center;">${f.totalDias}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">${dineroMx_(f.monto)}</td></tr>`).join("");
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.5;">
<p>Buen día:</p>
<p>Se ${reautorizada ? "volvió a autorizar, con cambios," : "autorizó"} la asistencia semanal de los operadores de ruta corta correspondiente a la semana del ${DIAS_LARGOS[0]} ${fechaLarga_(fIni)} al ${DIAS_LARGOS[6]} ${fechaLarga_(fFin)}.</p>
<p>Resumen:<br>
- Operadores: ${calc.filas.length}<br>
- Días pagados: ${calc.totales.dias}<br>
- Pago semanal: Corta ${dineroMx_(calc.montoSemana.corta)} · Circuito ${dineroMx_(calc.montoSemana.circuito)} (proporcional a los días pagados)<br>
- Total a pagar: <b>${dineroMx_(calc.totales.monto)}</b></p>
<p>Autorizó: ${escHtml_(quien)}, el ${cuando}.</p>
<table style="border-collapse:collapse;font-size:13px;margin:8px 0 14px;"><tr style="background:#EDE7DE;"><th style="padding:5px 8px;text-align:left;">Unidad</th><th style="padding:5px 8px;text-align:left;">Operador</th><th style="padding:5px 8px;text-align:left;">Ruta</th><th style="padding:5px 8px;">Días</th><th style="padding:5px 8px;text-align:right;">Pago</th></tr>${filasHtml}</table>
<p>Se adjunta el detalle por día en Excel.</p>
<p>Quedo a tus órdenes.<br>Un saludo.</p>
<p style="font-size:11px;color:#888;">Mensaje automático de ADREMATASA Interno.</p>
</div>`;
      const excel = await excelAsistencia_(calc, despues.autorizadaPor, despues.autorizadaMs || Date.now());
      const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": brevoApiKeyAsistencia.value(), "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sender: REMITENTE_ASISTENCIA,
          to: para.map((email) => ({ email })),
          ...(cc.length ? { cc: cc.map((email) => ({ email })) } : {}),
          subject: asunto,
          htmlContent: html,
          attachment: [{ name: `Asistencia_ruta_corta_${viernes}.xlsx`, content: excel.toString("base64") }],
        }),
      });
      if (!resp.ok) throw new Error(`Brevo ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
      await ref.set({ correo: { estado: "enviado", ms: Date.now(), para, cc } }, { merge: true });
      logger.info(`[correoAsistenciaAutorizada] ${viernes} enviado a ${para.join(",")}`);
    } catch (error) {
      logger.error(`[correoAsistenciaAutorizada] ${viernes}: ${error.message}`);
      await ref.set({ correo: { estado: "error", ms: Date.now(), detalle: String(error.message).slice(0, 300) } }, { merge: true }).catch(() => {});
    }
  }
);

// ============================================================================
// Tráfico → Asignación (2026-10-27, pedido de Ivan). Reemplaza la asignación de
// admin2.js: crea asignaciones/{id} en Alanis Operadores con los MISMOS campos
// que admin2.js más creadaDesde/asignadoPor. Al crearse, avisoAsignacion (en
// alanis-operadores) le manda el aviso push al operador.
//   - verificarAsignacionOperador({unidad}) → operador activo de esa unidad,
//     OT abierta, avisos activos y otras asignaciones pendientes.
//   - crearAsignacionOperador({unidad, operador_erp, remolque, linea, cliente,
//     destino, cita}) → bloquea si no hay operador activo o si está en taller.
//   - cancelarAsignacionOperador({id, motivo}) → solo admin o Coordinador, y
//     solo si sigue pendiente.
// ============================================================================
const OPCIONES_TRAFICO = ["trafico"];

function textoAsig_(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max || 120) : "";
}

async function operadorDeUnidad_(unidad) {
  const snap = await dbAlanis.collection("usuarios")
    .where("rol", "==", "operador")
    .where("numero", "==", unidad)
    .where("activo", "==", true)
    .limit(2).get();
  if (snap.empty) return null;
  if (snap.size > 1) {
    throw new HttpsError("failed-precondition", `La unidad ${unidad} está en dos operadores activos. Corrígelo en Operadores registrados.`);
  }
  const d = snap.docs[0].data();
  return {
    uid: snap.docs[0].id,
    nombre: d.nombre || "",
    nombreOficial: d.nombreOficial || "",
    numero: d.numero || "",
    tipoRuta: TIPOS_RUTA.includes(d.tipoRuta) ? d.tipoRuta : null,
    lada: d.lada === "1" ? "1" : "52",
    telefono: d.telefono || "",
  };
}

async function otAbiertaDe_(uid) {
  const snap = await dbAlanis.collection("ordenes_trabajo")
    .where("uid", "==", uid).where("estado", "==", "abierta").limit(1).get();
  return snap.empty ? null : { id: snap.docs[0].id, folio: snap.docs[0].data().folio || "" };
}

exports.verificarAsignacionOperador = onCall({ region: REGION }, async (request) => {
  await leerActor_(request, OPCIONES_TRAFICO);
  const unidad = textoAsig_((request.data || {}).unidad, 20);
  if (!unidad) throw new HttpsError("invalid-argument", "Falta la unidad.");
  try {
    const op = await operadorDeUnidad_(unidad);
    if (!op) return { operador: null };
    const [ot, avisos, pend] = await Promise.all([
      otAbiertaDe_(op.uid),
      dbAlanis.collection("avisos_dispositivos").where("uid", "==", op.uid).get(),
      dbAlanis.collection("asignaciones").where("uid_operador", "==", op.uid).where("estado", "==", "pendiente").get(),
    ]);
    return {
      operador: op,
      otAbierta: ot,
      avisos: avisos.size,
      plataformas: [...new Set(avisos.docs.map((d) => d.get("plataforma") || "otro"))],
      pendientes: pend.docs.map((d) => ({
        id: d.id, cliente: d.get("cliente") || "", destino: d.get("destino") || "",
        timestampMs: aMillis_(d.get("timestamp")),
      })),
    };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error(`[verificarAsignacionOperador] ${error.message}`);
    throw new HttpsError("internal", "No se pudo verificar la unidad. Intenta de nuevo.");
  }
});

exports.crearAsignacionOperador = onCall({ region: REGION }, async (request) => {
  const actor = await leerActor_(request, OPCIONES_TRAFICO);
  const e = request.data || {};
  const datos = {
    unidad: textoAsig_(e.unidad, 20),
    operador_erp: textoAsig_(e.operador_erp, 120),
    remolque: textoAsig_(e.remolque, 40),
    linea: textoAsig_(e.linea, 60),
    cliente: textoAsig_(e.cliente, 120),
    destino: textoAsig_(e.destino, 160),
    cita: textoAsig_(e.cita, 40),
  };
  if (!datos.unidad) throw new HttpsError("invalid-argument", "La asignación no tiene unidad.");
  try {
    const op = await operadorDeUnidad_(datos.unidad);
    if (!op) throw new HttpsError("not-found", `No hay operador activo con la unidad ${datos.unidad}.`);
    const ot = await otAbiertaDe_(op.uid);
    if (ot) {
      throw new HttpsError("failed-precondition",
        `${op.nombreOficial || op.nombre} está en taller (OT ${ot.folio || ot.id}). No se puede asignar hasta que terminen su OT.`);
    }
    const ref = dbAlanis.collection("asignaciones").doc();
    await ref.set({
      uid_operador: op.uid,
      operador_nombre: op.nombre,
      unidad: datos.unidad,
      operador_erp: datos.operador_erp,
      remolque: datos.remolque,
      linea: datos.linea,
      cliente: datos.cliente,
      destino: datos.destino,
      cita: datos.cita,
      estado: "pendiente",
      fecha_creacion: fechaHoraLocal_().fecha,
      timestamp: FieldValue.serverTimestamp(),
      creadaDesde: "ADREMATASA",
      asignadoPor: { uid: actor.uid, nombre: actor.nombre || "" },
    });
    const avisos = await dbAlanis.collection("avisos_dispositivos").where("uid", "==", op.uid).get();
    await dbLocal.collection(COL_BITACORA).add({
      tipo: "asignacion_creada",
      asignacionId: ref.id,
      operadorUid: op.uid,
      operadorNombre: op.nombreOficial || op.nombre,
      unidad: datos.unidad,
      cliente: datos.cliente,
      destino: datos.destino,
      realizadoPor: actor,
      timestamp: FieldValue.serverTimestamp(),
    });
    logger.info(`[crearAsignacionOperador] ${ref.id} unidad ${datos.unidad} por ${actor.uid}`);
    return {
      id: ref.id,
      operadorNombre: op.nombreOficial || op.nombre,
      avisos: avisos.size,
      lada: op.lada,
      telefono: op.telefono,
    };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error(`[crearAsignacionOperador] ${error.message}`);
    throw new HttpsError("internal", "No se pudo crear la asignación. Intenta de nuevo.");
  }
});

exports.cancelarAsignacionOperador = onCall({ region: REGION }, async (request) => {
  const actor = await leerActor_(request, OPCIONES_TRAFICO);
  if (!puedeTerminarOT_(actor)) {
    throw new HttpsError("permission-denied", "Solo un Coordinador o un administrador puede cancelar asignaciones.");
  }
  const e = request.data || {};
  const id = textoAsig_(e.id, 60);
  if (!id || id.includes("/")) throw new HttpsError("invalid-argument", "Asignación no válida.");
  const motivo = textoAsig_(e.motivo, 200);
  if (!motivo) throw new HttpsError("invalid-argument", "Escribe el motivo de la cancelación.");
  const ref = dbAlanis.collection("asignaciones").doc(id);
  try {
    const a = await dbAlanis.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError("not-found", "La asignación ya no existe.");
      const d = snap.data();
      if (d.estado !== "pendiente") {
        throw new HttpsError("failed-precondition", `No se puede cancelar: el operador ya la marcó como ${d.estado}.`);
      }
      tx.update(ref, {
        estado: "cancelada",
        canceladaEn: FieldValue.serverTimestamp(),
        canceladaPor: { uid: actor.uid, nombre: actor.nombre || "" },
        motivo_cancelacion: motivo,
      });
      return d;
    });
    await dbLocal.collection(COL_BITACORA).add({
      tipo: "asignacion_cancelada",
      asignacionId: id,
      operadorUid: a.uid_operador || "",
      operadorNombre: a.operador_nombre || "",
      unidad: a.unidad || "",
      motivo,
      realizadoPor: actor,
      timestamp: FieldValue.serverTimestamp(),
    });
    logger.info(`[cancelarAsignacionOperador] ${id} por ${actor.uid}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error(`[cancelarAsignacionOperador] ${error.message}`);
    throw new HttpsError("internal", "No se pudo cancelar la asignación. Intenta de nuevo.");
  }
});