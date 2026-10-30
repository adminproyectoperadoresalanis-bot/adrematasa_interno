// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/public/js/comercial.js
// ##########################################################################
import { db } from "./firebase-config.js";
import {
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, runTransaction, query, where
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { LOGO_ALANIS } from "./comercialLogo.js";

// ============================================================================
// Utilidades → Comercial (2026-10-30, pedido de Ivan). Reemplaza al CRM viejo
// (proyecto crm-alanis) DENTRO de ADREMATASA Interno: sin espejos ni funciones.
// Catálogo en cero; se replica la estructura de clientes y cotizaciones del CRM.
//
//   com_clientes/{id}        catálogo compartido entre quienes tienen Comercial.
//   com_cotizaciones/{folio} cada quien ve SOLO las suyas; el admin ve todas.
//   com_rutas/{id}           catálogo de rutas (origen, destino, km).
//   com_config/ajustes       semáforo de ingreso/km, TC sugerido, vigencia,
//                            condiciones del PDF (solo admin las cambia).
//   com_contadores/cotizaciones_<aa>  consecutivo ÚNICO para todos (no por
//                            persona): ATASA-00001-26. Se toma en una
//                            transacción del navegador; firestore.rules
//                            exige que el folio sea el siguiente del contador.
//
// Quién entra: Configuración → Utilidades, columna "Comercial" por área.
// Una cotización lleva varias rutas; dentro de su vigencia se le pueden agregar
// rutas nuevas (quedan marcadas con su fecha). VENCIDA se calcula por fecha.
// El PDF (jsPDF) lo firma quien hizo la cotización: nombre, puesto y correo.
//
// 2026-10-30: km con OpenRouteService (lo mismo que tenía el CRM publicado):
// autocompletado de ciudades (MX y EUA), ruta con perfil de CAMIÓN
// (driving-hgv), mapa (Leaflet + OpenStreetMap), puntos vía y "Guardar en
// catálogo". La clave de ORS va en Ajustes (com_config/ajustes.orsKey), no en
// el código. Si la ruta ya está en el catálogo, mandan los km del catálogo.
// ============================================================================

const COL_CLI = "com_clientes";
const COL_COT = "com_cotizaciones";
const COL_RUT = "com_rutas";
const COL_CFG = "com_config";
const COL_CONT = "com_contadores";
const URL_JSPDF = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
const URL_LEAFLET_JS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
const URL_LEAFLET_CSS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
const ORS = "https://api.openrouteservice.org";
const KM_RUTA_CORTA = 350; // como el CRM: RC = 350 km o menos; RL = 351 o más
const tipoRutaTxt = (km) => km ? (km <= KM_RUTA_CORTA ? "RC" : "RL") : "";

const AJUSTES_BASE = {
  verde: 80, ambar: 60, tipoCambio: 18.5, vigenciaDias: 30, orsKey: "",
  condiciones: "Precios más IVA, menos retención del 4%.\nTarifa por viaje sencillo.\nNo incluye maniobras, estadías ni seguro de la mercancía.",
};
const ESTADOS = {
  borrador: { txt: "BORRADOR", clase: "co-gris" },
  enviada: { txt: "ENVIADA", clase: "co-azul" },
  aceptada: { txt: "ACEPTADA", clase: "co-verde" },
  rechazada: { txt: "RECHAZADA", clase: "co-rojo" },
  vencida: { txt: "VENCIDA", clase: "co-gris" },
};
const CARGAS = { refrigerada: "Refrigerada", seca: "Seca" };
const SERVICIOS = { nacional: "Nacional", importacion: "Importación", exportacion: "Exportación" };
const DIA = 864e5;

// ---- Utilerías ----------------------------------------------------------------
function esc(t) { const d = document.createElement("div"); d.textContent = t == null ? "" : String(t); return d.innerHTML; }
const pad = (n, l = 2) => String(n).padStart(l, "0");
const fecha = (ms) => { if (!ms) return "—"; const d = new Date(ms); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const fechaLarga = (ms) => { const d = new Date(ms); return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`; };
const num = (t) => { const n = Number(String(t == null ? "" : t).replace(/[$,\s]/g, "")); return isFinite(n) && String(t).trim() !== "" ? n : null; };
const dinero = (n, mon = "MXN") => n == null || !isFinite(n) ? "—" :
  `${mon === "USD" ? "US$" : "$"}${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const miles = (n) => n == null ? "—" : Number(n).toLocaleString("es-MX", { maximumFractionDigits: 0 });
const normTxt = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
export function folioDe(consecutivo, anio2) { return `ATASA-${pad(consecutivo, 5)}-${anio2}`; }
export function estadoDe(c, ahora = Date.now()) {
  if ((c.estado === "borrador" || c.estado === "enviada") && c.vencimientoMs && c.vencimientoMs < ahora) return "vencida";
  return c.estado || "borrador";
}
// Ingreso por km en MXN de una ruta.
export function ingresoKm(ruta, moneda, tc) {
  const km = num(ruta.km), imp = num(ruta.importe);
  if (!km || imp == null) return null;
  return (moneda === "USD" ? imp * (num(tc) || 0) : imp) / km;
}
function cargarScript(url, global) {
  if (window[global]) return Promise.resolve(window[global]);
  return new Promise((ok, mal) => {
    const s = document.createElement("script");
    s.src = url; s.onload = () => ok(window[global]); s.onerror = () => mal(new Error("No se pudo cargar " + url));
    document.head.appendChild(s);
  });
}

// ---- OpenRouteService -----------------------------------------------------------
async function orsBuscar(texto, clave) {
  const url = `${ORS}/geocode/search?api_key=${encodeURIComponent(clave)}&text=${encodeURIComponent(texto)}&boundary.country=MX,US&size=6&lang=es`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status === 403 || r.status === 401 ? "La clave de ORS no es válida (revisa Ajustes)." : `ORS respondió ${r.status}.`);
  const d = await r.json();
  return (d.features || []).map(f => ({ label: (f.properties && f.properties.label) || "", lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
}
// puntos: [{lng, lat}] (origen, vías…, destino) → { km, linea: [[lat, lng]] }
async function orsRuta(puntos, clave) {
  const r = await fetch(`${ORS}/v2/directions/driving-hgv/geojson`, {
    method: "POST", headers: { "Authorization": clave, "Content-Type": "application/json" },
    body: JSON.stringify({ coordinates: puntos.map(p => [p.lng, p.lat]) }),
  });
  if (!r.ok) throw new Error(r.status === 403 || r.status === 401 ? "La clave de ORS no es válida (revisa Ajustes)." : r.status === 429 ? "Se acabó la cuota de ORS de hoy." : `ORS respondió ${r.status}.`);
  const d = await r.json();
  const f = d.features && d.features[0];
  if (!f) throw new Error("ORS no encontró ruta.");
  return { km: Math.round(f.properties.summary.distance / 1000), linea: f.geometry.coordinates.map(([lng, lat]) => [lat, lng]) };
}
function cargarCss(url) {
  if (document.querySelector(`link[href="${url}"]`)) return;
  const l = document.createElement("link"); l.rel = "stylesheet"; l.href = url; document.head.appendChild(l);
}

function inyectarEstilos() {
  if (document.getElementById("co-estilos")) return;
  const s = document.createElement("style");
  s.id = "co-estilos";
  s.textContent = `
    .co-tabs { display:flex; gap:8px; flex-wrap:wrap; margin:12px 0 14px; }
    .co-tab { background:#fff; color:#4a3e33; border:1px solid #e2ddd5; border-radius:20px; padding:7px 14px; font-size:13px; cursor:pointer; }
    .co-tab.activo { background:#2c1e0f; color:#fff; border-color:#2c1e0f; }
    .co-filtros { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:10px; }
    .co-filtros input, .co-filtros select { width:auto; min-width:160px; }
    .co-seg { display:inline-flex; border:1px solid #e2ddd5; border-radius:9px; overflow:hidden; flex-wrap:wrap; }
    .co-seg button { background:#fff; border:0; border-left:1px solid #e2ddd5; padding:7px 12px; font:inherit; font-size:12.5px; color:#6b5f52; cursor:pointer; }
    .co-seg button:first-child { border-left:0; } .co-seg button.activo { background:#2c1e0f; color:#fff; font-weight:700; }
    .co-chip { display:inline-block; font-size:10px; font-weight:800; padding:2px 8px; border-radius:9px; letter-spacing:.3px; white-space:nowrap; }
    .co-gris { background:#ECE9E4; color:#5c5045; } .co-azul { background:#E6F1FB; color:#185FA5; } .co-verde { background:#EAF3DE; color:#3B7A1E; }
    .co-rojo { background:#FBE4E1; color:#A32D2D; } .co-ambar { background:#FBE3A8; color:#7a3e06; }
    .co-seca { background:#F3E9D7; color:#7a4a12; } .co-refri { background:#DDEEFB; color:#0C447C; }
    .co-sem { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:5px; vertical-align:1px; }
    .co-s-v { background:#3B7A1E; } .co-s-a { background:#D99A1E; } .co-s-r { background:#C0392B; } .co-s-n { background:#cfc8bf; }
    .co-tabla td, .co-tabla th { vertical-align:top; } .co-tabla td.n, .co-tabla th.n { text-align:right; white-space:nowrap; }
    .co-tabla tr.clic { cursor:pointer; } .co-tabla tr.clic:hover td { background:#faf8f5; }
    .co-kpis { display:flex; gap:10px; flex-wrap:wrap; margin:12px 0; }
    .co-kpi { border:1px solid #e2ddd5; border-radius:12px; padding:10px 14px; min-width:130px; background:#fff; }
    .co-kpi b { display:block; font-size:19px; } .co-kpi small { color:#8a7f73; font-size:11.5px; }
    .co-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; }
    .co-grid label, .co-campo label { font-size:11.5px; color:#6b5f52; display:block; margin-bottom:4px; font-weight:600; }
    .co-campos { display:grid; grid-template-columns:110px 1fr; gap:6px 10px; font-size:13px; }
    .co-campos > span { color:#6b5f52; }
    .co-h3 { font-size:12px; margin:18px 0 8px; color:#6b5f52; text-transform:uppercase; letter-spacing:.5px; font-weight:700; }
    .co-rutas input { min-width:0; width:100%; }
    .co-rutas td { padding:6px 5px; }
    .co-acciones { display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; margin-top:14px; }
    .co-mini { padding:4px 10px; font-size:12px; }
    .co-link { background:none; border:0; padding:0; font:inherit; color:#185FA5; text-decoration:underline; cursor:pointer; font-weight:600; }
    .co-indicador { border:1px solid #e2ddd5; border-radius:12px; padding:12px 14px; background:#fbfaf8; font-size:13px; }
    .co-ac { position:relative; }
    .co-ac-lista { position:fixed; z-index:10050; background:#fff; border:1px solid #e2ddd5; border-radius:0 0 10px 10px; box-shadow:0 8px 20px rgba(44,30,15,.12); max-height:240px; overflow:auto; }
    .co-ac-lista div { padding:8px 10px; font-size:13px; cursor:pointer; border-top:1px solid #f0ece6; }
    .co-ac-lista div:first-child { border-top:0; } .co-ac-lista div:hover, .co-ac-lista div.activo { background:#f2ede6; }
    .co-mapa { height:340px; border-radius:10px; overflow:hidden; border:1px solid #e2ddd5; }
    .co-via { display:inline-flex; align-items:center; gap:4px; background:#f2ede6; border-radius:8px; padding:2px 8px; font-size:12px; margin:2px 4px 2px 0; }
    .co-contacto { display:grid; grid-template-columns:1.2fr 1fr 1fr 1.3fr auto; gap:6px; margin-bottom:6px; }
    @media (max-width:700px) { .co-contacto { grid-template-columns:1fr 1fr; } .co-campos { grid-template-columns:1fr; } }
  `;
  document.head.appendChild(s);
}

// ---- PDF ----------------------------------------------------------------------
// Una hoja carta (o más si hay muchas rutas): logo, folio, cliente, tabla de
// rutas, condiciones y firma de quien cotizó. Sin ingreso/km (es interno).
export async function generarPdf(cot, cliente, ajustes) {
  const { jsPDF } = await cargarScript(URL_JSPDF, "jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "letter" });
  const CAFE = [44, 30, 15], GRIS = [110, 98, 86];
  const X0 = 18, X1 = 198;
  let y = 16;
  pdf.addImage(LOGO_ALANIS.datos, "JPEG", X0, y - 4, 48, 48 * LOGO_ALANIS.alto / LOGO_ALANIS.ancho);
  pdf.setTextColor(...CAFE); pdf.setFont("helvetica", "bold"); pdf.setFontSize(15);
  pdf.text("COTIZACIÓN", X1, y + 2, { align: "right" });
  pdf.setFontSize(10.5); pdf.text(cot.folio || "", X1, y + 8, { align: "right" });
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(...GRIS);
  pdf.text(`Nuevo Laredo, Tamps., ${fechaLarga(cot.emisionMs || Date.now())}`, X1, y + 13, { align: "right" });
  y += 22;
  pdf.setDrawColor(...CAFE); pdf.setLineWidth(0.6); pdf.line(X0, y, X1, y);
  y += 8;
  pdf.setTextColor(...CAFE); pdf.setFont("helvetica", "bold"); pdf.setFontSize(11);
  pdf.text(cliente ? cliente.nombre : (cot.clienteNombre || ""), X0, y);
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(9.5); pdf.setTextColor(40, 34, 28);
  if (cot.contacto && cot.contacto.nombre) { y += 5; pdf.text(`Atención: ${cot.contacto.nombre}${cot.contacto.puesto ? ", " + cot.contacto.puesto : ""}`, X0, y); }
  y += 9;
  const intro = `Por medio de la presente le compartimos nuestra propuesta de servicio de autotransporte de carga ${(CARGAS[cot.tipoCarga] || "").toLowerCase()}${cot.tipoServicio && cot.tipoServicio !== "nacional" ? " (" + (SERVICIOS[cot.tipoServicio] || "").toLowerCase() + ")" : ""}:`;
  pdf.splitTextToSize(intro, X1 - X0).forEach(l => { pdf.text(l, X0, y); y += 4.6; });
  y += 3;
  // Tabla
  const cols = [{ t: "Origen", x: X0 + 2 }, { t: "Destino", x: X0 + 64 }, { t: "Km", x: 150, d: true }, { t: "Tarifa por viaje", x: X1 - 2, d: true }];
  const cabecera = () => {
    pdf.setFillColor(245, 239, 230); pdf.rect(X0, y - 4.5, X1 - X0, 7, "F");
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(8.8); pdf.setTextColor(...CAFE);
    cols.forEach(c => pdf.text(c.t, c.x, y, c.d ? { align: "right" } : undefined));
    y += 7; pdf.setFont("helvetica", "normal"); pdf.setTextColor(40, 34, 28);
  };
  cabecera();
  (cot.rutas || []).forEach(r => {
    const o = pdf.splitTextToSize(r.origen || "", 58), d = pdf.splitTextToSize(r.destino || "", 58);
    const nueva = r.agregadaMs && cot.emisionMs && r.agregadaMs - cot.emisionMs > DIA / 2;
    const alto = Math.max(o.length, d.length) * 4.4 + (nueva ? 3.6 : 0) + 2.6;
    if (y + alto > 238) { pdf.addPage(); y = 20; cabecera(); }
    pdf.setFontSize(9.2);
    o.forEach((l, i) => pdf.text(l, cols[0].x, y + i * 4.4));
    d.forEach((l, i) => pdf.text(l, cols[1].x, y + i * 4.4));
    pdf.text(r.km != null ? miles(r.km) : "—", cols[2].x, y, { align: "right" });
    pdf.setFont("helvetica", "bold");
    pdf.text(`${dinero(num(r.importe), cot.moneda)} ${cot.moneda}`, cols[3].x, y, { align: "right" });
    pdf.setFont("helvetica", "normal");
    if (nueva) { pdf.setFontSize(7.5); pdf.setTextColor(...GRIS); pdf.text(`Ruta agregada el ${fecha(r.agregadaMs)}`, cols[0].x, y + Math.max(o.length, d.length) * 4.4); pdf.setTextColor(40, 34, 28); }
    y += alto;
    pdf.setDrawColor(230, 224, 216); pdf.setLineWidth(0.2); pdf.line(X0, y - 3.6, X1, y - 3.6);
  });
  // Condiciones
  y += 4;
  const condiciones = String(ajustes.condiciones || "").split(/\n+/).map(t => t.trim()).filter(Boolean);
  condiciones.push(`Vigencia: ${cot.vigenciaDias} días (hasta el ${fechaLarga(cot.vencimientoMs)}).`);
  if (cot.moneda === "USD") condiciones.push("Importes en dólares americanos (USD).");
  if (cot.notas) cot.notas.split(/\n+/).map(t => t.trim()).filter(Boolean).forEach(t => condiciones.push(t));
  if (y + 10 + condiciones.length * 5 > 250) { pdf.addPage(); y = 20; }
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(9.5); pdf.setTextColor(...CAFE); pdf.text("Condiciones", X0, y); y += 5.5;
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(40, 34, 28);
  condiciones.forEach(t => pdf.splitTextToSize("•  " + t, X1 - X0 - 4).forEach((l, i) => { pdf.text(i ? "   " + l : l, X0 + 1, y); y += 4.6; }));
  // Firma
  if (y + 30 > 262) { pdf.addPage(); y = 20; }
  y += 8;
  pdf.text("Quedo a sus órdenes.", X0, y); y += 10;
  const f = cot.creadoPor || {};
  pdf.setFont("helvetica", "bold"); pdf.setTextColor(...CAFE); pdf.text(f.nombre || "", X0, y); y += 4.8;
  pdf.setFont("helvetica", "normal"); pdf.setTextColor(40, 34, 28);
  [f.puesto, "Autotransportes Alanis", f.correo].filter(Boolean).forEach(t => { pdf.text(t, X0, y); y += 4.6; });
  // Pie
  const paginas = pdf.getNumberOfPages();
  for (let p = 1; p <= paginas; p++) {
    pdf.setPage(p); pdf.setFontSize(7.5); pdf.setTextColor(...GRIS);
    pdf.text("Autotransportes Alanis · Carretera Aeropuerto Km 2.75, Col. América 4, Nuevo Laredo, Tamps., C.P. 88299 · (867) 711 6565", 108, 272, { align: "center" });
    if (paginas > 1) pdf.text(`${p} / ${paginas}`, X1, 272, { align: "right" });
  }
  pdf.save(`${cot.folio || "cotizacion"}.pdf`);
}

// ---- Pantalla -----------------------------------------------------------------
export function iniciarComercial(contenedor, datosUsuario, uid, correo) {
  inyectarEstilos();
  const esAdmin = (datosUsuario && datosUsuario.rol) === "admin";
  const yo = { uid, nombre: (datosUsuario && datosUsuario.nombre) || "", puesto: (datosUsuario && datosUsuario.puesto) || "", correo: correo || (datosUsuario && datosUsuario.email) || "" };
  contenedor.innerHTML = `
    <section class="panel">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
        <div><h2 style="margin:0;">Comercial</h2><p class="nota" style="margin:3px 0 0;">Clientes, cotizaciones y rutas.${esAdmin ? "" : " Ves solo tus cotizaciones."}</p></div>
        <button type="button" id="co-nueva">+ Nueva cotización</button>
      </div>
      <div class="co-tabs" id="co-tabs"></div>
      <div id="co-error" class="error"></div>
      <p id="co-exito" class="nota oculto" style="color:#1c7a41;"></p>
      <div id="co-cuerpo"><p class="nota">Cargando…</p></div>
    </section>`;
  const $ = (s) => contenedor.querySelector(s);
  let tab = "clientes";
  let clientes = null, cotizaciones = null, rutas = new Map();
  let ajustes = { ...AJUSTES_BASE };
  let editor = null;    // cotización en edición { ...datos, _nueva, _id }
  let fichaId = null;   // cliente abierto
  const fc = { q: "", vista: "todos" };       // filtros de Clientes
  const fq = { q: "", estado: "" };            // filtros de Cotizaciones

  function avisar(t) { const e = $("#co-exito"); e.textContent = t; e.classList.remove("oculto"); setTimeout(() => e.classList.add("oculto"), 6000); }
  function error(t) { $("#co-error").textContent = t || ""; }

  // ---- Lectura ----
  const cancelar = [];
  cancelar.push(onSnapshot(collection(db, COL_CLI), (s) => { clientes = new Map(s.docs.map(d => [d.id, { id: d.id, ...d.data() }])); render(); },
    (e) => error("No se pudieron leer los clientes: " + e.message)));
  const qCot = esAdmin ? collection(db, COL_COT) : query(collection(db, COL_COT), where("creadoPorUid", "==", uid));
  cancelar.push(onSnapshot(qCot, (s) => { cotizaciones = new Map(s.docs.map(d => [d.id, { id: d.id, ...d.data() }])); render(); },
    (e) => error("No se pudieron leer las cotizaciones: " + e.message)));
  cancelar.push(onSnapshot(collection(db, COL_RUT), (s) => { rutas = new Map(s.docs.map(d => [d.id, { id: d.id, ...d.data() }])); if (tab === "rutas") render(); }, () => {}));
  cancelar.push(onSnapshot(doc(db, COL_CFG, "ajustes"), (s) => { ajustes = { ...AJUSTES_BASE, ...(s.exists() ? s.data() : {}) }; if (tab === "ajustes") render(); }, () => {}));
  const vigilar = setInterval(() => { if (!contenedor.isConnected) { clearInterval(vigilar); cancelar.forEach(c => c()); } }, 3000);

  const listaCot = () => [...(cotizaciones || new Map()).values()].sort((a, b) => (b.emisionMs || 0) - (a.emisionMs || 0));
  const cotDeCliente = (id) => listaCot().filter(c => c.clienteId === id);
  const semaforo = (v) => v == null ? "co-s-n" : v >= ajustes.verde ? "co-s-v" : v >= ajustes.ambar ? "co-s-a" : "co-s-r";
  const chipEstado = (c) => { const e = estadoDe(c); return `<span class="co-chip ${ESTADOS[e].clase}">${ESTADOS[e].txt}</span>`; };
  const chipCarga = (t) => t ? `<span class="co-chip ${t === "seca" ? "co-seca" : "co-refri"}">${esc((CARGAS[t] || t).toUpperCase())}</span>` : "";

  function renderTabs() {
    const ts = [["clientes", "Clientes"], ["cotizaciones", "Cotizaciones"], ["rutas", "Rutas"], ...(esAdmin ? [["ajustes", "Ajustes"]] : [])];
    $("#co-tabs").innerHTML = ts.map(([k, t]) => `<button type="button" class="co-tab${tab === k && !editor && !fichaId ? " activo" : ""}" data-t="${k}">${t}</button>`).join("");
    $("#co-tabs").querySelectorAll("[data-t]").forEach(b => b.addEventListener("click", () => { tab = b.dataset.t; editor = null; fichaId = null; error(); render(); }));
  }
  function render() {
    renderTabs();
    if (!clientes || !cotizaciones) { $("#co-cuerpo").innerHTML = `<p class="nota">Cargando…</p>`; return; }
    if (editor) return renderEditor();
    if (fichaId) return renderFicha();
    if (tab === "cotizaciones") return renderCotizaciones();
    if (tab === "rutas") return renderRutas();
    if (tab === "ajustes" && esAdmin) return renderAjustes();
    return renderClientes();
  }
  $("#co-nueva").addEventListener("click", () => abrirEditor(null));

  // ============================================================================
  // Clientes
  // ============================================================================
  function renderClientes() {
    const ahora = Date.now(), q = normTxt(fc.q);
    const filas = [...clientes.values()].map(c => {
      const cs = cotDeCliente(c.id);
      const vig = cs.filter(x => ["borrador", "enviada", "aceptada"].includes(estadoDe(x, ahora)) && (x.vencimientoMs || 0) >= ahora);
      const porVencer = vig.filter(x => x.vencimientoMs - ahora <= 7 * DIA && estadoDe(x, ahora) !== "aceptada");
      return { c, cs, vig, porVencer, ultima: cs[0] || null };
    }).filter(r => (!q || normTxt(r.c.nombre).includes(q) || normTxt(r.c.rfc).includes(q)) &&
      (fc.vista === "todos" || (fc.vista === "vigente" ? r.vig.length > 0 : (!r.ultima || ahora - (r.ultima.emisionMs || 0) > 90 * DIA))))
      .sort((a, b) => (a.c.nombre || "").localeCompare(b.c.nombre || "", "es"));
    $("#co-cuerpo").innerHTML = `
      <div class="co-filtros">
        <input type="text" id="co-c-q" placeholder="Buscar cliente o RFC" value="${esc(fc.q)}">
        <span class="co-seg">${[["todos", "Todos"], ["vigente", "Con cotización vigente"], ["sin90", "Sin cotizar en 90 días"]].map(([k, t]) => `<button type="button" class="${fc.vista === k ? "activo" : ""}" data-v="${k}">${t}</button>`).join("")}</span>
        <button type="button" class="secundario" id="co-c-nuevo" style="margin-left:auto;">+ Cliente</button>
      </div>
      ${filas.length ? `<div class="tabla-wrap"><table class="tabla co-tabla">
        <thead><tr><th>Cliente</th><th>RFC</th><th>Contacto</th><th class="n">Cotizaciones</th><th>Última</th><th>Vigentes</th></tr></thead>
        <tbody>${filas.map(({ c, cs, vig, porVencer, ultima }) => { const k = (c.contactos || [])[0]; return `<tr class="clic" data-id="${esc(c.id)}">
          <td><b>${esc(c.nombre)}</b>${c.domicilio && (c.domicilio.municipio || c.domicilio.estado) ? `<br><small class="nota">${esc([c.domicilio.municipio, c.domicilio.estado].filter(Boolean).join(", "))}</small>` : ""}</td>
          <td>${esc(c.rfc || "—")}</td>
          <td>${k ? `${esc(k.nombre)}${k.puesto || k.telefono ? `<br><small class="nota">${esc([k.puesto, k.telefono].filter(Boolean).join(" · "))}</small>` : ""}` : "—"}</td>
          <td class="n">${cs.length}</td>
          <td>${ultima ? `${esc(ultima.folio)}<br><small class="nota">${fecha(ultima.emisionMs)}</small>` : "—"}</td>
          <td>${porVencer.length ? `<span class="co-chip co-ambar">${porVencer.length} VENCE${porVencer.length === 1 ? "" : "N"} EN 7 DÍAS</span>` : vig.length ? `<span class="co-chip co-verde">${vig.length} VIGENTE${vig.length === 1 ? "" : "S"}</span>` : `<span class="co-chip co-gris">NINGUNA</span>`}</td></tr>`; }).join("")}</tbody>
      </table></div>` : `<p class="nota" style="text-align:center;padding:18px;">${clientes.size ? "No hay clientes con este filtro." : "Todavía no hay clientes. Agrega el primero con “+ Cliente”."}</p>`}`;
    const qi = $("#co-c-q");
    qi.addEventListener("input", () => { fc.q = qi.value; const p = qi.selectionStart; renderClientes(); const n = $("#co-c-q"); n.focus(); n.setSelectionRange(p, p); });
    $("#co-cuerpo").querySelectorAll("[data-v]").forEach(b => b.addEventListener("click", () => { fc.vista = b.dataset.v; renderClientes(); }));
    $("#co-c-nuevo").addEventListener("click", () => abrirCliente(null));
    $("#co-cuerpo").querySelectorAll("tr.clic").forEach(tr => tr.addEventListener("click", () => { fichaId = tr.dataset.id; render(); }));
  }

  // Alta / edición de cliente (estructura del CRM viejo + varios contactos).
  function abrirCliente(id) {
    const c = id ? clientes.get(id) : { tipo: "moral", contactos: [{}], domicilio: {} };
    if (!c) return;
    const dom = c.domicilio || {};
    const contactos = (c.contactos && c.contactos.length ? c.contactos : [{}]).map(x => ({ ...x }));
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    const filaContacto = (k, i) => `<div class="co-contacto" data-i="${i}">
        <input type="text" data-k="nombre" placeholder="Nombre" value="${esc(k.nombre || "")}">
        <input type="text" data-k="puesto" placeholder="Puesto" value="${esc(k.puesto || "")}">
        <input type="tel" data-k="telefono" placeholder="Teléfono" value="${esc(k.telefono || "")}">
        <input type="email" data-k="correo" placeholder="Correo" value="${esc(k.correo || "")}">
        <button type="button" class="secundario co-mini" data-quitar="${i}" title="Quitar">✕</button></div>`;
    ov.innerHTML = `<div class="modal-tarjeta" style="max-width:820px;width:100%;max-height:90vh;overflow:auto;">
      <h2 style="margin:0 0 12px;">${id ? "Editar cliente" : "Nuevo cliente"}</h2>
      <div class="co-grid">
        <div style="grid-column:1/-1;"><label>Razón social / nombre</label><input type="text" id="cl-nombre" value="${esc(c.nombre || "")}"></div>
        <div><label>Tipo</label><select id="cl-tipo"><option value="moral"${c.tipo !== "fisica" ? " selected" : ""}>Persona moral</option><option value="fisica"${c.tipo === "fisica" ? " selected" : ""}>Persona física</option></select></div>
        <div><label>RFC</label><input type="text" id="cl-rfc" value="${esc(c.rfc || "")}" maxlength="13" style="text-transform:uppercase;"></div>
        <div><label>Régimen / capital</label><input type="text" id="cl-regimen" value="${esc(c.regimenCapital || "")}"></div>
        <div><label>Actividad</label><input type="text" id="cl-actividad" value="${esc(c.actividad || "")}"></div>
        <div><label>Sitio web</label><input type="text" id="cl-web" value="${esc(c.sitioWeb || "")}"></div>
      </div>
      <div class="co-h3">Domicilio</div>
      <div class="co-grid">
        <div><label>Calle y número</label><input type="text" id="cl-calle" value="${esc(dom.calle || "")}"></div>
        <div><label>Colonia</label><input type="text" id="cl-colonia" value="${esc(dom.colonia || "")}"></div>
        <div><label>Municipio</label><input type="text" id="cl-municipio" value="${esc(dom.municipio || "")}"></div>
        <div><label>Estado</label><input type="text" id="cl-estado" value="${esc(dom.estado || "")}"></div>
        <div><label>CP</label><input type="text" id="cl-cp" value="${esc(dom.cp || "")}" maxlength="5"></div>
      </div>
      <div class="co-h3">Contactos</div>
      <div id="cl-contactos">${contactos.map(filaContacto).join("")}</div>
      <button type="button" class="secundario co-mini" id="cl-mas">+ Contacto</button>
      <div class="co-campo" style="margin-top:12px;"><label>Notas internas</label><textarea id="cl-notas" rows="2">${esc(c.notas || "")}</textarea></div>
      <div class="error" id="cl-err"></div>
      <div class="modal-acciones">${id && esAdmin ? `<button type="button" class="secundario" id="cl-borrar">Borrar</button>` : ""}
        <button type="button" class="secundario" data-cerrar>Cancelar</button><button type="button" id="cl-guardar">Guardar</button></div></div>`;
    document.body.appendChild(ov);
    const cerrar = () => ov.remove();
    ov.querySelectorAll("[data-cerrar]").forEach(b => b.addEventListener("click", cerrar));
    const leerContactos = () => [...ov.querySelectorAll(".co-contacto")].map(f => Object.fromEntries([...f.querySelectorAll("[data-k]")].map(i => [i.dataset.k, i.value.trim()])));
    const enlazarQuitar = () => ov.querySelectorAll("[data-quitar]").forEach(b => b.onclick = () => {
      const ks = leerContactos(); ks.splice(Number(b.dataset.quitar), 1);
      ov.querySelector("#cl-contactos").innerHTML = (ks.length ? ks : [{}]).map(filaContacto).join(""); enlazarQuitar();
    });
    enlazarQuitar();
    ov.querySelector("#cl-mas").addEventListener("click", () => {
      const ks = leerContactos(); ks.push({});
      ov.querySelector("#cl-contactos").innerHTML = ks.map(filaContacto).join(""); enlazarQuitar();
    });
    const v = (s) => ov.querySelector(s).value.trim();
    ov.querySelector("#cl-guardar").addEventListener("click", async () => {
      const nombre = v("#cl-nombre");
      const err = ov.querySelector("#cl-err");
      if (!nombre) { err.textContent = "Escribe la razón social."; return; }
      const rfc = v("#cl-rfc").toUpperCase();
      if (rfc && !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) { err.textContent = "El RFC no tiene el formato correcto (12 o 13 caracteres)."; return; }
      const repetido = rfc && [...clientes.values()].find(x => x.rfc === rfc && x.id !== id);
      if (repetido) { err.textContent = `Ese RFC ya es de ${repetido.nombre}.`; return; }
      const datos = {
        nombre, tipo: v("#cl-tipo"), rfc: rfc || null, regimenCapital: v("#cl-regimen") || null, actividad: v("#cl-actividad") || null, sitioWeb: v("#cl-web") || null,
        domicilio: { calle: v("#cl-calle") || null, colonia: v("#cl-colonia") || null, municipio: v("#cl-municipio") || null, estado: v("#cl-estado") || null, cp: v("#cl-cp") || null },
        contactos: leerContactos().filter(k => k.nombre || k.telefono || k.correo),
        notas: v("#cl-notas") || null,
        actualizadoMs: Date.now(), actualizadoPor: { uid, nombre: yo.nombre },
      };
      try {
        if (id) await updateDoc(doc(db, COL_CLI, id), datos);
        else {
          const ref = doc(collection(db, COL_CLI)); await setDoc(ref, { ...datos, creadoMs: Date.now(), creadoPor: { uid, nombre: yo.nombre } });
          if (editor) { editor.clienteId = ref.id; editor.contacto = null; } else fichaId = ref.id; // desde la cotización: queda elegido
        }
        cerrar(); avisar(`Cliente ${nombre} guardado.`); render();
      } catch (e) { err.textContent = "No se pudo guardar: " + e.message; }
    });
    const b = ov.querySelector("#cl-borrar");
    if (b) b.addEventListener("click", async () => {
      if (cotDeCliente(id).length) { ov.querySelector("#cl-err").textContent = "Tiene cotizaciones; no se puede borrar."; return; }
      if (!confirm(`¿Borrar el cliente ${c.nombre}?`)) return;
      try { await deleteDoc(doc(db, COL_CLI, id)); fichaId = null; cerrar(); render(); } catch (e) { ov.querySelector("#cl-err").textContent = e.message; }
    });
  }

  // ---- Ficha del cliente ----
  function tablaCotizaciones(cs, conCliente) {
    if (!cs.length) return `<p class="nota" style="text-align:center;padding:14px;">Sin cotizaciones.</p>`;
    return `<div class="tabla-wrap"><table class="tabla co-tabla">
      <thead><tr><th>Folio</th><th>Fecha</th>${conCliente ? "<th>Cliente</th>" : ""}<th>Rutas</th><th>Carga</th><th class="n">Km</th><th class="n">Importe</th><th class="n">Ing./km MXN</th><th>Vigencia</th><th>Estado</th><th></th></tr></thead>
      <tbody>${cs.map(c => {
        const rs = c.rutas || [];
        const lineas = (f) => rs.map(f).join("<br>");
        return `<tr class="clic" data-cot="${esc(c.id)}">
          <td><b>${esc(c.folio)}</b>${esAdmin && c.creadoPorUid !== uid ? `<br><small class="nota">${esc((c.creadoPor || {}).nombre || "")}</small>` : ""}</td>
          <td>${fecha(c.emisionMs)}</td>
          ${conCliente ? `<td>${esc(c.clienteNombre)}</td>` : ""}
          <td>${lineas(r => `${esc(r.origen)} → ${esc(r.destino)}`)}${rs.length > 1 ? `<br><small class="nota">${rs.length} rutas</small>` : ""}</td>
          <td>${chipCarga(c.tipoCarga)}</td>
          <td class="n">${lineas(r => miles(r.km))}</td>
          <td class="n">${lineas(r => `${dinero(num(r.importe), c.moneda)} ${esc(c.moneda)}`)}</td>
          <td class="n">${lineas(r => { const v = ingresoKm(r, c.moneda, c.tipoCambio); return `<span class="co-sem ${semaforo(v)}"></span><b>${v == null ? "—" : dinero(v)}</b>`; })}</td>
          <td>${estadoDe(c) === "vencida" ? `venció ${fecha(c.vencimientoMs)}` : `hasta ${fecha(c.vencimientoMs)}`}</td>
          <td>${chipEstado(c)}</td>
          <td style="white-space:nowrap;"><button type="button" class="co-link" data-pdf="${esc(c.id)}">PDF</button> · <button type="button" class="co-link" data-dup="${esc(c.id)}">Duplicar</button></td></tr>`;
      }).join("")}</tbody></table></div>`;
  }
  function enlazarTablaCot() {
    $("#co-cuerpo").querySelectorAll("[data-pdf]").forEach(b => b.addEventListener("click", (e) => { e.stopPropagation(); pdfDe(b.dataset.pdf); }));
    $("#co-cuerpo").querySelectorAll("[data-dup]").forEach(b => b.addEventListener("click", (e) => { e.stopPropagation(); duplicar(b.dataset.dup); }));
    $("#co-cuerpo").querySelectorAll("tr[data-cot]").forEach(tr => tr.addEventListener("click", () => abrirEditor(tr.dataset.cot)));
  }
  function renderFicha() {
    const c = clientes.get(fichaId);
    if (!c) { fichaId = null; return render(); }
    const cs = cotDeCliente(c.id), ahora = Date.now();
    const vig = cs.filter(x => ["borrador", "enviada", "aceptada"].includes(estadoDe(x, ahora)) && (x.vencimientoMs || 0) >= ahora).length;
    const ings = cs.flatMap(x => (x.rutas || []).map(r => ingresoKm(r, x.moneda, x.tipoCambio))).filter(v => v != null);
    const dom = c.domicilio || {};
    $("#co-cuerpo").innerHTML = `
      <button type="button" class="co-link" id="co-f-volver">‹ Clientes</button>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;margin-top:8px;">
        <div><h2 style="margin:0;">${esc(c.nombre)}</h2><div class="nota" style="margin:3px 0 0;">${esc([c.rfc, c.tipo === "fisica" ? "Persona física" : "Persona moral"].filter(Boolean).join(" · "))}</div></div>
        <div style="display:flex;gap:6px;"><button type="button" class="secundario" id="co-f-editar">Editar</button><button type="button" id="co-f-cotizar">+ Cotizar a este cliente</button></div>
      </div>
      <div class="co-kpis">
        <div class="co-kpi"><b>${cs.length}</b><small>Cotizaciones</small></div>
        <div class="co-kpi"><b>${vig}</b><small>Vigentes</small></div>
        <div class="co-kpi"><b>${cs.filter(x => x.estado === "aceptada").length}</b><small>Aceptadas</small></div>
        <div class="co-kpi"><b>${ings.length ? dinero(ings.reduce((s, v) => s + v, 0) / ings.length) : "—"}</b><small>Ing./km promedio cotizado</small></div>
      </div>
      <div class="co-grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));">
        <div><div class="co-h3" style="margin-top:0;">Datos</div><div class="co-campos">
          <span>Domicilio</span><div>${esc([dom.calle, dom.colonia, dom.municipio, dom.estado, dom.cp ? "CP " + dom.cp : ""].filter(Boolean).join(", ") || "—")}</div>
          <span>Régimen</span><div>${esc(c.regimenCapital || "—")}</div>
          <span>Actividad</span><div>${esc(c.actividad || "—")}</div>
          ${c.sitioWeb ? `<span>Sitio web</span><div>${esc(c.sitioWeb)}</div>` : ""}
          <span>Notas</span><div>${esc(c.notas || "—")}</div></div></div>
        <div><div class="co-h3" style="margin-top:0;">Contactos</div><div class="co-campos">
          ${(c.contactos || []).map(k => `<span>${esc(k.nombre || "—")}</span><div>${esc([k.puesto, k.telefono, k.correo].filter(Boolean).join(" · ") || "—")}</div>`).join("") || "<span>—</span><div></div>"}</div></div>
      </div>
      <div class="co-h3">Historial de cotizaciones</div>
      ${tablaCotizaciones(cs, false)}
      <p class="nota">Toca una cotización para verla, cambiar su estado o agregarle rutas dentro de su vigencia. "Duplicar" crea una nueva con lo mismo (para renovar una vencida).</p>`;
    $("#co-f-volver").addEventListener("click", () => { fichaId = null; tab = "clientes"; render(); });
    $("#co-f-editar").addEventListener("click", () => abrirCliente(c.id));
    $("#co-f-cotizar").addEventListener("click", () => abrirEditor(null, c.id));
    enlazarTablaCot();
  }

  // ============================================================================
  // Cotizaciones
  // ============================================================================
  function renderCotizaciones() {
    const ahora = Date.now(), q = normTxt(fq.q);
    const todas = listaCot();
    const cs = todas.filter(c => (!fq.estado || estadoDe(c, ahora) === fq.estado) &&
      (!q || normTxt(c.folio).includes(q) || normTxt(c.clienteNombre).includes(q) || (c.rutas || []).some(r => normTxt(r.origen + " " + r.destino).includes(q))));
    const porVencer = todas.filter(c => ["borrador", "enviada"].includes(estadoDe(c, ahora)) && c.vencimientoMs - ahora <= 7 * DIA);
    const cuenta = (e) => todas.filter(c => estadoDe(c, ahora) === e).length;
    $("#co-cuerpo").innerHTML = `
      ${porVencer.length ? `<div class="co-indicador" style="margin-bottom:12px;"><b>Vencen en los próximos 7 días:</b> ${porVencer.map(c => `<button type="button" class="co-link" data-abrir="${esc(c.id)}">${esc(c.folio)}</button> <small class="nota">${esc(c.clienteNombre)} · ${fecha(c.vencimientoMs)}</small>`).join(" · ")}</div>` : ""}
      <div class="co-filtros">
        <input type="text" id="co-q-q" placeholder="Buscar folio, cliente o ruta" value="${esc(fq.q)}">
        <span class="co-seg"><button type="button" class="${!fq.estado ? "activo" : ""}" data-e="">Todas ${todas.length}</button>${Object.entries(ESTADOS).map(([k, v]) => `<button type="button" class="${fq.estado === k ? "activo" : ""}" data-e="${k}">${v.txt.charAt(0) + v.txt.slice(1).toLowerCase()} ${cuenta(k)}</button>`).join("")}</span>
      </div>
      ${tablaCotizaciones(cs, true)}`;
    const qi = $("#co-q-q");
    qi.addEventListener("input", () => { fq.q = qi.value; const p = qi.selectionStart; renderCotizaciones(); const n = $("#co-q-q"); n.focus(); n.setSelectionRange(p, p); });
    $("#co-cuerpo").querySelectorAll("[data-e]").forEach(b => b.addEventListener("click", () => { fq.estado = b.dataset.e; renderCotizaciones(); }));
    $("#co-cuerpo").querySelectorAll("[data-abrir]").forEach(b => b.addEventListener("click", () => abrirEditor(b.dataset.abrir)));
    enlazarTablaCot();
  }

  function abrirEditor(id, clienteId) {
    error();
    if (id) {
      const c = cotizaciones.get(id);
      if (!c) return;
      editor = JSON.parse(JSON.stringify(c));
      editor._id = id;
      editor.rutas = (editor.rutas || []).map(r => ({ ...r }));
    } else {
      editor = {
        _nueva: true, clienteId: clienteId || "", contacto: null, moneda: "MXN", tipoCambio: ajustes.tipoCambio,
        vigenciaDias: ajustes.vigenciaDias, tipoCarga: "refrigerada", tipoServicio: "nacional", estado: "borrador",
        rutas: [{ origen: "", destino: "", km: "", importe: "" }], notas: "",
      };
    }
    render();
  }
  function duplicar(id) {
    const c = cotizaciones.get(id);
    if (!c) return;
    abrirEditor(null, c.clienteId);
    Object.assign(editor, {
      contacto: c.contacto || null, moneda: c.moneda, tipoCambio: c.moneda === "USD" ? ajustes.tipoCambio : c.tipoCambio,
      vigenciaDias: c.vigenciaDias, tipoCarga: c.tipoCarga, tipoServicio: c.tipoServicio, notas: c.notas || "",
      rutas: (c.rutas || []).map(r => ({ origen: r.origen, destino: r.destino, km: r.km, importe: r.importe, origenCoord: r.origenCoord || undefined, destinoCoord: r.destinoCoord || undefined, vias: r.vias || undefined, kmOrs: r.kmOrs || undefined })),
    });
    avisar(`Copia de ${c.folio}: revisa y guarda para darle folio nuevo.`);
    render();
  }

  // Catálogo de rutas: buscar por origen + destino.
  const claveRuta = (o, d) => `${normTxt(o)}|${normTxt(d)}`;
  function rutaDelCatalogo(o, d) { const k = claveRuta(o, d); return [...rutas.values()].find(r => claveRuta(r.origen, r.destino) === k) || null; }

  function renderEditor() {
    const e = editor;
    const original = e._id ? cotizaciones.get(e._id) : null;
    const puedeEditar = !original || esAdmin || original.creadoPorUid === uid;
    const vigente = !original || estadoDe(original) !== "vencida";
    const bloqueada = !!original; // ya guardada: solo se agregan rutas y se cambia estado/notas
    const cli = clientes.get(e.clienteId);
    const lugares = [...new Set([...rutas.values()].flatMap(r => [r.origen, r.destino]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    const seg = (campo, opciones, deshab) => `<span class="co-seg">${opciones.map(([v, t]) => `<button type="button" class="${String(e[campo]) === String(v) ? "activo" : ""}" data-campo="${campo}" data-valor="${v}"${deshab ? " disabled" : ""}>${t}</button>`).join("")}</span>`;
    const vigOpc = [[15, "15 días"], [30, "30 días"], [60, "60 días"], [90, "90 días"]];
    if (!vigOpc.some(([v]) => v === Number(e.vigenciaDias))) vigOpc.push([e.vigenciaDias, `${e.vigenciaDias} días`]);
    $("#co-cuerpo").innerHTML = `
      <button type="button" class="co-link" id="co-e-volver">‹ Volver</button>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;margin-top:8px;">
        <h2 style="margin:0;">${original ? esc(original.folio) : "Nueva cotización"} ${original ? chipEstado(original) : `<span class="nota" style="font-weight:400;font-size:13px;">· el folio se asigna al guardar</span>`}</h2>
        ${original ? `<span class="nota">Emitida ${fecha(original.emisionMs)} · vence ${fecha(original.vencimientoMs)} · por ${esc((original.creadoPor || {}).nombre || "")}</span>` : ""}
      </div>
      <div class="co-grid" style="margin-top:14px;">
        <div><label>Cliente</label><select id="co-e-cli"${bloqueada ? " disabled" : ""}><option value="">Elige un cliente…</option>${[...clientes.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")).map(c => `<option value="${esc(c.id)}"${c.id === e.clienteId ? " selected" : ""}>${esc(c.nombre)}</option>`).join("")}</select>
          ${bloqueada ? "" : `<button type="button" class="co-link" id="co-e-cli-nuevo" style="font-size:12px;margin-top:4px;">+ Cliente nuevo</button>`}</div>
        <div><label>Contacto (sale en el PDF)</label><select id="co-e-cont"><option value="">Sin contacto</option>${((cli && cli.contactos) || []).map((k, i) => `<option value="${i}"${e.contacto && e.contacto.nombre === k.nombre ? " selected" : ""}>${esc(k.nombre)}${k.puesto ? " · " + esc(k.puesto) : ""}</option>`).join("")}</select></div>
        <div><label>Moneda</label>${seg("moneda", [["MXN", "MXN"], ["USD", "USD"]], bloqueada)}
          ${e.moneda === "USD" ? `<div style="margin-top:6px;display:flex;gap:6px;align-items:center;"><small class="nota">TC para ing./km</small><input type="number" step="0.01" id="co-e-tc" value="${esc(e.tipoCambio)}" style="width:90px;"${bloqueada ? " disabled" : ""}></div>` : ""}</div>
        <div><label>Vigencia</label>${seg("vigenciaDias", vigOpc, bloqueada)}</div>
        <div><label>Tipo de carga</label>${seg("tipoCarga", Object.entries(CARGAS), bloqueada)}</div>
        <div><label>Servicio</label>${seg("tipoServicio", Object.entries(SERVICIOS), bloqueada)}</div>
      </div>
      <div class="co-h3">Rutas</div>
      ${ajustes.orsKey ? "" : `<datalist id="co-lugares">${lugares.map(l => `<option value="${esc(l)}">`).join("")}</datalist>`}
      <div class="tabla-wrap"><table class="tabla co-tabla co-rutas">
        <thead><tr><th style="min-width:170px;">Origen</th><th style="min-width:170px;">Destino</th><th class="n" style="width:90px;">Km</th><th class="n" style="width:130px;">Importe (${esc(e.moneda)})</th><th class="n">Ing./km MXN</th><th></th></tr></thead>
        <tbody>${e.rutas.map((r, i) => {
          const fija = bloqueada && r.agregadaMs && original && (original.rutas || []).some(x => x.agregadaMs === r.agregadaMs && x.origen === r.origen && x.destino === r.destino);
          const dis = fija ? " disabled" : "";
          const v = ingresoKm(r, e.moneda, e.tipoCambio);
          const cat = r.origen && r.destino ? rutaDelCatalogo(r.origen, r.destino) : null;
          return `<tr data-i="${i}">
            <td><div class="co-ac"><input type="text" list="co-lugares" data-r="origen" value="${esc(r.origen)}"${dis} placeholder="${ajustes.orsKey ? "Escribe la ciudad…" : "Ciudad, estado"}" autocomplete="off"></div>
              ${(r.vias || []).length ? `<small class="nota">vía ${esc(r.vias.map(v => v.label.split(",")[0]).join(", "))}</small>` : ""}</td>
            <td><div class="co-ac"><input type="text" list="co-lugares" data-r="destino" value="${esc(r.destino)}"${dis} placeholder="${ajustes.orsKey ? "Escribe la ciudad…" : "Ciudad, estado"}" autocomplete="off"></div>
              ${fija ? "" : `<small class="nota" data-hint="${i}">${r.origen && r.destino ? (cat ? "del catálogo" : "ruta nueva · se agrega al catálogo") : ""}</small>`}
              <button type="button" class="co-link" data-mapa="${i}" style="font-size:12px;${r.origenCoord && r.destinoCoord ? "" : "display:none;"}">Ver ruta</button>
              ${fija && r.agregadaMs - (original.emisionMs || 0) > DIA / 2 ? `<br><small class="nota">agregada ${fecha(r.agregadaMs)}</small>` : ""}</td>
            <td class="n"><input type="number" min="1" data-r="km" value="${esc(r.km)}"${dis}><br><small class="nota" data-tipo="${i}">${tipoRutaTxt(num(r.km))}</small></td>
            <td class="n"><input type="number" min="0" step="0.01" data-r="importe" value="${esc(r.importe)}"${dis}></td>
            <td class="n" data-ing="${i}"><span class="co-sem ${semaforo(v)}"></span><b>${v == null ? "—" : dinero(v)}</b></td>
            <td>${fija ? "" : `<button type="button" class="secundario co-mini" data-qr="${i}" title="Quitar ruta">✕</button>`}</td></tr>`;
        }).join("")}</tbody></table></div>
      ${puedeEditar && vigente ? `<button type="button" class="secundario co-mini" id="co-e-mas" style="margin-top:8px;">+ Agregar ruta</button>` : ""}
      ${bloqueada && vigente ? `<p class="nota">Ya tiene folio: las rutas guardadas no cambian; puedes agregar rutas nuevas mientras siga vigente (salen en el PDF con su fecha). Para cambiar importes, usa "Duplicar".</p>` : ""}
      <div class="co-grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));margin-top:14px;">
        <div class="co-campo"><label>Notas para el cliente (salen en el PDF)</label><textarea id="co-e-notas" rows="3">${esc(e.notas || "")}</textarea></div>
        <div class="co-indicador"><div class="nota" style="margin:0;">Semáforo de ingreso por km (MXN)</div>
          <div style="margin-top:6px;"><span class="co-sem co-s-v"></span>${ajustes.verde} o más · <span class="co-sem co-s-a"></span>${ajustes.ambar} a ${(ajustes.verde - 0.01).toFixed(2)} · <span class="co-sem co-s-r"></span>menos de ${ajustes.ambar}</div>
          ${e.moneda === "USD" ? `<div class="nota" style="margin:6px 0 0;">En USD se pasa a MXN con el tipo de cambio de esta cotización.</div>` : ""}
          ${original ? `<div style="margin-top:10px;"><label>Estado</label><span class="co-seg">${["borrador", "enviada", "aceptada", "rechazada"].map(k => `<button type="button" class="${e.estado === k ? "activo" : ""}" data-estado="${k}"${puedeEditar ? "" : " disabled"}>${ESTADOS[k].txt.charAt(0) + ESTADOS[k].txt.slice(1).toLowerCase()}</button>`).join("")}</span>
            ${estadoDe(original) === "vencida" ? `<div class="nota" style="margin:6px 0 0;">Vencida por fecha. Usa "Duplicar" para renovarla con folio nuevo.</div>` : ""}</div>` : ""}
        </div>
      </div>
      <div class="error" id="co-e-err"></div>
      <div class="co-acciones">
        ${original ? `<button type="button" class="secundario" id="co-e-dup">Duplicar</button><button type="button" class="secundario" id="co-e-pdf">PDF</button>` : ""}
        ${puedeEditar ? `<button type="button" class="secundario" id="co-e-guardar">${original ? "Guardar cambios" : "Guardar borrador"}</button><button type="button" id="co-e-guardar-pdf">Guardar y ver PDF</button>` : ""}
      </div>`;
    enlazarEditor(original, bloqueada);
  }

  function enlazarEditor(original, bloqueada) {
    const e = editor;
    $("#co-e-volver").addEventListener("click", () => { editor = null; render(); });
    const cliSel = $("#co-e-cli");
    cliSel.addEventListener("change", () => { e.clienteId = cliSel.value; e.contacto = null; renderEditor(); });
    const cn = $("#co-e-cli-nuevo"); if (cn) cn.addEventListener("click", () => abrirCliente(null));
    $("#co-e-cont").addEventListener("change", (ev) => {
      const cli = clientes.get(e.clienteId); const k = cli && (cli.contactos || [])[Number(ev.target.value)];
      e.contacto = ev.target.value === "" || !k ? null : { nombre: k.nombre || "", puesto: k.puesto || "", correo: k.correo || "" };
    });
    $("#co-cuerpo").querySelectorAll("[data-campo]").forEach(b => b.addEventListener("click", () => {
      const c = b.dataset.campo; e[c] = c === "vigenciaDias" ? Number(b.dataset.valor) : b.dataset.valor; leerFormulario(); renderEditor();
    }));
    const tc = $("#co-e-tc"); if (tc) tc.addEventListener("input", () => { e.tipoCambio = num(tc.value); pintarIngresos(); });
    $("#co-cuerpo").querySelectorAll("tr[data-i] input").forEach(inp => inp.addEventListener("input", () => {
      const i = Number(inp.closest("tr").dataset.i), r = e.rutas[i];
      r[inp.dataset.r] = inp.value;
      if (inp.dataset.r === "origen" || inp.dataset.r === "destino") {
        delete r[inp.dataset.r + "Coord"]; geo.delete(r); // escrito a mano: ya no es el punto de ORS
        if (r.origen && r.destino) desdeCatalogo(r, i);
      }
      pintarIngresos();
    }));
    $("#co-cuerpo").querySelectorAll("tr[data-i] [data-r=origen]:not([disabled]), tr[data-i] [data-r=destino]:not([disabled])").forEach(inp => {
      if (!ajustes.orsKey) return;
      autocompletar(inp, (op) => {
        const i = Number(inp.closest("tr").dataset.i), r = e.rutas[i];
        r[inp.dataset.r] = op.label; r[inp.dataset.r + "Coord"] = { lng: op.lng, lat: op.lat };
        const cat = (r.origen && r.destino) ? rutaDelCatalogo(r.origen, r.destino) : null;
        if (cat) desdeCatalogo(r, i);
        // Se le pregunta a ORS salvo que el catálogo ya tenga sus km de ORS (ahorra cuota).
        if (r.origenCoord && r.destinoCoord && !(cat && cat.kmOrs)) calcularRuta(r, i);
      });
    });
    $("#co-cuerpo").querySelectorAll("[data-mapa]").forEach(b => b.addEventListener("click", () => abrirMapa(Number(b.dataset.mapa), !!original && !puedeEditarRuta(Number(b.dataset.mapa), original))));
    $("#co-cuerpo").querySelectorAll("[data-qr]").forEach(b => b.addEventListener("click", () => {
      leerFormulario(); e.rutas.splice(Number(b.dataset.qr), 1);
      if (!e.rutas.length) e.rutas.push({ origen: "", destino: "", km: "", importe: "" });
      renderEditor();
    }));
    const mas = $("#co-e-mas"); if (mas) mas.addEventListener("click", () => { leerFormulario(); e.rutas.push({ origen: "", destino: "", km: "", importe: "" }); renderEditor(); });
    $("#co-cuerpo").querySelectorAll("[data-estado]").forEach(b => b.addEventListener("click", () => { leerFormulario(); e.estado = b.dataset.estado; renderEditor(); }));
    const g = $("#co-e-guardar"); if (g) g.addEventListener("click", () => guardarCotizacion(false));
    const gp = $("#co-e-guardar-pdf"); if (gp) gp.addEventListener("click", () => guardarCotizacion(true));
    const p = $("#co-e-pdf"); if (p) p.addEventListener("click", () => pdfDe(original.id));
    const d = $("#co-e-dup"); if (d) d.addEventListener("click", () => duplicar(original.id));
  }
  // ---- Km: catálogo, ORS y mapa ----
  const geo = new WeakMap(); // ruta del editor → trazo [[lat, lng]] (solo en memoria)
  function puedeEditarRuta(i, original) {
    const r = editor.rutas[i];
    return !(original && r.agregadaMs && (original.rutas || []).some(x => x.agregadaMs === r.agregadaMs && x.origen === r.origen && x.destino === r.destino));
  }
  function hint(i, t) { const h = $(`[data-hint="${i}"]`); if (h) h.textContent = t; }
  // Catálogo y ORS no coinciden: muestra los dos y un botón para usar el de ORS.
  function hintComparar(i, r, kmCat) {
    const h = $(`[data-hint="${i}"]`); if (!h) return;
    h.innerHTML = `Catálogo ${miles(kmCat)} km · ORS ${miles(r.kmOrs)} km <button type="button" class="co-link" style="font-size:12px;">usar ${miles(r.kmOrs)}</button>`;
    h.querySelector("button").addEventListener("click", () => { r.km = r.kmOrs; pintarFila(i); hint(i, `${miles(r.kmOrs)} km por ORS (camión)`); });
  }
  function pintarFila(i) {
    const r = editor.rutas[i], tr = $(`tr[data-i="${i}"]`);
    if (!tr) return;
    const km = tr.querySelector('[data-r="km"]'); if (km && !km.disabled) km.value = r.km == null ? "" : r.km;
    const b = tr.querySelector("[data-mapa]"); if (b) b.style.display = r.origenCoord && r.destinoCoord ? "" : "none";
    pintarIngresos();
  }
  // Si la ruta (mismo origen y destino) ya está en el catálogo: sus km, puntos y vías.
  function desdeCatalogo(r, i) {
    const cat = rutaDelCatalogo(r.origen, r.destino);
    if (!cat) return false;
    if (cat.km && !num(r.km)) r.km = cat.km;
    if (cat.origenCoord && !r.origenCoord) r.origenCoord = cat.origenCoord;
    if (cat.destinoCoord && !r.destinoCoord) r.destinoCoord = cat.destinoCoord;
    if (cat.vias && !r.vias) r.vias = cat.vias;
    pintarFila(i);
    hint(i, `del catálogo${(cat.vias || []).length ? " · vía " + cat.vias.map(v => v.label.split(",")[0]).join(", ") : ""}`);
    return true;
  }
  async function calcularRuta(r, i) {
    if (!ajustes.orsKey || !r.origenCoord || !r.destinoCoord) return null;
    hint(i, "Calculando ruta de camión…");
    try {
      const res = await orsRuta([r.origenCoord, ...(r.vias || []), r.destinoCoord], ajustes.orsKey);
      geo.set(r, res.linea);
      r.kmOrs = res.km;
      const cat = rutaDelCatalogo(r.origen, r.destino);
      if (cat && cat.km && !(r.vias || []).length) {
        r.km = cat.km;
        if (cat.km !== res.km) hintComparar(i, r, cat.km); else hint(i, "del catálogo · igual a ORS");
      } else {
        r.km = res.km;
        hint(i, `${cat ? "Con vías" : "Ruta nueva"} · ${miles(res.km)} km por ORS (camión)`);
      }
      pintarFila(i);
      return res;
    } catch (x) { hint(i, x.message || "No se pudo calcular la ruta."); return null; }
  }
  // Lista de sugerencias de ORS debajo de un campo (sin redibujar la pantalla).
  function autocompletar(inp, alElegir) {
    let lista = null, timer = null, ops = [], sel = -1;
    const cerrar = () => { if (lista) { lista.remove(); lista = null; } sel = -1; };
    // La lista flota sobre la página (position:fixed en <body>): la tabla de rutas tiene su
    // propio desplazamiento y la recortaba.
    const ubicar = () => {
      if (!lista) return;
      const b = inp.getBoundingClientRect();
      lista.style.left = b.left + "px"; lista.style.width = Math.max(b.width, 260) + "px";
      const abajo = window.innerHeight - b.bottom;
      if (abajo < 200 && b.top > abajo) { lista.style.top = ""; lista.style.bottom = (window.innerHeight - b.top) + "px"; }
      else { lista.style.bottom = ""; lista.style.top = b.bottom + "px"; }
    };
    window.addEventListener("scroll", ubicar, true);
    window.addEventListener("resize", ubicar);
    const pintar = () => {
      if (!ops.length) return cerrar();
      if (!lista) { lista = document.createElement("div"); lista.className = "co-ac-lista"; document.body.appendChild(lista); }
      ubicar();
      lista.innerHTML = ops.map((o, k) => `<div data-k="${k}" class="${k === sel ? "activo" : ""}">${esc(o.label)}</div>`).join("");
      lista.querySelectorAll("[data-k]").forEach(d => d.addEventListener("mousedown", (ev) => { ev.preventDefault(); elegir(Number(d.dataset.k)); }));
    };
    const elegir = (k) => { const o = ops[k]; if (!o) return; inp.value = o.label; cerrar(); alElegir(o); };
    inp.addEventListener("input", () => {
      clearTimeout(timer);
      const t = inp.value.trim();
      if (t.length < 3) { ops = []; return cerrar(); }
      timer = setTimeout(async () => {
        try { ops = await orsBuscar(t, ajustes.orsKey); sel = -1; if (document.activeElement === inp) pintar(); }
        catch (x) { ops = []; cerrar(); error(x.message); }
      }, 350);
    });
    inp.addEventListener("keydown", (ev) => {
      if (!lista) return;
      if (ev.key === "ArrowDown") { sel = Math.min(sel + 1, ops.length - 1); pintar(); ev.preventDefault(); }
      else if (ev.key === "ArrowUp") { sel = Math.max(sel - 1, 0); pintar(); ev.preventDefault(); }
      else if (ev.key === "Enter" && sel >= 0) { elegir(sel); ev.preventDefault(); }
      else if (ev.key === "Escape") cerrar();
    });
    inp.addEventListener("blur", () => setTimeout(cerrar, 150));
  }
  // Mapa de la ruta: trazo, puntos vía y "Guardar en catálogo".
  async function abrirMapa(i, soloVer) {
    const r = editor.rutas[i];
    if (!r || !r.origenCoord || !r.destinoCoord) return;
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML = `<div class="modal-tarjeta" style="max-width:760px;width:100%;max-height:92vh;overflow:auto;">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;"><h2 style="margin:0;font-size:16px;" id="mp-titulo"></h2><button type="button" class="secundario co-mini" data-cerrar>✕</button></div>
      <div class="co-mapa" id="mp-mapa" style="margin-top:10px;"><p class="nota" style="padding:12px;">Cargando mapa…</p></div>
      <div id="mp-vias" style="margin-top:8px;"></div>
      ${soloVer || !ajustes.orsKey ? "" : `<div class="co-ac" style="margin-top:8px;"><input type="text" id="mp-via" placeholder="Agregar punto vía (ciudad intermedia)…" autocomplete="off"></div>`}
      <div class="error" id="mp-err"></div>
      <div class="modal-acciones">${soloVer ? "" : `<button type="button" id="mp-catalogo">Guardar en catálogo</button>`}<button type="button" class="secundario" data-cerrar>Cerrar</button></div></div>`;
    document.body.appendChild(ov);
    let mapa = null;
    const cerrar = () => { if (mapa) mapa.remove(); ov.remove(); renderEditor(); };
    ov.querySelectorAll("[data-cerrar]").forEach(b => b.addEventListener("click", cerrar));
    const errM = (t) => { ov.querySelector("#mp-err").textContent = t || ""; };
    const titulo = () => { ov.querySelector("#mp-titulo").textContent = `${r.origen} → ${r.destino} · ${miles(r.km)} km`; };
    const pintarVias = () => {
      ov.querySelector("#mp-vias").innerHTML = (r.vias || []).length ? `<small class="nota">Pasa por:</small> ${r.vias.map((v, k) => `<span class="co-via">${esc(v.label)}${soloVer ? "" : ` <button type="button" class="co-link" data-qv="${k}" style="text-decoration:none;color:#A32D2D;">✕</button>`}</span>`).join("")}` : "";
      ov.querySelectorAll("[data-qv]").forEach(b => b.addEventListener("click", async () => { r.vias.splice(Number(b.dataset.qv), 1); await recalcular(); }));
    };
    const dibujar = () => {
      const L = window.L, linea = geo.get(r);
      if (!L || !linea) return;
      if (mapa) mapa.remove();
      ov.querySelector("#mp-mapa").innerHTML = "";
      mapa = L.map(ov.querySelector("#mp-mapa"));
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 18 }).addTo(mapa);
      const trazo = L.polyline(linea, { color: "#2C1E0F", weight: 4 }).addTo(mapa);
      const punto = (p, txt, color) => L.circleMarker([p.lat, p.lng], { radius: 7, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 }).addTo(mapa).bindTooltip(txt);
      punto(r.origenCoord, r.origen, "#3B7A1E"); punto(r.destinoCoord, r.destino, "#A32D2D");
      (r.vias || []).forEach(v => punto(v, v.label, "#D99A1E"));
      mapa.fitBounds(trazo.getBounds(), { padding: [24, 24] });
    };
    const recalcular = async () => {
      errM();
      const res = await calcularRuta(r, i);
      if (!res) { errM("No se pudo calcular la ruta."); return; }
      titulo(); pintarVias(); dibujar();
    };
    titulo(); pintarVias();
    try {
      cargarCss(URL_LEAFLET_CSS);
      await cargarScript(URL_LEAFLET_JS, "L");
      if (!geo.get(r)) { if (!ajustes.orsKey) { errM("Falta la clave de ORS en Ajustes para dibujar la ruta."); return; } await calcularRuta(r, i); titulo(); }
      dibujar();
    } catch (x) { errM("No se pudo cargar el mapa: " + x.message); }
    const via = ov.querySelector("#mp-via");
    if (via) autocompletar(via, async (op) => { r.vias = [...(r.vias || []), { label: op.label, lng: op.lng, lat: op.lat }]; via.value = ""; await recalcular(); });
    const bc = ov.querySelector("#mp-catalogo");
    if (bc) bc.addEventListener("click", async () => {
      errM();
      const datos = { origen: r.origen, destino: r.destino, km: num(r.km), kmOrs: r.kmOrs || null, origenCoord: r.origenCoord, destinoCoord: r.destinoCoord, vias: r.vias || [], fuente: "ORS", actualizadoMs: Date.now() };
      try {
        const cat = rutaDelCatalogo(r.origen, r.destino);
        if (cat) await updateDoc(doc(db, COL_RUT, cat.id), datos);
        else { const ref = doc(collection(db, COL_RUT)); await setDoc(ref, { ...datos, clave: "", creadoMs: Date.now(), creadoPor: { uid, nombre: yo.nombre } }); rutas.set(ref.id, { id: ref.id, ...datos }); }
        bc.textContent = "Guardada en catálogo ✓"; bc.disabled = true;
      } catch (x) { errM("No se pudo guardar: " + x.message); }
    });
  }

  function leerFormulario() {
    const n = $("#co-e-notas"); if (n) editor.notas = n.value;
  }
  function pintarIngresos() {
    editor.rutas.forEach((r, i) => {
      const td = $(`[data-ing="${i}"]`); if (!td) return;
      const v = ingresoKm(r, editor.moneda, editor.tipoCambio);
      td.innerHTML = `<span class="co-sem ${semaforo(v)}"></span><b>${v == null ? "—" : dinero(v)}</b>`;
      const t = $(`[data-tipo="${i}"]`); if (t) t.textContent = tipoRutaTxt(num(r.km));
    });
  }

  async function guardarCotizacion(conPdf) {
    leerFormulario();
    const e = editor, err = $("#co-e-err");
    err.textContent = "";
    const cli = clientes.get(e.clienteId);
    if (!cli) { err.textContent = "Elige el cliente."; return; }
    const rs = e.rutas.filter(r => String(r.origen).trim() || String(r.destino).trim() || num(r.importe) != null);
    if (!rs.length) { err.textContent = "Agrega al menos una ruta."; return; }
    for (const r of rs) {
      if (!String(r.origen).trim() || !String(r.destino).trim()) { err.textContent = "Cada ruta necesita origen y destino."; return; }
      if (!num(r.km) || num(r.km) <= 0) { err.textContent = `Faltan los km de ${r.origen} → ${r.destino}.`; return; }
      if (num(r.importe) == null || num(r.importe) <= 0) { err.textContent = `Falta el importe de ${r.origen} → ${r.destino}.`; return; }
    }
    if (e.moneda === "USD" && !(num(e.tipoCambio) > 0)) { err.textContent = "Escribe el tipo de cambio."; return; }
    const ahora = Date.now();
    const limpias = rs.map(r => ({
      origen: String(r.origen).trim(), destino: String(r.destino).trim(), km: num(r.km), importe: num(r.importe),
      agregadaMs: r.agregadaMs || ahora,
      origenCoord: r.origenCoord || null, destinoCoord: r.destinoCoord || null, vias: r.vias || [], kmOrs: r.kmOrs || null,
    }));
    const botones = $("#co-cuerpo").querySelectorAll(".co-acciones button");
    botones.forEach(b => b.disabled = true);
    try {
      let guardada;
      if (e._id) {
        const cambios = { rutas: limpias, estado: e.estado, notas: e.notas.trim() || null, contacto: e.contacto || null, actualizadoMs: ahora, actualizadoPor: { uid, nombre: yo.nombre } };
        await updateDoc(doc(db, COL_COT, e._id), cambios);
        guardada = { ...cotizaciones.get(e._id), ...cambios };
      } else {
        const d = new Date(ahora), anio = String(d.getFullYear()).slice(-2);
        const datos = {
          estado: "borrador", clienteId: cli.id, clienteNombre: cli.nombre, clienteRfc: cli.rfc || null, contacto: e.contacto || null,
          tipoCarga: e.tipoCarga, tipoServicio: e.tipoServicio, moneda: e.moneda, tipoCambio: e.moneda === "USD" ? num(e.tipoCambio) : 1,
          vigenciaDias: Number(e.vigenciaDias), emisionMs: ahora, vencimientoMs: ahora + Number(e.vigenciaDias) * DIA,
          rutas: limpias, notas: e.notas.trim() || null,
          creadoPorUid: uid, creadoPor: { uid, nombre: yo.nombre, puesto: yo.puesto, correo: yo.correo }, creadoMs: ahora, anio,
        };
        // Folio: consecutivo único para todos, en transacción.
        guardada = await runTransaction(db, async (tx) => {
          const refC = doc(db, COL_CONT, `cotizaciones_${anio}`);
          const sc = await tx.get(refC);
          const consecutivo = (sc.exists() ? (sc.data().ultimo || 0) : 0) + 1;
          const folio = folioDe(consecutivo, anio);
          tx.set(refC, { ultimo: consecutivo, actualizadoMs: ahora });
          const completa = { ...datos, folio, consecutivo };
          tx.set(doc(db, COL_COT, folio), completa);
          return { ...completa, id: folio };
        });
      }
      // Rutas nuevas al catálogo.
      for (const r of limpias) {
        if (!rutaDelCatalogo(r.origen, r.destino)) {
          const nueva = { origen: r.origen, destino: r.destino, km: r.km, kmOrs: r.kmOrs || null, origenCoord: r.origenCoord || null, destinoCoord: r.destinoCoord || null, vias: r.vias || [], fuente: r.kmOrs ? "ORS" : "manual" };
          try { const ref = doc(collection(db, COL_RUT)); await setDoc(ref, { ...nueva, clave: "", creadoMs: ahora, creadoPor: { uid, nombre: yo.nombre } }); rutas.set(ref.id, { id: ref.id, ...nueva }); }
          catch (x) { /* el catálogo es ayuda; no detiene la cotización */ }
        }
      }
      avisar(`Cotización ${guardada.folio} guardada.`);
      editor = null; fichaId = cli.id; render();
      if (conPdf) await generarPdf(guardada, cli, ajustes);
    } catch (x) {
      err.textContent = "No se pudo guardar: " + x.message;
      botones.forEach(b => b.disabled = false);
    }
  }
  async function pdfDe(id) {
    const c = cotizaciones.get(id);
    if (!c) return;
    try { await generarPdf(c, clientes.get(c.clienteId), ajustes); }
    catch (x) { error("No se pudo generar el PDF: " + x.message); }
  }

  // ============================================================================
  // Rutas
  // ============================================================================
  let fr = "";
  function renderRutas() {
    const q = normTxt(fr);
    const lista = [...rutas.values()].filter(r => !q || normTxt(`${r.clave} ${r.origen} ${r.destino}`).includes(q))
      .sort((a, b) => (a.origen || "").localeCompare(b.origen || "", "es") || (a.destino || "").localeCompare(b.destino || "", "es"));
    $("#co-cuerpo").innerHTML = `
      <div class="co-filtros"><input type="text" id="co-r-q" placeholder="Buscar ruta" value="${esc(fr)}">
        <button type="button" class="secundario" id="co-r-nueva" style="margin-left:auto;">+ Ruta</button></div>
      ${lista.length ? `<div class="tabla-wrap"><table class="tabla co-tabla">
        <thead><tr><th>Clave</th><th>Origen</th><th>Destino</th><th class="n">Km</th><th></th></tr></thead>
        <tbody>${lista.map(r => `<tr><td>${esc(r.clave || "—")}</td><td>${esc(r.origen)}</td><td>${esc(r.destino)}</td><td class="n">${miles(r.km)}</td>
          <td style="white-space:nowrap;"><button type="button" class="co-link" data-ed="${esc(r.id)}">Editar</button>${esAdmin ? ` · <button type="button" class="co-link" data-del="${esc(r.id)}">Borrar</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`
        : `<p class="nota" style="text-align:center;padding:18px;">${rutas.size ? "No hay rutas con esta búsqueda." : "Todavía no hay rutas. Se agregan solas al guardar cotizaciones, o con “+ Ruta”."}</p>`}
      <p class="nota">Al cotizar, si escribes un origen y destino que ya están aquí, se llenan los km solos.</p>`;
    const qi = $("#co-r-q");
    qi.addEventListener("input", () => { fr = qi.value; const p = qi.selectionStart; renderRutas(); const n = $("#co-r-q"); n.focus(); n.setSelectionRange(p, p); });
    $("#co-r-nueva").addEventListener("click", () => editarRuta(null));
    $("#co-cuerpo").querySelectorAll("[data-ed]").forEach(b => b.addEventListener("click", () => editarRuta(b.dataset.ed)));
    $("#co-cuerpo").querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
      const r = rutas.get(b.dataset.del);
      if (r && confirm(`¿Borrar la ruta ${r.origen} → ${r.destino}?`)) { try { await deleteDoc(doc(db, COL_RUT, r.id)); } catch (x) { error(x.message); } }
    }));
  }
  function editarRuta(id) {
    const r = id ? rutas.get(id) : { clave: "", origen: "", destino: "", km: "" };
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML = `<div class="modal-tarjeta" style="max-width:520px;width:100%;">
      <h2 style="margin:0 0 12px;">${id ? "Editar ruta" : "Nueva ruta"}</h2>
      <div class="co-grid">
        <div><label>Origen</label><input type="text" id="ru-o" value="${esc(r.origen)}" placeholder="Ciudad, estado"></div>
        <div><label>Destino</label><input type="text" id="ru-d" value="${esc(r.destino)}" placeholder="Ciudad, estado"></div>
        <div><label>Km</label><input type="number" min="1" id="ru-km" value="${esc(r.km)}"></div>
        <div><label>Clave (opcional)</label><input type="text" id="ru-cl" value="${esc(r.clave || "")}" placeholder="NLDTAMCDFNL" style="text-transform:uppercase;"></div>
      </div>
      <div class="error" id="ru-err"></div>
      <div class="modal-acciones"><button type="button" class="secundario" data-cerrar>Cancelar</button><button type="button" id="ru-ok">Guardar</button></div></div>`;
    document.body.appendChild(ov);
    ov.querySelector("[data-cerrar]").addEventListener("click", () => ov.remove());
    ov.querySelector("#ru-ok").addEventListener("click", async () => {
      const o = ov.querySelector("#ru-o").value.trim(), d = ov.querySelector("#ru-d").value.trim(), km = num(ov.querySelector("#ru-km").value);
      const errE = ov.querySelector("#ru-err");
      if (!o || !d || !km) { errE.textContent = "Escribe origen, destino y km."; return; }
      const otra = rutaDelCatalogo(o, d);
      if (otra && otra.id !== id) { errE.textContent = "Esa ruta ya está en el catálogo."; return; }
      const datos = { origen: o, destino: d, km, clave: ov.querySelector("#ru-cl").value.trim().toUpperCase(), actualizadoMs: Date.now() };
      try {
        if (id) await updateDoc(doc(db, COL_RUT, id), datos);
        else await setDoc(doc(collection(db, COL_RUT)), { ...datos, creadoMs: Date.now(), creadoPor: { uid, nombre: yo.nombre } });
        ov.remove();
      } catch (x) { errE.textContent = x.message; }
    });
  }

  // ============================================================================
  // Ajustes (solo admin)
  // ============================================================================
  function renderAjustes() {
    $("#co-cuerpo").innerHTML = `
      <div class="co-grid" style="max-width:760px;">
        <div><label>Semáforo verde desde (MXN/km)</label><input type="number" step="0.01" id="aj-verde" value="${esc(ajustes.verde)}"></div>
        <div><label>Semáforo ámbar desde (MXN/km)</label><input type="number" step="0.01" id="aj-ambar" value="${esc(ajustes.ambar)}"></div>
        <div><label>Tipo de cambio sugerido</label><input type="number" step="0.01" id="aj-tc" value="${esc(ajustes.tipoCambio)}"></div>
        <div><label>Vigencia por omisión (días)</label><input type="number" min="1" id="aj-vig" value="${esc(ajustes.vigenciaDias)}"></div>
        <div style="grid-column:1/-1;"><label>Clave de OpenRouteService (km por camión y mapa)</label><input type="text" id="aj-ors" value="${esc(ajustes.orsKey || "")}" placeholder="Pega aquí la clave de openrouteservice.org" autocomplete="off"></div>
        <div style="grid-column:1/-1;"><label>Condiciones que salen en todos los PDF (una por renglón)</label><textarea id="aj-cond" rows="5">${esc(ajustes.condiciones)}</textarea></div>
      </div>
      <p class="nota">La clave de ORS la ven quienes tienen Comercial (la usa su navegador). Plan gratis: 2,000 rutas y 1,000 búsquedas al día; las rutas guardadas en el catálogo ya no se vuelven a calcular. Abajo de las condiciones el PDF agrega solo la vigencia, la moneda (si es USD) y las notas de cada cotización. Quién entra a Comercial se marca en Configuración → Utilidades.</p>
      <div class="co-acciones" style="justify-content:flex-start;"><button type="button" id="aj-ok">Guardar ajustes</button></div>`;
    $("#aj-ok").addEventListener("click", async () => {
      const verde = num($("#aj-verde").value), ambar = num($("#aj-ambar").value), tc = num($("#aj-tc").value), vig = num($("#aj-vig").value);
      if (verde == null || ambar == null || ambar > verde) { error("El ámbar debe ser menor o igual que el verde."); return; }
      if (!(tc > 0) || !(vig > 0)) { error("Revisa el tipo de cambio y la vigencia."); return; }
      error();
      try {
        await setDoc(doc(db, COL_CFG, "ajustes"), { verde, ambar, tipoCambio: tc, vigenciaDias: Math.round(vig), orsKey: $("#aj-ors").value.trim(), condiciones: $("#aj-cond").value.trim(), actualizadoMs: Date.now(), actualizadoPor: { uid, nombre: yo.nombre } });
        avisar("Ajustes guardados.");
      } catch (x) { error("No se pudieron guardar: " + x.message); }
    });
  }
}