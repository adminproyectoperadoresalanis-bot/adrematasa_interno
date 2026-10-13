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
// Fuera a propósito: aprobar como admin (solo superadmin, allá), crear/editar
// OT (requiere el catálogo de fallas de data.js — pendiente).
//
// Quién puede usarlas: usuario activo de ADREMATASA y (admin, o su área tiene
// "Operadores" marcada en configuracion/accesosUtilidades). Es el mismo
// criterio que la tabla de Configuración, pero aplicado aquí en el servidor.
// ============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const REGION = "us-central1";
const dbLocal = getFirestore();                 // appadrematasainterno
const dbAlanis = getFirestore(getApp("alanis")); // alanis-operadores (inicializada en index.js)

const ID_OPCION = "operadores";
const COL_BITACORA = "bitacora_acciones_operadores"; // en appadrematasainterno

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
        nombre, correo, numero, nombreOficial,
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
          operador: o.operador || "",
          unidad: o.unidad || "",
          fecha: o.fecha || "",
          hora: o.hora || "",
          estado: o.estado || null,
          fallas: (o.fallas || []).map((f) => ({ name: f.name || "", sev: f.sev || "" })),
        };
      })
      .filter((o) => o.fecha >= desde && o.fecha <= hasta);
    return { ok: true, ordenes };
  } catch (error) {
    logger.error(`[listarOrdenesTrabajo] ${error.message}`);
    throw new HttpsError("internal", "No se pudieron cargar las órdenes de trabajo.");
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
      antes: { numero: unidadAnterior, nombreOficial: d.nombreOficial || "", lada: d.lada || null, telefono: d.telefono || null },
      despues: { numero, nombreOficial, lada: telefono !== "" ? lada : (d.lada || null), telefono: telefono !== "" ? telefono : (d.telefono || null) },
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