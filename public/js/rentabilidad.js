// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/public/js/rentabilidad.js
// ##########################################################################
import { db } from "./firebase-config.js";
import { collection, doc, onSnapshot, setDoc, deleteDoc, updateDoc, writeBatch, getDoc, query, where } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { leerFactura, paginasDePdf, calcular } from "./rentabilidadPdf.js";

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
// ============================================================================

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
    .re-seg { display:inline-flex; border:1px solid #e2ddd5; border-radius:9px; overflow:hidden; }
    .re-seg button { background:#fff; border:0; border-left:1px solid #e2ddd5; padding:6px 11px; font:inherit; font-size:12.5px; color:#6b5f52; cursor:pointer; }
    .re-seg button:first-child { border-left:0; } .re-seg button.activo { background:#2c1e0f; color:#fff; font-weight:700; }
    .re-link { background:none; border:0; padding:0; font:inherit; font-weight:700; color:#185FA5; text-decoration:underline; cursor:pointer; }
    .re-link.re-falta { color:#A32D2D; }
    .re-lista { border:1px solid #e2ddd5; border-radius:10px; overflow:hidden; background:#fff; max-height:520px; overflow-y:auto; }
    .re-dest { display:flex; gap:8px; align-items:flex-start; padding:8px 10px; border-top:1px solid #f0ece6; font-size:13px; cursor:pointer; margin:0; color:#2c1e0f; }
    .re-dest:first-child { border-top:0; }
    .re-zona { border:1px solid #e2ddd5; border-radius:10px; padding:10px 12px; margin-bottom:8px; background:#fff; }
    .re-mini { padding:3px 8px; font-size:11.5px; }
    .re-x { background:none; border:0; padding:0 0 0 4px; cursor:pointer; color:#A32D2D; font-weight:800; }
    .re-pag { display:flex; gap:8px; align-items:center; justify-content:center; margin:12px 0 4px; flex-wrap:wrap; }
    .re-col-flete { background:#EFE7DA; font-weight:700; } .re-col-con { background:#F7F3EE; }
    .re-seca { background:#F3E9D7; color:#7a4a12; } .re-refri { background:#DDEEFB; color:#0C447C; }
    .re-pegar { width:100%; box-sizing:border-box; min-height:120px; font-family:monospace; font-size:11.5px; white-space:pre; }
  `;
  document.head.appendChild(s);
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
      ${salida ? ` Adrematasa: Prog <b>${esc(salida.prog)}</b> · salida ${esc(salida.tempSalida || "—")} · remolque ${esc(salida.remolque || "—")} · carro ${esc(salida.carro || "—")} · ${esc(salida.fechaHora || "")}` : ` <span class="nota">Todavía no se pega la salida de ${esc(f.cartaPorteFolio || "esta factura")} del Adrematasa.</span>`}</div>
    <div class="re-kpis">
      <div class="re-kpi hero"><b>${c.fletePorKm != null ? dinero(c.fletePorKm) : "—"}</b><small>Flete por km${usd ? " (en MXN)" : ""}</small></div>
      <div class="re-kpi"><b>${c.subtotalPorKm != null ? dinero(c.subtotalPorKm) : "—"}</b><small>Subtotal por km${usd ? " (en MXN)" : ""}</small></div>
      <div class="re-kpi"><b>${c.km != null ? miles(c.km) + " km" : "—"}</b><small>Distancia recorrida (Carta Porte)</small></div>
      <div class="re-kpi"><b>${dinero(f.subtotal, mon)}</b><small>Subtotal · ${esc(mon)} · TC ${esc(f.tipoCambio)}${usd ? " = " + dinero(c.subtotalMxn) : ""}</small></div>
      <div class="re-kpi"><b>${dinero(f.total, mon)}</b><small>Total (${esc((f.iva && f.iva.etiqueta) || "IVA")} · ${esc((f.retencion && f.retencion.etiqueta) || "retención")})</small></div>
    </div>
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
  const salidaDe = (f) => (salidas && f && f.cartaPorteFolio) ? salidas.get(String(f.cartaPorteFolio).toUpperCase()) || null : null;
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
  $("#re-periodo").addEventListener("change", (e) => {
    periodoMeses = Number(e.target.value);
    try { localStorage.setItem("rentabilidad_periodo", String(periodoMeses)); } catch (err) { /* nada */ }
    filtro.mes = "";
    suscribir();
  });
  const vigilar = setInterval(() => { if (!contenedor.isConnected) { clearInterval(vigilar); cancelar(); cancelarSalidas(); if (cancelarConfig) cancelarConfig(); } }, 3000);

  function renderTabs() {
    $("#re-tabs").innerHTML = [["tarifas", "Tarifas por cliente"], ["cargar", "Cargar facturas"], ["cargarSalidas", "Cargar salidas"], ["zonas", "Zonas y equivalencias"], ["facturas", "Facturas"], ["salidas", "Salidas"]]
      .map(([k, t]) => `<button type="button" class="re-tab${tab === k ? " activo" : ""}" data-t="${k}">${t}</button>`).join("");
    $("#re-tabs").querySelectorAll(".re-tab").forEach(b => b.addEventListener("click", () => { tab = b.dataset.t; render(); }));
  }

  function render() {
    renderTabs();
    if (tab === "cargar") return renderCargar();
    if (!facturas) { $("#re-cuerpo").innerHTML = `<p class="nota">Cargando…</p>`; return; }
    if (tab === "facturas") return renderFacturas();
    if (tab === "salidas" || tab === "cargarSalidas") return renderSalidas();
    if (tab === "zonas") return renderZonas();
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
          <td>${esc((f.cliente || {}).nombre)}</td><td>${esc(f.ruta)}</td><td>${esc(f.unidad)}</td>
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
  const ft = { cliente: "", zona: "", carga: "", ruta: "", q: "" }; // filtros de Tarifas
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
    cancelarConfig = () => { c1(); c2(); };
  }
  const zonaDe = (clave) => config.zonas.find(z => (z.destinos || []).includes(clave)) || null;
  const adrDestino = (x) => "ADR:" + normTxt(x.destino);
  const etiquetaDestino = (clave) => clave.startsWith("ADR:") ? clave.slice(4) : clave;
  const moda = (mapa) => { let mejor = null, n = 0; mapa.forEach((v, k) => { if (v > n) { mejor = k; n = v; } }); return mejor; };

  // Equivalencias aprendidas de las salidas que sí tienen factura.
  function aprender() {
    const porTaim = new Map(lista().filter(f => f.cartaPorteFolio).map(f => [String(f.cartaPorteFolio).toUpperCase(), f]));
    const cli = new Map(), des = new Map(), kmDes = new Map(), nombres = new Map();
    lista().forEach(f => {
      nombres.set(f.clienteClave, (f.cliente || {}).nombre || f.clienteClave);
      const km = (f.calculos || {}).km;
      if (f.destino && km) { const m = kmDes.get(f.destino) || new Map(); m.set(km, (m.get(km) || 0) + 1); kmDes.set(f.destino, m); }
    });
    (salidas ? [...salidas.values()] : []).forEach(x => {
      const f = porTaim.get(x.factura);
      if (!f) return;
      const c = normTxt(x.cliente), d = normTxt(x.destino);
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

  function renderTarifas() {
    const ap = aprender();
    const ORDEN_C = { seca: 0, refrigerada: 1, sin: 2 }, ORDEN_R = { corta: 0, larga: 1, sin: 2 };
    const grupos = new Map();
    const grupo = (cli, cliNombre, destClave, carga, ruta) => {
      const z = zonaDe(destClave);
      const zona = z ? z.nombre : etiquetaDestino(destClave);
      const k = `${cli}|${zona}|${carga}|${ruta}`;
      if (!grupos.has(k)) grupos.set(k, { k, cli, cliNombre, zona, conZona: !!z, destinos: new Set(), carga, ruta, fs: [], pendientes: [] });
      const g = grupos.get(k);
      g.destinos.add(etiquetaDestino(destClave));
      return g;
    };
    lista().forEach(f => {
      const km = (f.calculos || {}).km;
      grupo(f.clienteClave, (f.cliente || {}).nombre || f.clienteClave, f.destino || "Sin destino", tipoDe(f), tipoRuta(km)).fs.push(f);
    });
    (salidas ? [...salidas.values()] : []).forEach(x => {
      if (ap.porTaim.has(x.factura)) return;
      const adrCli = normTxt(x.cliente);
      const c = ap.clienteDe(adrCli);
      const destPdf = ap.destinoDe(normTxt(x.destino));
      const destClave = destPdf || adrDestino(x);
      const ruta = destPdf ? tipoRuta(ap.kmDe(destPdf)) : "sin";
      grupo(c ? c.clave : "ADR:" + adrCli, c ? c.nombre : `${adrCli || "SIN CLIENTE"} (Adrematasa, sin facturas)`, destClave, x.tipo, ruta).pendientes.push(x);
    });
    const todos = [...grupos.values()];
    const clientesOpc = new Map(); todos.forEach(g => clientesOpc.set(g.cli, g.cliNombre));
    const zonasOpc = [...new Set(todos.map(g => g.zona))].sort((a, b) => a.localeCompare(b, "es"));
    const q = normTxt(ft.q);
    const gs = todos.filter(g => (!ft.cliente || g.cli === ft.cliente) && (!ft.zona || g.zona === ft.zona) &&
      (!ft.carga || g.carga === ft.carga) && (!ft.ruta || g.ruta === ft.ruta) &&
      (!q || normTxt(g.cliNombre).includes(q) || normTxt(g.zona).includes(q)))
      .sort((a, b) => a.cliNombre.localeCompare(b.cliNombre, "es") || a.zona.localeCompare(b.zona, "es") || ORDEN_C[a.carga] - ORDEN_C[b.carga] || ORDEN_R[a.ruta] - ORDEN_R[b.ruta]);

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
      const encabezado = g.cli !== anterior ? `<tr><td colspan="${columnas.length + 7}" style="background:#f2ede6;font-weight:800;padding-top:10px;">${esc(g.cliNombre)}</td></tr>` : "";
      anterior = g.cli;
      const destinosTxt = g.conZona || g.destinos.size > 1 ? `<br><small class="nota">${esc([...g.destinos].join(" · "))}</small>` : "";
      return encabezado + `<tr>
        <td>${esc(g.zona)}${g.conZona ? "" : ` <small class="nota">(sin zona)</small>`}${destinosTxt}</td>
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
        <span class="re-seg" style="margin-left:auto;">${[["flete", "Ing./km FLETE"], ["subtotal", "Ing./km SUBTOTAL"]].map(([v, t]) => `<button type="button" class="${metricaKm === v ? "activo" : ""}" data-m="${v}">${t}</button>`).join("")}</span>
      </div>
      ${gs.length ? `<div class="tabla-wrap"><table class="tabla re-tabla">
        <thead><tr><th>Zona destino</th><th>Carga</th><th>Ruta</th><th class="n">Km</th>
          ${columnas.map(c => `<th class="n${c === "FLETE" ? " re-col-flete" : " re-col-con"}">${esc(c)}</th>`).join("")}
          <th class="n">Ing./km ${metricaKm === "flete" ? "flete" : "subtotal"} (MXN)</th><th class="n">Facturas</th><th class="n">Sin factura</th></tr></thead>
        <tbody>${filas}</tbody></table></div>${pg.html}
        <p class="nota">Ruta: CORTA si la factura tiene menos de ${KM_RUTA_LARGA} km; LARGA si tiene ${KM_RUTA_LARGA} o más. Valores como vienen en la factura; si cambian, el más común y en chico "varía". "Sin factura" = salidas del Adrematasa de ese cliente, zona y carga que todavía no tienen PDF cargado (toca el número para ver cuáles). Carga "SIN DATO" = la factura no encontró su salida.${hayOtros ? ` "OTROS" junta ${otrosNombres.length - visibles.length} concepto(s) poco frecuentes.` : ""}</p>`
        : `<p class="nota" style="text-align:center;padding:16px;">${todos.length ? "No hay renglones con estos filtros." : "Todavía no hay facturas ni salidas en el periodo."}</p>`}`;
    const qi = $("#re-t-q");
    qi.addEventListener("input", () => { ft.q = qi.value; const pos = qi.selectionStart; renderTarifas(); const n = $("#re-t-q"); n.focus(); n.setSelectionRange(pos, pos); });
    $("#re-t-cli").addEventListener("change", (e) => { ft.cliente = e.target.value; renderTarifas(); });
    $("#re-t-zona").addEventListener("change", (e) => { ft.zona = e.target.value; renderTarifas(); });
    $("#re-cuerpo").querySelectorAll("[data-ft]").forEach(b => b.addEventListener("click", () => { ft[b.dataset.ft] = b.dataset.v; renderTarifas(); }));
    $("#re-cuerpo").querySelectorAll("[data-m]").forEach(b => b.addEventListener("click", () => { metricaKm = b.dataset.m; renderTarifas(); }));
    $("#re-cuerpo").querySelectorAll("[data-ver]").forEach(b => b.addEventListener("click", () => {
      const g = grupos.get(b.dataset.k);
      if (!g) return;
      const txt = `${g.cliNombre} · ${g.zona} · ${TIPO[g.carga].txt} · ${RUTA[g.ruta].txt}`;
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
      const d = destinos.get(k) || { clave: k, viajes: 0, alias: new Set(), soloAdr: false };
      d.viajes++; destinos.set(k, d);
    });
    ap.des.forEach((m, adr) => { const k = moda(m); const d = destinos.get(k); if (d) d.alias.add(adr); });
    (salidas ? [...salidas.values()] : []).forEach(x => {
      if (ap.porTaim.has(x.factura) || ap.destinoDe(normTxt(x.destino))) return;
      const k = adrDestino(x);
      const d = destinos.get(k) || { clave: k, viajes: 0, alias: new Set(), soloAdr: true };
      d.viajes++; destinos.set(k, d);
    });
    config.zonas.forEach(z => (z.destinos || []).forEach(k => { if (!destinos.has(k)) destinos.set(k, { clave: k, viajes: 0, alias: new Set(), soloAdr: k.startsWith("ADR:") }); }));
    const q = normTxt(fz.q);
    const listaD = [...destinos.values()]
      .filter(d => (!fz.soloSinZona || !zonaDe(d.clave)) && (!q || normTxt(d.clave).includes(q) || [...d.alias].some(a => a.includes(q))))
      .sort((a, b) => (a.soloAdr - b.soloAdr) || b.viajes - a.viajes || a.clave.localeCompare(b.clave, "es"));
    [...selZonas].forEach(k => { if (!destinos.has(k)) selZonas.delete(k); });

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
              <span><b>${esc(etiquetaDestino(d.clave))}</b>${d.soloAdr ? ` <small class="nota">(solo Adrematasa, sin factura)</small>` : ""}${z ? ` <span class="re-chip re-azul">${esc(z.nombre)}</span>` : ""}
              ${d.alias.size ? `<br><small class="nota">Adrematasa: ${esc([...d.alias].join(" · "))}</small>` : ""}</span>
              <small class="nota" style="margin-left:auto;white-space:nowrap;">${d.viajes} ${d.soloAdr ? "salida" : "viaje"}${d.viajes === 1 ? "" : "s"}</small></label>`; }).join("")
            : `<p class="nota" style="padding:10px;">${destinos.size ? "Todos los destinos ya tienen zona." : "Todavía no hay destinos en el periodo."}</p>`}</div>
          <div class="re-filtros" style="margin-top:10px;">
            <span class="nota" style="margin:0;">${selZonas.size} seleccionado${selZonas.size === 1 ? "" : "s"} →</span>
            <input type="text" id="re-z-nombre" list="re-z-nombres" placeholder="Nombre de la zona (nueva o existente)" style="width:auto;min-width:230px;">
            <datalist id="re-z-nombres">${config.zonas.map(z => `<option value="${esc(z.nombre)}">`).join("")}</datalist>
            <button type="button" id="re-z-agrupar"${selZonas.size ? "" : " disabled"}>Agrupar en zona</button>
          </div>
          <p class="nota">Marca destinos y mándalos a una zona nueva o a una que ya existe (si estaban en otra, se mueven). Los nombres del Adrematasa se ligan solos con el destino de la factura por la carta porte.</p>
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
    $("#re-cuerpo").querySelectorAll("[data-cli]").forEach(s => s.addEventListener("change", () => {
      const clave = s.value;
      guardarCliente(s.dataset.cli, clave ? { clave, nombre: ap.nombres.get(clave) || clave } : null);
    }));
  }

  // ---- Salidas Adrematasa ----
  function renderSalidas() {
    const guardadas = [...(salidas || new Map()).values()];
    const porTaim = new Map(lista().filter(f => f.cartaPorteFolio).map(f => [String(f.cartaPorteFolio).toUpperCase(), f]));
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
    const vista = base.filter(x => (filtroSalidas === "todas" || (filtroSalidas === "sinfactura" ? !porTaim.has(x.factura) : x.tipo === filtroSalidas)))
      .sort((a, b) => (b.fechaMs || 0) - (a.fechaMs || 0));
    const filtros = [["todas", "Todas", base.length], ["refrigerada", "Refrigeradas", cuenta(base, "refrigerada")],
      ["seca", "Secas", cuenta(base, "seca")], ["sinfactura", "Sin factura cargada", base.filter(x => !porTaim.has(x.factura)).length]];
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
        <thead><tr><th>Carta porte</th><th>Fecha</th><th>Cliente</th><th>Destino</th><th>Remolque</th><th>Carro</th><th>Salida</th><th>Prog</th><th>Tipo</th><th>Factura</th></tr></thead>
        <tbody>${pgS.items.map(x => { const f = porTaim.get(x.factura); return `<tr${f ? ` class="clic" data-u="${esc(f.uuid)}"` : ""}>
          <td>${esc(x.factura)}</td><td>${esc(x.fechaHora)}</td><td>${esc(x.cliente)}</td><td>${esc(x.destino)}</td>
          <td>${esc(x.remolque)}</td><td>${esc(x.carro)}</td><td>${esc(x.tempSalida)}</td><td>${esc(x.prog)}</td>
          <td><span class="re-chip ${TIPO[x.tipo].clase}">${TIPO[x.tipo].txt}</span></td>
          <td>${f ? `<span class="re-chip re-verde">${esc(f.factura)}</span>` : `<span class="re-chip re-gris">sin factura cargada</span>`}</td></tr>`; }).join("")}</tbody>
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
        const c = f.calculos || {}, cli = f.cliente || {}, cp = f.cartaPorte || {};
        const porNombre = {};
        (f.conceptos || []).forEach(k => { const n = nombreConcepto(k.servicio); porNombre[n] = Math.round(((porNombre[n] || 0) + (k.importe || 0)) * 100) / 100; });
        return {
          "Fecha": f.fecha, "Factura": f.factura, "Tipo": TIPO[tipoDe(f)].txt, "Ruta (corta/larga)": RUTA[tipoRuta((f.calculos || {}).km)].txt,
          "Zona": (zonaDe(f.destino || "") || {}).nombre || "", "Prog": (salidaDe(f) || {}).prog || "", "Temp. salida": (salidaDe(f) || {}).tempSalida || "", "Carta porte": f.cartaPorteFolio, "Viaje": f.viaje, "Folio fiscal": f.uuid,
          "Cliente": cli.nombre, "RFC cliente": cli.rfc, "Remitente": (f.remitente || {}).nombre, "Destinatario": (f.destinatario || {}).nombre,
          "Origen": f.origen, "Destino": f.destino, "Se entrega en": (f.destinatario || {}).seEntregaEn,
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