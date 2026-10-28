// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/public/js/mantenimiento.js
// ##########################################################################
import { db } from "./firebase-config.js";
import {
  collection, doc, getDocs, onSnapshot, addDoc, updateDoc, query, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";

// ============================================================================
// Utilidades → Mantenimiento (2026-10-28, pedido de Ivan).
// Solicitudes de mantenimiento de REMOLQUES (solo tipo REMOLQUE y activos del
// Inventario). Folio consecutivo OT-IMPO-00001-26 que toma la función
// crearSolicitudMantenimiento (functions/mantenimiento.js).
//   - Ubicación: "Bodega Laredo TX" o un lugar de la lista
//     (mantenimiento_lugares), que los mismos usuarios van agregando con su
//     nombre y una coordenada GPS o liga de Maps.
//   - Falla: categorías rápidas (varias) + descripción libre.
//   - Compartir: en computadora se copia el texto; en celular abre WhatsApp con
//     el mensaje listo para elegir el grupo.
//   - Terminar: cualquiera con acceso, con fecha, hora y qué se hizo.
// ============================================================================

const funciones = getFunctions(undefined, "us-central1");
const fnCrear = httpsCallable(funciones, "crearSolicitudMantenimiento");

const COL = "mantenimiento_solicitudes";
const COL_LUGARES = "mantenimiento_lugares";
const BODEGA = "Bodega Laredo TX";
const FALLAS = [
  "Llantas", "Frenos", "Luces / eléctrico", "Suspensión", "Puertas / sellos", "Piso / caja", "Golpe / estructura",
  "Thermo: no enciende", "Thermo: marca alarmas", "Thermo: tirando diésel", "Thermo: no enfría / no mantiene temperatura",
  "Thermo: batería", "Thermo: sin diésel", "Otra",
];

function esc(t) { const d = document.createElement("div"); d.textContent = t == null ? "" : String(t); return d.innerHTML; }
function esCelular() {
  return /iphone|ipad|ipod|android|mobi/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function pad(n) { return String(n).padStart(2, "0"); }
function fechaHoraTexto(ms) {
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function valorLocal(ms) { // para <input type="datetime-local">
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// "27.43, -99.55" o una liga de Maps → { lat, lng, liga }
export function leerCoordenada(texto) {
  const t = String(texto || "").trim();
  if (!t) return null;
  const num = "(-?\\d{1,3}\\.\\d+)";
  const pares = [
    new RegExp(`^${num}\\s*,\\s*${num}$`),
    new RegExp(`@${num},${num}`),
    new RegExp(`[?&](?:q|query|ll|destination)=${num}(?:,|%2C)\\s*${num}`, "i"),
    new RegExp(`!3d${num}!4d${num}`),
  ];
  for (const re of pares) {
    const m = t.match(re);
    if (m) {
      const lat = Number(m[1]), lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng, liga: /^https?:\/\//i.test(t) ? t : "" };
    }
  }
  if (/^https?:\/\//i.test(t)) return { lat: null, lng: null, liga: t }; // liga corta (maps.app.goo.gl): se guarda tal cual
  return null;
}
function ligaMapa(u) {
  if (!u) return "";
  if (u.lat != null && u.lng != null) return `https://maps.google.com/?q=${u.lat},${u.lng}`;
  return u.liga || "";
}

export function mensajeSolicitud(s) {
  const r = s.remolque || {};
  const u = s.ubicacion || {};
  const desc = [r.marca, r.modelo, r.placas ? "Placas " + r.placas : ""].filter(Boolean).join(" · ");
  const lineas = [
    "*SOLICITUD DE MANTENIMIENTO*",
    `*${s.folio}*`,
    "",
    `Remolque: *${r.id}*${desc ? ` (${desc})` : ""}`,
    `Fecha: ${s.fechaTexto || ""}`,
    `Solicita: ${(s.solicitadoPor || {}).nombre || ""}`,
    `Ubicación: ${u.nombre || ""}${u.detalle ? " — " + u.detalle : ""}`,
  ];
  const mapa = ligaMapa(u);
  if (mapa) lineas.push(`Mapa: ${mapa}`);
  if ((s.fallas || []).length) lineas.push(`Falla: ${s.fallas.join(", ")}`);
  if (s.descripcion) lineas.push(`Detalle: ${s.descripcion}`);
  if (s.estado === "terminada") {
    lineas.push("", `*TERMINADA* ${s.terminadaMs ? fechaHoraTexto(s.terminadaMs) : ""}${s.comentarioCierre ? " — " + s.comentarioCierre : ""}`);
  }
  return lineas.join("\n");
}

async function copiar(texto) {
  try { await navigator.clipboard.writeText(texto); return true; } catch (e) { /* respaldo abajo */ }
  const ta = document.createElement("textarea");
  ta.value = texto; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}
function botonesCompartir(s) {
  const texto = mensajeSolicitud(s);
  const wa = `https://wa.me/?text=${encodeURIComponent(texto)}`;
  return esCelular()
    ? `<a class="boton mt-wa" href="${esc(wa)}" target="_blank" rel="noopener">Enviar por WhatsApp</a>
       <button type="button" class="secundario mt-copiar">Copiar texto</button>`
    : `<button type="button" class="mt-copiar">📋 Copiar para pegar</button>`;
}
function enlazarCompartir(caja, s) {
  caja.querySelectorAll(".mt-copiar").forEach(b => b.addEventListener("click", async () => {
    const ok = await copiar(mensajeSolicitud(s));
    const antes = b.textContent;
    b.textContent = ok ? "✓ Copiado" : "No se pudo copiar";
    setTimeout(() => { b.textContent = antes; }, 2500);
  }));
}

function inyectarEstilos() {
  if (document.getElementById("estilos-mantenimiento")) return;
  const s = document.createElement("style");
  s.id = "estilos-mantenimiento";
  s.textContent = `
    .mt-tabs { display:flex; gap:6px; flex-wrap:wrap; margin:0 0 14px; }
    .mt-tab, .mt-chip { background:#fff; border:1px solid #e2ddd5; border-radius:16px; padding:6px 12px; font:inherit; font-size:13px; color:#6b5f52; cursor:pointer; }
    .mt-tab.activo, .mt-chip.activo { background:#2c1e0f; border-color:#2c1e0f; color:#fff; }
    .mt-chips { display:flex; gap:6px; flex-wrap:wrap; }
    .mt-sug { border:1px solid #e2ddd5; border-radius:9px; margin-top:4px; overflow:hidden; }
    .mt-sug button { display:block; width:100%; text-align:left; background:#fff; border:0; border-top:1px solid #f0ece6; padding:8px 12px; font:inherit; font-size:13px; color:#2c1e0f; cursor:pointer; }
    .mt-sug button:first-child { border-top:0; } .mt-sug button:hover { background:#f7f3ee; }
    .mt-sug small, .mt-elegido small { color:#8a7f73; }
    .mt-elegido { border:1px solid #2c1e0f; border-radius:9px; padding:9px 12px; margin-top:6px; font-size:13.5px; display:flex; justify-content:space-between; gap:8px; align-items:center; }
    .mt-dos { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
    .mt-ro { background:#f7f3ee; border:1px solid #e2ddd5; border-radius:9px; padding:9px 12px; font-size:14px; }
    .mt-nuevo-lugar { border:1px dashed #cbbfb0; border-radius:10px; padding:10px 12px; margin-top:8px; background:#fbfaf8; }
    .mt-folio { font-size:24px; font-weight:800; letter-spacing:.5px; }
    .mt-msg { white-space:pre-wrap; font:12.5px/1.5 ui-monospace,Menlo,Consolas,monospace; background:#f7f3ee; border:1px solid #e2ddd5; border-radius:10px; padding:12px; margin-top:10px; }
    .mt-acciones { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; align-items:center; }
    .mt-wa { background:#1f9d55 !important; color:#fff !important; border-radius:8px; padding:10px 14px; text-decoration:none; font-weight:700; display:inline-block; }
    .mt-estado { display:inline-block; font-size:11px; font-weight:800; padding:3px 9px; border-radius:11px; white-space:nowrap; }
    .mt-ab { background:#FBE3A8; color:#7a3e06; } .mt-te { background:#EAF3DE; color:#3B7A1E; }
    .mt-tabla tr.clic { cursor:pointer; } .mt-tabla tr.clic:hover td { background:#faf7f2; }
    .mt-tabla td { vertical-align:top; }
    @media (max-width:560px) { .mt-dos { grid-template-columns:1fr; } }
  `;
  document.head.appendChild(s);
}

// Remolques activos del Inventario (una lectura por sesión).
let cacheRemolques = null;
async function cargarRemolques() {
  if (cacheRemolques) return cacheRemolques;
  const [cat, est] = await Promise.all([getDocs(collection(db, "inventario_catalogo")), getDocs(collection(db, "inventario_estatus"))]);
  const estatus = new Map(est.docs.map(d => [d.id, d.data()]));
  const lista = [];
  cat.docs.forEach(d => {
    if (d.id === "meta") return;
    (d.data().unidades || []).forEach(u => {
      if (u.tipo !== "REMOLQUE") return;
      const e = estatus.get(u.id);
      const deOtraSerie = e && e.serie && u.serie && e.serie !== u.serie;
      if (e && !deOtraSerie && e.estatus && e.estatus !== "activa") return; // baja o vendida
      lista.push({ id: u.id, marca: u.marca || "", modelo: u.modelo || "", placas: u.placas || "", serie: u.serie || "" });
    });
  });
  lista.sort((a, b) => a.id.localeCompare(b.id, "es", { numeric: true }));
  cacheRemolques = lista;
  return lista;
}

export function iniciarMantenimiento(contenedor, datosUsuario, uid) {
  inyectarEstilos();
  contenedor.innerHTML = `
    <section class="panel">
      <h2 style="margin:0 0 4px;">Mantenimiento</h2>
      <p class="nota" style="margin:0 0 12px;">Solicitudes de mantenimiento de remolques.</p>
      <div class="mt-tabs" id="mt-tabs"></div>
      <div id="mt-error" class="error"></div>
      <div id="mt-cuerpo"></div>
    </section>`;
  const $ = (s) => contenedor.querySelector(s);
  let tab = "nueva";
  let lugares = [];
  let solicitudes = null;
  let filtro = "abiertas";
  let busqueda = "";
  // estado del formulario
  const form = { remolque: null, ubicacion: { tipo: "bodega", nombre: BODEGA }, detalle: "", fallas: new Set(), descripcion: "" };
  let enviada = null;
  let enviando = false;

  const cancelarLugares = onSnapshot(collection(db, COL_LUGARES), (snap) => {
    lugares = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));
    if (tab === "nueva" && !enviada) pintarLugares();
  }, (err) => { $("#mt-error").textContent = "No se pudieron leer los lugares: " + err.message; });
  const cancelarSolicitudes = onSnapshot(query(collection(db, COL), orderBy("ms", "desc"), limit(500)), (snap) => {
    solicitudes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (tab === "lista") renderLista();
    renderTabs();
  }, (err) => { $("#mt-error").textContent = "No se pudieron leer las solicitudes: " + err.message; });
  const vigilar = setInterval(() => {
    if (!contenedor.isConnected) { clearInterval(vigilar); cancelarLugares(); cancelarSolicitudes(); }
  }, 3000);

  function renderTabs() {
    const abiertas = (solicitudes || []).filter(s => s.estado === "abierta").length;
    $("#mt-tabs").innerHTML = [["nueva", "Nueva solicitud"], ["lista", `Solicitudes${solicitudes ? ` (${abiertas} abierta${abiertas === 1 ? "" : "s"})` : ""}`]]
      .map(([k, t]) => `<button type="button" class="mt-tab${tab === k ? " activo" : ""}" data-t="${k}">${t}</button>`).join("");
    $("#mt-tabs").querySelectorAll(".mt-tab").forEach(b => b.addEventListener("click", () => { tab = b.dataset.t; render(); }));
  }
  function render() {
    renderTabs();
    $("#mt-error").textContent = "";
    if (tab === "nueva") renderNueva(); else renderLista();
  }

  // ---- Nueva solicitud ----
  function renderNueva() {
    if (enviada) return renderEnviada();
    const c = $("#mt-cuerpo");
    c.innerHTML = `
      <label for="mt-rem">Remolque</label>
      <input type="text" id="mt-rem" placeholder="Escribe el número económico o las placas…" autocomplete="off">
      <div id="mt-rem-sug"></div>
      <div id="mt-rem-elegido"></div>
      <div class="mt-dos" style="margin-top:10px;">
        <div><label>Fecha y hora</label><div class="mt-ro" id="mt-ahora">${fechaHoraTexto(Date.now())}</div></div>
        <div><label>Solicita</label><div class="mt-ro">${esc((datosUsuario && datosUsuario.nombre) || "")}</div></div>
      </div>
      <label>¿Dónde está el remolque?</label>
      <div class="mt-chips"><button type="button" class="mt-chip" id="mt-bodega">${BODEGA}</button></div>
      <select id="mt-lugar" style="margin-top:8px;"></select>
      <div id="mt-nuevo-lugar"></div>
      <input type="text" id="mt-detalle" maxlength="300" placeholder="Detalle (opcional): cajón, andén, cliente, km…" style="margin-top:8px;">
      <label>Falla que presenta <span class="nota" style="font-weight:400;text-transform:none;">(puedes marcar varias)</span></label>
      <div class="mt-chips" id="mt-fallas">${FALLAS.map(f => `<button type="button" class="mt-chip" data-f="${esc(f)}">${esc(f)}</button>`).join("")}</div>
      <label for="mt-desc">Descripción</label>
      <textarea id="mt-desc" rows="3" maxlength="1000" placeholder="Más detalles de la falla…"></textarea>
      <div class="error" id="mt-ferror"></div>
      <div class="acciones-form" style="margin-top:12px;"><button type="button" id="mt-enviar">Enviar solicitud</button></div>`;
    const reloj = setInterval(() => { const a = $("#mt-ahora"); if (a) a.textContent = fechaHoraTexto(Date.now()); else clearInterval(reloj); }, 30000);

    // Remolque
    const inp = $("#mt-rem");
    inp.addEventListener("input", () => sugerir(inp.value));
    pintarElegido();
    cargarRemolques().catch(e => { $("#mt-error").textContent = "No se pudo leer el Inventario: " + e.message; });

    // Ubicación
    $("#mt-bodega").addEventListener("click", () => { form.ubicacion = { tipo: "bodega", nombre: BODEGA }; pintarLugares(); });
    $("#mt-lugar").addEventListener("change", (e) => {
      const v = e.target.value;
      if (v === "__nuevo") { abrirNuevoLugar(); return; }
      if (!v) { form.ubicacion = { tipo: "bodega", nombre: BODEGA }; pintarLugares(); return; }
      const l = lugares.find(x => x.id === v);
      if (l) form.ubicacion = { tipo: "lugar", lugarId: l.id, nombre: l.nombre, lat: l.lat ?? null, lng: l.lng ?? null, liga: l.liga || "" };
      pintarLugares();
    });
    pintarLugares();
    $("#mt-detalle").value = form.detalle;
    $("#mt-detalle").addEventListener("input", (e) => { form.detalle = e.target.value; });

    // Fallas
    $("#mt-fallas").querySelectorAll(".mt-chip").forEach(b => {
      b.classList.toggle("activo", form.fallas.has(b.dataset.f));
      b.addEventListener("click", () => {
        const f = b.dataset.f;
        if (form.fallas.has(f)) form.fallas.delete(f); else form.fallas.add(f);
        b.classList.toggle("activo", form.fallas.has(f));
      });
    });
    $("#mt-desc").value = form.descripcion;
    $("#mt-desc").addEventListener("input", (e) => { form.descripcion = e.target.value; });
    $("#mt-enviar").addEventListener("click", enviar);
  }

  async function sugerir(texto) {
    const caja = $("#mt-rem-sug");
    const t = String(texto || "").trim().toUpperCase();
    if (!t) { caja.innerHTML = ""; return; }
    let lista;
    try { lista = await cargarRemolques(); } catch (e) { caja.innerHTML = ""; return; }
    const exactos = lista.filter(r => r.id.toUpperCase() === t);
    const empiezan = lista.filter(r => r.id.toUpperCase() !== t && r.id.toUpperCase().startsWith(t));
    const contienen = lista.filter(r => !r.id.toUpperCase().startsWith(t) && (r.id.toUpperCase().includes(t) || r.placas.toUpperCase().includes(t)));
    const res = [...exactos, ...empiezan, ...contienen].slice(0, 8);
    caja.innerHTML = res.length
      ? `<div class="mt-sug">${res.map(r => `<button type="button" data-id="${esc(r.id)}"><b>${esc(r.id)}</b> · ${esc([r.marca, r.modelo].filter(Boolean).join(" "))}${r.placas ? ` <small>· Placas ${esc(r.placas)}</small>` : ""}</button>`).join("")}</div>`
      : `<p class="nota" style="margin:6px 0 0;">No encontré un remolque activo con "${esc(texto)}".</p>`;
    caja.querySelectorAll("button[data-id]").forEach(b => b.addEventListener("click", () => {
      form.remolque = lista.find(r => r.id === b.dataset.id) || null;
      caja.innerHTML = ""; $("#mt-rem").value = "";
      pintarElegido();
    }));
  }
  function pintarElegido() {
    const caja = $("#mt-rem-elegido");
    if (!caja) return;
    const r = form.remolque;
    caja.innerHTML = r ? `<div class="mt-elegido"><span><b>${esc(r.id)}</b> · ${esc([r.marca, r.modelo].filter(Boolean).join(" "))}${r.placas ? ` <small>· Placas ${esc(r.placas)}</small>` : ""}</span>
      <button type="button" class="secundario" id="mt-rem-quitar" style="padding:4px 9px;font-size:12px;">Cambiar</button></div>` : "";
    const q = $("#mt-rem-quitar");
    if (q) q.addEventListener("click", () => { form.remolque = null; pintarElegido(); $("#mt-rem").focus(); });
  }

  function pintarLugares() {
    const sel = $("#mt-lugar"), bod = $("#mt-bodega");
    if (!sel || !bod) return;
    const u = form.ubicacion;
    bod.classList.toggle("activo", u.tipo === "bodega");
    sel.innerHTML = `<option value="">${lugares.length ? "Otro lugar…" : "Otro lugar… (todavía no hay lugares guardados)"}</option>` +
      lugares.map(l => `<option value="${esc(l.id)}"${u.tipo === "lugar" && u.lugarId === l.id ? " selected" : ""}>${esc(l.nombre)}</option>`).join("") +
      `<option value="__nuevo">+ Agregar lugar nuevo…</option>`;
  }

  function abrirNuevoLugar() {
    const caja = $("#mt-nuevo-lugar");
    caja.innerHTML = `<div class="mt-nuevo-lugar">
      <label style="margin-top:0;" for="mt-nl-nombre">Nombre del lugar</label>
      <input type="text" id="mt-nl-nombre" maxlength="120" placeholder="Ej: Patio Fénix, Bodega Sigma Monterrey">
      <label for="mt-nl-coord">Coordenada GPS o liga de Maps</label>
      <input type="text" id="mt-nl-coord" maxlength="500" placeholder="27.4343, -99.5573  ó  https://maps.app.goo.gl/…">
      ${navigator.geolocation ? `<button type="button" class="secundario" id="mt-nl-gps" style="margin-top:6px;">📍 Usar mi ubicación actual</button>` : ""}
      <div class="error" id="mt-nl-error"></div>
      <div class="mt-acciones"><button type="button" id="mt-nl-guardar">Guardar lugar</button><button type="button" class="secundario" id="mt-nl-cancelar">Cancelar</button></div>
    </div>`;
    const cerrar = () => { caja.innerHTML = ""; pintarLugares(); };
    $("#mt-nl-cancelar").addEventListener("click", cerrar);
    const gps = $("#mt-nl-gps");
    if (gps) gps.addEventListener("click", () => {
      gps.disabled = true; gps.textContent = "Buscando ubicación…";
      navigator.geolocation.getCurrentPosition((p) => {
        $("#mt-nl-coord").value = `${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`;
        gps.disabled = false; gps.textContent = "📍 Usar mi ubicación actual";
      }, (e) => {
        $("#mt-nl-error").textContent = "No se pudo obtener la ubicación: " + e.message;
        gps.disabled = false; gps.textContent = "📍 Usar mi ubicación actual";
      }, { enableHighAccuracy: true, timeout: 15000 });
    });
    $("#mt-nl-guardar").addEventListener("click", async (ev) => {
      const err = $("#mt-nl-error");
      err.textContent = "";
      const nombre = $("#mt-nl-nombre").value.trim();
      const coord = leerCoordenada($("#mt-nl-coord").value);
      if (!nombre) { err.textContent = "Escribe el nombre del lugar."; return; }
      if (lugares.some(l => (l.nombre || "").toLowerCase() === nombre.toLowerCase()) || nombre.toLowerCase() === BODEGA.toLowerCase()) { err.textContent = "Ya existe un lugar con ese nombre."; return; }
      if (!coord) { err.textContent = "Escribe una coordenada (latitud, longitud) o pega una liga de Maps."; return; }
      ev.target.disabled = true;
      try {
        const ref = await addDoc(collection(db, COL_LUGARES), {
          nombre, lat: coord.lat, lng: coord.lng, liga: coord.liga,
          creadoPor: { uid, nombre: (datosUsuario && datosUsuario.nombre) || "" }, creadoEn: serverTimestamp(),
        });
        form.ubicacion = { tipo: "lugar", lugarId: ref.id, nombre, lat: coord.lat, lng: coord.lng, liga: coord.liga };
        cerrar();
      } catch (e) {
        err.textContent = "No se pudo guardar: " + e.message;
        ev.target.disabled = false;
      }
    });
    $("#mt-nl-nombre").focus();
  }

  async function enviar() {
    if (enviando) return;
    const err = $("#mt-ferror");
    err.textContent = "";
    if (!form.remolque) { err.textContent = "Elige el remolque."; return; }
    const descripcion = form.descripcion.trim();
    if (!form.fallas.size && !descripcion) { err.textContent = "Marca la falla o escribe una descripción."; return; }
    enviando = true;
    const btn = $("#mt-enviar"); btn.disabled = true; btn.textContent = "Enviando…";
    const datos = {
      remolque: form.remolque,
      ubicacion: { ...form.ubicacion, detalle: form.detalle.trim() },
      fallas: [...form.fallas],
      descripcion,
    };
    try {
      const r = await fnCrear(datos);
      const d = r.data || {};
      enviada = { ...datos, folio: d.folio, fechaTexto: d.fechaTexto, solicitadoPor: { nombre: d.solicitadoPor }, estado: "abierta" };
      form.remolque = null; form.fallas = new Set(); form.descripcion = ""; form.detalle = "";
      form.ubicacion = { tipo: "bodega", nombre: BODEGA };
      renderEnviada();
    } catch (e) {
      err.textContent = e.message || String(e);
      btn.disabled = false; btn.textContent = "Enviar solicitud";
    }
    enviando = false;
  }

  function renderEnviada() {
    const c = $("#mt-cuerpo");
    const s = enviada;
    c.innerHTML = `
      <p class="nota" style="margin:0;">Solicitud enviada</p>
      <div class="mt-folio">${esc(s.folio)}</div>
      <div class="nota" style="margin:2px 0 0;">${esc(s.fechaTexto)} · ${esc(s.solicitadoPor.nombre)}</div>
      <div class="mt-msg">${esc(mensajeSolicitud(s))}</div>
      <div class="mt-acciones">${botonesCompartir(s)}<button type="button" class="secundario" id="mt-otra">Nueva solicitud</button></div>
      <p class="nota">${esCelular() ? "Enviar por WhatsApp abre WhatsApp con el mensaje listo; elige el grupo de Mantenimiento." : "Copiar para pegar deja el texto listo para pegarlo en WhatsApp Web o en un correo."}</p>`;
    enlazarCompartir(c, s);
    $("#mt-otra").addEventListener("click", () => { enviada = null; renderNueva(); });
  }

  // ---- Lista ----
  function renderLista() {
    const c = $("#mt-cuerpo");
    if (!solicitudes) { c.innerHTML = `<p class="nota">Cargando…</p>`; return; }
    const abiertas = solicitudes.filter(s => s.estado === "abierta").length;
    const terminadas = solicitudes.filter(s => s.estado === "terminada").length;
    const t = busqueda.trim().toUpperCase();
    const vista = solicitudes.filter(s =>
      (filtro === "todas" || (filtro === "abiertas" ? s.estado === "abierta" : s.estado === "terminada")) &&
      (!t || (s.folio || "").toUpperCase().includes(t) || ((s.remolque || {}).id || "").toUpperCase().includes(t)));
    c.innerHTML = `
      <div class="mt-chips" style="margin-bottom:10px;align-items:center;">
        ${[["abiertas", `Abiertas ${abiertas}`], ["terminadas", `Terminadas ${terminadas}`], ["todas", `Todas ${solicitudes.length}`]]
          .map(([k, txt]) => `<button type="button" class="mt-chip${filtro === k ? " activo" : ""}" data-fl="${k}">${txt}</button>`).join("")}
        <input type="text" id="mt-buscar" placeholder="Buscar remolque o folio" value="${esc(busqueda)}" style="width:auto;min-width:200px;">
      </div>
      ${vista.length ? `<div class="tabla-wrap"><table class="tabla mt-tabla">
        <thead><tr><th>Folio</th><th>Remolque</th><th>Fecha</th><th>Solicita</th><th>Ubicación</th><th>Falla</th><th>Estado</th></tr></thead>
        <tbody>${vista.map(s => `<tr class="clic" data-id="${esc(s.id)}">
          <td><b>${esc(s.folio)}</b></td><td>${esc((s.remolque || {}).id)}</td><td>${esc(s.fechaTexto)}</td>
          <td>${esc((s.solicitadoPor || {}).nombre)}</td>
          <td>${esc((s.ubicacion || {}).nombre)}${(s.ubicacion || {}).detalle ? `<br><small class="nota">${esc(s.ubicacion.detalle)}</small>` : ""}</td>
          <td>${esc((s.fallas || []).join(", "))}${s.descripcion ? `<br><small class="nota">${esc(s.descripcion.length > 70 ? s.descripcion.slice(0, 70) + "…" : s.descripcion)}</small>` : ""}</td>
          <td>${s.estado === "terminada" ? `<span class="mt-estado mt-te">TERMINADA</span>${s.terminadaMs ? `<br><small class="nota">${esc(fechaHoraTexto(s.terminadaMs))}</small>` : ""}` : `<span class="mt-estado mt-ab">ABIERTA</span>`}</td>
        </tr>`).join("")}</tbody></table></div>`
        : `<p class="nota" style="text-align:center;padding:16px;">${solicitudes.length ? "No hay solicitudes con este filtro." : "Todavía no hay solicitudes."}</p>`}
      <p class="nota">Toca una solicitud para compartirla o terminarla.</p>`;
    c.querySelectorAll("[data-fl]").forEach(b => b.addEventListener("click", () => { filtro = b.dataset.fl; renderLista(); }));
    const bus = $("#mt-buscar");
    bus.addEventListener("input", () => {
      busqueda = bus.value;
      const pos = bus.selectionStart;
      renderLista();
      const n = $("#mt-buscar"); n.focus(); n.setSelectionRange(pos, pos);
    });
    c.querySelectorAll("tr.clic").forEach(tr => tr.addEventListener("click", () => abrirDetalle(tr.dataset.id)));
  }

  function abrirDetalle(id) {
    const s = (solicitudes || []).find(x => x.id === id);
    if (!s) return;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-tarjeta" style="max-width:640px;width:100%;max-height:90vh;overflow:auto;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div><div class="mt-folio" style="font-size:20px;">${esc(s.folio)}</div>
            <span class="mt-estado ${s.estado === "terminada" ? "mt-te" : "mt-ab"}">${s.estado === "terminada" ? "TERMINADA" : "ABIERTA"}</span></div>
          <button type="button" class="secundario mt-cerrar">✕</button>
        </div>
        <div class="mt-msg">${esc(mensajeSolicitud(s))}</div>
        <div class="mt-acciones">${botonesCompartir(s)}</div>
        ${s.estado === "abierta" ? `
          <hr style="border:none;border-top:1px solid #efebe5;margin:16px 0;">
          <h3 style="margin:0 0 6px;font-size:15px;">Terminar</h3>
          <label for="mt-t-fecha">Fecha y hora en que quedó</label>
          <input type="datetime-local" id="mt-t-fecha" value="${valorLocal(Date.now())}" max="${valorLocal(Date.now() + 60000)}">
          <label for="mt-t-com">¿Qué se hizo?</label>
          <textarea id="mt-t-com" rows="3" maxlength="500" placeholder="Ej: se cambió la válvula de freno del eje trasero"></textarea>
          <div class="error" id="mt-t-err"></div>
          <div class="mt-acciones"><button type="button" id="mt-t-ok">Terminar solicitud</button></div>` : ""}
        <div class="modal-acciones"><button type="button" class="secundario mt-cerrar">Cerrar</button></div>
      </div>`;
    document.body.appendChild(overlay);
    const cerrar = () => overlay.remove();
    overlay.querySelectorAll(".mt-cerrar").forEach(b => b.addEventListener("click", cerrar));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) cerrar(); });
    enlazarCompartir(overlay, s);
    const ok = overlay.querySelector("#mt-t-ok");
    if (ok) ok.addEventListener("click", async () => {
      const err = overlay.querySelector("#mt-t-err");
      err.textContent = "";
      const ms = new Date(overlay.querySelector("#mt-t-fecha").value).getTime();
      const com = overlay.querySelector("#mt-t-com").value.trim();
      if (!isFinite(ms)) { err.textContent = "Indica la fecha y hora."; return; }
      if (ms > Date.now() + 2 * 60 * 1000) { err.textContent = "La fecha no puede ser futura."; return; }
      if (s.ms && ms < s.ms - 60 * 1000) { err.textContent = "La fecha no puede ser anterior a la solicitud."; return; }
      if (!com) { err.textContent = "Escribe qué se hizo."; return; }
      ok.disabled = true;
      try {
        await updateDoc(doc(db, COL, s.id), {
          estado: "terminada", terminadaMs: ms, comentarioCierre: com,
          terminadaPor: { uid, nombre: (datosUsuario && datosUsuario.nombre) || "" },
        });
        cerrar();
      } catch (e) {
        err.textContent = "No se pudo terminar: " + e.message;
        ok.disabled = false;
      }
    });
  }

  render();
}