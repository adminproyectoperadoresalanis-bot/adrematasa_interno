// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/public/js/analisisOperaciones.js
// ##########################################################################
import { db } from "./firebase-config.js";
import { collection, doc, documentId, getDocs, query, setDoc, where, writeBatch } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { leerSalidas, msFechaAdrematasa } from "./rentabilidad.js";

// ============================================================================
// Utilidades → Análisis de operaciones (2026-11-06, pedido de Ivan).
// Volumen y tiempos de la operación SIN dinero. Dos reportes del Adrematasa
// oficial que se pegan aquí (solo admin y Gerente de importaciones):
//   1) SALIDAS → rentabilidad_salidas/{Carta Porte TAIM}. Es la MISMA colección
//      de Rentabilidad (una sola base: Rentabilidad la cruza con sus facturas).
//      Da volumen (semana lunes a domingo), seca/refrigerada (Prog: OFF =
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
//
// v2 (2026-11-07): para casi no gastar lecturas, todo lo que se ve sale de un
// RESUMEN COMPACTO POR MES: op_resumen_mes/{aaaa-mm} con cada salida y cada
// viaje reducidos a lo mínimo (fecha, cliente, destino, tipo, propietario,
// reparto y las 4 horas). Una semana lee ~4 documentos, un mes ~13, un año 12.
// El resumen se rearma solo al guardar lo pegado (solo los meses que cambiaron)
// o con el botón "Armar resúmenes". El detalle (operador, diésel, paradas) se
// lee solo si se abre la lista de Salidas o el detalle de un destino en
// Tiempos, y solo del periodo elegido.
// Control: Semana · Mes · Año con flechas; se compara contra el periodo
// anterior (si el periodo va en curso, contra el mismo corte) y contra el mismo
// periodo del año pasado. Botones "Copiar" (WhatsApp con *negritas* + tabla
// para Excel o correo).
// ============================================================================

const COL_SALIDAS = "rentabilidad_salidas";
const COL_VIAJES = "op_viajes";
const COL_RESUMEN = "op_resumen_mes";
const URL_SHEETJS = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
const DIA = 864e5, HORA = 36e5, MAX_H = 20 * 24;
const MAX_AUTO = 2500;          // la lista de Salidas se carga sola hasta este tamaño; arriba pide confirmación
const MAX_RESUMEN = 950000;     // bytes; un documento de Firestore aguanta 1 MB

// ---- Utilerías --------------------------------------------------------------
function esc(t) { const d = document.createElement("div"); d.textContent = t == null ? "" : String(t); return d.innerHTML; }
const norm = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const esBasura = (cliente) => norm(cliente) === "LAREDO TX VACIO";
const pad = (n) => String(n).padStart(2, "0");
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_L = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const fechaCorta = (ms) => { if (!ms) return "—"; const d = new Date(ms); return `${d.getDate()} ${MESES[d.getMonth()]}`; };
const fechaHora = (ms) => { if (!ms) return "—"; const d = new Date(ms); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const miles = (n) => Number(n || 0).toLocaleString("es-MX");
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const mediana = (xs) => { const a = xs.filter(x => x != null).sort((p, q) => p - q); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const horas = (h) => h == null ? "—" : (h >= 48 ? `${h.toFixed(1)} h <small class="nota">(${(h / 24).toFixed(1)} d)</small>` : `${h.toFixed(1)} h`);
const horasTxt = (h) => h == null ? "" : Math.round(h * 10) / 10;
const horasCopia = (h) => h == null ? "—" : `${h.toFixed(1)} h`;
const remNorm = (r) => String(r == null ? "" : r).trim().toUpperCase().replace(/^0+(?=\d)/, "");
const paradasDe = (destino) => String(destino || "").split("-").map(s => s.trim()).filter(Boolean);
const destinoFinal = (destino) => { const p = paradasDe(destino); return p.length ? p[p.length - 1] : "SIN DESTINO"; };
const esPropio = (linea) => norm(linea) === "ATASA";
const cambioPct = (a, b) => b ? Math.round((a - b) / b * 100) : null;
const flecha = (c) => c == null ? "" : c > 0 ? `▲ ${c} %` : c < 0 ? `▼ ${-c} %` : "= 0 %";
const chipCambio = (c) => c == null ? "—" : `<span class="${c > 0 ? "ao-sube" : c < 0 ? "ao-baja" : ""}">${flecha(c)}</span>`;
const difHtml = (d) => d > 0 ? `<span class="ao-sube">▲ ${d}</span>` : d < 0 ? `<span class="ao-baja">▼ ${-d}</span>` : "=";
const difTxt = (d) => d > 0 ? `+${d}` : d < 0 ? `${d}` : "0";

// ---- Periodos (semana lunes a domingo, mes, año) -----------------------------
function inicioDe(u, ms) {
  const d = new Date(ms); d.setHours(0, 0, 0, 0);
  if (u === "semana") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  else if (u === "mes") d.setDate(1);
  else d.setMonth(0, 1);
  return d.getTime();
}
// Se mueve con el calendario (no sumando milisegundos) para no fallar con el horario de verano.
function mover(u, ms, n) {
  const d = new Date(ms);
  if (u === "semana") d.setDate(d.getDate() + 7 * n);
  else if (u === "mes") d.setMonth(d.getMonth() + n);
  else d.setFullYear(d.getFullYear() + n);
  return d.getTime();
}
function etiquetaPeriodo(u, ini) {
  const d = new Date(ini);
  if (u === "anio") return String(d.getFullYear());
  if (u === "mes") return `${MESES_L[d.getMonth()]} ${d.getFullYear()}`;
  const f = new Date(mover(u, ini, 1) - DIA / 2);
  const anioIni = d.getFullYear() !== f.getFullYear() ? ` ${d.getFullYear()}` : "";
  return `${d.getDate()} ${MESES[d.getMonth()]}${anioIni} – ${f.getDate()} ${MESES[f.getMonth()]} ${f.getFullYear()}`;
}
function etiquetaCorta(u, ini) {
  const d = new Date(ini);
  if (u === "anio") return String(d.getFullYear());
  if (u === "mes") return `${MESES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
  return fechaCorta(ini);
}
const NOMBRE_U = { semana: "semana", mes: "mes", anio: "año" };
const ANTERIOR_U = { semana: "la semana anterior", mes: "el mes anterior", anio: "el año anterior" };
const MISMO_U = { semana: "la misma semana del año pasado", mes: "el mismo mes del año pasado" };
const mesKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const msDeMes = (k) => { const [y, m] = k.split("-").map(Number); return new Date(y, m - 1, 1).getTime(); };
const mesSiguiente = (k) => { const [y, m] = k.split("-").map(Number); return mesKey(new Date(y, m, 1).getTime()); };
function mesesEntre(a, b) {            // meses que tocan el rango [a, b)
  const out = []; if (!(b > a)) return out;
  let k = mesKey(a); const ult = mesKey(b - 1);
  while (k <= ult) { out.push(k); k = mesSiguiente(k); }
  return out;
}
function mesesEntreClaves(a, b) { const out = []; let k = a; while (k <= b) { out.push(k); k = mesSiguiente(k); } return out; }

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

// ---- Resumen compacto por mes ------------------------------------------------
// Firestore no acepta arreglos dentro de arreglos: cada lista se guarda como texto JSON.
// Salida: [fechaMs, cliente, destino, tipo r/s, propietario remolque]
// Viaje:  [refMs, cliente, destino final, reparto 0/1, patio, tránsito, destino, completo, raro 0/1]
const tipoCod = (t) => t === "refrigerada" ? "r" : t === "seca" ? "s" : "";
const r2 = (h) => h == null ? null : Math.round(h * 100) / 100;
const compactarSalida = (s) => [s.fechaMs, s.cliente || "", s.destino || "", tipoCod(s.tipo), s.linea || ""];
function compactarViaje(v) { const t = tiemposViaje(v); return [v.refMs, v.cliente || "", destinoFinalViaje(v), t.conReparto ? 1 : 0, r2(t.patio), r2(t.transito), r2(t.destino), r2(t.completo), t.raro ? 1 : 0]; }
const salidaDe = (a) => ({ f: a[0], cliente: a[1], destino: a[2], tipo: a[3] === "r" ? "refrigerada" : a[3] === "s" ? "seca" : "", linea: a[4] });
const viajeDe = (a) => ({ f: a[0], cliente: a[1], destinoFinal: a[2], conReparto: !!a[3], patio: a[4], transito: a[5], destino: a[6], completo: a[7], raro: !!a[8] });
function decodificar(d) {
  return { s: JSON.parse(d.s || "[]").map(salidaDe), v: JSON.parse(d.v || "[]").map(viajeDe), ultimaCargaMs: d.ultimaCargaMs || 0, armadoMs: d.armadoMs || 0 };
}
// Lee del detalle las salidas y viajes de un mes y reescribe su resumen. Regresa {datos, lecturas}.
async function rearmarMes(mes, por) {
  const a = msDeMes(mes), b = msDeMes(mesSiguiente(mes));
  const [s1, s2] = await Promise.all([
    getDocs(query(collection(db, COL_SALIDAS), where("fechaMs", ">=", a), where("fechaMs", "<", b))),
    getDocs(query(collection(db, COL_VIAJES), where("refMs", ">=", a), where("refMs", "<", b))),
  ]);
  const sal = s1.docs.map(d => d.data()).filter(x => x.fechaMs && !esBasura(x.cliente)).sort((p, q) => p.fechaMs - q.fechaMs);
  const via = s2.docs.map(d => d.data()).filter(x => x.refMs && !esBasura(x.cliente)).sort((p, q) => p.refMs - q.refMs);
  const s = JSON.stringify(sal.map(compactarSalida)), v = JSON.stringify(via.map(compactarViaje));
  if (s.length + v.length > MAX_RESUMEN) throw new Error(`El resumen de ${mes} quedó demasiado grande (${miles(s.length + v.length)} caracteres). Avísale a Claude.`);
  let ultimaCargaMs = 0;
  sal.concat(via).forEach(x => { if ((x.cargadaMs || 0) > ultimaCargaMs) ultimaCargaMs = x.cargadaMs; });
  const datos = { mes, s, v, ns: sal.length, nv: via.length, ultimaCargaMs, armadoMs: Date.now(), armadoPor: por };
  await setDoc(doc(db, COL_RESUMEN, mes), datos);
  return { datos, lecturas: Math.max(1, s1.size) + Math.max(1, s2.size) };
}

// ---- Copiar (WhatsApp con *negritas* + HTML para Excel / correo) ------------
const waAHtml = (t) => esc(t).replace(/\*([^*\n]+)\*/g, "<b>$1</b>").replace(/\n/g, "<br>");
function tablaHtml(titulo, cols, filas) {
  const td = (v, i) => `<td style="border:1px solid #ccc;padding:3px 8px;${i ? "text-align:right;" : ""}">${esc(v)}</td>`;
  return `<b>${esc(titulo)}</b><table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:12px;"><tr>${cols.map(c => `<th style="border:1px solid #ccc;padding:3px 8px;background:#eee;">${esc(c)}</th>`).join("")}</tr>${filas.map(f => `<tr>${f.map(td).join("")}</tr>`).join("")}</table>`;
}
async function copiarAlPortapapeles(texto, html) {
  try {
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([texto], { type: "text/plain" }), "text/html": new Blob([html || waAHtml(texto)], { type: "text/html" }) })]);
      return true;
    }
  } catch (e) { /* sigue con texto simple */ }
  try { await navigator.clipboard.writeText(texto); return true; } catch (e) { /* sigue con el método viejo */ }
  const ta = document.createElement("textarea");
  ta.value = texto; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}

function cargarScript(url, global) {
  if (window[global]) return Promise.resolve(window[global]);
  return new Promise((ok, mal) => { const s = document.createElement("script"); s.src = url; s.onload = () => ok(window[global]); s.onerror = () => mal(new Error("No se pudo cargar " + url)); document.head.appendChild(s); });
}

function inyectarEstilos() {
  if (document.getElementById("estilos-analisis-op-2")) return;
  const viejo = document.getElementById("estilos-analisis-op"); if (viejo) viejo.remove();
  const s = document.createElement("style");
  s.id = "estilos-analisis-op-2";
  s.textContent = `
    .ao-ctl { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:12px 0 4px; }
    .ao-nav { display:inline-flex; align-items:center; border:1px solid #e2ddd5; border-radius:9px; background:#fff; }
    .ao-nav button { background:none; border:0; padding:6px 11px; font:inherit; font-size:16px; line-height:1; color:#2c1e0f; cursor:pointer; }
    .ao-nav button:disabled { color:#cfc8bf; cursor:default; }
    .ao-nav b { padding:6px 4px; font-size:13.5px; min-width:150px; text-align:center; white-space:nowrap; }
    .ao-btn { background:#fff; color:#2c1e0f; border:1px solid #e2ddd5; border-radius:9px; padding:6px 11px; font:inherit; font-size:12.5px; font-weight:600; cursor:pointer; white-space:nowrap; }
    .ao-btn.ok { color:#3B7A1E; border-color:#3B7A1E; }
    .ao-ctl .ao-cp-todo { margin-left:auto; }
    .ao-tabs { display:flex; gap:6px; flex-wrap:wrap; margin:12px 0 14px; }
    .ao-tab { background:#fff; border:1px solid #e2ddd5; border-radius:16px; padding:6px 13px; font:inherit; font-size:13px; color:#6b5f52; cursor:pointer; }
    .ao-tab.activo { background:#2c1e0f; border-color:#2c1e0f; color:#fff; }
    .ao-filtros { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:12px; }
    .ao-filtros select, .ao-filtros input { width:auto; min-width:140px; }
    .ao-seg { display:inline-flex; border:1px solid #e2ddd5; border-radius:9px; overflow:hidden; }
    .ao-seg button { background:#fff; border:0; border-left:1px solid #e2ddd5; border-radius:0; padding:6px 11px; font:inherit; font-size:12.5px; color:#6b5f52; cursor:pointer; }
    .ao-seg button:first-child { border-left:0; } .ao-seg button.activo { background:#2c1e0f; color:#fff; font-weight:700; }
    .ao-kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin-bottom:14px; }
    .ao-kpi { border:1px solid #e2ddd5; border-radius:12px; padding:11px 13px; background:#fff; }
    .ao-kpi b { display:block; font-size:21px; } .ao-kpi small { color:#8a7f73; font-size:11.5px; line-height:1.4; display:block; }
    .ao-kpi.hero { background:#2c1e0f; color:#fff; border-color:#2c1e0f; } .ao-kpi.hero small { color:#e8dccd; }
    .ao-sube { color:#3B7A1E; font-weight:700; } .ao-baja { color:#A32D2D; font-weight:700; }
    .ao-h3 { font-size:12px; margin:18px 0 8px; color:#6b5f52; text-transform:uppercase; letter-spacing:.4px; font-weight:700; }
    .ao-card { border:1px solid #e2ddd5; border-radius:14px; padding:12px 14px; background:#fff; margin-bottom:14px; min-width:0; }
    .ao-card-h { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
    .ao-card-h .ao-h3 { margin:0; } .ao-card-h .ao-btn { margin-left:auto; }
    .ao-graf { display:flex; align-items:flex-end; gap:6px; height:160px; padding:8px 2px 0; border-bottom:1px solid #e2ddd5; }
    .ao-col { flex:1; min-width:0; display:flex; flex-direction:column; justify-content:flex-end; align-items:center; cursor:pointer; }
    .ao-col i { display:block; width:100%; max-width:42px; } .ao-col .s { background:#C68A2E; } .ao-col .r { background:#185FA5; border-radius:4px 4px 0 0; }
    .ao-col b { font-size:11px; margin-bottom:3px; } .ao-col.parcial i { opacity:.45; }
    .ao-col.sel i { outline:2px solid #2c1e0f; outline-offset:1px; } .ao-col.sel b { color:#2c1e0f; font-size:12px; }
    .ao-ejes { display:flex; gap:6px; padding:4px 2px 0; } .ao-ejes span { flex:1; min-width:0; text-align:center; font-size:10px; color:#6b5f52; overflow:hidden; white-space:nowrap; }
    .ao-ejes span.sel { color:#2c1e0f; font-weight:800; }
    .ao-ley { display:flex; gap:14px; font-size:11.5px; color:#6b5f52; margin-top:8px; flex-wrap:wrap; } .ao-ley i { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:5px; vertical-align:-1px; }
    .ao-dos { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:14px; }
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
    .ao-pie { margin-top:14px; font-size:11px; color:#a0968b; }
    @media (max-width:620px) { .ao-ctl .ao-cp-todo { margin-left:0; } .ao-nav b { min-width:0; } .ao-graf { gap:3px; } .ao-ejes { gap:3px; } .ao-ejes span { font-size:9px; overflow:visible; } .ao-ejes span.alt { visibility:hidden; } .ao-col b { font-size:9.5px; } }
  `;
  document.head.appendChild(s);
}

// ---- Pantalla -----------------------------------------------------------------
// datosUsuario: ficha de usuarios; uid. Pegan los reportes y arman resúmenes:
// admin y el puesto que diga "Gerente … impo…" (firestore.rules exige lo mismo).
export function iniciarAnalisisOperaciones(contenedor, datosUsuario, uid) {
  inyectarEstilos();
  const yo = datosUsuario || {};
  const puedePegar = yo.rol === "admin" || /gerente.*impo/i.test(String(yo.puesto || "").normalize("NFD").replace(/[̀-ͯ]/g, ""));
  const por = { uid, nombre: yo.nombre || "" };
  contenedor.innerHTML = `
    <section class="panel">
      <h2 style="margin:0;">Análisis de operaciones</h2><p class="nota" id="ao-sub" style="margin:3px 0 0;">Salidas y viajes del Adrematasa oficial.</p>
      <div class="ao-ctl">
        <span class="ao-seg" id="ao-unidad"></span>
        <span class="ao-nav"><button type="button" id="ao-prev" title="Periodo anterior">‹</button><b id="ao-etq"></b><button type="button" id="ao-next" title="Periodo siguiente">›</button></span>
        <button type="button" class="ao-btn" id="ao-hoy">Hoy</button>
        <button type="button" class="ao-btn ao-cp-todo" id="ao-cp-todo">⧉ Copiar resumen</button>
      </div>
      <div class="ao-tabs" id="ao-tabs"></div>
      <div id="ao-error" class="error"></div>
      <p id="ao-exito" class="nota oculto" style="color:#1c7a41;"></p>
      <div id="ao-cuerpo"><p class="nota">Cargando…</p></div>
      <p class="ao-pie" id="ao-pie"></p>
    </section>`;
  const $ = (s) => contenedor.querySelector(s);
  const avisar = (t, fijo) => { const e = $("#ao-exito"); e.textContent = t; e.classList.remove("oculto"); if (!fijo) setTimeout(() => e.classList.add("oculto"), 7000); };
  const error = (t) => { $("#ao-error").textContent = t || ""; };

  let tab = "resumen";
  const st = { u: "semana", ini: inicioDe("semana", Date.now()) };
  const meses = new Map();               // "aaaa-mm" → resumen decodificado | null (no existe)
  let cargando = false, lecturas = 0;
  const det = { salidas: { clave: null, lista: null, cargando: false }, viajes: { clave: null, lista: null, cargando: false } };
  const f = { carga: "", linea: "", q: "", cliente: "", destino: "", pagina: 0 };   // filtros de salidas
  const ft = { tipo: "", cliente: "" };                                               // filtros de tiempos
  let destinoAbierto = null;
  let pegado = { salidas: null, vista: null };
  let copias = {};                       // id del botón → { texto, html }

  // ---- Rangos del periodo elegido ----
  function rangos() {
    const u = st.u, ini = st.ini, fin = mover(u, ini, 1), ahora = Date.now();
    const enCurso = ahora >= ini && ahora < fin;
    const corte = enCurso ? ahora - ini : null;
    const pIni = mover(u, ini, -1);
    const pFin = corte != null ? Math.min(ini, pIni + corte) : ini;
    let lyIni = null, lyFin = null, lyFinCompleto = null;
    if (u !== "anio") {
      lyIni = mover(u, ini, u === "semana" ? -52 : -12);
      lyFinCompleto = mover(u, lyIni, 1);
      lyFin = corte != null ? Math.min(lyFinCompleto, lyIni + corte) : lyFinCompleto;
    }
    const n = u === "anio" ? 5 : 12;
    const unidades = [];
    for (let i = n - 1; i >= 0; i--) { const a = mover(u, ini, -i); unidades.push({ a, b: mover(u, a, 1) }); }
    return { u, ini, fin, enCurso, pIni, pFin, lyIni, lyFin, lyFinCompleto, unidades, tIni: unidades[0].a, clave: `${ini}_${fin}` };
  }

  // ---- Lectura de resúmenes (solo los meses que falten; un query por tramo seguido) ----
  async function asegurarMeses(lista) {
    const faltan = [...new Set(lista)].filter(k => !meses.has(k)).sort();
    if (!faltan.length) return;
    const tramos = []; let t = null;
    faltan.forEach(k => { if (t && k === mesSiguiente(t[1])) t[1] = k; else { t = [k, k]; tramos.push(t); } });
    await Promise.all(tramos.map(async ([a, b]) => {
      const snap = await getDocs(query(collection(db, COL_RESUMEN), where(documentId(), ">=", a), where(documentId(), "<=", b)));
      lecturas += Math.max(1, snap.size);
      const enc = new Map(snap.docs.map(d => [d.id, d.data()]));
      mesesEntreClaves(a, b).forEach(k => meses.set(k, enc.has(k) ? decodificar(enc.get(k)) : null));
    }));
  }
  async function cargarVista() {
    const r = rangos();
    const lista = mesesEntre(r.tIni, r.fin).concat(r.lyIni ? mesesEntre(r.lyIni, r.lyFinCompleto) : []);
    if (lista.every(k => meses.has(k))) { render(); return; }
    cargando = true; render();
    try { await asegurarMeses(lista); error(); } catch (e) { error("No se pudieron leer los resúmenes: " + e.message); }
    cargando = false;
    render();
  }

  // Detalle completo (operador, diésel, paradas) solo del periodo elegido y solo cuando se pide.
  async function cargarDet(tipo) {
    const r = rangos(), d = det[tipo];
    if (d.clave === r.clave && (d.lista || d.cargando)) return;
    d.clave = r.clave; d.lista = null; d.cargando = true;
    render();
    try {
      const q = tipo === "salidas"
        ? query(collection(db, COL_SALIDAS), where("fechaMs", ">=", r.ini), where("fechaMs", "<", r.fin))
        : query(collection(db, COL_VIAJES), where("refMs", ">=", r.ini - 6 * HORA), where("refMs", "<", r.fin + 6 * HORA));
      const snap = await getDocs(q);
      lecturas += Math.max(1, snap.size);
      if (d.clave === r.clave) d.lista = snap.docs.map(x => ({ id: x.id, ...x.data() })).filter(x => !esBasura(x.cliente));
    } catch (e) { if (d.clave === r.clave) d.clave = null; error("No se pudo leer el detalle: " + e.message); }
    if (d.clave === r.clave || d.clave == null) d.cargando = false;
    render();
  }
  const detListo = (tipo) => det[tipo].clave === rangos().clave && det[tipo].lista;

  // ---- Datos del periodo desde los resúmenes ----
  function salidasEn(a, b) { const out = []; mesesEntre(a, b).forEach(k => { const m = meses.get(k); if (m) m.s.forEach(x => { if (x.f >= a && x.f < b) out.push(x); }); }); return out; }
  function viajesEn(a, b) { const out = []; mesesEntre(a, b).forEach(k => { const m = meses.get(k); if (m) m.v.forEach(x => { if (x.f >= a && x.f < b) out.push(x); }); }); return out; }
  const filtrar = (lista) => lista.filter(s =>
    (!f.carga || s.tipo === f.carga) &&
    (!f.linea || (f.linea === "propio" ? esPropio(s.linea) : !esPropio(s.linea))));
  const filtrarDetalle = (lista) => filtrar(lista).filter(s =>
    (!f.cliente || norm(s.cliente) === f.cliente) &&
    (!f.destino || norm(destinoFinal(s.destino)) === f.destino));
  const conteo = (xs) => ({ n: xs.length, r: xs.filter(x => x.tipo === "refrigerada").length, s: xs.filter(x => x.tipo === "seca").length,
    rep: xs.filter(x => paradasDe(x.destino).length > 1).length, prop: xs.filter(x => esPropio(x.linea)).length });
  const ranking = (xs, clave) => { const m = new Map(); xs.forEach(s => { const k = clave(s); if (!m.has(k)) m.set(k, []); m.get(k).push(s); }); return [...m.entries()].sort((a, b) => b[1].length - a[1].length); };
  const grupoT = (xs) => ({ n: xs.length, patio: mediana(xs.map(x => x.patio)), transito: mediana(xs.map(x => x.transito)), destino: mediana(xs.map(x => x.destino)), completo: mediana(xs.map(x => x.completo)), conDato: xs.filter(x => x.completo != null).length });
  const textoFiltros = () => [f.carga === "refrigerada" ? "solo refrigerada" : f.carga === "seca" ? "solo seca" : "", f.linea === "propio" ? "solo remolques propios" : f.linea === "intercambio" ? "solo intercambio" : ""].filter(Boolean).join(" · ");
  const tituloCopia = (r) => { const e = etiquetaPeriodo(r.u, r.ini); const fl = textoFiltros(); return `Salidas ${r.u === "semana" ? "semana " : ""}${e}${r.enCurso ? " (en curso)" : ""}${fl ? ` · ${fl}` : ""}`; };
  const textoVsAnt = (r) => r.enCurso ? `vs. ${ANTERIOR_U[r.u]} al mismo corte` : `vs. ${ANTERIOR_U[r.u]}`;

  // ---- Encabezado: unidad, flechas, copiar ----
  function renderControl() {
    const r = rangos();
    $("#ao-unidad").innerHTML = Object.entries({ semana: "Semana", mes: "Mes", anio: "Año" }).map(([k, t]) => `<button type="button" class="${st.u === k ? "activo" : ""}" data-u="${k}">${t}</button>`).join("");
    $("#ao-unidad").querySelectorAll("[data-u]").forEach(b => b.addEventListener("click", () => { st.u = b.dataset.u; st.ini = inicioDe(st.u, Date.now()); alCambiarPeriodo(); }));
    $("#ao-etq").textContent = etiquetaPeriodo(r.u, r.ini);
    $("#ao-next").disabled = r.fin > Date.now();
    $("#ao-hoy").disabled = r.enCurso;
    const oculto = tab === "pegar";
    $("#ao-cp-todo").style.visibility = oculto ? "hidden" : "visible";
    let ult = 0; meses.forEach(m => { if (m && m.ultimaCargaMs > ult) ult = m.ultimaCargaMs; });
    $("#ao-sub").textContent = ult ? `Salidas y viajes del Adrematasa oficial · última carga ${fechaHora(ult)}` : "Salidas y viajes del Adrematasa oficial.";
    $("#ao-pie").textContent = `Lecturas de esta pantalla desde que la abriste: ${miles(lecturas)} documentos.`;
  }
  function alCambiarPeriodo() { f.pagina = 0; destinoAbierto = null; cargarVista(); }

  function renderTabs() {
    const ts = [["resumen", "Resumen"], ["tiempos", "Tiempos"], ["clientes", "Clientes"], ["destinos", "Destinos"], ["remolques", "Remolques"], ["salidas", "Salidas"]];
    if (puedePegar) ts.push(["pegar", "Pegar reportes"]);
    $("#ao-tabs").innerHTML = ts.map(([k, t]) => `<button type="button" class="ao-tab${tab === k ? " activo" : ""}" data-t="${k}">${t}</button>`).join("");
    $("#ao-tabs").querySelectorAll("[data-t]").forEach(b => b.addEventListener("click", () => { tab = b.dataset.t; f.pagina = 0; render(); }));
  }
  function render() {
    copias = {};
    renderTabs();
    renderControl();
    if (tab === "pegar") return renderPegar();
    if (cargando) { $("#ao-cuerpo").innerHTML = `<p class="nota">Cargando…</p>`; return; }
    const r = rangos();
    const hayAlgo = mesesEntre(r.tIni, r.fin).some(k => meses.get(k) && (meses.get(k).s.length || meses.get(k).v.length));
    if (!hayAlgo) {
      $("#ao-cuerpo").innerHTML = `<p class="nota">No hay salidas ni viajes en este periodo ni en los anteriores que se comparan.${puedePegar ? ` Si ya pegaste reportes y es la primera vez con esta versión, ve a <b>Pegar reportes → Armar resúmenes</b>.` : ""}</p>`;
      return;
    }
    if (tab === "tiempos") renderTiempos();
    else if (tab === "clientes") renderClientes();
    else if (tab === "destinos") renderDestinos();
    else if (tab === "remolques") renderRemolques();
    else if (tab === "salidas") renderSalidas();
    else renderResumen();
    enlazarCopias();
  }
  // Botón copiar: registra el contenido y regresa el HTML del botón.
  function botonCopiar(id, texto, html) { copias[id] = { texto, html }; return `<button type="button" class="ao-btn" data-cp="${id}">⧉ Copiar</button>`; }
  function enlazarCopias() {
    $("#ao-cuerpo").querySelectorAll("[data-cp]").forEach(b => b.addEventListener("click", async () => {
      const c = copias[b.dataset.cp]; if (!c) return;
      marcarCopiado(b, await copiarAlPortapapeles(c.texto, c.html));
    }));
  }
  function marcarCopiado(b, ok) {
    const t = b.textContent;
    b.textContent = ok ? "✓ Copiado" : "No se pudo copiar"; b.classList.toggle("ok", ok);
    setTimeout(() => { b.textContent = t; b.classList.remove("ok"); }, 1600);
  }
  // Tabla copiable: WhatsApp = lista con *negritas*; Excel/correo = tabla.
  function copiaTabla(titulo, cols, filas, lineaWa) {
    return { texto: `*${titulo}*\n${filas.map(lineaWa).join("\n")}`, html: tablaHtml(titulo, cols, filas) };
  }

  // Filtros comunes de las pestañas de salidas.
  function barraFiltros(conCliente) {
    const seg = (campo, ops) => `<span class="ao-seg">${ops.map(([v, t]) => `<button type="button" class="${f[campo] === v ? "activo" : ""}" data-f="${campo}" data-v="${v}">${t}</button>`).join("")}</span>`;
    return `<div class="ao-filtros">${seg("carga", [["", "Todas"], ["refrigerada", "Refrigerada"], ["seca", "Seca"]])} ${seg("linea", [["", "Todos los remolques"], ["propio", "Propios ATASA"], ["intercambio", "Intercambio"]])}
      ${conCliente && (f.cliente || f.destino) ? `<span class="ao-chip ao-gris">${esc(f.cliente || f.destino)} <button type="button" class="ao-link" id="ao-quitar" style="text-decoration:none;color:#A32D2D;">✕</button></span>` : ""}</div>`;
  }
  function enlazarFiltros() {
    $("#ao-cuerpo").querySelectorAll("[data-f]").forEach(b => b.addEventListener("click", () => { f[b.dataset.f] = b.dataset.v; f.pagina = 0; render(); }));
    const q = $("#ao-quitar"); if (q) q.addEventListener("click", () => { f.cliente = ""; f.destino = ""; f.pagina = 0; render(); });
  }
  const barraTipo = (s) => { const t = s.length, r = s.filter(x => x.tipo === "refrigerada").length, se = s.filter(x => x.tipo === "seca").length; return `<div class="ao-barra" title="Refrigerada ${r} · Seca ${se}"><span class="ao-br" style="width:${pct(r, t)}%"></span><span class="ao-bs" style="width:${pct(se, t)}%"></span></div>`; };
  function enlazarAbrirSalidas() {
    $("#ao-cuerpo").querySelectorAll("[data-cli]").forEach(tr => tr.addEventListener("click", () => { f.cliente = tr.dataset.cli; f.destino = ""; f.pagina = 0; tab = "salidas"; render(); }));
    $("#ao-cuerpo").querySelectorAll("[data-dest]").forEach(tr => tr.addEventListener("click", () => { f.destino = tr.dataset.dest; f.cliente = ""; f.pagina = 0; tab = "salidas"; render(); }));
  }
  function enlazarBarras() {
    const r = rangos();
    $("#ao-cuerpo").querySelectorAll("[data-ui]").forEach(c => c.addEventListener("click", () => { st.ini = r.unidades[Number(c.dataset.ui)].a; alCambiarPeriodo(); }));
  }
  // Barras de la tendencia (12 semanas o meses, hasta 5 años), la elegida marcada.
  function graficaTendencia(r, datos) {
    const max = Math.max(1, ...datos.map(x => x.n));
    const ahora = Date.now();
    return `<div class="ao-graf">${datos.map((x, i) => `<div class="ao-col${x.a === r.ini ? " sel" : ""}${ahora >= x.a && ahora < x.b ? " parcial" : ""}" data-ui="${i}" title="${etiquetaPeriodo(r.u, x.a)}: ${x.n} salidas · refrigerada ${x.r} · seca ${x.s}"><b>${x.n ? (x.n >= 10000 ? (x.n / 1000).toFixed(1) + "k" : x.n) : ""}</b><i class="r" style="height:${Math.round(x.r / max * 130)}px"></i><i class="s" style="height:${Math.round(x.s / max * 130)}px"></i></div>`).join("")}</div>
      <div class="ao-ejes">${datos.map((x, i) => `<span class="${x.a === r.ini ? "sel" : (datos.length - 1 - i) % 2 ? "alt" : ""}">${etiquetaCorta(r.u, x.a)}</span>`).join("")}</div>`;
  }

  // ---- Copiar resumen (botón de arriba) ----
  function textoResumen() {
    const r = rangos();
    const act = filtrar(salidasEn(r.ini, r.fin)), ant = filtrar(salidasEn(r.pIni, r.pFin));
    const c = conteo(act), cam = cambioPct(act.length, ant.length);
    const vj = viajesEn(r.ini, r.fin);
    const dir = grupoT(vj.filter(x => !x.conReparto)), rep = grupoT(vj.filter(x => x.conReparto));
    const top = ranking(act, s => s.cliente || "SIN CLIENTE").slice(0, 3);
    const l = [`*${tituloCopia(r)}*`, `Total: *${miles(c.n)}*${ant.length ? ` (${flecha(cam)} ${textoVsAnt(r)}: ${miles(ant.length)})` : ""}`];
    if (r.lyIni) { const ly = filtrar(salidasEn(r.lyIni, r.lyFin)); if (ly.length) l.push(`${flecha(cambioPct(act.length, ly.length))} vs. ${MISMO_U[r.u]} (${miles(ly.length)})`); }
    l.push(`Refrigerada ${pct(c.r, c.n)} % · Seca ${pct(c.s, c.n)} %`, `Con reparto ${pct(c.rep, c.n)} % · Intercambio ${pct(c.n - c.prop, c.n)} %`);
    if (top.length) { l.push("", "*Top clientes*"); top.forEach(([k, xs], i) => l.push(`${i + 1}. ${k} *${miles(xs.length)}*`)); }
    if (dir.completo != null || rep.completo != null) l.push("", "*Tiempo de viaje (mediana)*", `Directos *${horasCopia(dir.completo)}* · Con reparto *${horasCopia(rep.completo)}*`);
    return l.join("\n");
  }

  // ---- Resumen ----
  function renderResumen() {
    const r = rangos();
    const act = filtrar(salidasEn(r.ini, r.fin)), ant = filtrar(salidasEn(r.pIni, r.pFin));
    const ly = r.lyIni ? filtrar(salidasEn(r.lyIni, r.lyFin)) : [];
    const c = conteo(act), cam = cambioPct(act.length, ant.length);
    const vj = viajesEn(r.ini, r.fin);
    const dir = grupoT(vj.filter(x => !x.conReparto)), rep = grupoT(vj.filter(x => x.conReparto));
    const tend = r.unidades.map(x => ({ ...x, ...conteo(filtrar(salidasEn(x.a, x.b))) }));
    const antPor = (clave) => { const m = new Map(); ant.forEach(s => { const k = clave(s); m.set(k, (m.get(k) || 0) + 1); }); return m; };
    const cliK = s => s.cliente || "SIN CLIENTE", desK = s => destinoFinal(s.destino);
    const antCli = antPor(cliK), antDes = antPor(desK);
    const topCli = ranking(act, cliK).slice(0, 8), topDes = ranking(act, desK).slice(0, 8);
    const nomU = NOMBRE_U[r.u];
    const tit = tituloCopia(r);
    $("#ao-cuerpo").innerHTML = `${barraFiltros(false)}
      <div class="ao-kpis">
        <div class="ao-kpi hero"><b>${miles(c.n)}</b><small>Salidas ${r.u === "anio" ? "en el año" : `en ${r.u === "mes" ? "el mes" : "la semana"}`}${r.enCurso ? " (en curso)" : ""}</small></div>
        ${ant.length ? `<div class="ao-kpi"><b>${chipCambio(cam)}</b><small>${textoVsAnt(r)} (${miles(ant.length)})</small></div>` : ""}
        ${r.lyIni && ly.length ? `<div class="ao-kpi"><b>${chipCambio(cambioPct(act.length, ly.length))}</b><small>vs. ${MISMO_U[r.u]}${r.enCurso ? " al mismo corte" : ""} (${miles(ly.length)})</small></div>` : ""}
        <div class="ao-kpi"><b>${pct(c.r, c.n)} % · ${pct(c.s, c.n)} %</b><small>Refrigerada · Seca</small></div>
        <div class="ao-kpi"><b>${pct(c.rep, c.n)} %</b><small>Con reparto (${miles(c.rep)} de ${miles(c.n)})</small></div>
        <div class="ao-kpi"><b>${pct(c.prop, c.n)} % · ${pct(c.n - c.prop, c.n)} %</b><small>Remolque propio ATASA · intercambio</small></div>
        <div class="ao-kpi"><b>${dir.completo == null ? "—" : `${horasTxt(dir.completo)} h`}</b><small>Viaje completo directo (mediana)${rep.completo != null ? ` · con reparto ${horasTxt(rep.completo)} h` : ""}</small></div>
      </div>
      <div class="ao-card">
        <div class="ao-card-h"><div class="ao-h3">Tendencia · ${r.u === "anio" ? "por año" : `últimas 12 ${r.u === "mes" ? "meses" : "semanas"}`}</div>
          ${botonCopiar("tend", ...Object.values(copiaTabla(`Salidas por ${nomU}${textoFiltros() ? ` · ${textoFiltros()}` : ""}`, [r.u === "semana" ? "Semana (lunes)" : r.u === "mes" ? "Mes" : "Año", "Salidas", "Refrigerada", "Seca"],
            tend.map(x => [etiquetaCorta(r.u, x.a), x.n, x.r, x.s]), (f) => `${f[0]}: *${miles(f[1])}*`)))}</div>
        ${graficaTendencia(r, tend)}
        <div class="ao-ley"><span><i style="background:#185FA5"></i>Refrigerada</span><span><i style="background:#C68A2E"></i>Seca (Prog OFF)</span><span>El periodo en curso va en tono claro. Toca una barra para ir a ese periodo.</span></div>
      </div>
      <div class="ao-dos">
        <div class="ao-card"><div class="ao-card-h"><div class="ao-h3">Top clientes</div>
          ${botonCopiar("cli", ...Object.values(copiaTabla(`Top clientes · ${tit.replace(/^Salidas /, "")}`, ["Cliente", "Salidas", "vs. ant."], topCli.map(([k, xs]) => [k, xs.length, difTxt(xs.length - (antCli.get(k) || 0))]), (f, i) => `${i + 1}. ${f[0]} *${miles(f[1])}* (${f[2]})`)))}</div>
          <div class="tabla-wrap"><table class="tabla ao-tabla"><thead><tr><th>Cliente</th><th class="n">Salidas</th><th class="n">vs. ant.</th></tr></thead>
          <tbody>${topCli.map(([k, xs]) => `<tr class="clic" data-cli="${esc(norm(k))}"><td>${esc(k)}</td><td class="n"><b>${miles(xs.length)}</b></td><td class="n">${difHtml(xs.length - (antCli.get(k) || 0))}</td></tr>`).join("")}</tbody></table></div></div>
        <div class="ao-card"><div class="ao-card-h"><div class="ao-h3">Top destinos (destino final)</div>
          ${botonCopiar("des", ...Object.values(copiaTabla(`Top destinos · ${tit.replace(/^Salidas /, "")}`, ["Destino", "Salidas", "vs. ant."], topDes.map(([k, xs]) => [k, xs.length, difTxt(xs.length - (antDes.get(k) || 0))]), (f, i) => `${i + 1}. ${f[0]} *${miles(f[1])}* (${f[2]})`)))}</div>
          <div class="tabla-wrap"><table class="tabla ao-tabla"><thead><tr><th>Destino</th><th class="n">Salidas</th><th>Refri / Seca</th><th class="n">vs. ant.</th></tr></thead>
          <tbody>${topDes.map(([k, xs]) => { const rp = xs.filter(s => paradasDe(s.destino).length > 1).length; return `<tr class="clic" data-dest="${esc(norm(k))}"><td>${esc(k)}${rp ? ` <span class="ao-chip ao-rep">${rp} vía reparto</span>` : ""}</td><td class="n"><b>${miles(xs.length)}</b></td><td>${barraTipo(xs)}</td><td class="n">${difHtml(xs.length - (antDes.get(k) || 0))}</td></tr>`; }).join("")}</tbody></table></div></div>
      </div>
      <p class="nota">"vs. ant." compara contra ${ANTERIOR_U[r.u]}${r.enCurso ? " al mismo corte (mismos días y horas transcurridos)" : ""}.</p>`;
    enlazarFiltros(); enlazarAbrirSalidas(); enlazarBarras();
  }

  // ---- Clientes ----
  function renderClientes() {
    const r = rangos();
    const todas = filtrar(salidasEn(r.ini, r.fin)), ant = filtrar(salidasEn(r.pIni, r.pFin));
    const antM = new Map(); ant.forEach(s => { const k = s.cliente || "SIN CLIENTE"; antM.set(k, (antM.get(k) || 0) + 1); });
    const filas = ranking(todas, s => s.cliente || "SIN CLIENTE");
    const cp = copiaTabla(`Clientes · ${tituloCopia(r).replace(/^Salidas /, "")}`, ["Cliente", "Salidas", "%", "Refrigerada", "Seca", "Con reparto", "vs. ant."],
      filas.map(([k, xs]) => { const c = conteo(xs); return [k, c.n, `${pct(c.n, todas.length)} %`, c.r, c.s, c.rep, difTxt(c.n - (antM.get(k) || 0))]; }), (f, i) => `${i + 1}. ${f[0]} *${miles(f[1])}* (${f[2]})`);
    $("#ao-cuerpo").innerHTML = `${barraFiltros(false)}
      <div class="ao-card"><div class="ao-card-h"><div class="ao-h3">${miles(todas.length)} salidas de ${filas.length} clientes</div>${botonCopiar("clientes", cp.texto, cp.html)}</div>
      <div class="tabla-wrap"><table class="tabla ao-tabla"><thead><tr><th>#</th><th>Cliente</th><th class="n">Salidas</th><th class="n">%</th><th>Refri / Seca</th><th class="n">Refri</th><th class="n">Seca</th><th class="n">Con reparto</th><th class="n">Remolque propio</th><th class="n">vs. ant.</th></tr></thead>
      <tbody>${filas.map(([k, xs], i) => { const c = conteo(xs); return `<tr class="clic" data-cli="${esc(norm(k))}"><td>${i + 1}</td><td>${esc(k)}</td><td class="n"><b>${miles(c.n)}</b></td><td class="n">${pct(c.n, todas.length)} %</td><td>${barraTipo(xs)}</td>
        <td class="n">${c.r}</td><td class="n">${c.s}</td><td class="n">${c.rep || "—"}</td><td class="n">${pct(c.prop, c.n)} %</td><td class="n">${difHtml(c.n - (antM.get(k) || 0))}</td></tr>`; }).join("")}</tbody></table></div></div>
      <p class="nota">Toca un cliente para ver sus salidas. "vs. ant." = contra ${ANTERIOR_U[r.u]}${r.enCurso ? " al mismo corte" : ""}.</p>`;
    enlazarFiltros(); enlazarAbrirSalidas();
  }

  // ---- Destinos ----
  function renderDestinos() {
    const r = rangos();
    const todas = filtrar(salidasEn(r.ini, r.fin));
    const filas = ranking(todas, s => destinoFinal(s.destino));
    const cp = copiaTabla(`Destinos · ${tituloCopia(r).replace(/^Salidas /, "")}`, ["Destino final", "Salidas", "Directo", "Vía reparto", "Refrigerada", "Seca"],
      filas.map(([k, xs]) => { const c = conteo(xs); return [k, c.n, c.n - c.rep, c.rep, c.r, c.s]; }), (f, i) => `${i + 1}. ${f[0]} *${miles(f[1])}*${f[3] ? ` (${f[3]} vía reparto)` : ""}`);
    $("#ao-cuerpo").innerHTML = `${barraFiltros(false)}
      <div class="ao-card"><div class="ao-card-h"><div class="ao-h3">${filas.length} destinos finales</div>${botonCopiar("destinos", cp.texto, cp.html)}</div>
      <div class="tabla-wrap"><table class="tabla ao-tabla"><thead><tr><th>Destino final</th><th class="n">Salidas</th><th class="n">Directo</th><th class="n">Vía reparto</th><th>Refri / Seca</th><th>Recorridos con reparto</th></tr></thead>
      <tbody>${filas.map(([k, xs]) => {
        const rep = xs.filter(s => paradasDe(s.destino).length > 1);
        const rec = new Map(); rep.forEach(s => { const t = paradasDe(s.destino).join(" → "); rec.set(t, (rec.get(t) || 0) + 1); });
        const recTop = [...rec.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
        return `<tr class="clic" data-dest="${esc(norm(k))}"><td>${esc(k)}</td><td class="n"><b>${miles(xs.length)}</b></td><td class="n">${xs.length - rep.length}</td><td class="n">${rep.length || "—"}</td><td>${barraTipo(xs)}</td>
          <td>${recTop.map(([t, n]) => `<span class="ao-parada">${esc(t)} · ${n}</span>`).join("") || `<span class="nota">—</span>`}</td></tr>`;
      }).join("")}</tbody></table></div></div>
      <p class="nota">Destino final = la última parada del destino de la salida ("MTY-CUL-GDL" termina en GDL). Toca un destino para ver sus salidas.</p>`;
    enlazarFiltros(); enlazarAbrirSalidas();
  }

  // ---- Remolques (propietario = columna Linea) ----
  function renderRemolques() {
    const r = rangos();
    const todas = filtrar(salidasEn(r.ini, r.fin));
    const filas = ranking(todas, s => norm(s.linea) || "SIN DATO");
    const prop = todas.filter(s => esPropio(s.linea)).length;
    const carriers = filas.filter(([k]) => k !== "ATASA").length;
    const tend = r.unidades.map(x => { const xs = filtrar(salidasEn(x.a, x.b)); const p = xs.filter(s => esPropio(s.linea)).length; return { ...x, n: xs.length, p, i: xs.length - p }; });
    const cp1 = copiaTabla(`Remolques por propietario · ${tituloCopia(r).replace(/^Salidas /, "")}`, ["Propietario", "Salidas", "%", "Refrigerada", "Seca"],
      filas.map(([k, xs]) => { const c = conteo(xs); return [k, c.n, `${pct(c.n, todas.length)} %`, c.r, c.s]; }), (f) => `${f[0]}: *${miles(f[1])}* (${f[2]})`);
    const cp2 = copiaTabla(`Intercambio por ${NOMBRE_U[r.u]}`, [r.u === "semana" ? "Semana (lunes)" : r.u === "mes" ? "Mes" : "Año", "Propios", "Intercambio", "% intercambio"],
      tend.map(x => [etiquetaCorta(r.u, x.a), x.p, x.i, `${pct(x.i, x.n)} %`]), (f) => `${f[0]}: propios ${f[1]} · intercambio ${f[2]} (*${f[3]}*)`);
    $("#ao-cuerpo").innerHTML = `${barraFiltros(false)}
      <div class="ao-kpis"><div class="ao-kpi hero"><b>${pct(prop, todas.length)} %</b><small>Salidas con remolque propio (ATASA)</small></div>
        <div class="ao-kpi"><b>${pct(todas.length - prop, todas.length)} %</b><small>Con remolque de intercambio (${miles(todas.length - prop)})</small></div>
        <div class="ao-kpi"><b>${carriers}</b><small>Carriers de intercambio en el periodo</small></div></div>
      <div class="ao-dos">
        <div class="ao-card"><div class="ao-card-h"><div class="ao-h3">Por propietario del remolque</div>${botonCopiar("rem", cp1.texto, cp1.html)}</div>
          <div class="tabla-wrap"><table class="tabla ao-tabla"><thead><tr><th>Propietario</th><th class="n">Salidas</th><th class="n">%</th><th style="width:30%"></th><th>Refri / Seca</th></tr></thead>
          <tbody>${filas.map(([k, xs]) => `<tr><td>${esc(k)} ${k === "ATASA" ? `<span class="ao-chip ao-prop">propio</span>` : ""}</td><td class="n"><b>${miles(xs.length)}</b></td><td class="n">${pct(xs.length, todas.length)} %</td><td><div class="ao-barra"><span class="ao-bc" style="width:${pct(xs.length, todas.length)}%"></span></div></td><td>${barraTipo(xs)}</td></tr>`).join("")}</tbody></table></div></div>
        <div class="ao-card"><div class="ao-card-h"><div class="ao-h3">Intercambio por ${NOMBRE_U[r.u]}</div>${botonCopiar("int", cp2.texto, cp2.html)}</div>
          <div class="tabla-wrap"><table class="tabla ao-tabla"><thead><tr><th>${r.u === "semana" ? "Semana" : r.u === "mes" ? "Mes" : "Año"}</th><th class="n">Propios</th><th class="n">Intercambio</th><th class="n">% intercambio</th></tr></thead>
          <tbody>${tend.slice().reverse().map(x => `<tr${x.a === r.ini ? ` style="font-weight:700;"` : ""}><td>${etiquetaCorta(r.u, x.a)}${Date.now() >= x.a && Date.now() < x.b ? ` <span class="nota">(en curso)</span>` : ""}</td><td class="n">${x.p}</td><td class="n">${x.i}</td><td class="n"><b>${pct(x.i, x.n)} %</b></td></tr>`).join("")}</tbody></table></div></div>
      </div>`;
    enlazarFiltros();
  }

  // ---- Salidas (lista con detalle; se lee solo al abrirla y solo del periodo) ----
  let indiceViajes = null, indiceDe = null;
  function viajeDeSalida(s) {
    const lista = det.viajes.lista || [];
    if (indiceDe !== lista) {
      indiceDe = lista; indiceViajes = new Map();
      lista.forEach(v => { if (!v.salidaMs) return; const k = v.remolque; if (!indiceViajes.has(k)) indiceViajes.set(k, []); indiceViajes.get(k).push(v); });
    }
    const c = indiceViajes.get(remNorm(s.remolque)) || [];
    let mejor = null, dif = 6 * HORA + 1;
    c.forEach(v => { const d = Math.abs(v.salidaMs - s.fechaMs); if (d < dif) { dif = d; mejor = v; } });
    return mejor;
  }
  function renderSalidas() {
    const r = rangos();
    if (!detListo("salidas") || !detListo("viajes")) {
      const n = salidasEn(r.ini, r.fin).length;
      const pendiente = det.salidas.cargando || det.viajes.cargando;
      if (!pendiente && n > MAX_AUTO && det.salidas.clave !== r.clave) {
        $("#ao-cuerpo").innerHTML = `<div class="ao-caja"><p style="margin-top:0;">La lista de salidas de <b>${esc(etiquetaPeriodo(r.u, r.ini))}</b> trae operador, unidad, diésel y tiempos de cada salida. Son <b>${miles(n)}</b> salidas: cargarla gasta unas <b>${miles(Math.round(n * 2.05))}</b> lecturas.</p>
          <button type="button" id="ao-cargar-lista">Cargar la lista</button> <span class="nota">O cambia a Semana o Mes para una lista más corta.</span></div>`;
        $("#ao-cargar-lista").addEventListener("click", () => { cargarDet("salidas"); cargarDet("viajes"); });
        return;
      }
      $("#ao-cuerpo").innerHTML = `<p class="nota">Cargando la lista de ${miles(n)} salidas…</p>`;
      if (!pendiente) { cargarDet("salidas"); cargarDet("viajes"); }
      return;
    }
    const q = norm(f.q);
    let lista = filtrarDetalle(det.salidas.lista.filter(s => s.fechaMs >= r.ini && s.fechaMs < r.fin)).sort((a, b) => (b.fechaMs || 0) - (a.fechaMs || 0));
    if (q) lista = lista.filter(s => norm([s.factura, s.cliente, s.destino, s.remolque, s.carro, s.operador, s.linea].join(" ")).includes(q));
    const POR = 50, paginas = Math.max(1, Math.ceil(lista.length / POR));
    if (f.pagina >= paginas) f.pagina = 0;
    const vista = lista.slice(f.pagina * POR, f.pagina * POR + POR);
    $("#ao-cuerpo").innerHTML = `${barraFiltros(true)}
      <div class="ao-filtros"><input type="search" id="ao-q" placeholder="Buscar Carta Porte, cliente, destino, remolque, unidad, operador" value="${esc(f.q)}" style="min-width:260px;flex:1;">
        <button type="button" class="secundario" id="ao-excel">Excel</button></div>
      <p class="nota">${miles(lista.length)} salidas en ${esc(etiquetaPeriodo(r.u, r.ini))}. Los tiempos salen del reporte Vista general (si ya se pegó ese viaje).</p>
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
        XLSX.writeFile(libro, `Analisis_salidas_${etiquetaPeriodo(r.u, r.ini).replace(/[^\w]+/g, "_")}.xlsx`);
      } catch (e) { error("No se pudo generar el Excel: " + e.message); }
    });
  }

  // ---- Tiempos (de los resúmenes; el detalle de un destino se lee al abrirlo) ----
  function renderTiempos() {
    const r = rangos();
    let lista = viajesEn(r.ini, r.fin);
    const clientes = [...new Set(lista.map(x => x.cliente).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    if (ft.cliente) lista = lista.filter(x => norm(x.cliente) === ft.cliente);
    const raros = lista.filter(x => x.raro).length;
    const dir = grupoT(lista.filter(x => !x.conReparto)), rep = grupoT(lista.filter(x => x.conReparto)), tod = grupoT(lista);
    const vis = ft.tipo === "directo" ? lista.filter(x => !x.conReparto) : ft.tipo === "reparto" ? lista.filter(x => x.conReparto) : lista;
    const m = new Map(); vis.forEach(x => { const nk = norm(x.destinoFinal); if (!m.has(nk)) m.set(nk, { nombre: x.destinoFinal, xs: [] }); m.get(nk).xs.push(x); });
    const destinos = [...m.entries()].map(([nk, o]) => ({ nk, nombre: o.nombre, ...grupoT(o.xs) })).sort((a, b) => b.n - a.n);
    const g = ft.tipo === "reparto" ? rep : ft.tipo === "directo" ? dir : tod;
    const total = (g.patio || 0) + (g.transito || 0) + (g.destino || 0);
    const seg = (campo, ops) => `<span class="ao-seg">${ops.map(([v, t]) => `<button type="button" class="${ft[campo] === v ? "activo" : ""}" data-ft="${campo}" data-v="${v}">${t}</button>`).join("")}</span>`;
    const cliNom = ft.cliente ? (clientes.find(c => norm(c) === ft.cliente) || ft.cliente) : "";
    const titT = `Tiempos de viaje (mediana) · ${etiquetaPeriodo(r.u, r.ini)}${r.enCurso ? " (en curso)" : ""}${cliNom ? ` · ${cliNom}` : ""}`;
    const cp1 = copiaTabla(titT, ["Etapa", `Directos (${dir.n})`, `Con reparto (${rep.n})`, "Todos"],
      [["Patio", horasCopia(dir.patio), horasCopia(rep.patio), horasCopia(tod.patio)], ["Tránsito", horasCopia(dir.transito), horasCopia(rep.transito), horasCopia(tod.transito)],
       ["Destino", horasCopia(dir.destino), horasCopia(rep.destino), horasCopia(tod.destino)], ["Viaje completo", horasCopia(dir.completo), horasCopia(rep.completo), horasCopia(tod.completo)]],
      (f) => `${f[0]}: directos *${f[1]}* · con reparto *${f[2]}*`);
    const cp2 = copiaTabla(`Tiempos por destino final · ${etiquetaPeriodo(r.u, r.ini)}${ft.tipo ? (ft.tipo === "directo" ? " · directos" : " · con reparto") : ""}${cliNom ? ` · ${cliNom}` : ""}`, ["Destino final", "Viajes", "Patio", "Tránsito", "Destino", "Completo"],
      destinos.map(d => [d.nombre, d.n, horasCopia(d.patio), horasCopia(d.transito), horasCopia(d.destino), horasCopia(d.completo)]), (f) => `${f[0]} (${f[1]}): completo *${f[5]}*`);
    $("#ao-cuerpo").innerHTML = `
      <div class="ao-filtros">${seg("tipo", [["", "Todos"], ["directo", "Directos"], ["reparto", "Con reparto"]])}
        <select id="ao-t-cli"><option value="">Todos los clientes</option>${clientes.map(c => `<option value="${esc(norm(c))}"${ft.cliente === norm(c) ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
      <div class="ao-card"><div class="ao-card-h"><div class="ao-h3">${miles(lista.length)} viajes · mediana</div>${botonCopiar("tiempos", cp1.texto, cp1.html)}</div>
      <div class="tabla-wrap"><table class="tabla ao-tabla"><thead><tr><th>Tiempo</th><th>Desde → hasta</th><th class="n">Directos (${miles(dir.n)})</th><th class="n">Con reparto (${miles(rep.n)})</th><th class="n">Todos</th></tr></thead>
      <tbody>
        <tr><td><b>En patio</b></td><td>Entrada → salida de patio</td><td class="n">${horas(dir.patio)}</td><td class="n">${horas(rep.patio)}</td><td class="n">${horas(tod.patio)}</td></tr>
        <tr><td><b>En tránsito</b></td><td>Salida → primer arribo</td><td class="n">${horas(dir.transito)}</td><td class="n">${horas(rep.transito)}</td><td class="n">${horas(tod.transito)}</td></tr>
        <tr><td><b>En destino</b></td><td>Primer arribo → última descarga (en reparto incluye el recorrido entre paradas)</td><td class="n">${horas(dir.destino)}</td><td class="n">${horas(rep.destino)}</td><td class="n">${horas(tod.destino)}</td></tr>
        <tr><td><b>Viaje completo</b></td><td>Entrada a patio → última descarga</td><td class="n"><b>${horas(dir.completo)}</b></td><td class="n"><b>${horas(rep.completo)}</b></td><td class="n"><b>${horas(tod.completo)}</b></td></tr>
      </tbody></table></div>
      ${total ? `<div class="ao-tira"><span style="width:${g.patio / total * 100}%;background:#8a6a4a">Patio ${horasTxt(g.patio)} h</span><span style="width:${g.transito / total * 100}%;background:#185FA5">Tránsito ${horasTxt(g.transito)} h</span><span style="width:${g.destino / total * 100}%;background:#3B7A1E">Destino ${horasTxt(g.destino)} h</span></div>` : ""}
      <p class="nota" style="margin-bottom:0;">Del reporte Vista general, todos los estatus. Mediana = el viaje de en medio, para que uno atorado no mueva el número.${raros ? ` ${raros} viaje${raros === 1 ? "" : "s"} con horas imposibles (negativas o de más de 20 días) no cuentan en esa etapa.` : ""}</p></div>
      <div class="ao-card"><div class="ao-card-h"><div class="ao-h3">Por destino final${ft.tipo === "directo" ? " · directos" : ft.tipo === "reparto" ? " · con reparto" : ""}</div>${botonCopiar("tdest", cp2.texto, cp2.html)}</div>
      <div class="tabla-wrap"><table class="tabla ao-tabla"><thead><tr><th>Destino final</th><th class="n">Viajes</th><th class="n">Patio</th><th class="n">Tránsito</th><th class="n">Destino</th><th class="n">Completo</th><th class="n">Con dato completo</th></tr></thead>
      <tbody>${destinos.map(d => `<tr class="clic" data-td="${esc(d.nk)}"><td>${esc(d.nombre)}</td><td class="n">${miles(d.n)}</td><td class="n">${horas(d.patio)}</td><td class="n">${horas(d.transito)}</td><td class="n">${horas(d.destino)}</td><td class="n"><b>${horas(d.completo)}</b></td><td class="n">${pct(d.conDato, d.n)} %</td></tr>
        ${destinoAbierto === d.nk ? `<tr><td colspan="7" style="background:#faf7f2;">${detalleViajes(d.nk)}</td></tr>` : ""}`).join("")}</tbody></table></div>
      <p class="nota" style="margin-bottom:0;">Toca un destino para ver sus viajes (se leen en ese momento, solo de este periodo).</p></div>`;
    $("#ao-cuerpo").querySelectorAll("[data-ft]").forEach(b => b.addEventListener("click", () => { ft[b.dataset.ft] = b.dataset.v; destinoAbierto = null; render(); }));
    $("#ao-t-cli").addEventListener("change", (e) => { ft.cliente = e.target.value; destinoAbierto = null; render(); });
    $("#ao-cuerpo").querySelectorAll("[data-td]").forEach(tr => tr.addEventListener("click", () => {
      destinoAbierto = destinoAbierto === tr.dataset.td ? null : tr.dataset.td;
      if (destinoAbierto && !detListo("viajes")) cargarDet("viajes"); else render();
    }));
  }
  function detalleViajes(nk) {
    if (!detListo("viajes")) return `<p class="nota">Cargando viajes…</p>`;
    const r = rangos();
    const xs = det.viajes.lista.filter(v => v.refMs >= r.ini && v.refMs < r.fin && norm(destinoFinalViaje(v)) === nk && (!ft.cliente || norm(v.cliente) === ft.cliente))
      .map(v => ({ v, t: tiemposViaje(v) })).filter(x => ft.tipo === "directo" ? !x.t.conReparto : ft.tipo === "reparto" ? x.t.conReparto : true);
    const orden = xs.sort((a, b) => (b.t.completo || 0) - (a.t.completo || 0)).slice(0, 60);
    return `<div class="tabla-wrap"><table class="tabla ao-tabla" style="background:#fff;"><thead><tr><th>Salida</th><th>Remolque</th><th>Cliente</th><th>Recorrido</th><th>Estatus</th><th class="n">Patio</th><th class="n">Tránsito</th><th class="n">Destino</th><th class="n">Completo</th></tr></thead>
      <tbody>${orden.map(({ v, t }) => `<tr><td>${fechaHora(v.salidaMs || v.entradaMs)}</td><td>${esc(v.remolque)} <small class="nota">${esc(v.linea || "")}</small></td><td>${esc(v.cliente)}</td>
        <td>${(v.paradas || []).length > 1 ? v.paradas.map(p => `<span class="ao-parada" title="Arribo ${fechaHora(p.arriboMs)} · Descarga ${fechaHora(p.descargaMs)}">${esc(p.destino)}</span>`).join("") : esc(v.destino)}</td>
        <td><small class="nota">${esc(v.status || "")}</small></td><td class="n">${horas(t.patio)}</td><td class="n">${horas(t.transito)}</td><td class="n">${horas(t.destino)}</td><td class="n"><b>${horas(t.completo)}</b></td></tr>`).join("")}</tbody></table></div>
      ${xs.length > 60 ? `<p class="nota">Se muestran los 60 más largos de ${xs.length}.</p>` : ""}`;
  }

  // ---- Pegar reportes y armar resúmenes (admin y Gerente de importaciones) ----
  function renderPegar() {
    const caja = (id, titulo, desc, info) => `<div class="ao-caja"><div class="ao-h3" style="margin-top:0;">${titulo}</div><p class="nota" style="margin-top:0;">${desc}</p>
      <textarea class="ao-pegar" id="ao-p-${id}" placeholder="Pega aquí el reporte con su fila de títulos"></textarea>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;"><button type="button" class="secundario" id="ao-leer-${id}">Leer</button><button type="button" id="ao-guardar-${id}"${pegado[id] ? "" : " disabled"}>Guardar</button></div>
      <div id="ao-info-${id}" class="nota" style="margin-top:8px;">${info || ""}</div></div>`;
    const hoy = Date.now(), opciones = [];
    for (let i = 0; i < 36; i++) { const d = new Date(hoy); d.setDate(1); d.setMonth(d.getMonth() - i); opciones.push(mesKey(d.getTime())); }
    const porOmision = opciones[Math.min(5, opciones.length - 1)];
    $("#ao-cuerpo").innerHTML = `<div class="ao-dos">
      ${caja("salidas", "1 · Salidas", "Reporte de salidas del Adrematasa (Factura, Fecha Hora, Remolque, Linea, Cliente, Destino, Carro, Operador, Diesel, Prog…). Es la misma base que usa Rentabilidad: no se duplica por Carta Porte.", resumenPegado("salidas"))}
      ${caja("vista", "2 · Vista general", "Reporte Vista general (Remolque, Entrada, Salida, Arribo Impo, Descarga y, en repartos, Destino/Arribo/Descarga Reparto). Una fila por parada; aquí se juntan en un viaje.", resumenPegado("vista"))}
    </div>
    <p class="nota">Puedes pegar uno, el otro o los dos, del rango que quieras. Solo se guardan los registros nuevos o que cambiaron, y después se rearma el resumen de los meses que cambiaron. "LAREDO TX VACIO" se ignora.</p>
    <div class="ao-caja" style="margin-top:12px;"><div class="ao-h3" style="margin-top:0;">3 · Resúmenes mensuales</div>
      <p class="nota" style="margin-top:0;">Las gráficas y tablas se leen de un resumen por mes (por eso casi no gastan lecturas). Se rearman solos al guardar aquí. Úsalo la primera vez, o si pegaste salidas desde Rentabilidad: lee todo el detalle de esos meses (unas 3,000 lecturas por mes) y rearma su resumen.</p>
      <div class="ao-filtros" style="margin-bottom:0;"><label class="nota">Desde <select id="ao-r-desde">${opciones.map(k => `<option value="${k}"${k === porOmision ? " selected" : ""}>${MESES_L[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}</option>`).join("")}</select></label>
        <span class="nota">hasta ${MESES_L[new Date(hoy).getMonth()]} ${new Date(hoy).getFullYear()}</span>
        <button type="button" id="ao-armar">Armar resúmenes</button></div>
      <div id="ao-r-info" class="nota" style="margin-top:8px;"></div></div>`;
    ["salidas", "vista"].forEach(id => {
      $(`#ao-leer-${id}`).addEventListener("click", () => leer(id));
      $(`#ao-guardar-${id}`).addEventListener("click", () => guardar(id));
    });
    $("#ao-armar").addEventListener("click", () => armarDesde($("#ao-r-desde").value));
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
        lecturas += Math.max(1, snap.size);
        snap.docs.forEach(d => existentes.set(d.id, d.data()));
      }
      const quitar = ["cargadaMs", "cargadaPor", "id"];
      const cambiadas = lista.filter(x => { const k = id === "salidas" ? x.factura : x.id; const e = existentes.get(k); if (!e) return true; return firma({ ...e, ...x }, quitar) !== firma(e, quitar); });
      pegado[id] = { lista, basura, filas, cambiadas, cambios: cambiadas.length };
    } catch (e) { pegado[id] = null; error(e.message); }
    renderPegar(); renderControl();
    $(`#ao-p-${id}`).value = texto;
  }
  async function guardar(id) {
    const p = pegado[id]; if (!p) return;
    const btn = $(`#ao-guardar-${id}`); if (btn) btn.disabled = true;
    error();
    try {
      const ahora = Date.now();
      const col = id === "salidas" ? COL_SALIDAS : COL_VIAJES;
      for (let i = 0; i < p.cambiadas.length; i += 400) {
        const lote = writeBatch(db);
        p.cambiadas.slice(i, i + 400).forEach(x => {
          const { id: _id, ...datos } = x;
          lote.set(doc(db, col, id === "salidas" ? x.factura : x.id), { ...datos, cargadaMs: ahora, cargadaPor: por }, { merge: true });
        });
        await lote.commit();
      }
      const afectados = [...new Set(p.cambiadas.map(x => id === "salidas" ? x.fechaMs : x.refMs).filter(Boolean).map(mesKey))].sort();
      pegado[id] = null;
      const txt = `${p.cambiadas.length} ${id === "salidas" ? "salida(s)" : "viaje(s)"} guardado(s); ${p.lista.length - p.cambiadas.length} ya estaban iguales.`;
      await rearmar(afectados, txt);
    } catch (e) { error("No se pudo guardar: " + e.message); if (btn) btn.disabled = false; }
  }
  async function armarDesde(desde) {
    const hasta = mesKey(Date.now());
    if (desde > hasta) return;
    const lista = mesesEntreClaves(desde, hasta);
    if (!window.confirm(`Se van a rearmar ${lista.length} mes(es), de ${desde} a ${hasta}. Lee todo el detalle de esos meses (unas 3,000 lecturas por mes con datos). ¿Continuar?`)) return;
    await rearmar(lista, "");
  }
  // Rearma los resúmenes de la lista de meses, uno por uno, con avance en pantalla.
  async function rearmar(lista, prefijo) {
    error();
    const info = () => $("#ao-r-info");
    const boton = $("#ao-armar"); if (boton) boton.disabled = true;
    let hechos = 0, sal = 0, via = 0;
    try {
      for (const k of lista) {
        avisar(`${prefijo ? prefijo + " " : ""}Armando resumen de ${MESES_L[Number(k.slice(5)) - 1]} ${k.slice(0, 4)} (${hechos + 1} de ${lista.length})…`, true);
        const { datos, lecturas: l } = await rearmarMes(k, por);
        lecturas += l + 1;
        meses.set(k, decodificar(datos));
        sal += datos.ns; via += datos.nv; hechos++;
      }
      det.salidas.clave = null; det.viajes.clave = null;
      avisar(`${prefijo ? prefijo + " " : ""}${lista.length ? `Resumen rearmado de ${lista.length} mes(es): ${miles(sal)} salidas y ${miles(via)} viajes.` : ""}`);
      render();
      if (info()) info().textContent = lista.length ? `Listo: ${lista.join(", ")}.` : "";
    } catch (e) {
      render();
      error(`Se rearmaron ${hechos} de ${lista.length} meses. Error: ${e.message}`);
    }
    if (boton && boton.isConnected) boton.disabled = false;
  }

  // ---- Arranque ----
  $("#ao-prev").addEventListener("click", () => { st.ini = mover(st.u, st.ini, -1); alCambiarPeriodo(); });
  $("#ao-next").addEventListener("click", () => { const n = mover(st.u, st.ini, 1); if (n <= Date.now()) { st.ini = n; alCambiarPeriodo(); } });
  $("#ao-hoy").addEventListener("click", () => { st.ini = inicioDe(st.u, Date.now()); alCambiarPeriodo(); });
  $("#ao-cp-todo").addEventListener("click", async (e) => { const b = e.currentTarget, t = textoResumen(); marcarCopiado(b, await copiarAlPortapapeles(t, waAHtml(t))); });
  cargarVista();
}