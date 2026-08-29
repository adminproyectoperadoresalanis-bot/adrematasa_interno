// Lógica PURA (sin DOM, sin Firebase, sin `window`) para armar el HTML del
// "REPORTE RH + REPORTE NOMINA" — las 2 páginas que antes vivían solo dentro
// de js/reportes.js. Se separó a este módulo aparte para que el MISMO código
// que arma el reporte lo puedan usar dos lados distintos sin duplicar nada:
//   1. js/reportes.js (navegador) — el botón "VISTA PREVIA / IMPRIMIR".
//   2. automatizacion/generar-y-enviar-reporte.mjs (Node, corre en GitHub
//      Actions cada jueves) — genera el mismo PDF para mandarlo por correo
//      automáticamente, sin que nadie abra la app.
// Si en el futuro se ajusta el formato del reporte, se edita SOLO aquí y
// ambos lados quedan actualizados — nada que mantener sincronizado a mano.
//
// Por ser un módulo puro: nada de `document.createElement`, `window.*`, ni
// imports de Firebase. Cualquier dato que antes se leía de un closure
// (listaHoras, mapUsuarios, etc.) ahora se recibe como parámetro explícito,
// y el logo se recibe ya armado como `logoSrc` (una URL o un data: URI en
// base64) en vez de calcularse aquí con `window.location.origin` — Node no
// tiene `window`, así que quien llama decide cómo resolver el logo.

export const MESES_ABREV = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const MESES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const DIAS_ABREV = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

// Etiquetas cortas para "Tipo Falta" en la tabla de nómina — mismos valores
// de "tipo" que usa faltas.js.
export const ETIQUETAS_FALTA_CORTAS = {
  injustificada: "Injustificada",
  justificada: "Justificada",
  incapacidad: "Incapacidad",
  permiso_con_goce: "Con goce",
  permiso_sin_goce: "Sin goce"
};

export function formatearFechaCorta(fechaStr) {
  // "2026-08-08" -> "08-ago"
  const [, m, d] = (fechaStr || "").split("-").map(Number);
  if (!m || !d) return fechaStr || "";
  return `${String(d).padStart(2, "0")}-${MESES_ABREV[m - 1]}`;
}

export function formatearFechaLargaCap(fechaStr) {
  // "2026-08-14" -> "14 Agosto" (mes con mayúscula inicial)
  const [, m, d] = (fechaStr || "").split("-").map(Number);
  if (!m || !d) return fechaStr || "";
  const mes = MESES_LARGO[m - 1];
  return `${d} ${mes.charAt(0).toUpperCase()}${mes.slice(1)}`;
}

export function formatearHora12(horaStr) {
  // "14:00" -> "2:00 pm"
  const [h, m] = (horaStr || "").split(":").map(Number);
  if (isNaN(h)) return horaStr || "";
  const periodo = h >= 12 ? "pm" : "am";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(m || 0).padStart(2, "0")} ${periodo}`;
}

export function sumarDias(fechaStr, n) {
  const d = new Date(fechaStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diaSemana(fechaStr) {
  const d = new Date(fechaStr + "T00:00:00");
  return DIAS_ABREV[d.getDay()];
}

export function calcularSemanaLaboral(fechaStr) {
  // Semana laboral Alanis: viernes a jueves. Devuelve la fecha (yyyy-mm-dd) del viernes de esa semana.
  const d = new Date(fechaStr + "T00:00:00");
  const dow = d.getDay();
  const diffDias = (dow - 5 + 7) % 7;
  d.setDate(d.getDate() - diffDias);
  return d.toISOString().slice(0, 10);
}

export function numeroSemanaISO(fechaStr) {
  // Número de semana ISO-8601 (semana que contiene el jueves de esa semana).
  const d = new Date(fechaStr + "T00:00:00");
  const diaISO = (d.getDay() + 6) % 7 + 1; // lunes=1 ... domingo=7
  d.setDate(d.getDate() + 4 - diaISO);
  const inicioAnio = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d - inicioAnio) / 86400000 + 1) / 7);
}

export function formatearFechaDDMMYY(fechaStr) {
  // "2026-08-14" -> "14/08/26"
  const [a, m, d] = (fechaStr || "").split("-");
  if (!a || !m || !d) return fechaStr || "";
  return `${d}/${m}/${a.slice(2)}`;
}

export function formatearFechaHoraGeneracion(fecha) {
  // fecha: objeto Date ya armado por quien llama (por default "ahora" en la
  // zona horaria del proceso que corre este código — el navegador del
  // usuario en el caso del preview, o el runner de GitHub Actions en el
  // caso del correo automático, que por eso arma su propio Date ya
  // convertido a hora de Nuevo Laredo antes de llamar aquí — ver
  // automatizacion/generar-y-enviar-reporte.mjs).
  const d = fecha || new Date();
  const mes = MESES_LARGO[d.getMonth()];
  const fechaTexto = `${d.getDate()} ${mes.charAt(0).toUpperCase()}${mes.slice(1)} ${d.getFullYear()}`;
  let horas = d.getHours();
  const minutos = String(d.getMinutes()).padStart(2, "0");
  const periodo = horas >= 12 ? "pm" : "am";
  horas = horas % 12 || 12;
  return `${fechaTexto}, ${horas}:${minutos} ${periodo}`;
}

// Escapado de HTML sin DOM (para que funcione igual en el navegador y en
// Node). Los usos existentes de escapeHtml en este reporte solo van dentro
// de contenido de texto (nunca dentro de un atributo sin comillas), así que
// basta escapar &, < y > — es exactamente lo mismo que producía la versión
// anterior basada en `document.createElement("div").textContent = ...`
// (verificado con casos de prueba: acentos, comillas simples/dobles, y los
// 3 caracteres especiales, ver _reportestest/verificar_escape.mjs).
export function escapeHtml(texto) {
  return (texto ?? "").toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Construye la página 1 (REPORTE RH: un bloque por empleado con el detalle
// de cada hora extra) de la semana [viernes, jueves].
//   listaHoras: arreglo de solicitudes de horas extra (todas, sin filtrar).
//   mapUsuarios: Map(empleadoId -> datos de usuarios).
//   logoSrc: URL o data: URI del logo, ya resuelto por quien llama.
export function construirPaginaRH({ listaHoras, mapUsuarios, viernes, jueves, numeroSemana, logoSrc }) {
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
  const periodoTexto = `Semana ${numeroSemana} - Del ${formatearFechaLargaCap(viernes)} al ${formatearFechaLargaCap(jueves)} ${anio}`;
  const tituloCentro = `REPORTE SEMANAL PARA RH - SEMANA ${numeroSemana}`;

  const segmentosHtml = empleados.length === 0
    ? `<p class="sin-datos">Sin horas extra aprobadas para este periodo.</p>`
    : empleados.map(e => `
      <div class="segmento-empleado">
        <table class="tabla-empleado">
          <tr>
            <td colspan="4" class="fila-nombre-puesto">
              <div class="flex-nombre-puesto">
                <div class="celda-nombre-empleado">NOMBRE DEL EMPLEADO: ${escapeHtml(e.nombre)}</div>
                <div class="celda-puesto-empleado">Puesto: ${escapeHtml(e.puesto)}</div>
              </div>
            </td>
          </tr>
          <tr>
            <th style="width:12%;">Fecha</th>
            <th style="width:14%;">Cantidad de Horas</th>
            <th style="width:22%;">Horario de las Extras *</th>
            <th>Motivo de la Hora(s) Extra(s)</th>
          </tr>
          ${e.filas.map(s => `
            <tr>
              <td class="centrado">${formatearFechaCorta(s.fecha)}</td>
              <td class="centrado">${s.horas}</td>
              <td class="centrado">${formatearHora12(s.horaInicio)} - ${formatearHora12(s.horaFin)}</td>
              <td>${escapeHtml(s.motivo || "")}</td>
            </tr>
          `).join("")}
        </table>
      </div>
    `).join("");

  return `
    <div class="pagina pagina-rh">
      <table class="tabla-paginado">
        <thead>
          <tr><td>
            <div class="encabezado">
              <div class="logo-caja"><img src="${logoSrc}" alt="" onerror="this.style.display='none'"></div>
              <div class="titulo-centro">${escapeHtml(tituloCentro)}</div>
              <div class="espaciador"></div>
            </div>
            <div class="periodo">${escapeHtml(periodoTexto)}</div>
          </td></tr>
        </thead>
        <tbody>
          <tr><td>
            ${segmentosHtml}

            <div class="pie">
              <div class="firmas">
                <div class="firma">Iván Landa<br>Autorización</div>
                <div class="firma">Firma del Depto. de Nóminas<br>Revisión</div>
              </div>
              <div class="pie-empresa">AUTOTRANSPORTES ALANIS, S.A. DE C.V.</div>
              <div class="codigo-formato"><span>ATAF082</span><span>Rev. 0&nbsp;&nbsp;&nbsp;05/02/2024</span></div>
            </div>
          </td></tr>
        </tbody>
      </table>
    </div>
  `;
}

// Construye la página 2 (REPORTE NOMINA: cuadrícula semanal, viernes a
// jueves) de la semana [viernes, jueves]. Incluye horas extra, faltas y
// vacaciones aprobadas.
export function construirPaginaNomina({ listaHoras, listaVacaciones, listaFaltas, mapUsuarios, viernes, jueves, numeroSemana, logoSrc }) {
  const diasSemana = Array.from({ length: 7 }, (_, i) => sumarDias(viernes, i));
  const dentroDeSemana = (fechaStr) => fechaStr >= viernes && fechaStr <= jueves;
  const vacacionesSemana = listaVacaciones.filter(v =>
    v.estatus === "aprobada" && v.fechaInicio <= jueves && v.fechaFin >= viernes
  );

  const porEmpleado = new Map();
  function fila(empleadoId, nombreFallback) {
    if (!porEmpleado.has(empleadoId)) {
      const datosUsuario = mapUsuarios.get(empleadoId) || {};
      porEmpleado.set(empleadoId, {
        numeroEmpleado: datosUsuario.numeroEmpleado || "—",
        nombre: nombreFallback || datosUsuario.nombre || "",
        puesto: datosUsuario.puesto || "—",
        horasPorDia: {},
        faltasPorDia: {},
        vacacionesPorDia: {},
        faltas: 0
      });
    }
    return porEmpleado.get(empleadoId);
  }
  const horasSemana = listaHoras.filter(s => s.estatus === "aprobada" && dentroDeSemana(s.fecha));
  const faltasSemana = listaFaltas.filter(f => f.estatus === "aprobada" && dentroDeSemana(f.fecha));
  horasSemana.forEach(s => {
    const e = fila(s.empleadoId, s.empleadoNombre);
    e.horasPorDia[s.fecha] = (e.horasPorDia[s.fecha] || 0) + (Number(s.horas) || 0);
  });
  faltasSemana.forEach(f => {
    const e = fila(f.empleadoId, f.empleadoNombre);
    e.faltas += 1;
    e.faltasPorDia[f.fecha] = f.tipo;
  });
  vacacionesSemana.forEach(v => {
    const e = fila(v.empleadoId, v.empleadoNombre);
    const diaDescanso = (mapUsuarios.get(v.empleadoId) || {}).diaDescanso ?? 0;
    diasSemana.forEach(f => {
      if (f >= v.fechaInicio && f <= v.fechaFin && new Date(f + "T00:00:00").getDay() !== diaDescanso) {
        e.vacacionesPorDia[f] = true;
      }
    });
  });

  function categoriaEmpleado(e) {
    const totalHoras = Object.values(e.horasPorDia).reduce((acc, h) => acc + h, 0);
    if (totalHoras > 0) return 0;
    if (e.faltas > 0) return 1;
    return 2;
  }
  const empleados = [...porEmpleado.values()].sort((a, b) => {
    const catA = categoriaEmpleado(a);
    const catB = categoriaEmpleado(b);
    if (catA !== catB) return catA - catB;
    return (a.nombre || "").localeCompare(b.nombre || "");
  });

  const anio = viernes.slice(0, 4);
  const periodoTexto = `Del ${formatearFechaLargaCap(viernes)} al ${formatearFechaLargaCap(jueves)} ${anio}`;
  const tituloCentro = `REPORTE SEMANAL PARA NOMINAS - SEMANA ${numeroSemana}`;
  const encabezadosDia = diasSemana.map(f => `<th>${diaSemana(f)}<br>${formatearFechaCorta(f)}</th>`).join("");

  const filasHtml = empleados.length === 0
    ? `<tr><td colspan="${3 + diasSemana.length + 4}" class="centrado">Sin horas extra, vacaciones ni faltas aprobadas para esta semana.</td></tr>`
    : empleados.map(e => {
      const celdasDias = diasSemana.map(f => {
        const tipoFalta = e.faltasPorDia[f];
        if (tipoFalta) return `<td class="centrado celda-falta">FALTA</td>`;
        if (e.vacacionesPorDia[f]) return `<td class="centrado celda-vacacion">VACACIONES</td>`;
        const horas = e.horasPorDia[f];
        return `<td class="centrado">${horas ? horas : "—"}</td>`;
      }).join("");
      const totalSemana = Object.values(e.horasPorDia).reduce((acc, h) => acc + h, 0);
      const totalVacaciones = Object.keys(e.vacacionesPorDia).length;
      const tiposFalta = Object.values(e.faltasPorDia);
      const celdaTipo = tiposFalta.length === 0
        ? "—"
        : [...new Set(tiposFalta.map(t => ETIQUETAS_FALTA_CORTAS[t] || t))].join(", ");
      return `
        <tr>
          <td class="centrado">${escapeHtml(e.numeroEmpleado)}</td>
          <td>${escapeHtml(e.nombre)}</td>
          <td class="col-puesto">${escapeHtml(e.puesto)}</td>
          ${celdasDias}
          <td class="centrado celda-total">${totalSemana}</td>
          <td class="centrado">${totalVacaciones || "—"}</td>
          <td class="centrado">${e.faltas || "—"}</td>
          <td class="centrado">${escapeHtml(celdaTipo)}</td>
        </tr>
      `;
    }).join("");

  return `
    <div class="pagina pagina-nomina">
      <table class="tabla-paginado">
        <thead>
          <tr><td>
            <div class="encabezado">
              <div class="logo-caja"><img src="${logoSrc}" alt="" onerror="this.style.display='none'"></div>
              <div class="titulo-centro">${escapeHtml(tituloCentro)}</div>
              <div class="espaciador"></div>
            </div>
            <div class="periodo">${escapeHtml(periodoTexto)}</div>
          </td></tr>
        </thead>
        <tbody>
          <tr><td>
            <table class="tabla-datos">
              <thead>
                <tr>
                  <th>No.<br>Emp.</th>
                  <th>Nombre</th>
                  <th class="col-puesto">Puesto</th>
                  ${encabezadosDia}
                  <th>H Ext</th>
                  <th>Días<br>Vac</th>
                  <th>Faltas</th>
                  <th>Tipo<br>Falta</th>
                </tr>
              </thead>
              <tbody>
                ${filasHtml}
              </tbody>
            </table>

            <div class="pie-nomina">
              <div class="pie-nomina-contenido">
                <div class="autorizo">Autorizó: Iván Landa</div>
                <div class="meta-impresion">
                  Reporte de horas extras de la semana ${numeroSemana}<br>
                  Generado el ${escapeHtml(formatearFechaHoraGeneracion())}
                </div>
              </div>
              <div class="pie-empresa">AUTOTRANSPORTES ALANIS, S.A. DE C.V.</div>
            </div>
          </td></tr>
        </tbody>
      </table>
    </div>
  `;
}

// CSS del documento completo (idéntico al que vivía inline en reportes.js).
export const CSS_REPORTE = `
  @page { size: letter portrait; margin: 12mm 10mm; }
  @page nomina { size: letter landscape; margin: 12mm 10mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color:#1a1a1a; margin:0; padding:0; }
  .pagina { padding: 6mm; }
  .pagina-nomina { page: nomina; break-before: page; page-break-before: always; }
  .encabezado { display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid #1a1a1a; padding-bottom:6px; margin-bottom:6px; }
  .logo-caja { width:110px; height:50px; display:flex; align-items:center; justify-content:center; }
  .logo-caja img { max-width:110px; max-height:50px; }
  .titulo-centro { flex:1; text-align:center; font-weight:bold; font-size:12px; padding:0 10px; }
  .espaciador { width:110px; }
  .periodo { text-align:center; font-size:11px; margin-bottom:14px; }
  .centrado { text-align:center; }
  .pie { margin-top:16px; padding-top:16px; break-inside: avoid; page-break-inside: avoid; }
  .sin-datos { text-align:center; color:#666; margin-top:20px; }

  .tabla-paginado { width:100%; border-collapse:collapse; }
  .tabla-paginado > thead { display: table-header-group; }
  .tabla-paginado > tbody { display: table-row-group; }
  .tabla-paginado > thead > tr > td,
  .tabla-paginado > tbody > tr > td { border:none; padding:0; }

  .pagina-rh { max-width: 190mm; margin: 0 auto; font-size:11px; }
  .pagina-rh .segmento-empleado { break-inside: avoid; margin-bottom:10px; }
  .pagina-rh .tabla-empleado { width:100%; border-collapse:collapse; }
  .pagina-rh .tabla-empleado th, .pagina-rh .tabla-empleado td { border:1px solid #1a1a1a; padding:3px 6px; font-size:10.5px; }
  .pagina-rh .tabla-empleado th { background:#f7f8fa; font-weight:bold; text-align:center; }
  .pagina-rh .fila-nombre-puesto { background:#eef1f4; padding:0; }
  .pagina-rh .flex-nombre-puesto { display:flex; align-items:stretch; }
  .pagina-rh .celda-nombre-empleado { flex:1 1 auto; padding:4px 6px; font-weight:bold; font-size:11px; border-right:1px solid #1a1a1a; }
  .pagina-rh .celda-puesto-empleado { flex:0 0 auto; padding:4px 6px; font-weight:bold; font-size:11px; white-space:nowrap; }
  .pagina-rh .firmas { display:flex; justify-content:space-between; margin-top:20px; }
  .pagina-rh .firma { width:45%; text-align:center; font-size:10.5px; }
  .pagina-rh .pie-empresa { text-align:center; font-weight:bold; font-size:10px; margin:16px 0 6px; }
  .pagina-rh .codigo-formato { display:flex; justify-content:space-between; font-size:9.5px; margin-top:6px; padding-top:4px; }

  .pagina-nomina { font-size:10px; }
  .pagina-nomina .tabla-datos { width:100%; border-collapse:collapse; break-inside: auto; }
  .pagina-nomina .tabla-datos th, .pagina-nomina .tabla-datos td { border:1px solid #1a1a1a; padding:3px 4px; font-size:9px; }
  .pagina-nomina .tabla-datos th { background:#f7f8fa; font-weight:bold; text-align:center; }
  .pagina-nomina .tabla-datos thead { display: table-header-group; }
  .pagina-nomina .celda-total { font-weight:bold; background:#f2f4f7; }
  .pagina-nomina .celda-falta { font-weight:bold; color:#a32424; }
  .pagina-nomina .celda-vacacion { font-weight:bold; color:#1a6b3c; white-space:nowrap; }
  .pagina-nomina .col-puesto { max-width:95px; word-break:break-word; }
  .pagina-nomina .encabezado { border-bottom:1px solid #1a1a1a; }
  .pagina-nomina .periodo { margin-bottom:10px; }
  .pagina-nomina .pie-nomina { margin-top:16px; padding-top:16px; break-inside: avoid; page-break-inside: avoid; }
  .pagina-nomina .pie-empresa { text-align:center; font-weight:bold; font-size:10px; margin-top:12px; }
  .pagina-nomina .pie-nomina-contenido { display:flex; justify-content:space-between; align-items:flex-end; }
  .pagina-nomina .autorizo { text-align:left; font-size:10.5px; width:220px; padding-top:6px; }
  .pagina-nomina .meta-impresion { font-size:8.5px; color:#555; text-align:right; line-height:1.4; }

  .barra-imprimir { text-align:center; margin:14px 0; }
  .barra-imprimir button { padding:8px 18px; font-size:13px; cursor:pointer; }
  @media print { .barra-imprimir { display:none; } }
`;

// Arma el documento HTML completo (<!DOCTYPE>...</html>) con las 2 páginas.
// `mostrarBarraImprimir`: true en el preview del navegador (botón "Imprimir
// / Guardar como PDF"); false para el render headless de Node — ahí no hay
// nadie que la vaya a hacer clic y así el HTML se queda más limpio (aunque
// de cualquier forma el CSS ya la oculta con @media print).
export function construirHtmlReporteCompleto({ paginaRH, paginaNomina, numeroSemana, mostrarBarraImprimir = true }) {
  const barra = mostrarBarraImprimir
    ? `<div class="barra-imprimir"><button onclick="window.print()">Imprimir / Guardar como PDF</button></div>`
    : "";
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Reporte de horas extras de la semana ${numeroSemana}</title>
<style>${CSS_REPORTE}</style>
</head>
<body>
  ${barra}
  ${paginaRH}
  ${paginaNomina}
</body>
</html>`;
}