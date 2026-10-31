// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/public/js/panelGeneral.js
// ##########################################################################
import { db } from "./firebase-config.js";
import {
  collection, query, where, getDocs, getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { irA } from "./navegacion.js";
import { iniciarPanelResumenAdmin, iniciarPanelResumenSupervisor } from "./panel.js";
import { estadoDe } from "./comercial.js";

// ============================================================================
// Panel general (2026-10-31, pedido de Ivan). Reemplaza al Panel de solo RH.
//   - Arriba, "Pendientes de hoy": chips con lo que requiere acción (solo si
//     hay algo). Al tocarlos abren su pantalla.
//   - Abajo, una tarjeta por área a la que el usuario tiene acceso (mismo
//     criterio que Utilidades: admin todo; los demás, lo que su área tiene en
//     Configuración → Acceso a Utilidades; Rentabilidad solo ilanda).
//   - Cada número abre su pantalla (irA de navegacion.js); en Comercial ya
//     filtrada por estado.
//   - Los números se calculan al abrir el Panel y con "Actualizar" (no se
//     quedan escuchando): conteos de Firestore cuando son muchos documentos,
//     y lectura de los pocos pendientes cuando hay que filtrarlos como en
//     alertasRH.js. Si una tarjeta falla (permiso, índice), dice "sin dato"
//     y las demás siguen.
//   - Las gráficas del Panel de RH de antes siguen en "Ver gráficas de RH"
//     (panel.js, sin cambios).
// ============================================================================

const CORREO_RENTABILIDAD = "ilanda@alanis.com.mx";
const DIA = 864e5;
const TIPOS_RUTA = { corta: "Ruta corta", larga: "Ruta larga", local: "Locales", circuito: "Circuito" };
const COLOR_RUTA = { corta: "#3B7A1E", larga: "#185FA5", local: "#B7790B", circuito: "#7a4a9e" };

function esc(t) { const d = document.createElement("div"); d.textContent = t == null ? "" : String(t); return d.innerHTML; }
const miles = (n) => Number(n || 0).toLocaleString("es-MX");
const dinero = (n) => n == null ? "—" : "$" + Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const contar = async (q) => (await getCountFromServer(q)).data().count;
const docs = async (q) => (await getDocs(q)).docs.map(d => ({ _id: d.id, ...d.data() }));
function inicioDia() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
function inicioMes() { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime(); }
function mesActual() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
// Semana laboral Alanis (viernes a jueves), igual que panel.js.
function semanaLaboralActual() {
  const hoy = new Date();
  const diffDias = (hoy.getDay() - 5 + 7) % 7;
  const viernes = new Date(hoy);
  viernes.setDate(viernes.getDate() - diffDias);
  return viernes.toISOString().slice(0, 10);
}
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function inyectarEstilos() {
  if (document.getElementById("pg-estilos")) return;
  const s = document.createElement("style");
  s.id = "pg-estilos";
  s.textContent = `
    .pg-cab { display:flex; justify-content:space-between; align-items:flex-end; gap:10px; flex-wrap:wrap; margin-bottom:14px; }
    .pg-cab h2 { margin:0; font-size:20px; color:#2c1e0f; } .pg-cab small { color:#8a7f73; }
    .pg-act { font-size:12px; color:#8a7f73; } .pg-act button { background:none; border:0; padding:0; font:inherit; color:#185FA5; text-decoration:underline; cursor:pointer; }
    .pg-hoy { background:#fff; border:1px solid #e2ddd5; border-radius:16px; padding:14px 16px; margin-bottom:16px; }
    .pg-hoy h3 { margin:0 0 10px; font-size:14px; color:#2c1e0f; }
    .pg-chips { display:flex; gap:8px; flex-wrap:wrap; }
    .pg-chip { display:inline-flex; align-items:center; gap:8px; border:1px solid #e2ddd5; border-radius:999px; padding:7px 12px; font:inherit; font-size:13px; color:#1f1a14; background:#fbfaf8; cursor:pointer; }
    .pg-chip:hover { border-color:#2c1e0f; }
    .pg-chip b { min-width:22px; height:22px; padding:0 6px; border-radius:11px; background:#B83227; color:#fff; font-size:12px; display:inline-flex; align-items:center; justify-content:center; }
    .pg-chip.aviso b { background:#B7790B; } .pg-chip.info b { background:#185FA5; }
    .pg-areas { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:14px; }
    .pg-area { background:#fff; border:1px solid #e2ddd5; border-radius:16px; padding:14px 16px; min-width:0; }
    .pg-area-cab { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
    .pg-area-cab b { font-size:15px; color:#2c1e0f; }
    .pg-ir { margin-left:auto; background:none; border:0; padding:0; font:inherit; font-size:12.5px; color:#185FA5; text-decoration:underline; cursor:pointer; }
    .pg-solo { font-size:10px; font-weight:800; background:#ECE9E4; color:#5c5045; border-radius:8px; padding:2px 7px; }
    .pg-kpis { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
    .pg-kpi { border:1px solid #eee8e0; border-radius:12px; padding:10px; text-align:left; background:#fff; font:inherit; color:inherit; cursor:pointer; min-width:0; }
    .pg-kpi:hover { background:#faf7f3; border-color:#cfc6ba; }
    .pg-kpi .n { display:block; font-size:22px; font-weight:800; line-height:1.1; color:#1f1a14; }
    .pg-kpi .t { display:block; font-size:11.5px; color:#6b5f52; margin-top:3px; line-height:1.3; }
    .pg-kpi.alerta { border-color:#f0cfc9; background:#fdf6f5; } .pg-kpi.alerta .n { color:#B83227; }
    .pg-kpi.aviso { border-color:#f1e0b8; background:#fffbf2; } .pg-kpi.aviso .n { color:#B7790B; }
    .pg-kpi.bien .n { color:#3B7A1E; }
    .pg-linea { font-size:12px; color:#6b5f52; margin-top:8px; border-top:1px solid #f0ece6; padding-top:8px; line-height:1.5; }
    .pg-barra { display:flex; height:8px; border-radius:4px; overflow:hidden; margin-top:10px; background:#eee; }
    .pg-ley { display:flex; gap:12px; flex-wrap:wrap; font-size:11.5px; color:#6b5f52; margin-top:5px; }
    .pg-ley i { display:inline-block; width:8px; height:8px; border-radius:2px; margin-right:4px; }
    .pg-cargando { color:#a09383; font-size:13px; padding:8px 0; }
    .pg-graficas { margin-top:16px; } .pg-graficas summary { cursor:pointer; color:#185FA5; font-size:13px; }
    @media (max-width:420px) { .pg-kpis { grid-template-columns:repeat(2,1fr); } }
  `;
  document.head.appendChild(s);
}

// ctx: { rol, uid, datosUsuario, correo, permitidas (array de ids o null = todas) }
export function iniciarPanelGeneral(contenedor, ctx) {
  inyectarEstilos();
  const { rol, uid } = ctx;
  const correo = String(ctx.correo || "").toLowerCase();
  const esAdmin = rol === "admin";
  const ve = (op) => esAdmin || !Array.isArray(ctx.permitidas) || ctx.permitidas.includes(op);
  const nombre = String((ctx.datosUsuario && ctx.datosUsuario.nombre) || "").split(/\s+/)[0];
  const hoy = new Date();
  const saludo = hoy.getHours() < 12 ? "Buen día" : hoy.getHours() < 19 ? "Buenas tardes" : "Buenas noches";

  // Áreas que se muestran (en este orden).
  const AREAS = [
    { id: "rh", titulo: "RH", si: (esAdmin || rol === "supervisor") && ve("rh"), cargar: cargarRH },
    { id: "validacionQR", titulo: "Validación de QR", si: ve("validacionQR"), cargar: cargarQR },
    { id: "operadores", titulo: "Operadores", si: ve("operadores"), cargar: cargarOperadores },
    { id: "trafico", titulo: "Tráfico", si: ve("trafico"), cargar: cargarTrafico },
    { id: "inventario", titulo: "Inventario", si: ve("inventario"), cargar: cargarInventario },
    { id: "mantenimiento", titulo: "Mantenimiento", si: ve("mantenimiento"), cargar: cargarMantenimiento },
    { id: "comercial", titulo: "Comercial", si: ve("comercial"), cargar: cargarComercial },
    { id: "rentabilidad", titulo: "Rentabilidad", solo: true, si: esAdmin && correo === CORREO_RENTABILIDAD, cargar: cargarRentabilidad },
  ].filter(a => a.si);

  contenedor.innerHTML = `
    <div class="pg-cab"><div><h2>${saludo}${nombre ? ", " + esc(nombre) : ""}</h2>
      <small>${DIAS[hoy.getDay()].replace(/^./, c => c.toUpperCase())} ${hoy.getDate()} de ${MESES[hoy.getMonth()]} de ${hoy.getFullYear()}</small></div>
      <div class="pg-act"><span id="pg-hora"></span> · <button type="button" id="pg-actualizar">Actualizar</button></div></div>
    <div class="pg-hoy" id="pg-hoy"><h3>Pendientes de hoy</h3><div class="pg-chips" id="pg-chips"><span class="pg-cargando">Revisando…</span></div></div>
    <div class="pg-areas">${AREAS.map(a => `
      <div class="pg-area" data-area="${a.id}">
        <div class="pg-area-cab"><b>${esc(a.titulo)}</b>${a.solo ? `<span class="pg-solo">SOLO TÚ</span>` : ""}<button type="button" class="pg-ir" data-ir="${a.id}">Ir ›</button></div>
        <div class="pg-cuerpo"><div class="pg-cargando">Cargando…</div></div>
      </div>`).join("") || `<p class="nota">Todavía no tienes áreas asignadas. Pide al administrador que habilite las de tu área.</p>`}</div>
    ${(esAdmin || rol === "supervisor") && ve("rh") ? `<details class="pg-graficas"><summary>Ver gráficas de RH (como el Panel de antes)</summary><div id="pg-graficas" style="margin-top:12px;"></div></details>` : ""}`;

  const $ = (s) => contenedor.querySelector(s);
  contenedor.querySelectorAll("[data-ir]").forEach(b => b.addEventListener("click", () => irA({ opcion: b.dataset.ir })));
  const det = contenedor.querySelector(".pg-graficas");
  if (det) det.addEventListener("toggle", () => {
    const caja = $("#pg-graficas");
    if (!det.open || caja.dataset.listo) return;
    caja.dataset.listo = "1";
    if (esAdmin) iniciarPanelResumenAdmin(caja); else iniciarPanelResumenSupervisor(caja, uid);
  });

  // ---- Pintado ----
  let pendientes = {}; // área -> [{ n, texto, destino, nivel }]
  function pintarPendientes(terminado) {
    const lista = Object.values(pendientes).flat().filter(p => p.n > 0);
    const caja = $("#pg-chips");
    if (!lista.length) {
      caja.innerHTML = terminado ? `<span class="pg-cargando" style="color:#3B7A1E;">✓ Nada pendiente por ahora.</span>` : `<span class="pg-cargando">Revisando…</span>`;
      return;
    }
    caja.innerHTML = lista.map((p, i) => `<button type="button" class="pg-chip ${p.nivel || ""}" data-p="${i}"><b>${miles(p.n)}</b>${esc(p.texto)}</button>`).join("");
    caja.querySelectorAll("[data-p]").forEach(b => b.addEventListener("click", () => irA(lista[Number(b.dataset.p)].destino)));
  }
  // kpis: [{ n, t, destino, clase }]; extra: html bajo los números.
  function pintarArea(id, kpis, extra = "") {
    const cuerpo = contenedor.querySelector(`[data-area="${id}"] .pg-cuerpo`);
    if (!cuerpo) return;
    cuerpo.innerHTML = `<div class="pg-kpis">${kpis.map((k, i) => `<button type="button" class="pg-kpi ${k.clase || ""}" data-k="${i}"><span class="n">${k.n == null ? "—" : esc(k.n)}</span><span class="t">${esc(k.t)}</span></button>`).join("")}</div>${extra}`;
    cuerpo.querySelectorAll("[data-k]").forEach(b => b.addEventListener("click", () => irA(kpis[Number(b.dataset.k)].destino || { opcion: id })));
  }
  function sinDato(id, error) {
    console.warn(`Panel (${id}):`, error && error.message);
    const cuerpo = contenedor.querySelector(`[data-area="${id}"] .pg-cuerpo`);
    if (cuerpo) cuerpo.innerHTML = `<div class="pg-cargando">Sin dato por ahora. <button type="button" class="pg-ir" style="margin:0;" data-reintento="1">Reintentar</button></div>`;
    const r = cuerpo && cuerpo.querySelector("[data-reintento]");
    if (r) r.addEventListener("click", () => cargarUna(AREAS.find(a => a.id === id)));
  }
  const clase = (n, nivel = "alerta") => (n > 0 ? nivel : "");

  async function cargarUna(a) {
    try { await a.cargar(); } catch (e) { sinDato(a.id, e); }
  }
  async function cargarTodo() {
    pendientes = {};
    pintarPendientes(false);
    const d = new Date();
    $("#pg-hora").textContent = `Actualizado ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    await Promise.all(AREAS.map(cargarUna));
    pintarPendientes(true);
  }
  $("#pg-actualizar").addEventListener("click", cargarTodo);

  // ============================================================================
  // RH (mismos criterios que alertasRH.js)
  // ============================================================================
  async function cargarRH() {
    const sol = collection(db, "solicitudes"), vac = collection(db, "solicitudesVacaciones"), fal = collection(db, "faltas");
    const semana = semanaLaboralActual();
    const rh = (item) => ({ opcion: "rh", item });
    if (esAdmin) {
      const [usuarios, sPend, sAjus, vPend, vRec, vAjus, fPend, sSemana] = await Promise.all([
        docs(collection(db, "usuarios")),
        docs(query(sol, where("estatus", "==", "pendiente"))),
        docs(query(sol, where("ajusteSolicitud.estatus", "==", "pendiente"))),
        docs(query(vac, where("estatus", "==", "pendiente"))),
        docs(query(vac, where("recorteSolicitud.estatus", "==", "pendiente"))),
        docs(query(vac, where("ajusteSolicitud.estatus", "==", "pendiente"))),
        contar(query(fal, where("estatus", "==", "pendiente"))),
        docs(query(sol, where("semanaLaboral", "==", semana))),
      ]);
      const activos = usuarios.filter(u => u.rol === "empleado" && u.estatus === "activo");
      const registros = usuarios.filter(u => u.estatus === "pendiente").length;
      const sinSup = activos.filter(u => !u.supervisorId).length;
      const horas = sPend.length + sAjus.filter(s => s.estatus !== "pendiente").length;
      const vacas = vPend.length + vRec.filter(s => s.estatus === "aprobada").length + vAjus.filter(s => s.estatus === "aprobada").length;
      const horasSemana = sSemana.filter(s => s.estatus === "aprobada").reduce((t, s) => t + (Number(s.horas) || 0), 0);
      pintarArea("rh", [
        { n: miles(activos.length), t: "Empleados activos", clase: "bien", destino: rh("catalogo") },
        { n: registros, t: "Registros pendientes", clase: clase(registros), destino: rh("catalogo") },
        { n: horas, t: "Horas extra pendientes", clase: clase(horas), destino: rh("solicitudes") },
        { n: vacas, t: "Vacaciones pendientes", clase: clase(vacas, "aviso"), destino: rh("vacaciones") },
        { n: fPend, t: "Faltas por confirmar", clase: clase(fPend, "aviso"), destino: rh("faltas") },
        { n: sinSup, t: "Activos sin supervisor", clase: clase(sinSup, "aviso"), destino: rh("catalogo") },
      ], `<div class="pg-linea">Horas extra aprobadas esta semana laboral: <b>${miles(horasSemana)} h</b></div>`);
      pendientes.rh = [
        { n: registros, texto: "Registros por aprobar", destino: rh("catalogo") },
        { n: horas, texto: "Horas extra por autorizar", destino: rh("solicitudes") },
        { n: vacas, texto: "Vacaciones por autorizar", destino: rh("vacaciones"), nivel: "aviso" },
        { n: fPend, texto: "Faltas por confirmar", destino: rh("faltas"), nivel: "aviso" },
      ];
    } else {
      const [equipo, sPend, vPend, fPend, sSemana] = await Promise.all([
        docs(query(collection(db, "usuarios"), where("supervisorId", "==", uid))),
        contar(query(sol, where("supervisorId", "==", uid), where("estatus", "==", "pendiente"))),
        contar(query(vac, where("supervisorId", "==", uid), where("estatus", "==", "pendiente"))),
        contar(query(fal, where("supervisorId", "==", uid), where("estatus", "==", "pendiente"))),
        docs(query(sol, where("supervisorId", "==", uid), where("semanaLaboral", "==", semana))),
      ]);
      const horasSemana = sSemana.filter(s => s.estatus === "aprobada").reduce((t, s) => t + (Number(s.horas) || 0), 0);
      pintarArea("rh", [
        { n: equipo.filter(u => u.estatus === "activo").length, t: "Mi equipo", clase: "bien", destino: rh("equipo") },
        { n: sPend, t: "Horas extra pendientes", clase: clase(sPend), destino: rh("solicitudes") },
        { n: vPend, t: "Vacaciones pendientes", clase: clase(vPend, "aviso"), destino: rh("vacaciones") },
      ], `<div class="pg-linea">Faltas de mi equipo por confirmar: <b>${fPend}</b> · Horas extra aprobadas esta semana: <b>${miles(horasSemana)} h</b></div>`);
      pendientes.rh = [
        { n: sPend, texto: "Horas extra por autorizar", destino: rh("solicitudes") },
        { n: vPend, texto: "Vacaciones por autorizar", destino: rh("vacaciones"), nivel: "aviso" },
      ];
    }
    pintarPendientes(false);
  }

  // ============================================================================
  // Validación de QR
  // ============================================================================
  async function cargarQR() {
    const [enlaces, origen] = await Promise.all([
      contar(query(collection(db, "solicitudes_enlace_checkpoint"), where("estado", "==", "solicitada"))),
      contar(collection(db, "embarques_pendientes_origen")),
    ]);
    const qr = { opcion: "validacionQR" };
    pintarArea("validacionQR", [
      { n: enlaces, t: "Enlaces de checkpoint por autorizar", clase: clase(enlaces), destino: qr },
      { n: origen, t: "Embarques pendientes en origen", clase: clase(origen, "aviso"), destino: qr },
    ]);
    pendientes.validacionQR = [{ n: enlaces, texto: "Enlaces de checkpoint por autorizar", destino: qr }];
    pintarPendientes(false);
  }

  // ============================================================================
  // Operadores (espejos de Alanis Operadores)
  // ============================================================================
  async function cargarOperadores() {
    const [ops, porAceptar, otAbiertas] = await Promise.all([
      docs(collection(db, "espejo_op_operadores")),
      contar(collection(db, "espejo_op_solicitudes")),
      contar(query(collection(db, "espejo_op_ordenes"), where("estado", "==", "abierta"))),
    ]);
    const activos = ops.filter(o => o.activo);
    const porRuta = {};
    activos.forEach(o => { const k = o.tipoRuta || "sin"; porRuta[k] = (porRuta[k] || 0) + 1; });
    const total = activos.length || 1;
    const op = (item) => ({ opcion: "operadores", item });
    const tramos = Object.keys(TIPOS_RUTA).filter(k => porRuta[k]);
    pintarArea("operadores", [
      { n: miles(activos.length), t: "Registrados activos", clase: "bien", destino: op("operadoresRegistrados") },
      { n: porAceptar, t: "Por aceptar", clase: clase(porAceptar, "aviso"), destino: op("operadoresSolicitudes") },
      { n: otAbiertas, t: "OT abiertas", destino: op("operadoresOrdenes") },
    ], `<div class="pg-barra">${tramos.map(k => `<span style="width:${(porRuta[k] / total) * 100}%;background:${COLOR_RUTA[k]};"></span>`).join("")}</div>
        <div class="pg-ley">${tramos.map(k => `<span><i style="background:${COLOR_RUTA[k]}"></i>${TIPOS_RUTA[k]} ${porRuta[k]}</span>`).join("")}${porRuta.sin ? `<span>Sin tipo ${porRuta.sin}</span>` : ""}</div>
        <div class="pg-linea">Inactivos: ${ops.length - activos.length}</div>`);
    pendientes.operadores = [{ n: porAceptar, texto: "Operadores por aceptar", destino: op("operadoresSolicitudes"), nivel: "aviso" }];
    pintarPendientes(false);
  }

  // ============================================================================
  // Tráfico: patio (estatus), asignaciones de hoy y reportes de viaje de hoy
  // ============================================================================
  async function cargarTrafico() {
    const desde = inicioDia();
    const [estatus, asign] = await Promise.all([
      docs(collection(db, "espejo_op_estatus")),
      docs(query(collection(db, "espejo_op_asignaciones"), where("timestampMs", ">=", desde))),
    ]);
    let eventos = null;
    try { eventos = await docs(query(collection(db, "espejo_op_eventos_viaje"), where("ms", ">=", desde))); } catch (e) { eventos = null; }
    const disponibles = estatus.filter(e => e.id === "disponible" || e.id === "liberado_taller").length;
    const taller = estatus.filter(e => e.id === "taller").length;
    const sinResp = asign.filter(a => a.estado === "pendiente").length;
    const aceptadas = asign.filter(a => a.estado === "aceptada").length;
    const tiene = (ev, id) => (ev.ids || []).includes(id);
    const inc = eventos ? eventos.filter(e => tiene(e, "incidencia_viaje")).length : null;
    const arr = eventos ? eventos.filter(e => tiene(e, "arribo_destino")).length : null;
    const fin = eventos ? eventos.filter(e => tiene(e, "fin_descarga")).length : null;
    const tr = (item, filtro) => ({ opcion: "trafico", item, filtro });
    pintarArea("trafico", [
      { n: disponibles, t: "Disponibles en patio", clase: "bien", destino: tr("operadoresTurnos") },
      { n: sinResp, t: "Asignaciones sin respuesta hoy", clase: clase(sinResp, "aviso"), destino: tr("traficoAsignacion") },
      { n: aceptadas, t: "Asignaciones aceptadas hoy", destino: tr("traficoAsignacion") },
      { n: inc, t: "Incidencias en viaje hoy", clase: clase(inc), destino: tr("traficoActualizaciones", { tipo: "incidencia_viaje" }) },
      { n: arr, t: "Arribos a destino hoy", destino: tr("traficoActualizaciones", { tipo: "arribo_destino" }) },
      { n: fin, t: "Fin de descarga hoy", destino: tr("traficoActualizaciones", { tipo: "fin_descarga" }) },
    ], `<div class="pg-linea">En taller: ${taller}</div>`);
    pendientes.trafico = [
      { n: sinResp, texto: "Asignaciones sin respuesta", destino: tr("traficoAsignacion"), nivel: "info" },
      { n: inc || 0, texto: "Incidencias en viaje hoy", destino: tr("traficoActualizaciones", { tipo: "incidencia_viaje" }) },
    ];
    pintarPendientes(false);
  }

  // ============================================================================
  // Inventario (mismo criterio de "activa" que inventario.js)
  // ============================================================================
  async function cargarInventario() {
    const [bloques, est] = await Promise.all([docs(collection(db, "inventario_catalogo")), docs(collection(db, "inventario_estatus"))]);
    const estatus = new Map(est.map(e => [e._id, e]));
    const unidades = bloques.flatMap(b => b.unidades || []);
    const estatusDe = (u) => {
      const e = estatus.get(u.id);
      if (!e || !["activa", "baja", "vendida"].includes(e.estatus) || (e.serie && u.serie && e.serie !== u.serie)) return "activa";
      return e.estatus;
    };
    const activos = (tipo) => unidades.filter(u => u.tipo === tipo && estatusDe(u) === "activa").length;
    const fuera = unidades.filter(u => estatusDe(u) !== "activa").length;
    const inv = { opcion: "inventario" };
    pintarArea("inventario", [
      { n: miles(activos("TRACTOCAMION")), t: "Tractos activos", clase: "bien", destino: inv },
      { n: miles(activos("REMOLQUE")), t: "Remolques activos", clase: "bien", destino: inv },
      { n: miles(fuera), t: "Bajas / vendidas", destino: inv },
    ], `<div class="pg-linea">Unidades de refrigeración activas: ${miles(activos("UNIDAD DE REFRIGERACION"))}</div>`);
  }

  // ============================================================================
  // Mantenimiento (solicitudes de remolques)
  // ============================================================================
  async function cargarMantenimiento() {
    const col = collection(db, "mantenimiento_solicitudes");
    const [abiertas, cerradasMes] = await Promise.all([
      docs(query(col, where("estado", "==", "abierta"))),
      contar(query(col, where("terminadaMs", ">=", inicioMes()))),
    ]);
    const masVieja = abiertas.reduce((m, s) => Math.min(m, s.ms || Infinity), Infinity);
    const dias = isFinite(masVieja) ? Math.floor((Date.now() - masVieja) / DIA) : null;
    const viejas = abiertas.filter(s => s.ms && Date.now() - s.ms > 3 * DIA).length;
    const mt = { opcion: "mantenimiento" };
    pintarArea("mantenimiento", [
      { n: abiertas.length, t: "OT abiertas", clase: clase(abiertas.length, "aviso"), destino: mt },
      { n: cerradasMes, t: "Terminadas este mes", clase: "bien", destino: mt },
      { n: dias == null ? "—" : `${dias} d`, t: "La más antigua abierta", clase: dias != null && dias > 3 ? "alerta" : "", destino: mt },
    ]);
    pendientes.mantenimiento = [{ n: viejas, texto: `OT abierta${viejas === 1 ? "" : "s"} con más de 3 días`, destino: mt }];
    pintarPendientes(false);
  }

  // ============================================================================
  // Comercial (cada quien sus cotizaciones; el admin, todas)
  // ============================================================================
  async function cargarComercial() {
    const col = collection(db, "com_cotizaciones");
    const cots = await docs(esAdmin ? col : query(col, where("creadoPorUid", "==", uid)));
    const ahora = Date.now(), mes = inicioMes();
    const est = (c) => estadoDe(c, ahora);
    const vigentes = cots.filter(c => ["borrador", "enviada", "aceptada"].includes(est(c)) && (!c.vencimientoMs || c.vencimientoMs >= ahora)).length;
    const porVencer = cots.filter(c => ["borrador", "enviada"].includes(est(c)) && c.vencimientoMs && c.vencimientoMs - ahora <= 7 * DIA).length;
    const vencidas = cots.filter(c => est(c) === "vencida" && c.vencimientoMs >= ahora - 30 * DIA).length;
    const enviadas = cots.filter(c => est(c) === "enviada").length;
    const aceptadasMes = cots.filter(c => c.estado === "aceptada" && (c.actualizadoMs || c.emisionMs || 0) >= mes).length;
    const borradores = cots.filter(c => est(c) === "borrador").length;
    const recientes = cots.filter(c => (c.emisionMs || 0) >= ahora - 90 * DIA);
    const resueltas = recientes.filter(c => ["aceptada", "rechazada", "vencida"].includes(est(c)));
    const tasa = resueltas.length ? Math.round(100 * resueltas.filter(c => c.estado === "aceptada").length / resueltas.length) : null;
    const co = (estado) => ({ opcion: "comercial", filtro: { tab: "cotizaciones", estado: estado || "" } });
    pintarArea("comercial", [
      { n: vigentes, t: "Vigentes", clase: "bien", destino: co("") },
      { n: porVencer, t: "Vencen en 7 días", clase: clase(porVencer, "aviso"), destino: co("") },
      { n: vencidas, t: "Vencidas (30 días)", destino: co("vencida") },
      { n: enviadas, t: "Enviadas sin respuesta", destino: co("enviada") },
      { n: aceptadasMes, t: "Aceptadas este mes", clase: "bien", destino: co("aceptada") },
      { n: borradores, t: "Borradores", destino: co("borrador") },
    ], tasa != null ? `<div class="pg-linea">Aceptación en los últimos 90 días: <b>${tasa} %</b> (${resueltas.length} resuelta${resueltas.length === 1 ? "" : "s"})</div>` : "");
    pendientes.comercial = [{ n: porVencer, texto: `Cotizaci${porVencer === 1 ? "ón vence" : "ones vencen"} esta semana`, destino: co(""), nivel: "aviso" }];
    pintarPendientes(false);
  }

  // ============================================================================
  // Rentabilidad (solo Ivan)
  // ============================================================================
  async function cargarRentabilidad() {
    const [facturas, salidas] = await Promise.all([
      docs(query(collection(db, "rentabilidad_facturas"), where("mes", "==", mesActual()))),
      contar(query(collection(db, "rentabilidad_salidas"), where("fechaMs", ">=", inicioMes()))),
    ]);
    const km = facturas.reduce((t, f) => t + ((f.calculos || {}).km || 0), 0);
    const flete = facturas.reduce((t, f) => t + ((f.calculos || {}).fleteMxn || 0), 0);
    const re = { opcion: "rentabilidad" };
    pintarArea("rentabilidad", [
      { n: facturas.length, t: "Facturas del mes", destino: re },
      { n: miles(salidas), t: "Salidas del mes", destino: re },
      { n: km ? dinero(flete / km) : "—", t: "Flete/km promedio (MXN)", destino: re },
    ]);
  }

  cargarTodo();
}