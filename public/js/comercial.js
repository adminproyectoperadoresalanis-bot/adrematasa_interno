// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/public/js/comercial.js
// ##########################################################################
import { db } from "./firebase-config.js";
import {
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, runTransaction, query, where, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";
import { LOGO_ALANIS } from "./comercialLogo.js";
import { tomarFiltro } from "./navegacion.js"; // 2026-10-31: el Panel abre Comercial ya filtrado

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
//
// 2026-10-30: umbrales como el CRM, por SERVICIO (expo / impo / nacional) y
// TRAMO (RC ≤ 350 km, RL ≥ 351), con verde y ámbar en MXN/km. Importe sugerido
// = km × umbral verde (en USD se divide entre el TC de la cotización). Se llena
// solo mientras no escribas un importe; si lo escribes, queda el tuyo y abajo
// aparece la sugerida con "usar".
//
// 2026-10-30: el PDF ya no muestra km (son internos). "Mi firma"
// (com_firmas/{uid}): cada quien define el puesto y teléfono con que firma sus
// cotizaciones, sin tocar el puesto del catálogo de usuarios (ese decide permisos).
// 2026-10-30: en BORRADOR se edita todo (cliente, moneda, vigencia, servicio,
// carga, rutas e importes). Desde ENVIADA queda bloqueada: solo se agregan rutas
// y se cambia el estado. La fecha de emisión es la de creación del folio.
// 2026-10-30: los ajustes (umbrales, TC, vigencia, clave de ORS y condiciones)
// se editan en Configuración → 2 · Utilidades → Comercial con
// iniciarAjustesComercial(); los datos siguen en com_config/ajustes.
// 2026-10-30: historial compacto (folio · fecha · vigencia · estado) y ENVÍO:
//   - Correo: la función enviarCotizacionComercial (functions/comercialCorreo.js)
//     lo manda por Brevo con el PDF adjunto, desde el correo de quien cotiza
//     (la clave de Brevo solo vive en la función). Pasa sola a ENVIADA.
//   - WhatsApp (solo celular): menú de compartir del teléfono con el PDF; al
//     compartir, pasa a ENVIADA. Cada envío queda en cot.envios.
// 2026-10-30: la misma pantalla se acomoda al celular (≤ 700 px): cada ruta es
// una tarjeta (origen/destino arriba, km e importe abajo, ingreso/km en color y
// borde de color). Sin recuadro de semáforo: el color va en cada ruta y al
// tocar/pasar el mouse dice el umbral aplicado.
// 2026-10-30: vigencia "Único evento" (vigenciaDias = 0): tarifa válida para un
// solo servicio; no tiene fecha de vencimiento (vencimientoMs = null) y nunca
// pasa a VENCIDA por fecha.
// 2026-11-02: CONDICIONES con casillas. En Configuración hay un catálogo
// ordenado (condicionesLista), el cruce por aduana (cruces: Nuevo Laredo y
// Colombia, NL, monto MXN y USD) y las demoras por lugar (Laredo TX, Patio,
// Origen, Destino, Aduana y Rojo). En cada cotización nueva salen todas
// marcadas; se desmarcan las que no aplican y se agregan las "solo para esta
// cotización" (reemplaza a "Notas para el cliente"). Se guardan como texto en
// cot.condicionesSel (el PDF de una cotización vieja no cambia si cambia el
// catálogo). Las de antes siguen usando ajustes.condiciones + cot.notas.
// CRUCE por ruta (Importación / Exportación): No aplica (por omisión),
// Incluido en el flete o Desglosado (total por viaje = flete + cruce). El
// ingreso por km cuenta solo el flete: si el cruce va incluido, se le resta.
// 2026-11-02b: "[moneda]" en una condición se vuelve "pesos mexicanos (MXN)" o
// "dólares americanos (USD)" (ya no se agrega el renglón de USD al final);
// impuestos en condición aparte; aduana "Nuevo Laredo, Tamps."; sin demora Rojo;
// en escritorio Km y Flete con ancho mínimo y Cruce con ancho máximo.
// 2026-11-02c: el cruce deja de ir por ruta. Es un dato de TODA la cotización
// (Importación / Exportación): "Incluye cruce" Sí/No y Aduana NLD/COL. Se
// cobra en la misma factura, pero solo aparece como condición automática:
// "No incluye cruce." / "Incluye cruce por la aduana Nuevo Laredo, Tamps.:
// $3,750.00 MXN." (monto de Configuración según la moneda). Se guarda en
// cot.cruce. El importe y el ingreso por km son solo flete. Las cotizaciones
// guardadas con cruce por ruta (versión 14) conservan su PDF; si siguen en
// borrador, al abrirlas el cruce pasa a la cotización.
// Condiciones en grupos plegables con interruptores; demoras en tabla corta.
// 2026-11-02d: demoras por día dicen "por día o fracción"; la demora en ADUANA
// solo sale si la cotización incluye cruce; en borrador las demoras se toman
// SIEMPRE de Configuración (se conserva qué estaba encendido). Ya enviada, no cambian.
// 2026-11-02e: botón "Calculadora" junto a "+ Nueva cotización" (abrirCalculadora):
// una ruta a la vez, mapa fijo, los tres servicios, "¿y si cobro…?", copiar
// resumen, guardar ruta en catálogo y convertir en cotización.
// 2026-11-02f: en la calculadora, el ing./km va en píldora bajo cada tarifa
// (verde bajo la sugerida, ámbar bajo la mínima); se quita la columna Verde / km.
// ============================================================================

const COL_CLI = "com_clientes";
const COL_COT = "com_cotizaciones";
const COL_RUT = "com_rutas";
const COL_CFG = "com_config";
const COL_CONT = "com_contadores";
const COL_FIR = "com_firmas";
const esCelular = () => /iphone|ipad|ipod|android|mobi/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const correoValido = (t) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(t || "").trim());
const URL_JSPDF = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
const URL_LEAFLET_JS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
const URL_LEAFLET_CSS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
const ORS = "https://api.openrouteservice.org";
const KM_RUTA_CORTA = 350; // como el CRM: RC = 350 km o menos; RL = 351 o más
const SERV_UMBRAL = { exportacion: "expo", importacion: "impo", nacional: "dom" };
const UMBRALES_BASE = { // valores del CRM (nacional = importación hasta que se ajuste)
  expo_rc_verde: 100, expo_rc_ambar: 80, expo_rl_verde: 45, expo_rl_ambar: 40,
  impo_rc_verde: 100, impo_rc_ambar: 80, impo_rl_verde: 35, impo_rl_ambar: 33,
  dom_rc_verde: 100, dom_rc_ambar: 80, dom_rl_verde: 35, dom_rl_ambar: 33,
};
export function umbralDe(ajustes, servicio, km) {
  const s = SERV_UMBRAL[servicio] || "dom", t = km && km <= KM_RUTA_CORTA ? "rc" : "rl";
  const u = { ...UMBRALES_BASE, ...((ajustes && ajustes.umbrales) || {}) };
  return { verde: Number(u[`${s}_${t}_verde`]) || 0, ambar: Number(u[`${s}_${t}_ambar`]) || 0, tramo: t.toUpperCase() };
}
const tipoRutaTxt = (km) => km ? (km <= KM_RUTA_CORTA ? "RC" : "RL") : "";

const AJUSTES_BASE = {
  umbrales: { ...UMBRALES_BASE }, tipoCambio: 18.5, vigenciaDias: 30, orsKey: "",
  // Texto viejo (antes del 2026-11-02). Solo lo usan las cotizaciones hechas antes del catálogo.
  condiciones: "Precios más IVA, menos retención del 4%.\nTarifa por viaje sencillo.\nNo incluye maniobras, estadías ni seguro de la mercancía.",
};
// ---- 2026-11-02: catálogo de condiciones, cruce por aduana y demoras ----------
const CONDICIONES_BASE = [
  "Importes expresados en [moneda].",
  "No incluyen impuestos ni retenciones.",
  "El IVA se calculará aunque la razón social a facturar tenga domicilio fiscal en el extranjero.",
  "Tarifa por viaje sencillo.",
  "No incluye maniobras de carga ni descarga; en caso de requerirse deberán cobrarse por separado.",
  "No incluye seguro de la mercancía.",
];
const CRUCES_BASE = [
  { id: "nuevo_laredo", corto: "NLD", nombre: "Nuevo Laredo, Tamps.", mxn: 700, usd: 38 },
  { id: "colombia", corto: "COL", nombre: "Colombia, NL", mxn: 850, usd: 46 },
];
// frase: cómo se lee en la condición ("Demoras en destino: …").
const DEMORAS_BASE = [
  { id: "laredo_tx", lugar: "Laredo TX", frase: "en Laredo TX", libre: 24, cargo: 150, por: "dia", moneda: "USD" },
  { id: "patio", lugar: "Patio", frase: "en patio", libre: 48, cargo: 2500, por: "dia", moneda: "MXN" },
  { id: "origen", lugar: "Origen", frase: "en origen", libre: 4, cargo: 400, por: "hora", moneda: "MXN" },
  { id: "destino", lugar: "Destino", frase: "en destino", libre: 4, cargo: 400, por: "hora", moneda: "MXN" },
  { id: "aduana", lugar: "Aduana", frase: "en aduana", libre: 24, cargo: 3000, por: "dia", moneda: "MXN" },
];
const MODOS_CRUCE = { no: "No aplica", incluido: "Incluido", desglosado: "Desglosado" };
// Lo guardado en com_config/ajustes, completado con lo de fábrica.
// 2026-11-02b: el renglón viejo "…moneda indicada. No incluyen impuestos…" se parte en dos.
const COND_VIEJA = "Importes expresados en la moneda indicada. No incluyen impuestos ni retenciones.";
function catalogoCondiciones(aj) {
  const l = Array.isArray(aj.condicionesLista) ? aj.condicionesLista : null;
  return (l || CONDICIONES_BASE.map((texto, k) => ({ id: "c" + (k + 1), texto })))
    .flatMap(c => c && String(c.texto || "").trim() === COND_VIEJA ? [{ id: c.id, texto: CONDICIONES_BASE[0] }, { id: c.id + "b", texto: CONDICIONES_BASE[1] }] : [c])
    .filter(c => c && String(c.texto || "").trim());
}
// [moneda] en una condición: "pesos mexicanos (MXN)" o "dólares americanos (USD)", según la cotización.
const MARCA_MONEDA = "[moneda]";
const textoMoneda = (moneda) => moneda === "USD" ? "dólares americanos (USD)" : "pesos mexicanos (MXN)";
const conMoneda = (texto, moneda) => String(texto || "").split(MARCA_MONEDA).join(textoMoneda(moneda));
function crucesDe(aj) {
  const g = Array.isArray(aj.cruces) ? aj.cruces : [];
  return CRUCES_BASE.map(b => ({ ...b, ...(g.find(x => x && x.id === b.id) || {}), nombre: b.nombre, corto: b.corto }));
}
function demorasDe(aj) {
  const g = Array.isArray(aj.demoras) ? aj.demoras : [];
  return DEMORAS_BASE.map(b => { const x = g.find(d => d && d.id === b.id) || {}; return { ...b, ...x, lugar: b.lugar, frase: b.frase }; });
}
const textoDemora = (d) => {
  const cargo = d.moneda === "USD" ? `${dinero(Number(d.cargo), "USD")}` : `${dinero(Number(d.cargo))} MXN`;
  return `Demoras ${d.frase}: ${miles(d.libre)} h libres; después ${cargo} por ${d.por === "hora" ? "hora" : "día o fracción"}.`;
};
// Demoras de Configuración como condiciones. previas: las que ya tenía la cotización
// (se respeta si estaban apagadas; se reconocen por id o por el inicio del texto).
function demorasComoCondiciones(ajustes, previas = []) {
  return demorasDe(ajustes).map(d => {
    const antes = previas.find(x => x.tipo === "demora" && (x.id === d.id || String(x.texto).startsWith(`Demoras ${d.frase}:`)));
    return { id: d.id, texto: textoDemora(d), tipo: "demora", on: antes ? antes.on !== false : true };
  });
}
// En borrador: catálogo y propias como estaban; demoras al día con Configuración.
function refrescarDemoras(conds, ajustes) {
  const dem = demorasComoCondiciones(ajustes, conds);
  const i = conds.findIndex(x => x.tipo === "demora");
  const resto = conds.filter(x => x.tipo !== "demora");
  const pos = i >= 0 ? conds.slice(0, i).filter(x => x.tipo !== "demora").length : resto.filter(x => x.tipo === "cat").length;
  return [...resto.slice(0, pos), ...dem, ...resto.slice(pos)];
}
// La demora en aduana solo aplica cuando la cotización incluye cruce.
const demoraAplica = (c, incluyeCruce) => !(c.tipo === "demora" && (c.id === "aduana" || /^Demoras en aduana:/.test(c.texto)) && !incluyeCruce);
// Condición automática del cruce de la cotización (null = no lleva: Nacional o cotización vieja).
// cruce: { incluye, aduana, aduanaNombre, monto } guardado en la cotización.
function textoCruce(cot) {
  if (!conCruce(cot.tipoServicio) || cot.cruce === undefined) return null;
  const c = cot.cruce;
  if (!c || !c.incluye) return "No incluye cruce.";
  const monto = cot.moneda === "USD" ? dinero(num(c.monto), "USD") : `${dinero(num(c.monto))} MXN`;
  return `Incluye cruce por la aduana ${c.aduanaNombre}: ${monto}.`;
}
// Cruce de una ruta (versión 14; solo cotizaciones guardadas así).
const conCruce = (servicio) => servicio === "importacion" || servicio === "exportacion";
const cruceDe = (r, servicio) => {
  const c = r && r.cruce;
  if (!conCruce(servicio) || !c || !MODOS_CRUCE[c.modo] || c.modo === "no") return null;
  return { modo: c.modo, aduana: c.aduana || "", aduanaNombre: c.aduanaNombre || "", monto: num(c.monto) };
};
// Total por viaje: flete + cruce cuando va desglosado.
const totalViaje = (r, servicio) => {
  const imp = num(r.importe), c = cruceDe(r, servicio);
  if (imp == null) return null;
  return c && c.modo === "desglosado" ? imp + (c.monto || 0) : imp;
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
const UNICO_EVENTO = 0; // vigenciaDias = 0: tarifa para un solo servicio, sin fecha de vencimiento
const VIGENCIAS = [15, 30, 60, 90, 180, 365, UNICO_EVENTO];
const textoVigencia = (d) => Number(d) === UNICO_EVENTO ? "Único evento" : Number(d) === 365 ? "1 año" : `${d} días`;
const opcionesVigencia = (actual) => { const n = Number(actual); return VIGENCIAS.includes(n) || !isFinite(n) ? VIGENCIAS : [...VIGENCIAS.slice(0, -1), n, UNICO_EVENTO].sort((a, b) => (a || 1e9) - (b || 1e9)); };
const venceEn = (desdeMs, dias) => Number(dias) > 0 ? desdeMs + Number(dias) * DIA : null;
const textoVence = (c) => !c.vencimientoMs ? "Único evento" : (estadoDe(c) === "vencida" ? `venció ${fecha(c.vencimientoMs)}` : `hasta ${fecha(c.vencimientoMs)}`);
const sigueVigente = (c, ahora) => !c.vencimientoMs || c.vencimientoMs >= ahora;

// ---- Utilerías ----------------------------------------------------------------
function esc(t) { const d = document.createElement("div"); d.textContent = t == null ? "" : String(t); return d.innerHTML; }
const pad = (n, l = 2) => String(n).padStart(l, "0");
const fechaHoraTxt = (ms) => { if (!ms) return "—"; const d = new Date(ms); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
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
// Ingreso por km en MXN de una ruta: solo el FLETE. Si el cruce va incluido en
// el importe, se le resta antes (2026-11-02, opción A). servicio: el de la cotización.
export function ingresoKm(ruta, moneda, tc, servicio) {
  const km = num(ruta.km), imp = num(ruta.importe);
  if (!km || imp == null) return null;
  const c = cruceDe(ruta, servicio);
  const flete = imp - (c && c.modo === "incluido" ? (c.monto || 0) : 0);
  return (moneda === "USD" ? flete * (num(tc) || 0) : flete) / km;
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
    .co-ing { font-weight:800; white-space:nowrap; cursor:help; background:none !important; display:inline; width:auto; height:auto; }
    .co-rutas select { width:100%; min-width:0; }
    .co-rutas .co-c-km { min-width:80px; } .co-rutas .co-c-im { min-width:120px; }
    .co-rutas .co-c-cr { width:170px; max-width:170px; }
    .co-conds { border:1px solid #e2ddd5; border-radius:12px; overflow:hidden; background:#fff; }
    .co-g { border-top:1px solid #e2ddd5; } .co-g:first-child { border-top:0; }
    .co-g-h { display:flex; align-items:center; gap:10px; padding:10px 14px; background:#fbfaf8; cursor:pointer; user-select:none; font-size:13.5px; }
    .co-g-f { color:#6b5f52; font-size:10px; width:12px; } .co-g-n { margin-left:auto; font-size:12px; color:#6b5f52; }
    .co-cf { display:flex; align-items:center; gap:12px; padding:8px 14px; border-top:1px solid #f0ece6; font-size:13px; line-height:1.4; }
    .co-cf-t { flex:1; } .co-cf.off .co-cf-t, .co-dem tr.off td { color:#a69c90; }
    .co-cf input[type=text] { flex:1; min-width:0; width:auto; padding:6px 9px; font-size:13px; }
    .co-dem { width:100%; border-collapse:collapse; font-size:13px; }
    .co-dem th, .co-dem td { padding:7px 14px; border-top:1px solid #f0ece6; text-align:left; background:#fff; }
    .co-dem th { font-size:10.5px; color:#6b5f52; text-transform:uppercase; font-weight:700; }
    .co-dem td:last-child, .co-dem th:last-child { width:50px; text-align:right; }
    .co-conds button.co-sw { all:unset; box-sizing:border-box; flex:none; display:inline-block; width:34px; height:20px; border-radius:10px; background:#cfc8bf; position:relative; cursor:pointer; transition:background .15s; }
    .co-conds button.co-sw::after { content:""; position:absolute; top:2px; left:2px; width:16px; height:16px; border-radius:50%; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.25); transition:left .15s; }
    .co-conds button.co-sw.on { background:#3B7A1E; } .co-conds button.co-sw.on::after { left:16px; }
    .co-conds button.co-sw:focus-visible { outline:2px solid #185FA5; outline-offset:2px; }
    .co-conds button.co-x { all:unset; cursor:pointer; color:#A32D2D; font-size:14px; padding:0 2px; }
    .ca-g2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    .ca-g4 { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; align-items:start; }
    .ca label { font-size:11.5px; color:#6b5f52; display:block; margin-bottom:4px; font-weight:600; }
    .ca-mapa { height:260px; margin-top:6px; }
    .ca-res { border:1px solid #e2ddd5; border-radius:12px; overflow:hidden; margin-top:14px; }
    .ca-res table { width:100%; border-collapse:collapse; font-size:13.5px; }
    .ca-res th { text-align:left; font-size:10.5px; color:#6b5f52; text-transform:uppercase; padding:8px 12px; background:#fbfaf8; border-bottom:1px solid #e2ddd5; }
    .ca-res td { padding:9px 12px; border-top:1px solid #f0ece6; cursor:pointer; }
    .ca-res th.n, .ca-res td.n { text-align:right; white-space:nowrap; }
    .ca-res td.ca-v { color:#3B7A1E; } .ca-res td.ca-a { color:#B7790B; }
    .ca-res tr.sel td { background:#FFF8EC; } .ca-big { font-size:18px; }
    .ca-res td { vertical-align:top; }
    .ca-pill { display:inline-block; font-size:11px; font-weight:700; padding:1px 8px; border-radius:10px; margin-top:3px; white-space:nowrap; }
    .ca-pv { background:#EAF3DE; color:#3B7A1E; } .ca-pa { background:#FBEFD2; color:#8a5a06; }
    .ca-tramo { font-size:9.5px; font-weight:800; padding:1px 6px; border-radius:8px; background:#F2EDE6; color:#4a3e33; }
    .ca-prueba { display:flex; gap:14px; align-items:flex-start; flex-wrap:wrap; margin-top:14px; padding:12px 14px; border-radius:12px; background:#fbfaf8; border:1px solid #e2ddd5; }
    .ca-barra { height:10px; border-radius:6px; position:relative; }
    .ca-barra i { position:absolute; top:-5px; width:4px; height:20px; border-radius:2px; background:#2C1E0F; }
    .ca-sem { font-size:10px; font-weight:800; padding:2px 7px; border-radius:9px; }
    .ca-sem.co-s-v { background:#EAF3DE; color:#3B7A1E; } .ca-sem.co-s-a { background:#FBE3A8; color:#7a3e06; } .ca-sem.co-s-r { background:#FBE4E1; color:#A32D2D; }
    .co-auto { font-size:10px; font-weight:800; padding:2px 7px; border-radius:9px; background:#EAF1FB; color:#185FA5; }
    .co-conds-ro { border:1px solid #e2ddd5; border-radius:12px; padding:10px 14px; background:#fbfaf8; font-size:13px; line-height:1.6; }
    .co-ing.co-s-v { color:#3B7A1E; } .co-ing.co-s-a { color:#B7790B; } .co-ing.co-s-r { color:#B83227; } .co-ing.co-s-n { color:#8a7f73; }
    @media (max-width:700px) {
      .co-contacto { grid-template-columns:1fr 1fr; } .co-campos { grid-template-columns:1fr; }
      .co-grid { grid-template-columns:1fr !important; }
      /* Rutas: cada renglón es una tarjeta */
      .co-rutas thead { display:none; }
      .co-rutas, .co-rutas tbody { display:block; width:100%; }
      .co-rutas tr.co-fila { position:relative; display:grid; grid-template-columns:1fr 1.3fr; gap:8px 10px; border:1px solid #e2ddd5; border-left:5px solid #cfc8bf; border-radius:12px; padding:10px 12px; margin-bottom:10px; background:#fff; }
      .co-rutas tr.co-fila.co-f-v { border-left-color:#3B7A1E; } .co-rutas tr.co-fila.co-f-a { border-left-color:#D99A1E; } .co-rutas tr.co-fila.co-f-r { border-left-color:#B83227; }
      .co-rutas td { display:block; border:0 !important; padding:0 !important; text-align:left !important; }
      .co-rutas td::before { content:attr(data-et); display:block; font-size:10.5px; font-weight:700; color:#6b5f52; text-transform:uppercase; letter-spacing:.3px; margin-bottom:3px; }
      .co-rutas .co-c-or, .co-rutas .co-c-de, .co-rutas .co-c-ing, .co-rutas .co-c-cr { grid-column:1 / -1; }
      .co-rutas select { font-size:16px; padding:9px 10px; }
      .co-rutas .co-c-km, .co-rutas .co-c-im, .co-rutas .co-c-cr { min-width:0; width:auto; max-width:none; }
      .co-cf input[type=text] { font-size:16px; }
      .ca-g2 { grid-template-columns:1fr; } .ca-g4 { grid-template-columns:1fr 1fr; }
      .ca input { font-size:16px; } .ca-res th, .ca-res td { padding:8px 6px; font-size:12.5px; }
      .ca-pill { font-size:10.5px; padding:1px 6px; } .ca-res th.n, .ca-res td.n { white-space:normal; } .ca-big { font-size:15px; }
      .ca-mapa { height:220px; }
      .co-dem th, .co-dem td { padding:7px 10px; }
      .co-rutas .co-c-or { padding-right:40px !important; }
      .co-rutas .co-c-ing { display:flex; justify-content:space-between; align-items:center; border-top:1px solid #f0ece6 !important; padding-top:8px !important; }
      .co-rutas .co-c-ing::before { margin:0; }
      .co-rutas .co-c-x { position:absolute; top:8px; right:8px; }
      .co-rutas .co-c-x::before { content:none; }
      .co-rutas input { font-size:16px; padding:9px 10px; }
      .co-seg-estado { display:grid; grid-template-columns:1fr 1fr; width:100%; }
      .co-seg-estado button { border-left:0; border-top:1px solid #e2ddd5; padding:10px; }
      /* Botones: enviar arriba y grandes; PDF · Duplicar · Guardar abajo */
      .co-acciones { display:flex; flex-wrap:wrap; gap:8px; }
      .co-acciones button { flex:1 1 30%; padding:11px 6px; }
      #co-e-correo { order:1; flex-basis:100%; } #co-e-wa { order:2; flex-basis:100%; }
      #co-e-pdf { order:3; } #co-e-dup { order:4; } #co-e-guardar { order:5; } #co-e-guardar-pdf { order:6; flex-basis:100%; }
      .modal-tarjeta { padding:16px !important; }
    }
  `;
  document.head.appendChild(s);
}

// Condiciones de una cotización: [{ texto, tipo: "cat" | "demora" | "propia", on }].
// Las nuevas guardan condicionesSel; las de antes del 2026-11-02 usan el texto
// viejo de Ajustes + sus notas (así su PDF no cambia).
export function condicionesDeCot(cot, ajustes) {
  if (Array.isArray(cot.condicionesSel)) return cot.condicionesSel.map(c => ({ ...c, texto: String(c.texto || ""), tipo: c.tipo || "propia", on: c.on !== false })).filter(c => c.texto.trim());
  const lineas = (s) => String(s || "").split(/\n+/).map(x => x.trim()).filter(Boolean);
  return [...lineas(ajustes.condiciones).map(texto => ({ texto, tipo: "cat", on: true })), ...lineas(cot.notas).map(texto => ({ texto, tipo: "propia", on: true }))];
}
// Condiciones de una cotización nueva: catálogo + demoras, todas marcadas.
function condicionesNuevas(ajustes) {
  return [...catalogoCondiciones(ajustes).map(c => ({ texto: c.texto, tipo: "cat", on: true })),
    ...demorasComoCondiciones(ajustes)];
}

// ---- PDF ----------------------------------------------------------------------
// Una hoja carta (o más si hay muchas rutas): logo, folio, cliente, tabla de
// rutas, condiciones y firma de quien cotizó. Sin ingreso/km (es interno).
// firma: { nombre, puesto, telefono, correo } de quien hizo la cotización (Mi firma);
// si no la ha definido, se usa lo guardado en la cotización.
// opciones.descargar === false: no descarga, solo regresa el archivo.
export async function generarPdf(cot, cliente, ajustes, firma, opciones = {}) {
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
  // Tabla. Si alguna ruta lleva cruce: Flete · Cruce · Total por viaje.
  const hayCruce = (cot.rutas || []).some(r => cruceDe(r, cot.tipoServicio));
  const anchoO = hayCruce ? 48 : 68, anchoD = hayCruce ? 46 : 66;
  const cols = hayCruce
    ? [{ t: "Origen", x: X0 + 2 }, { t: "Destino", x: X0 + 52 }, { t: "Flete", x: X0 + 124, d: true }, { t: "Cruce", x: X0 + 128 }, { t: "Total por viaje", x: X1 - 2, d: true }]
    : [{ t: "Origen", x: X0 + 2 }, { t: "Destino", x: X0 + 74 }, { t: "Tarifa por viaje", x: X1 - 2, d: true }];
  const cabecera = () => {
    pdf.setFillColor(245, 239, 230); pdf.rect(X0, y - 4.5, X1 - X0, 7, "F");
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(8.8); pdf.setTextColor(...CAFE);
    cols.forEach(c => pdf.text(c.t, c.x, y, c.d ? { align: "right" } : undefined));
    y += 7; pdf.setFont("helvetica", "normal"); pdf.setTextColor(40, 34, 28);
  };
  cabecera();
  (cot.rutas || []).forEach(r => {
    const o = pdf.splitTextToSize(r.origen || "", anchoO), d = pdf.splitTextToSize(r.destino || "", anchoD);
    const nueva = r.agregadaMs && cot.emisionMs && r.agregadaMs - cot.emisionMs > DIA / 2;
    const alto = Math.max(o.length, d.length, hayCruce && cruceDe(r, cot.tipoServicio) ? 2 : 1) * 4.4 + (nueva ? 3.6 : 0) + 2.6;
    if (y + alto > 238) { pdf.addPage(); y = 20; cabecera(); }
    pdf.setFontSize(9.2);
    o.forEach((l, i) => pdf.text(l, cols[0].x, y + i * 4.4));
    d.forEach((l, i) => pdf.text(l, cols[1].x, y + i * 4.4));
    if (hayCruce) {
      const c = cruceDe(r, cot.tipoServicio);
      pdf.text(dinero(num(r.importe), cot.moneda), cols[2].x, y, { align: "right" });
      if (c) {
        pdf.text(c.modo === "incluido" ? "Incluido" : dinero(c.monto, cot.moneda), cols[3].x, y);
        if (c.aduanaNombre) { pdf.setFontSize(7.5); pdf.setTextColor(...GRIS); pdf.text(c.aduanaNombre, cols[3].x, y + 3.8); pdf.setTextColor(40, 34, 28); pdf.setFontSize(9.2); }
      } else pdf.text("—", cols[3].x, y);
      pdf.setFont("helvetica", "bold");
      pdf.text(`${dinero(totalViaje(r, cot.tipoServicio), cot.moneda)} ${cot.moneda}`, cols[4].x, y, { align: "right" });
    } else {
      pdf.setFont("helvetica", "bold");
      pdf.text(`${dinero(num(r.importe), cot.moneda)} ${cot.moneda}`, cols[2].x, y, { align: "right" });
    }
    pdf.setFont("helvetica", "normal");
    if (nueva) { pdf.setFontSize(7.5); pdf.setTextColor(...GRIS); pdf.text(`Ruta agregada el ${fecha(r.agregadaMs)}`, cols[0].x, y + Math.max(o.length, d.length) * 4.4); pdf.setTextColor(40, 34, 28); }
    y += alto;
    pdf.setDrawColor(230, 224, 216); pdf.setLineWidth(0.2); pdf.line(X0, y - 3.6, X1, y - 3.6);
  });
  // Condiciones
  y += 4;
  const marcadas = condicionesDeCot(cot, ajustes).filter(c => c.on);
  const condiciones = marcadas.map(c => conMoneda(c.texto, cot.moneda));
  const tCruce = textoCruce(cot);
  if (tCruce) condiciones.splice(marcadas.filter(c => c.tipo === "cat").length, 0, tCruce); // después del catálogo
  condiciones.push(cot.vencimientoMs ? `Vigencia: ${textoVigencia(cot.vigenciaDias)} (hasta el ${fechaLarga(cot.vencimientoMs)}).` : "Vigencia: único evento (tarifa válida para un solo servicio).");
  // Solo si ninguna condición ya dice la moneda (las de antes del catálogo).
  if (cot.moneda === "USD" && !marcadas.some(c => c.texto.includes(MARCA_MONEDA))) condiciones.push("Importes en dólares americanos (USD).");
  if (y + 10 + condiciones.length * 5 > 250) { pdf.addPage(); y = 20; }
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(9.5); pdf.setTextColor(...CAFE); pdf.text("Condiciones", X0, y); y += 5.5;
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(40, 34, 28);
  condiciones.forEach(t => pdf.splitTextToSize("•  " + t, X1 - X0 - 4).forEach((l, i) => { pdf.text(i ? "   " + l : l, X0 + 1, y); y += 4.6; }));
  // Firma
  if (y + 30 > 262) { pdf.addPage(); y = 20; }
  y += 8;
  pdf.text("Quedo a sus órdenes.", X0, y); y += 10;
  const f = { ...(cot.creadoPor || {}), ...Object.fromEntries(Object.entries(firma || {}).filter(([, v]) => v)) };
  pdf.setFont("helvetica", "bold"); pdf.setTextColor(...CAFE); pdf.text(f.nombre || "", X0, y); y += 4.8;
  pdf.setFont("helvetica", "normal"); pdf.setTextColor(40, 34, 28);
  [f.puesto, "Autotransportes Alanis", [f.correo, f.telefono].filter(Boolean).join(" · ")].filter(Boolean).forEach(t => { pdf.text(t, X0, y); y += 4.6; });
  // Pie
  const paginas = pdf.getNumberOfPages();
  for (let p = 1; p <= paginas; p++) {
    pdf.setPage(p); pdf.setFontSize(7.5); pdf.setTextColor(...GRIS);
    pdf.text("Autotransportes Alanis · Carretera Aeropuerto Km 2.75, Col. América 4, Nuevo Laredo, Tamps., C.P. 88299 · (867) 711 6565", 108, 272, { align: "center" });
    if (paginas > 1) pdf.text(`${p} / ${paginas}`, X1, 272, { align: "right" });
  }
  const nombre = `${cot.folio || "cotizacion"}.pdf`;
  if (opciones.descargar !== false) pdf.save(nombre);
  return { nombre, blob: pdf.output("blob"), base64: pdf.output("datauristring").split(",")[1] };
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
        <div style="display:flex;gap:6px;flex-wrap:wrap;"><button type="button" class="secundario" id="co-firma">Mi firma</button><button type="button" class="secundario" id="co-calc">Calculadora</button><button type="button" id="co-nueva">+ Nueva cotización</button></div>
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
  const desdePanel = tomarFiltro("comercial");  // { tab, estado } si se abrió desde el Panel
  if (desdePanel) { if (desdePanel.tab) tab = desdePanel.tab; if (desdePanel.estado != null) fq.estado = desdePanel.estado; }

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
  let firmas = new Map(); // uid → { puesto, telefono }
  cancelar.push(onSnapshot(collection(db, COL_FIR), (s) => { firmas = new Map(s.docs.map(d => [d.id, d.data()])); }, () => {}));
  const firmaDe = (uidCreador) => firmas.get(uidCreador) || null;
  cancelar.push(onSnapshot(doc(db, COL_CFG, "ajustes"), (s) => { ajustes = { ...AJUSTES_BASE, ...(s.exists() ? s.data() : {}) }; }, () => {}));
  const vigilar = setInterval(() => { if (!contenedor.isConnected) { clearInterval(vigilar); cancelar.forEach(c => c()); } }, 3000);

  const listaCot = () => [...(cotizaciones || new Map()).values()].sort((a, b) => (b.emisionMs || 0) - (a.emisionMs || 0));
  const cotDeCliente = (id) => listaCot().filter(c => c.clienteId === id);
  const semaforo = (v, servicio, km) => {
    if (v == null) return "co-s-n";
    const u = umbralDe(ajustes, servicio, num(km));
    return v >= u.verde ? "co-s-v" : v >= u.ambar ? "co-s-a" : "co-s-r";
  };
  // Celda de ingreso/km: número en color y el umbral aplicado (title).
  const celdaIng = (v, servicio, km) => {
    const cls = semaforo(v, servicio, km), u = umbralDe(ajustes, servicio, num(km));
    const tit = num(km) ? `${u.tramo} ${SERVICIOS[servicio] || ""}: verde ${u.verde} o más, ámbar ${u.ambar} o más` : "";
    return `<span class="co-ing ${cls}" title="${esc(tit)}">${v == null ? "—" : dinero(v)}</span>`;
  };
  // Importe sugerido = km × umbral verde (MXN); en USD, entre el TC.
  const sugerida = (servicio, km, moneda, tc) => {
    const k = num(km); if (!k) return null;
    const u = umbralDe(ajustes, servicio, k); if (!u.verde) return null;
    const mxn = k * u.verde;
    return Math.round((moneda === "USD" ? mxn / (num(tc) || 1) : mxn) * 100) / 100;
  };
  const chipEstado = (c) => { const e = estadoDe(c); return `<span class="co-chip ${ESTADOS[e].clase}">${ESTADOS[e].txt}</span>`; };
  const chipCarga = (t) => t ? `<span class="co-chip ${t === "seca" ? "co-seca" : "co-refri"}">${esc((CARGAS[t] || t).toUpperCase())}</span>` : "";

  function renderTabs() {
    const ts = [["clientes", "Clientes"], ["cotizaciones", "Cotizaciones"], ["rutas", "Rutas"]];
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
    return renderClientes();
  }
  // ---- Calculadora (2026-11-02): tarifa de una ruta sin cliente ni cotización ----
  // Misma lógica que el editor: catálogo, km de camión por ORS, mapa con puntos vía,
  // tramo RC/RL y umbrales de Configuración. Muestra Nacional, Importación y
  // Exportación a la vez. No guarda nada (salvo "Guardar ruta en catálogo").
  // El último cálculo se conserva mientras la página siga abierta.
  let calc = null;
  function abrirCalculadora() {
    if (!calc) calc = { origen: "", destino: "", km: "", vias: [], servicio: "importacion", moneda: "MXN", tc: ajustes.tipoCambio, carga: "refrigerada", cruceSi: "no", aduana: CRUCES_BASE[0].id, prueba: "" };
    const c = calc, celular = window.innerWidth <= 700;
    let linea = null, mapa = null, capa = null;
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    const lugares = [...new Set([...rutas.values()].flatMap(r => [r.origen, r.destino]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    ov.innerHTML = `<div class="modal-tarjeta ca" style="max-width:860px;width:100%;max-height:94vh;overflow:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;"><h2 style="margin:0;font-size:18px;">Calculadora</h2><button type="button" class="secundario co-mini" data-cerrar>✕</button></div>
      <p class="nota" style="margin:4px 0 12px;">Tarifa de una ruta con los umbrales de Configuración. No pide cliente ni guarda cotización.</p>
      ${ajustes.orsKey ? "" : `<datalist id="ca-lugares">${lugares.map(l => `<option value="${esc(l)}">`).join("")}</datalist>`}
      <div class="ca-g2">
        <div><label>Origen</label><div class="co-ac"><input type="text" id="ca-or" list="ca-lugares" value="${esc(c.origen)}" placeholder="${ajustes.orsKey ? "Escribe la ciudad…" : "Ciudad, estado"}" autocomplete="off"></div></div>
        <div><label>Destino</label><div class="co-ac"><input type="text" id="ca-de" list="ca-lugares" value="${esc(c.destino)}" placeholder="${ajustes.orsKey ? "Escribe la ciudad…" : "Ciudad, estado"}" autocomplete="off"></div></div>
      </div>
      <div class="nota" id="ca-hint" style="margin-top:6px;min-height:16px;"></div>
      ${celular ? `<details id="ca-det"><summary class="co-link" style="font-size:13px;margin:4px 0;">Ver mapa</summary>` : ""}
      <div class="co-mapa ca-mapa" id="ca-mapa"><p class="nota" style="padding:12px;">El mapa aparece cuando hay origen y destino.</p></div>
      <div id="ca-vias" style="margin-top:6px;"></div>
      ${ajustes.orsKey ? `<div class="co-ac" style="margin-top:6px;"><input type="text" id="ca-via" placeholder="Agregar punto vía (ciudad intermedia)…" autocomplete="off"></div>` : ""}
      ${celular ? `</details>` : ""}
      <div class="ca-g4" style="margin-top:12px;">
        <div><label>Km (camión)</label><input type="number" min="1" id="ca-km" value="${esc(c.km)}"><small class="nota" id="ca-tramo"></small></div>
        <div><label>Moneda</label><span class="co-seg" id="ca-mon"></span></div>
        <div id="ca-tc-caja"><label>Tipo de cambio</label><input type="number" step="0.01" id="ca-tc" value="${esc(c.tc)}"></div>
        <div><label>Tipo de carga</label><span class="co-seg" id="ca-carga"></span></div>
      </div>
      <div class="ca-res" id="ca-res"></div>
      <div id="ca-cruce" style="margin-top:10px;"></div>
      <div class="ca-prueba">
        <div style="min-width:190px;"><label>¿Y si cobro…? (flete)</label><input type="number" min="0" step="0.01" id="ca-prueba" value="${esc(c.prueba)}" placeholder="Importe"></div>
        <div id="ca-prueba-res" style="flex:1;min-width:220px;"></div>
      </div>
      <div class="error" id="ca-err"></div>
      <div class="co-acciones">
        <button type="button" class="secundario" id="ca-copiar">Copiar resumen</button>
        <button type="button" class="secundario" id="ca-cat">Guardar ruta en catálogo</button>
        <button type="button" id="ca-conv">Convertir en cotización →</button>
      </div></div>`;
    document.body.appendChild(ov);
    const q = (s) => ov.querySelector(s);
    const errC = (t) => { q("#ca-err").textContent = t || ""; };
    const hintC = (t) => { q("#ca-hint").innerHTML = t || ""; };
    const cerrar = () => { if (mapa) mapa.remove(); ov.remove(); };
    ov.querySelectorAll("[data-cerrar]").forEach(b => b.addEventListener("click", cerrar));
    const segC = (caja, campo, opciones) => {
      caja.innerHTML = opciones.map(([v, t]) => `<button type="button" class="${String(c[campo]) === String(v) ? "activo" : ""}" data-v="${esc(v)}">${t}</button>`).join("");
      caja.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { c[campo] = b.dataset.v; pintar(); }));
    };
    const fmt = (n) => c.moneda === "USD" ? dinero(n, "USD") : `${dinero(n)} MXN`;
    const enMoneda = (mxn) => mxn == null ? null : Math.round((c.moneda === "USD" ? mxn / (num(c.tc) || 1) : mxn) * 100) / 100;
    const montoCruceC = () => montoCruce(c.aduana, c.moneda);
    // Resultado: los tres servicios, el cruce y el "¿y si cobro…?".
    function pintar() {
      const km = num(c.km);
      segC(q("#ca-mon"), "moneda", [["MXN", "MXN"], ["USD", "USD"]]);
      segC(q("#ca-carga"), "carga", Object.entries(CARGAS));
      q("#ca-tc-caja").style.display = c.moneda === "USD" ? "" : "none";
      q("#ca-tramo").textContent = km ? `${tipoRutaTxt(km)}${c.kmOrs && c.kmOrs !== km ? ` · ORS ${miles(c.kmOrs)}` : ""}` : "";
      q("#ca-res").innerHTML = `<table><thead><tr><th>Servicio</th><th class="n">Tarifa sugerida</th><th class="n">Mínima (ámbar)</th></tr></thead><tbody>
        ${Object.entries(SERVICIOS).map(([s, nombre]) => {
          const u = umbralDe(ajustes, s, km);
          return `<tr data-s="${s}" class="${c.servicio === s ? "sel" : ""}"><td>${esc(nombre)}${km ? ` <span class="ca-tramo">${u.tramo}</span>` : ""}${c.servicio === s ? ` <span class="co-chip co-gris" style="font-size:9.5px;">ELEGIDO</span>` : ""}</td>
            <td class="n ca-v"><b class="${c.servicio === s ? "ca-big" : ""}">${km ? fmt(enMoneda(km * u.verde)) : "—"}</b>${km ? `<br><span class="ca-pill ca-pv">${dinero(u.verde)} / km</span>` : ""}</td>
            <td class="n ca-a">${km ? fmt(enMoneda(km * u.ambar)) : "—"}${km ? `<br><span class="ca-pill ca-pa">${dinero(u.ambar)} / km</span>` : ""}</td></tr>`;
        }).join("")}</tbody></table>`;
      q("#ca-res").querySelectorAll("tr[data-s]").forEach(tr => tr.addEventListener("click", () => { c.servicio = tr.dataset.s; pintar(); }));
      // Cruce (solo Importación / Exportación)
      const cc = q("#ca-cruce");
      if (conCruce(c.servicio)) {
        const aduanas = crucesDe(ajustes);
        cc.innerHTML = `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;"><label style="margin:0;">Incluye cruce</label><span class="co-seg" id="ca-cr"></span>
          ${c.cruceSi === "si" ? `<span class="co-seg" id="ca-ad"></span><span style="font-size:13px;">Cruce: <b>${montoCruceC() ? fmt(montoCruceC()) : "sin monto en Configuración"}</b> <small class="nota">(aparte del flete)</small></span>` : ""}</div>`;
        segC(q("#ca-cr"), "cruceSi", [["no", "No"], ["si", "Sí"]]);
        if (q("#ca-ad")) segC(q("#ca-ad"), "aduana", aduanas.map(a => [a.id, a.corto]));
      } else cc.innerHTML = "";
      pintarPrueba();
    }
    function pintarPrueba() {
      const km = num(c.km), imp = num(c.prueba), caja = q("#ca-prueba-res");
      if (!km || imp == null) { caja.innerHTML = `<span class="nota">Escribe un importe para ver su ingreso por km.</span>`; return; }
      const ing = (c.moneda === "USD" ? imp * (num(c.tc) || 0) : imp) / km;
      const u = umbralDe(ajustes, c.servicio, km), cls = ing >= u.verde ? "co-s-v" : ing >= u.ambar ? "co-s-a" : "co-s-r";
      const txt = { "co-s-v": "VERDE", "co-s-a": "ÁMBAR", "co-s-r": "ROJO" }[cls];
      const sug = enMoneda(km * u.verde), dif = imp - sug;
      const tope = Math.max(u.verde * 1.3, ing * 1.05, 1), pos = (x) => Math.min(100, Math.max(0, x / tope * 100));
      caja.innerHTML = `<div style="font-size:13px;margin-bottom:8px;">Ingreso por km <span class="co-ing ${cls}" style="font-size:18px;">${dinero(ing)}</span> <span class="ca-sem ${cls}">${txt}</span>
          <span class="nota"> · ${Math.abs(dif) < 0.005 ? "igual a la sugerida" : `${fmt(Math.abs(dif))} ${dif > 0 ? "arriba" : "abajo"} de la sugerida`}</span></div>
        <div class="ca-barra" style="background:linear-gradient(90deg,#F6D2CD 0 ${pos(u.ambar)}%,#FBE3A8 ${pos(u.ambar)}% ${pos(u.verde)}%,#DCEBCB ${pos(u.verde)}%);"><i style="left:calc(${pos(ing)}% - 2px);"></i></div>
        <div class="nota" style="display:flex;justify-content:space-between;margin-top:3px;"><span>rojo</span><span>ámbar ${dinero(u.ambar)}</span><span>verde ${dinero(u.verde)}</span></div>`;
    }
    // ---- Ruta: catálogo, ORS y mapa ----
    const pintarVias = () => {
      q("#ca-vias").innerHTML = c.vias.length ? `<small class="nota">Pasa por:</small> ${c.vias.map((v, k) => `<span class="co-via">${esc(v.label)} <button type="button" class="co-link" data-qv="${k}" style="text-decoration:none;color:#A32D2D;">✕</button></span>`).join("")}` : "";
      q("#ca-vias").querySelectorAll("[data-qv]").forEach(b => b.addEventListener("click", () => { c.vias.splice(Number(b.dataset.qv), 1); pintarVias(); calcular(); }));
    };
    async function dibujar() {
      if (!linea || !c.origenCoord || !c.destinoCoord) return;
      try { cargarCss(URL_LEAFLET_CSS); await cargarScript(URL_LEAFLET_JS, "L"); } catch (x) { errC("No se pudo cargar el mapa."); return; }
      const L = window.L, div = q("#ca-mapa");
      if (!mapa) { div.innerHTML = ""; mapa = L.map(div); L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 18 }).addTo(mapa); }
      if (capa) capa.remove();
      capa = L.layerGroup().addTo(mapa);
      const trazo = L.polyline(linea, { color: "#2C1E0F", weight: 4 }).addTo(capa);
      const punto = (p, txt, color) => L.circleMarker([p.lat, p.lng], { radius: 7, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 }).addTo(capa).bindTooltip(txt);
      punto(c.origenCoord, c.origen, "#3B7A1E"); punto(c.destinoCoord, c.destino, "#A32D2D");
      c.vias.forEach(v => punto(v, v.label, "#D99A1E"));
      mapa.invalidateSize(); mapa.fitBounds(trazo.getBounds(), { padding: [24, 24] });
    }
    async function calcular() {
      errC();
      const cat = c.origen && c.destino ? rutaDelCatalogo(c.origen, c.destino) : null;
      if (cat) {
        if (cat.origenCoord && !c.origenCoord) c.origenCoord = cat.origenCoord;
        if (cat.destinoCoord && !c.destinoCoord) c.destinoCoord = cat.destinoCoord;
        if (cat.vias && !c.vias.length && !c._viasTocadas) c.vias = cat.vias.map(v => ({ ...v }));
        if (cat.km && !c.vias.length === !(cat.vias || []).length) { c.km = cat.km; q("#ca-km").value = c.km; }
        pintarVias();
      }
      if (!ajustes.orsKey || !c.origenCoord || !c.destinoCoord) {
        hintC(cat ? `del catálogo${(cat.vias || []).length ? " · vía " + cat.vias.map(v => v.label.split(",")[0]).join(", ") : ""}` : (c.origen && c.destino ? (ajustes.orsKey ? "Elige origen y destino de la lista para calcular los km." : "Ruta nueva: escribe los km.") : ""));
        pintar(); return;
      }
      hintC("Calculando ruta de camión…");
      try {
        const res = await orsRuta([c.origenCoord, ...c.vias, c.destinoCoord], ajustes.orsKey);
        linea = res.linea; c.kmOrs = res.km;
        const viasCat = cat && JSON.stringify((cat.vias || []).map(v => v.label)) === JSON.stringify(c.vias.map(v => v.label));
        if (cat && cat.km && viasCat) {
          c.km = cat.km;
          hintC(cat.km === res.km ? "del catálogo · igual a ORS" : `Catálogo ${miles(cat.km)} km · ORS ${miles(res.km)} km <button type="button" class="co-link" id="ca-usar" style="font-size:12px;">usar ${miles(res.km)}</button>`);
          const u = q("#ca-usar"); if (u) u.addEventListener("click", () => { c.km = res.km; q("#ca-km").value = c.km; hintC(`${miles(res.km)} km por ORS (camión)`); pintar(); });
        } else { c.km = res.km; hintC(`${cat ? "Con vías" : "Ruta nueva"} · ${miles(res.km)} km por ORS (camión)`); }
        q("#ca-km").value = c.km;
        pintar(); await dibujar();
      } catch (x) { hintC(""); errC(x.message || "No se pudo calcular la ruta."); pintar(); }
    }
    // Campos
    ["or", "de"].forEach(k => {
      const inp = q(`#ca-${k}`), campo = k === "or" ? "origen" : "destino";
      inp.addEventListener("input", () => { c[campo] = inp.value; delete c[campo + "Coord"]; linea = null; if (!ajustes.orsKey && c.origen && c.destino) calcular(); });
      if (ajustes.orsKey) autocompletar(inp, (op) => { c[campo] = op.label; c[campo + "Coord"] = { lng: op.lng, lat: op.lat }; calcular(); });
    });
    const via = q("#ca-via");
    if (via) autocompletar(via, (op) => { c.vias.push({ label: op.label, lng: op.lng, lat: op.lat }); c._viasTocadas = true; via.value = ""; pintarVias(); calcular(); });
    q("#ca-km").addEventListener("input", (ev) => { c.km = ev.target.value; pintar(); });
    q("#ca-tc").addEventListener("input", (ev) => { c.tc = num(ev.target.value); pintar(); });
    q("#ca-prueba").addEventListener("input", (ev) => { c.prueba = ev.target.value; pintarPrueba(); });
    const det = q("#ca-det"); if (det) det.addEventListener("toggle", () => { if (det.open) { if (mapa) mapa.invalidateSize(); else dibujar(); } });
    // Acciones
    q("#ca-copiar").addEventListener("click", async () => {
      const km = num(c.km);
      if (!c.origen || !c.destino || !km) { errC("Falta la ruta o los km."); return; }
      const u = umbralDe(ajustes, c.servicio, km);
      const lineas = [`${c.origen} → ${c.destino} · ${miles(km)} km (${tipoRutaTxt(km)})${c.vias.length ? " · vía " + c.vias.map(v => v.label.split(",")[0]).join(", ") : ""}`,
        `${SERVICIOS[c.servicio]} · ${CARGAS[c.carga]}: sugerida ${fmt(enMoneda(km * u.verde))} · mínima ${fmt(enMoneda(km * u.ambar))}`];
      if (conCruce(c.servicio)) lineas.push(c.cruceSi === "si" ? `Cruce ${aduanaDe(c.aduana).corto}: ${fmt(montoCruceC())}` : "Sin cruce");
      if (num(c.prueba) != null) { const ing = (c.moneda === "USD" ? num(c.prueba) * (num(c.tc) || 0) : num(c.prueba)) / km; lineas.push(`Propuesta: ${fmt(num(c.prueba))} (ing./km ${dinero(ing)})`); }
      const texto = lineas.join("\n");
      try { await navigator.clipboard.writeText(texto); }
      catch (x) { const ta = document.createElement("textarea"); ta.value = texto; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (y) {} ta.remove(); }
      const b = q("#ca-copiar"); b.textContent = "Copiado ✓"; setTimeout(() => { b.textContent = "Copiar resumen"; }, 2000);
    });
    q("#ca-cat").addEventListener("click", async () => {
      errC();
      if (!c.origen || !c.destino || !num(c.km)) { errC("Falta la ruta o los km."); return; }
      const datos = { origen: c.origen.trim(), destino: c.destino.trim(), km: num(c.km), kmOrs: c.kmOrs || null, origenCoord: c.origenCoord || null, destinoCoord: c.destinoCoord || null, vias: c.vias || [], fuente: c.kmOrs ? "ORS" : "manual", actualizadoMs: Date.now() };
      try {
        const cat = rutaDelCatalogo(c.origen, c.destino);
        if (cat) { await updateDoc(doc(db, COL_RUT, cat.id), datos); rutas.set(cat.id, { ...cat, ...datos }); }
        else { const ref = doc(collection(db, COL_RUT)); await setDoc(ref, { ...datos, clave: "", creadoMs: Date.now(), creadoPor: { uid, nombre: yo.nombre } }); rutas.set(ref.id, { id: ref.id, ...datos }); }
        const b = q("#ca-cat"); b.textContent = "Guardada en catálogo ✓"; b.disabled = true;
      } catch (x) { errC("No se pudo guardar: " + x.message); }
    });
    q("#ca-conv").addEventListener("click", () => {
      const km = num(c.km);
      if (!c.origen || !c.destino || !km) { errC("Falta la ruta o los km."); return; }
      const sug = enMoneda(km * umbralDe(ajustes, c.servicio, km).verde), prop = num(c.prueba);
      cerrar();
      fichaId = null; abrirEditor(null);
      Object.assign(editor, {
        tipoServicio: c.servicio, moneda: c.moneda, tipoCambio: c.moneda === "USD" ? num(c.tc) : ajustes.tipoCambio, tipoCarga: c.carga,
        cruceSi: conCruce(c.servicio) ? c.cruceSi : "no", cruceAduana: c.aduana,
        rutas: [{ origen: c.origen, destino: c.destino, km, importe: prop != null ? prop : sug, importeAuto: prop == null,
          origenCoord: c.origenCoord || undefined, destinoCoord: c.destinoCoord || undefined, vias: c.vias.length ? c.vias.map(v => ({ ...v })) : undefined, kmOrs: c.kmOrs || undefined }],
      });
      avisar("Ruta de la calculadora lista: elige el cliente y guarda.");
      render();
    });
    pintar(); pintarVias();
    if (c.origenCoord && c.destinoCoord && ajustes.orsKey) calcular();
  }
  $("#co-calc").addEventListener("click", abrirCalculadora);
  $("#co-nueva").addEventListener("click", () => abrirEditor(null));
  $("#co-firma").addEventListener("click", () => {
    const m = firmaDe(uid) || {};
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML = `<div class="modal-tarjeta" style="max-width:480px;width:100%;">
      <h2 style="margin:0 0 4px;">Mi firma</h2>
      <p class="nota" style="margin:0 0 12px;">Así sales al final de tus cotizaciones. No cambia tu puesto en el catálogo de usuarios.</p>
      <div class="co-grid" style="grid-template-columns:1fr;">
        <div><label>Nombre</label><input type="text" value="${esc(yo.nombre)}" disabled></div>
        <div><label>Puesto en la cotización</label><input type="text" id="fi-puesto" value="${esc(m.puesto || yo.puesto || "")}" placeholder="Gerente de Operaciones"></div>
        <div><label>Teléfono (opcional)</label><input type="tel" id="fi-tel" value="${esc(m.telefono || "")}" placeholder="867 711 6565"></div>
        <div><label>Correo</label><input type="text" value="${esc(yo.correo)}" disabled></div>
      </div>
      <div class="error" id="fi-err"></div>
      <div class="modal-acciones"><button type="button" class="secundario" data-cerrar>Cancelar</button><button type="button" id="fi-ok">Guardar</button></div></div>`;
    document.body.appendChild(ov);
    ov.querySelector("[data-cerrar]").addEventListener("click", () => ov.remove());
    ov.querySelector("#fi-ok").addEventListener("click", async () => {
      const puesto = ov.querySelector("#fi-puesto").value.trim(), telefono = ov.querySelector("#fi-tel").value.trim();
      if (!puesto) { ov.querySelector("#fi-err").textContent = "Escribe tu puesto."; return; }
      try {
        await setDoc(doc(db, COL_FIR, uid), { nombre: yo.nombre, puesto, telefono: telefono || null, correo: yo.correo, actualizadoMs: Date.now() });
        ov.remove(); avisar("Firma guardada. Sale así en tus cotizaciones (también en las que ya tenías).");
      } catch (x) { ov.querySelector("#fi-err").textContent = "No se pudo guardar: " + x.message; }
    });
  });

  // ============================================================================
  // Clientes
  // ============================================================================
  function renderClientes() {
    const ahora = Date.now(), q = normTxt(fc.q);
    const filas = [...clientes.values()].map(c => {
      const cs = cotDeCliente(c.id);
      const vig = cs.filter(x => ["borrador", "enviada", "aceptada"].includes(estadoDe(x, ahora)) && sigueVigente(x, ahora));
      const porVencer = vig.filter(x => x.vencimientoMs && x.vencimientoMs - ahora <= 7 * DIA && estadoDe(x, ahora) !== "aceptada");
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
  // Historial compacto: folio · fecha · vigencia · estado. El detalle, al abrirla.
  function tablaCotizaciones(cs, conCliente) {
    if (!cs.length) return `<p class="nota" style="text-align:center;padding:14px;">Sin cotizaciones.</p>`;
    return `<div class="tabla-wrap"><table class="tabla co-tabla">
      <thead><tr><th>Folio</th>${conCliente ? "<th>Cliente</th>" : ""}<th>Fecha</th><th>Vigencia</th><th>Estado</th></tr></thead>
      <tbody>${cs.map(c => {
        const n = (c.rutas || []).length, env = (c.envios || [])[(c.envios || []).length - 1];
        return `<tr class="clic" data-cot="${esc(c.id)}">
          <td><b>${esc(c.folio)}</b> <small class="nota">· ${n} ruta${n === 1 ? "" : "s"}</small>${esAdmin && c.creadoPorUid !== uid ? `<br><small class="nota">${esc((c.creadoPor || {}).nombre || "")}</small>` : ""}</td>
          ${conCliente ? `<td>${esc(c.clienteNombre)}</td>` : ""}
          <td>${fecha(c.emisionMs)}</td>
          <td>${textoVence(c)}</td>
          <td>${chipEstado(c)}${env ? `<br><small class="nota">${fecha(env.ms)} ${env.canal === "whatsapp" ? "por WhatsApp" : "a " + esc((env.para || [])[0] || "")}</small>` : ""}</td></tr>`;
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
    const vig = cs.filter(x => ["borrador", "enviada", "aceptada"].includes(estadoDe(x, ahora)) && sigueVigente(x, ahora)).length;
    const ings = cs.flatMap(x => (x.rutas || []).map(r => ingresoKm(r, x.moneda, x.tipoCambio, x.tipoServicio))).filter(v => v != null);
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
      <p class="nota">Toca una cotización para ver el detalle, editarla, descargar el PDF, enviarla o duplicarla.</p>`;
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
    const porVencer = todas.filter(c => ["borrador", "enviada"].includes(estadoDe(c, ahora)) && c.vencimientoMs && c.vencimientoMs - ahora <= 7 * DIA);
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
      editor.condiciones = condicionesDeCot(c, ajustes);
      Object.assign(editor, cruceEditor(c));
      // Borrador hecho con cruce por ruta (versión 14): el cruce pasa a la cotización.
      if (c.estado === "borrador") {
        editor.rutas.forEach(r => { delete r.cruce; });
        // Borrador de la versión 14: moneda e impuestos en dos condiciones y sin la demora Rojo.
        editor.condiciones = editor.condiciones
          .flatMap(x => x.texto.trim() === COND_VIEJA ? CONDICIONES_BASE.slice(0, 2).map(texto => ({ texto, tipo: "cat", on: x.on })) : [x])
          .filter(x => !(x.tipo === "demora" && /^Demoras por rojo/.test(x.texto)));
        editor.condiciones = refrescarDemoras(editor.condiciones, ajustes);
      }
    } else {
      editor = {
        _nueva: true, clienteId: clienteId || "", contacto: null, moneda: "MXN", tipoCambio: ajustes.tipoCambio,
        vigenciaDias: ajustes.vigenciaDias, tipoCarga: "refrigerada", tipoServicio: "nacional", estado: "borrador",
        rutas: [rutaVacia()], condiciones: condicionesNuevas(ajustes),
        cruceSi: "no", cruceAduana: CRUCES_BASE[0].id,
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
      vigenciaDias: c.vigenciaDias, tipoCarga: c.tipoCarga, tipoServicio: c.tipoServicio,
      condiciones: refrescarDemoras(condicionesDeCot(c, ajustes), ajustes), ...cruceEditor(c),
      rutas: (c.rutas || []).map(r => ({ origen: r.origen, destino: r.destino, km: r.km, importe: r.importe, origenCoord: r.origenCoord || undefined, destinoCoord: r.destinoCoord || undefined, vias: r.vias || undefined, kmOrs: r.kmOrs || undefined })),
    });
    avisar(`Copia de ${c.folio}: revisa y guarda para darle folio nuevo.`);
    render();
  }

  const rutaVacia = () => ({ origen: "", destino: "", km: "", importe: "" });
  // Monto de cruce de Configuración para una aduana, en la moneda de la cotización.
  const aduanaDe = (id) => crucesDe(ajustes).find(x => x.id === id) || crucesDe(ajustes)[0];
  const montoCruce = (id, moneda) => { const a = aduanaDe(id); return num(moneda === "USD" ? a.usd : a.mxn); };
  // Sí/No y aduana del editor a partir de lo guardado (cot.cruce, o el cruce por ruta de la versión 14).
  function cruceEditor(c) {
    if (c.cruce) return { cruceSi: c.cruce.incluye ? "si" : "no", cruceAduana: c.cruce.aduana || CRUCES_BASE[0].id };
    const vieja = (c.rutas || []).map(r => cruceDe(r, c.tipoServicio)).find(Boolean);
    return { cruceSi: vieja ? "si" : "no", cruceAduana: (vieja && vieja.aduana) || CRUCES_BASE[0].id };
  }
  // Cruce de la cotización en edición, como se guarda.
  const cruceDelEditor = (e) => {
    if (!conCruce(e.tipoServicio)) return null;
    if (e.cruceSi !== "si") return { incluye: false };
    const a = aduanaDe(e.cruceAduana);
    return { incluye: true, aduana: a.id, aduanaNombre: a.nombre, monto: montoCruce(a.id, e.moneda) };
  };
  const sugeridaRuta = (r) => sugerida(editor.tipoServicio, r.km, editor.moneda, editor.tipoCambio);

  // Catálogo de rutas: buscar por origen + destino.
  const claveRuta = (o, d) => `${normTxt(o)}|${normTxt(d)}`;
  function rutaDelCatalogo(o, d) { const k = claveRuta(o, d); return [...rutas.values()].find(r => claveRuta(r.origen, r.destino) === k) || null; }

  // Condiciones en grupos plegables (Generales, Cruce, Demoras, Solo para esta
  // cotización) con un interruptor por renglón; demoras en tabla corta.
  function bloqueCondiciones(bloqueada, original) {
    const e = editor, cs = e.condiciones || [];
    const tCruce = bloqueada ? textoCruce(original || {}) : textoCruce({ ...e, cruce: cruceDelEditor(e) });
    if (bloqueada) {
      const on = cs.filter(c => c.on).map(c => conMoneda(c.texto, e.moneda));
      if (tCruce) on.splice(cs.filter(c => c.on && c.tipo === "cat").length, 0, tCruce);
      return `<div class="co-conds-ro">${on.length ? on.map(t => `<div>• ${esc(t)}</div>`).join("") : `<p class="nota">Sin condiciones.</p>`}
        <p class="nota" style="margin:8px 0 0;">Ya enviada: las condiciones no cambian. Para cambiarlas, usa "Duplicar".</p></div>`;
    }
    if (!e._pleg) { const cel = window.innerWidth <= 700; e._pleg = { cat: cel, demora: cel, propia: false, cruce: false }; }
    const de = (tipo) => cs.map((c, k) => [c, k]).filter(([c]) => c.tipo === tipo);
    const sw = (c, k) => `<button type="button" class="co-sw${c.on ? " on" : ""}" data-cond="${k}" role="switch" aria-checked="${c.on}" title="${c.on ? "Sale en el PDF" : "No sale en el PDF"}"></button>`;
    const grupo = (id, titulo, cuenta, cuerpo) => `<div class="co-g">
      <div class="co-g-h" data-pleg="${id}"><span class="co-g-f">${e._pleg[id] ? "▶" : "▼"}</span><b>${titulo}</b><span class="co-g-n">${cuenta}</span></div>
      ${e._pleg[id] ? "" : cuerpo}</div>`;
    const cuenta = (xs) => `${xs.filter(([c]) => c.on).length} de ${xs.length}`;
    const incluye = !!(cruceDelEditor(e) || {}).incluye;
    const cat = de("cat"), dem = de("demora").filter(([c]) => demoraAplica(c, incluye)), pro = de("propia");
    let html = grupo("cat", "Generales", cuenta(cat),
      cat.map(([c, k]) => `<div class="co-cf${c.on ? "" : " off"}"><span class="co-cf-t">${esc(conMoneda(c.texto, e.moneda))}</span>${sw(c, k)}</div>`).join(""));
    if (tCruce) html += grupo("cruce", "Cruce", `<span class="co-auto">AUTOMÁTICA</span>`,
      `<div class="co-cf"><span class="co-cf-t">${esc(tCruce)}</span></div>`);
    if (dem.length) html += grupo("demora", "Demoras", cuenta(dem),
      dem.map(([c, k]) => `<div class="co-cf${c.on ? "" : " off"}"><span class="co-cf-t">${esc(c.texto)}</span>${sw(c, k)}</div>`).join(""));
    html += grupo("propia", "Solo para esta cotización", String(pro.length),
      pro.map(([c, k]) => `<div class="co-cf${c.on ? "" : " off"}"><input type="text" data-cond-txt="${k}" value="${esc(c.texto)}" placeholder="Escribe la condición…">${sw(c, k)}<button type="button" class="co-x" data-cond-x="${k}" title="Quitar">✕</button></div>`).join("")
      + `<div class="co-cf"><button type="button" class="co-link" id="co-cond-mas" style="font-size:13px;">+ Agregar condición</button></div>`);
    return `<div class="co-conds">${html}</div><p class="nota" style="margin:6px 0 0;">Toca el interruptor para quitar o poner una condición. La vigencia se agrega sola al final.</p>`;
  }

  function renderEditor() {
    const e = editor;
    const original = e._id ? cotizaciones.get(e._id) : null;
    const puedeEditar = !original || esAdmin || original.creadoPorUid === uid;
    const vigente = !original || estadoDe(original) !== "vencida";
    const bloqueada = !!original && original.estado !== "borrador"; // enviada o después: solo se agregan rutas y se cambia estado/notas
    const cli = clientes.get(e.clienteId);
    const lugares = [...new Set([...rutas.values()].flatMap(r => [r.origen, r.destino]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    const seg = (campo, opciones, deshab) => `<span class="co-seg">${opciones.map(([v, t]) => `<button type="button" class="${String(e[campo]) === String(v) ? "activo" : ""}" data-campo="${campo}" data-valor="${v}"${deshab ? " disabled" : ""}>${t}</button>`).join("")}</span>`;
    const vigOpc = opcionesVigencia(e.vigenciaDias);
    const aduanas = crucesDe(ajustes);
    $("#co-cuerpo").innerHTML = `
      <button type="button" class="co-link" id="co-e-volver">‹ Volver</button>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;margin-top:8px;">
        <h2 style="margin:0;">${original ? esc(original.folio) : "Nueva cotización"} ${original ? chipEstado(original) : `<span class="nota" style="font-weight:400;font-size:13px;">· el folio se asigna al guardar</span>`}</h2>
        ${original ? `<span class="nota">Emitida ${fecha(original.emisionMs)} · ${original.vencimientoMs ? "vence " + fecha(original.vencimientoMs) : "único evento"} · por ${esc((original.creadoPor || {}).nombre || "")}</span>` : ""}
      </div>
      <div class="co-grid" style="margin-top:14px;">
        <div><label>Cliente</label><select id="co-e-cli"${bloqueada ? " disabled" : ""}><option value="">Elige un cliente…</option>${[...clientes.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")).map(c => `<option value="${esc(c.id)}"${c.id === e.clienteId ? " selected" : ""}>${esc(c.nombre)}</option>`).join("")}</select>
          ${bloqueada ? "" : `<button type="button" class="co-link" id="co-e-cli-nuevo" style="font-size:12px;margin-top:4px;">+ Cliente nuevo</button>`}</div>
        <div><label>Contacto (sale en el PDF)</label><select id="co-e-cont"><option value="">Sin contacto</option>${((cli && cli.contactos) || []).map((k, i) => `<option value="${i}"${e.contacto && e.contacto.nombre === k.nombre ? " selected" : ""}>${esc(k.nombre)}${k.puesto ? " · " + esc(k.puesto) : ""}</option>`).join("")}</select></div>
        <div><label>Moneda</label>${seg("moneda", [["MXN", "MXN"], ["USD", "USD"]], bloqueada)}
          ${e.moneda === "USD" ? `<div style="margin-top:6px;display:flex;gap:6px;align-items:center;"><small class="nota">TC para ing./km</small><input type="number" step="0.01" id="co-e-tc" value="${esc(e.tipoCambio)}" style="width:90px;"${bloqueada ? " disabled" : ""}></div>` : ""}</div>
        <div><label>Vigencia</label><select id="co-e-vig"${bloqueada ? " disabled" : ""} style="width:auto;min-width:140px;">${vigOpc.map(d => `<option value="${d}"${d === Number(e.vigenciaDias) ? " selected" : ""}>${textoVigencia(d)}</option>`).join("")}</select></div>
        <div><label>Tipo de carga</label>${seg("tipoCarga", Object.entries(CARGAS), bloqueada)}</div>
        <div><label>Servicio</label>${seg("tipoServicio", Object.entries(SERVICIOS), bloqueada)}</div>
        ${conCruce(e.tipoServicio) ? `<div><label>Incluye cruce</label>${seg("cruceSi", [["no", "No"], ["si", "Sí"]], bloqueada)}</div>
        ${e.cruceSi === "si" ? `<div><label>Aduana</label>${seg("cruceAduana", aduanas.map(a => [a.id, a.corto]), bloqueada)}
          <small class="nota" style="display:block;margin-top:4px;">${esc(aduanas.find(a => a.id === e.cruceAduana)?.nombre || "")} · ${(() => { const m = montoCruce(e.cruceAduana, e.moneda); return m ? (e.moneda === "USD" ? dinero(m, "USD") : dinero(m) + " MXN") : "sin monto en Configuración"; })()}</small></div>` : ""}` : ""}
      </div>
      <div class="co-h3">Rutas</div>
      ${ajustes.orsKey ? "" : `<datalist id="co-lugares">${lugares.map(l => `<option value="${esc(l)}">`).join("")}</datalist>`}
      <div class="tabla-wrap"><table class="tabla co-tabla co-rutas">
        <thead><tr><th style="min-width:170px;">Origen</th><th style="min-width:170px;">Destino</th><th class="n" style="width:90px;">Km</th><th class="n" style="width:130px;">Importe (${esc(e.moneda)})</th><th class="n">Ing./km MXN</th><th></th></tr></thead>
        <tbody>${e.rutas.map((r, i) => {
          const fija = bloqueada && r.agregadaMs && original && (original.rutas || []).some(x => x.agregadaMs === r.agregadaMs && x.origen === r.origen && x.destino === r.destino);
          const dis = fija ? " disabled" : "";
          const v = ingresoKm(r, e.moneda, e.tipoCambio, e.tipoServicio);
          const cat = r.origen && r.destino ? rutaDelCatalogo(r.origen, r.destino) : null;
          return `<tr data-i="${i}" class="co-fila ${semaforo(v, e.tipoServicio, r.km).replace("co-s-", "co-f-")}">
            <td class="co-c-or" data-et="Origen"><div class="co-ac"><input type="text" list="co-lugares" data-r="origen" value="${esc(r.origen)}"${dis} placeholder="${ajustes.orsKey ? "Escribe la ciudad…" : "Ciudad, estado"}" autocomplete="off"></div>
              ${(r.vias || []).length ? `<small class="nota">vía ${esc(r.vias.map(v => v.label.split(",")[0]).join(", "))}</small>` : ""}</td>
            <td class="co-c-de" data-et="Destino"><div class="co-ac"><input type="text" list="co-lugares" data-r="destino" value="${esc(r.destino)}"${dis} placeholder="${ajustes.orsKey ? "Escribe la ciudad…" : "Ciudad, estado"}" autocomplete="off"></div>
              ${fija ? "" : `<small class="nota" data-hint="${i}">${r.origen && r.destino ? (cat ? "del catálogo" : "ruta nueva · se agrega al catálogo") : ""}</small>`}
              <button type="button" class="co-link" data-mapa="${i}" style="font-size:12px;${r.origenCoord && r.destinoCoord ? "" : "display:none;"}">Ver ruta</button>
              ${fija && r.agregadaMs - (original.emisionMs || 0) > DIA / 2 ? `<br><small class="nota">agregada ${fecha(r.agregadaMs)}</small>` : ""}</td>
            <td class="n co-c-km" data-et="Km"><input type="number" min="1" data-r="km" value="${esc(r.km)}"${dis}><br><small class="nota" data-tipo="${i}">${tipoRutaTxt(num(r.km))}</small></td>
            <td class="n co-c-im" data-et="Importe (${esc(e.moneda)})"><input type="number" min="0" step="0.01" data-r="importe" value="${esc(r.importe)}"${dis}>${fija ? "" : `<br><small class="nota" data-sug="${i}"></small>`}</td>
            <td class="n co-c-ing" data-et="Ingreso por km" data-ing="${i}">${celdaIng(v, e.tipoServicio, r.km)}</td>
            <td class="co-c-x">${fija ? "" : `<button type="button" class="secundario co-mini" data-qr="${i}" title="Quitar ruta">✕</button>`}</td></tr>`;
        }).join("")}</tbody></table></div>
      ${puedeEditar && vigente ? `<div style="margin-top:8px;"><button type="button" class="secundario co-mini" id="co-e-mas">+ Agregar ruta</button></div>` : ""}
      ${original && !bloqueada ? `<p class="nota">Está en borrador: puedes cambiar todo. Al pasarla a Enviada, las rutas guardadas quedan fijas.</p>` : ""}
      ${bloqueada && vigente ? `<p class="nota">Ya tiene folio: las rutas guardadas no cambian; puedes agregar rutas nuevas mientras siga vigente (salen en el PDF con su fecha). Para cambiar importes, usa "Duplicar".</p>` : ""}
      <div class="co-grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));margin-top:14px;">
        <div class="co-campo" style="grid-column:1/-1;"><label>Condiciones de esta cotización (salen en el PDF)</label>${bloqueCondiciones(bloqueada, original)}</div>
        <div>
          ${e.moneda === "USD" ? `<div class="nota" style="margin:0 0 8px;">El ingreso por km se calcula en MXN con el tipo de cambio de esta cotización.</div>` : ""}
          ${original ? `<div><label>Estado</label><span class="co-seg co-seg-estado">${["borrador", "enviada", "aceptada", "rechazada"].map(k => `<button type="button" class="${e.estado === k ? "activo" : ""}" data-estado="${k}"${puedeEditar ? "" : " disabled"}>${ESTADOS[k].txt.charAt(0) + ESTADOS[k].txt.slice(1).toLowerCase()}</button>`).join("")}</span>
            ${estadoDe(original) === "vencida" ? `<div class="nota" style="margin:6px 0 0;">Vencida por fecha. Usa "Duplicar" para renovarla con folio nuevo.</div>` : ""}</div>` : ""}
        </div>
      </div>
      <div class="error" id="co-e-err"></div>
      <div class="co-acciones">
        ${original ? `<button type="button" class="secundario" id="co-e-dup">Duplicar</button><button type="button" class="secundario" id="co-e-pdf">PDF</button>` : ""}
        ${puedeEditar ? `<button type="button" class="secundario" id="co-e-guardar">${original ? "Guardar cambios" : "Guardar borrador"}</button>` : ""}
        ${puedeEditar && !original ? `<button type="button" id="co-e-guardar-pdf">Guardar y ver PDF</button>` : ""}
        ${original && puedeEditar && esCelular() ? `<button type="button" class="secundario" id="co-e-wa">WhatsApp</button>` : ""}
        ${original && puedeEditar ? `<button type="button" id="co-e-correo">✉ Enviar por correo</button>` : ""}
      </div>
      ${original && (original.envios || []).length ? `<div class="co-h3">Envíos</div><div class="tabla-wrap"><table class="tabla co-tabla">
        <thead><tr><th>Fecha</th><th>Por</th><th>Para</th><th>CC</th><th>Quién</th></tr></thead>
        <tbody>${original.envios.slice().reverse().map(v => `<tr><td>${esc(fechaHoraTxt(v.ms))}</td><td>${v.canal === "whatsapp" ? "WhatsApp" : "Correo"}</td><td>${esc((v.para || []).join(", ") || "—")}</td><td>${esc((v.cc || []).join(", ") || "—")}</td><td>${esc((v.por || {}).nombre || "")}</td></tr>`).join("")}</tbody></table></div>` : ""}`;
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
    $("#co-e-vig").addEventListener("change", (ev) => { e.vigenciaDias = Number(ev.target.value); });
    $("#co-cuerpo").querySelectorAll("[data-campo]").forEach(b => b.addEventListener("click", () => {
      const c = b.dataset.campo; e[c] = c === "vigenciaDias" ? Number(b.dataset.valor) : b.dataset.valor; leerFormulario();
      if (c === "tipoServicio" || c === "moneda") e.rutas.forEach(r => { if (r.importeAuto) { r.importe = ""; autoImporte(r); } });
      renderEditor();
    }));
    const tc = $("#co-e-tc"); if (tc) tc.addEventListener("input", () => {
      e.tipoCambio = num(tc.value);
      e.rutas.forEach((r, i) => { if (r.importeAuto) { r.importe = ""; autoImporte(r); const imp = $(`tr[data-i="${i}"] [data-r="importe"]`); if (imp && !imp.disabled) imp.value = r.importe; } });
      pintarIngresos();
    });
    $("#co-cuerpo").querySelectorAll("tr[data-i] input[data-r]").forEach(inp => inp.addEventListener("input", () => {
      const i = Number(inp.closest("tr").dataset.i), r = e.rutas[i];
      r[inp.dataset.r] = inp.value;
      if (inp.dataset.r === "importe") r.importeAuto = false; // lo escribiste tú
      if (inp.dataset.r === "km") { autoImporte(r); const imp = inp.closest("tr").querySelector('[data-r="importe"]'); if (imp && r.importeAuto) imp.value = r.importe; }
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
      if (!e.rutas.length) e.rutas.push(rutaVacia());
      renderEditor();
    }));
    const mas = $("#co-e-mas"); if (mas) mas.addEventListener("click", () => { leerFormulario(); e.rutas.push(rutaVacia()); renderEditor(); });
    // Condiciones
    $("#co-cuerpo").querySelectorAll("[data-cond]").forEach(b => b.addEventListener("click", () => {
      const c = e.condiciones[Number(b.dataset.cond)]; c.on = !c.on;
      b.classList.toggle("on", c.on); b.setAttribute("aria-checked", c.on); b.title = c.on ? "Sale en el PDF" : "No sale en el PDF";
      b.closest(".co-cf, tr").classList.toggle("off", !c.on);
      const g = b.closest(".co-g"), n = g && g.querySelector(".co-g-n"), bs = g ? [...g.querySelectorAll("[data-cond]")] : [];
      if (n && g.querySelector("[data-pleg]").dataset.pleg !== "propia") n.textContent = `${bs.filter(x => x.classList.contains("on")).length} de ${bs.length}`;
    }));
    $("#co-cuerpo").querySelectorAll("[data-pleg]").forEach(h => h.addEventListener("click", () => { leerFormulario(); e._pleg[h.dataset.pleg] = !e._pleg[h.dataset.pleg]; renderEditor(); }));
    $("#co-cuerpo").querySelectorAll("[data-cond-txt]").forEach(inp => inp.addEventListener("input", () => { e.condiciones[Number(inp.dataset.condTxt)].texto = inp.value; }));
    $("#co-cuerpo").querySelectorAll("[data-cond-x]").forEach(b => b.addEventListener("click", () => { leerFormulario(); e.condiciones.splice(Number(b.dataset.condX), 1); renderEditor(); }));
    const cm = $("#co-cond-mas"); if (cm) cm.addEventListener("click", () => {
      leerFormulario(); e.condiciones.push({ texto: "", tipo: "propia", on: true }); e._pleg.propia = false; renderEditor();
      const ins = $("#co-cuerpo").querySelectorAll("[data-cond-txt]"); if (ins.length) ins[ins.length - 1].focus();
    });
    $("#co-cuerpo").querySelectorAll("[data-estado]").forEach(b => b.addEventListener("click", () => { leerFormulario(); e.estado = b.dataset.estado; renderEditor(); }));
    const g = $("#co-e-guardar"); if (g) g.addEventListener("click", () => guardarCotizacion(false));
    const gp = $("#co-e-guardar-pdf"); if (gp) gp.addEventListener("click", () => guardarCotizacion(true));
    const p = $("#co-e-pdf"); if (p) p.addEventListener("click", () => pdfDe(original.id));
    const ec = $("#co-e-correo"); if (ec) ec.addEventListener("click", () => abrirEnvio(original.id));
    const wa = $("#co-e-wa"); if (wa) wa.addEventListener("click", () => compartirWhatsApp(original.id));
    const d = $("#co-e-dup"); if (d) d.addEventListener("click", () => duplicar(original.id));
    pintarIngresos();
  }
  // ---- Km: catálogo, ORS y mapa ----
  const geo = new WeakMap(); // ruta del editor → trazo [[lat, lng]] (solo en memoria)
  function puedeEditarRuta(i, original) {
    const r = editor.rutas[i];
    if (!original || original.estado === "borrador") return true;
    return !(r.agregadaMs && (original.rutas || []).some(x => x.agregadaMs === r.agregadaMs && x.origen === r.origen && x.destino === r.destino));
  }
  function hint(i, t) { const h = $(`[data-hint="${i}"]`); if (h) h.textContent = t; }
  // Catálogo y ORS no coinciden: muestra los dos y un botón para usar el de ORS.
  function hintComparar(i, r, kmCat) {
    const h = $(`[data-hint="${i}"]`); if (!h) return;
    h.innerHTML = `Catálogo ${miles(kmCat)} km · ORS ${miles(r.kmOrs)} km <button type="button" class="co-link" style="font-size:12px;">usar ${miles(r.kmOrs)}</button>`;
    h.querySelector("button").addEventListener("click", () => { r.km = r.kmOrs; pintarFila(i); hint(i, `${miles(r.kmOrs)} km por ORS (camión)`); });
  }
  // Llena el importe con la sugerida si está vacío o si lo había puesto la sugerida.
  function autoImporte(r) {
    if (num(r.importe) != null && !r.importeAuto) return;
    const sug = sugeridaRuta(r);
    if (sug == null) return;
    r.importe = sug; r.importeAuto = true;
  }
  function pintarFila(i) {
    const r = editor.rutas[i], tr = $(`tr[data-i="${i}"]`);
    if (!tr) return;
    const km = tr.querySelector('[data-r="km"]'); if (km && !km.disabled) km.value = r.km == null ? "" : r.km;
    const imp = tr.querySelector('[data-r="importe"]');
    if (imp && !imp.disabled) { autoImporte(r); imp.value = r.importe == null ? "" : r.importe; }
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
    // Los campos de condiciones y cruce se guardan en "editor" mientras se escriben.
    (editor.condiciones || []).forEach((c, k) => { const i = $(`[data-cond-txt="${k}"]`); if (i) c.texto = i.value; });
  }
  function pintarIngresos() {
    editor.rutas.forEach((r, i) => {
      const td = $(`[data-ing="${i}"]`); if (!td) return;
      const v = ingresoKm(r, editor.moneda, editor.tipoCambio, editor.tipoServicio);
      td.innerHTML = celdaIng(v, editor.tipoServicio, r.km);
      const tr = $(`tr[data-i="${i}"]`); if (tr) tr.className = `co-fila ${semaforo(v, editor.tipoServicio, r.km).replace("co-s-", "co-f-")}`;
      const sg = $(`[data-sug="${i}"]`);
      if (sg) {
        const sug = sugeridaRuta(r);
        if (sug == null) sg.innerHTML = "";
        else if (r.importeAuto || num(r.importe) === sug) sg.textContent = "sugerida (umbral verde)";
        else {
          sg.innerHTML = `sugerida ${dinero(sug, editor.moneda)} <button type="button" class="co-link" style="font-size:12px;">usar</button>`;
          sg.querySelector("button").addEventListener("click", () => { r.importe = sug; r.importeAuto = true; const inp = $(`tr[data-i="${i}"] [data-r="importe"]`); if (inp) inp.value = sug; pintarIngresos(); });
        }
      }
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
    const cruce = cruceDelEditor(e);
    if (cruce && cruce.incluye && !(cruce.monto > 0)) { err.textContent = `Falta el monto del cruce de ${cruce.aduanaNombre} en ${e.moneda} (Configuración → Comercial).`; return; }
    if (e.moneda === "USD" && !(num(e.tipoCambio) > 0)) { err.textContent = "Escribe el tipo de cambio."; return; }
    const ahora = Date.now();
    const limpias = rs.map(r => ({
      origen: String(r.origen).trim(), destino: String(r.destino).trim(), km: num(r.km), importe: num(r.importe),
      agregadaMs: r.agregadaMs || ahora,
      origenCoord: r.origenCoord || null, destinoCoord: r.destinoCoord || null, vias: r.vias || [], kmOrs: r.kmOrs || null,
      ...(r.cruce ? { cruce: r.cruce } : {}), // solo rutas ya enviadas de la versión 14
    }));
    const incluyeCruce = !!(cruceDelEditor(e) || {}).incluye;
    const condicionesSel = (e.condiciones || []).filter(c => demoraAplica(c, incluyeCruce))
      .map(c => ({ texto: String(c.texto || "").trim(), tipo: c.tipo, on: !!c.on, ...(c.id ? { id: c.id } : {}) })).filter(c => c.texto);
    const botones = $("#co-cuerpo").querySelectorAll(".co-acciones button");
    botones.forEach(b => b.disabled = true);
    try {
      let guardada;
      if (e._id) {
        const antes = cotizaciones.get(e._id);
        let cambios = { rutas: limpias, estado: e.estado, contacto: e.contacto || null, actualizadoMs: ahora, actualizadoPor: { uid, nombre: yo.nombre } };
        if (antes && antes.estado === "borrador") {
          // Borrador: se reescribe todo; las rutas cuentan desde la emisión (no salen como "agregadas").
          cambios = {
            ...cambios, clienteId: cli.id, clienteNombre: cli.nombre, clienteRfc: cli.rfc || null,
            tipoCarga: e.tipoCarga, tipoServicio: e.tipoServicio, moneda: e.moneda, tipoCambio: e.moneda === "USD" ? num(e.tipoCambio) : 1,
            vigenciaDias: Number(e.vigenciaDias), vencimientoMs: venceEn(antes.emisionMs, e.vigenciaDias),
            rutas: limpias.map(r => ({ ...r, agregadaMs: antes.emisionMs })),
            condicionesSel, notas: null, cruce,
          };
        }
        await updateDoc(doc(db, COL_COT, e._id), cambios);
        guardada = { ...cotizaciones.get(e._id), ...cambios };
      } else {
        const d = new Date(ahora), anio = String(d.getFullYear()).slice(-2);
        const datos = {
          estado: "borrador", clienteId: cli.id, clienteNombre: cli.nombre, clienteRfc: cli.rfc || null, contacto: e.contacto || null,
          tipoCarga: e.tipoCarga, tipoServicio: e.tipoServicio, moneda: e.moneda, tipoCambio: e.moneda === "USD" ? num(e.tipoCambio) : 1,
          vigenciaDias: Number(e.vigenciaDias), emisionMs: ahora, vencimientoMs: venceEn(ahora, e.vigenciaDias),
          rutas: limpias, condicionesSel, cruce,
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
      if (conPdf) await generarPdf(guardada, cli, ajustes, firmaDe(guardada.creadoPorUid));
    } catch (x) {
      err.textContent = "No se pudo guardar: " + x.message;
      botones.forEach(b => b.disabled = false);
    }
  }
  // ---- Envío por correo (función enviarCotizacionComercial) ----
  const fnEnviar = httpsCallable(getFunctions(undefined, "us-central1"), "enviarCotizacionComercial");
  function mensajeCorreo(c, saludo) {
    const f = { ...(c.creadoPor || {}), ...Object.fromEntries(Object.entries(firmaDe(c.creadoPorUid) || {}).filter(([, v]) => v)) };
    const n = (c.rutas || []).length;
    const origenes = [...new Set((c.rutas || []).map(r => String(r.origen).split(",")[0]))];
    const servicio = c.tipoServicio && c.tipoServicio !== "nacional" ? ` (${(SERVICIOS[c.tipoServicio] || "").toLowerCase()})` : "";
    return `${saludo ? saludo + ", buen día." : "Buen día."}\n\nPor medio del presente te comparto nuestra cotización ${c.folio} para el servicio de autotransporte de carga ${(CARGAS[c.tipoCarga] || "").toLowerCase()}${servicio}, con ${n} ruta${n === 1 ? "" : "s"}${origenes.length === 1 ? " desde " + origenes[0] : ""}.\n\n${c.vencimientoMs ? `La propuesta tiene vigencia hasta el ${fechaLarga(c.vencimientoMs)}.` : "La tarifa es válida para un solo servicio (único evento)."} Adjunto el documento con el detalle de tarifas y condiciones.\n\nQuedo a tus órdenes.\n\nUn saludo.\n\n${[f.nombre, f.puesto, "Autotransportes Alanis", f.telefono].filter(Boolean).join("\n")}`;
  }
  function abrirEnvio(id) {
    const c = cotizaciones.get(id), cli = c && clientes.get(c.clienteId);
    if (!c) return;
    const contactos = ((cli && cli.contactos) || []).filter(k => correoValido(k.correo));
    const elegidos = contactos.map((k, i) => ({ ...k, sel: i === 0, tipo: "para" }));
    const extras = [];
    const primerNombre = (t) => String(t || "").trim().split(/\s+/)[0].toLowerCase().replace(/^./, x => x.toUpperCase());
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML = `<div class="modal-tarjeta" style="max-width:640px;width:100%;max-height:92vh;overflow:auto;">
      <h2 style="margin:0 0 4px;">Enviar ${esc(c.folio)}</h2>
      <p class="nota" style="margin:0;">Sale de ${esc(yo.correo)} con el PDF adjunto. Al enviarla pasa a ENVIADA.</p>
      <div class="co-h3">Destinatarios</div>
      <div id="en-lista"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px;">
        <input type="email" id="en-nuevo" placeholder="Agregar otro correo" style="flex:1;min-width:200px;">
        <button type="button" class="secundario co-mini" id="en-agregar">Agregar</button></div>
      <label style="display:flex;gap:6px;align-items:center;margin-top:6px;font-weight:400;font-size:12.5px;"><input type="checkbox" id="en-guardar" checked style="width:auto;"> Guardar los correos nuevos en los contactos de ${esc(c.clienteNombre)}</label>
      <label style="display:flex;gap:6px;align-items:center;margin-top:6px;font-weight:400;font-size:12.5px;"><input type="checkbox" id="en-yo" checked style="width:auto;"> Copia oculta para mí (${esc(yo.correo)})</label>
      <div class="co-campo" style="margin-top:12px;"><label>Asunto</label><input type="text" id="en-asunto" value="${esc(`Cotización ${c.folio} · Autotransportes Alanis`)}"></div>
      <div class="co-campo" style="margin-top:10px;"><label>Mensaje</label><textarea id="en-msg" rows="12"></textarea></div>
      <div class="error" id="en-err"></div>
      <div class="modal-acciones"><button type="button" class="secundario" data-cerrar>Cancelar</button><button type="button" id="en-ok">Enviar</button></div></div>`;
    document.body.appendChild(ov);
    const q = (s2) => ov.querySelector(s2);
    const err = (t) => { q("#en-err").textContent = t || ""; };
    const todos = () => [...elegidos, ...extras];
    const primero = () => todos().find(k => k.sel && k.tipo === "para");
    let msgTocado = false;
    const pintarMsg = () => { if (!msgTocado) q("#en-msg").value = mensajeCorreo(c, primero() ? primerNombre(primero().nombre) : ""); };
    const pintar = () => {
      q("#en-lista").innerHTML = todos().length ? todos().map((k, i) => `<div style="display:flex;gap:8px;align-items:center;padding:5px 0;font-size:13px;">
          <input type="checkbox" data-sel="${i}" style="width:auto;"${k.sel ? " checked" : ""}>
          <span style="flex:1;">${esc(k.nombre || k.correo)}${k.puesto ? ` <small class="nota">· ${esc(k.puesto)}</small>` : ""}<br><small class="nota">${esc(k.correo)}${k.nuevo ? " · nuevo" : ""}</small></span>
          <span class="co-seg"><button type="button" class="${k.tipo === "para" ? "activo" : ""}" data-tipo="${i}" data-v="para">Para</button><button type="button" class="${k.tipo === "cc" ? "activo" : ""}" data-tipo="${i}" data-v="cc">CC</button></span></div>`).join("")
        : `<p class="nota">${esc(c.clienteNombre)} no tiene contactos con correo. Agrega uno abajo.</p>`;
      ov.querySelectorAll("[data-sel]").forEach(x => x.addEventListener("change", () => { todos()[Number(x.dataset.sel)].sel = x.checked; pintarMsg(); }));
      ov.querySelectorAll("[data-tipo]").forEach(x => x.addEventListener("click", () => { todos()[Number(x.dataset.tipo)].tipo = x.dataset.v; pintar(); pintarMsg(); }));
    };
    pintar(); pintarMsg();
    q("#en-msg").addEventListener("input", () => { msgTocado = true; });
    q("#en-agregar").addEventListener("click", () => {
      const v = q("#en-nuevo").value.trim().toLowerCase();
      if (!correoValido(v)) { err("Ese correo no es válido."); return; }
      if (todos().some(k => String(k.correo).toLowerCase() === v)) { err("Ese correo ya está en la lista."); return; }
      err(); extras.push({ nombre: "", correo: v, sel: true, tipo: primero() ? "cc" : "para", nuevo: true });
      q("#en-nuevo").value = ""; pintar(); pintarMsg();
    });
    q("#en-nuevo").addEventListener("keydown", (e2) => { if (e2.key === "Enter") { e2.preventDefault(); q("#en-agregar").click(); } });
    ov.querySelector("[data-cerrar]").addEventListener("click", () => ov.remove());
    q("#en-ok").addEventListener("click", async () => {
      const sel = todos().filter(k => k.sel);
      const para = sel.filter(k => k.tipo === "para"), cc = sel.filter(k => k.tipo === "cc");
      if (!para.length) { err("Elige al menos un destinatario en Para."); return; }
      const asunto = q("#en-asunto").value.trim(), mensaje = q("#en-msg").value.trim();
      if (!asunto || !mensaje) { err("Escribe el asunto y el mensaje."); return; }
      err();
      const b = q("#en-ok"); b.disabled = true; b.textContent = "Enviando…";
      try {
        const archivo = await generarPdf(c, cli, ajustes, firmaDe(c.creadoPorUid), { descargar: false });
        const dir = (k) => ({ email: k.correo, nombre: k.nombre || "" });
        const r = await fnEnviar({ folio: c.folio, para: para.map(dir), cc: cc.map(dir), copiaParaMi: q("#en-yo").checked, asunto, mensaje, pdfBase64: archivo.base64 });
        const nuevos = extras.filter(k => k.sel);
        if (q("#en-guardar").checked && nuevos.length && cli) {
          try { await updateDoc(doc(db, COL_CLI, cli.id), { contactos: [...(cli.contactos || []), ...nuevos.map(k => ({ nombre: "", puesto: "", telefono: "", correo: k.correo }))], actualizadoMs: Date.now() }); } catch (x) { /* el envío ya salió */ }
        }
        ov.remove();
        avisar(`${c.folio} enviada a ${para.map(k => k.correo).join(", ")}${r.data && r.data.remitente && r.data.remitente !== yo.correo ? ` (salió de ${r.data.remitente}, con respuesta a tu correo)` : ""}.`);
      } catch (x) {
        b.disabled = false; b.textContent = "Enviar";
        err("No se pudo enviar: " + (x.message || x));
      }
    });
  }
  // ---- WhatsApp (celular): menú de compartir con el PDF ----
  async function compartirWhatsApp(id) {
    const c = cotizaciones.get(id), cli = c && clientes.get(c.clienteId);
    if (!c) return;
    error();
    try {
      const archivo = await generarPdf(c, cli, ajustes, firmaDe(c.creadoPorUid), { descargar: false });
      const file = new File([archivo.blob], archivo.nombre, { type: "application/pdf" });
      const texto = `Buen día. Te comparto la cotización ${c.folio} de Autotransportes Alanis, ${c.vencimientoMs ? `vigente hasta el ${fechaLarga(c.vencimientoMs)}` : "válida para un solo servicio (único evento)"}.`;
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: c.folio, text: texto });
      } else {
        // Sin compartir archivos: se descarga el PDF y se abre WhatsApp con el texto.
        const a = document.createElement("a"); a.href = URL.createObjectURL(archivo.blob); a.download = archivo.nombre; a.click();
        window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank");
      }
      const cambios = { envios: arrayUnion({ ms: Date.now(), canal: "whatsapp", para: [], cc: [], por: { uid, nombre: yo.nombre } }), actualizadoMs: Date.now() };
      if (c.estado === "borrador") cambios.estado = "enviada";
      await updateDoc(doc(db, COL_COT, c.id), cambios);
      editor = null; fichaId = c.clienteId; render();
      avisar(`${c.folio} compartida por WhatsApp.`);
    } catch (x) {
      if (x && x.name === "AbortError") return; // canceló el menú de compartir
      error("No se pudo compartir: " + (x.message || x));
    }
  }

  async function pdfDe(id) {
    const c = cotizaciones.get(id);
    if (!c) return;
    try { await generarPdf(c, clientes.get(c.clienteId), ajustes, firmaDe(c.creadoPorUid)); }
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

}

// ---- Ajustes de Comercial (los dibuja Configuración → 2 · Utilidades) --------------
// caja: donde se dibuja el formulario; resumen: el texto de una línea del acordeón.
export function iniciarAjustesComercial(caja, resumen) {
  inyectarEstilos();
  let ajustes = { ...AJUSTES_BASE };
  const pintarResumen = () => {
    if (!resumen) return;
    const impo = umbralDe(ajustes, "importacion", 999);
    resumen.textContent = `Impo RL ${impo.verde}/${impo.ambar} · TC ${ajustes.tipoCambio} · vigencia ${textoVigencia(ajustes.vigenciaDias)} · ORS ${ajustes.orsKey ? "conectado" : "sin clave"}`;
  };
  const pintar = () => {
    caja.innerHTML = `
      <p class="nota">Reglas de Comercial: umbrales del semáforo e importe sugerido, tipo de cambio, vigencia por omisión, clave de OpenRouteService (km por camión y mapa), catálogo de condiciones, cruce por aduana y demoras.</p>
      <div id="caj-error" class="error"></div>
      <p id="caj-exito" class="nota oculto" style="color:#1c7a41;"></p>
      <div class="co-grid" style="max-width:760px;">
        <div style="grid-column:1/-1;"><label>Umbrales de ingreso por km (MXN). Verde = importe sugerido; abajo del ámbar = rojo.</label>
          <div class="tabla-wrap"><table class="tabla co-tabla" style="max-width:640px;">
            <thead><tr><th>Servicio</th><th class="n">RC verde</th><th class="n">RC ámbar</th><th class="n">RL verde</th><th class="n">RL ámbar</th></tr></thead>
            <tbody>${Object.entries(SERV_UMBRAL).map(([sv, k]) => `<tr><td>${esc(SERVICIOS[sv])}</td>${["rc_verde", "rc_ambar", "rl_verde", "rl_ambar"].map(c => `<td class="n"><input type="number" step="0.01" min="0" data-umbral="${k}_${c}" value="${esc(umbralDe(ajustes, sv, c.startsWith("rc") ? 1 : 999)[c.endsWith("verde") ? "verde" : "ambar"])}" style="width:90px;"></td>`).join("")}</tr>`).join("")}</tbody>
          </table></div><small class="nota">RC = 350 km o menos · RL = 351 km o más.</small></div>
        <div><label>Tipo de cambio sugerido</label><input type="number" step="0.01" id="caj-tc" value="${esc(ajustes.tipoCambio)}"></div>
        <div><label>Vigencia por omisión</label><select id="caj-vig">${opcionesVigencia(ajustes.vigenciaDias).map(d => `<option value="${d}"${d === Number(ajustes.vigenciaDias) ? " selected" : ""}>${textoVigencia(d)}</option>`).join("")}</select></div>
        <div style="grid-column:1/-1;"><label>Clave de OpenRouteService</label><input type="text" id="caj-ors" value="${esc(ajustes.orsKey || "")}" placeholder="Pega aquí la clave de openrouteservice.org" autocomplete="off"></div>
      </div>
      <p class="nota">La clave de ORS la ven quienes tienen Comercial (la usa su navegador). Plan gratis: 2,000 rutas y 1,000 búsquedas al día.</p>
      <div class="co-h3">Condiciones (catálogo)</div>
      <p class="nota" style="margin-top:0;">En cada cotización nueva salen todas marcadas, en este orden; quien cotiza desmarca las que no aplican. Las cotizaciones ya hechas no cambian. Escribe [moneda] donde deba decir "pesos mexicanos (MXN)" o "dólares americanos (USD)" según la cotización.</p>
      <div id="caj-conds" style="max-width:760px;"></div>
      <button type="button" class="co-link" id="caj-cond-mas" style="font-size:13px;margin-top:6px;">+ Agregar condición</button>
      <div class="co-h3">Cruce</div>
      <div class="tabla-wrap"><table class="tabla co-tabla" style="max-width:560px;">
        <thead><tr><th>Concepto</th><th>Aduana</th><th class="n">Monto MXN</th><th class="n">Monto USD</th></tr></thead>
        <tbody>${crucesDe(ajustes).map(a => `<tr><td>Cruce</td><td><b>${esc(a.nombre)}</b></td><td class="n"><input type="number" min="0" step="0.01" data-cruce="${esc(a.id)}" data-mon="mxn" value="${esc(a.mxn)}" style="width:110px;"></td><td class="n"><input type="number" min="0" step="0.01" data-cruce="${esc(a.id)}" data-mon="usd" value="${esc(a.usd)}" style="width:110px;"></td></tr>`).join("")}</tbody>
      </table></div>
      <small class="nota">Solo en Importación y Exportación. En la cotización se elige "Incluye cruce" Sí/No y la aduana (NLD / COL); el monto sale en las condiciones, en la moneda de la cotización.</small>
      <div class="co-h3">Demoras</div>
      <div class="tabla-wrap"><table class="tabla co-tabla" style="max-width:720px;">
        <thead><tr><th>Lugar</th><th class="n">Tiempo libre (h)</th><th class="n">Cargo después</th><th>Por</th><th>Moneda</th></tr></thead>
        <tbody>${demorasDe(ajustes).map(d => `<tr data-dem="${esc(d.id)}"><td><b>${esc(d.lugar)}</b></td>
          <td class="n"><input type="number" min="0" step="1" data-d="libre" value="${esc(d.libre)}" style="width:80px;"></td>
          <td class="n"><input type="number" min="0" step="0.01" data-d="cargo" value="${esc(d.cargo)}" style="width:110px;"></td>
          <td><select data-d="por" style="width:auto;"><option value="hora"${d.por === "hora" ? " selected" : ""}>hora</option><option value="dia"${d.por !== "hora" ? " selected" : ""}>día</option></select></td>
          <td><select data-d="moneda" style="width:auto;"><option value="MXN"${d.moneda !== "USD" ? " selected" : ""}>MXN</option><option value="USD"${d.moneda === "USD" ? " selected" : ""}>USD</option></select></td></tr>`).join("")}</tbody>
      </table></div>
      <small class="nota">Cada lugar sale como condición (con interruptor) en la cotización, p. ej.: "${esc(textoDemora(demorasDe(ajustes).find(d => d.id === "patio")))}" Por día se cobra por día o fracción. Aduana solo sale cuando la cotización incluye cruce. Los borradores toman estos valores al abrirlos; las enviadas no cambian.</small>
      <div class="acciones-form" style="margin-top:14px;"><button type="button" id="caj-ok">Guardar</button></div>`;
    const q = (sel) => caja.querySelector(sel);
    const err = (t) => { q("#caj-error").textContent = t || ""; };
    // Catálogo de condiciones: editar, ordenar (↑ ↓), quitar y agregar.
    const conds = catalogoCondiciones(ajustes).map(c => ({ ...c }));
    const pintarConds = () => {
      q("#caj-conds").innerHTML = conds.map((c, k) => `<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
        <span class="nota" style="width:18px;text-align:right;">${k + 1}.</span>
        <input type="text" data-ct="${k}" value="${esc(c.texto)}" style="flex:1;min-width:0;" placeholder="Texto de la condición">
        <button type="button" class="secundario co-mini" data-cm="${k}" data-dir="-1" title="Subir"${k ? "" : " disabled"}>↑</button>
        <button type="button" class="secundario co-mini" data-cm="${k}" data-dir="1" title="Bajar"${k < conds.length - 1 ? "" : " disabled"}>↓</button>
        <button type="button" class="secundario co-mini" data-cx="${k}" title="Quitar">✕</button></div>`).join("") || `<p class="nota">Sin condiciones en el catálogo.</p>`;
      caja.querySelectorAll("[data-ct]").forEach(i => i.addEventListener("input", () => { conds[Number(i.dataset.ct)].texto = i.value; }));
      caja.querySelectorAll("[data-cm]").forEach(b => b.addEventListener("click", () => {
        const k = Number(b.dataset.cm), j = k + Number(b.dataset.dir); [conds[k], conds[j]] = [conds[j], conds[k]]; pintarConds();
      }));
      caja.querySelectorAll("[data-cx]").forEach(b => b.addEventListener("click", () => { conds.splice(Number(b.dataset.cx), 1); pintarConds(); }));
    };
    pintarConds();
    q("#caj-cond-mas").addEventListener("click", () => {
      conds.push({ id: "c" + Date.now().toString(36), texto: "" }); pintarConds();
      const ins = caja.querySelectorAll("[data-ct]"); ins[ins.length - 1].focus();
    });
    q("#caj-ok").addEventListener("click", async () => {
      const tc = num(q("#caj-tc").value), vig = num(q("#caj-vig").value);
      const umbrales = {};
      caja.querySelectorAll("[data-umbral]").forEach(i => { umbrales[i.dataset.umbral] = num(i.value) || 0; });
      for (const k of Object.values(SERV_UMBRAL)) for (const t of ["rc", "rl"]) {
        if (umbrales[`${k}_${t}_ambar`] > umbrales[`${k}_${t}_verde`]) { err("En cada servicio, el ámbar debe ser menor o igual que el verde."); return; }
      }
      if (!(tc > 0) || vig == null || vig < 0) { err("Revisa el tipo de cambio y la vigencia."); return; }
      const condicionesLista = conds.map(c => ({ id: c.id, texto: String(c.texto || "").trim() })).filter(c => c.texto);
      const cruces = crucesDe(ajustes).map(a => ({ id: a.id, nombre: a.nombre,
        mxn: num(q(`[data-cruce="${a.id}"][data-mon="mxn"]`).value), usd: num(q(`[data-cruce="${a.id}"][data-mon="usd"]`).value) }));
      if (cruces.some(a => !(a.mxn >= 0) || !(a.usd >= 0))) { err("Escribe el monto del cruce en MXN y USD de cada aduana."); return; }
      const demoras = [...caja.querySelectorAll("[data-dem]")].map(tr => {
        const v = (k) => tr.querySelector(`[data-d="${k}"]`).value;
        return { id: tr.dataset.dem, libre: num(v("libre")), cargo: num(v("cargo")), por: v("por"), moneda: v("moneda") };
      });
      if (demoras.some(d => !(d.libre >= 0) || !(d.cargo >= 0))) { err("Revisa el tiempo libre y el cargo de cada demora."); return; }
      err();
      try {
        await setDoc(doc(db, COL_CFG, "ajustes"), { umbrales, tipoCambio: tc, vigenciaDias: Math.round(vig), orsKey: q("#caj-ors").value.trim(),
          condiciones: ajustes.condiciones, // texto viejo: lo siguen usando las cotizaciones de antes del catálogo
          condicionesLista, cruces, demoras, actualizadoMs: Date.now() });
        const ok = q("#caj-exito"); ok.textContent = "Ajustes de Comercial guardados."; ok.classList.remove("oculto"); setTimeout(() => ok.classList.add("oculto"), 5000);
      } catch (x) { err("No se pudieron guardar: " + x.message); }
    });
  };
  let primera = true;
  const cancelar = onSnapshot(doc(db, COL_CFG, "ajustes"), (s) => {
    ajustes = { ...AJUSTES_BASE, ...(s.exists() ? s.data() : {}) };
    pintarResumen();
    if (primera) { primera = false; pintar(); } // no se redibuja mientras escribes
  }, (e) => { caja.innerHTML = `<p class="error">No se pudieron leer los ajustes de Comercial: ${esc(e.message)}</p>`; });
  const vigilar = setInterval(() => { if (!caja.isConnected) { clearInterval(vigilar); cancelar(); } }, 3000);
}