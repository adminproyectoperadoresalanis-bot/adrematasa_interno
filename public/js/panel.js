import { db } from "./firebase-config.js";
import {
  collection, onSnapshot, query, where
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// Misma lógica de semana laboral Alanis (viernes a jueves) que en solicitudes.js,
// pero calculada a partir de HOY en vez de una fecha de solicitud.
function semanaLaboralActual() {
  const hoy = new Date();
  const dow = hoy.getDay(); // 0=domingo ... 5=viernes ... 6=sabado
  const diffDias = (dow - 5 + 7) % 7;
  const viernes = new Date(hoy);
  viernes.setDate(viernes.getDate() - diffDias);
  return viernes.toISOString().slice(0, 10);
}

function contarPorEstatus(docs) {
  return {
    pendiente: docs.filter(d => d.estatus === "pendiente").length,
    aprobada: docs.filter(d => d.estatus === "aprobada").length,
    rechazada: docs.filter(d => d.estatus === "rechazada").length
  };
}

function renderBarras(contenedor, idDestino, conteos, etiquetaAprobada = "Aprobada") {
  const destino = contenedor.querySelector("#" + idDestino);
  const max = Math.max(conteos.pendiente, conteos.aprobada, conteos.rechazada, 1);
  const filas = [
    { etiqueta: "Pendiente", valor: conteos.pendiente, clase: "barra-pendiente" },
    { etiqueta: etiquetaAprobada, valor: conteos.aprobada, clase: "barra-aprobada" },
    { etiqueta: "Rechazada", valor: conteos.rechazada, clase: "barra-rechazada" }
  ];
  destino.innerHTML = filas.map(f => `
    <div class="barra-fila">
      <span class="barra-etiqueta">${f.etiqueta}</span>
      <div class="barra-track"><div class="barra-relleno ${f.clase}" style="width:${(f.valor / max) * 100}%"></div></div>
      <span class="barra-valor">${f.valor}</span>
    </div>
  `).join("");
}

function plantilla({ etiquetaTileUno, incluirRegistrosPendientes, incluirAlertaSupervisor }) {
  return `
    <section class="panel">
      <h2>Panel</h2>
      <div class="tiles-grid">
        <div class="tile">
          <span class="tile-valor" id="tile-uno">—</span>
          <span class="tile-etiqueta">${etiquetaTileUno}</span>
        </div>
        ${incluirRegistrosPendientes ? `
        <div class="tile">
          <span class="tile-valor" id="tile-registros-pendientes">—</span>
          <span class="tile-etiqueta">Registros pendientes</span>
        </div>` : ""}
        <div class="tile">
          <span class="tile-valor" id="tile-horas-pendientes">—</span>
          <span class="tile-etiqueta">Horas extra pendientes</span>
        </div>
        <div class="tile">
          <span class="tile-valor" id="tile-vacaciones-pendientes">—</span>
          <span class="tile-etiqueta">Vacaciones pendientes</span>
        </div>
        <div class="tile">
          <span class="tile-valor" id="tile-faltas-pendientes">—</span>
          <span class="tile-etiqueta">Faltas pendientes de confirmar</span>
        </div>
      </div>
    </section>

    <section class="panel" style="margin-top:20px;">
      <div class="tile tile-hero">
        <span class="tile-valor" id="tile-horas-semana">—</span>
        <span class="tile-etiqueta">Horas extra aprobadas esta semana laboral</span>
      </div>
    </section>

    ${incluirAlertaSupervisor ? `
    <section class="panel" style="margin-top:20px;">
      <div class="tile tile-alerta" id="tile-sin-supervisor-wrap">
        <span class="tile-valor" id="tile-sin-supervisor">—</span>
        <span class="tile-etiqueta">Empleados activos sin supervisor asignado</span>
      </div>
    </section>` : ""}

    <section class="panel" style="margin-top:20px;">
      <h2>Solicitudes por estatus</h2>
      <div class="mini-chart">
        <h3>Horas extra</h3>
        <div id="barras-horas"></div>
      </div>
      <div class="mini-chart" style="margin-top:20px;">
        <h3>Vacaciones</h3>
        <div id="barras-vacaciones"></div>
      </div>
      <div class="mini-chart" style="margin-top:20px;">
        <h3>Faltas</h3>
        <div id="barras-faltas"></div>
      </div>
    </section>
  `;
}

export function iniciarPanelResumenAdmin(contenedor) {
  contenedor.innerHTML = plantilla({
    etiquetaTileUno: "Empleados activos",
    incluirRegistrosPendientes: true,
    incluirAlertaSupervisor: true
  });

  const tileEmpleados = contenedor.querySelector("#tile-uno");
  const tileRegistrosPendientes = contenedor.querySelector("#tile-registros-pendientes");
  const tileSinSupervisor = contenedor.querySelector("#tile-sin-supervisor");
  const wrapSinSupervisor = contenedor.querySelector("#tile-sin-supervisor-wrap");
  const tileHorasPendientes = contenedor.querySelector("#tile-horas-pendientes");
  const tileVacacionesPendientes = contenedor.querySelector("#tile-vacaciones-pendientes");
  const tileFaltasPendientes = contenedor.querySelector("#tile-faltas-pendientes");
  const tileHorasSemana = contenedor.querySelector("#tile-horas-semana");

  const semana = semanaLaboralActual();

  onSnapshot(collection(db, "usuarios"), (snap) => {
    const docs = snap.docs.map(d => d.data());
    const empleadosActivos = docs.filter(u => u.rol === "empleado" && u.estatus === "activo").length;
    const registrosPendientes = docs.filter(u => u.estatus === "pendiente").length;
    const sinSupervisor = docs.filter(u => u.rol === "empleado" && u.estatus === "activo" && !u.supervisorId).length;

    tileEmpleados.textContent = empleadosActivos;
    tileRegistrosPendientes.textContent = registrosPendientes;
    tileSinSupervisor.textContent = sinSupervisor;
    wrapSinSupervisor.classList.toggle("alerta-activa", sinSupervisor > 0);
    wrapSinSupervisor.classList.toggle("alerta-ok", sinSupervisor === 0);
  });

  onSnapshot(collection(db, "solicitudes"), (snap) => {
    const docs = snap.docs.map(d => d.data());
    const conteos = contarPorEstatus(docs);
    tileHorasPendientes.textContent = conteos.pendiente;
    renderBarras(contenedor, "barras-horas", conteos);

    const horasSemana = docs
      .filter(s => s.estatus === "aprobada" && s.semanaLaboral === semana)
      .reduce((suma, s) => suma + (Number(s.horas) || 0), 0);
    tileHorasSemana.textContent = horasSemana;
  });

  onSnapshot(collection(db, "solicitudesVacaciones"), (snap) => {
    const docs = snap.docs.map(d => d.data());
    const conteos = contarPorEstatus(docs);
    tileVacacionesPendientes.textContent = conteos.pendiente;
    renderBarras(contenedor, "barras-vacaciones", conteos);
  });

  onSnapshot(collection(db, "faltas"), (snap) => {
    const docs = snap.docs.map(d => d.data());
    const conteos = contarPorEstatus(docs);
    tileFaltasPendientes.textContent = conteos.pendiente;
    renderBarras(contenedor, "barras-faltas", conteos, "Confirmada");
  });
}

export function iniciarPanelResumenSupervisor(contenedor, uid) {
  contenedor.innerHTML = plantilla({
    etiquetaTileUno: "Mi equipo",
    incluirRegistrosPendientes: false,
    incluirAlertaSupervisor: false
  });

  const tileEquipo = contenedor.querySelector("#tile-uno");
  const tileHorasPendientes = contenedor.querySelector("#tile-horas-pendientes");
  const tileVacacionesPendientes = contenedor.querySelector("#tile-vacaciones-pendientes");
  const tileFaltasPendientes = contenedor.querySelector("#tile-faltas-pendientes");
  const tileHorasSemana = contenedor.querySelector("#tile-horas-semana");

  const semana = semanaLaboralActual();

  onSnapshot(query(collection(db, "usuarios"), where("supervisorId", "==", uid)), (snap) => {
    const docs = snap.docs.map(d => d.data());
    const equipoActivo = docs.filter(u => u.estatus === "activo").length;
    tileEquipo.textContent = equipoActivo;
  });

  onSnapshot(query(collection(db, "solicitudes"), where("supervisorId", "==", uid)), (snap) => {
    const docs = snap.docs.map(d => d.data());
    const conteos = contarPorEstatus(docs);
    tileHorasPendientes.textContent = conteos.pendiente;
    renderBarras(contenedor, "barras-horas", conteos);

    const horasSemana = docs
      .filter(s => s.estatus === "aprobada" && s.semanaLaboral === semana)
      .reduce((suma, s) => suma + (Number(s.horas) || 0), 0);
    tileHorasSemana.textContent = horasSemana;
  });

  onSnapshot(query(collection(db, "solicitudesVacaciones"), where("supervisorId", "==", uid)), (snap) => {
    const docs = snap.docs.map(d => d.data());
    const conteos = contarPorEstatus(docs);
    tileVacacionesPendientes.textContent = conteos.pendiente;
    renderBarras(contenedor, "barras-vacaciones", conteos);
  });

  onSnapshot(query(collection(db, "faltas"), where("supervisorId", "==", uid)), (snap) => {
    const docs = snap.docs.map(d => d.data());
    const conteos = contarPorEstatus(docs);
    tileFaltasPendientes.textContent = conteos.pendiente;
    renderBarras(contenedor, "barras-faltas", conteos, "Confirmada");
  });
}