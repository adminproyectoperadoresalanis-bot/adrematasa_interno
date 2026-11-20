// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/public/js/reportesHtml.js
// ##########################################################################
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
// 2026-11-05 (pedido de Ivan): lo que no se paga dice SIN GOCE DE SUELDO, en
// rojo y negritas (celda "Tipo Falta" y caja de pendientes).
// 2026-11-20 (pedido de Ivan): solo 3 tipos — CON GOCE DE SUELDO, SIN GOCE DE
// SUELDO e INCAPACIDAD IMSS; cualquier detalle va en observaciones. Los tipos
// viejos se leen convertidos: injustificada y permiso sin goce = sin goce;
// permiso con goce = con goce; "justificada" no decía si se paga → POR DEFINIR
// (en rojo) hasta que el admin la corrija.
export const TIPOS_FALTA = [
  { value: "con_goce", label: "CON GOCE DE SUELDO" },
  { value: "sin_goce", label: "SIN GOCE DE SUELDO" },
  { value: "incapacidad", label: "INCAPACIDAD IMSS" }
];
const TIPO_FALTA_EQUIVALENTE = {
  con_goce: "con_goce", sin_goce: "sin_goce", incapacidad: "incapacidad",
  injustificada: "sin_goce", permiso_sin_goce: "sin_goce", permiso_con_goce: "con_goce",
  justificada: "por_definir"
};
// Tipo de falta normalizado: "con_goce" | "sin_goce" | "incapacidad" | "por_definir".
export function tipoFaltaNormalizado(tipo) {
  return TIPO_FALTA_EQUIVALENTE[tipo] || "por_definir";
}
export const ETIQUETAS_FALTA_CORTAS = {
  con_goce: "CON GOCE DE SUELDO",
  sin_goce: "SIN GOCE DE SUELDO",
  incapacidad: "INCAPACIDAD IMSS",
  por_definir: "POR DEFINIR"
};
// Etiqueta de cualquier tipo (nuevo o viejo).
export function etiquetaTipoFalta(tipo) {
  return ETIQUETAS_FALTA_CORTAS[tipoFaltaNormalizado(tipo)];
}
// En rojo: lo que no se paga y lo que falta definir.
export function faltaEnRojo(tipo) {
  return ["sin_goce", "por_definir"].includes(tipoFaltaNormalizado(tipo));
}
export const FALTAS_SIN_GOCE = ["sin_goce", "injustificada", "permiso_sin_goce"];

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
export function construirPaginaRH({ listaHoras, mapUsuarios, viernes, jueves, numeroSemana, logoSrc, festivos = [] }) {
  const fechasFestivas = new Set((festivos || []).map(f => f && f.fecha).filter(Boolean));
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
              <td class="centrado">${formatearFechaCorta(s.fecha)}${fechasFestivas.has(s.fecha) ? `<br><span class="tag-festivo">FESTIVO</span>` : ""}</td>
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

// --- "Pendientes de semanas anteriores" -----------------------------------
// Un colaborador a veces captura (o le aprueban) una solicitud DESPUÉS de
// que el reporte de su semana ya se mandó — con el filtro de arriba
// (fecha dentro de [viernes, jueves] de la semana que se está armando AHORA)
// esos registros nunca volverían a aparecer en ningún reporte futuro: se
// pierden en silencio para siempre. Por eso cada solicitud/falta/vacación
// aprobada guarda `enviadoANominaEn` (null hasta que de verdad se incluye en
// un reporte ya entregado — ver automatizacion/generar-y-enviar-reporte.mjs
// y el botón "Vista previa/Imprimir" del admin en js/reportes.js, los dos
// únicos lugares que lo escriben, y solo después de la entrega real, nunca
// solo por generar el PDF). Un registro "pendiente" es uno aprobado, de una
// semana YA PASADA (respecto a la que se está reportando), que todavía no
// tiene esa marca — sin importar por qué se quedó fuera (captura tardía,
// aprobación tardía, o que el envío automático haya fallado esa semana).
//
// filtrarActuales/filtrarPendientes son la ÚNICA fuente de verdad de este
// criterio — tanto construirPaginaNomina (para armar el HTML) como
// idsIncluidosEnReporte (para que quien llama sepa qué ids marcar como
// enviados tras la entrega real) parten de aquí, para que nunca se
// desincronicen. `filtrarPendientes` se exporta además porque js/reportes.js
// la llama directamente para el "Resumen del periodo" en pantalla (con
// `viernes` fijo a la semana real actual, sin importar qué semana esté
// elegida en el filtro) — mismo criterio, un solo lugar donde vive.
function filtrarActuales({ listaHoras, listaVacaciones, listaFaltas, viernes, jueves }) {
  const dentroDeSemana = (fechaStr) => fechaStr >= viernes && fechaStr <= jueves;
  return {
    horas: listaHoras.filter(s => s.estatus === "aprobada" && dentroDeSemana(s.fecha)),
    faltas: listaFaltas.filter(f => f.estatus === "aprobada" && dentroDeSemana(f.fecha)),
    vacaciones: listaVacaciones.filter(v => v.estatus === "aprobada" && v.fechaInicio <= jueves && v.fechaFin >= viernes)
  };
}

export function filtrarPendientes({ listaHoras, listaVacaciones, listaFaltas, viernes }) {
  const yaPasada = (fechaStr) => fechaStr < viernes;
  return {
    horas: listaHoras.filter(s => s.estatus === "aprobada" && !s.enviadoANominaEn && yaPasada(s.fecha)),
    faltas: listaFaltas.filter(f => f.estatus === "aprobada" && !f.enviadoANominaEn && yaPasada(f.fecha)),
    vacaciones: listaVacaciones.filter(v => v.estatus === "aprobada" && !v.enviadoANominaEn && yaPasada(v.fechaFin))
  };
}

// Ids (de las 3 colecciones) que un reporte de la semana [viernes, jueves]
// va a incluir — los de esta semana MÁS los pendientes atrasados. Quien
// arma y de verdad ENTREGA el reporte (correo automático, o el admin al
// confirmar "Vista previa/Imprimir") usa esto para saber qué documentos
// marcar con `enviadoANominaEn` justo después de la entrega exitosa.
export function idsIncluidosEnReporte({ listaHoras, listaVacaciones, listaFaltas, viernes, jueves }) {
  const actuales = filtrarActuales({ listaHoras, listaVacaciones, listaFaltas, viernes, jueves });
  const pendientes = filtrarPendientes({ listaHoras, listaVacaciones, listaFaltas, viernes });
  return {
    horas: [...actuales.horas, ...pendientes.horas].map(x => x.id),
    faltas: [...actuales.faltas, ...pendientes.faltas].map(x => x.id),
    vacaciones: [...actuales.vacaciones, ...pendientes.vacaciones].map(x => x.id)
  };
}

const ETIQUETAS_TIPO_PENDIENTE = {
  horaExtra: "Horas extra",
  falta: "Falta",
  vacacion: "Vacación"
};

// Tabla aparte (caja independiente, NO se mezcla con la cuadrícula semanal
// de abajo porque esa cuadrícula tiene una columna por día de ESTA semana y
// un atrasado de hace 3 semanas no tiene en qué columna caer) con el detalle
// de lo atrasado, para que nóminas lo vea y decida cómo aplicarlo.
function construirSeccionPendientes({ listaHoras, listaVacaciones, listaFaltas, mapUsuarios, viernes, festivos = [] }) {
  const fechasFestivas = new Set((festivos || []).map(f => f && f.fecha).filter(Boolean));
  const p = filtrarPendientes({ listaHoras, listaVacaciones, listaFaltas, viernes });
  const pendientes = [
    ...p.horas.map(s => ({ tipo: "horaExtra", empleadoId: s.empleadoId, empleadoNombre: s.empleadoNombre, fecha: s.fecha, horas: s.horas, motivo: s.motivo })),
    ...p.faltas.map(f => ({ tipo: "falta", empleadoId: f.empleadoId, empleadoNombre: f.empleadoNombre, fecha: f.fecha, tipoFaltaEtiqueta: etiquetaTipoFalta(f.tipo), tipoFalta: f.tipo })),
    ...p.vacaciones.map(v => ({ tipo: "vacacion", empleadoId: v.empleadoId, empleadoNombre: v.empleadoNombre, fechaInicio: v.fechaInicio, fechaFin: v.fechaFin, dias: v.diasHabiles }))
  ];
  if (pendientes.length === 0) return "";

  const filas = pendientes
    .slice()
    .sort((a, b) => (a.fecha || a.fechaInicio || "").localeCompare(b.fecha || b.fechaInicio || ""))
    .map(item => {
      const datosUsuario = mapUsuarios.get(item.empleadoId) || {};
      const nombre = item.empleadoNombre || datosUsuario.nombre || "";
      const numeroEmpleado = datosUsuario.numeroEmpleado || "—";
      const fechaReal = item.tipo === "vacacion"
        ? `${formatearFechaCorta(item.fechaInicio)} al ${formatearFechaCorta(item.fechaFin)}`
        : formatearFechaCorta(item.fecha);
      const fechaParaSemana = item.tipo === "vacacion" ? item.fechaInicio : item.fecha;
      const semanaOriginal = numeroSemanaISO(sumarDias(calcularSemanaLaboral(fechaParaSemana), 6));
      let detalle = "—";
      let cantidad = "";
      if (item.tipo === "horaExtra") {
        detalle = escapeHtml(item.motivo || "");
        cantidad = `${item.horas} h`;
      } else if (item.tipo === "falta") {
        detalle = faltaEnRojo(item.tipoFalta)
          ? `<span class="texto-sin-goce">${escapeHtml(item.tipoFaltaEtiqueta)}</span>`
          : escapeHtml(item.tipoFaltaEtiqueta || "");
        cantidad = "1 día";
      } else if (item.tipo === "vacacion") {
        cantidad = `${item.dias} día${item.dias === 1 ? "" : "s"}`;
      }
      return `
        <tr>
          <td class="centrado">${escapeHtml(numeroEmpleado)}</td>
          <td>${escapeHtml(nombre)}</td>
          <td class="centrado">${item.tipo === "horaExtra" && fechasFestivas.has(item.fecha) ? "Horas en festivo" : (ETIQUETAS_TIPO_PENDIENTE[item.tipo] || item.tipo)}</td>
          <td class="centrado">${fechaReal}</td>
          <td class="centrado">Semana ${semanaOriginal}</td>
          <td>${detalle}</td>
          <td class="centrado">${cantidad}</td>
        </tr>
      `;
    }).join("");

  return `
    <div class="seccion-pendientes">
      <div class="seccion-pendientes-titulo">
        Pendientes de semanas anteriores
        <span class="seccion-pendientes-subtitulo">Aprobadas después del corte de su semana original — no incluidas en ningún reporte previo</span>
      </div>
      <table class="tabla-pendientes">
        <thead>
          <tr>
            <th>No.<br>Emp.</th>
            <th>Nombre</th>
            <th>Tipo</th>
            <th>Fecha</th>
            <th>Semana original</th>
            <th>Detalle</th>
            <th>Cantidad</th>
          </tr>
        </thead>
        <tbody>
          ${filas}
        </tbody>
      </table>
    </div>
  `;
}

// Construye la página 2 (REPORTE NOMINA: cuadrícula semanal, viernes a
// jueves) de la semana [viernes, jueves]. Incluye horas extra, faltas y
// vacaciones aprobadas — más, en su propia sección aparte, lo atrasado de
// semanas anteriores (ver "Pendientes de semanas anteriores" arriba).
// 2026-11-18 (ATAF104): `festivos` = catálogo de configuracion/diasFestivos. Si
// la semana trae un festivo, sus horas salen de "H Ext" y van en "H Fest"
// (se pagan distinto), y el día se marca FESTIVO en el encabezado.
export function construirPaginaNomina({ listaHoras, listaVacaciones, listaFaltas, mapUsuarios, viernes, jueves, numeroSemana, logoSrc, festivos = [] }) {
  const diasSemana = Array.from({ length: 7 }, (_, i) => sumarDias(viernes, i));
  const dentroDeSemana = (fechaStr) => fechaStr >= viernes && fechaStr <= jueves;
  const actuales = filtrarActuales({ listaHoras, listaVacaciones, listaFaltas, viernes, jueves });
  const vacacionesSemana = actuales.vacaciones;

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
  const horasSemana = actuales.horas;
  const faltasSemana = actuales.faltas;
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
  const fechasFestivas = new Set((festivos || []).map(f => f && f.fecha).filter(Boolean));
  const hayFestivo = diasSemana.some(f => fechasFestivas.has(f));
  const encabezadosDia = diasSemana.map(f => fechasFestivas.has(f)
    ? `<th class="dia-festivo">${diaSemana(f)}<br>${formatearFechaCorta(f)}<br><span class="tag-festivo">FESTIVO</span></th>`
    : `<th>${diaSemana(f)}<br>${formatearFechaCorta(f)}</th>`).join("");

  const filasHtml = empleados.length === 0
    ? `<tr><td colspan="${3 + diasSemana.length + 4 + (hayFestivo ? 1 : 0)}" class="centrado">Sin horas extra, vacaciones ni faltas aprobadas para esta semana.</td></tr>`
    : empleados.map(e => {
      const celdasDias = diasSemana.map(f => {
        const tipoFalta = e.faltasPorDia[f];
        if (tipoFalta) return `<td class="centrado celda-falta">FALTA</td>`;
        if (e.vacacionesPorDia[f]) return `<td class="centrado celda-vacacion">VACACIONES</td>`;
        const horas = e.horasPorDia[f];
        return `<td class="centrado${fechasFestivas.has(f) ? " celda-festivo" : ""}">${horas ? horas : "—"}</td>`;
      }).join("");
      const totalSemana = Object.entries(e.horasPorDia).reduce((acc, [f, h]) => acc + (fechasFestivas.has(f) ? 0 : h), 0);
      const totalFestivo = Object.entries(e.horasPorDia).reduce((acc, [f, h]) => acc + (fechasFestivas.has(f) ? h : 0), 0);
      const totalVacaciones = Object.keys(e.vacacionesPorDia).length;
      const tiposFalta = Object.values(e.faltasPorDia);
      const celdaTipo = tiposFalta.length === 0
        ? "—"
        : [...new Set(tiposFalta.map(etiquetaTipoFalta))].join(", ");
      return `
        <tr>
          <td class="centrado">${escapeHtml(e.numeroEmpleado)}</td>
          <td>${escapeHtml(e.nombre)}</td>
          <td class="col-puesto">${escapeHtml(e.puesto)}</td>
          ${celdasDias}
          <td class="centrado celda-total">${totalSemana}</td>
          ${hayFestivo ? `<td class="centrado celda-total celda-festivo">${totalFestivo || "—"}</td>` : ""}
          <td class="centrado">${totalVacaciones || "—"}</td>
          <td class="centrado">${e.faltas || "—"}</td>
          <td class="centrado${tiposFalta.some(faltaEnRojo) ? " celda-sin-goce" : ""}">${escapeHtml(celdaTipo)}</td>
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
                  ${hayFestivo ? `<th class="dia-festivo">H Fest</th>` : ""}
                  <th>Días<br>Vac</th>
                  <th>Faltas</th>
                  <th>Tipo<br>Falta</th>
                </tr>
              </thead>
              <tbody>
                ${filasHtml}
              </tbody>
            </table>

            ${construirSeccionPendientes({ listaHoras, listaVacaciones, listaFaltas, mapUsuarios, viernes, festivos })}

            ${construirSeccionCorrecciones({ listaHoras, listaFaltas, mapUsuarios })}

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
  body { font-family: Arial, Helvetica, sans-serif; color:#1a1a1a; margin:0; padding:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
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
  .pagina-nomina .celda-sin-goce, .texto-sin-goce { font-weight:bold; color:#a32424; }
  .pagina-nomina .celda-vacacion { font-weight:bold; color:#1a6b3c; white-space:nowrap; }
  .pagina-nomina .col-puesto { max-width:95px; word-break:break-word; }
  .pagina-nomina .encabezado { border-bottom:1px solid #1a1a1a; }
  .pagina-nomina .periodo { margin-bottom:10px; }
  .pagina-nomina .pie-nomina { margin-top:16px; padding-top:16px; break-inside: avoid; page-break-inside: avoid; }
  .pagina-nomina .pie-empresa { text-align:center; font-weight:bold; font-size:10px; margin-top:12px; }
  .pagina-nomina .pie-nomina-contenido { display:flex; justify-content:space-between; align-items:flex-end; }
  .pagina-nomina .autorizo { text-align:left; font-size:10.5px; width:220px; padding-top:6px; }
  .pagina-nomina .meta-impresion { font-size:8.5px; color:#555; text-align:right; line-height:1.4; }

  .tag-festivo { display:inline-block; font-size:7px; font-weight:bold; color:#7a4a00; letter-spacing:.3px; }
  .pagina-nomina th.dia-festivo, .pagina-nomina td.celda-festivo { background:#fff1cc; }

  /* ATAF104 — Formato de planeación de personal a laborar día festivo (2026-11-18) */
  .pagina-ataf104 { max-width:190mm; margin:0 auto; font-size:10.5px; color:#222; }
  .pagina-ataf104.con-salto { break-before: page; page-break-before: always; }
  .pagina-ataf104 .a-logo img { max-width:120px; max-height:56px; }
  .pagina-ataf104 .a-tit { text-align:center; font-size:15px; font-weight:bold; margin-top:6px; }
  .pagina-ataf104 .a-tit2 { text-align:center; font-size:10.5px; font-weight:bold; margin-bottom:10px; }
  .pagina-ataf104 .a-enc { width:100%; border-collapse:collapse; font-size:10px; }
  .pagina-ataf104 .a-enc td { padding:6px 8px; }
  .pagina-ataf104 .a-enc .k { background:#3d2b26; color:#fff; font-weight:bold; font-size:8px; width:17%; text-transform:uppercase; }
  .pagina-ataf104 .a-enc .v { background:#efe9df; width:33%; }
  .pagina-ataf104 .a-sec { font-size:10.5px; font-weight:bold; border-bottom:1px solid #c9b58f; margin:14px 0 4px; padding-bottom:3px; }
  .pagina-ataf104 .a-nota { font-size:8.5px; margin-bottom:4px; }
  .pagina-ataf104 .a-tabla { width:100%; border-collapse:collapse; }
  .pagina-ataf104 .a-tabla th { background:#3d2b26; color:#fff; font-size:8.5px; padding:3px; }
  .pagina-ataf104 .a-tabla td { border:1px solid #444; padding:5px 6px; font-size:10px; }
  .pagina-ataf104 .a-tabla tr { break-inside: avoid; }
  .pagina-ataf104 .a-caja { border:1px solid #444; padding:6px 9px; font-size:10px; min-height:40px; }
  .pagina-ataf104 .a-caja ol { margin:0; padding-left:18px; }
  .pagina-ataf104 .a-caja li { margin:2px 0; }
  .pagina-ataf104 .a-firmas { display:flex; justify-content:space-around; margin-top:34px; font-size:9px; text-align:center; break-inside: avoid; }
  .pagina-ataf104 .a-firmas > div { width:30%; }
  .pagina-ataf104 .a-firmas .l { border-top:1px solid #999; margin:0 12% 3px; }
  .pagina-ataf104 .a-firmas .a-nombre { font-size:10px; font-weight:bold; margin-bottom:2px; min-height:14px; }
  .pagina-ataf104 .a-firmas b { display:block; }
  .pagina-ataf104 .a-leyenda { text-align:center; font-size:8px; font-style:italic; color:#666; margin-top:10px; }
  .pagina-ataf104 .a-pie { display:flex; justify-content:space-between; font-size:8.5px; margin-top:14px; }

  .barra-imprimir { text-align:center; margin:14px 0; }
  .barra-imprimir button { padding:8px 18px; font-size:13px; cursor:pointer; }
  @media print { .barra-imprimir { display:none; } }

  .seccion-correcciones { margin-top: 14px; border: 1.5px solid #6A3A9A; border-radius: 4px; break-inside: avoid; page-break-inside: avoid; }
  .seccion-correcciones-titulo { background:#F4ECFA; color:#4B2370; font-weight:bold; font-size:10.5px; padding:5px 8px; border-bottom: 1.5px solid #6A3A9A; display:flex; flex-direction:column; gap:2px; }
  .seccion-correcciones-subtitulo { font-weight:normal; font-size:8.5px; color:#5d3c7c; }
  .tabla-correcciones { width:100%; border-collapse:collapse; }
  .tabla-correcciones th, .tabla-correcciones td { border:1px solid #cdb6e0; padding:3px 5px; font-size:8.5px; }
  .tabla-correcciones th { background:#F4ECFA; font-weight:bold; text-align:center; }
  .seccion-pendientes { margin-top: 14px; border: 1.5px solid #a35a00; border-radius: 4px; break-inside: avoid; page-break-inside: avoid; }
  .seccion-pendientes-titulo { background:#fff4e3; color:#7a3e00; font-weight:bold; font-size:10.5px; padding:5px 8px; border-bottom: 1.5px solid #a35a00; display:flex; flex-direction:column; gap:2px; }
  .seccion-pendientes-subtitulo { font-weight:normal; font-size:8.5px; color:#8a5a20; }
  .tabla-pendientes { width:100%; border-collapse:collapse; }
  .tabla-pendientes th, .tabla-pendientes td { border:1px solid #d9b98a; padding:3px 5px; font-size:8.5px; }
  .tabla-pendientes th { background:#fdf1e0; font-weight:bold; text-align:center; }
  .tabla-pendientes thead { display: table-header-group; }
`;

// Arma el documento HTML completo (<!DOCTYPE>...</html>) con las 2 páginas.
// `mostrarBarraImprimir`: true en el preview del navegador (botón "Imprimir
// / Guardar como PDF"); false para el render headless de Node — ahí no hay
// nadie que la vaya a hacer clic y así el HTML se queda más limpio (aunque
// de cualquier forma el CSS ya la oculta con @media print).
export function construirHtmlReporteCompleto({ paginaRH, paginaNomina, numeroSemana, mostrarBarraImprimir = true, paginasExtra = [] }) {
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
  ${(paginasExtra || []).join("\n")}
</body>
</html>`;
}

// ============================================================================
// Correcciones después de nómina (2026-11-20, pedido de Ivan). Cuando algo ya
// se mandó a nómina (enviadoANominaEn) y estaba mal, el admin lo corrige desde
// Horas extra o Faltas. Cada solicitud/falta guarda un arreglo `correcciones`
// con { en, por, motivo, antes, despues, semanaReportada, informadaEn,
// informadaPor, informadaVia }. Mientras informadaEn sea null, la corrección
// está "pendiente de informar": sale en Reportes (botón para mandarla ya por
// correo) y, si no se mandó, en el siguiente reporte del jueves. Una vez
// informada no se repite.
// ============================================================================
export function correccionesPendientes({ listaHoras = [], listaFaltas = [] }) {
  const items = [];
  const juntar = (lista, col) => lista.forEach(doc => (Array.isArray(doc.correcciones) ? doc.correcciones : [])
    .forEach(c => { if (c && !c.informadaEn) items.push({ col, id: doc.id, doc, c }); }));
  juntar(listaHoras, "solicitudes");
  juntar(listaFaltas, "faltas");
  return items.sort((a, b) => (a.doc.fecha || "").localeCompare(b.doc.fecha || "") || (a.c.en || "").localeCompare(b.c.en || ""));
}

const textoHoras = (x) => x && (x.horas > 0)
  ? `${formatearHora12(x.horaInicio)} - ${formatearHora12(x.horaFin)} · ${x.horas} h`
  : "0 h (no procedía)";
// Lo que se reportó: una "justificada" vieja se nombra tal cual (así salió en el reporte).
const textoFalta = (x) => x && x.estatus === "rechazada" ? "No hubo falta" : (x && x.tipo === "justificada" ? "Justificada" : etiquetaTipoFalta(x && x.tipo));
const pagaFalta = (x) => !(x && x.estatus !== "rechazada" && tipoFaltaNormalizado(x.tipo) === "sin_goce");

// Una corrección en palabras (tabla de Reportes, PDF del correo y reporte del jueves).
export function describirCorreccion(item, mapUsuarios) {
  const { col, doc, c } = item;
  const u = (mapUsuarios && mapUsuarios.get(doc.empleadoId)) || {};
  const semanaReportada = c.semanaReportada || calcularSemanaLaboral(doc.fecha);
  const base = {
    numeroEmpleado: u.numeroEmpleado || "—",
    nombre: doc.empleadoNombre || u.nombre || "",
    fecha: doc.fecha, fechaCorta: formatearFechaCorta(doc.fecha),
    semana: numeroSemanaISO(sumarDias(semanaReportada, 6)),
    motivo: c.motivo || "",
    por: (c.por && c.por.nombre) || ""
  };
  if (col === "solicitudes") {
    const dif = Math.round(((Number(c.despues && c.despues.horas) || 0) - (Number(c.antes && c.antes.horas) || 0)) * 100) / 100;
    return { ...base, concepto: "Horas extra", antes: textoHoras(c.antes), despues: textoHoras(c.despues),
      diferencia: dif === 0 ? "Sin cambio de horas" : dif < 0 ? `-${Math.abs(dif)} h (descontar)` : `+${dif} h (pagar)`,
      enRojo: dif < 0 };
  }
  const antesPaga = pagaFalta(c.antes), despuesPaga = pagaFalta(c.despues);
  return { ...base, concepto: "Falta", antes: textoFalta(c.antes), despues: textoFalta(c.despues),
    diferencia: antesPaga === despuesPaga ? (despuesPaga ? "Se paga el día (sin cambio)" : "No se paga el día (sin cambio)") : despuesPaga ? "Sí se paga el día" : "No se paga el día",
    enRojo: !despuesPaga };
}

function construirSeccionCorrecciones({ listaHoras, listaFaltas, mapUsuarios }) {
  const items = correccionesPendientes({ listaHoras, listaFaltas });
  if (!items.length) return "";
  const filas = items.map(it => {
    const d = describirCorreccion(it, mapUsuarios);
    return `
        <tr>
          <td class="centrado">${escapeHtml(d.numeroEmpleado)}</td>
          <td>${escapeHtml(d.nombre)}</td>
          <td class="centrado">${d.concepto}</td>
          <td class="centrado">${d.fechaCorta}</td>
          <td class="centrado">Semana ${d.semana}</td>
          <td>${escapeHtml(d.antes)}</td>
          <td>${d.enRojo ? `<span class="texto-sin-goce">${escapeHtml(d.despues)}</span>` : escapeHtml(d.despues)}</td>
          <td class="centrado">${d.enRojo ? `<span class="texto-sin-goce">${escapeHtml(d.diferencia)}</span>` : escapeHtml(d.diferencia)}</td>
          <td>${escapeHtml(d.motivo)}</td>
        </tr>`;
  }).join("");
  return `
    <div class="seccion-correcciones">
      <div class="seccion-correcciones-titulo">
        Correcciones a reportes anteriores
        <span class="seccion-correcciones-subtitulo">Registros que ya se habían reportado y se corrigieron después</span>
      </div>
      <table class="tabla-correcciones">
        <thead><tr><th>No.<br>Emp.</th><th>Nombre</th><th>Concepto</th><th>Fecha</th><th>Reportado en</th><th>Se reportó</th><th>Debe ser</th><th>Diferencia</th><th>Motivo</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>
  `;
}

// ============================================================================
// ATAF104 — Formato de planeación de personal a laborar en día festivo
// (2026-11-18, pedido de Ivan / RH). Mismo criterio que el resto de este
// módulo: lógica pura, la usan la vista previa (js/reportes.js) y el envío
// automático (automatizacion/generar-y-enviar-ataf104.mjs), así lo que se ve
// es exactamente lo que se manda.
//   - Sirve para 2 cosas en 2 momentos: (1) nóminas avisa a seguridad quién
//     entra → se manda SOLO, 2 días hábiles antes del festivo a las 9:00 am;
//     (2) el pago va en el reporte semanal, columna "H Fest" (arriba).
//   - Entran solo las solicitudes APROBADAS de la fecha del festivo.
//   - Área fija "Importaciones"; Puesto = "Puesto · Área" del catálogo.
//   - Sin filas vacías; el horario es el que capturó el empleado.
// ============================================================================
export const AREA_ATAF104 = "Importaciones";
export const HORA_ENVIO_ATAF104 = 9; // 9:00 am hora de Nuevo Laredo
export const CORREO_AUTORIZA_ATAF104 = "ilanda@alanis.com.mx";

function esDiaHabil(fechaStr, fechasFestivas) {
  const dow = new Date(fechaStr + "T00:00:00").getDay();
  return dow !== 0 && dow !== 6 && !fechasFestivas.has(fechaStr);
}
// n días hábiles antes de fechaStr (sábado, domingo y festivos del catálogo no cuentan).
export function diasHabilesAntes(fechaStr, n, festivos = []) {
  const fechasFestivas = new Set((festivos || []).map(f => f && f.fecha).filter(Boolean));
  let d = fechaStr, cuenta = 0;
  while (cuenta < n) {
    d = sumarDias(d, -1);
    if (esDiaHabil(d, fechasFestivas)) cuenta++;
  }
  return d;
}
// Día en que sale el ATAF104 de un festivo: 2 días hábiles antes.
export function fechaEnvioAtaf104(fechaFestivo, festivos = []) {
  return diasHabilesAntes(fechaFestivo, 2, festivos);
}
// Día del recordatorio: 1 día hábil antes del envío.
export function fechaRecordatorioAtaf104(fechaFestivo, festivos = []) {
  return diasHabilesAntes(fechaEnvioAtaf104(fechaFestivo, festivos), 1, festivos);
}

// "2026-12-23" -> "miércoles 23 de diciembre"
export function fechaLargaConDia(fechaStr) {
  const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const [a, m, d] = (fechaStr || "").split("-").map(Number);
  if (!a || !m || !d) return fechaStr || "";
  return `${DIAS[new Date(fechaStr + "T00:00:00").getDay()]} ${d} de ${MESES_LARGO[m - 1]}`;
}

function fechaDDMMYYYY(fechaStr) {
  const [a, m, d] = (fechaStr || "").split("-");
  return a && m && d ? `${d}/${m}/${a}` : (fechaStr || "");
}

// Festivos que se reportan junto con la semana [viernes, jueves]: los de esa
// semana y los de la siguiente (el ATAF104 se manda antes del festivo, así
// que casi siempre cae en la semana anterior).
export function festivosParaAtaf104({ festivos, viernes }) {
  const hasta = sumarDias(viernes, 13);
  return (festivos || []).filter(f => f && f.fecha && f.fecha >= viernes && f.fecha <= hasta)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

// Nombre de quien autoriza (Jefe / Gerente responsable).
export function responsableAtaf104(mapUsuarios) {
  for (const u of mapUsuarios.values()) {
    if (String((u && u.email) || "").trim().toLowerCase() === CORREO_AUTORIZA_ATAF104) return u.nombre || "Iván Landa";
  }
  return "Iván Landa";
}

// Personas del festivo: una por empleado (si trae 2 bloques ese día se juntan).
// Regresa { personas: [{ nombre, puesto, horario, motivo }], pendientes: [solicitudes] }.
export function personasAtaf104({ listaHoras, mapUsuarios, fecha }) {
  const delDia = listaHoras.filter(s => s.fecha === fecha);
  const pendientes = delDia.filter(s => s.estatus === "pendiente");
  const porEmpleado = new Map();
  delDia.filter(s => s.estatus === "aprobada")
    .sort((a, b) => (a.horaInicio || "").localeCompare(b.horaInicio || ""))
    .forEach(s => {
      const u = mapUsuarios.get(s.empleadoId) || {};
      if (!porEmpleado.has(s.empleadoId)) {
        porEmpleado.set(s.empleadoId, {
          nombre: u.nombre || s.empleadoNombre || "",
          area: u.area || "",
          puesto: [u.puesto, u.area].filter(Boolean).join(" · ") || "—",
          horarios: [], motivos: []
        });
      }
      const p = porEmpleado.get(s.empleadoId);
      p.horarios.push(`${s.horaInicio} – ${s.horaFin}`);
      if (s.motivo) p.motivos.push(String(s.motivo).trim());
    });
  const personas = [...porEmpleado.values()]
    .sort((a, b) => a.area.localeCompare(b.area, "es") || a.nombre.localeCompare(b.nombre, "es"))
    .map(p => ({ nombre: p.nombre, puesto: p.puesto, horario: p.horarios.join(" y "), motivo: p.motivos.join("; ") }));
  return { personas, pendientes };
}

// Hoja ATAF104 (carta vertical). conSalto: true cuando va después de otras
// hojas (vista previa del reporte semanal).
export function construirPaginaAtaf104({ fecha, festivoNombre, personas, responsable, fechaSolicitud, observaciones, logoSrc, conSalto = false }) {
  const filas = personas.map((p, i) => `
      <tr>
        <td class="centrado" style="width:6%;">${i + 1}</td>
        <td>${escapeHtml(p.nombre)}</td>
        <td>${escapeHtml(p.puesto)}</td>
        <td class="centrado">${escapeHtml(p.horario)}</td>
      </tr>`).join("");
  return `
    <div class="pagina pagina-ataf104${conSalto ? " con-salto" : ""}">
      <div class="a-logo"><img src="${logoSrc}" alt="" onerror="this.style.display='none'"></div>
      <div class="a-tit">FORMATO DE PLANEACIÓN DE PERSONAL A LABORAR</div>
      <div class="a-tit2">DÍA FESTIVO</div>
      <table class="a-enc">
        <tr><td class="k">Fecha del día festivo</td><td class="v">${fechaDDMMYYYY(fecha)}${festivoNombre ? ` — ${escapeHtml(festivoNombre)}` : ""}</td>
            <td class="k">Área / Departamento</td><td class="v">${AREA_ATAF104}</td></tr>
        <tr><td class="k">Jefe / Gerente responsable</td><td class="v">${escapeHtml(responsable || "")}</td>
            <td class="k">Fecha de solicitud</td><td class="v">${fechaDDMMYYYY(fechaSolicitud)}</td></tr>
      </table>
      <div class="a-sec">1. RELACIÓN DEL PERSONAL PROGRAMADO</div>
      <div class="a-nota"><i>Registrar únicamente al personal estrictamente necesario para garantizar la continuidad de la operación.</i></div>
      <table class="a-tabla">
        <thead><tr><th>No.</th><th>Nombre del colaborador</th><th>Puesto</th><th>Horario de entrada y salida</th></tr></thead>
        <tbody>${filas || `<tr><td colspan="4" class="centrado">Sin personal aprobado.</td></tr>`}</tbody>
      </table>
      <div class="a-sec">2. JUSTIFICACIÓN DE LA PROGRAMACIÓN</div>
      <div class="a-nota">Describir el motivo por trabajador, por el cual se requiere la presencia del personal durante el día festivo y la actividad operativa que deberá atender.</div>
      <div class="a-caja"><ol>${personas.map(p => `<li>${escapeHtml(p.motivo)}</li>`).join("")}</ol></div>
      <div class="a-sec">3. OBSERVACIONES ADICIONALES</div>
      <div class="a-caja" style="white-space:pre-wrap;">${escapeHtml(observaciones || "")}</div>
      <div class="a-sec">4. AUTORIZACIONES</div>
      <div class="a-firmas">
        <div><div class="a-nombre">${escapeHtml(responsable || "")}</div><div class="l"></div><b>GERENTE DEL ÁREA</b>Nombre y firma<br><br>Fecha: ${fechaSolicitud ? fechaDDMMYYYY(fechaSolicitud).split("/").join(" / ") : "____ / ____ / ______"}</div>
        <div><div class="a-nombre"></div><div class="l"></div><b>GERENCIA DE RECURSOS HUMANOS</b>Nombre y firma<br><br>Fecha: ____ / ____ / ______</div>
        <div><div class="a-nombre"></div><div class="l"></div><b>DIRECCIÓN FINANCIERA</b>Nombre y firma<br><br>Fecha: ____ / ____ / ______</div>
      </div>
      <div class="a-leyenda">La programación de personal para días festivos deberá contar con las autorizaciones correspondientes antes de su ejecución.</div>
      <div class="a-pie"><span>ATAF104</span><span>Rev 0.&nbsp;&nbsp;&nbsp;13/11/2026</span></div>
    </div>
  `;
}

// Documento completo solo con el ATAF104 (correo automático).
export function construirHtmlAtaf104({ paginaAtaf104, titulo, mostrarBarraImprimir = false }) {
  const barra = mostrarBarraImprimir
    ? `<div class="barra-imprimir"><button onclick="window.print()">Imprimir / Guardar como PDF</button></div>`
    : "";
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(titulo || "ATAF104")}</title>
<style>${CSS_REPORTE}</style>
</head>
<body>
  ${barra}
  ${paginaAtaf104}
</body>
</html>`;
}