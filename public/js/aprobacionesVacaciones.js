import { db } from "./firebase-config.js";
import {
  collection, onSnapshot, doc, updateDoc, query, where, runTransaction
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { crearNotificacion } from "./notificaciones.js";
import { enviarCorreoResultado } from "./correo.js";

const ETIQUETAS_ESTATUS = {
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  rechazada: "Rechazada"
};

// permiteRecortes: solo true para la vista de admin (iniciarGestionVacaciones)
// — las solicitudes de recorte de vacaciones ya aprobadas (18 sep 2026,
// pedido de Ivan) las aprueba/rechaza él directamente, no los supervisores;
// la vista de supervisor (iniciarVistaSupervisorVacaciones) sigue igual que
// antes, sin esta sección.
function construirVista(contenedor, uidRevisor, nombreRevisor, queryBase, queryUsuarios, permiteRecortes) {
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

    ${permiteRecortes ? `
    <section class="panel" style="margin-top:20px;">
      <h2>Recortes de vacaciones pendientes</h2>
      <p class="nota">Solicitudes de empleados para recortar (desde un extremo) una vacación ya aprobada. (Formato anterior — se deja tal cual para las solicitudes que ya estaban en vuelo antes de unificar los ajustes.)</p>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-recortes-pendientes">
          <thead>
            <tr><th>Empleado</th><th>Rango aprobado</th><th>Rango nuevo</th><th>Días que libera</th><th>Motivo</th><th>Comentario</th><th>Acción</th></tr>
          </thead>
          <tbody id="tbody-recortes-pendientes"><tr><td colspan="7">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>

    <section class="panel" style="margin-top:20px;">
      <h2>Ajustes de vacaciones pendientes</h2>
      <p class="nota">Solicitudes de empleados para recortar o cambiar de fechas una vacación ya aprobada.</p>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-ajustes-vac-pendientes">
          <thead>
            <tr><th>Empleado</th><th>Tipo</th><th>Rango aprobado</th><th>Rango nuevo</th><th>Días (antes → después)</th><th>Motivo</th><th>Comentario</th><th>Acción</th></tr>
          </thead>
          <tbody id="tbody-ajustes-vac-pendientes"><tr><td colspan="8">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>
    ` : ""}

    <section class="panel" style="margin-top:20px;">
      <h2>Historial de vacaciones</h2>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-vac-historial">
          <thead>
            <tr><th>Empleado</th><th>Inicio</th><th>Fin</th><th>Días</th><th>Motivo</th><th>Estatus</th><th>Comentario</th><th>Autorizó</th><th>Correo</th></tr>
          </thead>
          <tbody id="tbody-vac-historial"><tr><td colspan="9">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>
  `;

  const errorDiv = contenedor.querySelector("#vac-error");
  const tbodyPendientes = contenedor.querySelector("#tbody-vac-pendientes");
  const tbodyHistorial = contenedor.querySelector("#tbody-vac-historial");
  const tbodyRecortes = contenedor.querySelector("#tbody-recortes-pendientes");
  const tbodyAjustes = contenedor.querySelector("#tbody-ajustes-vac-pendientes");

  let ultimoHistorial = [];
  let usuariosPorId = {};

  onSnapshot(queryBase, (snap) => {
    const todas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    todas.sort((a, b) => (b.fechaInicio || "").localeCompare(a.fechaInicio || ""));

    const pendientes = todas.filter(s => s.estatus === "pendiente");
    ultimoHistorial = todas.filter(s => s.estatus !== "pendiente");

    renderPendientes(pendientes);
    renderHistorial();

    if (permiteRecortes) {
      const recortesPendientes = todas.filter(s => s.estatus === "aprobada" && s.recorteSolicitud && s.recorteSolicitud.estatus === "pendiente");
      renderRecortesPendientes(recortesPendientes);

      const ajustesPendientes = todas.filter(s => s.estatus === "aprobada" && s.ajusteSolicitud && s.ajusteSolicitud.estatus === "pendiente");
      renderAjustesPendientes(ajustesPendientes);
    }
  }, (err) => {
    errorDiv.textContent = "No se pudieron cargar las solicitudes de vacaciones: " + err.message;
  });

  onSnapshot(queryUsuarios, (snap) => {
    usuariosPorId = {};
    snap.docs.forEach(d => { usuariosPorId[d.id] = d.data(); });
    renderHistorial();
  }, (err) => {
    console.error("No se pudo cargar el correo de los empleados:", err);
  });

  function renderPendientes(lista) {
    if (lista.length === 0) {
      tbodyPendientes.innerHTML = `<tr><td colspan="7">No hay solicitudes de vacaciones pendientes.</td></tr>`;
      return;
    }
    tbodyPendientes.innerHTML = lista.map(s => `
      <tr data-id="${s.id}">
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

  // Tabla de recortes pendientes (solo admin). Aprobar ajusta fechaInicio/
  // fechaFin/diasHabiles del documento y regresa a saldo los días liberados
  // (transacción atómica); rechazar solo marca el recorteSolicitud como
  // rechazado, sin tocar fechas ni saldo — la vacación se queda como estaba.
  function renderRecortesPendientes(lista) {
    if (!tbodyRecortes) return;
    if (lista.length === 0) {
      tbodyRecortes.innerHTML = `<tr><td colspan="7">No hay solicitudes de recorte pendientes.</td></tr>`;
      return;
    }
    tbodyRecortes.innerHTML = lista.map(s => `
      <tr data-id="${s.id}">
        <td>${escapeHtml(s.empleadoNombre || "")}</td>
        <td>${s.fechaInicio} al ${s.fechaFin}</td>
        <td>${s.recorteSolicitud.fechaInicioNueva} al ${s.recorteSolicitud.fechaFinNueva}</td>
        <td>${s.recorteSolicitud.diasLiberados}</td>
        <td>${s.recorteSolicitud.motivo ? escapeHtml(s.recorteSolicitud.motivo) : "—"}</td>
        <td><input type="text" class="input-comentario" placeholder="Comentario (opcional)"></td>
        <td class="acciones">
          <button type="button" class="btn-aprobar">Aprobar</button>
          <button type="button" class="btn-rechazar">Rechazar</button>
        </td>
      </tr>
    `).join("");

    tbodyRecortes.querySelectorAll("tr[data-id]").forEach(fila => {
      const id = fila.dataset.id;
      const solicitud = lista.find(s => s.id === id);
      const comentarioInput = fila.querySelector(".input-comentario");
      fila.querySelector(".btn-aprobar").addEventListener("click", () => {
        resolverRecorte(solicitud, "aprobada", comentarioInput.value.trim());
      });
      fila.querySelector(".btn-rechazar").addEventListener("click", () => {
        resolverRecorte(solicitud, "rechazada", comentarioInput.value.trim());
      });
    });
  }

  // Ajuste (unificado, 28 sep 2026) pendiente de tipo 'recorte' o
  // 'cambioFechas'. Aprobar: transacción atómica que ajusta fechaInicio/
  // fechaFin/diasHabiles del documento, agrega la entrada a
  // historialAjustes (fecha de cliente — un arreglo no acepta
  // serverTimestamp()), limpia ajusteSolicitud, y ajusta el saldo del
  // empleado por la diferencia (que puede ser positiva o negativa en
  // 'cambioFechas', a diferencia del 'recorte' viejo que solo liberaba
  // días). Rechazar: solo marca el ajusteSolicitud como rechazado, sin tocar
  // fechas ni saldo.
  function renderAjustesPendientes(lista) {
    if (!tbodyAjustes) return;
    if (lista.length === 0) {
      tbodyAjustes.innerHTML = `<tr><td colspan="8">No hay ajustes pendientes.</td></tr>`;
      return;
    }
    const ETIQUETAS_TIPO = { recorte: "Recorte", cambioFechas: "Cambio de fechas" };
    tbodyAjustes.innerHTML = lista.map(s => `
      <tr data-id="${s.id}">
        <td>${escapeHtml(s.empleadoNombre || "")}</td>
        <td>${ETIQUETAS_TIPO[s.ajusteSolicitud.tipo] || s.ajusteSolicitud.tipo}</td>
        <td>${s.fechaInicio} al ${s.fechaFin}</td>
        <td>${s.ajusteSolicitud.fechaInicioNueva} al ${s.ajusteSolicitud.fechaFinNueva}</td>
        <td>${s.diasHabiles} → ${s.ajusteSolicitud.diasHabilesNuevos}</td>
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

  function renderHistorial() {
    if (ultimoHistorial.length === 0) {
      tbodyHistorial.innerHTML = `<tr><td colspan="9">Todavía no hay historial.</td></tr>`;
      return;
    }
    tbodyHistorial.innerHTML = ultimoHistorial.map(s => `
        <tr data-id-correo="${s.id}">
          <td>${escapeHtml(s.empleadoNombre || "")}</td>
          <td>${s.fechaInicio}</td>
          <td>${s.fechaFin}</td>
          <td>${s.diasHabiles}</td>
          <td>${s.motivo ? escapeHtml(s.motivo) : "—"}</td>
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
      asunto: `Solicitud de vacaciones ${aprobada ? "aprobada" : "rechazada"} — Alanis`,
      // El template de EmailJS pone el saludo ("Hola {{to_name}},") y el pie
      // de página fijos; aquí solo va el cuerpo, como HTML real — el template
      // usa {{{mensaje}}} (triple llave) para no escapar las etiquetas.
      mensaje: `<p style="margin:0 0 12px;">Tu solicitud de vacaciones del ${s.fechaInicio} al ${s.fechaFin} (${s.diasHabiles} día(s)) fue:</p>
<p style="margin:0 0 12px;"><span style="display:inline-block;padding:4px 12px;border-radius:4px;font-weight:bold;background:${aprobada ? "#e7f5ec" : "#fdecea"};color:${aprobada ? "#1c7a41" : "#c0392b"};">${aprobada ? "APROBADA ✅" : "RECHAZADA"}</span></p>${s.comentarioRevisor ? `<p style="margin:0;color:#555;font-size:0.9em;">Comentario: ${escapeHtml(s.comentarioRevisor)}</p>` : ""}${aprobada ? `<p style="margin:12px 0 0;padding:10px 12px;background:#f5f3f0;border-radius:4px;font-size:0.9em;">📄 Imprima su formato desde la AdrematasaInternoWebApp para solicitar firma autógrafa de su Supervisor.</p>` : ""}`
    };
  }

  async function resolverSolicitud(solicitud, estatus, comentario) {
    errorDiv.textContent = "";
    const id = solicitud.id;
    const empleadoId = solicitud.empleadoId;
    const diasHabiles = solicitud.diasHabiles;
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

      const aprobada = estatus === "aprobada";
      crearNotificacion(empleadoId, {
        titulo: aprobada ? "Solicitud de vacaciones aprobada" : "Solicitud de vacaciones rechazada",
        mensaje: `Tu solicitud del ${solicitud.fechaInicio} al ${solicitud.fechaFin} fue ${aprobada ? "aprobada" : "rechazada"}${comentario ? ": " + comentario : "."}`,
        tipo: aprobada ? "aprobacion" : "rechazo"
      });

      // Aviso por correo al empleado — mejor esfuerzo: si falla (llaves de
      // EmailJS sin configurar, sin internet, etc.) no debe tumbar la
      // aprobación/rechazo, que ya quedó guardada arriba. El botón manual
      // "Enviar correo" del historial sirve para reintentar ese caso.
      const usuario = usuariosPorId[empleadoId] || {};
      enviarCorreoResultado(mensajeCorreoSolicitud({ ...solicitud, estatus, comentarioRevisor: comentario || null }, usuario))
        .then(resultado => {
          if (!resultado.ok) console.error("No se pudo enviar el correo de aviso:", resultado.error);
        });
    } catch (err) {
      errorDiv.textContent = "No se pudo actualizar la solicitud: " + err.message;
    }
  }

  // Resuelve una solicitud de recorte (18 sep 2026). Aprobar: transacción
  // atómica que ajusta fechaInicio/fechaFin/diasHabiles del documento,
  // agrega la entrada al historial (historialRecortes, con fecha de cliente
  // — igual que historialReasignaciones en el otro proyecto, un arreglo no
  // acepta serverTimestamp()), limpia recorteSolicitud, y regresa a saldo
  // del empleado justo los días liberados. Rechazar: solo marca el
  // recorteSolicitud como rechazado, sin tocar fechas ni saldo.
  async function resolverRecorte(solicitud, decision, comentario) {
    errorDiv.textContent = "";
    const id = solicitud.id;
    const empleadoId = solicitud.empleadoId;
    const recorte = solicitud.recorteSolicitud;
    try {
      if (decision === "aprobada") {
        await runTransaction(db, async (tx) => {
          const refSolicitud = doc(db, "solicitudesVacaciones", id);
          const refEmpleado = doc(db, "usuarios", empleadoId);
          const snapSolicitud = await tx.get(refSolicitud);
          const snapEmpleado = await tx.get(refEmpleado);

          if (!snapSolicitud.exists()) {
            throw new Error("La solicitud ya no existe.");
          }
          const datosActuales = snapSolicitud.data();
          if (!datosActuales.recorteSolicitud || datosActuales.recorteSolicitud.estatus !== "pendiente") {
            throw new Error("Este recorte ya fue resuelto por alguien más.");
          }

          const saldoActual = (snapEmpleado.data() || {}).diasVacacionesDisponibles || 0;
          const historialPrevio = Array.isArray(datosActuales.historialRecortes) ? datosActuales.historialRecortes : [];
          const entradaHistorial = {
            fechaInicioAnterior: datosActuales.fechaInicio,
            fechaFinAnterior: datosActuales.fechaFin,
            diasHabilesAnterior: datosActuales.diasHabiles,
            fechaInicioNueva: recorte.fechaInicioNueva,
            fechaFinNueva: recorte.fechaFinNueva,
            diasHabilesNuevos: recorte.diasHabilesNuevos,
            diasLiberados: recorte.diasLiberados,
            motivo: recorte.motivo || null,
            aprobadoPor: uidRevisor,
            aprobadoPorNombre: nombreRevisor || null,
            timestamp: new Date().toISOString()
          };

          tx.update(refSolicitud, {
            fechaInicio: recorte.fechaInicioNueva,
            fechaFin: recorte.fechaFinNueva,
            diasHabiles: recorte.diasHabilesNuevos,
            recorteSolicitud: null,
            historialRecortes: [...historialPrevio, entradaHistorial]
          });
          tx.update(refEmpleado, {
            diasVacacionesDisponibles: saldoActual + recorte.diasLiberados
          });
        });
      } else {
        await updateDoc(doc(db, "solicitudesVacaciones", id), {
          "recorteSolicitud.estatus": "rechazada",
          "recorteSolicitud.comentarioRevisor": comentario || null,
          "recorteSolicitud.revisadoPor": uidRevisor,
          "recorteSolicitud.revisadoPorNombre": nombreRevisor || null,
          "recorteSolicitud.resueltoEn": new Date().toISOString()
        });
      }

      const aprobada = decision === "aprobada";
      crearNotificacion(empleadoId, {
        titulo: aprobada ? "Recorte de vacaciones aprobado" : "Recorte de vacaciones rechazado",
        mensaje: aprobada
          ? `Tu vacación ahora es del ${recorte.fechaInicioNueva} al ${recorte.fechaFinNueva}.`
          : `Tu solicitud de recorte del ${solicitud.fechaInicio} al ${solicitud.fechaFin} fue rechazada${comentario ? ": " + comentario : "."}`,
        tipo: aprobada ? "aprobacion" : "rechazo"
      });
    } catch (err) {
      errorDiv.textContent = "No se pudo resolver el recorte: " + err.message;
    }
  }

  // Resuelve un ajuste unificado (28 sep 2026) — generaliza resolverRecorte()
  // de arriba a los dos tipos ('recorte' y 'cambioFechas'). La fórmula de
  // saldo es la misma en ambos casos: diferencia = días antes − días
  // después; un recorte siempre da una diferencia positiva (regresa saldo),
  // un cambio de fechas puede dar positiva o negativa (regresa o descuenta
  // saldo). Se valida dentro de la transacción que el saldo no quede
  // negativo, por si el saldo del empleado cambió entre que pidió el ajuste
  // y que se aprobó.
  async function resolverAjuste(solicitud, decision, comentario) {
    errorDiv.textContent = "";
    const id = solicitud.id;
    const empleadoId = solicitud.empleadoId;
    const ajuste = solicitud.ajusteSolicitud;
    try {
      if (decision === "aprobada") {
        await runTransaction(db, async (tx) => {
          const refSolicitud = doc(db, "solicitudesVacaciones", id);
          const refEmpleado = doc(db, "usuarios", empleadoId);
          const snapSolicitud = await tx.get(refSolicitud);
          const snapEmpleado = await tx.get(refEmpleado);

          if (!snapSolicitud.exists()) {
            throw new Error("La solicitud ya no existe.");
          }
          const datosActuales = snapSolicitud.data();
          if (!datosActuales.ajusteSolicitud || datosActuales.ajusteSolicitud.estatus !== "pendiente") {
            throw new Error("Este ajuste ya fue resuelto por alguien más.");
          }

          const saldoActual = (snapEmpleado.data() || {}).diasVacacionesDisponibles || 0;
          const diferencia = datosActuales.diasHabiles - ajuste.diasHabilesNuevos;
          const saldoNuevo = saldoActual + diferencia;
          if (saldoNuevo < 0) {
            throw new Error(`El empleado solo tiene ${saldoActual} día(s) disponible(s) y este cambio requiere ${-diferencia} más. Recházalo o ajusta su saldo primero.`);
          }

          const historialPrevio = Array.isArray(datosActuales.historialAjustes) ? datosActuales.historialAjustes : [];
          const entradaHistorial = {
            tipo: ajuste.tipo,
            fechaInicioAnterior: datosActuales.fechaInicio,
            fechaFinAnterior: datosActuales.fechaFin,
            diasHabilesAnterior: datosActuales.diasHabiles,
            fechaInicioNueva: ajuste.fechaInicioNueva,
            fechaFinNueva: ajuste.fechaFinNueva,
            diasHabilesNuevos: ajuste.diasHabilesNuevos,
            motivo: ajuste.motivo || null,
            aprobadoPor: uidRevisor,
            aprobadoPorNombre: nombreRevisor || null,
            comentarioResolucion: comentario || null,
            timestamp: new Date().toISOString()
          };

          tx.update(refSolicitud, {
            fechaInicio: ajuste.fechaInicioNueva,
            fechaFin: ajuste.fechaFinNueva,
            diasHabiles: ajuste.diasHabilesNuevos,
            ajusteSolicitud: null,
            historialAjustes: [...historialPrevio, entradaHistorial]
          });
          tx.update(refEmpleado, {
            diasVacacionesDisponibles: saldoNuevo
          });
        });
      } else {
        await updateDoc(doc(db, "solicitudesVacaciones", id), {
          "ajusteSolicitud.estatus": "rechazada",
          "ajusteSolicitud.comentarioRevisor": comentario || null,
          "ajusteSolicitud.revisadoPor": uidRevisor,
          "ajusteSolicitud.revisadoPorNombre": nombreRevisor || null,
          "ajusteSolicitud.resueltoEn": new Date().toISOString()
        });
      }

      const aprobada = decision === "aprobada";
      crearNotificacion(empleadoId, {
        titulo: aprobada ? "Ajuste de vacaciones aprobado" : "Ajuste de vacaciones rechazado",
        mensaje: aprobada
          ? `Tu vacación ahora es del ${ajuste.fechaInicioNueva} al ${ajuste.fechaFinNueva}.`
          : `Tu solicitud de ajuste sobre el ${solicitud.fechaInicio} al ${solicitud.fechaFin} fue rechazada${comentario ? ": " + comentario : "."}`,
        tipo: aprobada ? "aprobacion" : "rechazo"
      });
    } catch (err) {
      errorDiv.textContent = "No se pudo resolver el ajuste: " + err.message;
    }
  }
}

export function iniciarGestionVacaciones(contenedor, uid, nombre) {
  construirVista(contenedor, uid, nombre, collection(db, "solicitudesVacaciones"), collection(db, "usuarios"), true);
}

export function iniciarVistaSupervisorVacaciones(contenedor, uid, nombre) {
  construirVista(
    contenedor, uid, nombre,
    query(collection(db, "solicitudesVacaciones"), where("supervisorId", "==", uid)),
    query(collection(db, "usuarios"), where("supervisorId", "==", uid)),
    false
  );
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto || "";
  return div.innerHTML;
}