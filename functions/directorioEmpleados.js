// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/functions/directorioEmpleados.js
// ##########################################################################
// Directorio de empleados (2026-11-20, motivo "Cubrir falta de").
// Un empleado no puede leer los perfiles de sus compañeros (reglas de
// usuarios), así que esta función mantiene una lista corta y pública en
// configuracion/directorioEmpleados:
//   { lista: [{ uid, nombre, area, puesto }], actualizadoEn }
// Solo empleados activos y solo esos 4 datos (sin correo, teléfono, etc.).
// Se reconstruye cada vez que cambia cualquier documento de usuarios, y solo
// escribe si la lista de verdad cambió. Configuración › RH › Actividades por
// puesto también la refresca al abrirse (sirve como carga inicial).

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const REGION = "us-central1";

exports.actualizarDirectorioEmpleados = onDocumentWritten({ document: "usuarios/{uid}", region: REGION }, async () => {
  const db = getFirestore();
  const snap = await db.collection("usuarios").where("estatus", "==", "activo").get();
  const lista = snap.docs.map((d) => {
    const u = d.data() || {};
    return { uid: d.id, nombre: String(u.nombre || ""), area: String(u.area || ""), puesto: String(u.puesto || "") };
  }).filter((x) => x.nombre).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  const ref = db.collection("configuracion").doc("directorioEmpleados");
  const actual = await ref.get();
  const antes = actual.exists && Array.isArray(actual.data().lista) ? actual.data().lista : null;
  if (antes && JSON.stringify(antes) === JSON.stringify(lista)) return;
  await ref.set({ lista, actualizadoEn: new Date().toISOString() });
  logger.info("actualizarDirectorioEmpleados: actualizado", { empleados: lista.length });
});