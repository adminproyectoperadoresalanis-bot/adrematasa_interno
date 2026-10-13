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