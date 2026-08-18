import { db } from "./firebase-config.js";
import {
  collection, onSnapshot, doc, updateDoc, query, orderBy, runTransaction
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { calcularAniosAntiguedad, diasSegunAntiguedad, suscribirUmbrales, UMBRALES_DEFAULT } from "./vacacionesCalculo.js";
import { suscribirEstructura, esPuestoDeCoordinacion, AREAS_DEFAULT } from "./estructuraOrganizacional.js";

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
      <p class="nota">Por seguridad, no puedes cambiar tu propio rol ni tu propio supervisor. Da clic en "Editar" para ver y cambiar el resto de los datos de cada quien. Los días de vacaciones se actualizan solos según la antigüedad (Ley Federal del Trabajo) en cuanto alguien cumple un nuevo aniversario; los umbrales se ajustan en Configuración.</p>
      <div id="admin-error" class="error"></div>
      <div id="resumen-area-puesto" class="nota"></div>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-usuarios">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Correo</th>
              <th>Estatus</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="tbody-usuarios">
            <tr><td colspan="4">Cargando...</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  `;

  const tbodyPendientes = contenedor.querySelector("#tbody-pendientes-registro");
  const errorPendientesDiv = contenedor.querySelector("#pendientes-error");
  const tbody = contenedor.querySelector("#tbody-usuarios");
  const errorDiv = contenedor.querySelector("#admin-error");
  const resumenAreaPuesto = contenedor.querySelector("#resumen-area-puesto");

  let listaUsuarios = [];
  let umbralesActuales = UMBRALES_DEFAULT;
  let areasActuales = AREAS_DEFAULT;
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

  suscribirEstructura((areas) => {
    areasActuales = areas;
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

  function notaLftTexto(fechaIngreso, umbrales) {
    if (!fechaIngreso) return "Sin fecha de ingreso";
    const anios = calcularAniosAntiguedad(fechaIngreso);
    if (anios === null) return "";
    if (anios < 1) return "Aún no cumple su primer año";
    const dias = diasSegunAntiguedad(anios, umbrales);
    return `LFT: ${dias} días (${anios} ${anios === 1 ? "año" : "años"})`;
  }

  // Le falta área y/o puesto a alguien que ya está activo o pendiente (a los
  // rechazados no vale la pena pedírselo).
  function faltaAreaOPuesto(u) {
    return u.estatus !== "rechazado" && (!u.area || !u.puesto);
  }

  function renderResumenAreaPuesto() {
    const relevantes = listaUsuarios.filter(u => u.estatus !== "rechazado");
    const faltantes = relevantes.filter(faltaAreaOPuesto);

    if (relevantes.length === 0) {
      resumenAreaPuesto.textContent = "";
      return;
    }

    if (faltantes.length === 0) {
      resumenAreaPuesto.textContent = `✅ Los ${relevantes.length} usuarios ya tienen área y puesto asignado.`;
    } else {
      const nombres = faltantes.map(u => u.nombre || u.email).join(", ");
      resumenAreaPuesto.textContent = `⚠ Faltan ${faltantes.length} de ${relevantes.length} por asignar área y/o puesto: ${nombres}.`;
    }
  }

  function renderTabla() {
    renderResumenAreaPuesto();

    if (listaUsuarios.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4">Aún no hay usuarios registrados.</td></tr>`;
      return;
    }

    tbody.innerHTML = listaUsuarios.map(u => {
      const esUnoMismo = u.id === uidActual;
      const falta = faltaAreaOPuesto(u);
      return `
        <tr data-id="${u.id}">
          <td>${escapeHtml(u.nombre || "")} ${esUnoMismo ? '<span class="etiqueta-tu">(tú)</span>' : ""}</td>
          <td>${escapeHtml(u.email || "")}</td>
          <td>${celdaEstatus(u)}</td>
          <td><button type="button" class="secundario btn-editar-usuario${falta ? " btn-editar-alerta" : ""}">${falta ? "⚠ Editar" : "Editar"}</button></td>
        </tr>
      `;
    }).join("");

    tbody.querySelectorAll(".btn-editar-usuario").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.closest("tr").dataset.id;
        const u = listaUsuarios.find(x => x.id === id);
        if (u) abrirModalEditar(u);
      });
    });
  }

  function opcionesArea(areaActual) {
    return [`<option value="">— Selecciona —</option>`]
      .concat(areasActuales.map(a =>
        `<option value="${escapeHtml(a.nombre)}" ${areaActual === a.nombre ? "selected" : ""}>${escapeHtml(a.nombre)}</option>`
      )).join("");
  }

  function opcionesPuesto(nombreArea, puestoActual) {
    if (!nombreArea) return `<option value="">Elige un área primero</option>`;
    const areaObj = areasActuales.find(a => a.nombre === nombreArea);
    const puestos = areaObj ? areaObj.puestos : [];
    if (puestos.length === 0) return `<option value="">Agrega puestos a esta área en Configuración</option>`;
    return [`<option value="">— Selecciona —</option>`]
      .concat(puestos.map(p =>
        `<option value="${escapeHtml(p)}" ${puestoActual === p ? "selected" : ""}>${escapeHtml(p)}</option>`
      )).join("");
  }

  function abrirModalEditar(u) {
    cerrarModal();

    const esUnoMismo = u.id === uidActual;
    const posiblesSupervisores = listaUsuarios.filter(
      s => (s.rol === "supervisor" || s.rol === "admin") && s.id !== u.id
    );

    const celdaRol = esUnoMismo
      ? `<span class="valor-fijo">${escapeHtml(u.rol)}</span>`
      : `<select id="modal-rol">${ROLES.map(r =>
          `<option value="${r}" ${u.rol === r ? "selected" : ""}>${r}</option>`
        ).join("")}</select>`;

    const celdaSupervisor = esUnoMismo
      ? `<span class="valor-fijo">${(() => {
          const s = listaUsuarios.find(x => x.id === u.supervisorId);
          return s ? escapeHtml(s.nombre) : "— Sin asignar —";
        })()}</span>`
      : `<select id="modal-supervisor">${[`<option value="">— Sin asignar —</option>`]
          .concat(posiblesSupervisores.map(s =>
            `<option value="${s.id}" ${u.supervisorId === s.id ? "selected" : ""}>${escapeHtml(s.nombre)}</option>`
          )).join("")}</select>`;

    const diaDescansoActual = u.diaDescanso ?? 0;
    const opcionesDiaDescanso = NOMBRES_DIA.map((nombreDia, i) =>
      `<option value="${i}" ${diaDescansoActual === i ? "selected" : ""}>${nombreDia}</option>`
    ).join("");

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.id = "modal-editar-usuario";
    overlay.innerHTML = `
      <div class="modal-tarjeta">
        <h2>Editar usuario</h2>
        <div id="modal-error" class="error"></div>

        <div class="modal-fila">
          <label>Nombre <span class="valor-fijo">${escapeHtml(u.nombre || "")}</span></label>
          <label>Correo <span class="valor-fijo">${escapeHtml(u.email || "")}</span></label>
          <label>Número de empleado
            <input type="text" id="modal-numero-empleado" maxlength="6" value="${escapeHtml(u.numeroEmpleado || "")}" placeholder="Ej. 045">
          </label>
        </div>

        <div class="modal-fila">
          <label>Rol ${celdaRol}</label>
          <label>Supervisor asignado ${celdaSupervisor}</label>
          <label>Estatus ${celdaEstatus(u)}</label>
        </div>

        <div class="modal-fila">
          <label>Fecha de ingreso
            <input type="date" id="modal-fecha-ingreso" value="${u.fechaIngreso || ""}">
          </label>
          <label>Días vacaciones
            <input type="number" min="0" step="1" id="modal-dias-vacaciones" value="${u.diasVacacionesDisponibles ?? 0}">
            <span class="nota-lft" id="modal-nota-vacaciones">${notaLftTexto(u.fechaIngreso, umbralesActuales)}</span>
          </label>
          <label>Día de descanso
            <select id="modal-dia-descanso">${opcionesDiaDescanso}</select>
          </label>
        </div>

        <div class="modal-fila">
          <label>Área
            <select id="modal-area">${opcionesArea(u.area)}</select>
          </label>
          <label>Puesto
            <select id="modal-puesto">${opcionesPuesto(u.area, u.puesto)}</select>
          </label>
        </div>

        <div class="modal-acciones">
          <button type="button" class="secundario" id="modal-btn-cancelar">Cancelar</button>
          <button type="button" id="modal-btn-guardar">Guardar</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Número de empleado, fecha de ingreso y supervisor son los únicos campos
    // que de verdad pueden quedar "vacíos" (rol, estatus y día de descanso
    // siempre traen un valor por default). Se marcan en rojo mientras falten,
    // y se revisan de nuevo cada vez que el admin los toca.
    const inputNumero = overlay.querySelector("#modal-numero-empleado");
    const inputFecha = overlay.querySelector("#modal-fecha-ingreso");
    const inputDias = overlay.querySelector("#modal-dias-vacaciones");
    const notaVacacionesSpan = overlay.querySelector("#modal-nota-vacaciones");
    const selSupervisorModal = overlay.querySelector("#modal-supervisor");
    const selArea = overlay.querySelector("#modal-area");
    const selPuesto = overlay.querySelector("#modal-puesto");
    const selRolModal = overlay.querySelector("#modal-rol");

    function marcarSiVacio(el) {
      if (!el) return;
      el.classList.toggle("campo-vacio", (el.value ?? "").toString().trim() === "");
    }

    function revisarCamposRequeridos() {
      marcarSiVacio(inputNumero);
      marcarSiVacio(inputFecha);
      marcarSiVacio(selSupervisorModal);
      marcarSiVacio(selArea);
      marcarSiVacio(selPuesto);
    }

    inputNumero?.addEventListener("input", () => marcarSiVacio(inputNumero));
    selSupervisorModal?.addEventListener("change", () => marcarSiVacio(selSupervisorModal));
    inputFecha.addEventListener("change", () => {
      marcarSiVacio(inputFecha);

      const anios = calcularAniosAntiguedad(inputFecha.value);
      if (anios === null) return;
      const dias = diasSegunAntiguedad(anios, umbralesActuales);
      inputDias.value = dias;
      notaVacacionesSpan.textContent = notaLftTexto(inputFecha.value, umbralesActuales);
    });

    // Puesto depende del área elegida (cascada); si el área no tiene puestos
    // capturados, el combobox queda deshabilitado con el aviso.
    function actualizarDisponibilidadPuesto() {
      const areaObj = areasActuales.find(a => a.nombre === selArea.value);
      selPuesto.disabled = !selArea.value || !areaObj || areaObj.puestos.length === 0;
    }

    selArea.addEventListener("change", () => {
      selPuesto.innerHTML = opcionesPuesto(selArea.value, "");
      actualizarDisponibilidadPuesto();
      marcarSiVacio(selArea);
      marcarSiVacio(selPuesto);
    });

    // Un puesto de "Coordinador..." casi siempre implica aprobar solicitudes
    // de su equipo, así que se sugiere el rol de supervisor (el admin lo
    // puede corregir si no aplica).
    selPuesto.addEventListener("change", () => {
      marcarSiVacio(selPuesto);
      if (selRolModal && esPuestoDeCoordinacion(selPuesto.value)) {
        selRolModal.value = "supervisor";
      }
    });

    actualizarDisponibilidadPuesto();
    revisarCamposRequeridos();

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cerrarModal();
    });
    overlay.querySelector("#modal-btn-cancelar").addEventListener("click", cerrarModal);

    overlay.querySelector("#modal-btn-guardar").addEventListener("click", async () => {
      const modalErrorDiv = overlay.querySelector("#modal-error");
      modalErrorDiv.textContent = "";

      const numeroEmpleado = overlay.querySelector("#modal-numero-empleado").value.trim();
      const fechaIngreso = overlay.querySelector("#modal-fecha-ingreso").value || null;
      const diasVacacionesDisponibles = Math.max(0, Math.round(Number(overlay.querySelector("#modal-dias-vacaciones").value) || 0));
      const diaDescanso = Number(overlay.querySelector("#modal-dia-descanso").value);

      const area = overlay.querySelector("#modal-area").value || null;
      const puesto = overlay.querySelector("#modal-puesto").value || null;

      const cambios = {
        fechaIngreso, diasVacacionesDisponibles, diaDescanso,
        numeroEmpleado: numeroEmpleado || null, area, puesto
      };

      if (!esUnoMismo) {
        cambios.rol = overlay.querySelector("#modal-rol").value;
        cambios.supervisorId = overlay.querySelector("#modal-supervisor").value || null;
      }

      try {
        await guardarUsuario(u, cambios);
        cerrarModal();
      } catch (err) {
        modalErrorDiv.textContent = "No se pudo guardar: " + err.message;
      }
    });
  }

  function cerrarModal() {
    document.getElementById("modal-editar-usuario")?.remove();
  }

  // Si cambia el número de empleado, usamos una transacción contra
  // "numerosEmpleado/{numero}" como candado para que dos personas no queden
  // con el mismo número aunque se editen casi al mismo tiempo.
  async function guardarUsuario(u, cambios) {
    const usuarioRef = doc(db, "usuarios", u.id);
    const numeroNuevo = cambios.numeroEmpleado;
    const numeroAnterior = u.numeroEmpleado || null;

    if (numeroNuevo === numeroAnterior) {
      await updateDoc(usuarioRef, cambios);
      return;
    }

    await runTransaction(db, async (tx) => {
      if (numeroNuevo) {
        const refLock = doc(db, "numerosEmpleado", numeroNuevo);
        const lockSnap = await tx.get(refLock);
        if (lockSnap.exists() && lockSnap.data().usuarioId !== u.id) {
          throw new Error(`El número de empleado "${numeroNuevo}" ya está asignado a otra persona.`);
        }
        tx.set(refLock, { usuarioId: u.id });
      }
      if (numeroAnterior) {
        tx.delete(doc(db, "numerosEmpleado", numeroAnterior));
      }
      tx.update(usuarioRef, cambios);
    });
  }
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto;
  return div.innerHTML;
}