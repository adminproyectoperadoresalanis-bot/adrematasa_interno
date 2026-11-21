// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/public/js/faltas.js
// ##########################################################################
// 2026-11-20 (pedido de Ivan): el tipo de falta dice siempre si se paga — solo
// CON GOCE DE SUELDO, SIN GOCE DE SUELDO o INCAPACIDAD IMSS; cualquier detalle
// va en observaciones. Las faltas viejas se muestran convertidas (ver
// reportesHtml.js); las "Justificadas" salen POR DEFINIR hasta que el admin
// elija con o sin goce. El admin puede corregir una falta que ya se mandó a
// nómina (correccionesNomina.js).
import { db } from "./firebase-config.js";
import {
  collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, where
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { TIPOS_FALTA, etiquetaTipoFalta, faltaEnRojo, tipoFaltaNormalizado } from "./reportesHtml.js";
import { abrirCorregirFalta, chipCorregida } from "./correccionesNomina.js";

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

// Tipo de falta para las tablas (en rojo lo que no se paga o falta definir).
function etiquetaTipo(valor) {
  const txt = escapeHtml(etiquetaTipoFalta(valor));
  return faltaEnRojo(valor) ? `<b style="color:#a32424;">${txt}</b>` : `<b>${txt}</b>`;
}

function opcionesTipo() {
  return `<option value="">Elige…</option>` + TIPOS_FALTA.map(t => `<option value="${t.value}">${t.label}</option>`).join("");
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
        <label>Observaciones (opcional)
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
    if (!tipo) {
      errorDiv.textContent = "Elige el tipo de falta: con goce, sin goce o incapacidad IMSS.";
      return;
    }
    const afectaPago = tipo === "sin_goce";
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
            <tr><th>Empleado</th><th>Fecha</th><th>Tipo</th><th>Observaciones</th><th>Capturó</th><th>Acción</th></tr>
          </thead>
          <tbody id="tbody-faltas-pendientes"><tr><td colspan="6">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>

    <section class="panel" style="margin-top:20px;">
      <h2>Historial de faltas</h2>
      <style>
        /* Historial compacto (2026-11-20), igual que el de horas extra. */
        .fh-top{display:flex;gap:12px;align-items:center;margin-bottom:12px;}
        .fh-buscar{flex:1;display:flex;align-items:center;gap:8px;border:1px solid #d9d0c4;border-radius:10px;padding:0 12px;background:#fff;}
        .fh-buscar input{flex:1;border:none;outline:none;padding:10px 0;font-size:15px;background:transparent;min-width:0;}
        .fh-limpiar{border:none;background:none;color:#9a8d7e;font-size:16px;cursor:pointer;padding:4px;display:none;}
        .fh-cont{font-size:13px;color:#6b5f52;white-space:nowrap;}
        #tabla-faltas-historial{table-layout:fixed;width:100%;min-width:0;}
        #tabla-faltas-historial td{vertical-align:top;overflow-wrap:anywhere;white-space:normal;}
        #tabla-faltas-historial .badge{display:inline-block;margin:0 4px 4px 0;white-space:nowrap;}
        #tabla-faltas-historial .fh-sm{font-size:12.5px;color:#6b5f52;margin-top:2px;}
        #tabla-faltas-historial td.acciones-fh button{display:block;width:100%;margin:0 0 5px 0;padding:5px 8px;font-size:12.5px;text-align:left;}
        #tabla-faltas-historial mark{background:#FFE89A;padding:0 1px;border-radius:2px;color:inherit;}
        .fh-pag{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:14px;font-size:13.5px;color:#6b5f52;}
        .fh-pp{display:flex;gap:6px;align-items:center;flex-wrap:wrap;}
        .fh-pp button{min-width:34px;height:34px;padding:0 8px;border:1px solid #d9d0c4;border-radius:8px;background:#fff;color:#2b2016;font-size:14px;cursor:pointer;margin:0;}
        .fh-pp button.on{background:#2b2016;color:#fff;border-color:#2b2016;font-weight:700;}
        .fh-pp button:disabled{color:#c4b9ab;cursor:default;}
      </style>
      <div class="fh-top">
        <div class="fh-buscar">🔍 <input type="search" id="fh-buscar" placeholder="Buscar por empleado, fecha, tipo, estatus, observaciones, quién capturó..." autocomplete="off"><button type="button" class="fh-limpiar" id="fh-limpiar" title="Limpiar búsqueda">✕</button></div>
        <div class="fh-cont" id="fh-cont"></div>
      </div>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-faltas-historial">
          <colgroup><col style="width:18%"><col style="width:10%"><col style="width:15%"><col style="width:16%"><col style="width:17%"><col style="width:13%"><col style="width:11%"></colgroup>
          <thead>
            <tr><th>Empleado</th><th>Fecha</th><th>Tipo</th><th>Estatus</th><th>Observaciones</th><th>Registro</th><th>Acción</th></tr>
          </thead>
          <tbody id="tbody-faltas-historial"><tr><td colspan="7">Cargando...</td></tr></tbody>
        </table>
      </div>
      <div class="fh-pag"><div id="fh-rango"></div><div class="fh-pp" id="fh-paginas"></div></div>
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

  // Historial: búsqueda tipo LIKE + paginación fija de 5 (2026-11-20).
  const POR_PAGINA_FH = 5;
  let paginaFh = 1;
  let textoFh = "";
  let historialFaltas = [];
  const inputFh = contenedor.querySelector("#fh-buscar");
  const limpiarFh = contenedor.querySelector("#fh-limpiar");
  inputFh.addEventListener("input", () => {
    textoFh = inputFh.value;
    limpiarFh.style.display = textoFh ? "inline" : "none";
    paginaFh = 1;
    renderHistorial();
  });
  limpiarFh.addEventListener("click", () => {
    inputFh.value = "";
    inputFh.dispatchEvent(new Event("input"));
    inputFh.focus();
  });

  onSnapshot(collection(db, "faltas"), (snap) => {
    const todas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    todas.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));

    renderPendientes(todas.filter(f => f.estatus === "pendiente"));
    historialFaltas = todas.filter(f => f.estatus !== "pendiente");
    renderHistorial();
  }, (err) => {
    errorPendientesDiv.textContent = "No se pudieron cargar las faltas: " + err.message;
  });

  function renderPendientes(lista) {
    if (lista.length === 0) {
      tbodyPendientes.innerHTML = `<tr><td colspan="6">No hay faltas pendientes de confirmar.</td></tr>`;
      return;
    }
    tbodyPendientes.innerHTML = lista.map(f => `
      <tr data-id="${f.id}">
        <td>${escapeHtml(f.empleadoNombre || "")}</td>
        <td>${f.fecha}</td>
        <td>${etiquetaTipo(f.tipo)}</td>
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

  function textoBusquedaFalta(f) {
    const n = Array.isArray(f.correcciones) ? f.correcciones.length : 0;
    return [
      f.empleadoNombre, f.fecha, fechaCorta(f.fecha), etiquetaTipoFalta(f.tipo),
      ETIQUETAS_ESTATUS[f.estatus] || f.estatus,
      f.enviadoANominaEn ? `nomina ${fechaCortaIso(f.enviadoANominaEn)}` : "",
      n ? "corregida" : "", f.comentario, f.capturadoPorNombre, f.revisadoPorNombre
    ].filter(Boolean).join(" ");
  }
  function chipCorregidaCorta(f) {
    const n = Array.isArray(f.correcciones) ? f.correcciones.length : 0;
    if (!n) return "";
    const ult = f.correcciones[n - 1] || {};
    return `<span class="badge" style="background:#EEE6F7;color:#6B3FA0;" title="${escapeHtml(ult.motivo || "")}">Corregida${ult.informadaEn ? "" : " · sin informar"}</span>`;
  }

  function renderHistorial() {
    const lista = historialFaltas;
    const palabras = palabrasBusqueda(textoFh);
    const filtradas = palabras.length
      ? lista.filter(f => { const t = normalizarBusqueda(textoBusquedaFalta(f)); return palabras.every(p => t.includes(p)); })
      : lista;
    contenedor.querySelector("#fh-cont").textContent = palabras.length ? `${filtradas.length} de ${lista.length} registros` : `${lista.length} registros`;
    const totalPaginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA_FH));
    if (paginaFh > totalPaginas) paginaFh = totalPaginas;
    const ini = (paginaFh - 1) * POR_PAGINA_FH;
    const visibles = filtradas.slice(ini, ini + POR_PAGINA_FH);
    contenedor.querySelector("#fh-rango").textContent = filtradas.length ? `Mostrando ${ini + 1}–${ini + visibles.length} de ${filtradas.length}` : "";
    const cajaPaginas = contenedor.querySelector("#fh-paginas");
    cajaPaginas.innerHTML = !filtradas.length ? ""
      : `<button type="button" data-pag="${paginaFh - 1}" ${paginaFh === 1 ? "disabled" : ""}>‹</button>` +
        paginasVisibles(paginaFh, totalPaginas).map(p => p === "…" ? `<span>…</span>` : `<button type="button" data-pag="${p}" class="${p === paginaFh ? "on" : ""}">${p}</button>`).join("") +
        `<button type="button" data-pag="${paginaFh + 1}" ${paginaFh === totalPaginas ? "disabled" : ""}>›</button>`;
    cajaPaginas.querySelectorAll("button[data-pag]").forEach(b => b.addEventListener("click", () => {
      const p = Number(b.dataset.pag);
      if (p >= 1 && p <= totalPaginas && p !== paginaFh) { paginaFh = p; renderHistorial(); }
    }));

    if (lista.length === 0) {
      tbodyHistorial.innerHTML = `<tr><td colspan="7">Todavía no hay faltas confirmadas o rechazadas.</td></tr>`;
      return;
    }
    if (filtradas.length === 0) {
      tbodyHistorial.innerHTML = `<tr><td colspan="7">Ningún registro coincide con “${escapeHtml(textoFh.trim())}”.</td></tr>`;
      return;
    }
    const r = (t) => resaltarBusqueda(t, palabras);
    tbodyHistorial.innerHTML = visibles.map(f => `
      <tr data-id="${f.id}">
        <td>${r(f.empleadoNombre || "")}</td>
        <td>${r(f.fecha)}</td>
        <td>${etiquetaTipo(f.tipo)}</td>
        <td><span class="badge ${CLASES_ESTATUS[f.estatus] || "badge-pendiente"}">${ETIQUETAS_ESTATUS[f.estatus] || f.estatus}</span>${f.enviadoANominaEn ? `<span class="badge" style="background:#DCEAF7;color:#185FA5;" title="Enviada a nómina">Nómina ${fechaCortaIso(f.enviadoANominaEn)}</span>` : ""}${chipCorregidaCorta(f)}</td>
        <td>${f.comentario ? r(f.comentario) : "—"}</td>
        <td>${f.capturadoPorNombre ? r(f.capturadoPorNombre) : "—"}<div class="fh-sm">${f.revisadoPorNombre ? `${f.estatus === "rechazada" ? "Rechazó" : "Confirmó"}: ${r(f.revisadoPorNombre)}` : "—"}</div></td>
        <td class="acciones-fh">${f.enviadoANominaEn
          ? `<button type="button" class="secundario btn-corregir-falta">✏️ Corregir</button>`
          : (f.estatus === "aprobada" && tipoFaltaNormalizado(f.tipo) === "por_definir"
            ? `<button type="button" class="secundario btn-definir-falta">Definir tipo</button>` : "—")}</td>
      </tr>
    `).join("");
    tbodyHistorial.querySelectorAll("tr[data-id]").forEach(fila => {
      const f = visibles.find(x => x.id === fila.dataset.id);
      fila.querySelector(".btn-corregir-falta")?.addEventListener("click", () => abrirCorregirFalta(f, { uid, nombre }));
      fila.querySelector(".btn-definir-falta")?.addEventListener("click", () => abrirCorregirFalta(f, { uid, nombre }, { sinNomina: true }));
    });
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
            <tr><th>Empleado</th><th>Fecha</th><th>Tipo</th><th>Estatus</th><th>Observaciones</th><th>Acción</th></tr>
          </thead>
          <tbody id="tbody-faltas-equipo"><tr><td colspan="6">Cargando...</td></tr></tbody>
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
      tbody.innerHTML = `<tr><td colspan="6">Todavía no has registrado faltas de tu equipo.</td></tr>`;
      return;
    }
    tbody.innerHTML = lista.map(f => `
      <tr data-id="${f.id}">
        <td>${escapeHtml(f.empleadoNombre || "")}</td>
        <td>${f.fecha}</td>
        <td>${etiquetaTipo(f.tipo)}</td>
        <td><span class="badge ${CLASES_ESTATUS[f.estatus] || "badge-pendiente"}">${ETIQUETAS_ESTATUS[f.estatus] || f.estatus}</span>${chipCorregida(f)}</td>
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
            <tr><th>Fecha</th><th>Tipo</th><th>Estatus</th><th>Observaciones</th></tr>
          </thead>
          <tbody id="tbody-mis-faltas"><tr><td colspan="4">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>
  `;

  const tbody = contenedor.querySelector("#tbody-mis-faltas");

  onSnapshot(query(collection(db, "faltas"), where("empleadoId", "==", uid)), (snap) => {
    const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    lista.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
    if (lista.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4">No tienes faltas registradas.</td></tr>`;
      return;
    }
    tbody.innerHTML = lista.map(f => `
      <tr>
        <td>${f.fecha}</td>
        <td>${etiquetaTipo(f.tipo)}</td>
        <td><span class="badge ${CLASES_ESTATUS[f.estatus] || "badge-pendiente"}">${ETIQUETAS_ESTATUS[f.estatus] || f.estatus}</span>${chipCorregida(f)}</td>
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

// ---- Historial: fechas cortas, búsqueda tipo LIKE y páginas (2026-11-20) -----
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fechaCorta(fechaStr) {
  const [y, m, d] = String(fechaStr || "").split("-").map(Number);
  return y && m && d ? `${d} ${MESES_CORTOS[m - 1]}` : (fechaStr || "");
}
function fechaCortaIso(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : `${d.getDate()} ${MESES_CORTOS[d.getMonth()]}`;
}
function normalizarBusqueda(t) {
  return String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
function palabrasBusqueda(t) {
  return normalizarBusqueda(t).split(/\s+/).filter(Boolean);
}
function resaltarBusqueda(texto, palabras) {
  const chars = Array.from(String(texto ?? ""));
  if (!palabras || !palabras.length) return escapeHtml(chars.join(""));
  const norm = chars.map(c => normalizarBusqueda(c).charAt(0) || c);
  const marca = new Array(chars.length).fill(false);
  palabras.forEach(p => {
    const q = Array.from(p);
    for (let i = 0; i + q.length <= norm.length; i++) {
      let ok = true;
      for (let j = 0; j < q.length; j++) if (norm[i + j] !== q[j]) { ok = false; break; }
      if (ok) for (let j = 0; j < q.length; j++) marca[i + j] = true;
    }
  });
  let html = "", abierto = false;
  chars.forEach((c, i) => {
    if (marca[i] && !abierto) { html += "<mark>"; abierto = true; }
    if (!marca[i] && abierto) { html += "</mark>"; abierto = false; }
    html += escapeHtml(c);
  });
  return html + (abierto ? "</mark>" : "");
}
function paginasVisibles(actual, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set([1, total]);
  let desde = Math.max(1, actual - 2), hasta = Math.min(total, actual + 2);
  if (actual <= 3) { desde = 1; hasta = 5; }
  if (actual >= total - 2) { desde = total - 4; hasta = total; }
  for (let i = desde; i <= hasta; i++) set.add(i);
  const lista = [...set].sort((x, y) => x - y);
  const res = [];
  lista.forEach((p, i) => { if (i && p - lista[i - 1] > 1) res.push("…"); res.push(p); });
  return res;
}