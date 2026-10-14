import { db } from "./firebase-config.js";
import {
  collection, onSnapshot, query, where
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { marcarAlerta } from "./navegacion.js";

// Puntos de alerta en RH (2026-10-14, pedido de Ivan): se encienden cuando
// hay algo por revisar en Horas extra, Vacaciones o Faltas. Usan EXACTAMENTE
// el mismo criterio que las tablas de "pendientes" de cada pantalla
// (aprobaciones.js, aprobacionesVacaciones.js, faltas.js), para que el punto
// y la tabla siempre coincidan:
//
//   Admin
//     Horas extra → solicitudes "pendiente" + ajustes pendientes
//                   (ajusteSolicitud.estatus == "pendiente" en una ya resuelta)
//     Vacaciones  → solicitudes "pendiente" + recortes pendientes + ajustes
//                   pendientes (sobre una vacación ya aprobada)
//     Faltas      → faltas capturadas por un supervisor sin confirmar
//   Supervisor (solo su equipo, igual que sus pantallas)
//     Horas extra → solicitudes "pendiente" de su equipo
//     Vacaciones  → solicitudes "pendiente" de su equipo
//   Empleado → nada (no revisa a nadie).
//
// Extras (autorizacionesExtra) no lleva punto: las captura el propio admin y
// salen solas en el correo del jueves, no hay nada que alguien más le mande
// a revisar.
//
// Las consultas ya vienen filtradas desde Firestore (solo trae pendientes, no
// toda la colección), así que el costo de lecturas es mínimo.

let cancelaciones = [];

export function detenerAlertasRH() {
  cancelaciones.forEach(cancelar => cancelar());
  cancelaciones = [];
  ["solicitudes", "vacaciones", "faltas"].forEach(id => marcarAlerta(id, false));
}

export function iniciarAlertasRH(rol, uid) {
  detenerAlertasRH();
  if (rol !== "admin" && rol !== "supervisor") return;
  const esAdmin = rol === "admin";

  // Cada fuente guarda su propio conteo; la opción se enciende si alguna de
  // sus fuentes tiene al menos uno.
  const conteos = { solicitudes: {}, vacaciones: {}, faltas: {} };

  function vigilar(idItem, nombreFuente, consulta, filtro = () => true) {
    const cancelar = onSnapshot(consulta, (snap) => {
      conteos[idItem][nombreFuente] = snap.docs.filter(d => filtro(d.data())).length;
      marcarAlerta(idItem, Object.values(conteos[idItem]).some(n => n > 0));
    }, (err) => {
      console.warn(`Alertas RH (${idItem}/${nombreFuente}):`, err.message);
    });
    cancelaciones.push(cancelar);
  }

  const solicitudes = collection(db, "solicitudes");
  const vacaciones = collection(db, "solicitudesVacaciones");

  if (esAdmin) {
    vigilar("solicitudes", "pendientes", query(solicitudes, where("estatus", "==", "pendiente")));
    vigilar("solicitudes", "ajustes",
      query(solicitudes, where("ajusteSolicitud.estatus", "==", "pendiente")),
      s => s.estatus !== "pendiente");

    vigilar("vacaciones", "pendientes", query(vacaciones, where("estatus", "==", "pendiente")));
    vigilar("vacaciones", "recortes",
      query(vacaciones, where("recorteSolicitud.estatus", "==", "pendiente")),
      s => s.estatus === "aprobada");
    vigilar("vacaciones", "ajustes",
      query(vacaciones, where("ajusteSolicitud.estatus", "==", "pendiente")),
      s => s.estatus === "aprobada");

    vigilar("faltas", "pendientes", query(collection(db, "faltas"), where("estatus", "==", "pendiente")));
  } else {
    vigilar("solicitudes", "pendientes",
      query(solicitudes, where("supervisorId", "==", uid), where("estatus", "==", "pendiente")));
    vigilar("vacaciones", "pendientes",
      query(vacaciones, where("supervisorId", "==", uid), where("estatus", "==", "pendiente")));
  }
}