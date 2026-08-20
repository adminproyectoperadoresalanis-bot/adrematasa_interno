import { calcularAniosAntiguedad, diasSegunAntiguedad, suscribirUmbrales, UMBRALES_DEFAULT } from "./vacacionesCalculo.js";

// Digitalización del ATAF050 "Formato de solicitud de días de vacaciones" —
// mismo contenido/orden que el PDF oficial, pero pensado para imprimirse ya
// lleno con los datos de la solicitud aprobada (el empleado solo lo firma).

let umbralesActuales = UMBRALES_DEFAULT;
suscribirUmbrales((umbrales) => { umbralesActuales = umbrales; });

const MESES_LARGO = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
];

function formatearFechaDDMMYYYY(fechaStr) {
  if (!fechaStr) return "";
  const [a, m, d] = fechaStr.split("-");
  if (!a || !m || !d) return fechaStr;
  return `${d}/${m}/${a}`;
}

function formatearFechaLarga(fechaStr) {
  if (!fechaStr) return "";
  const [a, m, d] = fechaStr.split("-").map(Number);
  if (!a || !m || !d) return fechaStr;
  return `${d} de ${MESES_LARGO[m - 1]} de ${a}`;
}

function sumarDias(fechaStr, n) {
  const d = new Date(fechaStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// El día en que regresa a laborar es el siguiente al fin de vacaciones; si
// ese día cae justo en su día de descanso, el regreso real es un día después.
function calcularRetornoLabores(fechaFinStr, diaDescanso) {
  let retorno = sumarDias(fechaFinStr, 1);
  const dow = new Date(retorno + "T00:00:00").getDay();
  if (diaDescanso !== null && diaDescanso !== undefined && dow === diaDescanso) {
    retorno = sumarDias(retorno, 1);
  }
  return retorno;
}

// El "periodo vacacional" es el año de antigüedad (aniversario a aniversario)
// dentro del cual cae el inicio de esta solicitud, junto con los días a los
// que da derecho ese año según la tabla vigente del artículo 76 de la LFT.
function calcularPeriodoVacacional(fechaIngresoStr, fechaInicioSolicitudStr) {
  if (!fechaIngresoStr) return null;
  const ingreso = new Date(fechaIngresoStr + "T00:00:00");
  const inicioSolicitud = new Date((fechaInicioSolicitudStr || fechaIngresoStr) + "T00:00:00");
  const anios = calcularAniosAntiguedad(fechaIngresoStr, inicioSolicitud) ?? 0;

  const inicioPeriodo = new Date(ingreso);
  inicioPeriodo.setFullYear(ingreso.getFullYear() + anios);
  const finPeriodo = new Date(inicioPeriodo);
  finPeriodo.setFullYear(finPeriodo.getFullYear() + 1);
  finPeriodo.setDate(finPeriodo.getDate() - 1);

  const iso = (d) => d.toISOString().slice(0, 10);
  return {
    inicioTexto: formatearFechaDDMMYYYY(iso(inicioPeriodo)),
    finTexto: formatearFechaDDMMYYYY(iso(finPeriodo)),
    diasDerecho: diasSegunAntiguedad(anios, umbralesActuales)
  };
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto || "";
  return div.innerHTML;
}

// solicitud: documento de solicitudesVacaciones ya aprobado.
// datosUsuario: doc de usuarios del empleado (nombre, numeroEmpleado, area, puesto, fechaIngreso).
// saldoActual / diaDescansoActual: los valores más recientes que ya tiene la vista en memoria.
export function abrirFormatoVacacionesImprimir(solicitud, datosUsuario, saldoActual, diaDescansoActual) {
  const periodo = calcularPeriodoVacacional(datosUsuario.fechaIngreso, solicitud.fechaInicio);
  const retorno = calcularRetornoLabores(solicitud.fechaFin, diaDescansoActual);
  const logoUrl = window.location.origin + "/img/logo-alanis.png";

  const fechaDocumento = formatearFechaDDMMYYYY((solicitud.creadoEn || "").slice(0, 10)) || formatearFechaDDMMYYYY(solicitud.fechaInicio);

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Formato de solicitud de días de vacaciones — ${escapeHtml(datosUsuario.nombre || "")}</title>
<style>
  @page { size: letter portrait; margin: 16mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: "Helvetica Neue", Arial, Helvetica, sans-serif; color: #2c1e0f; margin: 0; padding: 0; -webkit-font-smoothing: antialiased; }

  .hoja { max-width: 180mm; margin: 0 auto; }

  .encabezado { display: flex; align-items: center; gap: 16px; border-bottom: 1px solid #2c1e0f; padding-bottom: 10px; margin-bottom: 18px; }
  .logo-caja { width: 100px; height: 46px; display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
  .logo-caja img { max-width: 100px; max-height: 46px; }
  .titulo-caja { flex: 1; text-align: right; }
  .titulo-caja .titulo { font-size: 14px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; margin: 0; }
  .titulo-caja .subtitulo { font-size: 9.5px; color: #8a7a68; margin-top: 3px; letter-spacing: 0.4px; }

  .grid { display: grid; border: 1px solid #d8d0c4; border-radius: 6px; overflow: hidden; margin-bottom: 14px; }
  .grid-fila { display: grid; }
  .grid-fila + .grid-fila { border-top: 1px solid #e6e0d5; }
  .celda { padding: 7px 12px; border-left: 1px solid #e6e0d5; }
  .celda:first-child { border-left: none; }
  .celda .etiqueta { display: block; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.5px; color: #9a8c78; margin-bottom: 2px; }
  .celda .valor { font-size: 12px; font-weight: 600; min-height: 14px; }
  .celda-fecha .valor { font-size: 10.5px; }

  .cols-3 { grid-template-columns: 3.1fr 0.9fr 0.85fr; }
  .cols-2 { grid-template-columns: 1.7fr 1fr; }

  .bloque-derecho { border: 1px solid #d8d0c4; border-radius: 6px; padding: 10px 14px; margin-bottom: 14px; font-size: 10.5px; line-height: 1.5; color: #4a4030; }
  .bloque-derecho strong { color: #2c1e0f; }

  .bloque-fechas { border: 1px solid #d8d0c4; border-radius: 6px; margin-bottom: 14px; overflow: hidden; }
  .bloque-fechas h3 { margin: 0; text-align: center; font-size: 10.5px; letter-spacing: 0.6px; text-transform: uppercase; padding: 8px 0; background: #f7f4ee; border-bottom: 1px solid #e6e0d5; font-weight: 700; }
  .fila-dato { display: flex; justify-content: space-between; align-items: baseline; padding: 6px 16px; font-size: 11px; }
  .fila-dato + .fila-dato { border-top: 1px solid #f0ece2; }
  .fila-dato .etiqueta-dato { color: #6b5f4d; }
  .fila-dato .valor-dato { font-weight: 700; }

  .bloque-acuerdo { border: 1px solid #d8d0c4; border-radius: 6px; padding: 16px 20px; margin-bottom: 14px; text-align: center; }
  .bloque-acuerdo p { font-size: 9.5px; color: #4a4030; line-height: 1.6; margin: 0 0 26px; }
  .linea-firma { border-top: 1px solid #2c1e0f; width: 260px; margin: 0 auto 6px; }
  .etiqueta-firma { font-size: 9px; letter-spacing: 0.6px; text-transform: uppercase; color: #6b5f4d; font-weight: 700; }

  .firmas-revision { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #d8d0c4; border-radius: 6px; overflow: hidden; margin-bottom: 20px; }
  .firma-revision-celda { padding: 30px 14px 14px; text-align: center; }
  .firma-revision-celda:first-child { border-right: 1px solid #e6e0d5; }
  .firma-revision-celda .linea-firma { width: 200px; }

  .pie-formato { display: flex; justify-content: space-between; font-size: 8.5px; color: #9a8c78; border-top: 1px solid #e6e0d5; padding-top: 6px; }

  .barra-imprimir { text-align: center; margin: 16px 0; }
  .barra-imprimir button { padding: 8px 18px; font-size: 13px; cursor: pointer; }
  @media print { .barra-imprimir { display: none; } }
</style>
</head>
<body>
  <div class="barra-imprimir"><button onclick="window.print()">Imprimir / Guardar como PDF</button></div>

  <div class="hoja">
    <div class="encabezado">
      <div class="logo-caja"><img src="${logoUrl}" alt="" onerror="this.style.display='none'"></div>
      <div class="titulo-caja">
        <p class="titulo">Formato de solicitud de días de vacaciones</p>
        <p class="subtitulo">Autotransportes Alanis, S.A. de C.V.</p>
      </div>
    </div>

    <div class="grid cols-3">
      <div class="grid-fila cols-3">
        <div class="celda"><span class="etiqueta">Nombre del empleado</span><span class="valor">${escapeHtml(datosUsuario.nombre || "")}</span></div>
        <div class="celda"><span class="etiqueta">N.° Emp.</span><span class="valor">${escapeHtml(datosUsuario.numeroEmpleado || "—")}</span></div>
        <div class="celda celda-fecha"><span class="etiqueta">Fecha</span><span class="valor">${fechaDocumento}</span></div>
      </div>
    </div>

    <div class="grid cols-2">
      <div class="grid-fila cols-2">
        <div class="celda"><span class="etiqueta">Departamento</span><span class="valor">${escapeHtml(datosUsuario.area || "—")}</span></div>
        <div class="celda"><span class="etiqueta">Puesto</span><span class="valor">${escapeHtml(datosUsuario.puesto || "—")}</span></div>
      </div>
    </div>

    <div class="bloque-derecho">
      <div><strong>Fecha de ingreso:</strong> ${formatearFechaDDMMYYYY(datosUsuario.fechaIngreso) || "—"} &nbsp;·&nbsp; <strong>Periodo vacacional:</strong> ${periodo ? `${periodo.inicioTexto} al ${periodo.finTexto}` : "—"}</div>
      <div style="margin-top:6px;">Número de días a los que tiene derecho de conformidad al artículo 76 de la Ley Federal del Trabajo vigente: <strong>${periodo ? periodo.diasDerecho : "—"} días</strong></div>
    </div>

    <div class="bloque-fechas">
      <h3>Fechas de las vacaciones</h3>
      <div class="fila-dato"><span class="etiqueta-dato">Días de vacaciones</span><span class="valor-dato">${solicitud.diasHabiles}</span></div>
      <div class="fila-dato"><span class="etiqueta-dato">Inicio de vacaciones</span><span class="valor-dato">${formatearFechaLarga(solicitud.fechaInicio)}</span></div>
      <div class="fila-dato"><span class="etiqueta-dato">Fin de vacaciones</span><span class="valor-dato">${formatearFechaLarga(solicitud.fechaFin)}</span></div>
      <div class="fila-dato"><span class="etiqueta-dato">Retorno a labores</span><span class="valor-dato">${formatearFechaLarga(retorno)}</span></div>
      <div class="fila-dato"><span class="etiqueta-dato">Días pendientes a disfrutar</span><span class="valor-dato">${saldoActual}</span></div>
    </div>

    <div class="bloque-acuerdo">
      <p>Estoy de acuerdo con lo establecido en este documento y hago constar que se ha dado cumplimiento a lo
        señalado en los artículos 76 al 79 de la Ley Federal del Trabajo vigente y he disfrutado de las
        vacaciones señaladas.</p>
      <div class="linea-firma"></div>
      <div class="etiqueta-firma">Empleado</div>
    </div>

    <div class="firmas-revision">
      <div class="firma-revision-celda">
        <div class="linea-firma"></div>
        <div class="etiqueta-firma">Jefe inmediato</div>
      </div>
      <div class="firma-revision-celda">
        <div class="linea-firma"></div>
        <div class="etiqueta-firma">Recursos humanos</div>
      </div>
    </div>

    <div class="pie-formato">
      <span>ATAF050</span>
      <span>Rev. 3&nbsp;&nbsp;&nbsp;23/09/2024</span>
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