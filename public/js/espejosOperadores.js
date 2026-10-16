import { db } from "./firebase-config.js";
import { collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// ============================================================================
// Espejos en vivo de Alanis Operadores (2026-10-16, pedido de Ivan).
//
// Las Cloud Functions copian a ESTE proyecto (colecciones espejo_op_*) cada
// cambio de Alanis Operadores en 1–2 segundos. Las pantallas de Operadores
// leen de aquí en vivo, sin llamar funciones.
//
// Costo: cada colección se escucha UNA sola vez por sesión, aunque varias
// pantallas la usen (Aceptación, Registrados, selector de la OT, Turnos, el
// punto de alerta). La primera vez se leen sus documentos; después solo se
// cobra lo que cambia. Las escuchas se cierran al cerrar sesión
// (detenerEspejos, lo llama detenerAlertasOperadores en operadores.js).
// ============================================================================

const COL = {
  solicitudes: "espejo_op_solicitudes",
  operadores: "espejo_op_operadores",
  asignaciones: "espejo_op_asignaciones",
  estatus: "espejo_op_estatus",
};
// Turnos solo necesita los viajes recientes (la fila se reinicia con cada entrada a patio).
const DIAS_ASIGNACIONES = 30;

const fuentes = {}; // nombre -> { lista, oyentes:Set, cancelar }

function consulta(nombre) {
  const ref = collection(db, COL[nombre]);
  if (nombre === "asignaciones") {
    return query(ref, where("timestampMs", ">=", Date.now() - DIAS_ASIGNACIONES * 24 * 60 * 60 * 1000));
  }
  return ref;
}

// alCambiar(lista) se llama con TODOS los documentos cada vez que algo cambia.
// Cada documento trae sus campos + _id (el id del documento). Regresa la
// función para dejar de escuchar (la escucha compartida sigue viva).
export function suscribirEspejo(nombre, alCambiar, alError) {
  if (!COL[nombre]) throw new Error("Espejo desconocido: " + nombre);
  let f = fuentes[nombre];
  if (!f) {
    f = fuentes[nombre] = { lista: null, oyentes: new Set(), cancelar: null };
    f.cancelar = onSnapshot(consulta(nombre), (snap) => {
      f.lista = snap.docs.map(d => ({ ...d.data(), _id: d.id }));
      f.oyentes.forEach(o => o.alCambiar(f.lista));
    }, (err) => {
      console.warn(`Espejo ${nombre}:`, err.message);
      if (fuentes[nombre] === f) delete fuentes[nombre]; // la próxima suscripción reintenta
      f.oyentes.forEach(o => o.alError && o.alError(err));
    });
  }
  const oyente = { alCambiar, alError };
  f.oyentes.add(oyente);
  if (f.lista) { const lista = f.lista; queueMicrotask(() => { if (f.oyentes.has(oyente)) alCambiar(lista); }); }
  return () => f.oyentes.delete(oyente);
}

// Para quien solo necesita los datos una vez (ej. selector de la OT).
export function leerEspejo(nombre) {
  return new Promise((resolve, reject) => {
    let cancelar = null;
    let listo = false;
    cancelar = suscribirEspejo(nombre, (lista) => {
      if (listo) return;
      listo = true;
      resolve(lista);
      queueMicrotask(() => cancelar && cancelar());
    }, (err) => { if (!listo) { listo = true; reject(err); } });
  });
}

// Deja de escuchar cuando la pantalla ya no está en la página.
export function alSalirDePantalla(contenedor, cancelar) {
  const raiz = contenedor.firstElementChild || contenedor;
  const reloj = setInterval(() => {
    if (!raiz.isConnected) { clearInterval(reloj); cancelar(); }
  }, 3000);
}

export function detenerEspejos() {
  Object.keys(fuentes).forEach(k => {
    try { fuentes[k].cancelar && fuentes[k].cancelar(); } catch (_) { /* ya cerrada */ }
    delete fuentes[k];
  });
}