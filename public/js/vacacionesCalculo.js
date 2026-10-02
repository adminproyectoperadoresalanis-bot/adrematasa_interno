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

// Catálogo de días festivos oficiales conforme al artículo 74 de la Ley
// Federal del Trabajo (1 oct 2026: nuevo, para que un festivo oficial no se
// cobre del saldo de vacaciones y el "retorno a labores" no caiga en uno).
// "fecha" en formato YYYY-MM-DD. Incluye los fijos y los "lunes
// conmemorativos" móviles (primer lunes de febrero, tercer lunes de marzo,
// tercer lunes de noviembre) ya calculados para 2026 y 2027 — editable desde
// Configuración para poder ajustar año con año (fechas móviles, jornadas
// electorales u otros festivos irregulares que decida Alanis reconocer). No
// incluye el 1° de diciembre de transmisión del Poder Ejecutivo (cada 6
// años; el próximo es 2030) porque no aplica en este rango.
export const FESTIVOS_DEFAULT = [
  { fecha: "2026-01-01", nombre: "Año nuevo" },
  { fecha: "2026-02-02", nombre: "Aniversario de la Constitución (lunes conmemorativo)" },
  { fecha: "2026-03-16", nombre: "Natalicio de Benito Juárez (lunes conmemorativo)" },
  { fecha: "2026-05-01", nombre: "Día del Trabajo" },
  { fecha: "2026-09-16", nombre: "Día de la Independencia" },
  { fecha: "2026-11-16", nombre: "Día de la Revolución (lunes conmemorativo)" },
  { fecha: "2026-12-25", nombre: "Navidad" },
  { fecha: "2027-01-01", nombre: "Año nuevo" },
  { fecha: "2027-02-01", nombre: "Aniversario de la Constitución (lunes conmemorativo)" },
  { fecha: "2027-03-15", nombre: "Natalicio de Benito Juárez (lunes conmemorativo)" },
  { fecha: "2027-05-01", nombre: "Día del Trabajo" },
  { fecha: "2027-09-16", nombre: "Día de la Independencia" },
  { fecha: "2027-11-15", nombre: "Día de la Revolución (lunes conmemorativo)" },
  { fecha: "2027-12-25", nombre: "Navidad" }
];

// Se suscribe en vivo al catálogo de festivos guardado en Configuración. Si
// todavía no existe (primera vez que se usa la app), entrega el catálogo
// oficial por default sin necesidad de que un admin lo capture primero.
export function suscribirFestivos(callback) {
  return onSnapshot(doc(db, "configuracion", "diasFestivos"), (snap) => {
    const datos = snap.exists() ? snap.data().festivos : null;
    callback(Array.isArray(datos) && datos.length > 0 ? datos : FESTIVOS_DEFAULT);
  });
}

// true si fechaStr ("YYYY-MM-DD") está en el catálogo de festivos.
export function esFestivo(fechaStr, festivos) {
  return (festivos || []).some(f => f.fecha === fechaStr);
}