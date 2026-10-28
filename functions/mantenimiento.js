// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/functions/mantenimiento.js
// ##########################################################################
// Utilidades → Mantenimiento (2026-10-28, pedido de Ivan).
// crearSolicitudMantenimiento (callable): toma el folio consecutivo
// OT-IMPO-00001-26 (5 dígitos + año a 2 dígitos; se reinicia cada año) en una
// transacción con contadores/mantenimiento_impo_<año> y crea
// mantenimiento_solicitudes/{folio}. El navegador no puede crear solicitudes
// directo (así nadie repite ni se salta un folio).
// Quién: usuario activo de ADREMATASA y (admin, o su área tiene "mantenimiento"
// en configuracion/accesosUtilidades).

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const REGION = "us-central1";
const ID_OPCION = "mantenimiento";
const COL = "mantenimiento_solicitudes";
const TZ = "America/Matamoros";
const UBICACIONES = ["bodega", "lugar", "otro"];

function txt(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max || 200) : "";
}

function ahoraLocal() {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const v = (t) => (partes.find((p) => p.type === t) || {}).value || "";
  const hora = v("hour") === "24" ? "00" : v("hour");
  return { anio: v("year"), fecha: `${v("year")}-${v("month")}-${v("day")}`, hora: `${hora}:${v("minute")}`,
    texto: `${v("day")}/${v("month")}/${v("year")} ${hora}:${v("minute")}` };
}

async function leerActor(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const db = getFirestore();
  const snap = await db.collection("usuarios").doc(request.auth.uid).get();
  const u = snap.exists ? snap.data() : null;
  if (!u || u.estatus !== "activo" || !["admin", "supervisor", "empleado"].includes(u.rol)) {
    throw new HttpsError("permission-denied", "Tu cuenta no está activa.");
  }
  if (u.rol !== "admin") {
    const acc = await db.collection("configuracion").doc("accesosUtilidades").get();
    if (acc.exists) {
      const lista = (acc.data().porArea || {})[u.area || ""];
      if (!Array.isArray(lista) || !lista.includes(ID_OPCION)) {
        throw new HttpsError("permission-denied", "Tu área no tiene acceso a Mantenimiento.");
      }
    }
  }
  return { uid: request.auth.uid, nombre: u.nombre || "", area: u.area || "", puesto: u.puesto || "" };
}

exports.crearSolicitudMantenimiento = onCall({ region: REGION }, async (request) => {
  const actor = await leerActor(request);
  const e = request.data || {};
  const r = e.remolque || {};
  const remolque = {
    id: txt(r.id, 30), marca: txt(r.marca, 60), modelo: txt(String(r.modelo || ""), 10),
    placas: txt(r.placas, 20), serie: txt(r.serie, 40),
  };
  if (!remolque.id) throw new HttpsError("invalid-argument", "Elige el remolque.");
  const u = e.ubicacion || {};
  const lat = Number(u.lat), lng = Number(u.lng);
  const ubicacion = {
    tipo: UBICACIONES.includes(u.tipo) ? u.tipo : "otro",
    lugarId: txt(u.lugarId, 60),
    nombre: txt(u.nombre, 120),
    lat: isFinite(lat) && Math.abs(lat) <= 90 && u.lat !== null && u.lat !== "" ? lat : null,
    lng: isFinite(lng) && Math.abs(lng) <= 180 && u.lng !== null && u.lng !== "" ? lng : null,
    liga: txt(u.liga, 500),
    detalle: txt(u.detalle, 300),
  };
  if (!ubicacion.nombre) throw new HttpsError("invalid-argument", "Indica dónde está el remolque.");
  const fallas = (Array.isArray(e.fallas) ? e.fallas : []).map((f) => txt(f, 60)).filter(Boolean).slice(0, 12);
  const descripcion = txt(e.descripcion, 1000);
  if (!fallas.length && !descripcion) throw new HttpsError("invalid-argument", "Indica la falla que presenta.");

  const db = getFirestore();
  const ahora = ahoraLocal();
  const anio2 = ahora.anio.slice(-2);
  const refContador = db.collection("contadores").doc(`mantenimiento_impo_${ahora.anio}`);
  try {
    const folio = await db.runTransaction(async (tx) => {
      const c = await tx.get(refContador);
      const n = (c.exists ? Number(c.data().ultimo) || 0 : 0) + 1;
      const folio = `OT-IMPO-${String(n).padStart(5, "0")}-${anio2}`;
      tx.set(refContador, { ultimo: n, actualizadoEn: FieldValue.serverTimestamp() }, { merge: true });
      tx.create(db.collection(COL).doc(folio), {
        folio, consecutivo: n, anio: Number(ahora.anio),
        remolque, ubicacion, fallas, descripcion,
        estado: "abierta",
        solicitadoPor: { uid: actor.uid, nombre: actor.nombre, area: actor.area, puesto: actor.puesto },
        fecha: ahora.fecha, hora: ahora.hora, fechaTexto: ahora.texto,
        ms: Date.now(),
        creadoEn: FieldValue.serverTimestamp(),
      });
      return folio;
    });
    logger.info(`[crearSolicitudMantenimiento] ${folio} remolque ${remolque.id} por ${actor.uid}`);
    return { folio, fechaTexto: ahora.texto, solicitadoPor: actor.nombre };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error(`[crearSolicitudMantenimiento] ${error.message}`);
    throw new HttpsError("internal", "No se pudo crear la solicitud. Intenta de nuevo.");
  }
});