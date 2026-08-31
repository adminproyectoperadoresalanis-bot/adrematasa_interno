import { db } from "./firebase-config.js";
import {
  collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, where, getDoc
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { abrirFormatoVacacionesImprimir } from "./formatoVacaciones.js";
import { avisarNuevaSolicitud } from "./avisoNuevaSolicitud.js";

const ETIQUETAS_ESTATUS = {
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  rechazada: "Rechazada"
};

const NOMBRES_DIA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// diaDescanso: 0=domingo ... 6=sabado — el único día de la semana que no cuenta como hábil para este empleado.
function calcularDiasHabiles(fechaInicioStr, fechaFinStr, diaDescanso) {
  const inicio = new Date(fechaInicioStr + "T00:00:00");
  const fin = new Date(fechaFinStr + "T00:00:00");
  if (fin < inicio) return 0;
  let dias = 0;
  const cursor = new Date(inicio);
  while (cursor <= fin) {
    if (cursor.getDay() !== diaDescanso) dias++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return dias;
}

export function iniciarVistaVacacionesEmpleado(contenedor, datosUsuario, uid) {
  contenedor.innerHTML = `
    <section class="panel">
      <h2 id="titulo-form-vacaciones">Nueva solicitud de vacaciones</h2>
      <div class="tarjeta-saldo">Saldo disponible: <strong id="saldo-dias">—</strong> día(s) · Tu día de descanso: <strong id="dia-descanso-texto">—</strong></div>
      <div id="vacaciones-error" class="error"></div>
      <form id="form-vacaciones">
        <div class="fila-captura">
          <label>Fecha de inicio
            <input type="date" id="vac-fecha-inicio" required>
          </label>
          <label>Fecha de fin
            <input type="date" id="vac-fecha-fin" required>
          </label>
          <div class="resultado-horas">
            <span class="etiqueta-horas">Días hábiles</span>
            <span id="dias-calculados" class="valor-horas">—</span>
          </div>
        </div>
        <label>Motivo (opcional)
          <textarea id="vac-motivo" rows="2"></textarea>
        </label>
        <div class="acciones-form">
          <button type="submit" id="btn-guardar-vacaciones">Enviar solicitud</button>
          <button type="button" id="btn-cancelar-edicion-vac" class="secundario oculto">Cancelar edición</button>
        </div>
      </form>
    </section>

    <section class="panel" style="margin-top:20px;">
      <h2>Mis solicitudes de vacaciones</h2>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-mis-vacaciones">
          <thead>
            <tr><th>Inicio</th><th>Fin</th><th>Días</th><th>Motivo</th><th>Estatus</th><th>Comentario</th><th>Autorizó</th><th>Acción</th></tr>
          </thead>
          <tbody id="tbody-mis-vacaciones"><tr><td colspan="8">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>
  `;

  const form = contenedor.querySelector("#form-vacaciones");
  const errorDiv = contenedor.querySelector("#vacaciones-error");
  const tbody = contenedor.querySelector("#tbody-mis-vacaciones");
  const inputInicio = contenedor.querySelector("#vac-fecha-inicio");
  const inputFin = contenedor.querySelector("#vac-fecha-fin");
  const inputMotivo = contenedor.querySelector("#vac-motivo");
  const diasCalculados = contenedor.querySelector("#dias-calculados");
  const saldoSpan = contenedor.querySelector("#saldo-dias");
  const diaDescansoSpan = contenedor.querySelector("#dia-descanso-texto");
  const tituloForm = contenedor.querySelector("#titulo-form-vacaciones");
  const btnGuardar = contenedor.querySelector("#btn-guardar-vacaciones");
  const btnCancelar = contenedor.querySelector("#btn-cancelar-edicion-vac");

  let editandoId = null;
  let saldoActual = 0;
  let diaDescansoActual = datosUsuario.diaDescanso ?? 0;
  // Copia siempre fresca del usuario (número de empleado, área, puesto, fecha
  // de ingreso...) para que el formato ATAF050 imprima datos al día aunque el
  // admin los haya editado después de que esta pantalla se abrió.
  let datosUsuarioActuales = datosUsuario;

  // Saldo y día de descanso en vivo: si el admin los cambia mientras el empleado tiene la app abierta, se actualizan solos.
  onSnapshot(doc(db, "usuarios", uid), (snap) => {
    const datos = snap.data() || {};
    datosUsuarioActuales = datos;
    saldoActual = datos.diasVacacionesDisponibles || 0;
    saldoSpan.textContent = saldoActual;
    diaDescansoActual = datos.diaDescanso ?? 0;
    diaDescansoSpan.textContent = NOMBRES_DIA[diaDescansoActual];
    actualizarDiasPreview();
  });

  function actualizarDiasPreview() {
    if (inputInicio.value && inputFin.value) {
      const dias = calcularDiasHabiles(inputInicio.value, inputFin.value, diaDescansoActual);
      diasCalculados.textContent = dias;
    } else {
      diasCalculados.textContent = "—";
    }
  }
  inputInicio.addEventListener("input", actualizarDiasPreview);
  inputFin.addEventListener("input", actualizarDiasPreview);

  function entrarModoEdicion(s) {
    editandoId = s.id;
    inputInicio.value = s.fechaInicio;
    inputFin.value = s.fechaFin;
    inputMotivo.value = s.motivo || "";
    actualizarDiasPreview();
    tituloForm.textContent = "Editar solicitud de vacaciones";
    btnGuardar.textContent = "Guardar cambios";
    btnCancelar.classList.remove("oculto");
    form.scrollIntoView({ behavior: "smooth" });
  }

  function salirModoEdicion() {
    editandoId = null;
    form.reset();
    diasCalculados.textContent = "—";
    tituloForm.textContent = "Nueva solicitud de vacaciones";
    btnGuardar.textContent = "Enviar solicitud";
    btnCancelar.classList.add("oculto");
  }

  btnCancelar.addEventListener("click", salirModoEdicion);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorDiv.textContent = "";

    const fechaInicio = inputInicio.value;
    const fechaFin = inputFin.value;
    const motivo = inputMotivo.value.trim();

    if (!fechaInicio || !fechaFin) {
      errorDiv.textContent = "Completa la fecha de inicio y de fin.";
      return;
    }

    const diasHabiles = calcularDiasHabiles(fechaInicio, fechaFin, diaDescansoActual);
    if (diasHabiles <= 0) {
      errorDiv.textContent = "La fecha de fin debe ser igual o posterior a la de inicio (y cubrir al menos un día hábil).";
      return;
    }
    if (diasHabiles > saldoActual) {
      errorDiv.textContent = `No tienes suficiente saldo: solicitas ${diasHabiles} día(s) y tienes ${saldoActual} disponible(s).`;
      return;
    }

    try {
      if (editandoId) {
        await updateDoc(doc(db, "solicitudesVacaciones", editandoId), {
          fechaInicio,
          fechaFin,
          diasHabiles,
          motivo: motivo || null
        });
        salirModoEdicion();
      } else {
        await addDoc(collection(db, "solicitudesVacaciones"), {
          empleadoId: uid,
          empleadoNombre: datosUsuario.nombre,
          supervisorId: datosUsuario.supervisorId || null,
          fechaInicio,
          fechaFin,
          diasHabiles,
          motivo: motivo || null,
          estatus: "pendiente",
          comentarioRevisor: null,
          revisadoPor: null,
          revisadoPorNombre: null,
          creadoEn: new Date().toISOString(),
          resueltoEn: null
        });
        form.reset();
        diasCalculados.textContent = "—";

        // Aviso por correo a quien le toca aprobar (mejor esfuerzo — no
        // bloquea ni afecta el guardado de arriba, que ya quedó hecho).
        avisarNuevaSolicitud({
          datosUsuario,
          asunto: `Nueva solicitud de vacaciones de ${datosUsuario.nombre}`,
          mensaje: `<p style="margin:0 0 12px;">${escapeHtml(datosUsuario.nombre)} envió una nueva solicitud de vacaciones:</p>
<p style="margin:0 0 4px;"><strong>Del:</strong> ${fechaInicio} <strong>al:</strong> ${fechaFin} (${diasHabiles} día${diasHabiles === 1 ? "" : "s"} hábil${diasHabiles === 1 ? "" : "es"})</p>
${motivo ? `<p style="margin:0 0 12px;"><strong>Motivo:</strong> ${escapeHtml(motivo)}</p>` : ""}
<p style="margin:0;color:#555;font-size:0.9em;">Entra a Adrematasa Interno para aprobarla o rechazarla.</p>`,
          tituloBell: "Nueva solicitud de vacaciones",
          mensajeBell: `${datosUsuario.nombre} envió una solicitud para tu revisión`,
          fechaEventoBell: formatearRangoFechas(fechaInicio, fechaFin)
        });
      }
    } catch (err) {
      errorDiv.textContent = "No se pudo guardar la solicitud: " + err.message;
    }
  });

  const q = query(collection(db, "solicitudesVacaciones"), where("empleadoId", "==", uid));

  let ultimaLista = [];

  onSnapshot(q, (snap) => {
    ultimaLista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    ultimaLista.sort((a, b) => (b.fechaInicio || "").localeCompare(a.fechaInicio || ""));
    renderTabla(ultimaLista);
  }, (err) => {
    errorDiv.textContent = "No se pudieron cargar tus solicitudes: " + err.message;
  });

  function renderTabla(filas) {
    if (filas.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8">Aún no has enviado ninguna solicitud de vacaciones.</td></tr>`;
      return;
    }
    tbody.innerHTML = filas.map(s => `
      <tr data-id="${s.id}">
        <td>${s.fechaInicio}</td>
        <td>${s.fechaFin}</td>
        <td>${s.diasHabiles}</td>
        <td>${s.motivo ? escapeHtml(s.motivo) : "—"}</td>
        <td><span class="badge badge-${s.estatus}">${ETIQUETAS_ESTATUS[s.estatus] || s.estatus}</span></td>
        <td>${s.comentarioRevisor ? escapeHtml(s.comentarioRevisor) : "—"}</td>
        <td>${s.revisadoPorNombre ? escapeHtml(s.revisadoPorNombre) : "—"}</td>
        <td class="acciones">
          ${s.estatus === "pendiente" ? `
            <button type="button" class="btn-editar">Editar</button>
            <button type="button" class="btn-eliminar btn-rechazar">Eliminar</button>
          ` : s.estatus === "aprobada" ? `
            <button type="button" class="secundario btn-imprimir-formato">Imprimir formato</button>
          ` : "—"}
        </td>
      </tr>
    `).join("");

    tbody.querySelectorAll("tr[data-id]").forEach(fila => {
      const id = fila.dataset.id;
      const solicitud = ultimaLista.find(s => s.id === id);
      fila.querySelector(".btn-editar")?.addEventListener("click", () => entrarModoEdicion(solicitud));
      fila.querySelector(".btn-imprimir-formato")?.addEventListener("click", () => {
        abrirFormatoVacacionesImprimir(solicitud, datosUsuarioActuales, saldoActual, diaDescansoActual);
      });
      fila.querySelector(".btn-eliminar")?.addEventListener("click", async () => {
        if (!confirm("¿Eliminar esta solicitud de vacaciones? No se puede deshacer.")) return;
        try {
          await deleteDoc(doc(db, "solicitudesVacaciones", id));
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

// Rango de dos "yyyy-mm-dd": mismo día -> "12 de noviembre"; mismo mes ->
// "12 al 15 de noviembre"; meses distintos -> "26 sep al 3 oct".
function formatearRangoFechas(inicioStr, finStr) {
  if (inicioStr === finStr) return formatearFechaLarga(inicioStr);
  const inicio = new Date(inicioStr + "T00:00:00");
  const fin = new Date(finStr + "T00:00:00");
  if (isNaN(inicio.getTime()) || isNaN(fin.getTime())) return `${inicioStr} al ${finStr}`;
  const mismoMes = inicio.getMonth() === fin.getMonth() && inicio.getFullYear() === fin.getFullYear();
  if (mismoMes) {
    const mesLargo = fin.toLocaleDateString("es-MX", { month: "long" });
    return `${inicio.getDate()} al ${fin.getDate()} de ${mesLargo}`;
  }
  const corto = (d) => d.toLocaleDateString("es-MX", { day: "numeric", month: "short" }).replace(".", "");
  return `${corto(inicio)} al ${corto(fin)}`;
}