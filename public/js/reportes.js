import { db } from "./firebase-config.js";
import {
  collection, onSnapshot, query, where
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const ETIQUETAS_ESTATUS_SOL = { pendiente: "Pendiente", aprobada: "Aprobada", rechazada: "Rechazada" };
const ETIQUETAS_ESTATUS_FALTA = { pendiente: "Pendiente", aprobada: "Confirmada", rechazada: "Rechazada" };
const CLASES_ESTATUS = { pendiente: "badge-pendiente", aprobada: "badge-aprobada", rechazada: "badge-rechazada" };

const ETIQUETAS_TIPO_FALTA = {
  injustificada: "Injustificada",
  justificada: "Justificada",
  incapacidad: "Incapacidad (IMSS)",
  permiso_con_goce: "Permiso con goce de sueldo",
  permiso_sin_goce: "Permiso sin goce de sueldo"
};

function etiquetaTipoFalta(valor) {
  return ETIQUETAS_TIPO_FALTA[valor] || valor;
}

function construirVista(contenedor, { esAdmin, uid }) {
  contenedor.innerHTML = `
    <section class="panel">
      <h2>Reportes</h2>
      <p class="nota">
        Filtra por periodo (ej. la quincena o el mes que estás cerrando) y exporta a CSV para nómina.
        Por default solo se muestra lo ya aprobado/confirmado — actívalo abajo si necesitas ver pendientes y rechazados también.
      </p>
      <div class="fila-captura">
        <label>Desde
          <input type="date" id="rep-desde">
        </label>
        <label>Hasta
          <input type="date" id="rep-hasta">
        </label>
        <label class="campo-checkbox">
          <input type="checkbox" id="rep-incluir-todo">
          Incluir pendientes y rechazados
        </label>
      </div>
    </section>

    <section class="panel" style="margin-top:20px;">
      <h2>Resumen del periodo</h2>
      <p class="nota">Horas extra, vacaciones y faltas juntas por empleado, para el rango de fechas de arriba. Es un preliminar — en cuanto definamos los formatos exactos que necesitas para nómina, lo ajustamos.</p>
      <div class="acciones-form">
        <button type="button" class="secundario" id="btn-exportar-resumen">Exportar CSV</button>
      </div>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-rep-resumen">
          <thead>
            <tr><th>Empleado</th><th>Horas extra</th><th>Días de vacaciones</th><th>Faltas</th></tr>
          </thead>
          <tbody id="tbody-rep-resumen"><tr><td colspan="4">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>

    <section class="panel" style="margin-top:20px;">
      <h2>Horas extra</h2>
      <div class="acciones-form">
        <button type="button" class="secundario" id="btn-exportar-horas">Exportar CSV</button>
      </div>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-rep-horas">
          <thead>
            <tr><th>Empleado</th><th>Fecha</th><th>Horario</th><th>Horas</th><th>Motivo</th><th>Estatus</th><th>Autorizó</th></tr>
          </thead>
          <tbody id="tbody-rep-horas"><tr><td colspan="7">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>

    <section class="panel" style="margin-top:20px;">
      <h2>Vacaciones</h2>
      <div class="acciones-form">
        <button type="button" class="secundario" id="btn-exportar-vacaciones">Exportar CSV</button>
      </div>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-rep-vacaciones">
          <thead>
            <tr><th>Empleado</th><th>Inicio</th><th>Fin</th><th>Días</th><th>Estatus</th><th>Autorizó</th></tr>
          </thead>
          <tbody id="tbody-rep-vacaciones"><tr><td colspan="6">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>

    <section class="panel" style="margin-top:20px;">
      <h2>Faltas</h2>
      <div class="acciones-form">
        <button type="button" class="secundario" id="btn-exportar-faltas">Exportar CSV</button>
      </div>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-rep-faltas">
          <thead>
            <tr><th>Empleado</th><th>Fecha</th><th>Tipo</th><th>Afecta pago</th><th>Estatus</th><th>Confirmó/Rechazó</th></tr>
          </thead>
          <tbody id="tbody-rep-faltas"><tr><td colspan="6">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>
  `;

  const inputDesde = contenedor.querySelector("#rep-desde");
  const inputHasta = contenedor.querySelector("#rep-hasta");
  const chkIncluirTodo = contenedor.querySelector("#rep-incluir-todo");

  const tbodyResumen = contenedor.querySelector("#tbody-rep-resumen");
  const tbodyHoras = contenedor.querySelector("#tbody-rep-horas");
  const tbodyVacaciones = contenedor.querySelector("#tbody-rep-vacaciones");
  const tbodyFaltas = contenedor.querySelector("#tbody-rep-faltas");

  let listaHoras = [];
  let listaVacaciones = [];
  let listaFaltas = [];
  let filtradasHoras = [];
  let filtradasVacaciones = [];
  let filtradasFaltas = [];
  let resumen = [];

  const baseHoras = esAdmin
    ? collection(db, "solicitudes")
    : query(collection(db, "solicitudes"), where("supervisorId", "==", uid));
  const baseVacaciones = esAdmin
    ? collection(db, "solicitudesVacaciones")
    : query(collection(db, "solicitudesVacaciones"), where("supervisorId", "==", uid));
  const baseFaltas = esAdmin
    ? collection(db, "faltas")
    : query(collection(db, "faltas"), where("supervisorId", "==", uid));

  onSnapshot(baseHoras, (snap) => {
    listaHoras = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTodo();
  });
  onSnapshot(baseVacaciones, (snap) => {
    listaVacaciones = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTodo();
  });
  onSnapshot(baseFaltas, (snap) => {
    listaFaltas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTodo();
  });

  [inputDesde, inputHasta, chkIncluirTodo].forEach(el => el.addEventListener("change", renderTodo));

  function dentroDeRango(fechaStr) {
    if (!fechaStr) return false;
    if (inputDesde.value && fechaStr < inputDesde.value) return false;
    if (inputHasta.value && fechaStr > inputHasta.value) return false;
    return true;
  }

  function filtrar(lista, campoFecha) {
    return lista
      .filter(x => dentroDeRango(x[campoFecha]))
      .filter(x => chkIncluirTodo.checked || x.estatus === "aprobada")
      .sort((a, b) => (b[campoFecha] || "").localeCompare(a[campoFecha] || ""));
  }

  function renderTodo() {
    filtradasHoras = filtrar(listaHoras, "fecha");
    filtradasVacaciones = filtrar(listaVacaciones, "fechaInicio");
    filtradasFaltas = filtrar(listaFaltas, "fecha");
    resumen = construirResumen();
    renderResumen();
    renderHoras();
    renderVacaciones();
    renderFaltas();
  }

  // Junta horas extra, vacaciones y faltas del mismo rango en una fila por
  // empleado. Preliminar: en cuanto se definan los 2 formatos exactos para
  // nómina, esto se ajusta a lo que realmente hace falta.
  function construirResumen() {
    const porEmpleado = new Map();

    function obtener(id, nombre) {
      if (!id) return null;
      if (!porEmpleado.has(id)) {
        porEmpleado.set(id, { nombre: nombre || "", horas: 0, vacaciones: 0, faltas: 0 });
      }
      const e = porEmpleado.get(id);
      if (nombre && !e.nombre) e.nombre = nombre;
      return e;
    }

    filtradasHoras.forEach(s => {
      const e = obtener(s.empleadoId, s.empleadoNombre);
      if (e) e.horas += Number(s.horas) || 0;
    });
    filtradasVacaciones.forEach(s => {
      const e = obtener(s.empleadoId, s.empleadoNombre);
      if (e) e.vacaciones += Number(s.diasHabiles) || 0;
    });
    filtradasFaltas.forEach(f => {
      const e = obtener(f.empleadoId, f.empleadoNombre);
      if (e) e.faltas += 1;
    });

    return [...porEmpleado.values()].sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
  }

  function renderResumen() {
    if (resumen.length === 0) {
      tbodyResumen.innerHTML = `<tr><td colspan="4">Sin registros para este filtro.</td></tr>`;
      return;
    }
    tbodyResumen.innerHTML = resumen.map(e => `
      <tr>
        <td>${escapeHtml(e.nombre)}</td>
        <td>${e.horas}</td>
        <td>${e.vacaciones}</td>
        <td>${e.faltas}</td>
      </tr>
    `).join("");
  }

  function renderHoras() {
    if (filtradasHoras.length === 0) {
      tbodyHoras.innerHTML = `<tr><td colspan="7">Sin registros para este filtro.</td></tr>`;
      return;
    }
    tbodyHoras.innerHTML = filtradasHoras.map(s => `
      <tr>
        <td>${escapeHtml(s.empleadoNombre || "")}</td>
        <td>${s.fecha}</td>
        <td>${s.horaInicio}–${s.horaFin}</td>
        <td>${s.horas}</td>
        <td>${escapeHtml(s.motivo || "")}</td>
        <td><span class="badge ${CLASES_ESTATUS[s.estatus] || "badge-pendiente"}">${ETIQUETAS_ESTATUS_SOL[s.estatus] || s.estatus}</span></td>
        <td>${escapeHtml(s.revisadoPorNombre || "—")}</td>
      </tr>
    `).join("");
  }

  function renderVacaciones() {
    if (filtradasVacaciones.length === 0) {
      tbodyVacaciones.innerHTML = `<tr><td colspan="6">Sin registros para este filtro.</td></tr>`;
      return;
    }
    tbodyVacaciones.innerHTML = filtradasVacaciones.map(s => `
      <tr>
        <td>${escapeHtml(s.empleadoNombre || "")}</td>
        <td>${s.fechaInicio}</td>
        <td>${s.fechaFin}</td>
        <td>${s.diasHabiles}</td>
        <td><span class="badge ${CLASES_ESTATUS[s.estatus] || "badge-pendiente"}">${ETIQUETAS_ESTATUS_SOL[s.estatus] || s.estatus}</span></td>
        <td>${escapeHtml(s.revisadoPorNombre || "—")}</td>
      </tr>
    `).join("");
  }

  function renderFaltas() {
    if (filtradasFaltas.length === 0) {
      tbodyFaltas.innerHTML = `<tr><td colspan="6">Sin registros para este filtro.</td></tr>`;
      return;
    }
    tbodyFaltas.innerHTML = filtradasFaltas.map(f => `
      <tr>
        <td>${escapeHtml(f.empleadoNombre || "")}</td>
        <td>${f.fecha}</td>
        <td>${etiquetaTipoFalta(f.tipo)}</td>
        <td>${f.afectaPago ? "Sí" : "No"}</td>
        <td><span class="badge ${CLASES_ESTATUS[f.estatus] || "badge-pendiente"}">${ETIQUETAS_ESTATUS_FALTA[f.estatus] || f.estatus}</span></td>
        <td>${escapeHtml(f.revisadoPorNombre || "—")}</td>
      </tr>
    `).join("");
  }

  contenedor.querySelector("#btn-exportar-resumen").addEventListener("click", () => {
    exportarCSV(`resumen_${sufijoFecha()}.csv`,
      ["Empleado", "Horas extra", "Días de vacaciones", "Faltas"],
      resumen.map(e => [e.nombre, e.horas, e.vacaciones, e.faltas])
    );
  });

  contenedor.querySelector("#btn-exportar-horas").addEventListener("click", () => {
    exportarCSV(`horas_extra_${sufijoFecha()}.csv`,
      ["Empleado", "Fecha", "Hora inicio", "Hora fin", "Horas", "Motivo", "Estatus", "Autorizó"],
      filtradasHoras.map(s => [
        s.empleadoNombre, s.fecha, s.horaInicio, s.horaFin, s.horas, s.motivo,
        ETIQUETAS_ESTATUS_SOL[s.estatus] || s.estatus, s.revisadoPorNombre || ""
      ])
    );
  });

  contenedor.querySelector("#btn-exportar-vacaciones").addEventListener("click", () => {
    exportarCSV(`vacaciones_${sufijoFecha()}.csv`,
      ["Empleado", "Inicio", "Fin", "Días", "Estatus", "Autorizó"],
      filtradasVacaciones.map(s => [
        s.empleadoNombre, s.fechaInicio, s.fechaFin, s.diasHabiles,
        ETIQUETAS_ESTATUS_SOL[s.estatus] || s.estatus, s.revisadoPorNombre || ""
      ])
    );
  });

  contenedor.querySelector("#btn-exportar-faltas").addEventListener("click", () => {
    exportarCSV(`faltas_${sufijoFecha()}.csv`,
      ["Empleado", "Fecha", "Tipo", "Afecta pago", "Estatus", "Confirmó/Rechazó"],
      filtradasFaltas.map(f => [
        f.empleadoNombre, f.fecha, etiquetaTipoFalta(f.tipo), f.afectaPago ? "Sí" : "No",
        ETIQUETAS_ESTATUS_FALTA[f.estatus] || f.estatus, f.revisadoPorNombre || ""
      ])
    );
  });
}

export function iniciarReportesAdmin(contenedor) {
  construirVista(contenedor, { esAdmin: true, uid: null });
}

export function iniciarReportesSupervisor(contenedor, uid) {
  construirVista(contenedor, { esAdmin: false, uid });
}

function sufijoFecha() {
  return new Date().toISOString().slice(0, 10);
}

function exportarCSV(nombreArchivo, encabezados, filas) {
  const escaparCelda = (valor) => {
    const texto = (valor ?? "").toString();
    return /[",\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };
  const lineas = [encabezados, ...filas].map(fila => fila.map(escaparCelda).join(","));
  const contenido = "﻿" + lineas.join("\r\n"); // BOM: para que Excel abra bien los acentos
  const blob = new Blob([contenido], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto || "";
  return div.innerHTML;
}