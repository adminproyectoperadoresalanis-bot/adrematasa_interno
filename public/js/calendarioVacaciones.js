import { db } from "./firebase-config.js";
import {
  collection, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// Calendario mensual de vacaciones (solo admin) — de un vistazo, quién está
// de vacaciones (pendiente o aprobada) en cada fecha, si hay días festivos
// oficiales de por medio, y si dos personas del mismo puesto se empalman
// (funciones que no pueden quedarse sin cubrir al mismo tiempo).

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
];

function pad2(n) { return String(n).padStart(2, "0"); }
function fechaStr(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

function diffDias(fechaBaseISO, fechaISO) {
  const [a1, a2, a3] = fechaBaseISO.split("-").map(Number);
  const [b1, b2, b3] = fechaISO.split("-").map(Number);
  const base = new Date(a1, a2 - 1, a3);
  const otra = new Date(b1, b2 - 1, b3);
  return Math.round((otra - base) / 86400000);
}

// N-ésimo día de la semana de un mes (ej. "primer lunes de febrero"): mes
// 1-12, diaSemana 0=domingo...6=sábado, n=1,2,3...
function nEsimoDiaSemana(anio, mes, diaSemana, n) {
  const primerDia = new Date(anio, mes - 1, 1);
  const offset = (diaSemana - primerDia.getDay() + 7) % 7;
  const dia = 1 + offset + (n - 1) * 7;
  return new Date(anio, mes - 1, dia);
}

// Días de descanso obligatorio, Art. 74 LFT (México). No se incluyen los
// que dependen de un evento variable (año de elección, ni la transmisión
// del Poder Ejecutivo Federal, que ya no cae en diciembre desde 2024).
function festivosOficiales(anio) {
  return [
    { fecha: `${anio}-01-01`, nombre: "Año Nuevo" },
    { fecha: fechaStr(nEsimoDiaSemana(anio, 2, 1, 1)), nombre: "Día de la Constitución" },
    { fecha: fechaStr(nEsimoDiaSemana(anio, 3, 1, 3)), nombre: "Natalicio de Benito Juárez" },
    { fecha: `${anio}-05-01`, nombre: "Día del Trabajo" },
    { fecha: `${anio}-09-16`, nombre: "Día de la Independencia" },
    { fecha: fechaStr(nEsimoDiaSemana(anio, 11, 1, 3)), nombre: "Día de la Revolución" },
    { fecha: `${anio}-12-25`, nombre: "Navidad" }
  ];
}

export function iniciarCalendarioVacaciones(contenedor) {
  contenedor.innerHTML = `
    <section class="panel">
      <div class="cal-toolbar">
        <div class="cal-toolbar-nav">
          <button type="button" class="secundario" id="cal-hoy">Hoy</button>
          <button type="button" class="secundario" id="cal-anterior">‹</button>
          <button type="button" class="secundario" id="cal-siguiente">›</button>
          <h2 id="cal-titulo"></h2>
        </div>
        <div class="cal-leyenda">
          <span class="cal-leyenda-item"><span class="cal-muestra cal-muestra-aprobada"></span>Aprobada</span>
          <span class="cal-leyenda-item"><span class="cal-muestra cal-muestra-pendiente"></span>Pendiente</span>
          <span class="cal-leyenda-item"><span class="cal-muestra cal-muestra-conflicto"></span>Mismo puesto empalmado</span>
          <span class="cal-leyenda-item"><span class="cal-muestra cal-muestra-festivo"></span>Día festivo oficial</span>
        </div>
      </div>
      <div id="cal-error" class="error"></div>
      <div id="cal-grid"></div>
    </section>
  `;

  const tituloEl = contenedor.querySelector("#cal-titulo");
  const gridEl = contenedor.querySelector("#cal-grid");
  const errorDiv = contenedor.querySelector("#cal-error");

  const hoy = new Date();
  let anioActual = hoy.getFullYear();
  let mesActual = hoy.getMonth() + 1; // 1-12

  let usuariosPorId = {};
  let solicitudes = [];

  onSnapshot(collection(db, "usuarios"), (snap) => {
    usuariosPorId = {};
    snap.docs.forEach(d => { usuariosPorId[d.id] = d.data(); });
    render();
  }, (err) => {
    errorDiv.textContent = "No se pudieron cargar los empleados: " + err.message;
  });

  onSnapshot(collection(db, "solicitudesVacaciones"), (snap) => {
    solicitudes = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(s => (s.estatus === "pendiente" || s.estatus === "aprobada") && s.fechaInicio && s.fechaFin);
    render();
  }, (err) => {
    errorDiv.textContent = "No se pudieron cargar las vacaciones: " + err.message;
  });

  contenedor.querySelector("#cal-hoy").addEventListener("click", () => {
    anioActual = hoy.getFullYear();
    mesActual = hoy.getMonth() + 1;
    render();
  });
  contenedor.querySelector("#cal-anterior").addEventListener("click", () => {
    mesActual -= 1;
    if (mesActual < 1) { mesActual = 12; anioActual -= 1; }
    render();
  });
  contenedor.querySelector("#cal-siguiente").addEventListener("click", () => {
    mesActual += 1;
    if (mesActual > 12) { mesActual = 1; anioActual += 1; }
    render();
  });

  function render() {
    tituloEl.textContent = `${MESES[mesActual - 1]} ${anioActual}`;

    // Cuadrícula: del domingo en o antes del día 1, al sábado en o después
    // del último día del mes (para que las semanas queden completas).
    const primerDiaMes = new Date(anioActual, mesActual - 1, 1);
    const ultimoDiaMes = new Date(anioActual, mesActual, 0);
    const inicioGrid = new Date(primerDiaMes);
    inicioGrid.setDate(inicioGrid.getDate() - primerDiaMes.getDay());
    const finGrid = new Date(ultimoDiaMes);
    finGrid.setDate(finGrid.getDate() + (6 - ultimoDiaMes.getDay()));

    const inicioGridStr = fechaStr(inicioGrid);
    const finGridStr = fechaStr(finGrid);

    // Festivos del año visible y los vecinos, por si la cuadrícula asoma a
    // diciembre/enero de otro año.
    const festivos = {};
    [anioActual - 1, anioActual, anioActual + 1].forEach(a => {
      festivosOficiales(a).forEach(f => { festivos[f.fecha] = f.nombre; });
    });

    const visibles = solicitudes.filter(s => s.fechaInicio <= finGridStr && s.fechaFin >= inicioGridStr);

    // Conflictos: mismo puesto y fechas que se cruzan entre sí, sin
    // limitarse al mes visible (para no perder avisos de solicitudes que
    // arrancan o terminan fuera del mes que se está viendo ahora).
    const idsConflicto = new Set();
    for (let i = 0; i < solicitudes.length; i++) {
      for (let j = i + 1; j < solicitudes.length; j++) {
        const a = solicitudes[i], b = solicitudes[j];
        if (a.empleadoId === b.empleadoId) continue;
        const puestoA = (usuariosPorId[a.empleadoId] || {}).puesto;
        const puestoB = (usuariosPorId[b.empleadoId] || {}).puesto;
        if (!puestoA || !puestoB || puestoA !== puestoB) continue;
        if (a.fechaInicio <= b.fechaFin && b.fechaInicio <= a.fechaFin) {
          idsConflicto.add(a.id);
          idsConflicto.add(b.id);
        }
      }
    }

    const semanas = [];
    let cursor = new Date(inicioGrid);
    while (cursor <= finGrid) {
      const semana = [];
      for (let i = 0; i < 7; i++) {
        semana.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
      semanas.push(semana);
    }

    gridEl.innerHTML = `
      <div class="cal-encabezados">
        ${DIAS_SEMANA.map(d => `<div class="cal-encabezado-dia">${d}</div>`).join("")}
      </div>
      ${semanas.map(semana => renderSemana(semana, visibles, festivos, idsConflicto, primerDiaMes)).join("")}
    `;
  }

  function renderSemana(semana, visibles, festivos, idsConflicto, primerDiaMes) {
    const inicioSemanaStr = fechaStr(semana[0]);
    const finSemanaStr = fechaStr(semana[6]);

    const barras = visibles
      .filter(s => s.fechaInicio <= finSemanaStr && s.fechaFin >= inicioSemanaStr)
      .map(s => ({
        ...s,
        colInicio: Math.max(0, diffDias(inicioSemanaStr, s.fechaInicio)),
        colFin: Math.min(6, diffDias(inicioSemanaStr, s.fechaFin)),
        truncadoInicio: s.fechaInicio < inicioSemanaStr,
        truncadoFin: s.fechaFin > finSemanaStr
      }))
      .sort((a, b) => a.colInicio - b.colInicio || (b.colFin - b.colInicio) - (a.colFin - a.colInicio));

    // Carriles por semana (como en Outlook/Google Calendar): cada barra
    // toma el primer carril libre donde no se traslape en columnas con lo
    // que ya se colocó ahí.
    const carriles = [];
    barras.forEach(b => {
      let lane = 0;
      while (carriles[lane] !== undefined && carriles[lane] >= b.colInicio) lane++;
      carriles[lane] = b.colFin;
      b.carril = lane;
    });
    const numCarriles = carriles.length;
    const filasEstilo = numCarriles > 0 ? `auto repeat(${numCarriles}, 22px)` : "auto";

    const diasHtml = semana.map((fecha, i) => {
      const fStr = fechaStr(fecha);
      const esMesActual = fecha.getMonth() === primerDiaMes.getMonth() && fecha.getFullYear() === primerDiaMes.getFullYear();
      const festivoNombre = festivos[fStr];
      return `
        <div class="cal-dia ${esMesActual ? "" : "cal-dia-fuera-mes"}" style="grid-column:${i + 1};">
          <div class="cal-dia-numero">${fecha.getDate()}</div>
          ${festivoNombre ? `<div class="cal-festivo" title="${escapeHtml(festivoNombre)}">${escapeHtml(festivoNombre)}</div>` : ""}
        </div>
      `;
    }).join("");

    const barrasHtml = barras.map(b => {
      const enConflicto = idsConflicto.has(b.id);
      const clase = `cal-barra ${b.estatus === "aprobada" ? "cal-barra-aprobada" : "cal-barra-pendiente"} ${enConflicto ? "cal-barra-conflicto" : ""}`;
      const flechaIni = b.truncadoInicio ? "← " : "";
      const flechaFin = b.truncadoFin ? " →" : "";
      const etiqueta = `${enConflicto ? "⚠ " : ""}${flechaIni}Vacaciones ${escapeHtml(b.empleadoNombre || "")}${flechaFin}`;
      const titulo = `${b.empleadoNombre || ""} — ${b.fechaInicio} al ${b.fechaFin} (${b.diasHabiles} día(s)) — ${b.estatus}${enConflicto ? " — mismo puesto que otra solicitud empalmada" : ""}`;
      return `<div class="${clase}" style="grid-column:${b.colInicio + 1} / ${b.colFin + 2}; grid-row:${b.carril + 2};" title="${escapeHtml(titulo)}">${etiqueta}</div>`;
    }).join("");

    return `
      <div class="cal-semana" style="grid-template-rows:${filasEstilo};">
        ${diasHtml}
        ${barrasHtml}
      </div>
    `;
  }
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto || "";
  return div.innerHTML;
}