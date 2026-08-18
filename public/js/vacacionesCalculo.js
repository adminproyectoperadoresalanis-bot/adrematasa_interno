import { db } from "./firebase-config.js";
import {
  doc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// Tabla oficial vigente de la Ley Federal del Trabajo (Art. 76, reforma de
// "vacaciones dignas" 2023). "desde" = años cumplidos de antigüedad a partir
// de los cuales aplica ese número de días. Editable desde Configuración.
export const UMBRALES_DEFAULT = [
  { desde: 1, dias: 12 },
  { desde: 2, dias: 14 },
  { desde: 3, dias: 16 },
  { desde: 4, dias: 18 },
  { desde: 5, dias: 20 },
  { desde: 6, dias: 22 },
  { desde: 11, dias: 24 },
  { desde: 16, dias: 26 },
  { desde: 21, dias: 28 },
  { desde: 26, dias: 30 }
];

// Años completos de antigüedad cumplidos a la fecha (o a "hoy" si no se indica).
export function calcularAniosAntiguedad(fechaIngresoStr, hoy = new Date()) {
  if (!fechaIngresoStr) return null;
  const ingreso = new Date(fechaIngresoStr + "T00:00:00");
  if (isNaN(ingreso.getTime())) return null;

  let anios = hoy.getFullYear() - ingreso.getFullYear();
  const aniversarioEsteAnio = new Date(hoy.getFullYear(), ingreso.getMonth(), ingreso.getDate());
  if (hoy < aniversarioEsteAnio) anios--;

  return Math.max(0, anios);
}

// Días de vacaciones que corresponden según la antigüedad, usando el bloque
// más alto ya cumplido dentro de los umbrales configurados.
export function diasSegunAntiguedad(anios, umbrales) {
  if (anios === null || anios === undefined) return 0;
  const ordenados = [...(umbrales || [])].sort((a, b) => a.desde - b.desde);
  let dias = 0;
  for (const u of ordenados) {
    if (anios >= u.desde) dias = u.dias;
  }
  return dias;
}

// Se suscribe en vivo a la tabla de umbrales guardada en Configuración.
// Si todavía no existe (primera vez que se usa la app), entrega la tabla
// oficial por default sin necesidad de que un admin la capture primero.
export function suscribirUmbrales(callback) {
  return onSnapshot(doc(db, "configuracion", "vacaciones"), (snap) => {
    const datos = snap.exists() ? snap.data().umbrales : null;
    callback(Array.isArray(datos) && datos.length > 0 ? datos : UMBRALES_DEFAULT);
  });
}