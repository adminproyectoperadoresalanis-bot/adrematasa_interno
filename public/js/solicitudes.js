import { db } from "./firebase-config.js";
import {
  collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, where
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { avisarNuevaSolicitud } from "./avisoNuevaSolicitud.js";

const ETIQUETAS_ESTATUS = {
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  rechazada: "Rechazada"
};

function calcularHoras(horaInicio, horaFin) {
  const [hi, mi] = horaInicio.split(":").map(Number);
  const [hf, mf] = horaFin.split(":").map(Number);
  const minutosInicio = hi * 60 + mi;
  const minutosFin = hf * 60 + mf;
  let diff = minutosFin - minutosInicio;
  if (diff <= 0) diff += 24 * 60; // cruza medianoche
  return Math.round((diff / 60) * 100) / 100;
}

function calcularSemanaLaboral(fechaStr) {
  // Semana laboral Alanis: viernes a jueves. Devuelve la fecha (yyyy-mm-dd) del viernes de esa semana.
  const d = new Date(fechaStr + "T00:00:00");
  const dow = d.getDay(); // 0=domingo ... 5=viernes ... 6=sabado
  const diffDias = (dow - 5 + 7) % 7;
  d.setDate(d.getDate() - diffDias);
  return d.toISOString().slice(0, 10);
}

export function iniciarVistaEmpleado(contenedor, datosUsuario, uid) {
  contenedor.innerHTML = `
    <section class="panel">
      <h2 id="titulo-form-solicitud">Nueva solicitud de horas extra</h2>
      <div id="solicitud-error" class="error"></div>
      <form id="form-solicitud">
        <div class="fila-captura">
          <label>Fecha trabajada
            <input type="date" id="sol-fecha" required>
          </label>
          <label>Hora de entrada
            <input type="time" id="sol-hora-inicio" required>
          </label>
          <label>Hora de salida
            <input type="time" id="sol-hora-fin" required>
          </label>
          <div class="resultado-horas">
            <span class="etiqueta-horas">Horas</span>
            <span id="horas-calculadas" class="valor-horas">—</span>
          </div>
        </div>
        <label>Motivo
          <textarea id="sol-motivo" rows="3" required></textarea>
        </label>
        <div class="acciones-form">
          <button type="submit" id="btn-guardar-solicitud">Enviar solicitud</button>
          <button type="button" id="btn-cancelar-edicion" class="secundario oculto">Cancelar edición</button>
        </div>
      </form>
    </section>

    <section class="panel" style="margin-top:20px;">
      <h2>Mis solicitudes</h2>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-mis-solicitudes">
          <thead>
            <tr><th>Fecha</th><th>Horario</th><th>Horas</th><th>Motivo</th><th>Estatus</th><th>Comentario</th><th>Autorizó</th><th>Acción</th></tr>
          </thead>
          <tbody id="tbody-mis-solicitudes"><tr><td colspan="8">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>
  `;

  const form = contenedor.querySelector("#form-solicitud");
  const errorDiv = contenedor.querySelector("#solicitud-error");
  const tbody = contenedor.querySelector("#tbody-mis-solicitudes");
  const inputFecha = contenedor.querySelector("#sol-fecha");
  const inputInicio = contenedor.querySelector("#sol-hora-inicio");
  const inputFin = contenedor.querySelector("#sol-hora-fin");
  const inputMotivo = contenedor.querySelector("#sol-motivo");
  const horasCalculadas = contenedor.querySelector("#horas-calculadas");
  const tituloForm = contenedor.querySelector("#titulo-form-solicitud");
  const btnGuardar = contenedor.querySelector("#btn-guardar-solicitud");
  const btnCancelar = contenedor.querySelector("#btn-cancelar-edicion");

  let editandoId = null;

  function actualizarHorasPreview() {
    if (inputInicio.value && inputFin.value) {
      const horas = calcularHoras(inputInicio.value, inputFin.value);
      horasCalculadas.textContent = horas;
    } else {
      horasCalculadas.textContent = "—";
    }
  }
  inputInicio.addEventListener("input", actualizarHorasPreview);
  inputFin.addEventListener("input", actualizarHorasPreview);

  function entrarModoEdicion(s) {
    editandoId = s.id;
    inputFecha.value = s.fecha;
    inputInicio.value = s.horaInicio;
    inputFin.value = s.horaFin;
    inputMotivo.value = s.motivo;
    actualizarHorasPreview();
    tituloForm.textContent = "Editar solicitud";
    btnGuardar.textContent = "Guardar cambios";
    btnCancelar.classList.remove("oculto");
    form.scrollIntoView({ behavior: "smooth" });
  }

  function salirModoEdicion() {
    editandoId = null;
    form.reset();
    horasCalculadas.textContent = "—";
    tituloForm.textContent = "Nueva solicitud de horas extra";
    btnGuardar.textContent = "Enviar solicitud";
    btnCancelar.classList.add("oculto");
  }

  btnCancelar.addEventListener("click", salirModoEdicion);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorDiv.textContent = "";

    const fecha = inputFecha.value;
    const horaInicio = inputInicio.value;
    const horaFin = inputFin.value;
    const motivo = inputMotivo.value.trim();

    if (!fecha || !horaInicio || !horaFin || !motivo) {
      errorDiv.textContent = "Completa todos los campos.";
      return;
    }

    const horas = calcularHoras(horaInicio, horaFin);
    if (horas <= 0) {
      errorDiv.textContent = "La hora de salida no puede ser igual a la de entrada.";
      return;
    }

    try {
      if (editandoId) {
        await updateDoc(doc(db, "solicitudes", editandoId), {
          fecha,
          horaInicio,
          horaFin,
          horas,
          motivo,
          semanaLaboral: calcularSemanaLaboral(fecha)
        });
        salirModoEdicion();
      } else {
        await addDoc(collection(db, "solicitudes"), {
          empleadoId: uid,
          empleadoNombre: datosUsuario.nombre,
          supervisorId: datosUsuario.supervisorId || null,
          fecha,
          horaInicio,
          horaFin,
          horas,
          motivo,
          semanaLaboral: calcularSemanaLaboral(fecha),
          estatus: "pendiente",
          comentarioRevisor: null,
          revisadoPor: null,
          creadoEn: new Date().toISOString(),
          resueltoEn: null
        });
        form.reset();
        horasCalculadas.textContent = "—";

        // Aviso por correo a quien le toca aprobar (mejor esfuerzo — no
        // bloquea ni afecta el guardado de arriba, que ya quedó hecho).
        avisarNuevaSolicitud({
          datosUsuario,
          asunto: `Nueva solicitud de horas extra de ${datosUsuario.nombre}`,
          mensaje: `<p style="margin:0 0 12px;">${escapeHtml(datosUsuario.nombre)} envió una nueva solicitud de horas extra:</p>
<p style="margin:0 0 4px;"><strong>Fecha:</strong> ${fecha}</p>
<p style="margin:0 0 4px;"><strong>Horario:</strong> ${horaInicio}–${horaFin} (${horas} h)</p>
<p style="margin:0 0 12px;"><strong>Motivo:</strong> ${escapeHtml(motivo)}</p>
<p style="margin:0;color:#555;font-size:0.9em;">Entra a Adrematasa Interno para aprobarla o rechazarla.</p>`,
          tituloBell: "Nueva solicitud de horas extra",
          mensajeBell: `${datosUsuario.nombre} envió una solicitud para tu revisión`,
          fechaEventoBell: `${formatearFechaLarga(fecha)}, ${horaInicio}–${horaFin}`
        });
      }
    } catch (err) {
      errorDiv.textContent = "No se pudo guardar la solicitud: " + err.message;
    }
  });

  const q = query(collection(db, "solicitudes"), where("empleadoId", "==", uid));

  let ultimaLista = [];

  onSnapshot(q, (snap) => {
    ultimaLista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    ultimaLista.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
    renderTabla(ultimaLista);
  }, (err) => {
    errorDiv.textContent = "No se pudieron cargar tus solicitudes: " + err.message;
  });

  function renderTabla(filas) {
    if (filas.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8">Aún no has enviado ninguna solicitud.</td></tr>`;
      return;
    }
    tbody.innerHTML = filas.map(s => `
      <tr data-id="${s.id}">
        <td>${s.fecha}</td>
        <td>${s.horaInicio}–${s.horaFin}</td>
        <td>${s.horas}</td>
        <td>${escapeHtml(s.motivo)}</td>
        <td><span class="badge badge-${s.estatus}">${ETIQUETAS_ESTATUS[s.estatus] || s.estatus}</span></td>
        <td>${s.comentarioRevisor ? escapeHtml(s.comentarioRevisor) : "—"}</td>
        <td>${s.revisadoPorNombre ? escapeHtml(s.revisadoPorNombre) : "—"}</td>
        <td class="acciones">
          ${s.estatus === "pendiente" ? `
            <button type="button" class="btn-editar">Editar</button>
            <button type="button" class="btn-eliminar btn-rechazar">Eliminar</button>
          ` : "—"}
        </td>
      </tr>
    `).join("");

    tbody.querySelectorAll("tr[data-id]").forEach(fila => {
      const id = fila.dataset.id;
      const solicitud = ultimaLista.find(s => s.id === id);
      fila.querySelector(".btn-editar")?.addEventListener("click", () => entrarModoEdicion(solicitud));
      fila.querySelector(".btn-eliminar")?.addEventListener("click", async () => {
        if (!confirm("¿Eliminar esta solicitud? No se puede deshacer.")) return;
        try {
          await deleteDoc(doc(db, "solicitudes", id));
          if (editandoId === id) salirModoEdicion();
        } catch (err) {
          errorDiv.textContent = "No se pudo eliminar la solicitud: " + err.message;
        }
      });
    });
  }
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto || "";
  return div.innerHTML;
}

// "yyyy-mm-dd" -> "24 de agosto" — para la "fecha del evento" de la campanita
// (ver avisoNuevaSolicitud.js / notificaciones.js).
function formatearFechaLarga(fechaStr) {
  const d = new Date(fechaStr + "T00:00:00");
  if (isNaN(d.getTime())) return fechaStr;
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long" });
}