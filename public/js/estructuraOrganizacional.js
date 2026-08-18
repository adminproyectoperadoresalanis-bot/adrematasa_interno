import { db } from "./firebase-config.js";
import {
  doc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// Catálogo inicial de áreas y puestos de Alanis (para Catálogo de empleados y,
// más adelante, el organigrama automático). Editable desde Configuración;
// esto es solo lo que se usa mientras nadie lo ha personalizado todavía.
// La jerarquía real del organigrama la sigue dando "Supervisor asignado"
// (supervisorId) — Área y Puesto son solo etiquetas descriptivas.
export const AREAS_DEFAULT = [
  {
    nombre: "Operaciones",
    puestos: [
      "Coordinador de operaciones MX",
      "Supervisor de turno",
      "Auxiliar de operaciones",
      "Despachador",
      "Coordinador de operaciones EUA",
      "Coordinador de operadores"
    ]
  },
  {
    nombre: "Atención al cliente",
    puestos: ["Atención al cliente MX", "Atención al cliente EUA"]
  },
  {
    nombre: "Control vehicular",
    puestos: []
  }
];

// Los puestos de "Coordinador..." casi siempre necesitan aprobar solicitudes
// de su equipo, así que el modal de edición usa esto para sugerir el rol
// "supervisor" en cuanto se elige uno de estos puestos.
export function esPuestoDeCoordinacion(puesto) {
  return /^coordinador/i.test((puesto || "").trim());
}

export function suscribirEstructura(callback) {
  return onSnapshot(doc(db, "configuracion", "estructura"), (snap) => {
    const datos = snap.exists() ? snap.data().areas : null;
    callback(Array.isArray(datos) && datos.length > 0 ? datos : AREAS_DEFAULT);
  });
}