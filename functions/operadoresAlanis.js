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
// ============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
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
const TIPOS_RUTA = ["larga", "corta", "local"];
function leerTipoRuta_(valor, obligatorio) {
  const v = typeof valor === "string" ? valor.trim().toLowerCase() : "";
  if (TIPOS_RUTA.includes(v)) return v;
  if (obligatorio || v !== "") throw new HttpsError("invalid-argument", "Elige el tipo de ruta: Larga, Corta o Local.");
  return null;
}

// ---- Permisos ---------------------------------------------------------------
async function leerActor_(request) {
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
      if (!Array.isArray(lista) || !lista.includes(ID_OPCION)) {
        throw new HttpsError("permission-denied", "Tu área no tiene acceso a Operadores.");
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

// entrada: { uids: [uid...], tipoRuta: "larga" | "corta" | "local" }
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
    logger.info(`[copiarEntradasPatio] ${porUnidad.size} unidades`);
  } catch (error) {
    logger.error(`[copiarEntradasPatio] ${error.message}`);
    throw error;
  }
});