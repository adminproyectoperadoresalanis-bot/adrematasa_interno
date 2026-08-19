import { db } from "./firebase-config.js";
import {
  collection, onSnapshot, query, where
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

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

const DIAS_ABREV = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function calcularSemanaLaboral(fechaStr) {
  // Semana laboral Alanis: viernes a jueves. Devuelve la fecha (yyyy-mm-dd) del viernes de esa semana.
  const d = new Date(fechaStr + "T00:00:00");
  const dow = d.getDay();
  const diffDias = (dow - 5 + 7) % 7;
  d.setDate(d.getDate() - diffDias);
  return d.toISOString().slice(0, 10);
}

function sumarDias(fechaStr, n) {
  const d = new Date(fechaStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function diaSemana(fechaStr) {
  const d = new Date(fechaStr + "T00:00:00");
  return DIAS_ABREV[d.getDay()];
}

function formatearFechaDDMMYY(fechaStr) {
  // "2026-08-14" -> "14/08/26"
  const [a, m, d] = (fechaStr || "").split("-");
  if (!a || !m || !d) return fechaStr || "";
  return `${d}/${m}/${a.slice(2)}`;
}

function numeroSemanaISO(fechaStr) {
  // Número de semana ISO-8601 (semana que contiene el jueves de esa semana).
  const d = new Date(fechaStr + "T00:00:00");
  const diaISO = (d.getDay() + 6) % 7 + 1; // lunes=1 ... domingo=7
  d.setDate(d.getDate() + 4 - diaISO);
  const inicioAnio = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d - inicioAnio) / 86400000 + 1) / 7);
}

function formatearFechaLargaCap(fechaStr) {
  // "2026-08-14" -> "14 Agosto" (mes con mayúscula inicial)
  const [, m, d] = (fechaStr || "").split("-").map(Number);
  if (!m || !d) return fechaStr || "";
  const mes = MESES_LARGO[m - 1];
  return `${d} ${mes.charAt(0).toUpperCase()}${mes.slice(1)}`;
}

function formatearFechaHoraGeneracion() {
  const d = new Date();
  const mes = MESES_LARGO[d.getMonth()];
  const fecha = `${d.getDate()} ${mes.charAt(0).toUpperCase()}${mes.slice(1)} ${d.getFullYear()}`;
  let horas = d.getHours();
  const minutos = String(d.getMinutes()).padStart(2, "0");
  const periodo = horas >= 12 ? "pm" : "am";
  horas = horas % 12 || 12;
  return `${fecha}, ${horas}:${minutos} ${periodo}`;
}

function hoyLocalStr() {
  // Evita el corrimiento de un día que da toISOString() cerca de medianoche
  // en zonas horarias al oeste de UTC.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function construirVista(contenedor, { esAdmin, uid }) {
  contenedor.innerHTML = `
    <section class="panel">
      <h2>Reportes</h2>
      <p class="nota">
        Elige la semana laboral (viernes a jueves) que quieres reportar — el resumen y los formatos de abajo usan esa
        semana. Por default solo se cuenta lo ya aprobado/confirmado — actívalo abajo si necesitas incluir pendientes
        y rechazados también.
      </p>
      <div class="fila-captura">
        <label>Semana
          <select id="rep-semana"></select>
        </label>
        <label class="campo-checkbox">
          <input type="checkbox" id="rep-incluir-todo">
          Incluir pendientes y rechazados
        </label>
      </div>
    </section>

    <section class="panel" style="margin-top:20px;">
      <h2>Resumen del periodo</h2>
      <p class="nota">Horas extra, vacaciones y faltas juntas por empleado, para la semana elegida arriba. Es un preliminar — en cuanto definamos los formatos exactos que necesitas para nómina, lo ajustamos.</p>
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
      <h2>Formatos para imprimir</h2>
      <p class="nota">
        Usa la semana elegida arriba para generar un solo PDF con 2 páginas: REPORTE RH y REPORTE NOMINA de esa
        semana. Solo cuenta lo ya aprobado.
      </p>
      <div class="acciones-form">
        <button type="button" class="secundario" id="btn-vista-previa">VISTA PREVIA / IMPRIMIR</button>
      </div>
    </section>
  `;

  const selectSemana = contenedor.querySelector("#rep-semana");
  const chkIncluirTodo = contenedor.querySelector("#rep-incluir-todo");
  const tbodyResumen = contenedor.querySelector("#tbody-rep-resumen");
  const btnVistaPrevia = contenedor.querySelector("#btn-vista-previa");

  // Últimas 5 semanas laborales (viernes a jueves) hasta la actual, la más
  // reciente primero. El admin/supervisor casi siempre reporta la semana en
  // curso, pero a veces hay que ponerse al día con una semana anterior.
  const viernesSemanaActual = calcularSemanaLaboral(hoyLocalStr());
  const semanasDisponibles = Array.from({ length: 5 }, (_, i) => sumarDias(viernesSemanaActual, -7 * i));
  selectSemana.innerHTML = semanasDisponibles.map(viernes => {
    const jueves = sumarDias(viernes, 6);
    const numero = numeroSemanaISO(jueves);
    return `<option value="${viernes}">Semana ${numero} — De vie ${formatearFechaDDMMYY(viernes)} a jue ${formatearFechaDDMMYY(jueves)}</option>`;
  }).join("");

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

  [selectSemana, chkIncluirTodo].forEach(el => el.addEventListener("change", renderTodo));

  function dentroDeRango(fechaStr) {
    if (!fechaStr || !selectSemana.value) return false;
    const viernes = selectSemana.value;
    const jueves = sumarDias(viernes, 6);
    return fechaStr >= viernes && fechaStr <= jueves;
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
    const numero = selectSemana.value ? numeroSemanaISO(sumarDias(selectSemana.value, 6)) : sufijoFecha();
    exportarCSV(`resumen_semana_${numero}.csv`,
      ["Empleado", "Horas extra", "Días de vacaciones", "Faltas"],
      resumen.map(e => [e.nombre, e.horas, e.vacaciones, e.faltas])
    );
  });

  btnVistaPrevia.addEventListener("click", abrirVistaPreviaImprimir);

  // Construye la página 1 (REPORTE RH: un bloque por empleado con el
  // detalle de cada hora extra) de la semana elegida arriba.
  function construirPaginaRH(viernes, jueves, numeroSemana) {
    const filtradas = listaHoras
      .filter(s => s.estatus === "aprobada")
      .filter(s => s.fecha >= viernes && s.fecha <= jueves);

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

    const anio = viernes.slice(0, 4);
    const periodoTexto = `SEMANA ${numeroSemana} — DEL ${formatearFechaLarga(viernes)} AL ${formatearFechaLarga(jueves)}   AÑO ${anio}`;
    const logoUrl = window.location.origin + "/img/logo-alanis.png";

    const segmentosHtml = empleados.length === 0
      ? `<p class="sin-datos">Sin horas extra aprobadas para este periodo.</p>`
      : empleados.map(e => `
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

    return `
      <div class="pagina pagina-rh">
        <div class="encabezado">
          <div class="logo-caja"><img src="${logoUrl}" alt="" onerror="this.style.display='none'"></div>
          <div class="empresa-area"><span>AUTO TRANSPORTES ALANIS, SA DE CV</span></div>
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
    `;
  }

  // Construye la página 2 (REPORTE NOMINA: cuadrícula semanal, viernes a
  // jueves) de la semana elegida arriba.
  function construirPaginaNomina(viernes, jueves, numeroSemana) {
    const diasSemana = Array.from({ length: 7 }, (_, i) => sumarDias(viernes, i));
    const dentroDeSemana = (fechaStr) => fechaStr >= viernes && fechaStr <= jueves;

    const horasSemana = listaHoras.filter(s => s.estatus === "aprobada" && dentroDeSemana(s.fecha));
    const faltasSemana = listaFaltas.filter(f => f.estatus === "aprobada" && dentroDeSemana(f.fecha));

    const porEmpleado = new Map();
    function fila(empleadoId, nombreFallback) {
      if (!porEmpleado.has(empleadoId)) {
        const datosUsuario = mapUsuarios.get(empleadoId) || {};
        porEmpleado.set(empleadoId, {
          numeroEmpleado: datosUsuario.numeroEmpleado || "—",
          nombre: nombreFallback || datosUsuario.nombre || "",
          puesto: datosUsuario.puesto || "—",
          horasPorDia: {},
          faltas: 0
        });
      }
      return porEmpleado.get(empleadoId);
    }
    horasSemana.forEach(s => {
      const e = fila(s.empleadoId, s.empleadoNombre);
      e.horasPorDia[s.fecha] = (e.horasPorDia[s.fecha] || 0) + (Number(s.horas) || 0);
    });
    faltasSemana.forEach(f => {
      const e = fila(f.empleadoId, f.empleadoNombre);
      e.faltas += 1;
    });

    const empleados = [...porEmpleado.values()].sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));

    const anio = viernes.slice(0, 4);
    const periodoTexto = `Del ${formatearFechaLargaCap(viernes)} al ${formatearFechaLargaCap(jueves)} ${anio}`;
    const tituloCentro = `REPORTE SEMANAL PARA NOMINAS - SEMANA ${numeroSemana}`;
    const logoUrl = window.location.origin + "/img/logo-alanis.png";
    const encabezadosDia = diasSemana.map(f => `<th>${diaSemana(f)}<br>${formatearFechaCorta(f)}</th>`).join("");

    const filasHtml = empleados.length === 0
      ? `<tr><td colspan="${3 + diasSemana.length + 2}" class="centrado">Sin horas extra ni faltas aprobadas para esta semana.</td></tr>`
      : empleados.map(e => {
        const celdasDias = diasSemana.map(f => {
          const horas = e.horasPorDia[f];
          return `<td class="centrado">${horas ? horas : "—"}</td>`;
        }).join("");
        const totalSemana = Object.values(e.horasPorDia).reduce((acc, h) => acc + h, 0);
        return `
          <tr>
            <td class="centrado">${escapeHtml(e.numeroEmpleado)}</td>
            <td>${escapeHtml(e.nombre)}</td>
            <td>${escapeHtml(e.puesto)}</td>
            ${celdasDias}
            <td class="centrado celda-total">${totalSemana}</td>
            <td class="centrado">${e.faltas || "—"}</td>
          </tr>
        `;
      }).join("");

    return `
      <div class="pagina pagina-nomina">
        <div class="encabezado">
          <div class="logo-caja"><img src="${logoUrl}" alt="" onerror="this.style.display='none'"></div>
          <div class="titulo-centro">${escapeHtml(tituloCentro)}</div>
          <div class="espaciador"></div>
        </div>
        <div class="periodo">${escapeHtml(periodoTexto)}</div>

        <table>
          <thead>
            <tr>
              <th>No.<br>Emp.</th>
              <th>Nombre</th>
              <th>Puesto</th>
              ${encabezadosDia}
              <th>H Ext</th>
              <th>Faltas</th>
            </tr>
          </thead>
          <tbody>
            ${filasHtml}
          </tbody>
        </table>

        <div class="pie-nomina">
          <div class="pie-empresa">AUTOTRANSPORTES ALANIS, S.A. DE C.V.</div>
          <div class="pie-nomina-contenido">
            <div class="autorizo">
              <div class="linea-firma"></div>
              Autorizó: Iván Landa
            </div>
            <div class="meta-impresion">
              Reporte de horas extras de la semana ${numeroSemana}<br>
              Generado el ${formatearFechaHoraGeneracion()}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // Un solo PDF con 2 páginas: REPORTE RH (detalle por empleado) y
  // REPORTE NOMINA (cuadrícula semanal). Solo cuenta lo ya aprobado (documento
  // formal, no depende del checkbox de "incluir pendientes y rechazados").
  function abrirVistaPreviaImprimir() {
    if (!selectSemana.value) {
      alert("Elige la semana en la sección Reportes de arriba.");
      return;
    }

    const viernes = selectSemana.value;
    const jueves = sumarDias(viernes, 6);
    const numeroSemana = numeroSemanaISO(jueves);

    const paginaRH = construirPaginaRH(viernes, jueves, numeroSemana);
    const paginaNomina = construirPaginaNomina(viernes, jueves, numeroSemana);

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Reporte de horas extras de la semana ${numeroSemana}</title>
<style>
  @page { size: letter portrait; margin: 12mm 10mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color:#1a1a1a; margin:0; padding:0; }
  .pagina { padding: 6mm; }
  .pagina-nomina { break-before: page; page-break-before: always; }
  .encabezado { display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid #1a1a1a; padding-bottom:6px; margin-bottom:6px; }
  .logo-caja { width:110px; height:50px; display:flex; align-items:center; justify-content:center; }
  .logo-caja img { max-width:110px; max-height:50px; }
  .empresa-area { flex:1; padding-left:12px; font-weight:bold; font-size:12px; }
  .titulo-reporte { text-align:center; font-weight:bold; font-size:13px; letter-spacing:.5px; margin:8px 0 4px; }
  .periodo { text-align:center; font-size:11px; margin-bottom:14px; }
  .centrado { text-align:center; }
  .pie { margin-top:22px; }
  .linea-firma { border-top:1px solid #1a1a1a; margin-bottom:4px; padding-top:20px; }
  .sin-datos { text-align:center; color:#666; margin-top:20px; }

  .pagina-rh { max-width: 190mm; margin: 0 auto; font-size:11px; }
  .pagina-rh table { width:100%; border-collapse:collapse; }
  .pagina-rh .segmento-empleado { break-inside: avoid; margin-bottom:10px; }
  .pagina-rh .tabla-encabezado-empleado td { border:1px solid #1a1a1a; font-weight:bold; font-size:11px; padding:3px 6px; background:#eef1f4; }
  .pagina-rh .celda-nombre-empleado { width:65%; }
  .pagina-rh .celda-puesto-empleado { width:35%; }
  .pagina-rh .tabla-horas th, .pagina-rh .tabla-horas td { border:1px solid #1a1a1a; padding:3px 6px; font-size:10.5px; }
  .pagina-rh .tabla-horas th { background:#f7f8fa; font-weight:bold; text-align:center; }
  .pagina-rh .firmas { display:flex; justify-content:space-between; margin-top:26px; }
  .pagina-rh .firma { width:45%; text-align:center; font-size:10.5px; }
  .pagina-rh .nota-pie { font-size:9.5px; margin-top:16px; }
  .pagina-rh .codigo-formato { display:flex; justify-content:space-between; font-size:9.5px; margin-top:6px; border-top:1px solid #999; padding-top:4px; }

  .pagina-nomina { font-size:10px; display:flex; flex-direction:column; min-height:100vh; }
  .pagina-nomina table { width:100%; border-collapse:collapse; }
  .pagina-nomina th, .pagina-nomina td { border:1px solid #1a1a1a; padding:3px 4px; font-size:9px; }
  .pagina-nomina th { background:#f7f8fa; font-weight:bold; text-align:center; }
  .pagina-nomina .celda-total { font-weight:bold; background:#f2f4f7; }
  .pagina-nomina .encabezado { border-bottom:1px solid #1a1a1a; }
  .pagina-nomina .titulo-centro { flex:1; text-align:center; font-weight:bold; font-size:12px; padding:0 10px; }
  .pagina-nomina .espaciador { width:110px; }
  .pagina-nomina .periodo { margin-bottom:10px; }
  .pagina-nomina .pie-nomina { margin-top:auto; padding-top:16px; }
  .pagina-nomina .pie-empresa { text-align:center; font-weight:bold; font-size:10px; margin-bottom:8px; }
  .pagina-nomina .pie-nomina-contenido { display:flex; justify-content:space-between; align-items:flex-end; }
  .pagina-nomina .autorizo { text-align:left; font-size:10.5px; width:220px; }
  .pagina-nomina .meta-impresion { font-size:8.5px; color:#555; text-align:right; line-height:1.4; }

  .barra-imprimir { text-align:center; margin:14px 0; }
  .barra-imprimir button { padding:8px 18px; font-size:13px; cursor:pointer; }
  @media print { .barra-imprimir { display:none; } }
</style>
</head>
<body>
  <div class="barra-imprimir"><button onclick="window.print()">Imprimir / Guardar como PDF</button></div>
  ${paginaRH}
  ${paginaNomina}
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