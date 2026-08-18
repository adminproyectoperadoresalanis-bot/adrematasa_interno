import { db } from "./firebase-config.js";
import {
  collection, onSnapshot, doc, updateDoc, query, where, runTransaction
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const ETIQUETAS_ESTATUS = {
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  rechazada: "Rechazada"
};

function construirVista(contenedor, uidRevisor, nombreRevisor, queryBase) {
  contenedor.innerHTML = `
    <section class="panel">
      <h2>Vacaciones pendientes</h2>
      <div id="vac-error" class="error"></div>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-vac-pendientes">
          <thead>
            <tr><th>Empleado</th><th>Inicio</th><th>Fin</th><th>Días</th><th>Motivo</th><th>Comentario</th><th>Acción</th></tr>
          </thead>
          <tbody id="tbody-vac-pendientes"><tr><td colspan="7">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>

    <section class="panel" style="margin-top:20px;">
      <h2>Historial de vacaciones</h2>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-vac-historial">
          <thead>
            <tr><th>Empleado</th><th>Inicio</th><th>Fin</th><th>Días</th><th>Motivo</th><th>Estatus</th><th>Comentario</th><th>Autorizó</th></tr>
          </thead>
          <tbody id="tbody-vac-historial"><tr><td colspan="8">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>
  `;

  const errorDiv = contenedor.querySelector("#vac-error");
  const tbodyPendientes = contenedor.querySelector("#tbody-vac-pendientes");
  const tbodyHistorial = contenedor.querySelector("#tbody-vac-historial");

  onSnapshot(queryBase, (snap) => {
    const todas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    todas.sort((a, b) => (b.fechaInicio || "").localeCompare(a.fechaInicio || ""));

    const pendientes = todas.filter(s => s.estatus === "pendiente");
    const historial = todas.filter(s => s.estatus !== "pendiente");

    renderPendientes(pendientes);
    renderHistorial(historial);
  }, (err) => {
    errorDiv.textContent = "No se pudieron cargar las solicitudes de vacaciones: " + err.message;
  });

  function renderPendientes(lista) {
    if (lista.length === 0) {
      tbodyPendientes.innerHTML = `<tr><td colspan="7">No hay solicitudes de vacaciones pendientes.</td></tr>`;
      return;
    }
    tbodyPendientes.innerHTML = lista.map(s => `
      <tr data-id="${s.id}" data-empleado-id="${s.empleadoId}" data-dias="${s.diasHabiles}">
        <td>${escapeHtml(s.empleadoNombre || "")}</td>
        <td>${s.fechaInicio}</td>
        <td>${s.fechaFin}</td>
        <td>${s.diasHabiles}</td>
        <td>${s.motivo ? escapeHtml(s.motivo) : "—"}</td>
        <td><input type="text" class="input-comentario" placeholder="Comentario (opcional)"></td>
        <td class="acciones">
          <button type="button" class="btn-aprobar">Aprobar</button>
          <button type="button" class="btn-rechazar">Rechazar</button>
        </td>
      </tr>
    `).join("");

    tbodyPendientes.querySelectorAll("tr[data-id]").forEach(fila => {
      const id = fila.dataset.id;
      const empleadoId = fila.dataset.empleadoId;
      const diasHabiles = Number(fila.dataset.dias);
      const comentarioInput = fila.querySelector(".input-comentario");
      fila.querySelector(".btn-aprobar").addEventListener("click", () => {
        resolverSolicitud(id, "aprobada", comentarioInput.value.trim(), empleadoId, diasHabiles);
      });
      fila.querySelector(".btn-rechazar").addEventListener("click", () => {
        resolverSolicitud(id, "rechazada", comentarioInput.value.trim(), empleadoId, diasHabiles);
      });
    });
  }

  function renderHistorial(lista) {
    if (lista.length === 0) {
      tbodyHistorial.innerHTML = `<tr><td colspan="8">Todavía no hay historial.</td></tr>`;
      return;
    }
    tbodyHistorial.innerHTML = lista.map(s => `
      <tr>
        <td>${escapeHtml(s.empleadoNombre || "")}</td>
        <td>${s.fechaInicio}</td>
        <td>${s.fechaFin}</td>
        <td>${s.diasHabiles}</td>
        <td>${s.motivo ? escapeHtml(s.motivo) : "—"}</td>
        <td><span class="badge badge-${s.estatus}">${ETIQUETAS_ESTATUS[s.estatus] || s.estatus}</span></td>
        <td>${s.comentarioRevisor ? escapeHtml(s.comentarioRevisor) : "—"}</td>
        <td>${s.revisadoPorNombre ? escapeHtml(s.revisadoPorNombre) : "—"}</td>
      </tr>
    `).join("");
  }

  async function resolverSolicitud(id, estatus, comentario, empleadoId, diasHabiles) {
    errorDiv.textContent = "";
    try {
      if (estatus === "aprobada") {
        // Transacción: aprueba la solicitud Y descuenta el saldo del empleado en un solo paso atómico.
        // Si por alguna razón ya no le alcanza el saldo (dos solicitudes aprobadas casi al mismo tiempo), se cancela con un mensaje claro.
        await runTransaction(db, async (tx) => {
          const refSolicitud = doc(db, "solicitudesVacaciones", id);
          const refEmpleado = doc(db, "usuarios", empleadoId);
          const snapSolicitud = await tx.get(refSolicitud);
          const snapEmpleado = await tx.get(refEmpleado);

          if (!snapSolicitud.exists()) {
            throw new Error("La solicitud ya no existe.");
          }
          if (snapSolicitud.data().estatus !== "pendiente") {
            throw new Error("Esta solicitud ya fue resuelta por alguien más.");
          }

          const saldoActual = (snapEmpleado.data() || {}).diasVacacionesDisponibles || 0;
          if (diasHabiles > saldoActual) {
            throw new Error(`El empleado solo tiene ${saldoActual} día(s) disponible(s) y la solicitud es de ${diasHabiles}. Recházala o ajusta su saldo primero.`);
          }

          tx.update(refSolicitud, {
            estatus,
            comentarioRevisor: comentario || null,
            revisadoPor: uidRevisor,
            revisadoPorNombre: nombreRevisor || null,
            resueltoEn: new Date().toISOString()
          });
          tx.update(refEmpleado, {
            diasVacacionesDisponibles: saldoActual - diasHabiles
          });
        });
      } else {
        await updateDoc(doc(db, "solicitudesVacaciones", id), {
          estatus,
          comentarioRevisor: comentario || null,
          revisadoPor: uidRevisor,
          revisadoPorNombre: nombreRevisor || null,
          resueltoEn: new Date().toISOString()
        });
      }
    } catch (err) {
      errorDiv.textContent = "No se pudo actualizar la solicitud: " + err.message;
    }
  }
}

export function iniciarGestionVacaciones(contenedor, uid, nombre) {
  construirVista(contenedor, uid, nombre, collection(db, "solicitudesVacaciones"));
}

export function iniciarVistaSupervisorVacaciones(contenedor, uid, nombre) {
  construirVista(contenedor, uid, nombre, query(collection(db, "solicitudesVacaciones"), where("supervisorId", "==", uid)));
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto || "";
  return div.innerHTML;
}