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

// permiteRevertir: solo true para la vista de admin (iniciarGestionSolicitudes).
// Las reglas de Firestore ya lo hacían así de todos modos — un supervisor solo
// puede actualizar una solicitud mientras sigue "pendiente" (resource.data.estatus
// == 'pendiente' en su rama de la regla), nunca una ya resuelta; solo la regla
// de admin (esAdmin(), sin esa restricción) permite regresarla a pendiente. El
// botón nuevo solo se muestra donde de verdad funciona.
function construirVista(contenedor, uidRevisor, nombreRevisor, queryBase, queryUsuarios, permiteRevertir) {
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

    ${permiteRevertir ? `
    <section class="panel" style="margin-top:20px;">
      <h2>Ajustes pendientes</h2>
      <p class="nota">Solicitudes de empleados para que se vuelva a revisar una solicitud de horas extra ya resuelta.</p>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-ajustes-pendientes">
          <thead>
            <tr><th>Empleado</th><th>Fecha</th><th>Horario</th><th>Resultado actual</th><th>Motivo del ajuste</th><th>Comentario</th><th>Acción</th></tr>
          </thead>
          <tbody id="tbody-ajustes-pendientes"><tr><td colspan="7">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>
    ` : ""}

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
  const tbodyAjustes = contenedor.querySelector("#tbody-ajustes-pendientes");

  let ultimoHistorial = [];
  let usuariosPorId = {};

  onSnapshot(queryBase, (snap) => {
    const todas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    todas.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));

    const pendientes = todas.filter(s => s.estatus === "pendiente");
    ultimoHistorial = todas.filter(s => s.estatus !== "pendiente");

    renderPendientes(pendientes);
    renderHistorial();

    if (permiteRevertir) {
      const ajustesPendientes = todas.filter(s => s.estatus !== "pendiente" && s.ajusteSolicitud && s.ajusteSolicitud.estatus === "pendiente");
      renderAjustesPendientes(ajustesPendientes);
    }
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

  // Tabla de ajustes pendientes (solo admin, igual que los recortes de
  // vacaciones). Aprobar regresa la solicitud a "pendiente" (mismo efecto que
  // el botón directo "Revertir a pendiente", pero aquí lo pidió el empleado)
  // y deja registro en historialAjustes; rechazar solo marca el
  // ajusteSolicitud como rechazado, la solicitud se queda resuelta como está.
  function renderAjustesPendientes(lista) {
    if (!tbodyAjustes) return;
    if (lista.length === 0) {
      tbodyAjustes.innerHTML = `<tr><td colspan="7">No hay ajustes pendientes.</td></tr>`;
      return;
    }
    tbodyAjustes.innerHTML = lista.map(s => `
      <tr data-id="${s.id}">
        <td>${escapeHtml(s.empleadoNombre || "")}</td>
        <td>${s.fecha}</td>
        <td>${s.horaInicio}–${s.horaFin}</td>
        <td><span class="badge badge-${s.estatus}">${ETIQUETAS_ESTATUS[s.estatus] || s.estatus}</span></td>
        <td>${s.ajusteSolicitud.motivo ? escapeHtml(s.ajusteSolicitud.motivo) : "—"}</td>
        <td><input type="text" class="input-comentario" placeholder="Comentario (opcional)"></td>
        <td class="acciones">
          <button type="button" class="btn-aprobar">Aprobar</button>
          <button type="button" class="btn-rechazar">Rechazar</button>
        </td>
      </tr>
    `).join("");

    tbodyAjustes.querySelectorAll("tr[data-id]").forEach(fila => {
      const id = fila.dataset.id;
      const solicitud = lista.find(s => s.id === id);
      const comentarioInput = fila.querySelector(".input-comentario");
      fila.querySelector(".btn-aprobar").addEventListener("click", () => {
        resolverAjuste(solicitud, "aprobada", comentarioInput.value.trim());
      });
      fila.querySelector(".btn-rechazar").addEventListener("click", () => {
        resolverAjuste(solicitud, "rechazada", comentarioInput.value.trim());
      });
    });
  }

  // Ajuste (unificado, 28 sep 2026) pendiente sobre una solicitud ya
  // resuelta: mismo badge/estilo que "Recorte en revisión" de vacaciones,
  // para que se vea consistente en toda la app.
  function badgeAjuste(s) {
    const a = s.ajusteSolicitud;
    if (!a) return "";
    if (a.estatus === "pendiente") return ` <span class="badge badge-pendiente">Ajuste en revisión</span>`;
    if (a.estatus === "rechazada") return ` <span class="badge badge-rechazada" title="${a.comentarioRevisor ? escapeHtml(a.comentarioRevisor) : "Sin comentario"}">Ajuste rechazado</span>`;
    return "";
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
          <td><span class="badge badge-${s.estatus}">${ETIQUETAS_ESTATUS[s.estatus] || s.estatus}</span>${badgeAjuste(s)}</td>
          <td>${s.comentarioRevisor ? escapeHtml(s.comentarioRevisor) : "—"}</td>
          <td>${s.revisadoPorNombre ? escapeHtml(s.revisadoPorNombre) : "—"}</td>
          <td>
            <button type="button" class="secundario btn-enviar-correo">Enviar correo</button>
            ${permiteRevertir && !s.enviadoANominaEn ? `<button type="button" class="secundario btn-revertir-solicitud">Revertir a pendiente</button>` : ""}
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

      fila.querySelector(".btn-revertir-solicitud")?.addEventListener("click", () => {
        revertirSolicitud(solicitud);
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
      // El template de EmailJS pone el saludo ("Hola {{to_name}},") y el pie
      // de página fijos; aquí solo va el cuerpo, como HTML real — el template
      // usa {{{mensaje}}} (triple llave) para no escapar las etiquetas.
      mensaje: `<p style="margin:0 0 12px;">Tu solicitud de horas extra del ${s.fecha} (${s.horaInicio}-${s.horaFin}) fue:</p>
<p style="margin:0 0 12px;"><span style="display:inline-block;padding:4px 12px;border-radius:4px;font-weight:bold;background:${aprobada ? "#e7f5ec" : "#fdecea"};color:${aprobada ? "#1c7a41" : "#c0392b"};">${aprobada ? "APROBADA ✅" : "RECHAZADA"}</span></p>${s.comentarioRevisor ? `<p style="margin:0;color:#555;font-size:0.9em;">Comentario: ${escapeHtml(s.comentarioRevisor)}</p>` : ""}`
    };
  }

  // Correo de resultado de un AJUSTE solicitado por el empleado (29 sep
  // 2026, pedido de Ivan) — no se manda cuando el admin revierte directo
  // (revertirSolicitud), porque ahí no hay nada que el empleado esté
  // esperando que se le avise; solo cuando pasó por la cola de "Ajustes
  // pendientes" porque el empleado lo pidió.
  function mensajeCorreoAjuste(s, decision, comentario, usuario) {
    const aprobada = decision === "aprobada";
    return {
      destinatarioEmail: usuario.email || "",
      destinatarioNombre: s.empleadoNombre || usuario.nombre || "",
      asunto: `Ajuste de horas extra ${aprobada ? "aprobado" : "rechazado"} — Alanis`,
      mensaje: `<p style="margin:0 0 12px;">Tu solicitud de ajuste sobre la solicitud de horas extra del ${s.fecha} (${s.horaInicio}-${s.horaFin}) fue:</p>
<p style="margin:0 0 12px;"><span style="display:inline-block;padding:4px 12px;border-radius:4px;font-weight:bold;background:${aprobada ? "#e7f5ec" : "#fdecea"};color:${aprobada ? "#1c7a41" : "#c0392b"};">${aprobada ? "APROBADA ✅" : "RECHAZADA"}</span></p>${aprobada ? `<p style="margin:0 0 12px;">Tu solicitud volvió a "Pendiente" para revisarse de nuevo.</p>` : ""}${comentario ? `<p style="margin:0;color:#555;font-size:0.9em;">Comentario: ${escapeHtml(comentario)}</p>` : ""}`
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

  // Deshace una aprobación/rechazo por error (18 sep 2026, pedido de Ivan) —
  // regresa la solicitud a "pendiente" tal cual estaba antes de resolverla,
  // sin tocar ningún saldo (las horas extra no descuentan nada) y sin avisar
  // al empleado: no hay nada que notificar todavía, porque el caso vuelve a
  // la fila de pendientes para resolverse correctamente. Bloqueado si ya se
  // mandó a nómina (enviadoANominaEn) — el botón ni siquiera se muestra en
  // ese caso, ver renderHistorial().
  //
  // Este es el atajo DIRECTO del admin — sin solicitud ni aprobación, porque
  // si el propio admin se equivoca al resolver no tiene sentido que se
  // autorice a sí mismo (28 sep 2026, pedido de Ivan). Aun así, para que el
  // historial quede completo, se registra en historialAjustes igual que un
  // ajuste solicitado por el empleado, marcado como "directo".
  async function revertirSolicitud(solicitud) {
    if (!confirm(`¿Regresar a "Pendiente" la solicitud de ${solicitud.empleadoNombre} del ${solicitud.fecha}? Vuelve a aparecer arriba para aprobarla o rechazarla de nuevo.`)) return;
    errorDiv.textContent = "";
    try {
      const historialPrevio = Array.isArray(solicitud.historialAjustes) ? solicitud.historialAjustes : [];
      const entradaHistorial = {
        tipo: "revertir",
        origen: "directo",
        estatusAnterior: solicitud.estatus,
        comentarioRevisorAnterior: solicitud.comentarioRevisor || null,
        revisadoPorNombreAnterior: solicitud.revisadoPorNombre || null,
        resueltoPor: uidRevisor,
        resueltoPorNombre: nombreRevisor || null,
        timestamp: new Date().toISOString()
      };
      await updateDoc(doc(db, "solicitudes", solicitud.id), {
        estatus: "pendiente",
        comentarioRevisor: null,
        revisadoPor: null,
        revisadoPorNombre: null,
        resueltoEn: null,
        historialAjustes: [...historialPrevio, entradaHistorial]
      });
    } catch (err) {
      errorDiv.textContent = "No se pudo revertir la solicitud: " + err.message;
    }
  }

  // Resuelve un ajuste SOLICITADO POR EL EMPLEADO (28 sep 2026) sobre una
  // solicitud de horas extra ya resuelta — a diferencia de revertirSolicitud()
  // de arriba (atajo directo del admin), este pasa por la cola de "Ajustes
  // pendientes" porque lo pidió el empleado, no el admin. Aprobar: mismo
  // efecto que el atajo directo (regresa a "pendiente"), más el registro en
  // historialAjustes con el motivo que dio el empleado. Rechazar: solo marca
  // el ajusteSolicitud como rechazado, la solicitud se queda resuelta como
  // estaba.
  async function resolverAjuste(solicitud, decision, comentario) {
    errorDiv.textContent = "";
    try {
      if (decision === "aprobada") {
        const historialPrevio = Array.isArray(solicitud.historialAjustes) ? solicitud.historialAjustes : [];
        const entradaHistorial = {
          tipo: "revertir",
          origen: "solicitado",
          motivo: solicitud.ajusteSolicitud.motivo || null,
          estatusAnterior: solicitud.estatus,
          comentarioRevisorAnterior: solicitud.comentarioRevisor || null,
          revisadoPorNombreAnterior: solicitud.revisadoPorNombre || null,
          resueltoPor: uidRevisor,
          resueltoPorNombre: nombreRevisor || null,
          comentarioResolucion: comentario || null,
          timestamp: new Date().toISOString()
        };
        await updateDoc(doc(db, "solicitudes", solicitud.id), {
          estatus: "pendiente",
          comentarioRevisor: null,
          revisadoPor: null,
          revisadoPorNombre: null,
          resueltoEn: null,
          ajusteSolicitud: null,
          historialAjustes: [...historialPrevio, entradaHistorial]
        });
      } else {
        await updateDoc(doc(db, "solicitudes", solicitud.id), {
          "ajusteSolicitud.estatus": "rechazada",
          "ajusteSolicitud.comentarioRevisor": comentario || null,
          "ajusteSolicitud.revisadoPor": uidRevisor,
          "ajusteSolicitud.revisadoPorNombre": nombreRevisor || null,
          "ajusteSolicitud.resueltoEn": new Date().toISOString()
        });
      }

      const aprobada = decision === "aprobada";
      crearNotificacion(solicitud.empleadoId, {
        titulo: aprobada ? "Ajuste de horas extra aprobado" : "Ajuste de horas extra rechazado",
        mensaje: aprobada
          ? `Tu solicitud del ${solicitud.fecha} (${solicitud.horaInicio}–${solicitud.horaFin}) volvió a "Pendiente" para revisarse de nuevo.`
          : `Tu solicitud de ajuste sobre el ${solicitud.fecha} fue rechazada${comentario ? ": " + comentario : "."}`,
        tipo: aprobada ? "aprobacion" : "rechazo"
      });

      // Aviso por correo al empleado (29 sep 2026, pedido de Ivan) — mejor
      // esfuerzo, igual que el de una solicitud normal: si falla no tumba
      // la resolución del ajuste, que ya quedó guardada arriba.
      const usuarioAjuste = usuariosPorId[solicitud.empleadoId] || {};
      enviarCorreoResultado(mensajeCorreoAjuste(solicitud, decision, comentario, usuarioAjuste))
        .then(resultado => {
          if (!resultado.ok) console.error("No se pudo enviar el correo de aviso del ajuste:", resultado.error);
        });
    } catch (err) {
      errorDiv.textContent = "No se pudo resolver el ajuste: " + err.message;
    }
  }
}

export function iniciarGestionSolicitudes(contenedor, uid, nombre) {
  construirVista(contenedor, uid, nombre, collection(db, "solicitudes"), collection(db, "usuarios"), true);
}

export function iniciarVistaSupervisor(contenedor, uid, nombre) {
  construirVista(
    contenedor, uid, nombre,
    query(collection(db, "solicitudes"), where("supervisorId", "==", uid)),
    query(collection(db, "usuarios"), where("supervisorId", "==", uid)),
    false
  );
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto || "";
  return div.innerHTML;
}