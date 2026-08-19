import { db } from "./firebase-config.js";
import {
  collection, onSnapshot, query, where
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { suscribirEstructura } from "./estructuraOrganizacional.js";

const MESES_ABREV = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function formatearFechaCorta(fechaStr) {
  // "2026-08-08" -> "08-ago"
  const [, m, d] = (fechaStr || "").split("-").map(Number);
  if (!m || !d) return fechaStr || "";
  return `${String(d).padStart(2, "0")}-${MESES_ABREV[m - 1]}`;
}

function formatearFechaLarga(fechaStr) {
  // "2026-08-07" -> "7 agosto"
  const [, m, d] = (fechaStr || "").split("-").map(Number);
  if (!m || !d) return fechaStr || "";
  return `${d} ${MESES_LARGO[m - 1]}`;
}

function formatearHora12(horaStr) {
  // "14:00" -> "2:00 pm"
  const [h, m] = (horaStr || "").split(":").map(Number);
  if (isNaN(h)) return horaStr || "";
  const periodo = h >= 12 ? "pm" : "am";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(m || 0).padStart(2, "0")} ${periodo}`;
}

function construirVista(contenedor, { esAdmin, uid }) {
  contenedor.innerHTML = `
    <section class="panel">
      <h2>Reportes</h2>
      <p class="nota">
        Filtra por periodo (ej. la quincena o el mes que estás cerrando) y exporta a CSV para nómina.
        Por default solo se cuenta lo ya aprobado/confirmado — actívalo abajo si necesitas incluir pendientes y rechazados también.
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
      <h2>Reporte de horas extra (detalle)</h2>
      <p class="nota">
        Formato imprimible para nómina, con un bloque por empleado (fecha, cantidad de horas, horario y motivo de cada extra).
        Solo incluye horas extra ya aprobadas del rango de fechas de arriba.
      </p>
      <div class="fila-captura">
        <label>Área
          <select id="rep-area"><option value="todas">Todas las áreas</option></select>
        </label>
      </div>
      <div class="acciones-form">
        <button type="button" class="secundario" id="btn-imprimir-detalle">Vista previa / Imprimir</button>
      </div>
    </section>
  `;

  const inputDesde = contenedor.querySelector("#rep-desde");
  const inputHasta = contenedor.querySelector("#rep-hasta");
  const chkIncluirTodo = contenedor.querySelector("#rep-incluir-todo");
  const tbodyResumen = contenedor.querySelector("#tbody-rep-resumen");
  const selectArea = contenedor.querySelector("#rep-area");
  const btnImprimirDetalle = contenedor.querySelector("#btn-imprimir-detalle");

  let listaHoras = [];
  let listaVacaciones = [];
  let listaFaltas = [];
  let resumen = [];
  const mapUsuarios = new Map();

  const baseHoras = esAdmin
    ? collection(db, "solicitudes")
    : query(collection(db, "solicitudes"), where("supervisorId", "==", uid));
  const baseVacaciones = esAdmin
    ? collection(db, "solicitudesVacaciones")
    : query(collection(db, "solicitudesVacaciones"), where("supervisorId", "==", uid));
  const baseFaltas = esAdmin
    ? collection(db, "faltas")
    : query(collection(db, "faltas"), where("supervisorId", "==", uid));
  const baseUsuarios = esAdmin
    ? collection(db, "usuarios")
    : query(collection(db, "usuarios"), where("supervisorId", "==", uid));

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
  onSnapshot(baseUsuarios, (snap) => {
    mapUsuarios.clear();
    snap.docs.forEach(d => mapUsuarios.set(d.id, d.data()));
  });
  suscribirEstructura((areas) => {
    const areaElegida = selectArea.value;
    selectArea.innerHTML = `<option value="todas">Todas las áreas</option>` +
      areas.map(a => `<option value="${escapeHtml(a.nombre)}">${escapeHtml(a.nombre)}</option>`).join("");
    if ([...selectArea.options].some(o => o.value === areaElegida)) selectArea.value = areaElegida;
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
      .filter(x => chkIncluirTodo.checked || x.estatus === "aprobada");
  }

  function renderTodo() {
    const filtradasHoras = filtrar(listaHoras, "fecha");
    const filtradasVacaciones = filtrar(listaVacaciones, "fechaInicio");
    const filtradasFaltas = filtrar(listaFaltas, "fecha");
    resumen = construirResumen(filtradasHoras, filtradasVacaciones, filtradasFaltas);
    renderResumen();
  }

  // Junta horas extra, vacaciones y faltas del mismo rango en una fila por
  // empleado. Preliminar: en cuanto se definan los 2 formatos exactos para
  // nómina, esto se ajusta a lo que realmente hace falta.
  function construirResumen(filtradasHoras, filtradasVacaciones, filtradasFaltas) {
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

  contenedor.querySelector("#btn-exportar-resumen").addEventListener("click", () => {
    exportarCSV(`resumen_${sufijoFecha()}.csv`,
      ["Empleado", "Horas extra", "Días de vacaciones", "Faltas"],
      resumen.map(e => [e.nombre, e.horas, e.vacaciones, e.faltas])
    );
  });

  btnImprimirDetalle.addEventListener("click", abrirVistaImpresionDetalle);

  // Reporte imprimible "Reporte semanal de horas extras" — un bloque por
  // empleado, solo horas extra ya aprobadas (sin importar el checkbox de
  // "incluir pendientes y rechazados": este es un documento formal).
  function abrirVistaImpresionDetalle() {
    if (!inputDesde.value || !inputHasta.value) {
      alert("Elige la fecha Desde y Hasta para generar el reporte.");
      return;
    }

    const areaSeleccionada = selectArea.value;
    const filtradas = listaHoras
      .filter(s => s.estatus === "aprobada")
      .filter(s => dentroDeRango(s.fecha))
      .filter(s => areaSeleccionada === "todas" || (mapUsuarios.get(s.empleadoId)?.area || "") === areaSeleccionada);

    if (filtradas.length === 0) {
      alert("No hay horas extra aprobadas para ese rango de fechas" +
        (areaSeleccionada === "todas" ? "." : ` en el área "${areaSeleccionada}".`));
      return;
    }

    const porEmpleado = new Map();
    filtradas.forEach(s => {
      if (!porEmpleado.has(s.empleadoId)) {
        const datosUsuario = mapUsuarios.get(s.empleadoId) || {};
        porEmpleado.set(s.empleadoId, {
          nombre: s.empleadoNombre || datosUsuario.nombre || "",
          puesto: datosUsuario.puesto || "—",
          filas: []
        });
      }
      porEmpleado.get(s.empleadoId).filas.push(s);
    });

    const empleados = [...porEmpleado.values()];
    empleados.forEach(e => e.filas.sort((a, b) => (a.fecha || "").localeCompare(b.fecha || "")));
    empleados.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));

    const anio = (inputHasta.value || inputDesde.value || "").slice(0, 4);
    const periodoTexto = `PERIODO DEL ${formatearFechaLarga(inputDesde.value)} AL ${formatearFechaLarga(inputHasta.value)}   AÑO ${anio}`;
    const areaTexto = areaSeleccionada === "todas" ? "Todas" : areaSeleccionada;
    const logoUrl = window.location.origin + "/img/logo-alanis.png";

    const segmentosHtml = empleados.map(e => `
      <div class="segmento-empleado">
        <table class="tabla-encabezado-empleado">
          <tr>
            <td class="celda-nombre-empleado">NOMBRE DEL EMPLEADO: ${escapeHtml(e.nombre)}</td>
            <td class="celda-puesto-empleado">Puesto: ${escapeHtml(e.puesto)}</td>
          </tr>
        </table>
        <table class="tabla-horas">
          <thead>
            <tr>
              <th style="width:12%;">Fecha</th>
              <th style="width:14%;">Cantidad de Horas</th>
              <th style="width:22%;">Horario de las Extras *</th>
              <th>Motivo de la Hora(s) Extra(s)</th>
            </tr>
          </thead>
          <tbody>
            ${e.filas.map(s => `
              <tr>
                <td class="centrado">${formatearFechaCorta(s.fecha)}</td>
                <td class="centrado">${s.horas}</td>
                <td class="centrado">${formatearHora12(s.horaInicio)} - ${formatearHora12(s.horaFin)}</td>
                <td>${escapeHtml(s.motivo || "")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `).join("");

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Reporte semanal de horas extra</title>
<style>
  @page { size: letter portrait; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color:#1a1a1a; font-size:11px; margin:0; padding:0; }
  .hoja { max-width: 190mm; margin: 0 auto; padding: 6mm; }
  .encabezado { display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid #1a1a1a; padding-bottom:6px; margin-bottom:6px; }
  .logo-caja { width:120px; height:55px; display:flex; align-items:center; justify-content:center; }
  .logo-caja img { max-width:120px; max-height:55px; }
  .empresa-area { flex:1; display:flex; justify-content:space-between; align-items:center; padding-left:12px; font-weight:bold; font-size:12px; }
  .titulo-reporte { text-align:center; font-weight:bold; font-size:14px; letter-spacing:.5px; margin:8px 0 4px; }
  .periodo { text-align:center; font-size:11px; margin-bottom:14px; }
  .segmento-empleado { break-inside: avoid; margin-bottom:10px; }
  table { width:100%; border-collapse:collapse; }
  .tabla-encabezado-empleado td { border:1px solid #1a1a1a; font-weight:bold; font-size:11px; padding:3px 6px; background:#eef1f4; }
  .celda-nombre-empleado { width:65%; }
  .celda-puesto-empleado { width:35%; }
  .tabla-horas th, .tabla-horas td { border:1px solid #1a1a1a; padding:3px 6px; font-size:10.5px; }
  .tabla-horas th { background:#f7f8fa; font-weight:bold; text-align:center; }
  .centrado { text-align:center; }
  .pie { margin-top:22px; }
  .firmas { display:flex; justify-content:space-between; margin-top:26px; }
  .firma { width:45%; text-align:center; font-size:10.5px; }
  .linea-firma { border-top:1px solid #1a1a1a; margin-bottom:4px; padding-top:20px; }
  .nota-pie { font-size:9.5px; margin-top:16px; }
  .codigo-formato { display:flex; justify-content:space-between; font-size:9.5px; margin-top:6px; border-top:1px solid #999; padding-top:4px; }
  .barra-imprimir { text-align:center; margin:14px 0; }
  .barra-imprimir button { padding:8px 18px; font-size:13px; cursor:pointer; }
  @media print { .barra-imprimir { display:none; } }
</style>
</head>
<body>
  <div class="barra-imprimir"><button onclick="window.print()">Imprimir / Guardar como PDF</button></div>
  <div class="hoja">
    <div class="encabezado">
      <div class="logo-caja"><img src="${logoUrl}" alt="" onerror="this.style.display='none'"></div>
      <div class="empresa-area">
        <span>AUTO TRANSPORTES ALANIS, SA DE CV</span>
        <span>AREA&nbsp;&nbsp;${escapeHtml(areaTexto)}</span>
      </div>
    </div>
    <div class="titulo-reporte">REPORTE SEMANAL DE HORAS EXTRAS</div>
    <div class="periodo">${escapeHtml(periodoTexto)}</div>

    ${segmentosHtml}

    <div class="pie">
      <div class="firmas">
        <div class="firma"><div class="linea-firma"></div>Firma del Gerente o Jefe del Área<br>Autorización</div>
        <div class="firma"><div class="linea-firma"></div>Firma del Depto. de Nóminas<br>Revisión</div>
      </div>
      <div class="nota-pie">* Horario de las Extras: Se refiere a indicar entre que horas se dieron las extras, es decir de que hora a que hora.</div>
      <div class="codigo-formato"><span>ATAF082</span><span>Rev. 0&nbsp;&nbsp;&nbsp;05/02/2024</span></div>
    </div>
  </div>
</body>
</html>`;

    const ventana = window.open("", "_blank");
    if (!ventana) {
      alert("El navegador bloqueó la ventana emergente. Habilita ventanas emergentes para este sitio e intenta de nuevo.");
      return;
    }
    ventana.document.write(html);
    ventana.document.close();
  }
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