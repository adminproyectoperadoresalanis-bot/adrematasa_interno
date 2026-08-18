import { db } from "./firebase-config.js";
import {
  collection, onSnapshot, doc, updateDoc, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { calcularAniosAntiguedad, diasSegunAntiguedad, suscribirUmbrales, UMBRALES_DEFAULT } from "./vacacionesCalculo.js";

const ROLES = ["empleado", "supervisor", "admin"];

const ETIQUETAS_ESTATUS = {
  pendiente: "Pendiente",
  activo: "Activo",
  rechazado: "Rechazado"
};

const CLASES_ESTATUS = {
  pendiente: "badge-pendiente",
  activo: "badge-aprobada",
  rechazado: "badge-rechazada"
};

const NOMBRES_DIA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export function iniciarPanelAdmin(contenedor, uidActual) {
  contenedor.innerHTML = `
    <section class="panel">
      <h2>Registros pendientes</h2>
      <p class="nota">Cuentas nuevas que se registraron con su correo Alanis y esperan que les asignes rol y supervisor para poder usar la app.</p>
      <div id="pendientes-error" class="error"></div>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-pendientes-registro">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Correo</th>
              <th>Rol a asignar</th>
              <th>Supervisor asignado</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody id="tbody-pendientes-registro">
            <tr><td colspan="5">Cargando...</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel" style="margin-top:20px;">
      <h2>Usuarios</h2>
      <p class="nota">Por seguridad, no puedes cambiar tu propio rol ni tu propio supervisor desde aquí — solo los de los demás. Los días de vacaciones se actualizan solos según la antigüedad (Ley Federal del Trabajo) en cuanto alguien cumple un nuevo aniversario; los umbrales se ajustan en Configuración.</p>
      <div id="admin-error" class="error"></div>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-usuarios">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Correo</th>
              <th>Rol</th>
              <th>Supervisor asignado</th>
              <th>Fecha de ingreso</th>
              <th>Días vacaciones</th>
              <th>Día de descanso</th>
              <th>Estatus</th>
            </tr>
          </thead>
          <tbody id="tbody-usuarios">
            <tr><td colspan="8">Cargando...</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  `;

  const tbodyPendientes = contenedor.querySelector("#tbody-pendientes-registro");
  const errorPendientesDiv = contenedor.querySelector("#pendientes-error");
  const tbody = contenedor.querySelector("#tbody-usuarios");
  const errorDiv = contenedor.querySelector("#admin-error");

  let listaUsuarios = [];
  let umbralesActuales = UMBRALES_DEFAULT;
  const aplicandoIds = new Set();

  const q = query(collection(db, "usuarios"), orderBy("nombre"));

  onSnapshot(q, (snap) => {
    listaUsuarios = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    aplicarCalculoAutomatico();
    renderPendientes();
    renderTabla();
  }, (err) => {
    errorDiv.textContent = "No se pudo cargar la lista de usuarios: " + err.message;
  });

  suscribirUmbrales((umbrales) => {
    umbralesActuales = umbrales;
    aplicarCalculoAutomatico();
    renderTabla();
  });

  // Cuando alguien cumple un nuevo año de antigüedad, reemplaza su saldo de
  // días de vacaciones por el que le corresponde según la tabla de la LFT.
  // Solo se aplica una vez por aniversario (usa vacacionesAplicadasAnio para
  // no volver a pisar el saldo si el admin lo ajustó manualmente después).
  function aplicarCalculoAutomatico() {
    listaUsuarios.forEach(u => {
      if (!u.fechaIngreso || aplicandoIds.has(u.id)) return;

      const anios = calcularAniosAntiguedad(u.fechaIngreso);
      if (anios === null || anios < 1) return;

      const diasSugeridos = diasSegunAntiguedad(anios, umbralesActuales);
      if (diasSugeridos <= 0 || u.vacacionesAplicadasAnio === anios) return;

      aplicandoIds.add(u.id);
      updateDoc(doc(db, "usuarios", u.id), {
        diasVacacionesDisponibles: diasSugeridos,
        vacacionesAplicadasAnio: anios,
        fechaUltimoCalculoVacaciones: new Date().toISOString()
      }).catch(err => {
        errorDiv.textContent = `No se pudo actualizar automáticamente los días de ${u.nombre}: ${err.message}`;
      }).finally(() => {
        aplicandoIds.delete(u.id);
      });
    });
  }

  function renderPendientes() {
    const pendientes = listaUsuarios.filter(u => u.estatus === "pendiente");
    const posiblesSupervisores = listaUsuarios.filter(
      u => u.rol === "supervisor" || u.rol === "admin"
    );

    if (pendientes.length === 0) {
      tbodyPendientes.innerHTML = `<tr><td colspan="5">No hay registros pendientes.</td></tr>`;
      return;
    }

    const opcionesSupervisor = [`<option value="">— Sin asignar —</option>`]
      .concat(posiblesSupervisores.map(s => `<option value="${s.id}">${escapeHtml(s.nombre)}</option>`))
      .join("");

    tbodyPendientes.innerHTML = pendientes.map(u => `
      <tr data-id="${u.id}">
        <td>${escapeHtml(u.nombre || "")}</td>
        <td>${escapeHtml(u.email || "")}</td>
        <td>
          <select class="sel-rol-nuevo">
            <option value="empleado">empleado</option>
            <option value="supervisor">supervisor</option>
          </select>
        </td>
        <td><select class="sel-supervisor-nuevo">${opcionesSupervisor}</select></td>
        <td class="acciones">
          <button type="button" class="btn-aprobar">Aprobar</button>
          <button type="button" class="btn-rechazar">Rechazar</button>
        </td>
      </tr>
    `).join("");

    tbodyPendientes.querySelectorAll("tr[data-id]").forEach(fila => {
      const id = fila.dataset.id;
      const selRol = fila.querySelector(".sel-rol-nuevo");
      const selSupervisor = fila.querySelector(".sel-supervisor-nuevo");
      fila.querySelector(".btn-aprobar").addEventListener("click", () => {
        aprobarRegistro(id, selRol.value, selSupervisor.value || null);
      });
      fila.querySelector(".btn-rechazar").addEventListener("click", () => {
        if (!confirm("¿Rechazar este registro? La persona no podrá usar la app.")) return;
        rechazarRegistro(id);
      });
    });
  }

  async function aprobarRegistro(id, rol, supervisorId) {
    errorPendientesDiv.textContent = "";
    try {
      await updateDoc(doc(db, "usuarios", id), { rol, supervisorId, estatus: "activo" });
    } catch (err) {
      errorPendientesDiv.textContent = "No se pudo aprobar el registro: " + err.message;
    }
  }

  async function rechazarRegistro(id) {
    errorPendientesDiv.textContent = "";
    try {
      await updateDoc(doc(db, "usuarios", id), { estatus: "rechazado" });
    } catch (err) {
      errorPendientesDiv.textContent = "No se pudo rechazar el registro: " + err.message;
    }
  }

  function celdaEstatus(u) {
    const estatus = u.estatus || "activo";
    const clase = CLASES_ESTATUS[estatus] || "badge-pendiente";
    return `<span class="badge ${clase}">${ETIQUETAS_ESTATUS[estatus] || estatus}</span>`;
  }

  function notaLft(u) {
    if (!u.fechaIngreso) return `<div class="nota-lft">Sin fecha de ingreso</div>`;
    const anios = calcularAniosAntiguedad(u.fechaIngreso);
    if (anios === null) return "";
    if (anios < 1) return `<div class="nota-lft">Aún no cumple su primer año</div>`;
    const dias = diasSegunAntiguedad(anios, umbralesActuales);
    return `<div class="nota-lft">LFT: ${dias} días (${anios} ${anios === 1 ? "año" : "años"})</div>`;
  }

  function renderTabla() {
    if (listaUsuarios.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8">Aún no hay usuarios registrados.</td></tr>`;
      return;
    }

    const posiblesSupervisores = listaUsuarios.filter(
      u => u.rol === "supervisor" || u.rol === "admin"
    );

    tbody.innerHTML = listaUsuarios.map(u => {
      const esUnoMismo = u.id === uidActual;

      const celdaRol = esUnoMismo
        ? `<span class="valor-fijo">${escapeHtml(u.rol)}</span>`
        : `<select class="sel-rol">${ROLES.map(r =>
            `<option value="${r}" ${u.rol === r ? "selected" : ""}>${r}</option>`
          ).join("")}</select>`;

      if (esUnoMismo) {
        const supervisorActual = listaUsuarios.find(s => s.id === u.supervisorId);
        const celdaSupervisor = `<span class="valor-fijo">${supervisorActual ? escapeHtml(supervisorActual.nombre) : "— Sin asignar —"}</span>`;
        return `
          <tr data-id="${u.id}">
            <td>${escapeHtml(u.nombre || "")} <span class="etiqueta-tu">(tú)</span></td>
            <td>${escapeHtml(u.email || "")}</td>
            <td>${celdaRol}</td>
            <td>${celdaSupervisor}</td>
            <td><input type="date" class="input-fecha-ingreso" value="${u.fechaIngreso || ""}"></td>
            <td><span class="valor-fijo">${u.diasVacacionesDisponibles ?? 0}</span>${notaLft(u)}</td>
            <td><span class="valor-fijo">${NOMBRES_DIA[u.diaDescanso ?? 0]}</span></td>
            <td>${celdaEstatus(u)}</td>
          </tr>
        `;
      }

      const opcionesSupervisor = [`<option value="">— Sin asignar —</option>`]
        .concat(posiblesSupervisores
          .filter(s => s.id !== u.id)
          .map(s => `<option value="${s.id}" ${u.supervisorId === s.id ? "selected" : ""}>${escapeHtml(s.nombre)}</option>`)
        ).join("");

      const diaDescansoActual = u.diaDescanso ?? 0;
      const opcionesDiaDescanso = NOMBRES_DIA.map((nombreDia, i) =>
        `<option value="${i}" ${diaDescansoActual === i ? "selected" : ""}>${nombreDia}</option>`
      ).join("");

      return `
        <tr data-id="${u.id}">
          <td>${escapeHtml(u.nombre || "")}</td>
          <td>${escapeHtml(u.email || "")}</td>
          <td>${celdaRol}</td>
          <td><select class="sel-supervisor">${opcionesSupervisor}</select></td>
          <td><input type="date" class="input-fecha-ingreso" value="${u.fechaIngreso || ""}"></td>
          <td>
            <input type="number" min="0" step="1" class="input-dias-vacaciones" value="${u.diasVacacionesDisponibles ?? 0}">
            ${notaLft(u)}
          </td>
          <td><select class="sel-dia-descanso">${opcionesDiaDescanso}</select></td>
          <td>${celdaEstatus(u)}</td>
        </tr>
      `;
    }).join("");

    tbody.querySelectorAll("tr[data-id]").forEach(fila => {
      const id = fila.dataset.id;
      fila.querySelector(".sel-rol")?.addEventListener("change", (e) => {
        guardarCambio(id, { rol: e.target.value });
      });
      fila.querySelector(".sel-supervisor")?.addEventListener("change", (e) => {
        guardarCambio(id, { supervisorId: e.target.value || null });
      });
      fila.querySelector(".input-fecha-ingreso")?.addEventListener("change", (e) => {
        guardarCambio(id, { fechaIngreso: e.target.value || null });
      });
      fila.querySelector(".input-dias-vacaciones")?.addEventListener("change", (e) => {
        const dias = Math.max(0, Math.round(Number(e.target.value) || 0));
        e.target.value = dias;
        guardarCambio(id, { diasVacacionesDisponibles: dias });
      });
      fila.querySelector(".sel-dia-descanso")?.addEventListener("change", (e) => {
        guardarCambio(id, { diaDescanso: Number(e.target.value) });
      });
    });
  }

  async function guardarCambio(id, cambios) {
    errorDiv.textContent = "";
    try {
      await updateDoc(doc(db, "usuarios", id), cambios);
    } catch (err) {
      errorDiv.textContent = "No se pudo guardar el cambio: " + err.message;
    }
  }
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto;
  return div.innerHTML;
}