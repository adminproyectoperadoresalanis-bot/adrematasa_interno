import { db } from "./firebase-config.js";
import {
  collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, where
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const TIPOS_FALTA = [
  { value: "injustificada", label: "Injustificada", afectaPagoDefault: true },
  { value: "justificada", label: "Justificada", afectaPagoDefault: false },
  { value: "incapacidad", label: "Incapacidad (IMSS)", afectaPagoDefault: false },
  { value: "permiso_con_goce", label: "Permiso con goce de sueldo", afectaPagoDefault: false },
  { value: "permiso_sin_goce", label: "Permiso sin goce de sueldo", afectaPagoDefault: true }
];

const ETIQUETAS_ESTATUS = {
  pendiente: "Pendiente",
  aprobada: "Confirmada",
  rechazada: "Rechazada"
};

const CLASES_ESTATUS = {
  pendiente: "badge-pendiente",
  aprobada: "badge-aprobada",
  rechazada: "badge-rechazada"
};

function etiquetaTipo(valor) {
  return (TIPOS_FALTA.find(t => t.value === valor) || {}).label || valor;
}

function opcionesTipo() {
  return TIPOS_FALTA.map(t => `<option value="${t.value}">${t.label}</option>`).join("");
}

// Formulario de captura compartido entre admin y supervisor.
// listaCapturables() debe devolver, en cada momento, el arreglo de usuarios que se pueden seleccionar
// (todos los activos para admin, solo el equipo para supervisor) — se vuelve a llamar cada vez que llega
// una actualización en vivo de "usuarios", vía actualizarOpcionesEmpleado().
function construirFormularioCaptura(contenedor, { rol, uid, nombre, listaCapturables }) {
  const esAdmin = rol === "admin";

  contenedor.innerHTML = `
    <section class="panel">
      <h2>Registrar falta</h2>
      <p class="nota">
        ${esAdmin
          ? "Captura la falta de cualquier empleado. Queda confirmada de inmediato."
          : "Captura la falta de alguien de tu equipo. Quedará pendiente de que el administrador la confirme."}
      </p>
      <div id="falta-error" class="error"></div>
      <form id="form-falta">
        <label>Empleado
          <select id="falta-empleado" required></select>
        </label>
        <div class="fila-captura">
          <label>Fecha
            <input type="date" id="falta-fecha" required>
          </label>
          <label>Tipo de falta
            <select id="falta-tipo" required>${opcionesTipo()}</select>
          </label>
        </div>
        <label class="campo-checkbox">
          <input type="checkbox" id="falta-afecta-pago">
          Afecta el pago de ese día
        </label>
        <label>Comentario (opcional)
          <textarea id="falta-comentario" rows="2"></textarea>
        </label>
        <button type="submit">Registrar falta</button>
      </form>
    </section>
  `;

  const form = contenedor.querySelector("#form-falta");
  const errorDiv = contenedor.querySelector("#falta-error");
  const selEmpleado = contenedor.querySelector("#falta-empleado");
  const selTipo = contenedor.querySelector("#falta-tipo");
  const chkAfectaPago = contenedor.querySelector("#falta-afecta-pago");
  const inputFecha = contenedor.querySelector("#falta-fecha");
  const inputComentario = contenedor.querySelector("#falta-comentario");

  function actualizarOpcionesEmpleado(lista) {
    const valorPrevio = selEmpleado.value;
    selEmpleado.innerHTML = lista.length === 0
      ? `<option value="">— No hay empleados disponibles —</option>`
      : lista.map(u => `<option value="${u.id}">${escapeHtml(u.nombre || u.email || "")}</option>`).join("");
    if (lista.some(u => u.id === valorPrevio)) selEmpleado.value = valorPrevio;
  }
  actualizarOpcionesEmpleado(listaCapturables());

  function aplicarDefaultAfectaPago() {
    const tipo = TIPOS_FALTA.find(t => t.value === selTipo.value);
    chkAfectaPago.checked = tipo ? tipo.afectaPagoDefault : false;
  }
  selTipo.addEventListener("change", aplicarDefaultAfectaPago);
  aplicarDefaultAfectaPago();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorDiv.textContent = "";

    const listaActual = listaCapturables();
    const empleado = listaActual.find(u => u.id === selEmpleado.value);
    if (!empleado) {
      errorDiv.textContent = "Selecciona un empleado válido.";
      return;
    }
    const fecha = inputFecha.value;
    if (!fecha) {
      errorDiv.textContent = "Selecciona la fecha de la falta.";
      return;
    }
    const tipo = selTipo.value;
    const afectaPago = chkAfectaPago.checked;
    const comentario = inputComentario.value.trim();

    try {
      await addDoc(collection(db, "faltas"), {
        empleadoId: empleado.id,
        empleadoNombre: empleado.nombre || empleado.email || null,
        supervisorId: empleado.supervisorId || null,
        fecha,
        tipo,
        afectaPago,
        comentario: comentario || null,
        capturadoPor: uid,
        capturadoPorNombre: nombre || null,
        capturadoPorRol: rol,
        estatus: esAdmin ? "aprobada" : "pendiente",
        revisadoPor: esAdmin ? uid : null,
        revisadoPorNombre: esAdmin ? (nombre || null) : null,
        resueltoEn: esAdmin ? new Date().toISOString() : null,
        creadoEn: new Date().toISOString()
      });
      form.reset();
      aplicarDefaultAfectaPago();
    } catch (err) {
      errorDiv.textContent = "No se pudo registrar la falta: " + err.message;
    }
  });

  return { actualizarOpcionesEmpleado };
}

export function iniciarGestionFaltas(contenedor, uid, nombre) {
  contenedor.innerHTML = `
    <div id="falta-form-wrap"></div>

    <section class="panel" style="margin-top:20px;">
      <h2>Faltas pendientes de confirmar</h2>
      <p class="nota">Faltas capturadas por un supervisor, esperando que las confirmes o rechaces.</p>
      <div id="pendientes-falta-error" class="error"></div>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-faltas-pendientes">
          <thead>
            <tr><th>Empleado</th><th>Fecha</th><th>Tipo</th><th>Afecta pago</th><th>Comentario</th><th>Capturó</th><th>Acción</th></tr>
          </thead>
          <tbody id="tbody-faltas-pendientes"><tr><td colspan="7">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>

    <section class="panel" style="margin-top:20px;">
      <h2>Historial de faltas</h2>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-faltas-historial">
          <thead>
            <tr><th>Empleado</th><th>Fecha</th><th>Tipo</th><th>Afecta pago</th><th>Estatus</th><th>Comentario</th><th>Capturó</th><th>Confirmó/Rechazó</th></tr>
          </thead>
          <tbody id="tbody-faltas-historial"><tr><td colspan="8">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>
  `;

  let listaUsuarios = [];
  const formWrap = contenedor.querySelector("#falta-form-wrap");
  const { actualizarOpcionesEmpleado } = construirFormularioCaptura(formWrap, {
    rol: "admin",
    uid,
    nombre,
    listaCapturables: () => listaUsuarios.filter(u => u.id !== uid && u.estatus === "activo")
  });

  onSnapshot(collection(db, "usuarios"), (snap) => {
    listaUsuarios = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    actualizarOpcionesEmpleado(listaUsuarios.filter(u => u.id !== uid && u.estatus === "activo"));
  });

  const errorPendientesDiv = contenedor.querySelector("#pendientes-falta-error");
  const tbodyPendientes = contenedor.querySelector("#tbody-faltas-pendientes");
  const tbodyHistorial = contenedor.querySelector("#tbody-faltas-historial");

  onSnapshot(collection(db, "faltas"), (snap) => {
    const todas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    todas.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));

    renderPendientes(todas.filter(f => f.estatus === "pendiente"));
    renderHistorial(todas.filter(f => f.estatus !== "pendiente"));
  }, (err) => {
    errorPendientesDiv.textContent = "No se pudieron cargar las faltas: " + err.message;
  });

  function renderPendientes(lista) {
    if (lista.length === 0) {
      tbodyPendientes.innerHTML = `<tr><td colspan="7">No hay faltas pendientes de confirmar.</td></tr>`;
      return;
    }
    tbodyPendientes.innerHTML = lista.map(f => `
      <tr data-id="${f.id}">
        <td>${escapeHtml(f.empleadoNombre || "")}</td>
        <td>${f.fecha}</td>
        <td>${etiquetaTipo(f.tipo)}</td>
        <td>${f.afectaPago ? "Sí" : "No"}</td>
        <td>${f.comentario ? escapeHtml(f.comentario) : "—"}</td>
        <td>${escapeHtml(f.capturadoPorNombre || "")}</td>
        <td class="acciones">
          <button type="button" class="btn-aprobar">Confirmar</button>
          <button type="button" class="btn-rechazar">Rechazar</button>
        </td>
      </tr>
    `).join("");

    tbodyPendientes.querySelectorAll("tr[data-id]").forEach(fila => {
      const id = fila.dataset.id;
      fila.querySelector(".btn-aprobar").addEventListener("click", () => resolverFalta(id, "aprobada"));
      fila.querySelector(".btn-rechazar").addEventListener("click", () => resolverFalta(id, "rechazada"));
    });
  }

  function renderHistorial(lista) {
    if (lista.length === 0) {
      tbodyHistorial.innerHTML = `<tr><td colspan="8">Todavía no hay faltas confirmadas o rechazadas.</td></tr>`;
      return;
    }
    tbodyHistorial.innerHTML = lista.map(f => `
      <tr>
        <td>${escapeHtml(f.empleadoNombre || "")}</td>
        <td>${f.fecha}</td>
        <td>${etiquetaTipo(f.tipo)}</td>
        <td>${f.afectaPago ? "Sí" : "No"}</td>
        <td><span class="badge ${CLASES_ESTATUS[f.estatus] || "badge-pendiente"}">${ETIQUETAS_ESTATUS[f.estatus] || f.estatus}</span></td>
        <td>${f.comentario ? escapeHtml(f.comentario) : "—"}</td>
        <td>${escapeHtml(f.capturadoPorNombre || "")}</td>
        <td>${f.revisadoPorNombre ? escapeHtml(f.revisadoPorNombre) : "—"}</td>
      </tr>
    `).join("");
  }

  async function resolverFalta(id, estatus) {
    errorPendientesDiv.textContent = "";
    try {
      await updateDoc(doc(db, "faltas", id), {
        estatus,
        revisadoPor: uid,
        revisadoPorNombre: nombre || null,
        resueltoEn: new Date().toISOString()
      });
    } catch (err) {
      errorPendientesDiv.textContent = "No se pudo actualizar la falta: " + err.message;
    }
  }
}

export function iniciarVistaSupervisorFaltas(contenedor, uid, nombre) {
  contenedor.innerHTML = `
    <div id="falta-form-wrap"></div>

    <section class="panel" style="margin-top:20px;">
      <h2>Historial de faltas de mi equipo</h2>
      <div id="faltas-sup-error" class="error"></div>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-faltas-equipo">
          <thead>
            <tr><th>Empleado</th><th>Fecha</th><th>Tipo</th><th>Afecta pago</th><th>Estatus</th><th>Comentario</th><th>Acción</th></tr>
          </thead>
          <tbody id="tbody-faltas-equipo"><tr><td colspan="7">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>
  `;

  let equipo = [];
  const formWrap = contenedor.querySelector("#falta-form-wrap");
  const { actualizarOpcionesEmpleado } = construirFormularioCaptura(formWrap, {
    rol: "supervisor",
    uid,
    nombre,
    listaCapturables: () => equipo.filter(u => u.estatus === "activo")
  });

  onSnapshot(query(collection(db, "usuarios"), where("supervisorId", "==", uid)), (snap) => {
    equipo = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    actualizarOpcionesEmpleado(equipo.filter(u => u.estatus === "activo"));
  });

  const errorDiv = contenedor.querySelector("#faltas-sup-error");
  const tbody = contenedor.querySelector("#tbody-faltas-equipo");

  onSnapshot(query(collection(db, "faltas"), where("supervisorId", "==", uid)), (snap) => {
    const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    lista.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
    render(lista);
  }, (err) => {
    errorDiv.textContent = "No se pudieron cargar las faltas: " + err.message;
  });

  function render(lista) {
    if (lista.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7">Todavía no has registrado faltas de tu equipo.</td></tr>`;
      return;
    }
    tbody.innerHTML = lista.map(f => `
      <tr data-id="${f.id}">
        <td>${escapeHtml(f.empleadoNombre || "")}</td>
        <td>${f.fecha}</td>
        <td>${etiquetaTipo(f.tipo)}</td>
        <td>${f.afectaPago ? "Sí" : "No"}</td>
        <td><span class="badge ${CLASES_ESTATUS[f.estatus] || "badge-pendiente"}">${ETIQUETAS_ESTATUS[f.estatus] || f.estatus}</span></td>
        <td>${f.comentario ? escapeHtml(f.comentario) : "—"}</td>
        <td class="acciones">
          ${f.estatus === "pendiente" && f.capturadoPor === uid ? `<button type="button" class="btn-eliminar btn-rechazar">Eliminar</button>` : "—"}
        </td>
      </tr>
    `).join("");

    tbody.querySelectorAll(".btn-eliminar").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.closest("tr").dataset.id;
        if (!confirm("¿Eliminar este registro de falta? No se puede deshacer.")) return;
        try {
          await deleteDoc(doc(db, "faltas", id));
        } catch (err) {
          errorDiv.textContent = "No se pudo eliminar: " + err.message;
        }
      });
    });
  }
}

export function iniciarVistaEmpleadoFaltas(contenedor, datosUsuario, uid) {
  contenedor.innerHTML = `
    <section class="panel">
      <h2>Mis faltas</h2>
      <p class="nota">Registro de faltas capturadas por tu supervisor o el administrador. Si algo no es correcto, coméntalo con ellos.</p>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-mis-faltas">
          <thead>
            <tr><th>Fecha</th><th>Tipo</th><th>Afecta pago</th><th>Estatus</th><th>Comentario</th></tr>
          </thead>
          <tbody id="tbody-mis-faltas"><tr><td colspan="5">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>
  `;

  const tbody = contenedor.querySelector("#tbody-mis-faltas");

  onSnapshot(query(collection(db, "faltas"), where("empleadoId", "==", uid)), (snap) => {
    const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    lista.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
    if (lista.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5">No tienes faltas registradas.</td></tr>`;
      return;
    }
    tbody.innerHTML = lista.map(f => `
      <tr>
        <td>${f.fecha}</td>
        <td>${etiquetaTipo(f.tipo)}</td>
        <td>${f.afectaPago ? "Sí" : "No"}</td>
        <td><span class="badge ${CLASES_ESTATUS[f.estatus] || "badge-pendiente"}">${ETIQUETAS_ESTATUS[f.estatus] || f.estatus}</span></td>
        <td>${f.comentario ? escapeHtml(f.comentario) : "—"}</td>
      </tr>
    `).join("");
  });
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto || "";
  return div.innerHTML;
}