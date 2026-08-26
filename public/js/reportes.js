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

// --- Horario semanal: mismos helpers que admin.js/equipo.js (se duplican
// aquí por la misma razón: cada pantalla arma su horario a partir de lo que
// tenga guardado el usuario, sin depender de un módulo compartido). ---
const NOMBRES_DIA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
// Orden en el que se imprimen las columnas del resumen: Lunes...Domingo
// (el arreglo horarioSemanal guarda 0=domingo...6=sábado).
const ORDEN_COLUMNAS_DIA = [1, 2, 3, 4, 5, 6, 0];

function horarioSemanalPorDefault(diaDescansoActual) {
  return NOMBRES_DIA.map((_, i) => (
    i === diaDescansoActual
      ? { descanso: true, horaInicio: "", horaFin: "", comida: 0 }
      : { descanso: false, horaInicio: "08:00", horaFin: "17:00", comida: 1 }
  ));
}

function normalizarHorarioSemanal(u) {
  if (Array.isArray(u.horarioSemanal) && u.horarioSemanal.length === 7) {
    return u.horarioSemanal.map(dia => ({
      descanso: !!(dia && dia.descanso),
      horaInicio: (dia && dia.horaInicio) || "",
      horaFin: (dia && dia.horaFin) || "",
      comida: Number(dia && dia.comida) || 0
    }));
  }
  return horarioSemanalPorDefault(u.diaDescanso ?? 0);
}

function calcularHorasDia(horaInicio, horaFin) {
  if (!horaInicio || !horaFin) return 0;
  const [hi, mi] = horaInicio.split(":").map(Number);
  const [hf, mf] = horaFin.split(":").map(Number);
  if ([hi, mi, hf, mf].some(n => isNaN(n))) return 0;
  let minutos = (hf * 60 + mf) - (hi * 60 + mi);
  if (minutos <= 0) minutos += 24 * 60; // turno que cruza la medianoche
  return minutos / 60;
}

function calcularHorasNetasDia(horaInicio, horaFin, comida) {
  return Math.max(0, calcularHorasDia(horaInicio, horaFin) - (Number(comida) || 0));
}

function calcularHorasSemanales(horarioSemanal) {
  return horarioSemanal.reduce(
    (acc, dia) => acc + (dia.descanso ? 0 : calcularHorasNetasDia(dia.horaInicio, dia.horaFin, dia.comida)),
    0
  );
}

// Etiquetas cortas para el resumen de horarios: mismos valores de "tipo"
// que ya usa faltas.js.
const ETIQUETAS_FALTA_CORTAS = {
  injustificada: "Injustificada",
  justificada: "Justificada",
  incapacidad: "Incapacidad",
  permiso_con_goce: "Con goce",
  permiso_sin_goce: "Sin goce"
};

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

    <section class="panel" style="margin-top:20px;">
      <h2>Resumen de horarios (Word)</h2>
      <p class="nota">
        Un documento .docx con el horario semanal actual de ${esAdmin ? "cada empleado activo" : "cada empleado activo de tu equipo"}
        (entrada, salida, comida y total de horas), y una columna "Proyección" en blanco para anotar a mano una
        propuesta de ajuste futuro.
      </p>
      <div class="acciones-form">
        <button type="button" class="secundario" id="btn-resumen-horarios">Descargar resumen de horarios (.docx)</button>
      </div>
      <div id="horarios-docx-error" class="error"></div>
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

  contenedor.querySelector("#btn-resumen-horarios")?.addEventListener("click", generarResumenHorariosDocx);

  // Arma y descarga un .docx con el horario semanal actual de cada empleado
  // activo: un renglón por persona, una columna por día (Lunes...Domingo,
  // aunque horarioSemanal lo guarda 0=domingo...6=sábado), el total de
  // horas netas de la semana, y una columna "Proyección" en blanco para que
  // el admin anote a mano una propuesta de ajuste futuro directo en Word.
  // Se genera 100% en el navegador con la librería "docx" (sin backend),
  // igual que el resto de esta app.
  async function generarResumenHorariosDocx() {
    const errorDiv = contenedor.querySelector("#horarios-docx-error");
    const boton = contenedor.querySelector("#btn-resumen-horarios");
    errorDiv.textContent = "";
    boton.disabled = true;
    const textoOriginal = boton.textContent;
    boton.textContent = "Generando...";

    try {
      const {
        Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        WidthType, HeadingLevel, AlignmentType, PageOrientation, ShadingType,
        Footer, PageNumber, TabStopType, Tab
      } = await import("https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.mjs");

      // Se calcula el horario y el total de cada quien primero, para poder
      // ordenar por total de mayor a menor (en vez del alfabético de antes).
      const empleados = [...mapUsuarios.entries()]
        .map(([id, u]) => ({ id, ...u }))
        .filter(u => u.estatus === "activo")
        .map(u => {
          const horario = normalizarHorarioSemanal(u);
          return { ...u, horario, total: calcularHorasSemanales(horario) };
        })
        .sort((a, b) => b.total - a.total);

      if (empleados.length === 0) {
        errorDiv.textContent = "No hay empleados activos para incluir en el resumen.";
        return;
      }

      // Todo el texto de la tabla va en Calibri 8pt (tamaño en docx se mide
      // en medios-puntos: 16 = 8pt) — es lo único a lo que aplica esta
      // fuente/tamaño, el título y el pie de página usan la suya propia.
      function celdaTexto(texto, { bold = false, italics = false, color, centrado = true } = {}) {
        return new Paragraph({
          alignment: centrado ? AlignmentType.CENTER : AlignmentType.LEFT,
          children: [new TextRun({ text: texto, bold, italics, color, font: "Calibri", size: 16 })]
        });
      }

      function celdaDia(dia) {
        if (!dia || dia.descanso) {
          return new TableCell({
            children: [celdaTexto("Descanso", { italics: true })]
          });
        }
        const horasNetas = calcularHorasNetasDia(dia.horaInicio, dia.horaFin, dia.comida);
        return new TableCell({
          children: [
            celdaTexto(`${dia.horaInicio}–${dia.horaFin}`, { bold: true }),
            celdaTexto(`${horasNetas.toFixed(2)} hrs trabajadas`),
            celdaTexto(`${dia.comida || 0} hrs comida`)
          ]
        });
      }

      const encabezados = ["Empleado", ...ORDEN_COLUMNAS_DIA.map(i => NOMBRES_DIA[i]), "Total actual", "Proyección"];
      const anchosColumna = [15, 9, 9, 9, 9, 9, 9, 9, 8, 14]; // suman 100% (Empleado más ancho por el "No. - Nombre")
      const filaEncabezado = new TableRow({
        tableHeader: true,
        children: encabezados.map((txt, i) => new TableCell({
          width: { size: anchosColumna[i], type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.SOLID, color: "2C1E0F" },
          children: [celdaTexto(txt, { bold: true, color: "FFFFFF" })]
        }))
      });

      const filasEmpleados = empleados.map(u => {
        const numeroTexto = u.numeroEmpleado || "—";
        return new TableRow({
          children: [
            new TableCell({
              width: { size: anchosColumna[0], type: WidthType.PERCENTAGE },
              children: [celdaTexto(`${numeroTexto} - ${u.nombre || ""}`, { bold: true, centrado: false })]
            }),
            ...ORDEN_COLUMNAS_DIA.map(i => celdaDia(u.horario[i])),
            new TableCell({
              width: { size: anchosColumna[8], type: WidthType.PERCENTAGE },
              children: [celdaTexto(u.total.toFixed(2), { bold: true })]
            }),
            new TableCell({
              width: { size: anchosColumna[9], type: WidthType.PERCENTAGE },
              children: [celdaTexto("")]
            })
          ]
        });
      });

      const tabla = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [filaEncabezado, ...filasEmpleados]
      });

      // Pie de página en una sola línea con 3 posiciones (tabulador central y
      // derecho calculados a partir del ancho útil de la hoja en landscape
      // letter menos los márgenes de arriba): "Generado el..." a la
      // izquierda, la razón social al centro, y número de página / total a
      // la derecha (sin la palabra "Total", solo "1/1", "1/2", etc.).
      const anchoUtil = 15840 - 560 - 560; // twips: ancho letter landscape - margen izq - margen der
      const piePagina = new Footer({
        children: [
          new Paragraph({
            tabStops: [
              { type: TabStopType.CENTER, position: 560 + anchoUtil / 2 },
              { type: TabStopType.RIGHT, position: 560 + anchoUtil }
            ],
            children: [
              new TextRun({ text: `Generado el ${formatearFechaHoraGeneracion()}`, font: "Calibri", size: 12 }),
              new TextRun({ children: [new Tab()] }),
              new TextRun({ text: "AUTOTRANSPORTES ALANIS, S.A. DE C.V.", font: "Calibri", size: 12, bold: true }),
              new TextRun({ children: [new Tab()] }),
              new TextRun({ children: [PageNumber.CURRENT, "/", PageNumber.TOTAL_PAGES], font: "Calibri", size: 12 })
            ]
          })
        ]
      });

      const doc = new Document({
        sections: [{
          properties: {
            page: {
              // 12240x15840 twips son las medidas de carta (8.5x11") en
              // vertical; con orientation LANDSCAPE la librería las voltea
              // para dar la hoja horizontal de 15840x12240 que usa el resto
              // de este documento (por eso el pie de página calcula su
              // ancho útil a partir de 15840). Sin esto, docx usa A4 por
              // default en vez de carta.
              size: { width: 12240, height: 15840, orientation: PageOrientation.LANDSCAPE },
              margin: { top: 720, bottom: 720, left: 560, right: 560 }
            }
          },
          footers: { default: piePagina },
          children: [
            new Paragraph({ text: "Resumen de horarios por empleado", heading: HeadingLevel.HEADING_1 }),
            new Paragraph({ text: "" }),
            tabla
          ]
        }]
      });

      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement("a");
      enlace.href = url;
      enlace.download = `resumen_horarios_${hoyLocalStr()}.docx`;
      document.body.appendChild(enlace);
      enlace.click();
      document.body.removeChild(enlace);
      URL.revokeObjectURL(url);
    } catch (err) {
      errorDiv.textContent = "No se pudo generar el documento: " + err.message;
    } finally {
      boton.disabled = false;
      boton.textContent = textoOriginal;
    }
  }

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
    const periodoTexto = `Semana ${numeroSemana} - Del ${formatearFechaLargaCap(viernes)} al ${formatearFechaLargaCap(jueves)} ${anio}`;
    const tituloCentro = `REPORTE SEMANAL PARA RH - SEMANA ${numeroSemana}`;
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
        <table class="tabla-paginado">
          <thead>
            <tr><td>
              <div class="encabezado">
                <div class="logo-caja"><img src="${logoUrl}" alt="" onerror="this.style.display='none'"></div>
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
  // jueves) de la semana elegida arriba. Incluye horas extra, faltas y
  // vacaciones aprobadas — antes solo juntaba horas extra y faltas, así que
  // un empleado con únicamente vacaciones esa semana nunca aparecía en esta
  // tabla (aunque sí salía en "Resumen del periodo", que siempre las contó).
  function construirPaginaNomina(viernes, jueves, numeroSemana) {
    const diasSemana = Array.from({ length: 7 }, (_, i) => sumarDias(viernes, i));
    const dentroDeSemana = (fechaStr) => fechaStr >= viernes && fechaStr <= jueves;
    // Una solicitud de vacaciones es un rango (fechaInicio..fechaFin), no una
    // fecha única como horas/faltas, así que "cae en esta semana" es que su
    // rango se traslape con la semana — puede empezar antes o terminar
    // después y aun así tocar algunos días de esta semana.
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
          faltasPorDia: {}, // fecha -> tipo, para marcar "FALTA" en el día exacto
          vacacionesPorDia: {}, // fecha -> true, para marcar "VAC" en el día exacto
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
      // El día de descanso del empleado no se marca como vacación aunque
      // caiga dentro del rango solicitado — igual que en vacaciones.js, ese
      // día no se descuenta del saldo porque de por sí no es día laboral.
      const diaDescanso = (mapUsuarios.get(v.empleadoId) || {}).diaDescanso ?? 0;
      diasSemana.forEach(f => {
        if (f >= v.fechaInicio && f <= v.fechaFin && new Date(f + "T00:00:00").getDay() !== diaDescanso) {
          e.vacacionesPorDia[f] = true;
        }
      });
    });

    const empleados = [...porEmpleado.values()].sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));

    const anio = viernes.slice(0, 4);
    const periodoTexto = `Del ${formatearFechaLargaCap(viernes)} al ${formatearFechaLargaCap(jueves)} ${anio}`;
    const tituloCentro = `REPORTE SEMANAL PARA NOMINAS - SEMANA ${numeroSemana}`;
    const logoUrl = window.location.origin + "/img/logo-alanis.png";
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
                <div class="logo-caja"><img src="${logoUrl}" alt="" onerror="this.style.display='none'"></div>
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
                    Generado el ${formatearFechaHoraGeneracion()}
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
  .titulo-centro { flex:1; text-align:center; font-weight:bold; font-size:12px; padding:0 10px; }
  .espaciador { width:110px; }
  .periodo { text-align:center; font-size:11px; margin-bottom:14px; }
  .centrado { text-align:center; }
  .pie { margin-top:16px; padding-top:16px; break-inside: avoid; page-break-inside: avoid; }
  .sin-datos { text-align:center; color:#666; margin-top:20px; }

  /* Tabla envoltura de cada "página": el encabezado va en <thead> para que
     se repita arriba en cada hoja impresa si el contenido crece a más de
     una hoja, y el detalle + pie van en <tbody> para que fluyan y se corten
     de forma natural entre hojas, en vez de quedar forzados a llenar un
     100vh completo (eso era lo que mandaba el pie a su propia hoja casi en
     blanco). El pie no se repite en cada hoja a propósito: es un bloque de
     cierre/firma, no un pie de página que deba salir varias veces. */
  .tabla-paginado { width:100%; border-collapse:collapse; }
  .tabla-paginado > thead { display: table-header-group; }
  .tabla-paginado > tbody { display: table-row-group; }
  .tabla-paginado > thead > tr > td,
  .tabla-paginado > tbody > tr > td { border:none; padding:0; }

  .pagina-rh { max-width: 190mm; margin: 0 auto; font-size:11px; }
  .pagina-rh .segmento-empleado { break-inside: avoid; margin-bottom:10px; }
  .pagina-rh .tabla-encabezado-empleado td { border:1px solid #1a1a1a; font-weight:bold; font-size:11px; padding:3px 6px; background:#eef1f4; }
  .pagina-rh .celda-nombre-empleado { width:65%; }
  .pagina-rh .celda-puesto-empleado { width:35%; }
  .pagina-rh .tabla-horas th, .pagina-rh .tabla-horas td { border:1px solid #1a1a1a; padding:3px 6px; font-size:10.5px; }
  .pagina-rh .tabla-horas th { background:#f7f8fa; font-weight:bold; text-align:center; }
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
  /* "VACACIONES" no se corta a media palabra: se deja en una sola línea y se
     le da a la columna del día que la necesite el ancho que le falte,
     quitándoselo a la columna Puesto (ver .col-puesto abajo) — así solo se
     ensanchan los días que de verdad tuvieron vacación, no todos. */
  .pagina-nomina .celda-vacacion { font-weight:bold; color:#1a6b3c; white-space:nowrap; }
  .pagina-nomina .col-puesto { max-width:62px; word-break:break-word; }
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