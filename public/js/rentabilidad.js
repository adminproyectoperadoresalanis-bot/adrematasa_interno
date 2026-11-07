// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/public/js/rentabilidad.js
// ##########################################################################
import { db } from "./firebase-config.js";
import { collection, doc, onSnapshot, setDoc, deleteDoc, updateDoc, writeBatch, getDoc, query, where } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { leerFactura, paginasDePdf, calcular, repartosDeFactura } from "./rentabilidadPdf.js";

// ============================================================================
// Utilidades → Rentabilidad (2026-10-28, pedido de Ivan). SOLO su cuenta
// (navegacion.js la muestra solo a ilanda@alanis.com.mx y firestore.rules
// bloquea a cualquier otra, incluso a otros admin).
//
// Se cargan los PDF de factura (CFDI + Carta Porte, formato de siempre). Se
// leen EN EL NAVEGADOR con pdf.js (rentabilidadPdf.js); el PDF no se guarda en
// ningún lado, solo los datos: rentabilidad_facturas/{uuid}. El folio fiscal
// (UUID) evita duplicados.
//
// Ingreso por km (decisión de Ivan): principal = FLETE ÷ km; también subtotal
// ÷ km. En USD se convierte a MXN con el tipo de cambio de la misma factura.
// Ruta = municipio del remitente → municipio del destinatario.
//
// 2026-10-28: Salidas del Adrematasa oficial (rentabilidad_salidas/{TAIM}).
// Se pega el reporte de salidas; cada salida se liga con su factura por el
// folio de Carta Porte (columna Factura = TAIM-… = cartaPorteFolio del PDF) y
// la columna Prog marca el tipo de tarifa: OFF = SECA, una temperatura (-10…)
// = REFRIGERADA. El tipo se calcula al mostrar, así que no importa qué se
// cargue primero.
//
// 2026-10-29: REPARTOS. En la salida, un destino con guion es reparto
// ("APODACA-TOLUCA" = 2 paradas = 1 reparto; siempre, aunque sean dos
// ciudades). En la factura: tramos de "Repartos/Recolecciones" de la Carta
// Porte, o "Se entrega en" con guion; el cobro es el concepto REPARTO /
// RECOLECCION. La zona la decide el destino FINAL (última parada) y se marca
// "vía reparto". Alertas: reparto sin cobro y conteo distinto salida ≠ PDF.
//
// 2026-10-30 (replanteo con Ivan): el reparto lo define SOLO la salida del
// Adrematasa. Cada RECORRIDO (paradas antes del destino final) es su propio
// renglón en Tarifas: "Cunduacán directo" ≠ "MTY → CUL → GDL → Cunduacán".
// Las paradas se normalizan con equivalencias (MONTERREY = MTY) guardadas en
// rentabilidad_config/paradas.
// REFACTURAS: la refactura trae otra carta porte (TAIM) que la salida. Si la
// carta porte no coincide, la factura se liga con la salida del mismo remolque
// y mismo sello (o misma unidad) en fechas cercanas; si hay varias, se elige a
// mano. Ligas manuales en rentabilidad_config/ligas.
// ============================================================================

// Paradas de una salida del Adrematasa: el destino partido por "-".
function paradasSalida(x) {
  return String((x && x.destino) || "").split("-").map(t => t.replace(/\s+/g, " ").trim()).filter(Boolean);
}
// Reparto de un viaje: lo define SOLO la salida (2026-10-30). canon() normaliza
// el nombre de cada parada (equivalencias). La factura aporta el cobro.
function infoReparto(f, salida, canon = (p) => p) {
  const rf = f ? repartosDeFactura(f) : { numero: 0, paradas: [], fuente: "", cobro: 0 };
  const paradas = salida ? paradasSalida(salida).map(canon) : [];
  const numero = Math.max(paradas.length - 1, 0);
  const mon = (f && f.moneda) || "MXN";
  const tc = mon === "MXN" ? 1 : ((f && f.tipoCambio) || 1);
  return {
    numero, paradas, intermedias: paradas.slice(0, -1), final: paradas[paradas.length - 1] || "", rf,
    cobroMxn: Math.round(rf.cobro * tc * 100) / 100,
    sinCobro: !!f && numero > 0 && !rf.cobro,
  };
}
// Sello "AAA214764661/662" → ["AAA214764661", "AAA214764662"] (el corto completa la cola del anterior).
function sellos(t) {
  const out = [];
  String(t || "").toUpperCase().split(/[\/,;\s]+/).filter(Boolean).forEach(tok => {
    const ant = out[out.length - 1];
    if (ant && /^\d+$/.test(tok) && tok.length < ant.length) out.push(ant.slice(0, ant.length - tok.length) + tok);
    else out.push(tok);
  });
  return out.filter(x => x.length >= 4);
}
const soloDigitos = (t) => String(t || "").replace(/\D/g, "").replace(/^0+/, "");

const COL = "rentabilidad_facturas";
const COL_SALIDAS = "rentabilidad_salidas";
const COL_CONFIG = "rentabilidad_config"; // zonas y equivalencias de clientes (2026-10-28)
const URL_PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const URL_PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const URL_SHEETJS = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
const RFC_GENERICOS = ["XEXX010101000", "XAXX010101000"];
const MAX_CONCEPTOS = 6; // columnas de conceptos además de Flete (la última es "Otros" si hay más)
// Junta variantes del mismo concepto: "CRUCE FRONTERA 16%" → "CRUCE FRONTERA"; "FSC REFRIG. 0%" → "FSC REFRIG.";
// "Autopistas" → "AUTOPISTAS"; cualquier "FLETE …" → "FLETE".
export function nombreConcepto(servicio) {
  const t = String(servicio || "").replace(/\s*\d+(\.\d+)?\s*%\s*$/, "").replace(/\s+/g, " ").trim().toUpperCase();
  if (!t) return "SIN NOMBRE";
  if (/^FLETE\b/.test(t)) return "FLETE";
  return t;
}

function esc(t) { const d = document.createElement("div"); d.textContent = t == null ? "" : String(t); return d.innerHTML; }
// Copiar (2026-11-07): texto para WhatsApp con *negritas* + HTML (tablas) para correo o Excel.
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
function marcarCopiado(b, ok) {
  const t = b.textContent;
  b.textContent = ok ? "✓ Copiado" : "No se pudo copiar"; b.classList.toggle("ok", ok);
  setTimeout(() => { b.textContent = t; b.classList.remove("ok"); }, 1600);
}
const fmt = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 });
function dinero(n, moneda) {
  if (n == null || !isFinite(n)) return "—";
  return moneda && moneda !== "MXN" ? `${fmt.format(n).replace("$", "US$")}` : fmt.format(n);
}
const miles = (n) => n == null ? "—" : Number(n).toLocaleString("es-MX", { maximumFractionDigits: 1 });
const fechaCorta = (iso) => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—";
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const nombreMes = (ym) => `${MESES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
function claveCliente(f) {
  const c = f.cliente || {};
  return c.rfc && !RFC_GENERICOS.includes(c.rfc) ? c.rfc : "EXT:" + (c.nombre || "").toUpperCase();
}

// ---- Salidas del Adrematasa oficial ---------------------------------------------
export const TIPO = {
  seca: { txt: "SECA", clase: "re-seca" },
  refrigerada: { txt: "REFRIGERADA", clase: "re-refri" },
  sin: { txt: "SIN DATO", clase: "re-gris" },
};
export function tipoDeProg(prog) {
  const p = String(prog || "").trim();
  if (/^OFF$/i.test(p)) return "seca";
  if (/^[-+]?\d+(\.\d+)?$/.test(p)) return "refrigerada";
  return "sin";
}
const COLUMNAS_SALIDA = {
  "id": "id", "factura": "factura", "fecha hora": "fechaHora", "factura otras empresas": "facturaOtrasEmpresas",
  "remolque": "remolque", "linea": "linea", "cliente": "cliente", "producto": "producto", "destino": "destino",
  "carro": "carro", "operador": "operador", "diesel": "diesel", "salida": "tempSalida", "prog": "prog",
  "h.t 1": "ht1", "h.t 2": "ht2", "sello": "sello", "usuario": "usuario", "registro": "registro",
  "intercambista_salida": "intercambistaSalida", "intercambio_salida": "intercambioSalida",
};
const normCol = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
// "08/10/2026 01:13:00 p. m." (DD/MM/AAAA) → ms
export function msFechaAdrematasa(t) {
  const m = String(t || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])?/i);
  if (!m) return null;
  let h = Number(m[4]);
  if (m[7]) { const pm = m[7].toLowerCase() === "p"; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), h, Number(m[5]), Number(m[6] || 0)).getTime();
}
// Reporte pegado (con la fila de títulos) → [{ factura: "TAIM-…", prog, tipo, … }]
export function leerSalidas(texto) {
  const lineas = String(texto || "").split(/\r?\n/).filter(l => l.trim());
  const iTit = lineas.findIndex(l => { const c = l.split("\t").map(normCol); return c.includes("factura") && c.includes("prog"); });
  if (iTit < 0) throw new Error("No encontré la fila de títulos (debe traer las columnas Factura y Prog).");
  let tit = lineas[iTit].split("\t").map(normCol);
  const datos = lineas.slice(iTit + 1).map(l => l.split("\t"));
  // El Adrematasa a veces copia los títulos sin la columna vacía inicial que sí traen los renglones.
  const masLargos = datos.filter(c => c.length === tit.length + 1 && c[0].trim() === "").length;
  if (datos.length && masLargos > datos.length / 2) tit = [""].concat(tit);
  const idx = {};
  tit.forEach((t, i) => { if (COLUMNAS_SALIDA[t] && idx[COLUMNAS_SALIDA[t]] == null) idx[COLUMNAS_SALIDA[t]] = i; });
  const salidas = [];
  datos.forEach(c => {
    const r = {};
    Object.entries(idx).forEach(([k, i]) => { r[k] = (c[i] || "").trim(); });
    r.factura = (r.factura || "").toUpperCase().replace(/\s+/g, "");
    if (!/^[A-Z]+-\d+$/.test(r.factura)) return;
    r.tipo = tipoDeProg(r.prog);
    r.fechaMs = msFechaAdrematasa(r.fechaHora);
    salidas.push(r);
  });
  if (!salidas.length) throw new Error("No encontré renglones con folio de Carta Porte (TAIM-…) en la columna Factura.");
  return salidas;
}

function cargarScript(url, global) {
  if (window[global]) return Promise.resolve(window[global]);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = url;
    s.onload = () => (window[global] ? resolve(window[global]) : reject(new Error("No cargó " + url)));
    s.onerror = () => reject(new Error("No se pudo descargar " + url));
    document.head.appendChild(s);
  });
}
async function pdfjs() {
  const lib = await cargarScript(URL_PDFJS, "pdfjsLib");
  lib.GlobalWorkerOptions.workerSrc = URL_PDFJS_WORKER;
  return lib;
}

function inyectarEstilos() {
  if (document.getElementById("estilos-rentabilidad")) return;
  const s = document.createElement("style");
  s.id = "estilos-rentabilidad";
  s.textContent = `
    .re-tabs { display:flex; gap:6px; flex-wrap:wrap; margin:0 0 14px; }
    .re-tab { background:#fff; border:1px solid #e2ddd5; border-radius:16px; padding:6px 13px; font:inherit; font-size:13px; color:#6b5f52; cursor:pointer; }
    .re-tab.activo { background:#2c1e0f; border-color:#2c1e0f; color:#fff; }
    .re-drop { border:2px dashed #cbbfb0; border-radius:14px; padding:22px; text-align:center; color:#6b5f52; font-size:13.5px; background:#FBFAF8; cursor:pointer; }
    .re-drop.sobre { background:#f1ebe2; border-color:#2c1e0f; }
    .re-drop b { color:#2c1e0f; }
    .re-arch { display:flex; justify-content:space-between; align-items:center; gap:8px; border:1px solid #e2ddd5; border-radius:10px; padding:9px 12px; margin-top:8px; font-size:13px; flex-wrap:wrap; cursor:pointer; background:#fff; }
    .re-arch.activo { border-color:#2c1e0f; box-shadow:0 0 0 1px #2c1e0f; }
    .re-chip { display:inline-block; font-size:11px; font-weight:700; padding:3px 9px; border-radius:11px; white-space:nowrap; }
    .re-verde { background:#EAF3DE; color:#3B7A1E; } .re-ambar { background:#FBE3A8; color:#7a3e06; } .re-rojo { background:#FBE4E1; color:#A32D2D; } .re-gris { background:#ECE9E4; color:#5c5045; } .re-azul { background:#E6F1FB; color:#185FA5; }
    .re-kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin:14px 0; }
    .re-kpi { border:1px solid #e2ddd5; border-radius:12px; padding:12px; background:#fff; }
    .re-kpi b { display:block; font-size:20px; } .re-kpi small { color:#6b5f52; font-size:11.5px; }
    .re-kpi.hero { background:#2c1e0f; color:#fff; border-color:#2c1e0f; } .re-kpi.hero small { color:#e8dccd; }
    .re-h3 { font-size:12px; margin:16px 0 8px; color:#6b5f52; text-transform:uppercase; letter-spacing:.4px; }
    .re-grid3 { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:16px; }
    .re-campos { display:grid; grid-template-columns:118px 1fr; gap:4px 10px; font-size:12.5px; }
    .re-campos span { color:#8a7f73; }
    .re-tabla td.n, .re-tabla th.n { text-align:right; white-space:nowrap; }
    .re-tabla tr.clic { cursor:pointer; } .re-tabla tr.clic:hover td { background:#faf7f2; }
    .re-filtros { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:10px; }
    .re-filtros select { width:auto; min-width:150px; }
    .re-barra { height:7px; border-radius:4px; background:#E8E2D9; overflow:hidden; margin-top:4px; } .re-barra i { display:block; height:100%; background:#2c1e0f; }
    .re-errores { margin-top:8px; font-size:12.5px; color:#7a3e06; background:#FEF6E4; border-radius:8px; padding:8px 10px; }
    .re-km { display:inline-flex; gap:6px; align-items:center; } .re-km input { width:110px; }
    .re-vbarra { height:10px; border-radius:5px; background:#eee8e0; overflow:hidden; display:flex; min-width:120px; }
    .re-vbarra span { display:block; height:100%; }
    .re-v1 { background:#185FA5; } .re-v2 { background:#C68A2E; } .re-v3 { background:#cfc8bf; }
    .re-rank { width:26px; height:26px; border-radius:50%; background:#f2ede6; display:inline-flex; align-items:center; justify-content:center; font-weight:800; font-size:12px; }
    .re-seg { display:inline-flex; border:1px solid #e2ddd5; border-radius:9px; overflow:hidden; }
    .re-seg button { background:#fff; border:0; border-left:1px solid #e2ddd5; padding:6px 11px; font:inherit; font-size:12.5px; color:#6b5f52; cursor:pointer; }
    .re-seg button:first-child { border-left:0; } .re-seg button.activo { background:#2c1e0f; color:#fff; font-weight:700; }
    .re-link { background:none; border:0; padding:0; font:inherit; font-weight:700; color:#185FA5; text-decoration:underline; cursor:pointer; }
    .re-link.re-falta { color:#A32D2D; }
    .re-cp { background:#fff; color:#2c1e0f; border:1px solid #d9d1c5; border-radius:8px; padding:3px 9px; font:inherit; font-size:11.5px; font-weight:700; cursor:pointer; }
    .re-cp.ok { color:#3B7A1E; border-color:#3B7A1E; }
    .re-modal-fondo { position:fixed; inset:0; z-index:9000; background:rgba(28,20,10,.45); display:flex; align-items:center; justify-content:center; padding:16px; }
    .re-modal { background:#fff; border-radius:16px; padding:20px; width:100%; max-width:560px; max-height:calc(100vh - 32px); overflow:auto; box-shadow:0 12px 40px rgba(0,0,0,.25); }
    .re-modal h3 { margin:0 0 2px; font-size:17px; }
    .re-mfila { display:flex; gap:10px; align-items:center; margin:12px 0; flex-wrap:wrap; font-size:13.5px; }
    .re-mfila > b { width:120px; font-size:11.5px; color:#6b5f52; text-transform:uppercase; letter-spacing:.4px; }
    .re-mfila label { display:inline-flex; gap:6px; align-items:center; margin-right:10px; cursor:pointer; }
    .re-mfila input[type=checkbox] { width:auto; margin:0; }
    .re-lista { border:1px solid #e2ddd5; border-radius:10px; overflow:hidden; background:#fff; max-height:520px; overflow-y:auto; }
    .re-dest { display:flex; gap:8px; align-items:flex-start; padding:8px 10px; border-top:1px solid #f0ece6; font-size:13px; cursor:pointer; margin:0; color:#2c1e0f; }
    .re-dest:first-child { border-top:0; }
    .re-zona { border:1px solid #e2ddd5; border-radius:10px; padding:10px 12px; margin-bottom:8px; background:#fff; }
    .re-mini { padding:3px 8px; font-size:11.5px; }
    .re-x { background:none; border:0; padding:0 0 0 4px; cursor:pointer; color:#A32D2D; font-weight:800; }
    .re-pag { display:flex; gap:8px; align-items:center; justify-content:center; margin:12px 0 4px; flex-wrap:wrap; }
    .re-col-flete { background:#EFE7DA; font-weight:700; } .re-col-con { background:#F7F3EE; }
    .re-seca { background:#F3E9D7; color:#7a4a12; } .re-refri { background:#DDEEFB; color:#0C447C; }
    .re-parada { display:inline-block; font-size:11px; padding:1px 7px; border-radius:8px; background:#F2EDE6; margin:1px 3px 1px 0; }
    .re-rep { background:#FFE7C2; color:#8a4b00; }
    .re-col-rec { background:#FFF8EC; min-width:160px; }
    .re-pegar { width:100%; box-sizing:border-box; min-height:120px; font-family:monospace; font-size:11.5px; white-space:pre; }
  `;
  document.head.appendChild(s);
}

// ---- Repartos en el detalle ----
function htmlRepartos(f, salida) {
  const r = infoReparto(f, salida);
  const tramos = ((f.cartaPorte || {}).tramos || []);
  if (!r.numero && tramos.length < 2) return "";
  const mon = f.moneda || "MXN";
  return `<div class="re-h3">Repartos · ${r.numero ? `${r.numero} reparto${r.numero === 1 ? "" : "s"} (según la salida)` : "la salida no trae reparto"}
      ${r.sinCobro ? ` <span class="re-chip re-rojo">SIN COBRO DE REPARTO</span>` : ""}</div>
    <div class="re-campos">
      ${tramos.length > 1 ? `<span>Carta porte</span><div>${tramos.map((t, n) => `${n + 1}. ${esc(t.origenLugar || t.origen)} → <b>${esc(t.destinoLugar || t.destino)}</b> <small class="nota">${esc(t.destino)}</small>`).join("<br>")}</div>` : ""}
      ${(f.destinatario || {}).seEntregaEn ? `<span>Se entrega en</span><div>${esc(f.destinatario.seEntregaEn)}</div>` : ""}
      ${salida ? `<span>Adrematasa</span><div>${esc(salida.destino || "—")}${r.numero ? ` · ${r.numero} reparto${r.numero === 1 ? "" : "s"}` : " · directo"}</div>` : ""}
      <span>Cobro</span><div>${r.rf.cobro ? `${dinero(r.rf.cobro, mon)}${r.numero ? ` · ${dinero(r.rf.cobro / r.numero, mon)} por reparto` : ""}` : "No trae concepto de reparto"}</div>
    </div>`;
}

// ---- Detalle de una factura (vista previa y modal) ----------------------------
function htmlDetalle(f, salida) {
  const c = f.calculos || calcular(f);
  const tipo = salida ? salida.tipo : "sin";
  const mon = f.moneda || "MXN";
  const usd = mon !== "MXN";
  const cp = f.cartaPorte || {};
  const campos = (pares) => pares.filter(([, v]) => v).map(([k, v]) => `<span>${esc(k)}</span><div>${v}</div>`).join("");
  const dom = (p) => [p.calle, p.numero, p.colonia, p.municipio, p.cp ? "CP " + p.cp : ""].filter(Boolean).map(esc).join(" · ");
  const cli = f.cliente || {}, fis = f.fiscal || {}, rem = f.remitente || {}, des = f.destinatario || {};
  return `
    <div style="margin-top:10px;font-size:13px;"><span class="re-chip ${TIPO[tipo].clase}">${TIPO[tipo].txt}</span>
      ${salida && f.cartaPorteFolio && salida.factura !== String(f.cartaPorteFolio).toUpperCase() ? ` <span class="re-chip re-ambar">REFACTURA</span> <span class="nota">Salida ${esc(salida.factura)} (la factura trae ${esc(f.cartaPorteFolio)})${salida._liga ? " · " + esc(salida._liga) : ""}.</span><br>` : ""}
      ${salida ? ` Adrematasa: Prog <b>${esc(salida.prog)}</b> · salida ${esc(salida.tempSalida || "—")} · remolque ${esc(salida.remolque || "—")} · carro ${esc(salida.carro || "—")} · ${esc(salida.fechaHora || "")}` : ` <span class="nota">Todavía no se pega la salida de ${esc(f.cartaPorteFolio || "esta factura")} del Adrematasa.</span>`}</div>
    <div class="re-kpis">
      <div class="re-kpi hero"><b>${c.fletePorKm != null ? dinero(c.fletePorKm) : "—"}</b><small>Flete por km${usd ? " (en MXN)" : ""}</small></div>
      <div class="re-kpi"><b>${c.subtotalPorKm != null ? dinero(c.subtotalPorKm) : "—"}</b><small>Subtotal por km${usd ? " (en MXN)" : ""}</small></div>
      <div class="re-kpi"><b>${c.km != null ? miles(c.km) + " km" : "—"}</b><small>Distancia recorrida (Carta Porte)</small></div>
      <div class="re-kpi"><b>${dinero(f.subtotal, mon)}</b><small>Subtotal · ${esc(mon)} · TC ${esc(f.tipoCambio)}${usd ? " = " + dinero(c.subtotalMxn) : ""}</small></div>
      <div class="re-kpi"><b>${dinero(f.total, mon)}</b><small>Total (${esc((f.iva && f.iva.etiqueta) || "IVA")} · ${esc((f.retencion && f.retencion.etiqueta) || "retención")})</small></div>
    </div>
    ${htmlRepartos(f, salida)}
    <div class="re-h3">Conceptos</div>
    <div class="tabla-wrap"><table class="tabla re-tabla">
      <thead><tr><th>Cant.</th><th>Clave prod/serv</th><th>Clave unidad</th><th>Servicio</th><th>Objeto impuesto</th><th class="n">P. unitario</th><th class="n">Importe</th><th class="n">Por km${usd ? " (MXN)" : ""}</th></tr></thead>
      <tbody>
        ${(f.conceptos || []).map(k => `<tr><td>${esc(k.cantidad)}</td><td>${esc(k.claveProdServ)}</td><td>${esc(k.claveUnidad)}</td><td><b>${esc(k.servicio)}</b></td><td>${esc(k.objetoImpuesto)}</td><td class="n">${dinero(k.pUnitario, mon)}</td><td class="n"><b>${dinero(k.importe, mon)}</b></td><td class="n">${c.km ? dinero((k.importe || 0) * (usd ? f.tipoCambio : 1) / c.km) : "—"}</td></tr>`).join("")}
        <tr><td colspan="6" class="n">Subtotal</td><td class="n"><b>${dinero(f.subtotal, mon)}</b></td><td class="n"><b>${c.subtotalPorKm != null ? dinero(c.subtotalPorKm) : "—"}</b></td></tr>
        <tr><td colspan="6" class="n">${esc((f.iva && f.iva.etiqueta) || "IVA")} · ${esc((f.retencion && f.retencion.etiqueta) || "Retención")}</td><td class="n">${dinero(f.iva && f.iva.valor, mon)} · −${dinero(f.retencion && f.retencion.valor, mon)}</td><td></td></tr>
      </tbody>
    </table></div>
    <div class="re-grid3" style="margin-top:14px;">
      <div><div class="re-h3" style="margin-top:0;">Cliente</div><div class="re-campos">${campos([
        ["Nombre", `<b>${esc(cli.nombre)}</b>`], ["RFC", esc(cli.rfc)], ["Domicilio", dom(cli)],
        ["Residencia fiscal", esc(fis.residenciaFiscal)], ["Uso CFDI", esc(fis.usoCfdi)], ["Forma de pago", esc(fis.formaPago)],
        ["Método de pago", esc(fis.metodoPago)], ["Régimen", esc(fis.regimenFiscal)], ["Condiciones", f.condicionesPago ? esc(f.condicionesPago) + " días" : ""],
      ])}</div></div>
      <div><div class="re-h3" style="margin-top:0;">Remitente → Destinatario</div><div class="re-campos">${campos([
        ["Remitente", `${esc(rem.nombre)}${rem.rfc ? " · " + esc(rem.rfc) : ""}`], ["Origen", `<b>${esc(f.origen)}</b>`], ["Domicilio", dom(rem)],
        ["Referencia", esc(rem.referencia)], ["Se recoge en", esc(rem.seRecogeEn)],
        ["Destinatario", `${esc(des.nombre)}${des.rfc ? " · " + esc(des.rfc) : ""}`], ["Destino", `<b>${esc(f.destino)}</b>`], ["Domicilio", dom(des)],
        ["Referencia", esc(des.referencia)], ["Se entrega en", esc(des.seEntregaEn)],
      ])}</div></div>
      <div><div class="re-h3" style="margin-top:0;">Viaje y Carta Porte</div><div class="re-campos">${campos([
        ["Moneda", `${esc(mon)} · TC ${esc(f.tipoCambio)}`], ["Viaje", esc(f.viaje)],
        ["Transporte int.", [cp.transporteInternacional, cp.paisOrigenDestino, cp.viaTransporte ? "Vía " + cp.viaTransporte : ""].filter(Boolean).map(esc).join(" · ")],
        ["Unidad / Rem.", [f.unidad, f.remolque, cp.configuracion, cp.anio].filter(Boolean).map(esc).join(" · ")],
        ["Placas", esc(cp.placas)], ["Operador", esc(f.operador)], ["Licencia / RFC", [f.licencia, f.rfcOperador].filter(Boolean).map(esc).join(" · ")],
        ["Peso bruto", cp.pesoBrutoTotal != null ? miles(cp.pesoBrutoTotal) + " kg · vehicular " + esc(cp.pesoBrutoVehicular || "") : ""],
        ["Pedimento", esc(cp.pedimento)], ["RFC importador", esc(cp.rfcImportador)],
        ["Salida / llegada", [cp.fechaSalida, cp.fechaLlegada].filter(Boolean).map(esc).join(" → ")],
        ["Sello", esc(f.sello)], ["Observaciones", esc(f.observaciones)], ["Capturó (Ingreso)", esc(f.ingreso)],
        ["Folio fiscal", esc(f.uuid)],
      ])}</div></div>
    </div>`;
}

// ---- Pantalla ------------------------------------------------------------------
export function iniciarRentabilidad(contenedor, datosUsuario, uid) {
  inyectarEstilos();
  contenedor.innerHTML = `
    <section class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
        <h2 style="margin:0;">Rentabilidad</h2>
        <span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <span class="nota" id="re-conteo" style="margin:0;"></span>
          <select id="re-periodo" style="width:auto;" title="Solo se leen las facturas y salidas de este periodo (ahorra lecturas)">
            <option value="1">Este mes</option><option value="2">Este mes y el anterior</option><option value="3">Últimos 3 meses</option>
            <option value="6">Últimos 6 meses</option><option value="12">Últimos 12 meses</option><option value="0">Todo (más lecturas)</option>
          </select>
          <button type="button" id="re-reporte" title="Reporte de tarifas de todos los clientes con flete (PDF, Excel o copiar)">⤓ Reporte</button>
        </span>
      </div>
      <p class="nota" style="margin:4px 0 12px;">Ingreso por km a partir de las facturas. Solo tú ves esta opción.</p>
      <div class="re-tabs" id="re-tabs"></div>
      <div id="re-error" class="error"></div>
      <p id="re-exito" class="nota oculto" style="color:#1c7a41;"></p>
      <div id="re-cuerpo"></div>
    </section>`;
  const $ = (s) => contenedor.querySelector(s);
  let tab = "tarifas";
  let facturas = null;            // Map uuid -> factura guardada
  let cargadas = [];              // [{ nombre, f, estado, error }]
  let elegida = -1;
  const filtro = { mes: "", cliente: "", ruta: "", tipo: "" };
  let salidas = null;             // Map TAIM -> salida del Adrematasa
  let pegadas = null;             // salidas leídas del reporte pegado, sin guardar
  let filtroSalidas = "todas";
  let metricaKm = "flete";   // Cliente · ruta · tipo: "flete" | "subtotal"
  // Paginación (2026-10-28): las tablas largas se muestran de 25 en 25.
  const POR_PAGINA = 25;
  const paginas = {};
  function paginar(clave, items, firma) {
    const st = paginas[clave] || (paginas[clave] = { pag: 1, firma: "" });
    if (st.firma !== firma) { st.pag = 1; st.firma = firma; } // cambió el filtro: regresa a la página 1
    const total = Math.max(1, Math.ceil(items.length / POR_PAGINA));
    if (st.pag > total) st.pag = total;
    const ini = (st.pag - 1) * POR_PAGINA;
    const html = items.length > POR_PAGINA ? `<div class="re-pag" data-pag="${clave}">
      <button type="button" class="secundario" data-dir="-1"${st.pag <= 1 ? " disabled" : ""}>‹ Anterior</button>
      <span class="nota" style="margin:0;">Página ${st.pag} de ${total} · ${items.length.toLocaleString("es-MX")} en total</span>
      <button type="button" class="secundario" data-dir="1"${st.pag >= total ? " disabled" : ""}>Siguiente ›</button></div>` : "";
    return { items: items.slice(ini, ini + POR_PAGINA), html };
  }
  function enlazarPaginas(redibujar) {
    $("#re-cuerpo").querySelectorAll(".re-pag button").forEach(b => b.addEventListener("click", () => {
      const clave = b.closest(".re-pag").dataset.pag;
      paginas[clave].pag += Number(b.dataset.dir);
      redibujar();
      const t = $("#re-cuerpo").querySelector(".tabla-wrap");
      if (t) t.scrollIntoView({ block: "start", behavior: "smooth" });
    }));
  }
  let grupoSalidas = null;   // { taims:Set, txt }: salidas sin factura de un renglón de Tarifas
  let grupoFacturas = null;  // { uuids:Set, txt }: facturas de un renglón de Tarifas
  const normTxt = (t) => String(t || "").toUpperCase().replace(/\s+/g, " ").trim();
  // ---- Ligas factura ↔ salida (2026-10-30: refacturas) ----
  // 1) manual (rentabilidad_config/ligas) · 2) misma carta porte · 3) refactura:
  // mismo remolque y (mismo sello o misma unidad), salida entre 25 días antes y
  // 2 días después de la factura. Una sola candidata = se liga sola.
  let ligasManual = {};            // { uuid: "TAIM-…" | "NO" }
  let cacheLigas = null;
  function ligas() {
    if (cacheLigas) return cacheLigas;
    const facturaDeTaim = new Map(), salidaDeUuid = new Map(), posibles = new Map(), posiblesDeUuid = new Map();
    const fs = lista();
    const sal = salidas || new Map();
    const ligar = (f, x, como) => { facturaDeTaim.set(x.factura, f); salidaDeUuid.set(f.uuid, como ? { ...x, _liga: como } : x); };
    fs.forEach(f => { const m = ligasManual[f.uuid]; if (m && m !== "NO" && sal.has(m) && !facturaDeTaim.has(m)) ligar(f, sal.get(m), "ligada a mano"); });
    fs.forEach(f => {
      if (salidaDeUuid.has(f.uuid) || ligasManual[f.uuid]) return;
      const t = String(f.cartaPorteFolio || "").toUpperCase();
      if (t && sal.has(t) && !facturaDeTaim.has(t)) ligar(f, sal.get(t), "");
    });
    const reclamos = new Map(); // TAIM -> [{ f, fuerte }]
    fs.forEach(f => {
      if (salidaDeUuid.has(f.uuid) || ligasManual[f.uuid] || !f.remolque) return;
      const ms = f.fecha ? new Date(f.fecha + "T12:00:00").getTime() : null;
      const rem = soloDigitos(f.remolque), uni = soloDigitos(f.unidad), ss = new Set(sellos(f.sello));
      let cand = [];
      sal.forEach(x => {
        if (facturaDeTaim.has(x.factura) || soloDigitos(x.remolque) !== rem) return;
        if (ms && x.fechaMs && (x.fechaMs < ms - 25 * 864e5 || x.fechaMs > ms + 2 * 864e5)) return;
        const porSello = sellos(x.sello).some(z => ss.has(z));
        const porUnidad = uni && soloDigitos(x.carro) === uni;
        if (porSello || porUnidad) cand.push({ x, fuerte: porSello });
      });
      if (cand.some(c => c.fuerte)) cand = cand.filter(c => c.fuerte);
      cand.forEach(c => { const l = reclamos.get(c.x.factura) || []; l.push({ f, fuerte: c.fuerte, n: cand.length }); reclamos.set(c.x.factura, l); });
      if (cand.length) posiblesDeUuid.set(f.uuid, cand.map(c => c.x.factura));
    });
    // Se liga sola si la factura tiene una sola candidata y nadie más la reclama.
    posiblesDeUuid.forEach((taims, uuid) => {
      const f = facturas.get(uuid);
      if (taims.length === 1 && (reclamos.get(taims[0]) || []).length === 1) {
        const r = reclamos.get(taims[0])[0];
        ligar(f, sal.get(taims[0]), r.fuerte ? "ligada por sello y remolque" : "ligada por remolque y unidad");
      }
    });
    reclamos.forEach((l, taim) => { if (!facturaDeTaim.has(taim)) posibles.set(taim, l.map(r => r.f).filter(f => !salidaDeUuid.has(f.uuid))); });
    return (cacheLigas = { facturaDeTaim, salidaDeUuid, posibles, posiblesDeUuid });
  }
  const salidaDe = (f) => {
    if (!f) return null;
    if (facturas && facturas.has(f.uuid)) return ligas().salidaDeUuid.get(f.uuid) || null;
    return (salidas && f.cartaPorteFolio) ? salidas.get(String(f.cartaPorteFolio).toUpperCase()) || null : null; // factura aún sin guardar
  };
  const facturaDeSalida = (x) => ligas().facturaDeTaim.get(x.factura) || null;
  async function guardarLiga(uuid, valor) {
    const nuevo = { ...ligasManual };
    if (valor) nuevo[uuid] = valor; else delete nuevo[uuid];
    try { await setDoc(doc(db, COL_CONFIG, "ligas"), { porFactura: nuevo, actualizadoEn: new Date().toISOString() }); }
    catch (e) { $("#re-error").textContent = "No se pudo guardar la liga: " + e.message; }
  }
  // Paradas (2026-10-30): equivalencias de nombres ("MONTERREY" = "MTY").
  let paradasEq = {};              // { "MONTERREY": "MTY" }
  const canon = (p) => { const k = normTxt(p); return paradasEq[k] || k; };
  const recorridoDe = (f, x) => infoReparto(f, x, canon);
  const tipoDe = (f) => { const sa = salidaDe(f); return sa ? sa.tipo : "sin"; };

  function avisar(t) {
    $("#re-exito").textContent = t;
    $("#re-exito").classList.remove("oculto");
    setTimeout(() => $("#re-exito").classList.add("oculto"), 6000);
  }

  // Periodo (2026-10-28, para ahorrar lecturas): solo se escuchan las facturas
  // (por fecha) y las salidas (por fechaMs, con 15 días de margen antes, para
  // que una factura del inicio del periodo encuentre su salida) del periodo.
  // Se recuerda en este navegador.
  let periodoMeses = 2;
  try { const g = localStorage.getItem("rentabilidad_periodo"); if (g != null && ["0", "1", "2", "3", "6", "12"].includes(g)) periodoMeses = Number(g); } catch (e) { /* sin almacenamiento */ }
  $("#re-periodo").value = String(periodoMeses);
  function inicioPeriodo() {
    if (!periodoMeses) return null;
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); d.setMonth(d.getMonth() - (periodoMeses - 1));
    return d;
  }
  function pintarConteo() {
    if (!facturas) return;
    const nf = facturas.size, ns = salidas ? salidas.size : null;
    $("#re-conteo").textContent = `${nf} factura${nf === 1 ? "" : "s"}${ns != null ? ` · ${ns.toLocaleString("es-MX")} salida${ns === 1 ? "" : "s"}` : ""} en el periodo`;
  }
  let cancelar = () => {}, cancelarSalidas = () => {};
  function suscribir() {
    suscribirConfig();
    cancelar(); cancelarSalidas();
    facturas = null; salidas = null;
    render();
    const ini = inicioPeriodo();
    const qFacturas = ini
      ? query(collection(db, COL), where("fecha", ">=", `${ini.getFullYear()}-${String(ini.getMonth() + 1).padStart(2, "0")}-01`))
      : collection(db, COL);
    const qSalidas = ini
      ? query(collection(db, COL_SALIDAS), where("fechaMs", ">=", ini.getTime() - 15 * 864e5))
      : collection(db, COL_SALIDAS);
    cancelar = onSnapshot(qFacturas, (snap) => {
      facturas = new Map(snap.docs.map(d => [d.id, d.data()]));
      pintarConteo();
      cargadas.forEach(c => { if (c.estado !== "guardada" && c.f && c.f.uuid && facturas.has(c.f.uuid)) c.estado = c.estado === "lista" ? "duplicada" : c.estado; });
      render();
    }, (err) => { $("#re-error").textContent = "No se pudieron leer las facturas: " + err.message; });
    cancelarSalidas = onSnapshot(qSalidas, (snap) => {
      salidas = new Map(snap.docs.map(d => [d.id, d.data()]));
      pintarConteo();
      if (tab !== "cargar") render(); else renderVista();
    }, (err) => { $("#re-error").textContent = "No se pudieron leer las salidas: " + err.message; });
  }
  $("#re-reporte").addEventListener("click", () => abrirModalReporte());
  $("#re-periodo").addEventListener("change", (e) => {
    periodoMeses = Number(e.target.value);
    try { localStorage.setItem("rentabilidad_periodo", String(periodoMeses)); } catch (err) { /* nada */ }
    filtro.mes = "";
    suscribir();
  });
  const vigilar = setInterval(() => { if (!contenedor.isConnected) { clearInterval(vigilar); cancelar(); cancelarSalidas(); if (cancelarConfig) cancelarConfig(); } }, 3000);

  function renderTabs() {
    $("#re-tabs").innerHTML = [["tarifas", "Tarifas por cliente"], ["volumen", "Volumen por cliente"], ["cargar", "Cargar facturas"], ["cargarSalidas", "Cargar salidas"], ["zonas", "Zonas y equivalencias"], ["facturas", "Facturas"], ["salidas", "Salidas"]]
      .map(([k, t]) => `<button type="button" class="re-tab${tab === k ? " activo" : ""}" data-t="${k}">${t}</button>`).join("");
    $("#re-tabs").querySelectorAll(".re-tab").forEach(b => b.addEventListener("click", () => { tab = b.dataset.t; render(); }));
  }

  function render() {
    cacheLigas = null;
    renderTabs();
    if (tab === "cargar") return renderCargar();
    if (!facturas) { $("#re-cuerpo").innerHTML = `<p class="nota">Cargando…</p>`; return; }
    if (tab === "facturas") return renderFacturas();
    if (tab === "salidas" || tab === "cargarSalidas") return renderSalidas();
    if (tab === "zonas") return renderZonas();
    if (tab === "volumen") return renderVolumen();
    return renderTarifas();
  }

  // ---- Cargar ----
  function estadoChip(c) {
    if (c.estado === "leyendo") return `<span class="re-chip re-gris">LEYENDO…</span>`;
    if (c.estado === "error") return `<span class="re-chip re-rojo">NO SE PUDO LEER</span>`;
    if (c.estado === "duplicada") return `<span class="re-chip re-gris">YA ESTABA CARGADA</span>`;
    if (c.estado === "guardada") return `<span class="re-chip re-azul">GUARDADA</span>`;
    if (c.f && !c.f.calculos.km) return `<span class="re-chip re-ambar">FALTA DISTANCIA · captúrala</span>`;
    if (c.f && c.f.errores.length) return `<span class="re-chip re-ambar">REVISAR</span>`;
    return `<span class="re-chip re-verde">LISTA PARA GUARDAR</span>`;
  }
  const guardable = (c) => c.estado === "lista" && c.f && c.f.uuid && c.f.calculos.km;

  function renderCargar() {
    const listas = cargadas.filter(guardable).length;
    $("#re-cuerpo").innerHTML = `
      <div class="re-drop" id="re-drop" role="button" tabindex="0">Arrastra aquí los PDF de factura o <b>elige archivos</b><br>
        <small>Puedes cargar varios a la vez. Se leen en tu navegador; el PDF no se guarda.</small>
      </div>
      <input type="file" id="re-input" accept="application/pdf,.pdf" multiple style="display:none;">
      ${cargadas.length ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px;">
        <span class="nota" style="margin:0;">${cargadas.length} archivo${cargadas.length === 1 ? "" : "s"} · ${listas} listo${listas === 1 ? "" : "s"} para guardar</span>
        <span style="display:flex;gap:6px;"><button type="button" class="secundario" id="re-limpiar">Limpiar lista</button>
        <button type="button" id="re-guardar-todas"${listas ? "" : " disabled"}>Guardar ${listas || ""} lista${listas === 1 ? "" : "s"}</button></span></div>` : ""}
      <div id="re-archivos">${cargadas.map((c, i) => `
        <div class="re-arch${i === elegida ? " activo" : ""}" data-i="${i}">
          <span>📄 ${esc(c.nombre)}${c.f ? ` · ${esc(c.f.factura)} · ${esc((c.f.cliente || {}).nombre || "")}${c.f.calculos.km ? " · " + miles(c.f.calculos.km) + " km" : ""}` : ""}</span>
          ${estadoChip(c)}
        </div>`).join("")}</div>
      <div id="re-vista"></div>`;
    const drop = $("#re-drop"), input = $("#re-input");
    input.addEventListener("change", () => { const l = [...input.files]; input.value = ""; leerArchivos(l); });
    drop.addEventListener("click", () => input.click());
    ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("sobre"); }));
    ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("sobre"); }));
    drop.addEventListener("drop", (e) => leerArchivos([...e.dataTransfer.files].filter(f => /\.pdf$/i.test(f.name) || f.type === "application/pdf")));
    $("#re-archivos").querySelectorAll(".re-arch").forEach(el => el.addEventListener("click", () => { elegida = Number(el.dataset.i); renderCargar(); }));
    const limpiar = $("#re-limpiar");
    if (limpiar) limpiar.addEventListener("click", () => { cargadas = []; elegida = -1; renderCargar(); });
    const todas = $("#re-guardar-todas");
    if (todas) todas.addEventListener("click", guardarTodas);
    renderVista();
  }

  function renderVista() {
    const caja = $("#re-vista");
    if (!caja) return;
    const c = cargadas[elegida];
    if (!c) { caja.innerHTML = ""; return; }
    if (c.estado === "error") { caja.innerHTML = `<div class="re-errores">${esc(c.error)}</div>`; return; }
    if (!c.f) { caja.innerHTML = ""; return; }
    const f = c.f;
    const faltaKm = !f.calculos.km;
    caja.innerHTML = `
      <div class="panel" style="margin-top:14px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">
          <div><h2 style="margin:0;">${esc(f.factura)}${f.cartaPorteFolio ? " / " + esc(f.cartaPorteFolio) : ""}</h2>
            <div class="nota" style="margin:3px 0 0;">${fechaCorta(f.fecha)} ${esc(f.hora || "")} · Viaje ${esc(f.viaje)} · ${esc(f.ruta || "sin ruta")}</div></div>
          ${c.estado === "lista" ? `<span style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            ${faltaKm ? `<span class="re-km"><input type="number" min="1" step="1" id="re-km" placeholder="Km"><button type="button" class="secundario" id="re-km-ok">Usar km</button></span>` : ""}
            <button type="button" id="re-guardar"${guardable(c) ? "" : " disabled"}>Guardar factura</button></span>` : estadoChip(c)}
        </div>
        ${f.errores.length ? `<div class="re-errores">${f.errores.map(esc).join("<br>")}</div>` : ""}
        ${c.estado === "duplicada" ? `<div class="re-errores">Esta factura (folio fiscal ${esc(f.uuid)}) ya está guardada. No se vuelve a guardar.</div>` : ""}
        ${htmlDetalle(f, salidaDe(f))}
      </div>`;
    const ok = $("#re-km-ok");
    if (ok) ok.addEventListener("click", () => {
      const km = Number($("#re-km").value);
      if (!isFinite(km) || km <= 0) return;
      f.cartaPorte.distanciaKm = km;
      f.kmCapturado = true;
      f.errores = f.errores.filter(e => !/Distancia/.test(e));
      f.calculos = calcular(f);
      renderCargar();
    });
    const g = $("#re-guardar");
    if (g) g.addEventListener("click", async () => { g.disabled = true; await guardar(c); renderCargar(); });
  }

  async function leerArchivos(lista) {
    if (!lista.length) return;
    $("#re-error").textContent = "";
    let lib;
    try { lib = await pdfjs(); } catch (e) { $("#re-error").textContent = "No se pudo cargar el lector de PDF: " + e.message; return; }
    const nuevos = lista.map(a => ({ nombre: a.name, archivo: a, f: null, estado: "leyendo" }));
    cargadas = cargadas.concat(nuevos);
    if (elegida < 0) elegida = cargadas.length - nuevos.length;
    renderCargar();
    for (const c of nuevos) {
      try {
        const paginas = await paginasDePdf(lib, new Uint8Array(await c.archivo.arrayBuffer()));
        c.f = leerFactura(paginas);
        if (!c.f.uuid) { c.estado = "error"; c.error = "No es una factura con el formato esperado (no encontré el Folio Fiscal)."; }
        else if ((facturas && facturas.has(c.f.uuid)) || cargadas.some(o => o !== c && o.f && o.f.uuid === c.f.uuid && o.estado !== "error")) c.estado = "duplicada";
        else if (await yaGuardada(c.f.uuid)) c.estado = "duplicada"; // guardada antes del periodo que se está viendo
        else c.estado = "lista";
      } catch (e) {
        c.estado = "error"; c.error = "No se pudo leer el PDF: " + (e.message || e);
      }
      delete c.archivo;
      renderCargar();
    }
  }

  async function yaGuardada(uuid) {
    try { return (await getDoc(doc(db, COL, uuid))).exists(); } catch (e) { return false; }
  }
  function registro(f) {
    const limpio = JSON.parse(JSON.stringify(f));
    delete limpio.errores;
    limpio.clienteClave = claveCliente(f);
    limpio.mes = (f.fecha || "").slice(0, 7);
    limpio.cargadaMs = Date.now();
    limpio.cargadaPor = { uid, nombre: (datosUsuario && datosUsuario.nombre) || "" };
    return limpio;
  }
  async function guardar(c) {
    if (!guardable(c)) return false;
    try {
      await setDoc(doc(db, COL, c.f.uuid), registro(c.f));
      c.estado = "guardada";
      return true;
    } catch (e) {
      $("#re-error").textContent = `No se pudo guardar ${c.f.factura}: ${e.message}`;
      return false;
    }
  }
  async function guardarTodas() {
    let n = 0;
    for (const c of cargadas.filter(guardable)) if (await guardar(c)) n++;
    avisar(`${n} factura${n === 1 ? "" : "s"} guardada${n === 1 ? "" : "s"}.`);
    renderCargar();
  }

  // ---- Filtros comunes ----
  function lista() { return [...(facturas || new Map()).values()]; }
  function filtradas(sinFiltro) {
    return lista().filter(f =>
      (!filtro.mes || f.mes === filtro.mes) &&
      (sinFiltro === "cliente" || !filtro.cliente || f.clienteClave === filtro.cliente) &&
      (sinFiltro === "ruta" || !filtro.ruta || f.ruta === filtro.ruta) &&
      (!filtro.tipo || tipoDe(f) === filtro.tipo));
  }
  function htmlFiltros(conCliente, conRuta, conExcel) {
    const todas = lista();
    const meses = [...new Set(todas.map(f => f.mes).filter(Boolean))].sort().reverse();
    const clientes = new Map(); todas.forEach(f => clientes.set(f.clienteClave, (f.cliente || {}).nombre || f.clienteClave));
    const rutas = [...new Set(todas.map(f => f.ruta).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    return `<div class="re-filtros">
      <select id="re-f-mes"><option value="">Todos los meses</option>${meses.map(m => `<option value="${m}"${filtro.mes === m ? " selected" : ""}>${nombreMes(m)}</option>`).join("")}</select>
      ${conCliente ? `<select id="re-f-cli"><option value="">Todos los clientes</option>${[...clientes.entries()].sort((a, b) => a[1].localeCompare(b[1], "es")).map(([k, n]) => `<option value="${esc(k)}"${filtro.cliente === k ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>` : ""}
      ${conRuta ? `<select id="re-f-ruta"><option value="">Todas las rutas</option>${rutas.map(r => `<option value="${esc(r)}"${filtro.ruta === r ? " selected" : ""}>${esc(r)}</option>`).join("")}</select>` : ""}
      <select id="re-f-tipo"><option value="">Seca y refrigerada</option><option value="seca"${filtro.tipo === "seca" ? " selected" : ""}>Solo secas</option><option value="refrigerada"${filtro.tipo === "refrigerada" ? " selected" : ""}>Solo refrigeradas</option><option value="sin"${filtro.tipo === "sin" ? " selected" : ""}>Sin dato de tipo</option></select>
      ${conExcel ? `<button type="button" class="secundario" id="re-excel">Descargar Excel</button>` : ""}
    </div>`;
  }
  function enlazarFiltros() {
    const e = (id, k) => { const el = $(id); if (el) el.addEventListener("change", () => { filtro[k] = el.value; render(); }); };
    e("#re-f-mes", "mes"); e("#re-f-cli", "cliente"); e("#re-f-ruta", "ruta"); e("#re-f-tipo", "tipo");
    const x = $("#re-excel"); if (x) x.addEventListener("click", descargarExcel);
  }
  const vacio = () => `<p class="nota" style="text-align:center;padding:16px;">${facturas.size ? "No hay facturas con estos filtros." : "Todavía no hay facturas. Cárgalas en la pestaña Cargar."}</p>`;

  // ---- Facturas ----
  function renderFacturas() {
    const fs = filtradas().filter(f => !grupoFacturas || grupoFacturas.uuids.has(f.uuid))
      .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "") || (b.factura || "").localeCompare(a.factura || ""));
    const pg = paginar("facturas", fs, JSON.stringify(filtro) + (grupoFacturas ? grupoFacturas.txt : "") + fs.length);
    $("#re-cuerpo").innerHTML = htmlFiltros(true, true, true) +
      (grupoFacturas ? `<div class="re-filtros"><span class="re-chip re-azul" style="font-size:12px;">${esc(grupoFacturas.txt)}</span><button type="button" class="secundario" id="re-f-quitar-grupo" style="padding:4px 10px;font-size:12px;">Quitar filtro ✕</button></div>` : "") + (fs.length ? `
      <div class="tabla-wrap"><table class="tabla re-tabla">
        <thead><tr><th>Fecha</th><th>Factura</th><th>Tipo</th><th>Cliente</th><th>Ruta</th><th>Unidad</th><th class="n">Km</th><th class="n">Flete MXN</th><th class="n">Flete/km</th><th class="n">Subtotal MXN</th><th class="n">Subtotal/km</th></tr></thead>
        <tbody>${pg.items.map(f => { const c = f.calculos || {}; return `<tr class="clic" data-u="${esc(f.uuid)}">
          <td>${fechaCorta(f.fecha)}</td><td>${esc(f.factura)}${f.moneda !== "MXN" ? ` <span class="re-chip re-azul">${esc(f.moneda)}</span>` : ""}</td>
          <td><span class="re-chip ${TIPO[tipoDe(f)].clase}">${TIPO[tipoDe(f)].txt}</span></td>
          <td>${esc((f.cliente || {}).nombre)}</td><td>${esc(f.ruta)}${(() => { const sa = salidaDe(f); const r = infoReparto(f, sa); return (r.numero ? ` <span class="re-chip re-rep">${r.numero} REPARTO${r.numero === 1 ? "" : "S"}</span>${r.sinCobro ? ` <span class="re-chip re-rojo">SIN COBRO</span>` : ""}` : "") + (sa && sa.factura !== String(f.cartaPorteFolio || "").toUpperCase() ? ` <span class="re-chip re-ambar">REFACTURA</span>` : "") + (!sa && ligas().posiblesDeUuid.has(f.uuid) ? ` <span class="re-chip re-ambar">¿REFACTURA?</span>` : ""); })()}</td><td>${esc(f.unidad)}</td>
          <td class="n">${miles(c.km)}${f.kmCapturado ? "*" : ""}</td><td class="n">${dinero(c.fleteMxn)}</td><td class="n"><b>${dinero(c.fletePorKm)}</b></td>
          <td class="n">${dinero(c.subtotalMxn)}</td><td class="n">${dinero(c.subtotalPorKm)}</td></tr>`; }).join("")}</tbody>
      </table></div>${pg.html}
      <p class="nota">* Km capturados a mano. Toca una factura para ver todo su detalle, corregir los km o borrarla.</p>` : vacio());
    enlazarFiltros();
    enlazarPaginas(renderFacturas);
    const qf = $("#re-f-quitar-grupo"); if (qf) qf.addEventListener("click", () => { grupoFacturas = null; renderFacturas(); });
    $("#re-cuerpo").querySelectorAll("tr.clic").forEach(tr => tr.addEventListener("click", () => abrirDetalle(tr.dataset.u)));
  }

  function abrirDetalle(id) {
    const f = facturas.get(id);
    if (!f) return;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-tarjeta" style="max-width:1000px;width:100%;max-height:90vh;overflow:auto;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
          <div><h2 style="margin:0;">${esc(f.factura)}${f.cartaPorteFolio ? " / " + esc(f.cartaPorteFolio) : ""}</h2>
            <div class="nota" style="margin:3px 0 0;">${fechaCorta(f.fecha)} ${esc(f.hora || "")} · Viaje ${esc(f.viaje)} · ${esc(f.ruta)}</div></div>
          <button type="button" class="secundario re-cerrar">✕</button>
        </div>
        ${htmlDetalle(f, salidaDe(f))}
        <div class="re-errores" id="re-d-err" style="display:none;"></div>
        <div class="modal-acciones" style="flex-wrap:wrap;">
          <span class="re-km"><input type="number" min="1" step="1" id="re-d-km" value="${esc((f.cartaPorte || {}).distanciaKm || "")}"><button type="button" class="secundario" id="re-d-km-ok">Corregir km</button></span>
          <button type="button" class="secundario" id="re-d-liga">${salidaDe(f) ? "Desligar salida" : "Ligar salida"}</button>
          <button type="button" class="secundario" id="re-d-borrar">Borrar factura</button>
          <button type="button" class="re-cerrar">Cerrar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const cerrar = () => overlay.remove();
    overlay.querySelectorAll(".re-cerrar").forEach(b => b.addEventListener("click", cerrar));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) cerrar(); });
    const err = (t) => { const e = overlay.querySelector("#re-d-err"); e.textContent = t; e.style.display = "block"; };
    overlay.querySelector("#re-d-km-ok").addEventListener("click", async () => {
      const km = Number(overlay.querySelector("#re-d-km").value);
      if (!isFinite(km) || km <= 0) return err("Escribe los km.");
      const copia = JSON.parse(JSON.stringify(f));
      copia.cartaPorte = { ...(copia.cartaPorte || {}), distanciaKm: km };
      try {
        await updateDoc(doc(db, COL, id), { "cartaPorte.distanciaKm": km, kmCapturado: true, calculos: calcular(copia) });
        cerrar(); avisar(`Km de ${f.factura} corregidos.`);
      } catch (e) { err("No se pudo guardar: " + e.message); }
    });
    overlay.querySelector("#re-d-liga").addEventListener("click", async () => {
      const actual = salidaDe(f);
      if (actual) {
        if (!confirm(`¿Desligar la salida ${actual.factura} de ${f.factura}? Ya no se ligará sola.`)) return;
        await guardarLiga(f.uuid, "NO"); cerrar(); avisar(`${f.factura} quedó sin salida.`);
      } else {
        const t = normTxt(prompt(`Carta porte de la salida para ${f.factura} (ej. TAIM-55587):`) || "").replace(/\s+/g, "");
        if (!t) return;
        if (!salidas || !salidas.has(t)) return err(`No encontré la salida ${t} en el periodo.`);
        await guardarLiga(f.uuid, t); cerrar(); avisar(`${f.factura} ligada con ${t}.`);
      }
    });
    overlay.querySelector("#re-d-borrar").addEventListener("click", async () => {
      if (!confirm(`¿Borrar la factura ${f.factura}? Podrás volver a cargarla después.`)) return;
      try { await deleteDoc(doc(db, COL, id)); cerrar(); avisar(`Factura ${f.factura} borrada.`); }
      catch (e) { err("No se pudo borrar: " + e.message); }
    });
  }

  // ============================================================================
  // Tarifas por cliente (2026-10-28, replanteo con Ivan).
  // Un renglón por CLIENTE (de la factura) × ZONA de destino × CARGA (seca /
  // refrigerada, de la salida del Adrematasa) × RUTA (corta < 350 km ≤ larga, por
  // los km del PDF). Valores como vienen en la factura; ingreso por km en MXN.
  // "Sin factura": salidas del Adrematasa del mismo cliente, zona y carga que aún
  // no tienen PDF. Para ubicarlas se APRENDEN equivalencias de las salidas que sí
  // tienen factura (cliente y destino del Adrematasa → los de la factura); el
  // cliente se puede corregir a mano en "Zonas y equivalencias".
  // ============================================================================
  const KM_RUTA_LARGA = 350; // < 350 = corta; 350 o más = larga
  const tipoRuta = (km) => km == null || !isFinite(km) ? "sin" : (km < KM_RUTA_LARGA ? "corta" : "larga");
  const RUTA = { corta: { txt: "CORTA", clase: "re-verde" }, larga: { txt: "LARGA", clase: "re-azul" }, sin: { txt: "SIN KM", clase: "re-gris" } };
  const ft = { cliente: "", zona: "", carga: "", ruta: "", q: "", viajes: "" }; // filtros de Tarifas ("viajes": "" todos | "directo" | "reparto")
  let config = { zonas: [], clientes: {} }; // rentabilidad_config/zonas y /equivalencias
  let cancelarConfig = null;
  function suscribirConfig() {
    if (cancelarConfig) return;
    const c1 = onSnapshot(doc(db, COL_CONFIG, "zonas"), (s) => {
      config.zonas = s.exists() && Array.isArray(s.data().lista) ? s.data().lista : [];
      if (tab === "tarifas" || tab === "zonas") render();
    }, (err) => { $("#re-error").textContent = "No se pudieron leer las zonas: " + err.message; });
    const c2 = onSnapshot(doc(db, COL_CONFIG, "equivalencias"), (s) => {
      config.clientes = s.exists() && s.data().clientes ? s.data().clientes : {};
      if (tab === "tarifas" || tab === "zonas") render();
    }, () => {});
    const c3 = onSnapshot(doc(db, COL_CONFIG, "ligas"), (s) => {
      ligasManual = s.exists() && s.data().porFactura ? s.data().porFactura : {};
      if (facturas) render();
    }, () => {});
    const c4 = onSnapshot(doc(db, COL_CONFIG, "paradas"), (s) => {
      paradasEq = s.exists() && s.data().mapa ? s.data().mapa : {};
      if (tab === "tarifas" || tab === "zonas") render();
    }, () => {});
    cancelarConfig = () => { c1(); c2(); c3(); c4(); };
  }
  const zonaDe = (clave) => config.zonas.find(z => (z.destinos || []).includes(clave)) || null;
  const destAdr = (x) => normTxt(paradasSalida(x).slice(-1)[0] || x.destino); // destino FINAL (última parada)
  const adrDestino = (x) => "ADR:" + destAdr(x);
  const etiquetaDestino = (clave) => clave.startsWith("ADR:") ? clave.slice(4) : clave;
  const moda = (mapa) => { let mejor = null, n = 0; mapa.forEach((v, k) => { if (v > n) { mejor = k; n = v; } }); return mejor; };

  // Equivalencias aprendidas de las salidas que sí tienen factura.
  function aprender() {
    const porTaim = ligas().facturaDeTaim;
    const cli = new Map(), des = new Map(), kmDes = new Map(), nombres = new Map();
    lista().forEach(f => {
      nombres.set(f.clienteClave, (f.cliente || {}).nombre || f.clienteClave);
      const km = (f.calculos || {}).km;
      if (f.destino && km) { const m = kmDes.get(f.destino) || new Map(); m.set(km, (m.get(km) || 0) + 1); kmDes.set(f.destino, m); }
    });
    (salidas ? [...salidas.values()] : []).forEach(x => {
      const f = porTaim.get(x.factura);
      if (!f) return;
      const c = normTxt(x.cliente), d = destAdr(x);
      if (c) { const m = cli.get(c) || new Map(); m.set(f.clienteClave, (m.get(f.clienteClave) || 0) + 1); cli.set(c, m); }
      if (d && f.destino) { const m = des.get(d) || new Map(); m.set(f.destino, (m.get(f.destino) || 0) + 1); des.set(d, m); }
    });
    const clienteDe = (adr) => {
      const manual = config.clientes[adr];
      if (manual && manual.clave) return { clave: manual.clave, nombre: manual.nombre || nombres.get(manual.clave) || manual.clave, manual: true };
      const m = cli.get(adr);
      if (!m) return null;
      const clave = moda(m);
      return { clave, nombre: nombres.get(clave) || clave, n: m.get(clave) };
    };
    const destinoDe = (adr) => { const m = des.get(adr); return m ? moda(m) : null; };
    const kmDe = (destino) => { const m = kmDes.get(destino); return m ? moda(m) : null; };
    return { porTaim, cli, des, nombres, clienteDe, destinoDe, kmDe };
  }

  function celdaValor(valores, total, formato) {
    const v = valores.filter(x => x != null);
    if (!v.length) return "—";
    const cuenta = new Map();
    v.forEach(x => { const r = Math.round(x * 100) / 100; cuenta.set(r, (cuenta.get(r) || 0) + 1); });
    const comun = [...cuenta.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
    const min = Math.min(...v), max = Math.max(...v);
    let extra = "";
    if (min !== max) extra += `<br><small>varía ${formato(min)} – ${formato(max)}</small>`;
    if (v.length < total) extra += `<br><small>${v.length} de ${total}</small>`;
    return formato(comun) + extra;
  }

  // Renglones de Tarifas: un grupo por cliente × zona × carga × ruta × recorrido.
  // (2026-11-07: sale de renderTarifas para usarlo también en el Reporte y en Copiar.)
  const ORDEN_C = { seca: 0, refrigerada: 1, sin: 2 }, ORDEN_R = { corta: 0, larga: 1, sin: 2 };
  const ordenTarifas = (a, b) => a.cliNombre.localeCompare(b.cliNombre, "es") || a.zona.localeCompare(b.zona, "es") || ORDEN_C[a.carga] - ORDEN_C[b.carga] || ORDEN_R[a.ruta] - ORDEN_R[b.ruta] || a.intermedias.length - b.intermedias.length || a.rec.localeCompare(b.rec, "es");
  const pasaFiltroTarifas = (g) => { const q = normTxt(ft.q); return (!ft.cliente || g.cli === ft.cliente) && (!ft.zona || g.zona === ft.zona) &&
      (!ft.carga || g.carga === ft.carga) && (!ft.ruta || g.ruta === ft.ruta) &&
      (!ft.viajes || (ft.viajes === "reparto" ? !!g.rec : !g.rec)) &&
      (!q || normTxt(g.cliNombre).includes(q) || normTxt(g.zona).includes(q)); };
  function agrupar() {
    const ap = aprender();
    const grupos = new Map();
    // Recorrido = paradas antes del destino final (vacío = directo). Es parte del renglón.
    const grupo = (cli, cliNombre, destClave, carga, ruta, rep) => {
      const z = zonaDe(destClave);
      const zona = z ? z.nombre : etiquetaDestino(destClave);
      const rec = rep.intermedias.join(" → ");
      const k = `${cli}|${zona}|${carga}|${ruta}|${rec}`;
      if (!grupos.has(k)) grupos.set(k, { k, cli, cliNombre, zona, conZona: !!z, destinos: new Set(), carga, ruta, rec, intermedias: rep.intermedias, finales: new Set(), fs: [], pendientes: [], reps: [] });
      const g = grupos.get(k);
      g.destinos.add(etiquetaDestino(destClave));
      if (rep.final) g.finales.add(rep.final);
      g.reps.push(rep);
      return g;
    };
    lista().forEach(f => {
      const km = (f.calculos || {}).km;
      const rep = recorridoDe(f, salidaDe(f)); rep.f = f;
      grupo(f.clienteClave, (f.cliente || {}).nombre || f.clienteClave, f.destino || "Sin destino", tipoDe(f), tipoRuta(km), rep).fs.push(f);
    });
    (salidas ? [...salidas.values()] : []).forEach(x => {
      if (ap.porTaim.has(x.factura)) return;
      if (ligas().posibles.has(x.factura)) return; // posible refactura ya cargada: no se cuenta como "sin factura"
      const adrCli = normTxt(x.cliente);
      const c = ap.clienteDe(adrCli);
      const destPdf = ap.destinoDe(destAdr(x));
      const destClave = destPdf || adrDestino(x);
      const ruta = destPdf ? tipoRuta(ap.kmDe(destPdf)) : "sin";
      grupo(c ? c.clave : "ADR:" + adrCli, c ? c.nombre : `${adrCli || "SIN CLIENTE"} (Adrematasa, sin facturas)`, destClave, x.tipo, ruta, recorridoDe(null, x)).pendientes.push(x);
    });
    return { grupos, todos: [...grupos.values()] };
  }

  function renderTarifas() {
    const { grupos, todos } = agrupar();
    const clientesOpc = new Map(); todos.forEach(g => clientesOpc.set(g.cli, g.cliNombre));
    const zonasOpc = [...new Set(todos.map(g => g.zona))].sort((a, b) => a.localeCompare(b, "es"));
    const gs = todos.filter(pasaFiltroTarifas).sort(ordenTarifas);

    // Columnas de conceptos (FLETE + los más frecuentes; el resto en OTROS)
    const fsVis = gs.flatMap(g => g.fs);
    const frecuencia = new Map();
    fsVis.forEach(f => new Set((f.conceptos || []).map(k => nombreConcepto(k.servicio))).forEach(n => frecuencia.set(n, (frecuencia.get(n) || 0) + 1)));
    const otrosNombres = [...frecuencia.keys()].filter(n => n !== "FLETE").sort((a, b) => frecuencia.get(b) - frecuencia.get(a) || a.localeCompare(b, "es"));
    const visibles = otrosNombres.length > MAX_CONCEPTOS ? otrosNombres.slice(0, MAX_CONCEPTOS - 1) : otrosNombres;
    const hayOtros = otrosNombres.length > visibles.length;
    const columnas = ["FLETE", ...visibles, ...(hayOtros ? ["OTROS"] : [])];
    const colDe = (n) => n === "FLETE" || visibles.includes(n) ? n : "OTROS";

    const pg = paginar("tarifas", gs, JSON.stringify(ft) + gs.length);
    let anterior = null;
    const filas = pg.items.map(g => {
      const monedas = new Set(g.fs.map(f => f.moneda || "MXN"));
      const enOriginal = monedas.size <= 1;
      const mon = enOriginal ? ([...monedas][0] || "MXN") : "MXN";
      const fmt = (n) => dinero(n, mon);
      const mapas = g.fs.map(f => {
        const m = new Map();
        const tc = enOriginal ? 1 : (f.moneda === "MXN" ? 1 : (f.tipoCambio || 1));
        (f.conceptos || []).forEach(k => { const c = colDe(nombreConcepto(k.servicio)); m.set(c, (m.get(c) || 0) + (k.importe || 0) * tc); });
        return m;
      });
      const km = g.fs.reduce((s, f) => s + ((f.calculos || {}).km || 0), 0);
      const tot = g.fs.reduce((s, f) => s + ((f.calculos || {})[metricaKm === "flete" ? "fleteMxn" : "subtotalMxn"] || 0), 0);
      const porKm = g.fs.map(f => (f.calculos || {})[metricaKm === "flete" ? "fletePorKm" : "subtotalPorKm"]).filter(x => x != null);
      const rango = porKm.length > 1 && Math.min(...porKm) !== Math.max(...porKm) ? `<br><small>${dinero(Math.min(...porKm))} – ${dinero(Math.max(...porKm))}</small>` : "";
      const conFlete = g.cli !== anterior && gs.some(x => x.cli === g.cli && x.fs.length);
      const encabezado = g.cli !== anterior ? `<tr><td colspan="${columnas.length + 8}" style="background:#f2ede6;font-weight:800;padding-top:10px;"><span style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">${esc(g.cliNombre)}${conFlete ? `<button type="button" class="re-cp" data-cpcli="${esc(g.cli)}" title="Copiar las tarifas de este cliente para WhatsApp o correo">⧉ Copiar</button>` : ""}</span></td></tr>` : "";
      anterior = g.cli;
      const destinosTxt = g.conZona || g.destinos.size > 1 ? `<br><small class="nota">${esc([...g.destinos].join(" · "))}</small>` : "";
      // Recorrido: paradas → destino final; cobro por reparto y "sin cobro".
      const repFact = g.reps.filter(r => r.f && r.numero > 0);
      const sinCobro = repFact.filter(r => r.sinCobro).length;
      const cobrados = repFact.filter(r => r.rf.cobro);
      const porRep = cobrados.length ? cobrados.reduce((s, r) => s + r.cobroMxn, 0) / cobrados.reduce((s, r) => s + r.numero, 0) : null;
      const fin = [...g.finales][0] || g.zona;
      const celdaRec = g.rec
        ? `${g.intermedias.map(p => `<span class="re-parada">${esc(p)}</span>`).join(`<span class="nota"> → </span>`)}<span class="nota"> → </span><span class="re-parada"><b>${esc(fin)}</b></span>
          <br><small>${g.intermedias.length} reparto${g.intermedias.length === 1 ? "" : "s"}${porRep != null ? ` · ${dinero(porRep)} c/u` : ""}</small>${sinCobro ? ` <span class="re-chip re-rojo">${sinCobro} sin cobro</span>` : ""}`
        : `<span class="re-chip re-gris">DIRECTO</span>`;
      return encabezado + `<tr>
        <td>${esc(g.zona)}${g.conZona ? "" : ` <small class="nota">(sin zona)</small>`}${destinosTxt}</td>
        <td class="re-col-rec">${celdaRec}</td>
        <td><span class="re-chip ${TIPO[g.carga].clase}">${TIPO[g.carga].txt}</span></td>
        <td><span class="re-chip ${RUTA[g.ruta].clase}">${RUTA[g.ruta].txt}</span></td>
        <td class="n">${g.fs.length ? celdaValor(g.fs.map(f => (f.calculos || {}).km), g.fs.length, (n) => miles(n)) : "—"}</td>
        ${columnas.map(c => `<td class="n${c === "FLETE" ? " re-col-flete" : ""}">${g.fs.length ? celdaValor(mapas.map(m => m.has(c) ? m.get(c) : null), g.fs.length, fmt) : "—"}</td>`).join("")}
        <td class="n"><b>${km ? dinero(tot / km) : "—"}</b>${rango}</td>
        <td class="n">${g.fs.length ? `<button type="button" class="re-link" data-ver="f" data-k="${esc(g.k)}">${g.fs.length}</button>` : "0"}</td>
        <td class="n">${g.pendientes.length ? `<button type="button" class="re-link re-falta" data-ver="s" data-k="${esc(g.k)}">${g.pendientes.length}</button>` : "—"}</td></tr>`;
    }).join("");

    const seg = (clave, opciones) => `<span class="re-seg">${opciones.map(([v, t]) => `<button type="button" class="${ft[clave] === v ? "activo" : ""}" data-ft="${clave}" data-v="${v}">${t}</button>`).join("")}</span>`;
    $("#re-cuerpo").innerHTML = `
      <div class="re-filtros">
        <input type="text" id="re-t-q" placeholder="Buscar cliente o zona" value="${esc(ft.q)}" style="width:auto;min-width:180px;">
        <select id="re-t-cli"><option value="">Todos los clientes</option>${[...clientesOpc.entries()].sort((a, b) => a[1].localeCompare(b[1], "es")).map(([k, n]) => `<option value="${esc(k)}"${ft.cliente === k ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>
        <select id="re-t-zona"><option value="">Todas las zonas</option>${zonasOpc.map(z => `<option value="${esc(z)}"${ft.zona === z ? " selected" : ""}>${esc(z)}</option>`).join("")}</select>
      </div>
      <div class="re-filtros">
        ${seg("carga", [["", "Seca y refri"], ["seca", "Seca"], ["refrigerada", "Refrigerada"], ["sin", "Sin dato"]])}
        ${seg("ruta", [["", "Corta y larga"], ["corta", "Corta"], ["larga", "Larga"]])}
        ${seg("viajes", [["", "Todos los viajes"], ["directo", "Directos"], ["reparto", "Con reparto"]])}
        <span class="re-seg" style="margin-left:auto;">${[["flete", "Ing./km FLETE"], ["subtotal", "Ing./km SUBTOTAL"]].map(([v, t]) => `<button type="button" class="${metricaKm === v ? "activo" : ""}" data-m="${v}">${t}</button>`).join("")}</span>
      </div>
      ${gs.length ? `<div class="tabla-wrap"><table class="tabla re-tabla">
        <thead><tr><th>Zona destino</th><th class="re-col-rec">Recorrido</th><th>Carga</th><th>Ruta</th><th class="n">Km</th>
          ${columnas.map(c => `<th class="n${c === "FLETE" ? " re-col-flete" : " re-col-con"}">${esc(c)}</th>`).join("")}
          <th class="n">Ing./km ${metricaKm === "flete" ? "flete" : "subtotal"} (MXN)</th><th class="n">Facturas</th><th class="n">Sin factura</th></tr></thead>
        <tbody>${filas}</tbody></table></div>${pg.html}
        <p class="nota">Ruta: CORTA si la factura tiene menos de ${KM_RUTA_LARGA} km; LARGA si tiene ${KM_RUTA_LARGA} o más. Valores como vienen en la factura; si cambian, el más común y en chico "varía". "Sin factura" = salidas del Adrematasa de ese cliente, zona y carga que todavía no tienen PDF cargado (toca el número para ver cuáles). Carga "SIN DATO" = la factura no encontró su salida. Recorrido: sale del destino de la salida del Adrematasa ("MTY-CUL-GDL-CUNDUACAN"); la última parada es el destino final y decide la zona. Cada recorrido distinto es su propio renglón (los nombres de parada se igualan en Zonas y equivalencias). Una factura sin salida ligada cuenta como directo. "Sin cobro" = hubo reparto y la factura no trae concepto de reparto.${hayOtros ? ` "OTROS" junta ${otrosNombres.length - visibles.length} concepto(s) poco frecuentes.` : ""}</p>`
        : `<p class="nota" style="text-align:center;padding:16px;">${todos.length ? "No hay renglones con estos filtros." : "Todavía no hay facturas ni salidas en el periodo."}</p>`}`;
    const qi = $("#re-t-q");
    qi.addEventListener("input", () => { ft.q = qi.value; const pos = qi.selectionStart; renderTarifas(); const n = $("#re-t-q"); n.focus(); n.setSelectionRange(pos, pos); });
    $("#re-t-cli").addEventListener("change", (e) => { ft.cliente = e.target.value; renderTarifas(); });
    $("#re-t-zona").addEventListener("change", (e) => { ft.zona = e.target.value; renderTarifas(); });
    $("#re-cuerpo").querySelectorAll("[data-ft]").forEach(b => b.addEventListener("click", () => { ft[b.dataset.ft] = b.dataset.v; renderTarifas(); }));
    $("#re-cuerpo").querySelectorAll("[data-m]").forEach(b => b.addEventListener("click", () => { metricaKm = b.dataset.m; renderTarifas(); }));
    $("#re-cuerpo").querySelectorAll("[data-cpcli]").forEach(b => b.addEventListener("click", async () => {
      const c = copiaCliente(b.dataset.cpcli, gs.filter(x => x.cli === b.dataset.cpcli));
      marcarCopiado(b, await copiarAlPortapapeles(c.texto, c.html));
    }));
    $("#re-cuerpo").querySelectorAll("[data-ver]").forEach(b => b.addEventListener("click", () => {
      const g = grupos.get(b.dataset.k);
      if (!g) return;
      const txt = `${g.cliNombre} · ${g.zona} · ${g.rec ? "vía " + g.rec : "directo"} · ${TIPO[g.carga].txt} · ${RUTA[g.ruta].txt}`;
      if (b.dataset.ver === "s") {
        grupoSalidas = { taims: new Set(g.pendientes.map(x => x.factura)), txt };
        filtroSalidas = "sinfactura"; tab = "salidas";
      } else {
        grupoFacturas = { uuids: new Set(g.fs.map(f => f.uuid)), txt };
        tab = "facturas";
      }
      render();
    }));
    enlazarPaginas(renderTarifas);
  }

  // ============================================================================
  // Reporte de tarifas por cliente (2026-11-07, lo pidió el jefe de Ivan).
  // Todos los clientes que ya tienen factura con FLETE en el periodo elegido
  // arriba (los renglones "sin factura" no entran). Resumen de una línea por
  // cliente + tarifario (zona, recorrido, carga, ruta, km, flete, ing./km,
  // otros cargos). Sale en PDF (vista de impresión, carta horizontal), Excel
  // (dos hojas, valores como números) o copiado (WhatsApp con *negritas* y
  // tablas para correo). No lee nada de Firestore: usa lo que ya está cargado.
  // Además, cada cliente en Tarifas por cliente tiene su "⧉ Copiar".
  // Valores como en Tarifas: el más común de las facturas y su rango si varía.
  // ============================================================================
  function comun(valores) {
    const v = valores.filter(x => x != null && isFinite(x));
    if (!v.length) return null;
    const cuenta = new Map();
    v.forEach(x => { const r = Math.round(x * 100) / 100; cuenta.set(r, (cuenta.get(r) || 0) + 1); });
    const c = [...cuenta.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
    return { c, min: Math.min(...v), max: Math.max(...v), n: v.length };
  }
  // Valores de un renglón con facturas (mismas cuentas que la tabla de Tarifas).
  function valoresRenglon(g, metrica) {
    const monedas = new Set(g.fs.map(f => f.moneda || "MXN"));
    const enOriginal = monedas.size <= 1;
    const mon = enOriginal ? ([...monedas][0] || "MXN") : "MXN";
    const porConcepto = new Map();
    g.fs.forEach((f, i) => {
      const tc = enOriginal ? 1 : ((f.moneda || "MXN") === "MXN" ? 1 : (f.tipoCambio || 1));
      const m = new Map();
      (f.conceptos || []).forEach(k => { const n = nombreConcepto(k.servicio); m.set(n, (m.get(n) || 0) + (k.importe || 0) * tc); });
      m.forEach((v, n) => { if (!porConcepto.has(n)) porConcepto.set(n, new Array(g.fs.length).fill(null)); porConcepto.get(n)[i] = v; });
    });
    const valores = new Map(); porConcepto.forEach((arr, n) => valores.set(n, comun(arr)));
    const campo = metrica === "flete" ? "fleteMxn" : "subtotalMxn", campoKm = metrica === "flete" ? "fletePorKm" : "subtotalPorKm";
    const kmTot = g.fs.reduce((s, f) => s + ((f.calculos || {}).km || 0), 0);
    const tot = g.fs.reduce((s, f) => s + ((f.calculos || {})[campo] || 0), 0);
    const porKm = g.fs.map(f => (f.calculos || {})[campoKm]).filter(x => x != null);
    const repFact = g.reps.filter(r => r.f && r.numero > 0);
    const cobrados = repFact.filter(r => r.rf.cobro);
    const porRep = cobrados.length ? cobrados.reduce((s, r) => s + r.cobroMxn, 0) / cobrados.reduce((s, r) => s + r.numero, 0) : null;
    const fin = [...g.finales][0] || g.zona;
    return {
      mon, flete: valores.get("FLETE") || null, km: comun(g.fs.map(f => (f.calculos || {}).km)),
      otros: [...valores.entries()].filter(([n, v]) => n !== "FLETE" && v).sort((a, b) => a[0].localeCompare(b[0], "es")),
      ingKm: kmTot ? tot / kmTot : null, minKm: porKm.length ? Math.min(...porKm) : null, maxKm: porKm.length ? Math.max(...porKm) : null,
      recorrido: g.rec ? `${g.intermedias.join(" → ")} → ${fin}` : "Directo", repartos: g.rec ? g.intermedias.length : 0, porRep,
      sinCobro: repFact.filter(r => r.sinCobro).length,
    };
  }
  const nombreCorto = (n) => n.replace(/\.$/, "").toLowerCase().replace(/^./, c => c.toUpperCase());
  const textoCarga = (c) => c === "refrigerada" ? "refri" : c === "seca" ? "seca" : "carga sin dato";
  function periodoTexto() {
    const sel = $("#re-periodo"); const nombre = sel && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent.replace(/\s*\(.*\)$/, "") : "";
    const ini = inicioPeriodo();
    if (!ini) return "Todas las facturas cargadas";
    const MC = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"], h = new Date();
    return `${nombre} (1 ${MC[ini.getMonth()]} ${ini.getFullYear()} – ${h.getDate()} ${MC[h.getMonth()]} ${h.getFullYear()})`;
  }

  // Junta los renglones del reporte y el resumen por cliente.
  function datosReporte(opc) {
    const { todos } = agrupar();
    const base = todos.filter(g => g.fs.length && (!opc.soloFiltrado || pasaFiltroTarifas(g))).sort(ordenTarifas);
    const filas = base.map(g => ({ g, v: valoresRenglon(g, opc.metrica) })).filter(x => x.v.flete);
    const campo = opc.metrica === "flete" ? "fleteMxn" : "subtotalMxn", campoKm = opc.metrica === "flete" ? "fletePorKm" : "subtotalPorKm";
    const resumen = (fs) => {
      const conKm = fs.filter(f => (f.calculos || {}).km), conFlete = fs.filter(f => (f.calculos || {}).fleteMxn != null);
      const kmTot = fs.reduce((s, f) => s + ((f.calculos || {}).km || 0), 0), tot = fs.reduce((s, f) => s + ((f.calculos || {})[campo] || 0), 0);
      const porKm = fs.map(f => (f.calculos || {})[campoKm]).filter(x => x != null);
      return { facturas: fs.length, kmProm: conKm.length ? conKm.reduce((s, f) => s + f.calculos.km, 0) / conKm.length : null,
        fleteProm: conFlete.length ? conFlete.reduce((s, f) => s + f.calculos.fleteMxn, 0) / conFlete.length : null,
        ingKm: kmTot ? tot / kmTot : null, minKm: porKm.length ? Math.min(...porKm) : null, maxKm: porKm.length ? Math.max(...porKm) : null };
    };
    const clientes = [];
    filas.forEach(x => {
      let c = clientes[clientes.length - 1];
      if (!c || c.cli !== x.g.cli) { c = { cli: x.g.cli, nombre: x.g.cliNombre, filas: [] }; clientes.push(c); }
      c.filas.push(x);
    });
    clientes.forEach(c => Object.assign(c, resumen(c.filas.flatMap(x => x.g.fs)), { rutas: c.filas.length }));
    const conceptos = new Map();
    filas.forEach(x => x.v.otros.forEach(([n]) => conceptos.set(n, (conceptos.get(n) || 0) + 1)));
    return { filas, clientes, total: resumen(filas.flatMap(x => x.g.fs)), otrosNombres: [...conceptos.keys()].sort((a, b) => conceptos.get(b) - conceptos.get(a) || a.localeCompare(b, "es")) };
  }

  // ---- Copiar: un cliente (Tarifas) ----
  function copiaCliente(cli, gs) {
    const filas = gs.filter(g => g.fs.length).map(g => ({ g, v: valoresRenglon(g, metricaKm) })).filter(x => x.v.flete);
    const nombre = filas.length ? filas[0].g.cliNombre : cli;
    const sufijo = metricaKm === "flete" ? "/km" : "/km (subtotal)";
    const l = [`*Tarifas · ${nombre}*`, periodoTexto()];
    filas.forEach(({ g, v }) => {
      l.push("", `${g.zona}${g.rec ? ` · vía ${g.intermedias.join(" → ")}` : ""} · ${textoCarga(g.carga)}${v.km ? ` · ${miles(v.km.c)} km` : ""}`);
      l.push(`Flete *${dinero(v.flete.c, v.mon)}*${v.ingKm != null ? ` · *${dinero(v.ingKm)}${sufijo}*` : ""}${v.flete.min !== v.flete.max ? ` (varía ${dinero(v.flete.min, v.mon)} – ${dinero(v.flete.max, v.mon)})` : ""}`);
      if (v.otros.length) l.push(v.otros.map(([n, x]) => `${nombreCorto(n)} ${dinero(x.c, v.mon)}`).join(" · "));
    });
    const html = tablaHtml(`Tarifas · ${nombre} · ${periodoTexto()}`, ["Zona destino", "Recorrido", "Carga", "Ruta", "Km", "Flete", `Ing./km ${metricaKm} (MXN)`, "Otros cargos", "Facturas"],
      filas.map(({ g, v }) => [g.zona, v.recorrido, TIPO[g.carga].txt, RUTA[g.ruta].txt, v.km ? miles(v.km.c) : "—", dinero(v.flete.c, v.mon), v.ingKm != null ? dinero(v.ingKm) : "—", v.otros.map(([n, x]) => `${nombreCorto(n)} ${dinero(x.c, v.mon)}`).join(" · ") || "—", g.fs.length]));
    return { texto: l.join("\n"), html };
  }

  // ---- Ventana de opciones ----
  const opcRep = { soloFiltrado: false, metrica: null, resumen: true, tarifario: true, otros: true, separar: false };
  function abrirModalReporte() {
    if (!facturas) { $("#re-error").textContent = "Espera a que terminen de cargar las facturas."; return; }
    if (!opcRep.metrica) opcRep.metrica = metricaKm;
    const viejo = document.getElementById("re-modal-reporte"); if (viejo) viejo.remove();
    const fondo = document.createElement("div");
    fondo.id = "re-modal-reporte"; fondo.className = "re-modal-fondo";
    document.body.appendChild(fondo);
    const pintar = () => {
      const d = datosReporte(opcRep);
      const seg = (clave, ops) => `<span class="re-seg">${ops.map(([v, t]) => `<button type="button" class="${opcRep[clave] === v ? "activo" : ""}" data-o="${clave}" data-v="${v}">${t}</button>`).join("")}</span>`;
      const chk = (clave, t) => `<label><input type="checkbox" data-c="${clave}"${opcRep[clave] ? " checked" : ""}> ${t}</label>`;
      const ninguno = !opcRep.resumen && !opcRep.tarifario;
      fondo.innerHTML = `<div class="re-modal" role="dialog" aria-label="Reporte de tarifas por cliente">
        <h3>Reporte de tarifas por cliente</h3>
        <p class="nota" style="margin:0 0 6px;">Periodo: <b>${esc(periodoTexto())}</b> (el que tienes elegido arriba) · ${d.clientes.length} cliente${d.clientes.length === 1 ? "" : "s"} con flete · ${d.filas.length} ruta${d.filas.length === 1 ? "" : "s"} · ${d.total.facturas} factura${d.total.facturas === 1 ? "" : "s"}</p>
        <div class="re-mfila"><b>Clientes</b>${seg("soloFiltrado", [[false, "Todos con flete"], [true, "Solo el filtrado"]])}</div>
        <div class="re-mfila"><b>Ingreso por km</b>${seg("metrica", [["flete", "Flete"], ["subtotal", "Subtotal"]])}</div>
        <div class="re-mfila"><b>Incluir</b>${chk("resumen", "Resumen por cliente")}${chk("tarifario", "Tarifario detallado")}${chk("otros", "Otros cargos (cruce, FSC…)")}</div>
        <div class="re-mfila"><b>Separar</b>${chk("separar", "Directos y con reparto en bloques distintos")}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:16px;">
          <button type="button" data-a="pdf"${ninguno || !d.filas.length ? " disabled" : ""}>⤓ PDF</button>
          <button type="button" data-a="excel"${ninguno || !d.filas.length ? " disabled" : ""}>⤓ Excel</button>
          <button type="button" class="secundario" data-a="copiar"${ninguno || !d.filas.length ? " disabled" : ""}>⧉ Copiar todo</button>
          <button type="button" class="secundario" data-a="cerrar" style="margin-left:auto;">Cerrar</button></div>
        <p class="nota" style="margin:10px 0 0;">${d.filas.length ? `"Solo el filtrado" respeta lo que tengas en Tarifas por cliente (cliente, zona, carga, ruta, directos o con reparto). "Copiar todo" pega en WhatsApp el resumen por cliente y en un correo las tablas.` : "No hay facturas con flete en este periodo o con estos filtros."}</p>
        <p class="error" id="re-m-error" style="margin:6px 0 0;"></p></div>`;
      fondo.querySelectorAll("[data-o]").forEach(b => b.addEventListener("click", () => { const v = b.dataset.v; opcRep[b.dataset.o] = v === "true" ? true : v === "false" ? false : v; pintar(); }));
      fondo.querySelectorAll("[data-c]").forEach(c => c.addEventListener("change", () => { opcRep[c.dataset.c] = c.checked; pintar(); }));
      fondo.querySelector('[data-a="cerrar"]').addEventListener("click", () => fondo.remove());
      fondo.querySelector('[data-a="pdf"]').addEventListener("click", () => { fondo.remove(); abrirPdfReporte(datosReporte(opcRep), { ...opcRep }); });
      fondo.querySelector('[data-a="excel"]').addEventListener("click", async () => {
        try { await excelReporte(datosReporte(opcRep), { ...opcRep }); } catch (e) { fondo.querySelector("#re-m-error").textContent = "No se pudo generar el Excel: " + e.message; }
      });
      fondo.querySelector('[data-a="copiar"]').addEventListener("click", async (e) => {
        const b = e.currentTarget, c = copiaReporte(datosReporte(opcRep), opcRep);
        marcarCopiado(b, await copiarAlPortapapeles(c.texto, c.html));
      });
    };
    fondo.addEventListener("click", (e) => { if (e.target === fondo) fondo.remove(); });
    pintar();
  }

  // ---- Copiar todo ----
  function copiaReporte(d, opc) {
    const sufijo = opc.metrica === "flete" ? "/km" : "/km (subtotal)";
    const l = ["*Tarifas por cliente*", periodoTexto(),
      `*${d.clientes.length}* clientes · *${d.filas.length}* rutas · *${d.total.facturas}* facturas${d.total.ingKm != null ? ` · ingreso *${dinero(d.total.ingKm)}${sufijo}*` : ""}`, ""];
    d.clientes.forEach((c, i) => l.push(`${i + 1}. ${c.nombre} · ${c.rutas} ruta${c.rutas === 1 ? "" : "s"}${c.ingKm != null ? ` · *${dinero(c.ingKm)}${sufijo}*` : ""}`));
    let html = "";
    if (opc.resumen) html += tablaHtml(`Tarifas por cliente · ${periodoTexto()}`, ["Cliente", "Rutas", "Facturas", "Km prom.", "Flete prom. (MXN)", `Ing./km ${opc.metrica} (MXN)`, "Rango ing./km"],
      d.clientes.map(c => [c.nombre, c.rutas, c.facturas, c.kmProm != null ? miles(Math.round(c.kmProm)) : "—", dinero(c.fleteProm), c.ingKm != null ? dinero(c.ingKm) : "—", c.minKm != null ? `${dinero(c.minKm)} – ${dinero(c.maxKm)}` : "—"]));
    if (opc.tarifario) html += "<br>" + tablaHtml("Tarifario detallado", ["Cliente", "Zona destino", "Recorrido", "Carga", "Ruta", "Km", "Flete", `Ing./km ${opc.metrica} (MXN)`, ...(opc.otros ? ["Otros cargos"] : []), "Facturas"],
      d.filas.map(({ g, v }) => [g.cliNombre, g.zona, v.recorrido, TIPO[g.carga].txt, RUTA[g.ruta].txt, v.km ? miles(v.km.c) : "—", dinero(v.flete.c, v.mon), v.ingKm != null ? dinero(v.ingKm) : "—",
        ...(opc.otros ? [v.otros.map(([n, x]) => `${nombreCorto(n)} ${dinero(x.c, v.mon)}`).join(" · ") || "—"] : []), g.fs.length]));
    return { texto: l.join("\n"), html };
  }

  // ---- Excel: Resumen por cliente + Tarifario ----
  async function excelReporte(d, opc) {
    const XLSX = await cargarScript(URL_SHEETJS, "XLSX");
    const r2 = (n) => n == null ? null : Math.round(n * 100) / 100;
    const etq = opc.metrica === "flete" ? "flete" : "subtotal";
    const hojaRes = d.clientes.map(c => ({ "Cliente": c.nombre, "Rutas": c.rutas, "Facturas": c.facturas, "Km promedio": c.kmProm != null ? Math.round(c.kmProm) : null,
      "Flete promedio MXN": r2(c.fleteProm), [`Ing./km ${etq} MXN`]: r2(c.ingKm), "Ing./km mínimo": r2(c.minKm), "Ing./km máximo": r2(c.maxKm) }));
    const hojaTar = d.filas.map(({ g, v }) => {
      const o = { "Cliente": g.cliNombre, "Zona destino": g.zona, "Destinos": [...g.destinos].join(" · "), "Recorrido": v.recorrido, "Repartos": v.repartos,
        "Carga": TIPO[g.carga].txt, "Ruta": RUTA[g.ruta].txt, "Km": v.km ? r2(v.km.c) : null, "Moneda": v.mon, "Flete": r2(v.flete.c),
        "Flete mínimo": r2(v.flete.min), "Flete máximo": r2(v.flete.max), [`Ing./km ${etq} MXN`]: r2(v.ingKm), "Ing./km mínimo": r2(v.minKm), "Ing./km máximo": r2(v.maxKm) };
      if (opc.otros) d.otrosNombres.forEach(n => { const x = v.otros.find(([m]) => m === n); o[nombreCorto(n)] = x ? r2(x[1].c) : null; });
      o["Facturas"] = g.fs.length;
      return o;
    });
    const libro = XLSX.utils.book_new();
    const anchos = (filas) => { const ks = filas.length ? Object.keys(filas[0]) : []; return ks.map(k => ({ wch: Math.min(48, Math.max(k.length, ...filas.map(f => String(f[k] == null ? "" : f[k]).length)) + 2) })); };
    if (opc.resumen) { const h = XLSX.utils.json_to_sheet(hojaRes); h["!cols"] = anchos(hojaRes); XLSX.utils.book_append_sheet(libro, h, "Resumen por cliente"); }
    if (opc.tarifario) { const h = XLSX.utils.json_to_sheet(hojaTar); h["!cols"] = anchos(hojaTar); XLSX.utils.book_append_sheet(libro, h, "Tarifario"); }
    const hoy = new Date();
    XLSX.writeFile(libro, `Tarifas_por_cliente_${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}.xlsx`);
  }

  // ---- PDF: vista de impresión (carta horizontal) ----
  function htmlReporte(d, opc, conBarra) {
    const MC = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"], h = new Date();
    const etq = opc.metrica === "flete" ? "flete" : "subtotal";
    const chip = (txt, cls) => `<span class="chip ${cls}">${esc(txt)}</span>`;
    const CHIP_C = { refrigerada: "refri", seca: "seca", sin: "gris" }, CHIP_R = { corta: "corta", larga: "larga", sin: "gris" };
    const varia = (x, f) => x && x.min !== x.max ? `<br><span class="varia">varía ${f(x.min)} – ${f(x.max)}</span>` : "";
    const nCol = 8 + (opc.otros ? 1 : 0);
    const fila = ({ g, v }) => `<tr>
      <td>${esc(g.zona)}${g.conZona && g.destinos.size ? `<br><span class="varia">${esc([...g.destinos].join(" · "))}</span>` : ""}</td>
      <td>${g.rec ? `${g.intermedias.map(p => esc(p)).join(" → ")} → <b>${esc([...g.finales][0] || g.zona)}</b><br><span class="varia">${v.repartos} reparto${v.repartos === 1 ? "" : "s"}${v.porRep != null ? ` · ${dinero(v.porRep)} c/u` : ""}${v.sinCobro ? ` · ${v.sinCobro} sin cobro` : ""}</span>` : "Directo"}</td>
      <td>${chip(g.carga === "refrigerada" ? "REFRI" : TIPO[g.carga].txt, CHIP_C[g.carga])}</td><td>${chip(RUTA[g.ruta].txt, CHIP_R[g.ruta])}</td>
      <td class="n">${v.km ? miles(v.km.c) : "—"}</td>
      <td class="n fl">${dinero(v.flete.c, v.mon)}${varia(v.flete, (n) => dinero(n, v.mon))}</td>
      <td class="n"><b>${v.ingKm != null ? dinero(v.ingKm) : "—"}</b>${v.minKm != null && v.minKm !== v.maxKm ? `<br><span class="varia">${dinero(v.minKm)} – ${dinero(v.maxKm)}</span>` : ""}</td>
      ${opc.otros ? `<td>${v.otros.map(([n, x]) => `${esc(nombreCorto(n))} ${dinero(x.c, v.mon)}`).join("<br>") || "—"}</td>` : ""}
      <td class="n">${g.fs.length}</td></tr>`;
    const bloque = (c) => {
      const cab = `<tr class="cli"><td colspan="${nCol}">${esc(c.nombre)}</td></tr>`;
      if (!opc.separar) return cab + c.filas.map(fila).join("");
      const dir = c.filas.filter(x => !x.g.rec), rep = c.filas.filter(x => x.g.rec);
      if (!dir.length || !rep.length) return cab + c.filas.map(fila).join(""); // solo un tipo: sin subtítulos
      const sub = (t) => `<tr class="sub"><td colspan="${nCol}">${t}</td></tr>`;
      return cab + (dir.length ? sub("Directos") + dir.map(fila).join("") : "") + (rep.length ? sub("Con reparto") + rep.map(fila).join("") : "");
    };
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tarifas por cliente</title><style>
  @page { size: letter landscape; margin: 10mm; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:Arial, Helvetica, sans-serif; color:#1F1A14; font-size:10.5px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .hoja { padding:18px 22px; }
  .barra { position:sticky; top:0; background:#2c1e0f; color:#fff; padding:10px 16px; display:flex; justify-content:space-between; align-items:center; font-family:-apple-system,'Segoe UI',Roboto,sans-serif; z-index:2; }
  .barra button { background:#fff; color:#2c1e0f; border:0; border-radius:8px; padding:8px 14px; font-weight:700; font-size:13px; cursor:pointer; }
  .enc { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid #2C1E0F; padding-bottom:8px; margin-bottom:12px; gap:12px; }
  .enc h1 { margin:0; font-size:18px; } .enc .sub { color:#6b5f52; font-size:10.5px; margin-top:3px; } .enc img { height:38px; }
  .kp { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:12px; } .kp div { border:1px solid #E2DDD5; border-radius:7px; padding:7px 10px; } .kp b { font-size:15px; display:block; } .kp small { color:#6b5f52; font-size:9.5px; }
  .tit { font-weight:700; font-size:10px; color:#6b5f52; text-transform:uppercase; letter-spacing:.4px; margin:14px 0 5px; }
  table { width:100%; border-collapse:collapse; } thead { display:table-header-group; } tr { page-break-inside:avoid; break-inside:avoid; }
  th { text-align:left; font-size:8.5px; color:#6b5f52; text-transform:uppercase; padding:4px 5px; border-bottom:1px solid #cfc7bb; white-space:nowrap; }
  td { padding:4px 5px; border-bottom:1px solid #EEE9E2; vertical-align:top; } td.n, th.n { text-align:right; white-space:nowrap; }
  tr.cli td { background:#F2EDE6; font-weight:700; font-size:11px; padding-top:6px; } tr.sub td { font-size:9px; font-weight:700; color:#6b5f52; text-transform:uppercase; letter-spacing:.3px; background:#FBFAF8; }
  td.fl { background:#EFEAE2; font-weight:700; } .varia { color:#8a7f73; font-size:8.5px; font-weight:400; }
  .chip { display:inline-block; font-size:8.5px; font-weight:700; padding:1px 6px; border-radius:7px; white-space:nowrap; }
  .refri, .larga { background:#DDEEFB; color:#185FA5; } .seca { background:#F3E9D7; color:#7a4a12; } .corta { background:#EAF3DE; color:#3B7A1E; } .gris { background:#ECE9E4; color:#5c5045; }
  .nota { margin-top:10px; font-size:8.5px; color:#6b5f52; line-height:1.45; }
  @media screen { .tabla-caja { overflow-x:auto; } .tabla-caja table { min-width:720px; } }
  @media print { .barra { display:none; } .hoja { padding:0; } .tabla-caja { overflow:visible; } }
</style></head><body>
${conBarra ? `<div class="barra"><b>Tarifas por cliente</b><button type="button" onclick="window.print()">Imprimir / Guardar PDF</button></div>` : ""}
<div class="hoja">
  <div class="enc"><div><h1>Tarifas por cliente</h1><div class="sub">${esc(periodoTexto())} · ingreso por km sobre ${etq.toUpperCase()}, en MXN · generado ${h.getDate()} de ${MC[h.getMonth()]} de ${h.getFullYear()}</div></div>
    <img src="${window.location.origin}/img/logo-alanis.png" alt="Autotransportes Alanis" onerror="this.outerHTML='<b style=&quot;font-size:14px;letter-spacing:.5px;&quot;>AUTOTRANSPORTES ALANIS</b>'"></div>
  <div class="kp"><div><b>${d.clientes.length}</b><small>Clientes con flete</small></div><div><b>${d.filas.length}</b><small>Rutas (zona · recorrido · carga · ruta)</small></div>
    <div><b>${d.total.facturas}</b><small>Facturas</small></div><div><b>${d.total.ingKm != null ? dinero(d.total.ingKm) : "—"}</b><small>Ingreso por km ponderado (todas)</small></div></div>
  ${opc.resumen ? `<div class="tit">Resumen por cliente</div><div class="tabla-caja"><table><thead><tr><th>Cliente</th><th class="n">Rutas</th><th class="n">Facturas</th><th class="n">Km prom.</th><th class="n">Flete prom.</th><th class="n">Ing./km</th><th class="n">Rango ing./km</th></tr></thead><tbody>
    ${d.clientes.map(c => `<tr><td>${esc(c.nombre)}</td><td class="n">${c.rutas}</td><td class="n">${c.facturas}</td><td class="n">${c.kmProm != null ? miles(Math.round(c.kmProm)) : "—"}</td><td class="n">${dinero(c.fleteProm)}</td><td class="n"><b>${c.ingKm != null ? dinero(c.ingKm) : "—"}</b></td><td class="n">${c.minKm != null ? (c.minKm === c.maxKm ? dinero(c.minKm) : `${dinero(c.minKm)} – ${dinero(c.maxKm)}`) : "—"}</td></tr>`).join("")}
  </tbody></table></div>` : ""}
  ${opc.tarifario ? `<div class="tit"${opc.resumen ? ` style="page-break-before:always;break-before:page;"` : ""}>Tarifario detallado</div><div class="tabla-caja"><table><thead><tr><th>Zona destino</th><th>Recorrido</th><th>Carga</th><th>Ruta</th><th class="n">Km</th><th class="n">Flete</th><th class="n">Ing./km</th>${opc.otros ? "<th>Otros cargos</th>" : ""}<th class="n">Facturas</th></tr></thead><tbody>
    ${d.clientes.map(bloque).join("")}
  </tbody></table></div>` : ""}
  <div class="nota">Valores como vienen en la factura; si cambian entre facturas, el más común y en chico el rango. Ruta CORTA: menos de ${KM_RUTA_LARGA} km; LARGA: ${KM_RUTA_LARGA} km o más. Ingreso por km = ${etq} ÷ km de la factura, en MXN (las facturas en USD al tipo de cambio de la misma factura). Flete en la moneda de la factura. Solo clientes con factura y flete en el periodo.</div>
</div></body></html>`;
  }
  function esVistaMovil() {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true ||
      /iphone|ipad|ipod|android|mobi/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }
  function abrirPdfReporte(d, opc) {
    if (!esVistaMovil()) {
      const v = window.open("", "_blank");
      if (!v) { $("#re-error").textContent = "El navegador bloqueó la ventana emergente. Habilita ventanas emergentes para este sitio e intenta de nuevo."; return; }
      v.document.write(htmlReporte(d, opc, true)); v.document.close();
      return;
    }
    // En celular / app instalada: dentro de la app, con ‹ Regresar e Imprimir / PDF (como el reporte de RH).
    const capa = document.createElement("div");
    capa.style.cssText = "position:fixed;inset:0;z-index:10000;background:#d9d4cc;display:flex;flex-direction:column;";
    capa.innerHTML = `<div style="flex:none;background:#2c1e0f;color:#fff;padding:calc(env(safe-area-inset-top, 0px) + 10px) 12px 10px;display:flex;align-items:center;justify-content:space-between;gap:8px;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;">
        <button type="button" data-r="regresar" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,.55);border-radius:9px;padding:8px 12px;font-size:14px;font-weight:700;cursor:pointer;">‹ Regresar</button>
        <b style="font-size:14px;">Tarifas</b>
        <button type="button" data-r="imprimir" style="background:#fff;color:#2c1e0f;border:0;border-radius:9px;padding:8px 12px;font-size:14px;font-weight:700;cursor:pointer;">Imprimir / PDF</button></div>
      <iframe title="Tarifas por cliente" style="flex:1;width:1px;min-width:100%;border:0;background:#fff;"></iframe>`;
    const scrollPrevio = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.appendChild(capa);
    const iframe = capa.querySelector("iframe");
    iframe.srcdoc = htmlReporte(d, opc, false);
    capa.querySelector('[data-r="regresar"]').addEventListener("click", () => { capa.remove(); document.body.style.overflow = scrollPrevio; });
    capa.querySelector('[data-r="imprimir"]').addEventListener("click", () => { try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch (e) { /* nada */ } });
  }

  // ============================================================================
  // Volumen por cliente (2026-11-02, pedido de Ivan). Ranking de clientes (nombre
  // del Adrematasa, como viene en Salidas) por número de salidas del periodo, con
  // un desglose de 2 partes a elegir: Seca/Refrigerada, Directo/Con reparto o
  // Con factura/Sin factura. Mayor a menor por omisión, con botón para invertir.
  // Tocar un cliente abre Salidas filtrada a ese cliente.
  // ============================================================================
  const fv = { desglose: "carga", orden: "desc", mes: "" };
  const DESGLOSES = {
    carga: { txt: "Seca / Refrigerada", a: "Seca", b: "Refrigerada", c: "Sin dato",
      de: (x) => x.tipo === "seca" ? "a" : x.tipo === "refrigerada" ? "b" : "c" },
    reparto: { txt: "Directo / Con reparto", a: "Directo", b: "Con reparto", c: null,
      de: (x) => paradasSalida(x).length > 1 ? "b" : "a" },
    factura: { txt: "Con factura / Sin factura", a: "Con factura", b: "Sin factura", c: null,
      de: (x) => ligas().facturaDeTaim.has(x.factura) ? "a" : "b" },
  };
  const mesDeMs = (ms) => { if (!ms) return ""; const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
  const NOMBRE_MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const textoMes = (m) => { const [a, n] = m.split("-"); return `${NOMBRE_MES[Number(n) - 1]} ${a}`.replace(/^./, c => c.toUpperCase()); };
  function datosVolumen() {
    const todas = [...(salidas || new Map()).values()];
    const meses = [...new Set(todas.map(x => mesDeMs(x.fechaMs)).filter(Boolean))].sort().reverse();
    if (fv.mes && !meses.includes(fv.mes)) fv.mes = "";
    const lista = fv.mes ? todas.filter(x => mesDeMs(x.fechaMs) === fv.mes) : todas;
    const D = DESGLOSES[fv.desglose];
    const porCli = new Map();
    lista.forEach(x => {
      const k = normTxt(x.cliente) || "SIN CLIENTE";
      const g = porCli.get(k) || { cliente: k, total: 0, a: 0, b: 0, c: 0, taims: [] };
      g.total++; g[D.de(x)]++; g.taims.push(x.factura);
      porCli.set(k, g);
    });
    const filas = [...porCli.values()].sort((x, y) => (fv.orden === "desc" ? y.total - x.total : x.total - y.total) || x.cliente.localeCompare(y.cliente, "es"));
    const ranking = [...porCli.values()].sort((x, y) => y.total - x.total);
    return { meses, lista, filas, ranking, D };
  }
  function renderVolumen() {
    const { meses, lista, filas, ranking, D } = datosVolumen();
    const total = lista.length;
    const top5 = ranking.slice(0, 5).reduce((t, g) => t + g.total, 0);
    const pct = (n, de) => de ? (100 * n / de).toLocaleString("es-MX", { maximumFractionDigits: 1 }) + " %" : "—";
    const posicion = new Map(ranking.map((g, i) => [g.cliente, i + 1]));
    const pg = paginar("volumen", filas, `${fv.desglose}|${fv.orden}|${fv.mes}|${filas.length}`);
    const ancho = (n, g) => g.total ? (100 * n / g.total) : 0;
    $("#re-cuerpo").innerHTML = `
      <div class="re-filtros">
        <select id="re-v-mes" style="width:auto;"><option value="">Todo el periodo</option>${meses.map(m => `<option value="${m}"${fv.mes === m ? " selected" : ""}>${textoMes(m)}</option>`).join("")}</select>
        <span class="nota" style="margin:0;">Desglose:</span>
        <span class="re-seg">${Object.entries(DESGLOSES).map(([k, d]) => `<button type="button" class="${fv.desglose === k ? "activo" : ""}" data-vd="${k}">${d.txt}</button>`).join("")}</span>
        <span class="re-seg" style="margin-left:auto;"><button type="button" class="${fv.orden === "desc" ? "activo" : ""}" data-vo="desc">Mayor a menor</button><button type="button" class="${fv.orden === "asc" ? "activo" : ""}" data-vo="asc">Menor a mayor</button></span>
        <button type="button" class="secundario" id="re-v-excel">Descargar Excel</button>
      </div>
      <div class="re-kpis">
        <div class="re-kpi"><b>${total.toLocaleString("es-MX")}</b><small>Salidas${fv.mes ? " en " + textoMes(fv.mes) : " en el periodo"}</small></div>
        <div class="re-kpi"><b>${ranking.length}</b><small>Clientes</small></div>
        <div class="re-kpi"><b>${pct(top5, total)}</b><small>Las salidas de los 5 primeros</small></div>
      </div>
      ${filas.length ? `<div class="tabla-wrap"><table class="tabla re-tabla">
        <thead><tr><th>#</th><th>Cliente (Adrematasa)</th><th class="n">Salidas</th><th class="n">% del total</th><th>${esc(D.txt)}</th><th class="n">${esc(D.a)}</th><th class="n">${esc(D.b)}</th>${D.c ? `<th class="n">${esc(D.c)}</th>` : ""}</tr></thead>
        <tbody>${pg.items.map(g => `<tr class="clic" data-vc="${esc(g.cliente)}">
          <td><span class="re-rank">${posicion.get(g.cliente)}</span></td>
          <td><b>${esc(g.cliente)}</b></td>
          <td class="n"><b>${g.total.toLocaleString("es-MX")}</b></td>
          <td class="n">${pct(g.total, total)}</td>
          <td><div class="re-vbarra"><span class="re-v1" style="width:${ancho(g.a, g)}%"></span><span class="re-v2" style="width:${ancho(g.b, g)}%"></span>${D.c ? `<span class="re-v3" style="width:${ancho(g.c, g)}%"></span>` : ""}</div></td>
          <td class="n">${g.a.toLocaleString("es-MX")} <small class="nota">${pct(g.a, g.total)}</small></td>
          <td class="n">${g.b.toLocaleString("es-MX")} <small class="nota">${pct(g.b, g.total)}</small></td>
          ${D.c ? `<td class="n">${g.c ? g.c.toLocaleString("es-MX") : "—"}</td>` : ""}</tr>`).join("")}</tbody>
      </table></div>${pg.html}
      <p class="nota"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#185FA5;"></span> ${esc(D.a)} · <span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#C68A2E;"></span> ${esc(D.b)}${D.c ? ` · <span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#cfc8bf;"></span> ${esc(D.c)} (Prog que no es OFF ni temperatura)` : ""}. # es la posición por volumen aunque inviertas el orden. Toca un cliente para ver sus salidas.</p>`
        : `<p class="nota" style="text-align:center;padding:16px;">${salidas && salidas.size ? "No hay salidas en ese mes." : "Todavía no hay salidas en el periodo. Cárgalas en Cargar salidas."}</p>`}`;
    $("#re-v-mes").addEventListener("change", (e) => { fv.mes = e.target.value; renderVolumen(); });
    $("#re-cuerpo").querySelectorAll("[data-vd]").forEach(b => b.addEventListener("click", () => { fv.desglose = b.dataset.vd; renderVolumen(); }));
    $("#re-cuerpo").querySelectorAll("[data-vo]").forEach(b => b.addEventListener("click", () => { fv.orden = b.dataset.vo; renderVolumen(); }));
    $("#re-cuerpo").querySelectorAll("tr[data-vc]").forEach(tr => tr.addEventListener("click", () => {
      const g = filas.find(x => x.cliente === tr.dataset.vc);
      if (!g) return;
      grupoSalidas = { taims: new Set(g.taims), txt: `${g.cliente}${fv.mes ? " · " + textoMes(fv.mes) : ""}` };
      filtroSalidas = "todas"; tab = "salidas"; render();
    }));
    $("#re-v-excel").addEventListener("click", async () => {
      try {
        const XLSX = await cargarScript(URL_SHEETJS, "XLSX");
        const hoja = filas.map(g => ({
          "Posición": posicion.get(g.cliente), "Cliente (Adrematasa)": g.cliente, "Salidas": g.total,
          "% del total": total ? Math.round(1000 * g.total / total) / 10 : 0,
          ...Object.fromEntries(Object.values(DESGLOSES).flatMap(d => {
            const cuenta = { a: 0, b: 0, c: 0 };
            lista.filter(x => (normTxt(x.cliente) || "SIN CLIENTE") === g.cliente).forEach(x => { cuenta[d.de(x)]++; });
            return [[d.a, cuenta.a], [d.b, cuenta.b], ...(d.c ? [[d.c, cuenta.c]] : [])];
          })),
        }));
        const libro = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(hoja), "Volumen por cliente");
        XLSX.writeFile(libro, `Volumen_clientes_${fv.mes || "periodo"}.xlsx`);
      } catch (e) { $("#re-error").textContent = "No se pudo generar el Excel: " + e.message; }
    });
    enlazarPaginas(renderVolumen);
  }

  // ---- Zonas y equivalencias ----
  const selZonas = new Set();
  const fz = { q: "", soloSinZona: true };
  async function guardarZonas(lista2) {
    try { await setDoc(doc(db, COL_CONFIG, "zonas"), { lista: lista2, actualizadoEn: new Date().toISOString() }); }
    catch (e) { $("#re-error").textContent = "No se pudieron guardar las zonas: " + e.message; }
  }
  async function guardarCliente(adr, valor) {
    const clientes = { ...config.clientes };
    if (valor) clientes[adr] = valor; else delete clientes[adr];
    try { await setDoc(doc(db, COL_CONFIG, "equivalencias"), { clientes, actualizadoEn: new Date().toISOString() }); }
    catch (e) { $("#re-error").textContent = "No se pudo guardar la equivalencia: " + e.message; }
  }
  function renderZonas() {
    const ap = aprender();
    // Destinos: los de las facturas (con sus nombres del Adrematasa) + los del Adrematasa que no se ligan a ninguno.
    const destinos = new Map(); // clave -> { clave, viajes, alias:Set, soloAdr }
    lista().forEach(f => {
      const k = f.destino || "Sin destino";
      const d = destinos.get(k) || { clave: k, viajes: 0, alias: new Set(), soloAdr: false, reparto: 0 };
      d.viajes++; if (recorridoDe(f, salidaDe(f)).numero > 0) d.reparto = (d.reparto || 0) + 1; destinos.set(k, d);
    });
    ap.des.forEach((m, adr) => { const k = moda(m); const d = destinos.get(k); if (d) d.alias.add(adr); });
    (salidas ? [...salidas.values()] : []).forEach(x => {
      if (ap.porTaim.has(x.factura) || ap.destinoDe(destAdr(x))) return;
      const k = adrDestino(x);
      const d = destinos.get(k) || { clave: k, viajes: 0, alias: new Set(), soloAdr: true, reparto: 0 };
      d.viajes++; if (paradasSalida(x).length > 1) d.reparto = (d.reparto || 0) + 1; destinos.set(k, d);
    });
    config.zonas.forEach(z => (z.destinos || []).forEach(k => { if (!destinos.has(k)) destinos.set(k, { clave: k, viajes: 0, alias: new Set(), soloAdr: k.startsWith("ADR:") }); }));
    const q = normTxt(fz.q);
    const listaD = [...destinos.values()]
      .filter(d => (!fz.soloSinZona || !zonaDe(d.clave)) && (!q || normTxt(d.clave).includes(q) || [...d.alias].some(a => a.includes(q))))
      .sort((a, b) => (a.soloAdr - b.soloAdr) || b.viajes - a.viajes || a.clave.localeCompare(b.clave, "es"));
    [...selZonas].forEach(k => { if (!destinos.has(k)) selZonas.delete(k); });

    // Paradas de reparto (todas menos el destino final de salidas con guion)
    const paradasVistas = new Map();
    (salidas ? [...salidas.values()] : []).forEach(x => { const ps = paradasSalida(x); if (ps.length > 1) ps.forEach(p => { const k = normTxt(p); paradasVistas.set(k, (paradasVistas.get(k) || 0) + 1); }); });
    const nombresCanon = [...new Set([...paradasVistas.keys()].map(canon))].sort((a, b) => a.localeCompare(b, "es"));
    // Clientes del Adrematasa
    const adrClientes = new Map();
    (salidas ? [...salidas.values()] : []).forEach(x => { const c = normTxt(x.cliente); if (c) adrClientes.set(c, (adrClientes.get(c) || 0) + 1); });
    const clientesPdf = [...ap.nombres.entries()].sort((a, b) => a[1].localeCompare(b[1], "es"));

    $("#re-cuerpo").innerHTML = `
      <div class="re-grid3" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr));">
        <div>
          <div class="re-h3" style="margin-top:0;">Destinos</div>
          <div class="re-filtros">
            <input type="text" id="re-z-q" placeholder="Buscar destino" value="${esc(fz.q)}" style="width:auto;min-width:160px;">
            <label style="display:inline-flex;gap:6px;align-items:center;margin:0;font-size:13px;color:#2c1e0f;"><input type="checkbox" id="re-z-sin" style="width:auto;"${fz.soloSinZona ? " checked" : ""}> Solo sin zona</label>
          </div>
          <div class="re-lista">${listaD.length ? listaD.map(d => { const z = zonaDe(d.clave); return `
            <label class="re-dest"><input type="checkbox" data-d="${esc(d.clave)}"${selZonas.has(d.clave) ? " checked" : ""} style="width:auto;">
              <span><b>${esc(etiquetaDestino(d.clave))}</b>${d.soloAdr ? ` <small class="nota">(solo Adrematasa, sin factura)</small>` : ""}${z ? ` <span class="re-chip re-azul">${esc(z.nombre)}</span>` : ""}${d.reparto ? ` <span class="re-chip re-rep">${d.reparto} vía reparto</span>` : ""}
              ${d.alias.size ? `<br><small class="nota">Adrematasa: ${esc([...d.alias].join(" · "))}</small>` : ""}</span>
              <small class="nota" style="margin-left:auto;white-space:nowrap;">${d.viajes} ${d.soloAdr ? "salida" : "viaje"}${d.viajes === 1 ? "" : "s"}</small></label>`; }).join("")
            : `<p class="nota" style="padding:10px;">${destinos.size ? "Todos los destinos ya tienen zona." : "Todavía no hay destinos en el periodo."}</p>`}</div>
          <div class="re-filtros" style="margin-top:10px;">
            <span class="nota" style="margin:0;">${selZonas.size} seleccionado${selZonas.size === 1 ? "" : "s"} →</span>
            <input type="text" id="re-z-nombre" list="re-z-nombres" placeholder="Nombre de la zona (nueva o existente)" style="width:auto;min-width:230px;">
            <datalist id="re-z-nombres">${config.zonas.map(z => `<option value="${esc(z.nombre)}">`).join("")}</datalist>
            <button type="button" id="re-z-agrupar"${selZonas.size ? "" : " disabled"}>Agrupar en zona</button>
          </div>
          <p class="nota">Marca destinos y mándalos a una zona nueva o a una que ya existe (si estaban en otra, se mueven). Los nombres del Adrematasa se ligan solos con el destino de la factura por la carta porte. En un reparto cuenta el destino final (la última parada).</p>
        </div>
        <div>
          <div class="re-h3" style="margin-top:0;">Zonas</div>
          ${config.zonas.length ? config.zonas.map(z => `
            <div class="re-zona"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
              <b>${esc(z.nombre)}</b><span style="display:flex;gap:6px;">
              <button type="button" class="secundario re-mini" data-ren="${esc(z.id)}">Renombrar</button>
              <button type="button" class="secundario re-mini" data-del="${esc(z.id)}">Borrar</button></span></div>
              <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">${(z.destinos || []).map(k => `<span class="re-chip re-gris" style="font-size:11.5px;">${esc(etiquetaDestino(k))} <button type="button" class="re-x" data-z="${esc(z.id)}" data-quitar="${esc(k)}" title="Quitar de la zona">✕</button></span>`).join("") || `<small class="nota">Sin destinos</small>`}</div>
            </div>`).join("") : `<p class="nota">Todavía no hay zonas. Marca destinos a la izquierda y agrúpalos.</p>`}
          <div class="re-h3">Clientes: Adrematasa → factura</div>
          <div class="re-lista">${[...adrClientes.entries()].sort((a, b) => b[1] - a[1]).map(([adr, n]) => {
            const auto = ap.cli.get(adr); const autoClave = auto ? moda(auto) : null;
            const manual = config.clientes[adr];
            return `<div class="re-dest" style="cursor:default;"><span><b>${esc(adr)}</b> <small class="nota">${n} salida${n === 1 ? "" : "s"}</small></span>
              <select data-cli="${esc(adr)}" style="width:auto;max-width:60%;margin-left:auto;">
                <option value="">${autoClave ? `Automático: ${esc(ap.nombres.get(autoClave) || autoClave)} (${auto.get(autoClave)})` : "Sin factura todavía"}</option>
                ${clientesPdf.map(([k, nom]) => `<option value="${esc(k)}"${manual && manual.clave === k ? " selected" : ""}>${esc(nom)}</option>`).join("")}
              </select></div>`; }).join("") || `<p class="nota" style="padding:10px;">Todavía no hay salidas en el periodo.</p>`}</div>
          <p class="nota">Se aprenden solas por la carta porte. Elige un cliente solo para corregir o para los que todavía no tienen ninguna factura.</p>
          <div class="re-h3">Paradas de reparto: nombre en el Adrematasa → se cuenta como</div>
          <datalist id="re-p-nombres">${nombresCanon.map(n => `<option value="${esc(n)}">`).join("")}</datalist>
          <div class="re-lista">${[...paradasVistas.entries()].sort((a, b) => a[0].localeCompare(b[0], "es")).map(([p, n]) => `
            <div class="re-dest" style="cursor:default;align-items:center;"><span><b>${esc(p)}</b> <small class="nota">${n}</small></span>
              <input type="text" list="re-p-nombres" data-parada="${esc(p)}" value="${esc(paradasEq[p] || "")}" placeholder="igual (${esc(p)})" style="width:auto;max-width:55%;margin-left:auto;"></div>`).join("")
            || `<p class="nota" style="padding:10px;">Todavía no hay salidas con reparto en el periodo.</p>`}</div>
          <p class="nota">Si una parada se escribe distinto (MONTERREY y MTY), escribe a la derecha el nombre con el que se debe contar. Vacío = se queda como está. Así el mismo recorrido no sale en dos renglones.</p>
        </div>
      </div>`;
    const qi = $("#re-z-q");
    qi.addEventListener("input", () => { fz.q = qi.value; const pos = qi.selectionStart; renderZonas(); const n = $("#re-z-q"); n.focus(); n.setSelectionRange(pos, pos); });
    $("#re-z-sin").addEventListener("change", (e) => { fz.soloSinZona = e.target.checked; renderZonas(); });
    $("#re-cuerpo").querySelectorAll("[data-d]").forEach(c => c.addEventListener("change", () => {
      if (c.checked) selZonas.add(c.dataset.d); else selZonas.delete(c.dataset.d);
      const nombre = $("#re-z-nombre").value; renderZonas(); $("#re-z-nombre").value = nombre;
    }));
    $("#re-z-agrupar").addEventListener("click", async () => {
      const nombre = $("#re-z-nombre").value.trim();
      if (!nombre) { $("#re-error").textContent = "Escribe el nombre de la zona."; return; }
      $("#re-error").textContent = "";
      const elegidos = [...selZonas];
      let zonas = config.zonas.map(z => ({ ...z, destinos: (z.destinos || []).filter(k => !elegidos.includes(k)) }));
      let z = zonas.find(x => x.nombre.toLowerCase() === nombre.toLowerCase());
      if (!z) { z = { id: "z" + Date.now().toString(36), nombre, destinos: [] }; zonas.push(z); }
      z.destinos = [...new Set([...z.destinos, ...elegidos])];
      zonas = zonas.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
      selZonas.clear();
      await guardarZonas(zonas);
      avisar(`${elegidos.length} destino(s) en la zona "${z.nombre}".`);
    });
    $("#re-cuerpo").querySelectorAll("[data-quitar]").forEach(b => b.addEventListener("click", () => {
      guardarZonas(config.zonas.map(z => z.id === b.dataset.z ? { ...z, destinos: (z.destinos || []).filter(k => k !== b.dataset.quitar) } : z));
    }));
    $("#re-cuerpo").querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => {
      const z = config.zonas.find(x => x.id === b.dataset.del);
      if (z && confirm(`¿Borrar la zona "${z.nombre}"? Sus destinos quedan sin zona.`)) guardarZonas(config.zonas.filter(x => x.id !== z.id));
    }));
    $("#re-cuerpo").querySelectorAll("[data-ren]").forEach(b => b.addEventListener("click", () => {
      const z = config.zonas.find(x => x.id === b.dataset.ren);
      const nuevo = z ? (prompt("Nuevo nombre de la zona:", z.nombre) || "").trim() : "";
      if (z && nuevo && nuevo !== z.nombre) guardarZonas(config.zonas.map(x => x.id === z.id ? { ...x, nombre: nuevo } : x));
    }));
    $("#re-cuerpo").querySelectorAll("[data-parada]").forEach(inp => inp.addEventListener("change", async () => {
      const mapa = { ...paradasEq };
      const v = normTxt(inp.value);
      if (v && v !== inp.dataset.parada) mapa[inp.dataset.parada] = v; else delete mapa[inp.dataset.parada];
      try { await setDoc(doc(db, COL_CONFIG, "paradas"), { mapa, actualizadoEn: new Date().toISOString() }); }
      catch (e) { $("#re-error").textContent = "No se pudo guardar la parada: " + e.message; }
    }));
    $("#re-cuerpo").querySelectorAll("[data-cli]").forEach(s => s.addEventListener("change", () => {
      const clave = s.value;
      guardarCliente(s.dataset.cli, clave ? { clave, nombre: ap.nombres.get(clave) || clave } : null);
    }));
  }

  // ---- Salidas Adrematasa ----
  function renderSalidas() {
    const guardadas = [...(salidas || new Map()).values()];
    const porTaim = ligas().facturaDeTaim, posibles = ligas().posibles;
    const cuenta = (arr, t) => arr.filter(x => x.tipo === t).length;
    const resumenPegadas = pegadas ? `
      <div class="re-kpis">
        <div class="re-kpi"><b>${pegadas.length}</b><small>Salidas leídas</small></div>
        <div class="re-kpi"><b style="color:#0C447C;">${cuenta(pegadas, "refrigerada")}</b><small>Refrigeradas (Prog con temperatura)</small></div>
        <div class="re-kpi"><b style="color:#7a4a12;">${cuenta(pegadas, "seca")}</b><small>Secas (Prog OFF)</small></div>
        <div class="re-kpi"><b>${pegadas.filter(x => porTaim.has(x.factura)).length}</b><small>Ya ligadas a una factura guardada</small></div>
      </div>
      ${cuenta(pegadas, "sin") ? `<div class="re-errores">${cuenta(pegadas, "sin")} renglón(es) traen un Prog que no es OFF ni una temperatura; quedan "sin dato".</div>` : ""}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;"><button type="button" id="re-s-guardar">Guardar ${pegadas.length} salida${pegadas.length === 1 ? "" : "s"}</button>
        <button type="button" class="secundario" id="re-s-cancelar">Cancelar</button></div>` : "";
    const base = grupoSalidas ? guardadas.filter(x => grupoSalidas.taims.has(x.factura)) : guardadas;
    const esRep = (x) => paradasSalida(x).length > 1;
    const vista = base.filter(x => (filtroSalidas === "todas" || (filtroSalidas === "sinfactura" ? !porTaim.has(x.factura) : filtroSalidas === "reparto" ? esRep(x) : x.tipo === filtroSalidas)))
      .sort((a, b) => (b.fechaMs || 0) - (a.fechaMs || 0));
    const filtros = [["todas", "Todas", base.length], ["refrigerada", "Refrigeradas", cuenta(base, "refrigerada")],
      ["seca", "Secas", cuenta(base, "seca")], ["sinfactura", "Sin factura cargada", base.filter(x => !porTaim.has(x.factura)).length], ["reparto", "Con reparto", base.filter(esRep).length]];
    const pgS = paginar("salidas", vista, `${filtroSalidas}|${grupoSalidas ? grupoSalidas.txt : ""}|${vista.length}`);
    const modo = tab === "cargarSalidas" ? "cargar" : "lista";
    $("#re-cuerpo").innerHTML = modo === "cargar" ? `
      <p class="nota" style="margin-top:0;">Copia del Adrematasa oficial el reporte de salidas <b>con la fila de títulos</b> y pégalo aquí. Se ligan con las facturas por el folio de Carta Porte (columna Factura, TAIM-…). <b>Prog OFF = SECA</b>; una temperatura = <b>REFRIGERADA</b>. Pegar otro reporte agrega las nuevas y actualiza las que ya estaban; no borra nada.</p>
      <textarea class="re-pegar" id="re-s-texto" placeholder="Pega aquí el reporte de salidas…"></textarea>
      <div style="margin-top:8px;"><button type="button" class="secundario" id="re-s-leer">Leer reporte</button></div>
      ${resumenPegadas}
      <p class="nota">${guardadas.length.toLocaleString("es-MX")} salidas guardadas en el periodo. Para verlas, abre la pestaña Salidas.</p>` : `
      ${grupoSalidas ? `<div class="re-filtros"><span class="re-chip re-azul" style="font-size:12px;">${esc(grupoSalidas.txt)}</span><button type="button" class="secundario" id="re-s-quitar-grupo" style="padding:4px 10px;font-size:12px;">Quitar filtro ✕</button></div>` : ""}
      <div class="re-filtros">${filtros.map(([k, t, n]) => `<button type="button" class="re-tab${filtroSalidas === k ? " activo" : ""}" data-fs="${k}">${t} ${n}</button>`).join("")}</div>
      ${vista.length ? `<div class="tabla-wrap"><table class="tabla re-tabla">
        <thead><tr><th>Carta porte</th><th>Fecha</th><th>Cliente</th><th>Destino</th><th class="n">Repartos</th><th>Remolque</th><th>Carro</th><th>Salida</th><th>Prog</th><th>Tipo</th><th>Factura</th></tr></thead>
        <tbody>${pgS.items.map(x => { const f = porTaim.get(x.factura); const ps = paradasSalida(x); const r = f ? infoReparto(f, x) : null; const refa = f && String(f.cartaPorteFolio || "").toUpperCase() !== x.factura; const pos = !f ? (posibles.get(x.factura) || []) : []; return `<tr${f ? ` class="clic" data-u="${esc(f.uuid)}"` : ""}>
          <td>${esc(x.factura)}</td><td>${esc(x.fechaHora)}</td><td>${esc(x.cliente)}</td>
          <td>${ps.length > 1 ? ps.map((p, n) => `<span class="re-parada">${n === ps.length - 1 ? `<b>${esc(p)}</b>` : esc(p)}</span>`).join("") : esc(x.destino)}</td>
          <td class="n">${ps.length > 1 ? `<span class="re-chip re-rep">${ps.length - 1}</span>` : "—"}</td>
          <td>${esc(x.remolque)}</td><td>${esc(x.carro)}</td><td>${esc(x.tempSalida)}</td><td>${esc(x.prog)}</td>
          <td><span class="re-chip ${TIPO[x.tipo].clase}">${TIPO[x.tipo].txt}</span></td>
          <td>${f ? `<span class="re-chip re-verde">${esc(f.factura)}</span>${refa ? ` <span class="re-chip re-ambar">REFACTURA</span><br><small class="nota">factura con ${esc(f.cartaPorteFolio)}</small>` : ""}${r.sinCobro ? ` <span class="re-chip re-rojo">reparto sin cobro</span>` : ""}`
            : pos.length ? `<span class="re-chip re-ambar">¿refactura?</span> ${pos.map(pf => `<button type="button" class="re-link" data-ligar="${esc(pf.uuid)}" data-taim="${esc(x.factura)}">${esc(pf.factura)}</button>`).join(" ")}<br><small class="nota">mismo remolque${pos.length > 1 ? "; elige cuál" : ""}</small>`
            : `<span class="re-chip re-gris">sin factura cargada</span> <button type="button" class="re-link re-mini" data-ligar-folio="${esc(x.factura)}">Ligar</button>`}</td></tr>`; }).join("")}</tbody>
      </table></div>${pgS.html}`
        : `<p class="nota" style="text-align:center;padding:16px;">${guardadas.length ? "No hay salidas con este filtro." : "Todavía no hay salidas guardadas."}</p>`}`;
    const leer = $("#re-s-leer");
    if (leer) leer.addEventListener("click", () => {
      $("#re-error").textContent = "";
      try { pegadas = leerSalidas($("#re-s-texto").value); renderSalidas(); }
      catch (e) { pegadas = null; $("#re-error").textContent = e.message; }
    });
    const g = $("#re-s-guardar"); if (g) g.addEventListener("click", guardarSalidas);
    const c = $("#re-s-cancelar"); if (c) c.addEventListener("click", () => { pegadas = null; renderSalidas(); });
    $("#re-cuerpo").querySelectorAll("[data-fs]").forEach(b => b.addEventListener("click", () => { filtroSalidas = b.dataset.fs; renderSalidas(); }));
    const qg = $("#re-s-quitar-grupo"); if (qg) qg.addEventListener("click", () => { grupoSalidas = null; renderSalidas(); });
    enlazarPaginas(renderSalidas);
    $("#re-cuerpo").querySelectorAll("tr.clic").forEach(tr => tr.addEventListener("click", () => abrirDetalle(tr.dataset.u)));
    $("#re-cuerpo").querySelectorAll("[data-ligar]").forEach(b => b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const f = facturas.get(b.dataset.ligar);
      if (f && confirm(`¿Ligar la salida ${b.dataset.taim} con la factura ${f.factura} (refactura)?`)) { await guardarLiga(f.uuid, b.dataset.taim); avisar(`${b.dataset.taim} ligada con ${f.factura}.`); }
    }));
    $("#re-cuerpo").querySelectorAll("[data-ligar-folio]").forEach(b => b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const folio = normTxt(prompt(`Folio de la factura para la salida ${b.dataset.ligarFolio} (ej. FAIM-55733):`) || "").replace(/\s+/g, "");
      if (!folio) return;
      const f = lista().find(x => normTxt(x.factura) === folio);
      if (!f) { $("#re-error").textContent = `No encontré la factura ${folio} en el periodo. Cárgala primero.`; return; }
      await guardarLiga(f.uuid, b.dataset.ligarFolio); avisar(`${b.dataset.ligarFolio} ligada con ${f.factura}.`);
    }));
  }

  async function guardarSalidas() {
    if (!pegadas || !pegadas.length) return;
    const btn = $("#re-s-guardar"); if (btn) btn.disabled = true;
    $("#re-error").textContent = "";
    try {
      const ahora = Date.now();
      const unicas = [...new Map(pegadas.map(x => [x.factura, x])).values()]; // si se repite un TAIM, gana el último
      for (let i = 0; i < unicas.length; i += 400) {
        const lote = writeBatch(db);
        unicas.slice(i, i + 400).forEach(x => lote.set(doc(db, COL_SALIDAS, x.factura),
          { ...x, cargadaMs: ahora, cargadaPor: { uid, nombre: (datosUsuario && datosUsuario.nombre) || "" } }, { merge: true }));
        await lote.commit();
      }
      avisar(`${unicas.length} salida${unicas.length === 1 ? "" : "s"} guardada${unicas.length === 1 ? "" : "s"}.`);
      pegadas = null;
      renderSalidas();
    } catch (e) {
      $("#re-error").textContent = "No se pudieron guardar las salidas: " + e.message;
      if (btn) btn.disabled = false;
    }
  }

  async function descargarExcel() {
    try {
      const XLSX = await cargarScript(URL_SHEETJS, "XLSX");
      const fs = filtradas().sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""));
      const conceptosExcel = [...new Set(fs.flatMap(f => (f.conceptos || []).map(k => nombreConcepto(k.servicio))))]
        .sort((a, b) => (a === "FLETE" ? -1 : b === "FLETE" ? 1 : a.localeCompare(b, "es")));
      const filas = fs.map(f => {
        const c = f.calculos || {}, cli = f.cliente || {}, cp = f.cartaPorte || {}, r = recorridoDe(f, salidaDe(f)), sa = salidaDe(f);
        const porNombre = {};
        (f.conceptos || []).forEach(k => { const n = nombreConcepto(k.servicio); porNombre[n] = Math.round(((porNombre[n] || 0) + (k.importe || 0)) * 100) / 100; });
        return {
          "Fecha": f.fecha, "Factura": f.factura, "Tipo": TIPO[tipoDe(f)].txt, "Ruta (corta/larga)": RUTA[tipoRuta((f.calculos || {}).km)].txt,
          "Zona": (zonaDe(f.destino || "") || {}).nombre || "", "Prog": (salidaDe(f) || {}).prog || "", "Temp. salida": (salidaDe(f) || {}).tempSalida || "", "Carta porte": f.cartaPorteFolio, "Viaje": f.viaje, "Folio fiscal": f.uuid,
          "Cliente": cli.nombre, "RFC cliente": cli.rfc, "Remitente": (f.remitente || {}).nombre, "Destinatario": (f.destinatario || {}).nombre,
          "Origen": f.origen, "Destino": f.destino, "Se entrega en": (f.destinatario || {}).seEntregaEn,
          "Recorrido": r.numero ? r.paradas.join(" → ") : "Directo", "Repartos": r.numero,
          "Cobro reparto (moneda)": r.rf.cobro || "", "Reparto sin cobro": r.sinCobro ? "Sí" : "",
          "Salida ligada": sa ? sa.factura : "", "Refactura": sa && sa.factura !== String(f.cartaPorteFolio || "").toUpperCase() ? "Sí" : "",
          "Moneda": f.moneda, "Tipo de cambio": f.tipoCambio, "Flete (moneda)": c.flete, "Subtotal (moneda)": f.subtotal, "Total (moneda)": f.total,
          ...Object.fromEntries(conceptosExcel.map(n => [`${n} (moneda)`, porNombre[n] != null ? porNombre[n] : ""])),
          "Km": c.km, "Km capturados a mano": f.kmCapturado ? "Sí" : "",
          "Flete MXN": c.fleteMxn, "Flete/km MXN": c.fletePorKm, "Subtotal MXN": c.subtotalMxn, "Subtotal/km MXN": c.subtotalPorKm,
          "Unidad": f.unidad, "Remolque": f.remolque, "Operador": f.operador, "Configuración": cp.configuracion, "Observaciones": f.observaciones,
        };
      });
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filas), "Facturas");
      XLSX.writeFile(libro, `Rentabilidad_${filtro.mes || "todo"}.xlsx`);
    } catch (e) {
      $("#re-error").textContent = "No se pudo generar el Excel: " + e.message;
    }
  }

  suscribir();
}