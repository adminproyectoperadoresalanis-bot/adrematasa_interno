// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/public/js/analisisOperaciones.js
// ##########################################################################
import { db } from "./firebase-config.js";
import { collection, doc, getDocs, query, where, writeBatch } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { leerSalidas, msFechaAdrematasa } from "./rentabilidad.js";

// ============================================================================
// Utilidades → Análisis de operaciones (2026-11-06, pedido de Ivan).
// Volumen y tiempos de la operación SIN dinero. Dos reportes del Adrematasa
// oficial que se pegan aquí (solo admin y Gerente de importaciones):
//   1) SALIDAS → rentabilidad_salidas/{Carta Porte TAIM}. Es la MISMA colección
//      de Rentabilidad (una sola base: Rentabilidad la cruza con sus facturas).
//      Da volumen semanal (lunes a domingo), seca/refrigerada (Prog: OFF =
//      seca), clientes, destinos, repartos (destino con guion), remolques
//      (columna Linea = propietario del remolque: ATASA propio, los demás de
//      intercambio) y diésel (tal cual: FULL, 3/4, 1/2, E…).
//   2) VISTA GENERAL → op_viajes/{remolque_salida}. Entrada a patio, salida de
//      patio, Arribo Impo (llegada al cliente) y Descarga (quedó vacío). En
//      reparto trae una fila por parada (Destino/Arribo/Descarga Reparto); se
//      juntan en un viaje con sus paradas. Se analizan TODOS los estatus.
//      Tiempos: patio = entrada→salida; tránsito = salida→primer arribo;
//      destino = primer arribo→última descarga (en reparto incluye el recorrido
//      entre paradas); completo = entrada→última descarga. Mediana; directos y
//      con reparto por separado. Horas imposibles (negativas o > 20 días) no
//      cuentan.
// "LAREDO TX VACIO" no se cuenta ni se muestra (registro basura, Ivan).
// Al pegar solo se escriben los registros nuevos o que cambiaron.
// Se lee por periodo (por omisión 8 semanas) para no leer toda la historia.
// ============================================================================

const COL_SALIDAS = "rentabilidad_salidas";
const COL_VIAJES = "op_viajes";
const URL_SHEETJS = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
const DIA = 864e5, HORA = 36e5, MAX_H = 20 * 24;
const PERIODOS = [4, 8, 12, 26];

// ---- Utilerías --------------------------------------------------------------
function esc(t) { const d = document.createElement("div"); d.textContent = t == null ? "" : String(t); return d.innerHTML; }
const norm = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const esBasura = (cliente) => norm(cliente) === "LAREDO TX VACIO";
const pad = (n) => String(n).padStart(2, "0");
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fechaCorta = (ms) => { if (!ms) return "—"; const d = new Date(ms); return `${d.getDate()} ${MESES[d.getMonth()]}`; };
const fechaHora = (ms) => { if (!ms) return "—"; const d = new Date(ms); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const miles = (n) => Number(n || 0).toLocaleString("es-MX");
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const lunesDe = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
const mediana = (xs) => { const a = xs.filter(x => x != null).sort((p, q) => p - q); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const horas = (h) => h == null ? "—" : (h >= 48 ? `${h.toFixed(1)} h <small class="nota">(${(h / 24).toFixed(1)} d)</small>` : `${h.toFixed(1)} h`);
const horasTxt = (h) => h == null ? "" : Math.round(h * 10) / 10;
const remNorm = (r) => String(r == null ? "" : r).trim().toUpperCase().replace(/^0+(?=\d)/, "");
const paradasDe = (destino) => String(destino || "").split("-").map(s => s.trim()).filter(Boolean);
const destinoFinal = (destino) => { const p = paradasDe(destino); return p.length ? p[p.length - 1] : "SIN DESTINO"; };
const esPropio = (linea) => norm(linea) === "ATASA";

// Diésel tal cual viene (FULL, 3/4, 5/8, 1/2, E…), con su tanque dibujado.
function diesel(v) {
  let t = String(v == null ? "" : v).trim().toUpperCase().replace(/^-+/, "");
  if (!t) return { txt: "—", frac: null };
  if (t === "FULL" || t === "F" || t === "LLENO") return { txt: "FULL", frac: 1 };
  if (t === "E" || t === "EMPTY" || t === "VACIO") return { txt: "E", frac: 0 };
  let m = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m && Number(m[2])) return { txt: `${m[1]}/${m[2]}`, frac: Math.min(1, Number(m[1]) / Number(m[2])) };
  const n = Number(t);
  if (isFinite(n) && n >= 0 && n <= 1) { const oct = Math.round(n * 8); const g = oct % 2 ? 1 : oct % 4 ? 2 : oct % 8 ? 4 : 8; return { txt: oct === 8 ? "FULL" : oct === 0 ? "E" : `${oct / (8 / g)}/${g}`, frac: n }; }
  return { txt: t, frac: null };
}
const dieselHtml = (v) => { const d = diesel(v); return d.frac == null ? esc(d.txt) : `<span class="ao-tq"><i style="width:${Math.round(d.frac * 100)}%"></i></span> ${esc(d.txt)}`; };

// Fecha del Adrematasa: "31/08/2026 08:31:00 p. m.", "31/08/2026 20:31", "2026-08-31 20:31".
function msFecha(t) {
  const s = String(t || "").trim();
  if (!s) return null;
  const a = msFechaAdrematasa(s);
  if (a) return a;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]).getTime();
  return null;
}

// ---- Vista general pegada → viajes (una fila por parada en reparto) ----------
const COLS_VISTA = {
  "fecha despacho": "fechaDespacho", "status": "status", "linea": "linea", "destino": "destino", "obs despacho": "obsDespacho",
  "remolque": "remolque", "cliente": "cliente", "producto": "producto", "fecha cita": "fechaCita", "hora cita": "horaCita",
  "carro1": "carro", "operador 1": "operador", "entrada": "entrada", "salida": "salida", "arribo impo": "arribo", "descarga": "descarga",
  "destino reparto": "destinoReparto", "arribo reparto": "arriboReparto", "descarga reparto": "descargaReparto",
};
const normCol = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
export function leerVistaGeneral(texto) {
  const lineas = String(texto || "").split(/\r?\n/).filter(l => l.trim());
  const iTit = lineas.findIndex(l => { const c = l.split("\t").map(normCol); return c.includes("remolque") && c.includes("entrada") && c.includes("salida"); });
  if (iTit < 0) throw new Error("No encontré la fila de títulos (debe traer Remolque, Entrada y Salida).");
  let tit = lineas[iTit].split("\t").map(normCol);
  const datos = lineas.slice(iTit + 1).map(l => l.split("\t"));
  const masLargos = datos.filter(c => c.length === tit.length + 1 && c[0].trim() === "").length;
  if (datos.length && masLargos > datos.length / 2) tit = [""].concat(tit);
  const idx = {};
  tit.forEach((t, i) => { if (COLS_VISTA[t] && idx[COLS_VISTA[t]] == null) idx[COLS_VISTA[t]] = i; });
  const viajes = new Map();
  let basura = 0;
  datos.forEach(c => {
    const r = {};
    Object.entries(idx).forEach(([k, i]) => { r[k] = (c[i] || "").trim(); });
    if (!r.remolque) return;
    if (esBasura(r.cliente)) { basura++; return; }
    const entradaMs = msFecha(r.entrada), salidaMs = msFecha(r.salida);
    const refMs = salidaMs || entradaMs;
    if (!refMs) return;
    const id = `${remNorm(r.remolque).replace(/[^A-Z0-9]/g, "-")}_${salidaMs ? "S" + salidaMs : "E" + entradaMs}`;
    let v = viajes.get(id);
    if (!v) {
      const cita = msFecha(r.fechaCita);
      const hc = String(r.horaCita || "").match(/(\d{1,2}):(\d{2})/);
      v = {
        id, remolque: remNorm(r.remolque), status: r.status || "", linea: r.linea || "", destino: r.destino || "", obsDespacho: r.obsDespacho || "",
        cliente: r.cliente || "", producto: r.producto || "", carro: r.carro || "", operador: r.operador || "",
        fechaDespachoMs: msFecha(r.fechaDespacho),
        citaMs: cita && hc && new Date(cita).getHours() === 0 && new Date(cita).getMinutes() === 0 ? cita + (+hc[1]) * HORA + (+hc[2]) * 6e4 : cita,
        entradaMs, salidaMs, arriboMs: msFecha(r.arribo), descargaMs: msFecha(r.descarga), refMs, paradas: [],
      };
      viajes.set(id, v);
    }
    if (r.destinoReparto || r.arriboReparto || r.descargaReparto) {
      v.paradas.push({ destino: r.destinoReparto || "", arriboMs: msFecha(r.arriboReparto), descargaMs: msFecha(r.descargaReparto) });
    }
  });
  const lista = [...viajes.values()];
  lista.forEach(v => v.paradas.sort((a, b) => (a.arriboMs || a.descargaMs || 9e15) - (b.arriboMs || b.descargaMs || 9e15)));
  if (!lista.length) throw new Error("No encontré renglones con remolque y fecha de entrada o salida.");
  return { viajes: lista, basura };
}

// Tiempos de un viaje (horas). null = sin dato o fuera de rango.
export function tiemposViaje(v) {
  const p = v.paradas || [];
  const conRep = p.length > 1;
  const arr = conRep ? [v.arriboMs, ...p.map(x => x.arriboMs)].filter(Boolean) : [v.arriboMs].filter(Boolean);
  const des = conRep ? [v.descargaMs, ...p.map(x => x.descargaMs)].filter(Boolean) : [v.descargaMs].filter(Boolean);
  const primerArribo = arr.length ? Math.min(...arr) : null;
  const ultimaDescarga = des.length ? Math.max(...des) : null;
  let raro = false;
  const h = (a, b) => { if (!a || !b) return null; const x = (b - a) / HORA; if (x < 0 || x > MAX_H) { raro = true; return null; } return x; };
  const t = { patio: h(v.entradaMs, v.salidaMs), transito: h(v.salidaMs, primerArribo), destino: h(primerArribo, ultimaDescarga), completo: h(v.entradaMs, ultimaDescarga) };
  return { ...t, conReparto: conRep, raro, primerArribo, ultimaDescarga };
}
const destinoFinalViaje = (v) => { const p = (v.paradas || []).filter(x => x.destino); return p.length > 1 ? p[p.length - 1].destino : (v.destino ? destinoFinal(v.destino) : (p[0] || {}).destino || "SIN DESTINO"); };

function cargarScript(url, global) {
  if (window[global]) return Promise.resolve(window[global]);
  return new Promise((ok, mal) => { const s = document.createElement("script"); s.src = url; s.onload = () => ok(window[global]); s.onerror = () => mal(new Error("No se pudo cargar " + url)); document.head.appendChild(s); });
}

function inyectarEstilos() {
  if (document.getElementById("estilos-analisis-op")) return;
  const s = document.createElement("style");
  s.id = "estilos-analisis-op";
  s.textContent = `
    .ao-tabs { display:flex; gap:6px; flex-wrap:wrap; margin:12px 0 14px; }
    .ao-tab { background:#fff; border:1px solid #e2ddd5; border-radius:16px; padding:6px 13px; font:inherit; font-size:13px; color:#6b5f52; cursor:pointer; }
    .ao-tab.activo { background:#2c1e0f; border-color:#2c1e0f; color:#fff; }
    .ao-filtros { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:12px; }
    .ao-filtros select, .ao-filtros input { width:auto; min-width:140px; }
    .ao-seg { display:inline-flex; border:1px solid #e2ddd5; border-radius:9px; overflow:hidden; }
    .ao-seg button { background:#fff; border:0; border-left:1px solid #e2ddd5; padding:6px 11px; font:inherit; font-size:12.5px; color:#6b5f52; cursor:pointer; }
    .ao-seg button:first-child { border-left:0; } .ao-seg button.activo { background:#2c1e0f; color:#fff; font-weight:700; }
    .ao-kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin-bottom:14px; }
    .ao-kpi { border:1px solid #e2ddd5; border-radius:12px; padding:11px 13px; background:#fff; }
    .ao-kpi b { display:block; font-size:21px; } .ao-kpi small { color:#8a7f73; font-size:11.5px; }
    .ao-kpi.hero { background:#2c1e0f; color:#fff; border-color:#2c1e0f; } .ao-kpi.hero small { color:#e8dccd; }
    .ao-sube { color:#3B7A1E; font-weight:700; } .ao-baja { color:#A32D2D; font-weight:700; }
    .ao-h3 { font-size:12px; margin:18px 0 8px; color:#6b5f52; text-transform:uppercase; letter-spacing:.4px; font-weight:700; }
    .ao-graf { display:flex; align-items:flex-end; gap:6px; height:170px; padding:8px 2px 0; border-bottom:1px solid #e2ddd5; }
    .ao-col { flex:1; min-width:0; display:flex; flex-direction:column; justify-content:flex-end; align-items:center; }
    .ao-col i { display:block; width:100%; max-width:42px; } .ao-col .s { background:#C68A2E; } .ao-col .r { background:#185FA5; border-radius:4px 4px 0 0; }
    .ao-col b { font-size:11px; margin-bottom:3px; } .ao-col.parcial i { opacity:.45; }
    .ao-ejes { display:flex; gap:6px; padding:4px 2px 0; } .ao-ejes span { flex:1; min-width:0; text-align:center; font-size:10px; color:#6b5f52; overflow:hidden; white-space:nowrap; }
    .ao-ley { display:flex; gap:14px; font-size:11.5px; color:#6b5f52; margin-top:8px; flex-wrap:wrap; } .ao-ley i { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:5px; vertical-align:-1px; }
    .ao-dos { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:16px; }
    .ao-barra { height:9px; border-radius:5px; background:#EEE8E0; overflow:hidden; display:flex; min-width:90px; } .ao-barra span { display:block; height:100%; }
    .ao-bs { background:#C68A2E; } .ao-br { background:#185FA5; } .ao-bc { background:#2c1e0f; }
    .ao-chip { display:inline-block; font-size:10.5px; font-weight:700; padding:2px 8px; border-radius:9px; white-space:nowrap; }
    .ao-seca { background:#F3E9D7; color:#7a4a12; } .ao-refri { background:#DDEEFB; color:#0C447C; } .ao-rep { background:#FFE7C2; color:#8a4b00; } .ao-gris { background:#ECE9E4; color:#5c5045; } .ao-prop { background:#EAF3DE; color:#3B7A1E; }
    .ao-tq { display:inline-block; width:36px; height:10px; border:1.5px solid #5c5045; border-radius:3px; position:relative; overflow:hidden; vertical-align:-1px; } .ao-tq i { position:absolute; left:0; top:0; bottom:0; background:#5c5045; }
    .ao-tira { display:flex; height:28px; border-radius:8px; overflow:hidden; margin:8px 0 4px; font-size:11px; color:#fff; font-weight:700; }
    .ao-tira span { display:flex; align-items:center; justify-content:center; white-space:nowrap; overflow:hidden; padding:0 4px; }
    .ao-tabla tr.clic { cursor:pointer; } .ao-tabla tr.clic:hover td { background:#faf7f2; }
    .ao-tabla td.n, .ao-tabla th.n { text-align:right; white-space:nowrap; }
    .ao-pegar { width:100%; box-sizing:border-box; min-height:130px; font-family:monospace; font-size:11.5px; white-space:pre; }
    .ao-caja { border:1px solid #e2ddd5; border-radius:12px; padding:14px; background:#fff; }
    .ao-pag { display:flex; gap:8px; align-items:center; justify-content:center; margin:12px 0 4px; flex-wrap:wrap; }
    .ao-link { background:none; border:0; padding:0; font:inherit; font-weight:700; color:#185FA5; text-decoration:underline; cursor:pointer; }
    .ao-parada { display:inline-block; font-size:11px; padding:1px 7px; border-radius:8px; background:#F2EDE6; margin:1px 3px 1px 0; }
  `;
  document.head.appendChild(s);
}

// ---- Pantalla -----------------------------------------------------------------
// datosUsuario: ficha de usuarios; uid. Pegan los reportes: admin y el puesto
// que diga "Gerente … impo…" (la regla de firestore.rules exige lo mismo).
export function iniciarAnalisisOperaciones(contenedor, datosUsuario, uid) {
  inyectarEstilos();
  const yo = datosUsuario || {};
  const puedePegar = yo.rol === "admin" || /gerente.*impo/i.test(String(yo.puesto || "").normalize("NFD").replace(/[̀-ͯ]/g, ""));
  contenedor.innerHTML = `
    <section class="panel">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
        <div><h2 style="margin:0;">Análisis de operaciones</h2><p class="nota" id="ao-sub" style="margin:3px 0 0;">Salidas y viajes del Adrematasa oficial.</p></div>
        <div class="ao-filtros" style="margin:0;"><select id="ao-periodo">${PERIODOS.map(n => `<option value="${n}"${n === 8 ? " selected" : ""}>Últimas ${n} semanas</option>`).join("")}</select>
          <button type="button" class="secundario" id="ao-recargar">Actualizar</button></div>
      </div>
      <div class="ao-tabs" id="ao-tabs"></div>
      <div id="ao-error" class="error"></div>
      <p id="ao-exito" class="nota oculto" style="color:#1c7a41;"></p>
      <div id="ao-cuerpo"><p class="nota">Cargando…</p></div>
    </section>`;
  const $ = (s) => contenedor.querySelector(s);
  const avisar = (t) => { const e = $("#ao-exito"); e.textContent = t; e.classList.remove("oculto"); setTimeout(() => e.classList.add("oculto"), 7000); };
  const error = (t) => { $("#ao-error").textContent = t || ""; };

  let tab = "resumen";
  let semanas = 8;
  let salidas = [], viajes = [], cargadoDesde = null, cargando = false;
  const f = { carga: "", linea: "", q: "", cliente: "", destino: "", pagina: 0 };   // filtros de salidas
  const ft = { tipo: "", cliente: "", destino: "" };                                  // filtros de tiempos
  let pegado = { salidas: null, vista: null };

  const desdeMs = () => lunesDe(Date.now()) - (semanas - 1) * 7 * DIA;

  async function cargar(forzar) {
    const desde = desdeMs();
    if (!forzar && cargadoDesde != null && cargadoDesde <= desde) { render(); return; }
    cargando = true; render();
    try {
      const [s1, s2] = await Promise.all([
        getDocs(query(collection(db, COL_SALIDAS), where("fechaMs", ">=", desde))),
        getDocs(query(collection(db, COL_VIAJES), where("refMs", ">=", desde))),
      ]);
      salidas = s1.docs.map(d => ({ id: d.id, ...d.data() })).filter(x => !esBasura(x.cliente));
      viajes = s2.docs.map(d => ({ id: d.id, ...d.data() })).filter(x => !esBasura(x.cliente));
      cargadoDesde = desde;
      error();
    } catch (e) { error("No se pudieron leer los datos: " + e.message); }
    cargando = false;
    render();
  }

  // Salidas del periodo elegido (las cargadas pueden cubrir más si antes se pidió un periodo mayor).
  const enPeriodo = (ms) => ms && ms >= desdeMs();
  const salidasPeriodo = () => salidas.filter(s => enPeriodo(s.fechaMs));
  const viajesPeriodo = () => viajes.filter(v => enPeriodo(v.refMs));
  const filtrarSalidas = (lista) => lista.filter(s =>
    (!f.carga || s.tipo === f.carga) &&
    (!f.linea || (f.linea === "propio" ? esPropio(s.linea) : !esPropio(s.linea))) &&
    (!f.cliente || norm(s.cliente) === f.cliente) &&
    (!f.destino || norm(destinoFinal(s.destino)) === f.destino));

  // Liga salida ↔ viaje: mismo remolque y salida a menos de 6 h (en los archivos coincide al minuto).
  let indiceViajes = null;
  function viajeDeSalida(s) {
    if (!indiceViajes) {
      indiceViajes = new Map();
      viajes.forEach(v => { if (!v.salidaMs) return; const k = v.remolque; if (!indiceViajes.has(k)) indiceViajes.set(k, []); indiceViajes.get(k).push(v); });
    }
    const c = indiceViajes.get(remNorm(s.remolque)) || [];
    let mejor = null, dif = 6 * HORA + 1;
    c.forEach(v => { const d = Math.abs(v.salidaMs - s.fechaMs); if (d < dif) { dif = d; mejor = v; } });
    return mejor;
  }

  function renderTabs() {
    const ts = [["resumen", "Resumen"], ["tiempos", "Tiempos"], ["clientes", "Clientes"], ["destinos", "Destinos"], ["remolques", "Remolques"], ["salidas", "Salidas"]];
    if (puedePegar) ts.push(["pegar", "Pegar reportes"]);
    $("#ao-tabs").innerHTML = ts.map(([k, t]) => `<button type="button" class="ao-tab${tab === k ? " activo" : ""}" data-t="${k}">${t}</button>`).join("");
    $("#ao-tabs").querySelectorAll("[data-t]").forEach(b => b.addEventListener("click", () => { tab = b.dataset.t; f.pagina = 0; render(); }));
  }
  function render() {
    renderTabs();
    indiceViajes = null;
    const ult = Math.max(0, ...salidas.map(s => s.cargadaMs || 0), ...viajes.map(v => v.cargadaMs || 0));
    $("#ao-sub").textContent = ult ? `Salidas y viajes del Adrematasa oficial · última carga ${fechaHora(ult)}` : "Salidas y viajes del Adrematasa oficial.";
    if (cargando) { $("#ao-cuerpo").innerHTML = `<p class="nota">Cargando…</p>`; return; }
    if (tab === "pegar") return renderPegar();
    if (!salidas.length && !viajes.length) {
      $("#ao-cuerpo").innerHTML = `<p class="nota">Todavía no hay salidas ni viajes en este periodo.${puedePegar ? " Pega los reportes en la pestaña \"Pegar reportes\"." : ""}</p>`;
      return;
    }
    if (tab === "tiempos") return renderTiempos();
    if (tab === "clientes") return renderClientes();
    if (tab === "destinos") return renderDestinos();
    if (tab === "remolques") return renderRemolques();
    if (tab === "salidas") return renderSalidas();
    return renderResumen();
  }

  // Filtros comunes de las pestañas de salidas.
  function barraFiltros() {
    const seg = (campo, ops) => `<span class="ao-seg">${ops.map(([v, t]) => `<button type="button" class="${f[campo] === v ? "activo" : ""}" data-f="${campo}" data-v="${v}">${t}</button>`).join("")}</span>`;
    return `<div class="ao-filtros">${seg("carga", [["", "Todas"], ["refrigerada", "Refrigerada"], ["seca", "Seca"]])} ${seg("linea", [["", "Todos los remolques"], ["propio", "Propios ATASA"], ["intercambio", "Intercambio"]])}
      ${f.cliente || f.destino ? `<span class="ao-chip ao-gris">${esc(f.cliente || f.destino)} <button type="button" class="ao-link" id="ao-quitar" style="text-decoration:none;color:#A32D2D;">✕</button></span>` : ""}</div>`;
  }
  function enlazarFiltros() {
    $("#ao-cuerpo").querySelectorAll("[data-f]").forEach(b => b.addEventListener("click", () => { f[b.dataset.f] = b.dataset.v; f.pagina = 0; render(); }));
    const q = $("#ao-quitar"); if (q) q.addEventListener("click", () => { f.cliente = ""; f.destino = ""; f.pagina = 0; render(); });
  }
  const barraTipo = (s) => { const t = s.length, r = s.filter(x => x.tipo === "refrigerada").length, se = s.filter(x => x.tipo === "seca").length; return `<div class="ao-barra" title="Refrigerada ${r} · Seca ${se}"><span class="ao-br" style="width:${pct(r, t)}%"></span><span class="ao-bs" style="width:${pct(se, t)}%"></span></div>`; };

  // ---- Resumen ----
  function renderResumen() {
    const todas = filtrarSalidas(salidasPeriodo());
    const lun = lunesDe(Date.now());
    const estaSem = todas.filter(s => s.fechaMs >= lun);
    const semAnt = todas.filter(s => s.fechaMs >= lun - 7 * DIA && s.fechaMs < lun);
    const cambio = semAnt.length ? Math.round((estaSem.length - semAnt.length) / semAnt.length * 100) : null;
    const semanasLista = [];
    for (let i = semanas - 1; i >= 0; i--) semanasLista.push(lun - i * 7 * DIA);
    const porSem = semanasLista.map(l => { const xs = todas.filter(s => s.fechaMs >= l && s.fechaMs < l + 7 * DIA); return { l, r: xs.filter(x => x.tipo === "refrigerada").length, s: xs.filter(x => x.tipo === "seca").length, t: xs.length }; });
    const completas = porSem.slice(0, -1).filter(x => x.t);
    const prom = completas.length ? Math.round(completas.reduce((a, x) => a + x.t, 0) / completas.length) : 0;
    const max = Math.max(1, ...porSem.map(x => x.t));
    const refri = todas.filter(s => s.tipo === "refrigerada").length, seca = todas.filter(s => s.tipo === "seca").length;
    const rep = todas.filter(s => paradasDe(s.destino).length > 1).length;
    const prop = todas.filter(s => esPropio(s.linea)).length;
    const ranking = (clave) => { const m = new Map(); todas.forEach(s => { const k = clave(s); if (!m.has(k)) m.set(k, []); m.get(k).push(s); }); return [...m.entries()].sort((a, b) => b[1].length - a[1].length); };
    const topDest = ranking(s => destinoFinal(s.destino)).slice(0, 8);
    const topCli = ranking(s => s.cliente || "SIN CLIENTE").slice(0, 8);
    $("#ao-cuerpo").innerHTML = `${barraFiltros()}
      <div class="ao-kpis">
        <div class="ao-kpi hero"><b>${miles(estaSem.length)}</b><small>Salidas esta semana (lun–dom, en curso)</small></div>
        <div class="ao-kpi"><b>${miles(semAnt.length)}</b><small>Semana anterior ${cambio == null ? "" : `<span class="${cambio >= 0 ? "ao-sube" : "ao-baja"}">${cambio >= 0 ? "▲" : "▼"} ${Math.abs(cambio)} %</span>`}</small></div>
        <div class="ao-kpi"><b>${miles(prom)}</b><small>Promedio semanal (semanas completas)</small></div>
        <div class="ao-kpi"><b>${pct(refri, todas.length)} % · ${pct(seca, todas.length)} %</b><small>Refrigerada · Seca</small></div>
        <div class="ao-kpi"><b>${pct(rep, todas.length)} %</b><small>Con reparto (${miles(rep)} de ${miles(todas.length)})</small></div>
        <div class="ao-kpi"><b>${pct(prop, todas.length)} % · ${pct(todas.length - prop, todas.length)} %</b><small>Remolque propio ATASA · intercambio</small></div>
      </div>
      <div class="ao-h3">Volumen semanal (lunes a domingo)</div>
      <div class="ao-graf">${porSem.map((x, i) => `<div class="ao-col${i === porSem.length - 1 ? " parcial" : ""}" title="${x.t} salidas · refrigerada ${x.r} · seca ${x.s}"><b>${x.t || ""}</b><i class="r" style="height:${Math.round(x.r / max * 140)}px"></i><i class="s" style="height:${Math.round(x.s / max * 140)}px"></i></div>`).join("")}</div>
      <div class="ao-ejes">${porSem.map(x => `<span>${fechaCorta(x.l)}</span>`).join("")}</div>
      <div class="ao-ley"><span><i style="background:#185FA5"></i>Refrigerada (Prog con temperatura)</span><span><i style="background:#C68A2E"></i>Seca (Prog OFF)</span><span>La semana en curso va en tono claro.</span></div>
      <div class="ao-dos" style="margin-top:6px;">
        <div><div class="ao-h3">Top destinos (destino final) · periodo</div>
          <div class="tabla-wrap"><table class="tabla ao-tabla"><thead><tr><th>Destino</th><th class="n">Salidas</th><th>Refri / Seca</th></tr></thead>
          <tbody>${topDest.map(([k, xs]) => { const r = xs.filter(s => paradasDe(s.destino).length > 1).length; return `<tr class="clic" data-dest="${esc(norm(k))}"><td>${esc(k)}${r ? ` <span class="ao-chip ao-rep">${r} vía reparto</span>` : ""}</td><td class="n"><b>${miles(xs.length)}</b></td><td>${barraTipo(xs)}</td></tr>`; }).join("")}</tbody></table></div></div>
        <div><div class="ao-h3">Top clientes · periodo</div>
          <div class="tabla-wrap"><table class="tabla ao-tabla"><thead><tr><th>Cliente</th><th class="n">Salidas</th><th class="n">Esta sem.</th><th class="n">vs. ant.</th></tr></thead>
          <tbody>${topCli.map(([k, xs]) => { const a = xs.filter(s => s.fechaMs >= lun).length, b = xs.filter(s => s.fechaMs >= lun - 7 * DIA && s.fechaMs < lun).length, d = a - b; return `<tr class="clic" data-cli="${esc(norm(k))}"><td>${esc(k)}</td><td class="n"><b>${miles(xs.length)}</b></td><td class="n">${a}</td><td class="n">${d > 0 ? `<span class="ao-sube">▲ ${d}</span>` : d < 0 ? `<span class="ao-baja">▼ ${-d}</span>` : "="}</td></tr>`; }).join("")}</tbody></table></div></div>
      </div>`;
    enlazarFiltros();
    enlazarAbrirSalidas();
  }
  function enlazarAbrirSalidas() {
    $("#ao-cuerpo").querySelectorAll("[data-cli]").forEach(tr => tr.addEventListener("click", () => { f.cliente = tr.dataset.cli; f.destino = ""; f.pagina = 0; tab = "salidas"; render(); }));
    $("#ao-cuerpo").querySelectorAll("[data-dest]").forEach(tr => tr.addEventListener("click", () => { f.destino = tr.dataset.dest; f.cliente = ""; f.pagina = 0; tab = "salidas"; render(); }));
  }

  // ---- Clientes ----
  function renderClientes() {
    const todas = filtrarSalidas(salidasPeriodo());
    const m = new Map(); todas.forEach(s => { const k = s.cliente || "SIN CLIENTE"; if (!m.has(k)) m.set(k, []); m.get(k).push(s); });
    const filas = [...m.entries()].sort((a, b) => b[1].length - a[1].length);
    $("#ao-cuerpo").innerHTML = `${barraFiltros()}
      <p class="nota">${miles(todas.length)} salidas de ${filas.length} clientes en el periodo. Toca un cliente para ver sus salidas.</p>
      <div class="tabla-wrap"><table class="tabla ao-tabla"><thead><tr><th>#</th><th>Cliente</th><th class="n">Salidas</th><th class="n">%</th><th>Refri / Seca</th><th class="n">Refri</th><th class="n">Seca</th><th class="n">Con reparto</th><th class="n">Remolque propio</th></tr></thead>
      <tbody>${filas.map(([k, xs], i) => `<tr class="clic" data-cli="${esc(norm(k))}"><td>${i + 1}</td><td>${esc(k)}</td><td class="n"><b>${miles(xs.length)}</b></td><td class="n">${pct(xs.length, todas.length)} %</td><td>${barraTipo(xs)}</td>
        <td class="n">${xs.filter(s => s.tipo === "refrigerada").length}</td><td class="n">${xs.filter(s => s.tipo === "seca").length}</td>
        <td class="n">${xs.filter(s => paradasDe(s.destino).length > 1).length || "—"}</td><td class="n">${pct(xs.filter(s => esPropio(s.linea)).length, xs.length)} %</td></tr>`).join("")}</tbody></table></div>`;
    enlazarFiltros(); enlazarAbrirSalidas();
  }

  // ---- Destinos ----
  function renderDestinos() {
    const todas = filtrarSalidas(salidasPeriodo());
    const m = new Map(); todas.forEach(s => { const k = destinoFinal(s.destino); if (!m.has(k)) m.set(k, []); m.get(k).push(s); });
    const filas = [...m.entries()].sort((a, b) => b[1].length - a[1].length);
    $("#ao-cuerpo").innerHTML = `${barraFiltros()}
      <p class="nota">Destino final = la última parada del destino de la salida ("MTY-CUL-GDL" termina en GDL). Los recorridos con reparto se cuentan aparte de los directos.</p>
      <div class="tabla-wrap"><table class="tabla ao-tabla"><thead><tr><th>Destino final</th><th class="n">Salidas</th><th class="n">Directo</th><th class="n">Vía reparto</th><th>Refri / Seca</th><th>Recorridos con reparto</th></tr></thead>
      <tbody>${filas.map(([k, xs]) => {
        const rep = xs.filter(s => paradasDe(s.destino).length > 1);
        const rec = new Map(); rep.forEach(s => { const r = paradasDe(s.destino).join(" → "); rec.set(r, (rec.get(r) || 0) + 1); });
        const recTop = [...rec.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
        return `<tr class="clic" data-dest="${esc(norm(k))}"><td>${esc(k)}</td><td class="n"><b>${miles(xs.length)}</b></td><td class="n">${xs.length - rep.length}</td><td class="n">${rep.length || "—"}</td><td>${barraTipo(xs)}</td>
          <td>${recTop.map(([r, n]) => `<span class="ao-parada">${esc(r)} · ${n}</span>`).join("") || `<span class="nota">—</span>`}</td></tr>`;
      }).join("")}</tbody></table></div>`;
    enlazarFiltros(); enlazarAbrirSalidas();
  }

  // ---- Remolques (propietario = columna Linea) ----
  function renderRemolques() {
    const todas = filtrarSalidas(salidasPeriodo());
    const m = new Map(); todas.forEach(s => { const k = norm(s.linea) || "SIN DATO"; if (!m.has(k)) m.set(k, []); m.get(k).push(s); });
    const filas = [...m.entries()].sort((a, b) => b[1].length - a[1].length);
    const prop = todas.filter(s => esPropio(s.linea)).length;
    const lun = lunesDe(Date.now());
    const sems = []; for (let i = semanas - 1; i >= 0; i--) sems.push(lun - i * 7 * DIA);
    $("#ao-cuerpo").innerHTML = `${barraFiltros()}
      <div class="ao-kpis"><div class="ao-kpi hero"><b>${pct(prop, todas.length)} %</b><small>Salidas con remolque propio (ATASA)</small></div>
        <div class="ao-kpi"><b>${pct(todas.length - prop, todas.length)} %</b><small>Con remolque de intercambio (${miles(todas.length - prop)})</small></div>
        <div class="ao-kpi"><b>${filas.length - (m.has("ATASA") ? 1 : 0)}</b><small>Carriers de intercambio en el periodo</small></div></div>
      <div class="ao-dos">
        <div><div class="ao-h3">Por propietario del remolque</div>
          <div class="tabla-wrap"><table class="tabla ao-tabla"><thead><tr><th>Propietario</th><th class="n">Salidas</th><th class="n">%</th><th style="width:30%"></th><th>Refri / Seca</th></tr></thead>
          <tbody>${filas.map(([k, xs]) => `<tr><td>${esc(k)} ${k === "ATASA" ? `<span class="ao-chip ao-prop">propio</span>` : ""}</td><td class="n"><b>${miles(xs.length)}</b></td><td class="n">${pct(xs.length, todas.length)} %</td><td><div class="ao-barra"><span class="ao-bc" style="width:${pct(xs.length, todas.length)}%"></span></div></td><td>${barraTipo(xs)}</td></tr>`).join("")}</tbody></table></div></div>
        <div><div class="ao-h3">Intercambio por semana</div>
          <div class="tabla-wrap"><table class="tabla ao-tabla"><thead><tr><th>Semana</th><th class="n">Propios</th><th class="n">Intercambio</th><th class="n">% intercambio</th></tr></thead>
          <tbody>${sems.map(l => { const xs = todas.filter(s => s.fechaMs >= l && s.fechaMs < l + 7 * DIA); const p = xs.filter(s => esPropio(s.linea)).length; return `<tr><td>${fechaCorta(l)}${l === lun ? ` <span class="nota">(en curso)</span>` : ""}</td><td class="n">${p}</td><td class="n">${xs.length - p}</td><td class="n"><b>${pct(xs.length - p, xs.length)} %</b></td></tr>`; }).join("")}</tbody></table></div></div>
      </div>`;
    enlazarFiltros();
  }

  // ---- Salidas (lista) ----
  function renderSalidas() {
    const q = norm(f.q);
    let lista = filtrarSalidas(salidasPeriodo()).sort((a, b) => (b.fechaMs || 0) - (a.fechaMs || 0));
    if (q) lista = lista.filter(s => norm([s.factura, s.cliente, s.destino, s.remolque, s.carro, s.operador, s.linea].join(" ")).includes(q));
    const POR = 50, paginas = Math.max(1, Math.ceil(lista.length / POR));
    if (f.pagina >= paginas) f.pagina = 0;
    const vista = lista.slice(f.pagina * POR, f.pagina * POR + POR);
    $("#ao-cuerpo").innerHTML = `${barraFiltros()}
      <div class="ao-filtros"><input type="search" id="ao-q" placeholder="Buscar Carta Porte, cliente, destino, remolque, unidad, operador" value="${esc(f.q)}" style="min-width:260px;flex:1;">
        <button type="button" class="secundario" id="ao-excel">Excel</button></div>
      <p class="nota">${miles(lista.length)} salidas. Los tiempos salen del reporte Vista general (si ya se pegó ese viaje).</p>
      <div class="tabla-wrap"><table class="tabla ao-tabla"><thead><tr><th>Salida</th><th>Carta Porte</th><th>Cliente</th><th>Destino</th><th>Carga</th><th>Remolque</th><th>Unidad · Operador</th><th>Diésel</th><th class="n">Patio</th><th class="n">Tránsito</th><th class="n">Destino</th></tr></thead>
      <tbody>${vista.map(s => { const v = viajeDeSalida(s), t = v ? tiemposViaje(v) : {}; const p = paradasDe(s.destino);
        return `<tr><td>${fechaHora(s.fechaMs)}</td><td>${esc(s.factura)}</td><td>${esc(s.cliente)}</td><td>${esc(s.destino)}${p.length > 1 ? ` <span class="ao-chip ao-rep">${p.length} paradas</span>` : ""}</td>
          <td><span class="ao-chip ${s.tipo === "seca" ? "ao-seca" : s.tipo === "refrigerada" ? "ao-refri" : "ao-gris"}">${s.tipo === "seca" ? "SECA" : s.tipo === "refrigerada" ? "REFRI" : "—"}</span> <small class="nota">${esc(s.prog || "")}</small></td>
          <td>${esc(s.remolque)} <small class="nota">${esc(s.linea || "")}</small></td><td>${esc(s.carro || "")} <small class="nota">${esc(s.operador || "")}</small></td><td style="white-space:nowrap;">${dieselHtml(s.diesel)}</td>
          <td class="n">${v ? horas(t.patio) : "—"}</td><td class="n">${v ? horas(t.transito) : "—"}</td><td class="n">${v ? horas(t.destino) : "—"}</td></tr>`; }).join("")}</tbody></table></div>
      ${paginas > 1 ? `<div class="ao-pag"><button type="button" class="secundario" id="ao-ant"${f.pagina ? "" : " disabled"}>‹ Anteriores</button><span class="nota">Página ${f.pagina + 1} de ${paginas}</span><button type="button" class="secundario" id="ao-sig"${f.pagina < paginas - 1 ? "" : " disabled"}>Siguientes ›</button></div>` : ""}`;
    enlazarFiltros();
    const qi = $("#ao-q");
    qi.addEventListener("input", () => { f.q = qi.value; f.pagina = 0; const pos = qi.selectionStart; renderSalidas(); const n = $("#ao-q"); n.focus(); n.setSelectionRange(pos, pos); });
    const a = $("#ao-ant"); if (a) a.addEventListener("click", () => { f.pagina--; renderSalidas(); });
    const s = $("#ao-sig"); if (s) s.addEventListener("click", () => { f.pagina++; renderSalidas(); });
    $("#ao-excel").addEventListener("click", async () => {
      try {
        const XLSX = await cargarScript(URL_SHEETJS, "XLSX");
        const hoja = lista.map(x => { const v = viajeDeSalida(x), t = v ? tiemposViaje(v) : {};
          return { "Salida": fechaHora(x.fechaMs), "Carta Porte": x.factura, "Cliente": x.cliente, "Destino": x.destino, "Destino final": destinoFinal(x.destino), "Paradas": paradasDe(x.destino).length,
            "Carga": x.tipo === "seca" ? "SECA" : x.tipo === "refrigerada" ? "REFRIGERADA" : "", "Prog": x.prog, "Remolque": x.remolque, "Propietario remolque": x.linea, "Unidad": x.carro, "Operador": x.operador,
            "Diésel": diesel(x.diesel).txt, "Patio (h)": horasTxt(t.patio), "Tránsito (h)": horasTxt(t.transito), "Destino (h)": horasTxt(t.destino), "Completo (h)": horasTxt(t.completo) }; });
        const libro = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(hoja), "Salidas");
        XLSX.writeFile(libro, `Analisis_salidas_${semanas}sem.xlsx`);
      } catch (e) { error("No se pudo generar el Excel: " + e.message); }
    });
  }

  // ---- Tiempos (Vista general) ----
  let destinoAbierto = null;
  function renderTiempos() {
    let lista = viajesPeriodo().map(v => ({ v, t: tiemposViaje(v) }));
    const clientes = [...new Set(lista.map(x => x.v.cliente).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    if (ft.cliente) lista = lista.filter(x => norm(x.v.cliente) === ft.cliente);
    const raros = lista.filter(x => x.t.raro).length;
    const grupo = (xs) => ({ n: xs.length, patio: mediana(xs.map(x => x.t.patio)), transito: mediana(xs.map(x => x.t.transito)), destino: mediana(xs.map(x => x.t.destino)), completo: mediana(xs.map(x => x.t.completo)),
      conDato: xs.filter(x => x.t.completo != null).length });
    const dir = grupo(lista.filter(x => !x.t.conReparto)), rep = grupo(lista.filter(x => x.t.conReparto)), tod = grupo(lista);
    const vis = ft.tipo === "directo" ? lista.filter(x => !x.t.conReparto) : ft.tipo === "reparto" ? lista.filter(x => x.t.conReparto) : lista;
    const m = new Map(); vis.forEach(x => { const k = destinoFinalViaje(x.v); const nk = norm(k); if (!m.has(nk)) m.set(nk, { nombre: k, xs: [] }); m.get(nk).xs.push(x); });
    const destinos = [...m.entries()].map(([nk, o]) => ({ nk, nombre: o.nombre, ...grupo(o.xs), xs: o.xs })).sort((a, b) => b.n - a.n);
    const g = ft.tipo === "reparto" ? rep : ft.tipo === "directo" ? dir : tod;
    const total = (g.patio || 0) + (g.transito || 0) + (g.destino || 0);
    const seg = (campo, ops) => `<span class="ao-seg">${ops.map(([v, t]) => `<button type="button" class="${ft[campo] === v ? "activo" : ""}" data-ft="${campo}" data-v="${v}">${t}</button>`).join("")}</span>`;
    $("#ao-cuerpo").innerHTML = `
      <div class="ao-filtros">${seg("tipo", [["", "Todos"], ["directo", "Directos"], ["reparto", "Con reparto"]])}
        <select id="ao-t-cli"><option value="">Todos los clientes</option>${clientes.map(c => `<option value="${esc(norm(c))}"${ft.cliente === norm(c) ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
      <p class="nota">Del reporte Vista general: ${miles(lista.length)} viajes en el periodo (todos los estatus). Mediana = el viaje de en medio, para que uno atorado no mueva el número.${raros ? ` ${raros} viaje${raros === 1 ? "" : "s"} con horas imposibles (negativas o de más de 20 días) no cuentan en esa etapa.` : ""}</p>
      <div class="tabla-wrap"><table class="tabla ao-tabla"><thead><tr><th>Tiempo</th><th>Desde → hasta</th><th class="n">Directos (${miles(dir.n)})</th><th class="n">Con reparto (${miles(rep.n)})</th><th class="n">Todos</th></tr></thead>
      <tbody>
        <tr><td><b>En patio</b></td><td>Entrada → salida de patio</td><td class="n">${horas(dir.patio)}</td><td class="n">${horas(rep.patio)}</td><td class="n">${horas(tod.patio)}</td></tr>
        <tr><td><b>En tránsito</b></td><td>Salida → primer arribo</td><td class="n">${horas(dir.transito)}</td><td class="n">${horas(rep.transito)}</td><td class="n">${horas(tod.transito)}</td></tr>
        <tr><td><b>En destino</b></td><td>Primer arribo → última descarga (en reparto incluye el recorrido entre paradas)</td><td class="n">${horas(dir.destino)}</td><td class="n">${horas(rep.destino)}</td><td class="n">${horas(tod.destino)}</td></tr>
        <tr><td><b>Viaje completo</b></td><td>Entrada a patio → última descarga</td><td class="n"><b>${horas(dir.completo)}</b></td><td class="n"><b>${horas(rep.completo)}</b></td><td class="n"><b>${horas(tod.completo)}</b></td></tr>
      </tbody></table></div>
      ${total ? `<div class="ao-tira"><span style="width:${g.patio / total * 100}%;background:#8a6a4a">Patio ${horasTxt(g.patio)} h</span><span style="width:${g.transito / total * 100}%;background:#185FA5">Tránsito ${horasTxt(g.transito)} h</span><span style="width:${g.destino / total * 100}%;background:#3B7A1E">Destino ${horasTxt(g.destino)} h</span></div>` : ""}
      <div class="ao-h3">Por destino final${ft.tipo === "directo" ? " · directos" : ft.tipo === "reparto" ? " · con reparto" : ""}</div>
      <div class="tabla-wrap"><table class="tabla ao-tabla"><thead><tr><th>Destino final</th><th class="n">Viajes</th><th class="n">Patio</th><th class="n">Tránsito</th><th class="n">Destino</th><th class="n">Completo</th><th class="n">Con dato completo</th></tr></thead>
      <tbody>${destinos.map(d => `<tr class="clic" data-td="${esc(d.nk)}"><td>${esc(d.nombre)}</td><td class="n">${miles(d.n)}</td><td class="n">${horas(d.patio)}</td><td class="n">${horas(d.transito)}</td><td class="n">${horas(d.destino)}</td><td class="n"><b>${horas(d.completo)}</b></td><td class="n">${pct(d.conDato, d.n)} %</td></tr>
        ${destinoAbierto === d.nk ? `<tr><td colspan="7" style="background:#faf7f2;">${detalleViajes(d.xs)}</td></tr>` : ""}`).join("")}</tbody></table></div>`;
    $("#ao-cuerpo").querySelectorAll("[data-ft]").forEach(b => b.addEventListener("click", () => { ft[b.dataset.ft] = b.dataset.v; destinoAbierto = null; renderTiempos(); }));
    $("#ao-t-cli").addEventListener("change", (e) => { ft.cliente = e.target.value; destinoAbierto = null; renderTiempos(); });
    $("#ao-cuerpo").querySelectorAll("[data-td]").forEach(tr => tr.addEventListener("click", () => { destinoAbierto = destinoAbierto === tr.dataset.td ? null : tr.dataset.td; renderTiempos(); }));
  }
  function detalleViajes(xs) {
    const orden = xs.slice().sort((a, b) => (b.t.completo || 0) - (a.t.completo || 0)).slice(0, 60);
    return `<div class="tabla-wrap"><table class="tabla ao-tabla" style="background:#fff;"><thead><tr><th>Salida</th><th>Remolque</th><th>Cliente</th><th>Recorrido</th><th>Estatus</th><th class="n">Patio</th><th class="n">Tránsito</th><th class="n">Destino</th><th class="n">Completo</th></tr></thead>
      <tbody>${orden.map(({ v, t }) => `<tr><td>${fechaHora(v.salidaMs || v.entradaMs)}</td><td>${esc(v.remolque)} <small class="nota">${esc(v.linea || "")}</small></td><td>${esc(v.cliente)}</td>
        <td>${(v.paradas || []).length > 1 ? v.paradas.map(p => `<span class="ao-parada" title="Arribo ${fechaHora(p.arriboMs)} · Descarga ${fechaHora(p.descargaMs)}">${esc(p.destino)}</span>`).join("") : esc(v.destino)}</td>
        <td><small class="nota">${esc(v.status || "")}</small></td><td class="n">${horas(t.patio)}</td><td class="n">${horas(t.transito)}</td><td class="n">${horas(t.destino)}</td><td class="n"><b>${horas(t.completo)}</b></td></tr>`).join("")}</tbody></table></div>
      ${xs.length > 60 ? `<p class="nota">Se muestran los 60 más largos de ${xs.length}.</p>` : ""}`;
  }

  // ---- Pegar reportes (admin y Gerente de importaciones) ----
  function renderPegar() {
    const caja = (id, titulo, desc, info) => `<div class="ao-caja"><div class="ao-h3" style="margin-top:0;">${titulo}</div><p class="nota" style="margin-top:0;">${desc}</p>
      <textarea class="ao-pegar" id="ao-p-${id}" placeholder="Pega aquí el reporte con su fila de títulos"></textarea>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;"><button type="button" class="secundario" id="ao-leer-${id}">Leer</button><button type="button" id="ao-guardar-${id}"${pegado[id] ? "" : " disabled"}>Guardar</button></div>
      <div id="ao-info-${id}" class="nota" style="margin-top:8px;">${info || ""}</div></div>`;
    $("#ao-cuerpo").innerHTML = `<div class="ao-dos">
      ${caja("salidas", "1 · Salidas", "Reporte de salidas del Adrematasa (Factura, Fecha Hora, Remolque, Linea, Cliente, Destino, Carro, Operador, Diesel, Prog…). Es la misma base que usa Rentabilidad: no se duplica por Carta Porte.", resumenPegado("salidas"))}
      ${caja("vista", "2 · Vista general", "Reporte Vista general (Remolque, Entrada, Salida, Arribo Impo, Descarga y, en repartos, Destino/Arribo/Descarga Reparto). Una fila por parada; aquí se juntan en un viaje.", resumenPegado("vista"))}
    </div>
    <p class="nota">Puedes pegar uno, el otro o los dos, del rango que quieras. Solo se guardan los registros nuevos o que cambiaron. "LAREDO TX VACIO" se ignora.</p>`;
    ["salidas", "vista"].forEach(id => {
      $(`#ao-leer-${id}`).addEventListener("click", () => leer(id));
      $(`#ao-guardar-${id}`).addEventListener("click", () => guardar(id));
    });
  }
  function resumenPegado(id) {
    const p = pegado[id]; if (!p) return "";
    const ms = p.lista.map(x => id === "salidas" ? x.fechaMs : x.refMs).filter(Boolean);
    const rango = ms.length ? `del ${fechaCorta(Math.min(...ms))} al ${fechaCorta(Math.max(...ms))}` : "";
    if (id === "salidas") return `<b>${miles(p.lista.length)}</b> salidas ${rango}.${p.basura ? ` ${p.basura} de LAREDO TX VACIO ignoradas.` : ""} ${p.cambios == null ? "" : `<b>${miles(p.cambios)}</b> nuevas o con cambios; ${miles(p.lista.length - p.cambios)} ya estaban iguales.`}`;
    const rep = p.lista.filter(v => v.paradas.length > 1).length;
    return `<b>${miles(p.lista.length)}</b> viajes ${rango} (${miles(rep)} con reparto, ${miles(p.filas)} filas).${p.basura ? ` ${p.basura} filas de LAREDO TX VACIO ignoradas.` : ""} ${p.cambios == null ? "" : `<b>${miles(p.cambios)}</b> nuevos o con cambios; ${miles(p.lista.length - p.cambios)} ya estaban iguales.`}`;
  }
  const firma = (o, quitar) => JSON.stringify(Object.keys(o).filter(k => !quitar.includes(k)).sort().map(k => [k, o[k] == null ? null : o[k]]));
  async function leer(id) {
    error();
    const texto = $(`#ao-p-${id}`).value;
    try {
      let lista, basura = 0, filas = 0;
      if (id === "salidas") {
        const todas = leerSalidas(texto);
        lista = todas.filter(s => !esBasura(s.cliente)); basura = todas.length - lista.length;
        lista = [...new Map(lista.map(x => [x.factura, x])).values()];
      } else {
        const r = leerVistaGeneral(texto); lista = r.viajes; basura = r.basura; filas = texto.split(/\r?\n/).filter(l => l.trim()).length - 1;
      }
      // Compara contra lo guardado en ese rango para escribir solo lo nuevo o distinto.
      const campo = id === "salidas" ? "fechaMs" : "refMs", col = id === "salidas" ? COL_SALIDAS : COL_VIAJES;
      const ms = lista.map(x => x[campo]).filter(Boolean);
      const existentes = new Map();
      if (ms.length) {
        const snap = await getDocs(query(collection(db, col), where(campo, ">=", Math.min(...ms)), where(campo, "<=", Math.max(...ms))));
        snap.docs.forEach(d => existentes.set(d.id, d.data()));
      }
      const quitar = ["cargadaMs", "cargadaPor", "id"];
      const cambiadas = lista.filter(x => { const k = id === "salidas" ? x.factura : x.id; const e = existentes.get(k); if (!e) return true; return firma({ ...e, ...x }, quitar) !== firma(e, quitar); });
      pegado[id] = { lista, basura, filas, cambiadas, cambios: cambiadas.length };
    } catch (e) { pegado[id] = null; error(e.message); }
    renderPegar();
    $(`#ao-p-${id}`).value = texto;
  }
  async function guardar(id) {
    const p = pegado[id]; if (!p) return;
    const btn = $(`#ao-guardar-${id}`); if (btn) btn.disabled = true;
    error();
    try {
      const ahora = Date.now(), por = { uid, nombre: yo.nombre || "" };
      const col = id === "salidas" ? COL_SALIDAS : COL_VIAJES;
      for (let i = 0; i < p.cambiadas.length; i += 400) {
        const lote = writeBatch(db);
        p.cambiadas.slice(i, i + 400).forEach(x => {
          const { id: _id, ...datos } = x;
          lote.set(doc(db, col, id === "salidas" ? x.factura : x.id), { ...datos, cargadaMs: ahora, cargadaPor: por }, { merge: true });
        });
        await lote.commit();
      }
      avisar(`${p.cambiadas.length} ${id === "salidas" ? "salida(s)" : "viaje(s)"} guardado(s). ${p.lista.length - p.cambiadas.length} ya estaban iguales.`);
      pegado[id] = null;
      await cargar(true);
      tab = "pegar"; render();
    } catch (e) { error("No se pudo guardar: " + e.message); if (btn) btn.disabled = false; }
  }

  $("#ao-periodo").addEventListener("change", (e) => { semanas = Number(e.target.value); cargar(false); });
  $("#ao-recargar").addEventListener("click", () => cargar(true));
  cargar(true);
}
