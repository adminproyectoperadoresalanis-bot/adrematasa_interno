// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/public/js/comercialFactura.js
// ##########################################################################
// Calculadora de Comercial: cargar una factura (2026-11-17, pedido de Ivan).
// - Lee el PDF (CFDI + Carta Porte) con el MISMO lector de Rentabilidad
//   (rentabilidadPdf.js) y regresa origen, destino, km, flete, moneda y TC.
// - Empata origen y destino (texto de la factura) con un lugar de ORS
//   (con coordenadas), en este orden:
//     1) diccionario com_lugares (ya se empató antes)            → "Conocido"
//     2) ORS búsqueda estructurada: CP + municipio + estado + país → "Por CP"
//        (solo si el resultado cae en el mismo municipio y estado)
//     3) si no hay certeza, candidatos para elegir               → "Revisar"
//   Lo confirmado se guarda en com_lugares y la próxima vez empata solo.
// - Guardar en Rentabilidad: SOLO la cuenta de Ivan (las reglas lo exigen
//   igual). Si la factura ya está (mismo folio fiscal), no se guarda otra vez.
// - Buscador de facturas ya cargadas en Rentabilidad: solo Ivan.
// - Km: manda el de la factura (Carta Porte); el de ORS se muestra al lado.

import { db } from "./firebase-config.js";
import {
  collection, doc, getDoc, getDocs, setDoc, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { leerFactura, paginasDePdf, lugar as lugarFactura } from "./rentabilidadPdf.js";

const ORS = "https://api.openrouteservice.org";
const URL_PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const URL_PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const COL_FACTURAS = "rentabilidad_facturas";
const COL_LUGARES = "com_lugares";
const RFC_GENERICOS = ["XEXX010101000", "XAXX010101000"];
const DUENO_RENTABILIDAD = "ilanda@alanis.com.mx";

function esc(t) { const d = document.createElement("div"); d.textContent = t == null ? "" : String(t); return d.innerHTML; }
const norm = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const dinero = (n, mon) => n == null || !isFinite(n) ? "—" : `${mon === "USD" ? "US$" : "$"}${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const miles = (n) => n == null ? "—" : Number(n).toLocaleString("es-MX", { maximumFractionDigits: 0 });

export function esDuenoRentabilidad(datosUsuario, correo) {
  return !!datosUsuario && datosUsuario.rol === "admin" && String(correo || "").toLowerCase() === DUENO_RENTABILIDAD;
}

// ---- Leer el PDF -------------------------------------------------------------
function cargarScript(url, global) {
  if (window[global]) return Promise.resolve(window[global]);
  return new Promise((ok, mal) => { const s = document.createElement("script"); s.src = url; s.onload = () => ok(window[global]); s.onerror = () => mal(new Error("No se pudo descargar " + url)); document.head.appendChild(s); });
}
export async function leerFacturaPdf(archivo) {
  const lib = await cargarScript(URL_PDFJS, "pdfjsLib");
  lib.GlobalWorkerOptions.workerSrc = URL_PDFJS_WORKER;
  const paginas = await paginasDePdf(lib, new Uint8Array(await archivo.arrayBuffer()));
  const f = leerFactura(paginas);
  if (!f.uuid) throw new Error("No es una factura con el formato esperado (no encontré el Folio Fiscal).");
  return f;
}

// ---- Rentabilidad (solo Ivan) -------------------------------------------------
// Mismo registro que guarda Rentabilidad → Cargar facturas.
function registroRentabilidad(f, por) {
  const limpio = JSON.parse(JSON.stringify(f));
  delete limpio.errores;
  const c = f.cliente || {};
  limpio.clienteClave = c.rfc && !RFC_GENERICOS.includes(c.rfc) ? c.rfc : "EXT:" + (c.nombre || "").toUpperCase();
  limpio.mes = (f.fecha || "").slice(0, 7);
  limpio.cargadaMs = Date.now();
  limpio.cargadaPor = por;
  limpio.cargadaDesde = "calculadora";
  return limpio;
}
// Regresa "guardada" | "existente" | "sin-km" (sin km no se guarda, igual que en Rentabilidad).
export async function guardarEnRentabilidad(f, por) {
  const ref = doc(db, COL_FACTURAS, f.uuid);
  if ((await getDoc(ref)).exists()) return "existente";
  if (!(f.calculos && f.calculos.km)) return "sin-km";
  await setDoc(ref, registroRentabilidad(f, por));
  return "guardada";
}

// ---- Empate de lugares ---------------------------------------------------------
const paisDe = (p) => {
  const t = norm(p && p.pais), e = norm(p && p.estado), m = String((p && p.municipio) || "");
  if (/^(USA|US|EUA|EU|ESTADOS UNIDOS|UNITED STATES)/.test(t) || /,?\s+[A-Z]{2}$/.test(m.trim()) && !/^MEX/.test(t) || /^(TX|TEXAS|CA|AZ|NM|IL|MS|GA|FL|TN|OK|LA)$/.test(e)) return "US";
  return "MX";
};
const ESTADOS_EUA = { TX: "TEXAS", CA: "CALIFORNIA", AZ: "ARIZONA", NM: "NEW MEXICO", IL: "ILLINOIS", MS: "MISSISSIPPI", GA: "GEORGIA", FL: "FLORIDA", TN: "TENNESSEE", OK: "OKLAHOMA", LA: "LOUISIANA", MO: "MISSOURI", KS: "KANSAS", AR: "ARKANSAS", IN: "INDIANA", OH: "OHIO", MI: "MICHIGAN", WI: "WISCONSIN", MN: "MINNESOTA", IA: "IOWA", NE: "NEBRASKA", CO: "COLORADO", UT: "UTAH", NV: "NEVADA", WA: "WASHINGTON", OR: "OREGON", ID: "IDAHO", PA: "PENNSYLVANIA", NY: "NEW YORK", NJ: "NEW JERSEY", NC: "NORTH CAROLINA", SC: "SOUTH CAROLINA", VA: "VIRGINIA", KY: "KENTUCKY", AL: "ALABAMA" };
const quitaEstado = (t) => norm(t).replace(/^ESTADO DE /, "").replace(/ DE OCAMPO$| DE ZARAGOZA$| DE IGNACIO DE LA LLAVE$/, "");
function claveLugar(p) {
  const txt = lugarFactura(p);
  return { texto: txt, cp: String((p && p.cp) || "").replace(/\D/g, ""), pais: paisDe(p),
    id: (norm(txt) + "_" + paisDe(p)).replace(/[^A-Z0-9]+/g, "_").slice(0, 120) };
}
async function orsGet(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status === 403 || r.status === 401 ? "La clave de ORS no es válida (revisa Ajustes)." : `ORS respondió ${r.status}.`);
  const d = await r.json();
  return (d.features || []).map(x => ({ label: (x.properties && x.properties.label) || "", lng: x.geometry.coordinates[0], lat: x.geometry.coordinates[1], props: x.properties || {} }));
}
// ¿El resultado de ORS cae en el mismo municipio y estado que la factura?
function coincide(op, p) {
  const pr = op.props, mun = norm(String((p && p.municipio) || "").replace(/^\d+\s*-\s*/, "").replace(/,?\s+[A-Z]{2}$/, ""));
  const nombres = [pr.locality, pr.county, pr.localadmin, pr.name, pr.borough].map(norm).filter(Boolean);
  const munOk = mun && nombres.some(n => n === mun || n.includes(mun) || mun.includes(n));
  const est0 = quitaEstado(p && p.estado), est = ESTADOS_EUA[est0] || est0, reg = quitaEstado(pr.region), regA = norm(pr.region_a);
  const estOk = !est || (reg && (reg === est || reg.includes(est) || est.includes(reg))) || (regA && (regA === est || regA === est0)) ||
    (est === "MEXICO" && /MEXICO/.test(reg) && !/CIUDAD/.test(reg));
  return !!(munOk && estOk);
}
// Regresa { estado: "conocido"|"cp"|"revisar", label, lat, lng, candidatos, clave }.
export async function empatarLugar(p, orsKey) {
  const clave = claveLugar(p);
  const base = { clave, candidatos: [] };
  if (!clave.texto) return { ...base, estado: "revisar" };
  try {
    const s = await getDoc(doc(db, COL_LUGARES, clave.id));
    if (s.exists()) { const d = s.data(); return { ...base, estado: "conocido", label: d.label, lat: d.lat, lng: d.lng }; }
  } catch (e) { /* sin acceso al diccionario: seguimos con ORS */ }
  if (!orsKey) return { ...base, estado: "revisar" };
  const mun = String((p && p.municipio) || "").replace(/^\d+\s*-\s*/, "").replace(/,?\s+[A-Z]{2}$/, "").trim();
  let candidatos = [];
  try {
    const qs = new URLSearchParams({ api_key: orsKey, country: clave.pais === "US" ? "USA" : "MEX", size: "5", lang: "es" });
    if (clave.cp) qs.set("postalcode", clave.cp);
    if (mun) qs.set("locality", mun);
    if (p && p.estado) qs.set("region", p.estado);
    candidatos = await orsGet(`${ORS}/geocode/search/structured?${qs}`);
    const bueno = candidatos.find(op => coincide(op, p));
    if (bueno) return { ...base, estado: "cp", label: bueno.label, lat: bueno.lat, lng: bueno.lng, candidatos };
  } catch (e) { /* probamos texto libre */ }
  try {
    const extra = await orsGet(`${ORS}/geocode/search?api_key=${encodeURIComponent(orsKey)}&text=${encodeURIComponent(clave.texto)}&boundary.country=MX,US&size=5&lang=es`);
    const vistos = new Set(candidatos.map(x => x.label));
    candidatos = candidatos.concat(extra.filter(x => !vistos.has(x.label)));
  } catch (e) { /* sin candidatos */ }
  return { ...base, estado: "revisar", candidatos: candidatos.slice(0, 6) };
}
export async function recordarLugar(clave, op, por) {
  try {
    await setDoc(doc(db, COL_LUGARES, clave.id), {
      texto: clave.texto, cp: clave.cp || null, pais: clave.pais, label: op.label, lat: op.lat, lng: op.lng,
      actualizadoMs: Date.now(), por,
    });
  } catch (e) { console.warn("[factura] no se pudo recordar el lugar:", e.message); }
}

// ---- Ventana: elegir factura (subir PDF o buscar) y confirmar lugares ----------
// opciones: { esDueno, orsKey, por, tramo (texto opcional), alUsar({ f, origen, destino }) }
export function abrirCargaFactura(opciones) {
  const { esDueno, orsKey, por, alUsar } = opciones;
  const ov = document.createElement("div");
  ov.className = "modal-overlay";
  ov.style.zIndex = "10050";
  ov.innerHTML = `<div class="modal-tarjeta ca" style="max-width:760px;width:100%;max-height:92vh;overflow:auto;">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;"><h2 style="margin:0;font-size:18px;">Cargar factura${opciones.tramo ? ` · ${esc(opciones.tramo)}` : ""}</h2><button type="button" class="secundario co-mini" data-cf="cerrar">✕</button></div>
    <div id="cf-cuerpo" style="margin-top:10px;"></div><div class="error" id="cf-err"></div></div>`;
  document.body.appendChild(ov);
  const q = (s) => ov.querySelector(s);
  const err = (t) => { q("#cf-err").textContent = t || ""; };
  const cerrar = () => ov.remove();
  q('[data-cf="cerrar"]').addEventListener("click", cerrar);
  ov.addEventListener("click", (e) => { if (e.target === ov) cerrar(); });

  function inicio() {
    q("#cf-cuerpo").innerHTML = `
      <label class="cf-drop" style="display:block;border:2px dashed #cbbfb0;border-radius:12px;padding:20px;text-align:center;cursor:pointer;background:#FBFAF8;">
        <input type="file" accept="application/pdf,.pdf" id="cf-pdf" style="display:none;">
        <b>📄 Elegir el PDF de la factura</b><br><span class="nota">CFDI con Carta Porte (el formato de siempre).</span></label>
      ${esDueno ? `<div style="text-align:center;margin:10px 0 0;"><button type="button" class="secundario" id="cf-buscar">🔎 Buscar una factura ya cargada en Rentabilidad</button></div>` : ""}
      <p class="nota" style="margin:10px 0 0;">${esDueno ? "La factura también se guarda en Rentabilidad (si no estaba)." : "Se usa solo para llenar la calculadora; no se guarda."}</p>`;
    q("#cf-pdf").addEventListener("change", async (e) => {
      const a = e.target.files && e.target.files[0]; if (!a) return;
      err(); q("#cf-cuerpo").innerHTML = `<p class="nota">Leyendo ${esc(a.name)}…</p>`;
      try { await revisar(await leerFacturaPdf(a), false); } catch (x) { err(x.message || String(x)); inicio(); }
    });
    const b = q("#cf-buscar"); if (b) b.addEventListener("click", buscar);
  }

  // ---- Buscador (solo Ivan) ----
  let cache = null;
  async function buscar() {
    err();
    q("#cf-cuerpo").innerHTML = `<input type="search" id="cf-q" placeholder="Folio, cliente, origen o destino" style="width:100%;"><div id="cf-lista" style="margin-top:8px;"><p class="nota">Cargando facturas…</p></div>
      <div style="margin-top:8px;"><button type="button" class="co-link" id="cf-volver" style="font-size:13px;">← Subir un PDF</button></div>`;
    q("#cf-volver").addEventListener("click", inicio);
    try {
      if (!cache) cache = (await getDocs(query(collection(db, COL_FACTURAS), orderBy("fecha", "desc"), limit(300)))).docs.map(d => d.data());
    } catch (x) { q("#cf-lista").innerHTML = `<p class="error">No se pudieron leer las facturas: ${esc(x.message)}</p>`; return; }
    const pintarLista = () => {
      const t = norm(q("#cf-q").value);
      const xs = cache.filter(f => !t || norm([f.factura, f.cartaPorteFolio, (f.cliente || {}).nombre, f.origen, f.destino].join(" ")).includes(t)).slice(0, 40);
      q("#cf-lista").innerHTML = xs.length ? `<div class="tabla-wrap"><table class="tabla"><thead><tr><th>Fecha</th><th>Factura</th><th>Cliente</th><th>Ruta</th><th class="n">Km</th><th class="n">Flete</th></tr></thead><tbody>
        ${xs.map((f, i) => `<tr data-i="${cache.indexOf(f)}" style="cursor:pointer;"><td>${esc((f.fecha || "").slice(0, 10))}</td><td>${esc(f.factura)}</td><td>${esc((f.cliente || {}).nombre || "")}</td><td>${esc(f.ruta || "")}</td>
          <td class="n">${miles((f.calculos || {}).km)}</td><td class="n">${dinero((f.calculos || {}).flete, f.moneda)}</td></tr>`).join("")}</tbody></table></div>
        <p class="nota">Las 300 más recientes. Toca una para usarla.</p>` : `<p class="nota">Sin resultados.</p>`;
      q("#cf-lista").querySelectorAll("tr[data-i]").forEach(tr => tr.addEventListener("click", () => revisar(cache[Number(tr.dataset.i)], true)));
    };
    q("#cf-q").addEventListener("input", pintarLista);
    pintarLista();
  }

  // ---- Confirmar lugares y usar ----
  async function revisar(f, yaGuardada) {
    err();
    q("#cf-cuerpo").innerHTML = `<p class="nota">Buscando origen y destino…</p>`;
    const [o, d] = await Promise.all([empatarLugar(f.remitente, orsKey), empatarLugar(f.destinatario, orsKey)]);
    const sel = { origen: o.estado !== "revisar" ? o : null, destino: d.estado !== "revisar" ? d : null };
    const k = f.calculos || {};
    const chip = (e) => e === "conocido" ? `<span class="co-chip co-verde">Conocido</span>` : e === "cp" ? `<span class="co-chip" style="background:#E6F1FB;color:#185FA5;">Por CP</span>` : e === "elegido" ? `<span class="co-chip co-verde">Elegido</span>` : `<span class="co-chip" style="background:#FBE3A8;color:#7a3e06;">Revisar</span>`;
    const filaLugar = (tipo, r, p) => {
      const s = sel[tipo];
      const cps = (p && p.cp) ? ` · CP ${esc(p.cp)}` : "";
      return `<tr><td><b>${tipo === "origen" ? "Origen" : "Destino"}</b></td><td>${esc(r.clave.texto || "—")}<br><span class="nota">${tipo === "origen" ? "remitente" : "destinatario"}${cps}</span></td>
        <td>${s ? `${esc(s.label)}<br>${chip(s.estado)} <button type="button" class="co-link" data-cambiar="${tipo}" style="font-size:12px;">cambiar</button>`
          : `<div class="nota" style="margin-bottom:4px;">Elige el lugar correcto:</div>${(r.candidatos || []).map((op, i) => `<button type="button" class="secundario co-mini" data-op="${tipo}" data-i="${i}" style="display:block;margin:3px 0;text-align:left;">${esc(op.label)}</button>`).join("") || `<span class="nota">ORS no encontró candidatos.</span>`}
            <div style="display:flex;gap:6px;margin-top:6px;"><input type="text" data-libre="${tipo}" placeholder="Escribe otro (ciudad, estado)" style="flex:1;min-width:0;"><button type="button" class="secundario co-mini" data-buscarlibre="${tipo}">Buscar</button></div>`}</td></tr>`;
    };
    const pintar = () => {
      const listo = sel.origen && sel.destino && k.km;
      const rep = f.repartos && f.repartos.numero ? f.repartos : null;
      q("#cf-cuerpo").innerHTML = `
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;"><b>Factura ${esc(f.factura || "")}</b><span class="nota">${esc((f.cliente || {}).nombre || "")} · ${esc((f.fecha || "").slice(0, 10))}</span>
          ${yaGuardada ? `<span class="co-chip co-verde" style="margin-left:auto;">De Rentabilidad</span>` : ""}</div>
        <div class="tabla-wrap"><table class="tabla"><thead><tr><th></th><th>En la factura</th><th>Lugar para calcular (ORS)</th></tr></thead><tbody>
          ${filaLugar("origen", o, f.remitente)}${filaLugar("destino", d, f.destinatario)}</tbody></table></div>
        <div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:10px;font-size:13.5px;">
          <span>Km (Carta Porte): <b>${k.km ? miles(k.km) : "no viene en la factura"}</b></span>
          <span>Flete: <b>${dinero(k.flete, f.moneda)} ${esc(f.moneda || "MXN")}</b></span>
          ${f.moneda && f.moneda !== "MXN" ? `<span>TC: <b>${esc(f.tipoCambio)}</b></span>` : ""}
        </div>
        ${rep ? `<p class="nota">Con ${rep.numero} reparto(s): ${esc(rep.paradas.join(" → "))}. Se toma origen → destino final; los km de la factura ya incluyen el recorrido.</p>` : ""}
        ${!k.km ? `<p class="error">La factura no trae la Distancia Recorrida: no se puede usar.</p>` : ""}
        <div class="co-acciones"><button type="button" class="secundario" data-cf="otra">Otra factura</button><button type="button" id="cf-usar"${listo ? "" : " disabled"}>Usar en la calculadora</button></div>`;
      q('[data-cf="otra"]').addEventListener("click", inicio);
      ov.querySelectorAll("[data-cambiar]").forEach(b => b.addEventListener("click", () => { sel[b.dataset.cambiar] = null; pintar(); }));
      ov.querySelectorAll("[data-op]").forEach(b => b.addEventListener("click", () => {
        const r = b.dataset.op === "origen" ? o : d, op = r.candidatos[Number(b.dataset.i)];
        sel[b.dataset.op] = { ...op, estado: "elegido", clave: r.clave }; pintar();
      }));
      ov.querySelectorAll("[data-buscarlibre]").forEach(b => b.addEventListener("click", async () => {
        const tipo = b.dataset.buscarlibre, txt = q(`[data-libre="${tipo}"]`).value.trim(), r = tipo === "origen" ? o : d;
        if (!txt || !orsKey) return;
        try { r.candidatos = await orsGet(`${ORS}/geocode/search?api_key=${encodeURIComponent(orsKey)}&text=${encodeURIComponent(txt)}&boundary.country=MX,US&size=6&lang=es`); pintar(); }
        catch (x) { err(x.message); }
      }));
      const u = q("#cf-usar");
      if (u) u.addEventListener("click", async () => {
        u.disabled = true; u.textContent = "Usando…";
        await Promise.all(["origen", "destino"].map(t => sel[t].estado === "conocido" ? null : recordarLugar((t === "origen" ? o : d).clave, sel[t], por)));
        let estadoRent = yaGuardada ? "existente" : null;
        if (esDueno && !yaGuardada) {
          try { estadoRent = await guardarEnRentabilidad(f, por); } catch (x) { estadoRent = "error: " + x.message; }
        }
        cerrar();
        alUsar({ f, origen: { label: sel.origen.label, lat: sel.origen.lat, lng: sel.origen.lng }, destino: { label: sel.destino.label, lat: sel.destino.lat, lng: sel.destino.lng }, estadoRent });
      });
    };
    pintar();
  }
  inicio();
}

// Servicio probable: sale de la frontera (o de EUA) → Importación; llega a la frontera → Exportación.
export function servicioProbable(f) {
  const front = (p) => paisDe(p) === "US" || /NUEVO LAREDO|^LAREDO|COLOMBIA/.test(norm(String((p || {}).municipio || "").replace(/^\d+\s*-\s*/, "")));
  const o = front(f.remitente), d = front(f.destinatario);
  return o && !d ? "importacion" : !o && d ? "exportacion" : "nacional";
}