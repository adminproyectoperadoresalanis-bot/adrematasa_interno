// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/public/js/mantenimientoReporte.js
// ##########################################################################
// Mantenimiento › pestaña "📊 Reporte" (2026-11-19, pedido de Ivan).
// Resumen por rango de fechas (fecha en que se CREÓ la OT) que se pinta en
// pantalla y se descarga en PDF (jsPDF + autoTable) y Excel (SheetJS).
// Lo ve todo el que tiene acceso a Mantenimiento.
//
// Qué trae:
//   - Totales: solicitudes, terminadas, abiertas (la más vieja), atención
//     promedio, remolques distintos.
//   - Horario de atención: el técnico cubre de 8:00 am a 3:00 pm de lunes a
//     sábado por sueldo; fuera de eso (antes de 8, desde las 3 pm, domingo o
//     festivo del catálogo) cobra por servicio. Se mide con la hora de
//     creación de la OT. Ajustable en HORARIO_SUELDO.
//   - Por tipo de falla, por ubicación, remolques con más solicitudes.
//   - Comentario de cierre: "Qué se hizo" por palabras clave (CATEGORIAS_CIERRE),
//     cruce falla → qué se hizo, reincidencias (mismo remolque y misma falla
//     dentro de 30 días después de cerrada) y calidad del comentario.
//   - Detalle con todas las columnas.

import { db } from "./firebase-config.js";
import {
  collection, doc, getDoc, getDocs, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { LOGO_ALANIS } from "./comercialLogo.js";

const COL = "mantenimiento_solicitudes";
const BODEGA = "Bodega Laredo TX";
const URL_JSPDF = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
const URL_AUTOTABLE = "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js";
const URL_XLSX = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";

// Horario por sueldo del técnico. Fuera de esto = por servicio.
const HORARIO_SUELDO = { inicio: 8, fin: 15, dias: [1, 2, 3, 4, 5, 6] }; // 0=dom … 6=sáb
const TXT_SUELDO = "Sueldo (8:00 am – 3:00 pm, lun a sáb)";
const TXT_SERVICIO = "Por servicio (fuera de horario)";
const DIAS_REINCIDENCIA = 30;

// "Qué se hizo": un comentario puede caer en varias. Se compara sin acentos y en minúsculas.
const CATEGORIAS_CIERRE = [
  { id: "cambio", nombre: "Cambio / reemplazo de pieza", claves: ["cambi", "reemplaz", "sustitu", "nuevo", "nueva", "instal", "coloc"] },
  { id: "llantas", nombre: "Llantas", claves: ["llanta", "rin ", "rines", "vulcaniz", "ponch", "birlo", "neumat"] },
  { id: "reparacion", nombre: "Reparación / soldadura", claves: ["repar", "sold", "parch", "arregl", "compus", "sell"] },
  { id: "ajuste", nombre: "Ajuste / calibración / reset", claves: ["ajust", "calibr", "apret", "reset", "reinici", "reprogram", "purg", "tens"] },
  { id: "taller", nombre: "Taller o proveedor externo", claves: ["taller", "proveedor", "agencia", "carrier", "thermo king", "thermoking", "externo", "se llevo a"] },
  { id: "sinfalla", nombre: "Revisión sin falla", claves: ["sin falla", "no se encontr", "no presenta", "funciona bien", "funcionando correctamente", "todo bien", "sin problema", "no tenia"] },
];
const SIN_CLASIFICAR = "Sin clasificar";
const GENERICOS = ["listo", "ok", "okay", "hecho", "terminado", "terminada", "se arreglo", "arreglado", "ya quedo", "quedo", "reparado", "atendido", "realizado", "se reparo", "se atendio"];

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const esc = (t) => { const d = document.createElement("div"); d.textContent = t == null ? "" : String(t); return d.innerHTML; };
const pad = (n) => String(n).padStart(2, "0");
const norm = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ddmmyyyy = (iso) => { const [y, m, d] = String(iso || "").split("-"); return y ? `${d}/${m}/${y}` : ""; };
const msInicio = (iso) => new Date(iso + "T00:00:00").getTime();
const sumarDiasIso = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return isoLocal(d); };

function duracion(ms) {
  if (!isFinite(ms) || ms < 0) return "";
  const h = ms / 3600000;
  return h < 24 ? `${Math.max(1, Math.round(h))} h` : `${(h / 24).toFixed(1)} d`;
}

function cargarScript(url, global) {
  if (window[global]) return Promise.resolve(window[global]);
  return new Promise((ok, mal) => {
    const s = document.createElement("script");
    s.src = url; s.onload = () => ok(window[global]); s.onerror = () => mal(new Error("No se pudo cargar " + url));
    document.head.appendChild(s);
  });
}

// Fecha y hora de creación (las que guarda la función, hora de Nuevo Laredo).
function fechaHoraDe(s) {
  if (s.fecha && s.hora) return { fecha: s.fecha, hora: s.hora };
  const d = new Date(s.ms);
  return { fecha: isoLocal(d), hora: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

// Turno: sueldo o por servicio (con el motivo).
function turnoDe(s, festivos) {
  const { fecha, hora } = fechaHoraDe(s);
  const [h, m] = hora.split(":").map(Number);
  const dow = new Date(fecha + "T00:00:00").getDay();
  const decimal = h + (m || 0) / 60;
  if (festivos.has(fecha)) return { sueldo: false, motivo: "Festivo", hora: h };
  if (!HORARIO_SUELDO.dias.includes(dow)) return { sueldo: false, motivo: DIAS[dow], hora: h };
  if (decimal < HORARIO_SUELDO.inicio) return { sueldo: false, motivo: "Antes de 8:00 am", hora: h };
  if (decimal >= HORARIO_SUELDO.fin) return { sueldo: false, motivo: "Desde las 3:00 pm", hora: h };
  return { sueldo: true, motivo: "", hora: h };
}

function categoriasCierre(comentario) {
  const t = " " + norm(comentario) + " ";
  const cats = CATEGORIAS_CIERRE.filter(c => c.claves.some(k => t.includes(k))).map(c => c.nombre);
  return cats.length ? cats : [SIN_CLASIFICAR];
}
function sinDetalle(comentario) {
  const t = norm(comentario).replace(/[.!,;]+$/g, "");
  return t.length < 12 || GENERICOS.includes(t);
}

const contar = (arr) => { const m = new Map(); arr.forEach(x => m.set(x, (m.get(x) || 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "es")); };
const remolqueTxt = (r) => [r && r.id, r && r.marca, r && r.modelo].filter(Boolean).join(" ");
const ubicacionTxt = (s) => (s.ubicacion && s.ubicacion.tipo === "bodega") ? BODEGA : ((s.ubicacion && s.ubicacion.nombre) || "Otro");

// =============================================================================
// Análisis (sin DOM)
// =============================================================================
function analizar(lista, previas, festivos) {
  const ahora = Date.now();
  const terminadas = lista.filter(s => s.estado === "terminada");
  const abiertas = lista.filter(s => s.estado !== "terminada");
  const atencion = (s) => (s.terminadaMs && s.ms) ? s.terminadaMs - s.ms : NaN;
  const promedio = (arr) => { const v = arr.map(atencion).filter(isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
  const masVieja = abiertas.length ? Math.max(...abiertas.map(s => ahora - (s.ms || ahora))) : 0;

  // Horario
  const conTurno = lista.map(s => ({ s, t: turnoDe(s, festivos) }));
  const grupoTurno = (sueldo) => {
    const g = conTurno.filter(x => x.t.sueldo === sueldo).map(x => x.s);
    const term = g.filter(s => s.estado === "terminada");
    const mismoDia = term.filter(s => s.terminadaMs && isoLocal(new Date(s.terminadaMs)) === fechaHoraDe(s).fecha).length;
    const fallaTop = contar(g.flatMap(s => s.fallas || []))[0];
    return { total: g.length, terminadas: term.length, mismoDia, promedio: promedio(term), fallaTop: fallaTop ? `${fallaTop[0]} (${fallaTop[1]})` : "—" };
  };
  const sueldo = grupoTurno(true), servicio = grupoTurno(false);
  const motivosServicio = contar(conTurno.filter(x => !x.t.sueldo).map(x => x.t.motivo));
  const porHora = Array.from({ length: 24 }, (_, h) => ({ h, sueldo: 0, servicio: 0 }));
  conTurno.forEach(x => { const b = porHora[x.t.hora] || porHora[0]; x.t.sueldo ? b.sueldo++ : b.servicio++; });
  const porDia = DIAS.map((nombre, i) => ({ nombre, i, sueldo: 0, servicio: 0 }));
  conTurno.forEach(x => { const d = new Date(fechaHoraDe(x.s).fecha + "T00:00:00").getDay(); x.t.sueldo ? porDia[d].sueldo++ : porDia[d].servicio++; });
  const porDiaOrden = [...porDia.slice(1), porDia[0]]; // lunes a domingo

  // Fallas, ubicación, remolques
  const fallas = contar(lista.flatMap(s => (s.fallas && s.fallas.length) ? s.fallas : ["Sin categoría"]));
  const ubicaciones = contar(lista.map(ubicacionTxt));
  const porRem = new Map();
  lista.forEach(s => {
    const id = (s.remolque && s.remolque.id) || "—";
    if (!porRem.has(id)) porRem.set(id, { id, txt: remolqueTxt(s.remolque), n: 0, fallas: [] });
    const r = porRem.get(id); r.n++; r.fallas.push(...(s.fallas || []));
  });
  const remolques = [...porRem.values()].sort((a, b) => b.n - a.n || a.id.localeCompare(b.id, "es", { numeric: true }));

  // Comentario de cierre
  const cierres = terminadas.map(s => ({ s, cats: categoriasCierre(s.comentarioCierre), vago: sinDetalle(s.comentarioCierre) }));
  const queSeHizo = contar(cierres.flatMap(c => c.cats));
  const cruce = contar(terminadas.flatMap(s => s.fallas || [])).slice(0, 8).map(([falla, n]) => {
    const hechos = contar(cierres.filter(c => (c.s.fallas || []).includes(falla)).flatMap(c => c.cats));
    return { falla, n, hechos: hechos.slice(0, 3).map(([c, k]) => `${c} (${k})`).join(" · ") };
  });
  const sinDet = cierres.filter(c => c.vago).map(c => c.s);

  // Reincidencias: S (en rango) con una P anterior del mismo remolque y misma falla, cerrada ≤30 días antes.
  const todas = [...previas, ...lista];
  const reincidencias = [];
  lista.forEach(s => {
    const id = s.remolque && s.remolque.id;
    if (!id) return;
    const previa = todas
      .filter(p => p !== s && p.remolque && p.remolque.id === id && p.estado === "terminada" && p.terminadaMs && p.terminadaMs <= s.ms
        && s.ms - p.terminadaMs <= DIAS_REINCIDENCIA * 864e5 && (p.fallas || []).some(f => (s.fallas || []).includes(f)))
      .sort((a, b) => b.terminadaMs - a.terminadaMs)[0];
    if (previa) reincidencias.push({ s, p: previa, falla: (previa.fallas || []).filter(f => (s.fallas || []).includes(f)).join(", "), dias: Math.round((s.ms - previa.terminadaMs) / 864e5) });
  });

  return {
    total: lista.length, terminadas: terminadas.length, abiertas: abiertas.length, masVieja,
    promedio: promedio(terminadas), remolquesDistintos: porRem.size,
    sueldo, servicio, motivosServicio, porHora, porDia: porDiaOrden,
    fallas, ubicaciones, remolques, queSeHizo, cruce, sinDet, reincidencias,
    reincidentesIds: new Set(reincidencias.map(r => r.s.id)),
    cierres: new Map(cierres.map(c => [c.s.id, c])),
    turnos: new Map(conTurno.map(x => [x.s.id, x.t])),
  };
}

// Renglón de detalle (pantalla, PDF y Excel).
function filaDetalle(s, a) {
  const { fecha, hora } = fechaHoraDe(s);
  const t = a.turnos.get(s.id) || {};
  const c = a.cierres.get(s.id);
  const r = s.remolque || {};
  return {
    folio: s.folio || s.id, fecha: ddmmyyyy(fecha), hora, remolque: r.id || "", marca: r.marca || "", modelo: r.modelo || "",
    placas: r.placas || "", ubicacion: ubicacionTxt(s), fallas: (s.fallas || []).join(", "), descripcion: s.descripcion || "",
    solicito: (s.solicitadoPor && s.solicitadoPor.nombre) || "", area: (s.solicitadoPor && s.solicitadoPor.area) || "",
    turno: t.sueldo ? "Sueldo" : `Por servicio · ${t.motivo || ""}`,
    estado: s.estado === "terminada" ? "Terminada" : "Abierta",
    terminada: s.terminadaMs ? (() => { const d = new Date(s.terminadaMs); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; })() : "",
    horasAtencion: s.terminadaMs && s.ms ? Math.round((s.terminadaMs - s.ms) / 360000) / 10 : "",
    atencion: s.terminadaMs && s.ms ? duracion(s.terminadaMs - s.ms) : (s.ms ? `${duracion(Date.now() - s.ms)} (abierta)` : ""),
    cerro: (s.terminadaPor && s.terminadaPor.nombre) || "",
    comentario: s.comentarioCierre || "",
    queSeHizo: c ? (c.vago ? "Sin detalle" : c.cats.join(", ")) : "",
    reincidencia: a.reincidentesIds.has(s.id) ? "Sí" : "",
  };
}

// =============================================================================
// Pantalla
// =============================================================================
const ESTILOS = `
.mr-filtros { display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end; }
.mr-filtros label { font-size:12px; color:#6b5f52; display:flex; flex-direction:column; gap:3px; margin:0; }
.mr-filtros input, .mr-filtros select { min-width:140px; }
.mr-atajos { display:flex; gap:6px; flex-wrap:wrap; margin-top:10px; }
.mr-at { border:1px solid #e2ddd5; border-radius:14px; padding:4px 11px; font-size:12px; background:#fff; color:#2c1e0f; cursor:pointer; }
.mr-at.on { background:#2c1e0f; color:#fff; border-color:#2c1e0f; }
.mr-kpis { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:10px; margin-top:12px; }
.mr-kpi { background:#fff; border:1px solid #e2ddd5; border-radius:12px; padding:12px; }
.mr-kpi .n { font-size:24px; font-weight:800; } .mr-kpi .t { font-size:12px; color:#6b5f52; }
.mr-caja { background:#fff; border:1px solid #e2ddd5; border-radius:12px; padding:14px; margin-top:12px; }
.mr-caja h3 { font-size:15px; margin:0 0 8px; }
.mr-dos { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
.mr-bar { display:grid; grid-template-columns:minmax(110px,190px) 1fr 34px; gap:8px; align-items:center; font-size:12.5px; margin:5px 0; }
.mr-bar .b { height:12px; border-radius:6px; background:#8a6a4a; } .mr-bar .b.th { background:#185FA5; } .mr-bar .b.ok { background:#3B7A1E; } .mr-bar .b.gr { background:#b9b1a6; }
.mr-bar .v { text-align:right; font-weight:700; }
.mr-split { display:flex; height:16px; border-radius:8px; overflow:hidden; margin:6px 0 10px; background:#eee; }
.mr-turno { border-radius:12px; padding:12px; border:1px solid; }
.mr-turno.su { background:#EEF4FB; border-color:#bcd3ea; } .mr-turno.se { background:#FDF1E6; border-color:#efc9a4; }
.mr-turno .t { font-size:12px; font-weight:700; text-transform:uppercase; } .mr-turno.su .t { color:#185FA5; } .mr-turno.se .t { color:#C2610C; }
.mr-turno .n { font-size:28px; font-weight:800; } .mr-turno .n small { font-size:13px; color:#6b5f52; font-weight:600; }
.mr-turno ul { margin:6px 0 0; padding-left:18px; font-size:13px; }
.mr-hist { display:flex; align-items:flex-end; gap:2px; height:130px; border-bottom:1px solid #ccc; margin-top:8px; }
.mr-hist div { flex:1; display:flex; flex-direction:column; justify-content:flex-end; align-items:center; font-size:9.5px; font-weight:700; }
.mr-hist i { display:block; width:100%; }
.mr-ejes { display:flex; gap:2px; font-size:9px; color:#6b5f52; } .mr-ejes span { flex:1; text-align:center; }
.mr-ley { display:flex; gap:14px; font-size:12px; margin-top:6px; flex-wrap:wrap; } .mr-ley i { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:4px; vertical-align:middle; }
.mr-tabla { width:100%; border-collapse:collapse; font-size:12.5px; }
.mr-tabla th, .mr-tabla td { padding:6px 8px; border-bottom:1px solid #efebe5; text-align:left; vertical-align:top; }
.mr-tabla th { font-size:11px; color:#6b5f52; text-transform:uppercase; }
.mr-chip { display:inline-block; border-radius:10px; padding:1px 7px; font-size:10.5px; font-weight:700; margin:1px 2px 1px 0; white-space:nowrap; }
.mr-ab { background:#FBE3A8; color:#7a3e06; } .mr-te { background:#EAF3DE; color:#3B7A1E; } .mr-su { background:#DCEAF7; color:#185FA5; } .mr-se { background:#FDF1E6; color:#C2610C; } .mr-rj { background:#FDECEA; color:#8a2318; }
.mr-aviso { border-radius:10px; padding:9px 12px; font-size:13px; margin-top:8px; }
.mr-desc { display:flex; gap:8px; flex-wrap:wrap; }
@media (max-width:760px) { .mr-kpis { grid-template-columns:repeat(2,minmax(0,1fr)); } .mr-dos { grid-template-columns:1fr; } }
`;
function inyectarEstilos() {
  if (document.getElementById("estilos-mantenimiento-reporte")) return;
  const s = document.createElement("style"); s.id = "estilos-mantenimiento-reporte"; s.textContent = ESTILOS; document.head.appendChild(s);
}

function atajos() {
  const hoy = new Date(); const h = isoLocal(hoy);
  const lunes = new Date(hoy); lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
  const iniMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const iniMesAnt = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1), finMesAnt = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
  return [
    { id: "semana", t: "Esta semana", d: isoLocal(lunes), h },
    { id: "mes", t: "Este mes", d: isoLocal(iniMes), h },
    { id: "mesant", t: "Mes anterior", d: isoLocal(iniMesAnt), h: isoLocal(finMesAnt) },
    { id: "30", t: "Últimos 30 días", d: sumarDiasIso(h, -29), h },
    { id: "anio", t: "Este año", d: `${hoy.getFullYear()}-01-01`, h },
  ];
}

export function iniciarReporteMantenimiento(cuerpo) {
  inyectarEstilos();
  const at = atajos();
  let desde = at[1].d, hasta = at[1].h, atajo = "mes";
  let estado = "todas", remolque = "";
  let datos = [], previas = [], festivos = new Set(), cargando = false;
  let token = 0;

  cuerpo.innerHTML = `
    <div class="mr-filtros">
      <label>Desde<input type="date" id="mr-desde" value="${desde}"></label>
      <label>Hasta<input type="date" id="mr-hasta" value="${hasta}"></label>
      <label>Estado<select id="mr-estado"><option value="todas">Todas</option><option value="abiertas">Abiertas</option><option value="terminadas">Terminadas</option></select></label>
      <label>Remolque<select id="mr-rem"><option value="">Todos</option></select></label>
    </div>
    <div class="mr-atajos">${at.map(a => `<button type="button" class="mr-at${a.id === atajo ? " on" : ""}" data-a="${a.id}">${a.t}</button>`).join("")}</div>
    <p class="nota" style="margin:8px 0 0;">Cuenta las solicitudes creadas en el rango. Se actualiza al cambiar cualquier filtro.</p>
    <div class="error" id="mr-err"></div>
    <div id="mr-res"><p class="nota">Cargando…</p></div>`;
  const $ = (s) => cuerpo.querySelector(s);

  getDoc(doc(db, "configuracion", "diasFestivos")).then(s => {
    festivos = new Set(((s.exists() && s.data().festivos) || []).map(f => f && f.fecha).filter(Boolean));
    pintar();
  }).catch(() => {});

  async function cargar() {
    const mio = ++token;
    cargando = true; pintar();
    try {
      const ini = msInicio(sumarDiasIso(desde, -(DIAS_REINCIDENCIA + 1)));
      const fin = msInicio(sumarDiasIso(hasta, 1));
      const snap = await getDocs(query(collection(db, COL), where("ms", ">=", ini), where("ms", "<", fin), orderBy("ms", "desc")));
      if (mio !== token) return;
      const todas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const corte = msInicio(desde);
      datos = todas.filter(s => s.ms >= corte);
      previas = todas.filter(s => s.ms < corte);
      $("#mr-err").textContent = "";
    } catch (e) {
      if (mio !== token) return;
      datos = []; previas = [];
      $("#mr-err").textContent = "No se pudieron leer las solicitudes: " + e.message;
    }
    cargando = false;
    pintarRemolques();
    pintar();
  }

  function pintarRemolques() {
    const ids = [...new Set(datos.map(s => s.remolque && s.remolque.id).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
    if (remolque && !ids.includes(remolque)) remolque = "";
    $("#mr-rem").innerHTML = `<option value="">Todos</option>` + ids.map(i => `<option value="${esc(i)}"${i === remolque ? " selected" : ""}>${esc(i)}</option>`).join("");
  }

  const filtrados = () => datos.filter(s =>
    (estado === "todas" || (estado === "abiertas" ? s.estado !== "terminada" : s.estado === "terminada")) &&
    (!remolque || (s.remolque && s.remolque.id === remolque)));

  function barras(lista, clase, max) {
    const tope = max || Math.max(1, ...lista.map(x => x[1]));
    return lista.map(([k, v]) => `<div class="mr-bar"><span>${esc(k)}</span><span class="b ${typeof clase === "function" ? clase(k) : clase || ""}" style="width:${Math.max(3, v / tope * 100)}%"></span><span class="v">${v}</span></div>`).join("") || `<p class="nota">Sin datos.</p>`;
  }

  function pintar() {
    const res = $("#mr-res");
    if (cargando) { res.innerHTML = `<p class="nota">Cargando…</p>`; return; }
    const lista = filtrados();
    if (!lista.length) { res.innerHTML = `<p class="nota" style="margin-top:12px;">No hay solicitudes en este rango.</p>`; return; }
    const a = analizar(lista, previas, festivos);
    const pct = (n) => a.total ? Math.round(n / a.total * 100) : 0;
    const maxHora = Math.max(1, ...a.porHora.map(h => h.sueldo + h.servicio));
    const filas = lista.map(s => ({ s, f: filaDetalle(s, a) }));
    res.innerHTML = `
      <div class="mr-kpis">
        <div class="mr-kpi"><div class="n">${a.total}</div><div class="t">Solicitudes</div></div>
        <div class="mr-kpi"><div class="n">${a.terminadas}</div><div class="t">Terminadas</div></div>
        <div class="mr-kpi"><div class="n" style="color:#7a3e06">${a.abiertas}</div><div class="t">Abiertas${a.abiertas ? ` · la más vieja ${duracion(a.masVieja)}` : ""}</div></div>
        <div class="mr-kpi"><div class="n">${isFinite(a.promedio) ? duracion(a.promedio) : "—"}</div><div class="t">Atención promedio</div></div>
        <div class="mr-kpi"><div class="n">${a.remolquesDistintos}</div><div class="t">Remolques distintos</div></div>
      </div>

      <div class="mr-caja">
        <h3>⏰ Horario de atención (hora en que se creó la OT)</h3>
        <div class="mr-split"><div style="width:${pct(a.sueldo.total)}%;background:#185FA5"></div><div style="width:${pct(a.servicio.total)}%;background:#C2610C"></div></div>
        <div class="mr-dos">
          ${[["su", TXT_SUELDO, a.sueldo], ["se", TXT_SERVICIO, a.servicio]].map(([k, t, g]) => `
          <div class="mr-turno ${k}"><div class="t">${t}</div><div class="n">${g.total} <small>${pct(g.total)}%</small></div>
            <ul><li>Atención promedio: <b>${isFinite(g.promedio) ? duracion(g.promedio) : "—"}</b></li>
              <li>Terminadas el mismo día: <b>${g.mismoDia} de ${g.terminadas}</b></li>
              <li>Falla más común: ${esc(g.fallaTop)}</li>
              ${k === "se" && a.motivosServicio.length ? `<li>${a.motivosServicio.map(([m, n]) => `${esc(m)}: <b>${n}</b>`).join(" · ")}</li>` : ""}</ul></div>`).join("")}
        </div>
        <div class="mr-hist">${a.porHora.map(h => `<div>${h.sueldo + h.servicio || ""}<i style="height:${h.servicio / maxHora * 105}px;background:#C2610C"></i><i style="height:${h.sueldo / maxHora * 105}px;background:#185FA5"></i></div>`).join("")}</div>
        <div class="mr-ejes">${a.porHora.map(h => `<span>${h.h % 3 === 0 ? (h.h === 0 ? "12a" : h.h < 12 ? h.h + "a" : h.h === 12 ? "12p" : (h.h - 12) + "p") : ""}</span>`).join("")}</div>
        <div class="mr-ley"><span><i style="background:#185FA5"></i>Sueldo</span><span><i style="background:#C2610C"></i>Por servicio</span></div>
        <div style="overflow-x:auto;margin-top:10px;"><table class="mr-tabla"><tr><th>Día</th><th>Sueldo</th><th>Por servicio</th><th>Total</th></tr>
          ${a.porDia.map(d => `<tr><td>${d.nombre}</td><td>${d.sueldo}</td><td>${d.servicio}</td><td>${d.sueldo + d.servicio}</td></tr>`).join("")}</table></div>
      </div>

      <div class="mr-dos">
        <div class="mr-caja"><h3>Por tipo de falla</h3>${barras(a.fallas, (k) => /^thermo/i.test(k) ? "th" : "")}
          <p class="nota" style="margin:6px 0 0;">Una solicitud puede traer varias fallas. Azul = thermo.</p></div>
        <div class="mr-caja"><h3>Remolques con más solicitudes</h3>
          <div style="overflow-x:auto;"><table class="mr-tabla"><tr><th>Remolque</th><th>Solicitudes</th><th>Fallas</th></tr>
          ${a.remolques.slice(0, 8).map(r => `<tr><td><b>${esc(r.id)}</b> ${esc(r.txt.replace(r.id, "").trim())}</td><td>${r.n}</td><td>${esc(contar(r.fallas).map(([f, n]) => n > 1 ? `${f} (${n})` : f).join(", "))}</td></tr>`).join("")}</table></div>
          <h3 style="margin-top:12px;">Por ubicación</h3>${barras(a.ubicaciones.slice(0, 8))}</div>
      </div>

      <div class="mr-caja"><h3>¿Qué se hizo? (comentario de cierre · ${a.terminadas} terminada${a.terminadas === 1 ? "" : "s"})</h3>
        ${a.terminadas ? `<div class="mr-dos"><div>${barras(a.queSeHizo, (k) => k === SIN_CLASIFICAR || k === "Revisión sin falla" ? "gr" : "ok")}</div>
        <div style="overflow-x:auto;"><table class="mr-tabla"><tr><th>Falla reportada</th><th>Qué se hizo (más común)</th></tr>
          ${a.cruce.map(c => `<tr><td>${esc(c.falla)} (${c.n})</td><td>${esc(c.hechos || "—")}</td></tr>`).join("")}</table></div></div>` : `<p class="nota">Todavía no hay terminadas en este rango.</p>`}
      </div>

      <div class="mr-dos">
        <div class="mr-caja"><h3>🔁 Reincidencias</h3>
          <p class="nota" style="margin:0 0 6px;">Mismo remolque y misma falla otra vez dentro de ${DIAS_REINCIDENCIA} días después de cerrada.</p>
          ${a.reincidencias.length ? `<div style="overflow-x:auto;"><table class="mr-tabla"><tr><th>Remolque</th><th>Falla</th><th>Cerrada</th><th>Volvió</th></tr>
            ${a.reincidencias.map(r => `<tr><td><b>${esc(r.s.remolque.id)}</b></td><td>${esc(r.falla)}</td><td>${esc(ddmmyyyy(isoLocal(new Date(r.p.terminadaMs))))} · ${esc(r.p.folio || "")}<br><small class="nota">"${esc(r.p.comentarioCierre || "")}"</small></td><td>${esc(ddmmyyyy(fechaHoraDe(r.s).fecha))} (${r.dias} d)<br><small class="nota">${esc(r.s.folio || "")}</small></td></tr>`).join("")}</table></div>
            <div class="mr-aviso" style="background:#FDECEA;border:1px solid #F3C2BC;color:#8a2318;">${a.reincidencias.length} reincidencia${a.reincidencias.length === 1 ? "" : "s"} en el periodo.</div>`
          : `<p class="nota">Sin reincidencias en el periodo.</p>`}
        </div>
        <div class="mr-caja"><h3>📝 Calidad del comentario</h3>
          <p class="nota" style="margin:0 0 6px;">Cierres muy cortos o genéricos ("listo", "ok") no dicen qué se hizo.</p>
          ${a.sinDet.length ? `<div style="overflow-x:auto;"><table class="mr-tabla"><tr><th>Folio</th><th>Comentario</th><th>Cerró</th></tr>
            ${a.sinDet.map(s => `<tr><td>${esc(s.folio || s.id)}</td><td>"${esc(s.comentarioCierre || "")}"</td><td>${esc((s.terminadaPor && s.terminadaPor.nombre) || "—")}</td></tr>`).join("")}</table></div>
            <div class="mr-aviso" style="background:#FFF6E0;border:1px solid #E9C46A;color:#6b4a06;">${a.sinDet.length} de ${a.terminadas} sin detalle (${Math.round(a.sinDet.length / Math.max(1, a.terminadas) * 100)}%).</div>`
          : `<p class="nota">${a.terminadas ? "Todos los cierres traen detalle. 👍" : "Todavía no hay terminadas."}</p>`}
        </div>
      </div>

      <div class="mr-caja">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <h3 style="margin:0;">Detalle (${lista.length})</h3>
          <div class="mr-desc"><button type="button" class="secundario" id="mr-xlsx">⬇️ Excel</button><button type="button" id="mr-pdf">⬇️ PDF</button></div>
        </div>
        <div style="overflow-x:auto;margin-top:8px;"><table class="mr-tabla">
          <tr><th>Folio</th><th>Fecha</th><th>Remolque</th><th>Ubicación</th><th>Fallas</th><th>Turno</th><th>Estado</th><th>Atención</th><th>Qué se hizo</th></tr>
          ${filas.map(({ s, f }) => `<tr>
            <td>${esc(f.folio)}${f.reincidencia ? `<br><span class="mr-chip mr-rj">Reincidencia</span>` : ""}</td>
            <td style="white-space:nowrap;">${esc(f.fecha.slice(0, 5))} ${esc(f.hora)}</td>
            <td>${esc(f.remolque)}</td><td>${esc(f.ubicacion)}</td><td>${esc(f.fallas)}</td>
            <td><span class="mr-chip ${(a.turnos.get(s.id) || {}).sueldo ? "mr-su" : "mr-se"}">${(a.turnos.get(s.id) || {}).sueldo ? "Sueldo" : "Servicio"}</span></td>
            <td><span class="mr-chip ${s.estado === "terminada" ? "mr-te" : "mr-ab"}">${f.estado.toUpperCase()}</span></td>
            <td>${esc(f.atencion)}</td>
            <td>${f.comentario ? `${esc(f.queSeHizo)}<br><small class="nota">${esc(f.comentario)}</small>` : "—"}</td></tr>`).join("")}
        </table></div>
      </div>`;
    $("#mr-pdf").addEventListener("click", () => descargarPdf(lista, a).catch(e => { $("#mr-err").textContent = "No se pudo generar el PDF: " + e.message; }));
    $("#mr-xlsx").addEventListener("click", () => descargarExcel(lista, a).catch(e => { $("#mr-err").textContent = "No se pudo generar el Excel: " + e.message; }));
  }

  // ---- Descargas ----
  const etiquetaRango = () => `Del ${ddmmyyyy(desde)} al ${ddmmyyyy(hasta)} · ${estado === "todas" ? "Todas" : estado === "abiertas" ? "Abiertas" : "Terminadas"}${remolque ? ` · Remolque ${remolque}` : ""}`;
  const nombreArchivo = (ext) => `reporte_mantenimiento_${desde}_a_${hasta}.${ext}`;

  async function descargarPdf(lista, a) {
    const { jsPDF } = await cargarScript(URL_JSPDF, "jspdf");
    if (typeof jsPDF.API.autoTable !== "function") await cargarScript(URL_AUTOTABLE, "__sinGlobal__");
    const pdf = new jsPDF({ unit: "mm", format: "letter", orientation: "landscape" });
    if (typeof pdf.autoTable !== "function") throw new Error("No se cargó la librería de tablas.");
    const W = pdf.internal.pageSize.getWidth(), X0 = 12, X1 = W - 12;
    const CAFE = [61, 43, 38];
    const altoLogo = 30 * LOGO_ALANIS.alto / LOGO_ALANIS.ancho;
    pdf.addImage(LOGO_ALANIS.datos, "JPEG", X0, 8, 30, altoLogo);
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(13); pdf.setTextColor(34, 34, 34);
    pdf.text("REPORTE DE MANTENIMIENTO DE REMOLQUES", X1, 14, { align: "right" });
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(9);
    pdf.text(etiquetaRango(), X1, 19, { align: "right" });
    pdf.setDrawColor(34, 34, 34); pdf.line(X0, 10 + altoLogo, X1, 10 + altoLogo);
    let y = 14 + altoLogo;
    const estilo = { styles: { fontSize: 8, cellPadding: 1.6 }, headStyles: { fillColor: CAFE, textColor: 255, fontSize: 7.5 }, margin: { left: X0, right: 12 } };
    const tabla = (titulo, head, body, extra = {}) => {
      if (y > pdf.internal.pageSize.getHeight() - 30) { pdf.addPage(); y = 14; }
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(9.5); pdf.text(titulo, extra.x || X0, y);
      pdf.autoTable({ ...estilo, startY: y + 2, head: [head], body, ...extra.opts });
      return pdf.lastAutoTable.finalY;
    };
    // Totales
    pdf.autoTable({ ...estilo, startY: y, head: [["Solicitudes", "Terminadas", "Abiertas", "Atención promedio", "Remolques distintos"]],
      body: [[a.total, a.terminadas, `${a.abiertas}${a.abiertas ? ` (la más vieja ${duracion(a.masVieja)})` : ""}`, isFinite(a.promedio) ? duracion(a.promedio) : "—", a.remolquesDistintos]],
      styles: { fontSize: 10, halign: "center", cellPadding: 2 } });
    y = pdf.lastAutoTable.finalY + 7;
    // Horario
    const pct = (n) => a.total ? `${Math.round(n / a.total * 100)}%` : "0%";
    y = tabla("Horario de atención (hora en que se creó la OT)", ["Turno", "Solicitudes", "%", "Atención promedio", "Terminadas el mismo día", "Falla más común"], [
      [TXT_SUELDO, a.sueldo.total, pct(a.sueldo.total), isFinite(a.sueldo.promedio) ? duracion(a.sueldo.promedio) : "—", `${a.sueldo.mismoDia} de ${a.sueldo.terminadas}`, a.sueldo.fallaTop],
      [TXT_SERVICIO + (a.motivosServicio.length ? `\n${a.motivosServicio.map(([m, n]) => `${m}: ${n}`).join(" · ")}` : ""), a.servicio.total, pct(a.servicio.total), isFinite(a.servicio.promedio) ? duracion(a.servicio.promedio) : "—", `${a.servicio.mismoDia} de ${a.servicio.terminadas}`, a.servicio.fallaTop],
    ]) + 7;
    y = tabla("Por día de la semana", ["", ...a.porDia.map(d => d.nombre)], [
      ["Sueldo", ...a.porDia.map(d => d.sueldo)], ["Por servicio", ...a.porDia.map(d => d.servicio)], ["Total", ...a.porDia.map(d => d.sueldo + d.servicio)],
    ], { opts: { styles: { fontSize: 8, halign: "center", cellPadding: 1.6 } } }) + 7;
    // Tablas resumen, una debajo de otra (las tablas lado a lado se desacomodan al cambiar de hoja).
    const angosta = { opts: { tableWidth: (W - 24) * 0.55 } };
    const sinDatos = (b, n) => b.length ? b : [["Sin datos", ...Array(n - 1).fill("")]];
    y = tabla("Por tipo de falla", ["Falla", "Solicitudes"], sinDatos(a.fallas.map(([k, v]) => [k, v]), 2), angosta) + 7;
    y = tabla("Remolques con más solicitudes", ["Remolque", "Solicitudes", "Fallas"], sinDatos(a.remolques.slice(0, 10).map(r => [r.txt || r.id, r.n, contar(r.fallas).map(([f, n]) => n > 1 ? `${f} (${n})` : f).join(", ")]), 3)) + 7;
    y = tabla("Por ubicación", ["Ubicación", "Solicitudes"], sinDatos(a.ubicaciones.map(([k, v]) => [k, v]), 2), angosta) + 7;
    y = tabla("¿Qué se hizo? (comentario de cierre)", ["Categoría", "Solicitudes"], sinDatos(a.queSeHizo.map(([k, v]) => [k, v]), 2), angosta) + 7;
    y = tabla("Falla reportada vs. qué se hizo", ["Falla", "Qué se hizo (más común)"], sinDatos(a.cruce.map(c => [`${c.falla} (${c.n})`, c.hechos || "—"]), 2)) + 7;
    y = tabla(`Reincidencias (${DIAS_REINCIDENCIA} días)`, ["Remolque", "Falla", "Cerrada", "Volvió"], sinDatos(a.reincidencias.map(r => [r.s.remolque.id, r.falla, `${ddmmyyyy(isoLocal(new Date(r.p.terminadaMs)))} ${r.p.folio || ""}\n"${r.p.comentarioCierre || ""}"`, `${ddmmyyyy(fechaHoraDe(r.s).fecha)} (${r.dias} d) ${r.s.folio || ""}`]), 4)) + 7;
    y = tabla("Calidad del comentario (cierres sin detalle)", ["Folio", "Comentario", "Cerró"], sinDatos(a.sinDet.map(s => [s.folio || s.id, s.comentarioCierre || "", (s.terminadaPor && s.terminadaPor.nombre) || ""]), 3), angosta) + 7;
    // Detalle
    pdf.addPage(); y = 14;
    tabla(`Detalle (${lista.length})`, ["Folio", "Fecha", "Remolque", "Ubicación", "Fallas", "Turno", "Estado", "Atención", "Cerró", "Comentario de cierre", "Qué se hizo"],
      lista.map(s => { const f = filaDetalle(s, a); return [f.folio + (f.reincidencia ? "\nReincidencia" : ""), `${f.fecha} ${f.hora}`, f.remolque, f.ubicacion, f.fallas, f.turno, f.estado, f.atencion, f.cerro, f.comentario, f.queSeHizo]; }),
      { opts: { styles: { fontSize: 7, cellPadding: 1.3, overflow: "linebreak" }, columnStyles: { 9: { cellWidth: 55 } } } });
    // Pie
    const total = pdf.getNumberOfPages(), H = pdf.internal.pageSize.getHeight();
    const gen = new Date();
    for (let i = 1; i <= total; i++) {
      pdf.setPage(i); pdf.setFont("helvetica", "normal"); pdf.setFontSize(7); pdf.setTextColor(110, 110, 110);
      pdf.text(`Generado el ${gen.getDate()} ${MESES[gen.getMonth()]} ${gen.getFullYear()}, ${pad(gen.getHours())}:${pad(gen.getMinutes())}`, X0, H - 6);
      pdf.setFont("helvetica", "bold"); pdf.text("AUTOTRANSPORTES ALANIS, S.A. DE C.V.", W / 2, H - 6, { align: "center" });
      pdf.setFont("helvetica", "normal"); pdf.text(`${i}/${total}`, X1, H - 6, { align: "right" });
    }
    pdf.save(nombreArchivo("pdf"));
  }

  async function descargarExcel(lista, a) {
    const XLSX = await cargarScript(URL_XLSX, "XLSX");
    const libro = XLSX.utils.book_new();
    const filas = lista.map(s => filaDetalle(s, a));
    const encabezados = [["Folio", "folio"], ["Fecha", "fecha"], ["Hora", "hora"], ["Remolque", "remolque"], ["Marca", "marca"], ["Modelo", "modelo"], ["Placas", "placas"],
      ["Ubicación", "ubicacion"], ["Fallas", "fallas"], ["Descripción", "descripcion"], ["Solicitó", "solicito"], ["Área", "area"], ["Turno", "turno"], ["Estado", "estado"],
      ["Terminada", "terminada"], ["Horas de atención", "horasAtencion"], ["Cerró", "cerro"], ["Comentario de cierre", "comentario"], ["Qué se hizo", "queSeHizo"], ["Reincidencia", "reincidencia"]];
    const hoja = XLSX.utils.aoa_to_sheet([encabezados.map(e => e[0]), ...filas.map(f => encabezados.map(e => f[e[1]]))]);
    hoja["!cols"] = encabezados.map(([t, k]) => ({ wch: Math.min(60, Math.max(t.length + 2, ...filas.map(f => String(f[k] ?? "").length + 1))) }));
    hoja["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filas.length, c: encabezados.length - 1 } }) };
    XLSX.utils.book_append_sheet(libro, hoja, "Detalle");

    const r = [];
    const pctN = (n) => a.total ? Math.round(n / a.total * 1000) / 10 : 0;
    r.push(["REPORTE DE MANTENIMIENTO DE REMOLQUES"], [etiquetaRango()], []);
    r.push(["Solicitudes", "Terminadas", "Abiertas", "Atención promedio", "Remolques distintos"],
      [a.total, a.terminadas, a.abiertas, isFinite(a.promedio) ? duracion(a.promedio) : "", a.remolquesDistintos], []);
    r.push(["Horario de atención (hora de creación de la OT)"], ["Turno", "Solicitudes", "%", "Atención promedio", "Terminadas el mismo día", "Falla más común"],
      [TXT_SUELDO, a.sueldo.total, pctN(a.sueldo.total), isFinite(a.sueldo.promedio) ? duracion(a.sueldo.promedio) : "", `${a.sueldo.mismoDia} de ${a.sueldo.terminadas}`, a.sueldo.fallaTop],
      [TXT_SERVICIO, a.servicio.total, pctN(a.servicio.total), isFinite(a.servicio.promedio) ? duracion(a.servicio.promedio) : "", `${a.servicio.mismoDia} de ${a.servicio.terminadas}`, a.servicio.fallaTop]);
    a.motivosServicio.forEach(([m, n]) => r.push([`   · ${m}`, n]));
    r.push([], ["Por hora", "Sueldo", "Por servicio", "Total"], ...a.porHora.map(h => [`${pad(h.h)}:00`, h.sueldo, h.servicio, h.sueldo + h.servicio]));
    r.push([], ["Por día", "Sueldo", "Por servicio", "Total"], ...a.porDia.map(d => [d.nombre, d.sueldo, d.servicio, d.sueldo + d.servicio]));
    r.push([], ["Por tipo de falla", "Solicitudes"], ...a.fallas);
    r.push([], ["Por ubicación", "Solicitudes"], ...a.ubicaciones);
    r.push([], ["Remolque", "Solicitudes", "Fallas"], ...a.remolques.map(x => [x.txt || x.id, x.n, contar(x.fallas).map(([f, n]) => n > 1 ? `${f} (${n})` : f).join(", ")]));
    r.push([], ["Qué se hizo (comentario de cierre)", "Solicitudes"], ...a.queSeHizo);
    r.push([], ["Falla reportada", "Solicitudes", "Qué se hizo (más común)"], ...a.cruce.map(c => [c.falla, c.n, c.hechos]));
    r.push([], [`Reincidencias (${DIAS_REINCIDENCIA} días)`, "Falla", "Folio cerrado", "Cerrada", "Comentario", "Folio nuevo", "Volvió", "Días"],
      ...a.reincidencias.map(x => [x.s.remolque.id, x.falla, x.p.folio || "", ddmmyyyy(isoLocal(new Date(x.p.terminadaMs))), x.p.comentarioCierre || "", x.s.folio || "", ddmmyyyy(fechaHoraDe(x.s).fecha), x.dias]));
    r.push([], ["Comentarios sin detalle", "Comentario", "Cerró"], ...a.sinDet.map(s => [s.folio || s.id, s.comentarioCierre || "", (s.terminadaPor && s.terminadaPor.nombre) || ""]));
    const hojaR = XLSX.utils.aoa_to_sheet(r);
    hojaR["!cols"] = [{ wch: 42 }, { wch: 14 }, { wch: 40 }, { wch: 18 }, { wch: 40 }, { wch: 20 }, { wch: 14 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(libro, hojaR, "Resumen");
    XLSX.writeFile(libro, nombreArchivo("xlsx"));
  }

  // ---- Eventos de filtros ----
  $("#mr-desde").addEventListener("change", (e) => { if (!e.target.value) return; desde = e.target.value; if (desde > hasta) { hasta = desde; $("#mr-hasta").value = hasta; } marcarAtajo(""); cargar(); });
  $("#mr-hasta").addEventListener("change", (e) => { if (!e.target.value) return; hasta = e.target.value; if (hasta < desde) { desde = hasta; $("#mr-desde").value = desde; } marcarAtajo(""); cargar(); });
  $("#mr-estado").addEventListener("change", (e) => { estado = e.target.value; pintar(); });
  $("#mr-rem").addEventListener("change", (e) => { remolque = e.target.value; pintar(); });
  function marcarAtajo(id) { atajo = id; cuerpo.querySelectorAll(".mr-at").forEach(b => b.classList.toggle("on", b.dataset.a === id)); }
  cuerpo.querySelectorAll(".mr-at").forEach(b => b.addEventListener("click", () => {
    const x = at.find(z => z.id === b.dataset.a); if (!x) return;
    desde = x.d; hasta = x.h; $("#mr-desde").value = desde; $("#mr-hasta").value = hasta; marcarAtajo(x.id); cargar();
  }));
  cargar();
}