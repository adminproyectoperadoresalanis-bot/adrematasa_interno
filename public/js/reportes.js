import { db } from "./firebase-config.js";
import {
  collection, onSnapshot, query, where
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import {
  formatearFechaCorta, formatearHora12, sumarDias, calcularSemanaLaboral,
  numeroSemanaISO, formatearFechaDDMMYY, formatearFechaLargaCap,
  formatearFechaHoraGeneracion, escapeHtml as escapeHtmlCompartido,
  construirPaginaRH, construirPaginaNomina, construirHtmlReporteCompleto
} from "./reportesHtml.js";

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
        <td>${escapeHtmlCompartido(e.nombre)}</td>
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

  // Un solo PDF con 2 páginas: REPORTE RH (detalle por empleado) y
  // REPORTE NOMINA (cuadrícula semanal). Solo cuenta lo ya aprobado (documento
  // formal, no depende del checkbox de "incluir pendientes y rechazados").
  // El armado real de las 2 páginas vive en js/reportesHtml.js — lo mismo
  // que usa automatizacion/generar-y-enviar-reporte.mjs para el correo
  // automático de los jueves, así que ambos lados siempre producen el
  // mismo formato exacto.
  function abrirVistaPreviaImprimir() {
    if (!selectSemana.value) {
      alert("Elige la semana en la sección Reportes de arriba.");
      return;
    }

    const viernes = selectSemana.value;
    const jueves = sumarDias(viernes, 6);
    const numeroSemana = numeroSemanaISO(jueves);
    const logoSrc = window.location.origin + "/img/logo-alanis.png";

    const paginaRH = construirPaginaRH({ listaHoras, mapUsuarios, viernes, jueves, numeroSemana, logoSrc });
    const paginaNomina = construirPaginaNomina({ listaHoras, listaVacaciones, listaFaltas, mapUsuarios, viernes, jueves, numeroSemana, logoSrc });
    const html = construirHtmlReporteCompleto({ paginaRH, paginaNomina, numeroSemana });

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