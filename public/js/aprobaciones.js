import { db } from "./firebase-config.js";
import {
  collection, onSnapshot, doc, updateDoc, query, where
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { crearNotificacion } from "./notificaciones.js";
import { enviarCorreoResultado } from "./correo.js";

const ETIQUETAS_ESTATUS = {
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  rechazada: "Rechazada"
};

function construirVista(contenedor, uidRevisor, nombreRevisor, queryBase, queryUsuarios) {
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
            <tr><th>Empleado</th><th>Fecha</th><th>Horario</th><th>Horas</th><th>Motivo</th><th>Estatus</th><th>Comentario</th><th>Autorizó</th><th>Correo</th></tr>
          </thead>
          <tbody id="tbody-historial"><tr><td colspan="9">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>
  `;

  const errorDiv = contenedor.querySelector("#sol-error");
  const tbodyPendientes = contenedor.querySelector("#tbody-pendientes");
  const tbodyHistorial = contenedor.querySelector("#tbody-historial");

  let ultimoHistorial = [];
  let usuariosPorId = {};

  onSnapshot(queryBase, (snap) => {
    const todas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    todas.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));

    const pendientes = todas.filter(s => s.estatus === "pendiente");
    ultimoHistorial = todas.filter(s => s.estatus !== "pendiente");

    renderPendientes(pendientes);
    renderHistorial();
  }, (err) => {
    errorDiv.textContent = "No se pudieron cargar las solicitudes: " + err.message;
  });

  // Correo de cada empleado (para el botón "Enviar correo" del
  // historial). Puede llegar después de las solicitudes — por eso
  // renderHistorial() se vuelve a llamar cuando cambie esto también.
  onSnapshot(queryUsuarios, (snap) => {
    usuariosPorId = {};
    snap.docs.forEach(d => { usuariosPorId[d.id] = d.data(); });
    renderHistorial();
  }, (err) => {
    console.error("No se pudo cargar el móvil de los empleados:", err);
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
      const solicitud = lista.find(s => s.id === id);
      const comentarioInput = fila.querySelector(".input-comentario");
      fila.querySelector(".btn-aprobar").addEventListener("click", () => {
        resolverSolicitud(solicitud, "aprobada", comentarioInput.value.trim());
      });
      fila.querySelector(".btn-rechazar").addEventListener("click", () => {
        resolverSolicitud(solicitud, "rechazada", comentarioInput.value.trim());
      });
    });
  }

  function renderHistorial() {
    if (ultimoHistorial.length === 0) {
      tbodyHistorial.innerHTML = `<tr><td colspan="9">Todavía no hay historial.</td></tr>`;
      return;
    }
    tbodyHistorial.innerHTML = ultimoHistorial.map(s => `
        <tr data-id-correo="${s.id}">
          <td>${escapeHtml(s.empleadoNombre || "")}</td>
          <td>${s.fecha}</td>
          <td>${s.horaInicio}–${s.horaFin}</td>
          <td>${s.horas}</td>
          <td>${escapeHtml(s.motivo)}</td>
          <td><span class="badge badge-${s.estatus}">${ETIQUETAS_ESTATUS[s.estatus] || s.estatus}</span></td>
          <td>${s.comentarioRevisor ? escapeHtml(s.comentarioRevisor) : "—"}</td>
          <td>${s.revisadoPorNombre ? escapeHtml(s.revisadoPorNombre) : "—"}</td>
          <td>
            <button type="button" class="secundario btn-enviar-correo">Enviar correo</button>
            <div class="nota-correo"></div>
          </td>
        </tr>
      `).join("");

    tbodyHistorial.querySelectorAll("tr[data-id-correo]").forEach(fila => {
      const id = fila.dataset.idCorreo;
      const solicitud = ultimoHistorial.find(s => s.id === id);
      const boton = fila.querySelector(".btn-enviar-correo");
      const nota = fila.querySelector(".nota-correo");
      boton.addEventListener("click", async () => {
        boton.disabled = true;
        nota.textContent = "Enviando...";
        const usuario = usuariosPorId[solicitud.empleadoId] || {};
        const resultado = await enviarCorreoResultado(mensajeCorreoSolicitud(solicitud, usuario));
        nota.textContent = resultado.ok ? "Enviado ✅" : "No se pudo enviar: " + resultado.error;
        boton.disabled = false;
      });
    });
  }

  // Arma el asunto/mensaje/destinatario del correo de aviso a partir de la
  // solicitud ya resuelta y los datos del empleado (usados tanto por el
  // botón manual del historial como por el envío automático al resolver).
  function mensajeCorreoSolicitud(s, usuario) {
    const aprobada = s.estatus === "aprobada";
    return {
      destinatarioEmail: usuario.email || "",
      destinatarioNombre: s.empleadoNombre || usuario.nombre || "",
      asunto: `Solicitud de horas extra ${aprobada ? "aprobada" : "rechazada"} — Alanis`,
      mensaje: `Hola ${s.empleadoNombre || ""},\n\nTu solicitud de horas extra del ${s.fecha} (${s.horaInicio}-${s.horaFin}) fue ${aprobada ? "APROBADA" : "RECHAZADA"}.${s.comentarioRevisor ? "\nComentario: " + s.comentarioRevisor : ""}\n\nEste es un aviso automático de Adrematasa Interno (Alanis).`
    };
  }

  async function resolverSolicitud(solicitud, estatus, comentario) {
    errorDiv.textContent = "";
    try {
      await updateDoc(doc(db, "solicitudes", solicitud.id), {
        estatus,
        comentarioRevisor: comentario || null,
        revisadoPor: uidRevisor,
        revisadoPorNombre: nombreRevisor || null,
        resueltoEn: new Date().toISOString()
      });
      const aprobada = estatus === "aprobada";
      crearNotificacion(solicitud.empleadoId, {
        titulo: aprobada ? "Solicitud de horas extra aprobada" : "Solicitud de horas extra rechazada",
        mensaje: `Tu solicitud del ${solicitud.fecha} (${solicitud.horaInicio}–${solicitud.horaFin}) fue ${aprobada ? "aprobada" : "rechazada"}${comentario ? ": " + comentario : "."}`,
        tipo: aprobada ? "aprobacion" : "rechazo"
      });

      // Aviso por correo al empleado — mejor esfuerzo: si falla (llaves de
      // EmailJS sin configurar, sin internet, etc.) no debe tumbar la
      // aprobación/rechazo, que ya quedó guardada arriba. El botón manual
      // "Enviar correo" del historial sirve para reintentar ese caso.
      const usuario = usuariosPorId[solicitud.empleadoId] || {};
      enviarCorreoResultado(mensajeCorreoSolicitud({ ...solicitud, estatus, comentarioRevisor: comentario || null }, usuario))
        .then(resultado => {
          if (!resultado.ok) console.error("No se pudo enviar el correo de aviso:", resultado.error);
        });
    } catch (err) {
      errorDiv.textContent = "No se pudo actualizar la solicitud: " + err.message;
    }
  }
}

export function iniciarGestionSolicitudes(contenedor, uid, nombre) {
  construirVista(contenedor, uid, nombre, collection(db, "solicitudes"), collection(db, "usuarios"));
}

export function iniciarVistaSupervisor(contenedor, uid, nombre) {
  construirVista(
    contenedor, uid, nombre,
    query(collection(db, "solicitudes"), where("supervisorId", "==", uid)),
    query(collection(db, "usuarios"), where("supervisorId", "==", uid))
  );
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto || "";
  return div.innerHTML;
}