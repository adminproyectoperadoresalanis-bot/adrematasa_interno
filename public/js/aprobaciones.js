import { db } from "./firebase-config.js";
import {
  collection, onSnapshot, doc, updateDoc, query, where
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const ETIQUETAS_ESTATUS = {
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  rechazada: "Rechazada"
};

function construirVista(contenedor, uidRevisor, nombreRevisor, queryBase) {
  contenedor.innerHTML = `
    <section class="panel">
      <h2>Solicitudes pendientes</h2>
      <div id="sol-error" class="error"></div>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-pendientes">
          <thead>
            <tr><th>Empleado</th><th>Fecha</th><th>Horario</th><th>Horas</th><th>Motivo</th><th>Comentario</th><th>Acción</th></tr>
          </thead>
          <tbody id="tbody-pendientes"><tr><td colspan="7">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>

    <section class="panel" style="margin-top:20px;">
      <h2>Historial de solicitudes</h2>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-historial">
          <thead>
            <tr><th>Empleado</th><th>Fecha</th><th>Horario</th><th>Horas</th><th>Motivo</th><th>Estatus</th><th>Comentario</th><th>Autorizó</th></tr>
          </thead>
          <tbody id="tbody-historial"><tr><td colspan="8">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>
  `;

  const errorDiv = contenedor.querySelector("#sol-error");
  const tbodyPendientes = contenedor.querySelector("#tbody-pendientes");
  const tbodyHistorial = contenedor.querySelector("#tbody-historial");

  onSnapshot(queryBase, (snap) => {
    const todas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    todas.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));

    const pendientes = todas.filter(s => s.estatus === "pendiente");
    const historial = todas.filter(s => s.estatus !== "pendiente");

    renderPendientes(pendientes);
    renderHistorial(historial);
  }, (err) => {
    errorDiv.textContent = "No se pudieron cargar las solicitudes: " + err.message;
  });

  function renderPendientes(lista) {
    if (lista.length === 0) {
      tbodyPendientes.innerHTML = `<tr><td colspan="7">No hay solicitudes pendientes.</td></tr>`;
      return;
    }
    tbodyPendientes.innerHTML = lista.map(s => `
      <tr data-id="${s.id}">
        <td>${escapeHtml(s.empleadoNombre || "")}</td>
        <td>${s.fecha}</td>
        <td>${s.horaInicio}–${s.horaFin}</td>
        <td>${s.horas}</td>
        <td>${escapeHtml(s.motivo)}</td>
        <td><input type="text" class="input-comentario" placeholder="Comentario (opcional)"></td>
        <td class="acciones">
          <button type="button" class="btn-aprobar">Aprobar</button>
          <button type="button" class="btn-rechazar">Rechazar</button>
        </td>
      </tr>
    `).join("");

    tbodyPendientes.querySelectorAll("tr[data-id]").forEach(fila => {
      const id = fila.dataset.id;
      const comentarioInput = fila.querySelector(".input-comentario");
      fila.querySelector(".btn-aprobar").addEventListener("click", () => {
        resolverSolicitud(id, "aprobada", comentarioInput.value.trim());
      });
      fila.querySelector(".btn-rechazar").addEventListener("click", () => {
        resolverSolicitud(id, "rechazada", comentarioInput.value.trim());
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
        <td>${s.fecha}</td>
        <td>${s.horaInicio}–${s.horaFin}</td>
        <td>${s.horas}</td>
        <td>${escapeHtml(s.motivo)}</td>
        <td><span class="badge badge-${s.estatus}">${ETIQUETAS_ESTATUS[s.estatus] || s.estatus}</span></td>
        <td>${s.comentarioRevisor ? escapeHtml(s.comentarioRevisor) : "—"}</td>
        <td>${s.revisadoPorNombre ? escapeHtml(s.revisadoPorNombre) : "—"}</td>
      </tr>
    `).join("");
  }

  async function resolverSolicitud(id, estatus, comentario) {
    errorDiv.textContent = "";
    try {
      await updateDoc(doc(db, "solicitudes", id), {
        estatus,
        comentarioRevisor: comentario || null,
        revisadoPor: uidRevisor,
        revisadoPorNombre: nombreRevisor || null,
        resueltoEn: new Date().toISOString()
      });
    } catch (err) {
      errorDiv.textContent = "No se pudo actualizar la solicitud: " + err.message;
    }
  }
}

export function iniciarGestionSolicitudes(contenedor, uid, nombre) {
  construirVista(contenedor, uid, nombre, collection(db, "solicitudes"));
}

export function iniciarVistaSupervisor(contenedor, uid, nombre) {
  construirVista(contenedor, uid, nombre, query(collection(db, "solicitudes"), where("supervisorId", "==", uid)));
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto || "";
  return div.innerHTML;
}