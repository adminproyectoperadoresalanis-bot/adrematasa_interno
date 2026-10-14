import { db } from "./firebase-config.js";
import {
  collection, onSnapshot, query, where, documentId
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { marcarAlerta } from "./navegacion.js";

// Punto de alerta en "Validación de QR" (2026-10-14, pedido de Ivan). Cada
// quien ve encendido el punto solo por el paso que LE TOCA hacer, con el
// mismo criterio exacto que las tablas de escaneoOrigen.js:
//
//   Atención al Cliente (y admin) → "pendientes de primera validación":
//     embarques en embarques_pendientes_origen que todavía no tienen
//     origenEscaneo en verificaciones_cfdi_local, más los que McCain
//     corrigió después de validarse (correccionPostValidacion).
//   Operaciones MEX — Coordinador/Supervisor/Auxiliar/Despachador (y admin)
//     → "pendientes de segunda validación": origenEscaneo sin validacion2.
//   Admin → solicitudes de enlace de respaldo del Checkpoint 1/2 esperando
//     su autorización (estado "solicitada").
//
// Mismas constantes que escaneoOrigen.js (área/puesto exactos de
// usuarios/{uid}, no el rol).
const AREA_ATENCION_CLIENTE = "Atención al cliente";
const AREA_OPERACIONES = "Operaciones MEX";
const PUESTOS_VALIDADOR2 = ["Coordinador", "Supervisor", "Auxiliar", "Despachador"];

let cancelaciones = [];
let cancelacionesEscaneados = [];

function cancelarEscaneados() {
  cancelacionesEscaneados.forEach(c => c());
  cancelacionesEscaneados = [];
}

export function detenerAlertasQR() {
  cancelaciones.forEach(c => c());
  cancelaciones = [];
  cancelarEscaneados();
  marcarAlerta("validacionQR", false);
}

export function iniciarAlertasQR(datosUsuario) {
  detenerAlertasQR();
  const esAdmin = datosUsuario.rol === "admin";
  const puedeValidar1 = esAdmin || datosUsuario.area === AREA_ATENCION_CLIENTE;
  const puedeValidar2 = esAdmin || (
    datosUsuario.area === AREA_OPERACIONES && PUESTOS_VALIDADOR2.includes(datosUsuario.puesto)
  );
  if (!puedeValidar1 && !puedeValidar2) return;

  const conteos = {};
  const actualizar = () => marcarAlerta("validacionQR", Object.values(conteos).some(n => n > 0));
  const avisarError = (fuente) => (err) => console.warn(`Alertas QR (${fuente}):`, err.message);
  const verificaciones = collection(db, "verificaciones_cfdi_local");

  // 2da validación: solo trae los que siguen esperando (estadoSync), no
  // todo el historial; el filtro de abajo es el mismo de la tabla.
  if (puedeValidar2) {
    cancelaciones.push(onSnapshot(
      query(verificaciones, where("estadoSync", "==", "esperando_validacion2")),
      (snap) => {
        conteos.validacion2 = snap.docs.filter(d => {
          const f = d.data();
          return f.origenEscaneo && !f.validacion2;
        }).length;
        actualizar();
      },
      avisarError("2da validación")
    ));
  }

  // 1ra validación: la cola de pendientes es chica, así que solo se revisa
  // en verificaciones_cfdi_local si ESOS embarques ya se escanearon (en
  // grupos de 30, el máximo que permite Firestore por consulta "in").
  if (puedeValidar1) {
    cancelaciones.push(onSnapshot(collection(db, "embarques_pendientes_origen"), (snap) => {
      const pendientes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const conCorreccion = pendientes.filter(p => p.correccionPostValidacion).length;
      const ids = pendientes.filter(p => !p.correccionPostValidacion).map(p => p.id);

      cancelarEscaneados();
      if (ids.length === 0) {
        conteos.validacion1 = conCorreccion;
        actualizar();
        return;
      }
      const escaneadosPorGrupo = {};
      for (let i = 0; i < ids.length; i += 30) {
        const grupo = ids.slice(i, i + 30);
        cancelacionesEscaneados.push(onSnapshot(
          query(verificaciones, where(documentId(), "in", grupo)),
          (s) => {
            escaneadosPorGrupo[i] = s.docs.filter(d => d.data().origenEscaneo).length;
            const escaneados = Object.values(escaneadosPorGrupo).reduce((a, n) => a + n, 0);
            conteos.validacion1 = conCorreccion + Math.max(0, ids.length - escaneados);
            actualizar();
          },
          avisarError("1ra validación")
        ));
      }
    }, avisarError("pendientes de origen")));
  }

  if (esAdmin) {
    cancelaciones.push(onSnapshot(
      query(collection(db, "solicitudes_enlace_checkpoint"), where("estado", "==", "solicitada")),
      (snap) => {
        conteos.enlaces = snap.size;
        actualizar();
      },
      avisarError("solicitudes de enlace")
    ));
  }
}