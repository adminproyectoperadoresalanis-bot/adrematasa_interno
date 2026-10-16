import { db } from "./firebase-config.js";
import { doc, onSnapshot, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";

// ============================================================================
// Operadores → Turnos (2026-10-16, fase 2 de rutas — parte 1: la fila).
//
// Orden: Fecha en Patio del reporte de patio del Adrematasa oficial (se pega
// aquí, como el de McCain). Se empata por UNIDAD con el operador registrado en
// Alanis Operadores que tiene ese número. Solo aparecen unidades con operador
// registrado; si el reporte trae otro nombre, sale "No coincide".
//
// Estatus: lo que el operador ya marca desde su app (Disponible, Taller,
// Enfermo, Permiso, Vacaciones, Incapacitado) y sus asignaciones de viaje,
// leídos con la función estadoTurnosOperadores (otro proyecto → se refresca
// cada minuto). Reglas acordadas con Ivan:
//   - Un estatus solo cuenta si se marcó DESPUÉS de su entrada a patio.
//   - Ruta corta: "Disponible" vence a las N horas (4 por default).
// Partes siguientes: Asignar viaje (WhatsApp), Perdieron turno / En taller,
// Configuración.
// ============================================================================

const funciones = getFunctions(undefined, "us-central1");
const fnEstadoTurnos = httpsCallable(funciones, "estadoTurnosOperadores");

const DOC_PATIO = doc(db, "turnos_patio", "actual");
const HORAS_VIGENCIA_CORTA = 4; // pasará a Configuración en la parte 4
const REFRESCO_MS = 60 * 1000;

const ETIQUETA_RUTA = { larga: "LARGA", corta: "CORTA", local: "LOCAL" };
const ESTATUS = {
  disponible: { txt: "Disponible", clase: "tu-di" },
  taller: { txt: "En taller", clase: "tu-ta" },
  enfermo: { txt: "Enfermo", clase: "tu-en" },
  permiso: { txt: "Permiso", clase: "tu-pe" },
  vacaciones: { txt: "Vacaciones", clase: "tu-pe" },
  incapacitado: { txt: "Incapacitado", clase: "tu-en" },
};

function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}
function normalizar(t) {
  return String(t == null ? "" : t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
function normUnidad(u) { return String(u == null ? "" : u).trim().toUpperCase(); }
function dosDig(n) { return String(n).padStart(2, "0"); }
function fechaCorta(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  return `${dosDig(d.getDate())}/${dosDig(d.getMonth() + 1)} ${dosDig(d.getHours())}:${dosDig(d.getMinutes())}`;
}
function horaCorta(ms) {
  const d = new Date(ms);
  return `${dosDig(d.getHours())}:${dosDig(d.getMinutes())}`;
}

// "21/04/2026 05:22 PM" · "15/10/2026 01:18 AM" · "12/10/2026 04:39 p. m."
function parsearFechaHora(texto) {
  const m = String(texto || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*([aApP])\.?\s*[mM]\.?)?)?\s*$/);
  if (!m) return null;
  let hh = m[4] != null ? Number(m[4]) : 0;
  const mi = m[5] != null ? Number(m[5]) : 0;
  if (m[6]) {
    const pm = m[6].toLowerCase() === "p";
    if (pm && hh < 12) hh += 12;
    if (!pm && hh === 12) hh = 0;
  }
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), hh, mi);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function nombresCoinciden(a, b) {
  const ta = new Set(normalizar(a).split(" ").filter(w => w.length > 2));
  const tb = normalizar(b).split(" ").filter(w => w.length > 2);
  if (ta.size === 0 || tb.length === 0) return true; // sin nombre en alguno: no se puede decir que no coincide
  const comunes = tb.filter(w => ta.has(w)).length;
  return comunes >= Math.min(2, ta.size, tb.length);
}

// ---- Leer el reporte de patio pegado -------------------------------------------
const COLUMNAS = {
  unidad: ["unidad"],
  status: ["status"],
  operador: ["operador"],
  taller: ["taller"],
  fechaPatio: ["fecha en patio"],
  remolque: ["remolque preasignado"],
  cliente: ["cliente"],
  destino: ["destino"],
  comentarios: ["comentarios"],
  disponible: ["disponible"],
};

export function parsearReportePatio(texto) {
  const lineas = String(texto || "").replace(/\r/g, "").split("\n");
  const idxEnc = lineas.findIndex(l => {
    const c = l.split("\t").map(normalizar);
    return c.includes("unidad") && c.includes("fecha en patio");
  });
  if (idxEnc === -1) throw new Error("No encontré la fila de títulos (Unidad, Fecha en Patio…). Copia el reporte incluyendo los encabezados.");
  const enc = lineas[idxEnc].split("\t").map(normalizar);
  const col = {};
  Object.entries(COLUMNAS).forEach(([k, nombres]) => { col[k] = enc.findIndex(h => nombres.includes(h)); });
  const val = (c, k) => (col[k] >= 0 ? String(c[col[k]] || "").trim() : "");

  const filas = [];
  lineas.slice(idxEnc + 1).forEach(l => {
    if (!l.trim()) return;
    const c = l.split("\t");
    const unidad = normUnidad(val(c, "unidad"));
    const fechaPatioMs = parsearFechaHora(val(c, "fechaPatio"));
    if (!unidad || !fechaPatioMs) return;
    filas.push({
      unidad,
      status: val(c, "status"),
      operador: val(c, "operador").replace(/\s+/g, " "),
      taller: val(c, "taller"),
      fechaPatioMs,
      remolque: val(c, "remolque"),
      cliente: val(c, "cliente"),
      destino: val(c, "destino"),
      comentarios: val(c, "comentarios"),
      disponible: val(c, "disponible"),
    });
  });
  if (filas.length === 0) throw new Error("No encontré renglones con unidad y fecha en patio.");
  return filas;
}

// ---- Estatus de un operador dentro de la fila ---------------------------------
// Solo cuenta lo que pasó después de su entrada a patio.
function calcularEstatus(op, fechaPatioMs, ahora) {
  const asig = op.asignacion && op.asignacion.ms && op.asignacion.ms >= fechaPatioMs ? op.asignacion : null;
  if (asig) {
    if (asig.estado === "rechazada") return { clave: "rechazo", txt: "Rechazó viaje", clase: "tu-en", sub: asig.motivoRechazo ? `"${asig.motivoRechazo}"` : "" };
    if (asig.estado === "aceptada") return { clave: "viaje", txt: "Aceptó viaje", clase: "tu-as", sub: "" };
    return { clave: "asignado", txt: "Asignado · espera respuesta", clase: "tu-asp", sub: fechaCorta(asig.ms) };
  }
  const est = op.estatus && op.estatus.ms && op.estatus.ms >= fechaPatioMs ? op.estatus : null;
  if (!est) return { clave: "sin", txt: "Sin reportarse", clase: "tu-sr", sub: "" };
  const base = ESTATUS[est.id] || { txt: est.id, clase: "tu-sr" };
  if (est.id === "disponible") {
    if (op.tipoRuta === "corta") {
      const vence = est.ms + HORAS_VIGENCIA_CORTA * 3600 * 1000;
      if (ahora > vence) return { clave: "vencido", txt: "Disponible vencido", clase: "tu-ve", sub: `desde ${horaCorta(vence)} · debe reconfirmar` };
      return { clave: "disponible", txt: `Disponible · vence ${horaCorta(vence)}`, clase: base.clase, sub: `App ${fechaCorta(est.ms)}` };
    }
    return { clave: "disponible", txt: "Disponible", clase: base.clase, sub: `App ${fechaCorta(est.ms)}` };
  }
  let sub = `App ${fechaCorta(est.ms)}`;
  if (est.id === "taller" && est.fallas && est.fallas.length) sub = est.fallas.join(", ");
  if ((est.id === "permiso" || est.id === "vacaciones") && est.fechaRegreso) sub = `regresa ${est.fechaRegreso}${est.autorizo ? " · autorizó " + est.autorizo : ""}`;
  return { clave: est.id, txt: base.txt, clase: base.clase, sub };
}

function inyectarEstilos() {
  if (document.getElementById("estilos-turnos")) return;
  const s = document.createElement("style");
  s.id = "estilos-turnos";
  s.textContent = `
    .tu-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
    .tu-chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0; }
    .tu-chip { background: #fff; border: 1px solid #e2ddd5; border-radius: 14px; padding: 5px 11px; font: inherit; font-size: 12px; color: #6b5f52; cursor: pointer; }
    .tu-chip.activo { background: #2c1e0f; border-color: #2c1e0f; color: #fff; }
    .tu-tabla td { vertical-align: middle; }
    .tu-num { font-weight: 700; color: #8a7f73; width: 28px; }
    .tu-unidad { font-weight: 700; font-size: 14px; }
    .tu-sub { display: block; font-size: 11.5px; color: #8a7f73; }
    .tu-ruta { font-size: 10px; font-weight: 700; padding: 1px 7px; border-radius: 10px; margin-left: 4px; }
    .tu-ruta.larga { background: #E6F1FB; color: #0C447C; } .tu-ruta.corta { background: #EAF3DE; color: #27500A; }
    .tu-ruta.local { background: #FAEEDA; color: #633806; } .tu-ruta.sin { background: #F1EFE8; color: #5F5E5A; }
    .tu-b { display: inline-block; font-size: 11px; font-weight: 600; padding: 2px 9px; border-radius: 999px; white-space: nowrap; }
    .tu-di { background: #EAF3DE; color: #27500A; } .tu-ve { background: #fef3c7; color: #92400e; }
    .tu-ta { background: #FAEEDA; color: #633806; } .tu-en { background: #FCEBEB; color: #791F1F; }
    .tu-pe { background: #E6F1FB; color: #0C447C; } .tu-sr { background: #F1EFE8; color: #8a7f73; }
    .tu-as { background: #185FA5; color: #fff; } .tu-asp { background: #E6F1FB; color: #0C447C; }
    .tu-nc { background: #FCEBEB; color: #A32D2D; }
    .tu-ad { font-size: 11px; color: #6b5f52; }
    .tu-pegar { width: 100%; box-sizing: border-box; min-height: 140px; font-family: monospace; font-size: 11.5px; white-space: pre; }
  `;
  document.head.appendChild(s);
}

// ---- Pantalla ------------------------------------------------------------------
export function iniciarTurnos(contenedor, datosUsuario, uid) {
  inyectarEstilos();
  contenedor.innerHTML = `
    <section class="panel">
      <div class="tu-top">
        <h2 style="margin:0;">Turnos en patio</h2>
        <div style="display:flex;gap:6px;">
          <button type="button" class="secundario" id="tu-refrescar">Actualizar estatus</button>
          <button type="button" id="tu-pegar">Actualizar reporte de patio</button>
        </div>
      </div>
      <p class="nota" id="tu-info" style="margin:6px 0 0;">Cargando…</p>
      <div id="tu-error" class="error"></div>
      <div class="tu-chips" id="tu-chips"></div>
      <div class="tabla-wrap"><table class="tabla tu-tabla">
        <thead><tr><th>#</th><th>Unidad · Operador</th><th>En patio</th><th>Estatus</th><th>Viaje</th></tr></thead>
        <tbody id="tu-tbody"><tr><td colspan="5">Cargando…</td></tr></tbody>
      </table></div>
      <p class="nota" id="tu-fuera" style="margin-top:8px;"></p>
    </section>
  `;
  const $ = (s) => contenedor.querySelector(s);
  let patio = null;      // { filas, importadoEn, importadoPor }
  let operadores = [];   // de estadoTurnosOperadores
  let generadoMs = 0;
  let filtro = "todas";

  const cancelarPatio = onSnapshot(DOC_PATIO, (snap) => {
    patio = snap.exists() ? snap.data() : null;
    render();
  }, (err) => { $("#tu-error").textContent = "No se pudo leer el reporte de patio: " + err.message; });

  async function cargarEstado() {
    try {
      const res = await fnEstadoTurnos();
      operadores = res.data.operadores || [];
      generadoMs = res.data.generadoMs || Date.now();
      $("#tu-error").textContent = "";
      render();
    } catch (err) {
      $("#tu-error").textContent = (err && err.message) || "No se pudo cargar el estado de los operadores.";
    }
  }
  cargarEstado();
  const reloj = setInterval(() => {
    if (!contenedor.isConnected) { clearInterval(reloj); cancelarPatio(); return; }
    cargarEstado();
  }, REFRESCO_MS);

  function construirFila() {
    if (!patio || !Array.isArray(patio.filas)) return { fila: [], sinOperador: 0 };
    const porUnidad = new Map();
    operadores.filter(o => o.activo && o.numero).forEach(o => porUnidad.set(normUnidad(o.numero), o));
    const ahora = Date.now();
    let sinOperador = 0;
    const fila = [];
    patio.filas.forEach(r => {
      const op = porUnidad.get(normUnidad(r.unidad));
      if (!op) { sinOperador++; return; }
      const noCoincide = r.operador && !nombresCoinciden(r.operador, op.nombreOficial || op.nombre);
      fila.push({ r, op, noCoincide, est: noCoincide ? null : calcularEstatus(op, r.fechaPatioMs, ahora) });
    });
    fila.sort((a, b) => a.r.fechaPatioMs - b.r.fechaPatioMs);
    return { fila, sinOperador };
  }

  function pasaFiltro(it) {
    if (filtro === "todas") return true;
    if (filtro === "disponibles") return it.est && it.est.clave === "disponible";
    if (filtro === "nocoincide") return it.noCoincide;
    return it.op.tipoRuta === filtro;
  }

  function render() {
    const { fila, sinOperador } = construirFila();
    $("#tu-info").textContent = patio
      ? `Reporte de patio del ${fechaCorta(patio.importadoMs)}${patio.importadoPor && patio.importadoPor.nombre ? " · pegado por " + patio.importadoPor.nombre : ""} · estatus del operador al ${generadoMs ? horaCorta(generadoMs) : "—"} (se actualiza cada minuto)`
      : "Todavía no se ha pegado ningún reporte de patio.";

    const cuenta = (f) => fila.filter(it => { const prev = filtro; filtro = f; const ok = pasaFiltro(it); filtro = prev; return ok; }).length;
    const chips = [["todas", "Todas"], ["corta", "Corta"], ["larga", "Larga"], ["local", "Local"], ["disponibles", "Disponibles"], ["nocoincide", "No coincide"]]
      .filter(([k]) => k !== "nocoincide" || cuenta(k) > 0)
      .map(([k, t]) => `<button type="button" class="tu-chip${filtro === k ? " activo" : ""}" data-f="${k}">${t} ${cuenta(k)}</button>`).join("");
    $("#tu-chips").innerHTML = chips;
    $("#tu-chips").querySelectorAll(".tu-chip").forEach(b => b.addEventListener("click", () => { filtro = b.dataset.f; render(); }));

    const visibles = fila.filter(pasaFiltro);
    $("#tu-tbody").innerHTML = visibles.length === 0
      ? `<tr><td colspan="5">${patio ? "Sin operadores con este filtro." : "Pega el reporte de patio para formar la fila."}</td></tr>`
      : visibles.map((it, i) => {
          const { r, op, est } = it;
          const nombre = op.nombreOficial || op.nombre || "—";
          const ruta = op.tipoRuta ? `<span class="tu-ruta ${op.tipoRuta}">${ETIQUETA_RUTA[op.tipoRuta]}</span>` : `<span class="tu-ruta sin">SIN RUTA</span>`;
          const horas = Math.max(0, Math.round((Date.now() - r.fechaPatioMs) / 3600000));
          const adre = [r.taller, r.disponible].filter(Boolean).join(" · ");
          const estatusHtml = it.noCoincide
            ? `<span class="tu-b tu-nc">No coincide</span><span class="tu-sub">Reporte: ${esc(r.operador)} · corregir en Registrados</span>`
            : `<span class="tu-b ${est.clase}">${esc(est.txt)}</span>${est.sub ? `<span class="tu-sub">${esc(est.sub)}</span>` : ""}${adre ? `<span class="tu-sub tu-ad">Adrematasa: ${esc(adre)}</span>` : ""}`;
          const asig = op.asignacion && op.asignacion.ms >= r.fechaPatioMs ? op.asignacion : null;
          const viajeHtml = asig
            ? `${esc([asig.remolque, asig.cliente].filter(Boolean).join(" · ") || "Viaje")}<span class="tu-sub">${esc(asig.destino || "")}${asig.cita ? " · cita " + esc(asig.cita) : ""}</span>`
            : (r.remolque || r.cliente ? `${esc([r.remolque, r.cliente].filter(Boolean).join(" · "))}<span class="tu-sub">${esc(r.destino || "")} · preasignado en Adrematasa</span>` : "—");
          return `<tr>
            <td class="tu-num">${i + 1}</td>
            <td><span class="tu-unidad">${esc(op.numero)}</span>${ruta}<span class="tu-sub">${esc(nombre)}</span></td>
            <td>${fechaCorta(r.fechaPatioMs)}<span class="tu-sub">${horas} h</span></td>
            <td>${estatusHtml}</td>
            <td>${viajeHtml}</td>
          </tr>`;
        }).join("");
    $("#tu-fuera").textContent = patio && sinOperador
      ? `${sinOperador} unidades del reporte no tienen operador registrado en Alanis Operadores (VENTA, SIN OPERADOR, AGENCIA…) y no se muestran.`
      : "";
  }

  $("#tu-refrescar").addEventListener("click", cargarEstado);
  $("#tu-pegar").addEventListener("click", () => abrirPegado(datosUsuario, uid));
}

function abrirPegado(datosUsuario, uid) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-tarjeta" style="max-width:760px;width:100%;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <h2 style="margin:0;">Actualizar reporte de patio</h2>
        <button type="button" class="secundario tu-cerrar" aria-label="Cerrar">✕</button>
      </div>
      <p class="nota">Copia del Adrematasa oficial el reporte de unidades en patio <strong>con la fila de títulos</strong> y pégalo aquí. Reemplaza al reporte anterior.</p>
      <textarea class="tu-pegar" placeholder="Pega aquí el reporte…"></textarea>
      <div class="error tu-perror" style="margin-top:8px;"></div>
      <p class="nota tu-presumen" style="margin:6px 0 0;"></p>
      <div class="modal-acciones">
        <button type="button" class="secundario tu-cerrar2">Cancelar</button>
        <button type="button" class="tu-guardar">Guardar reporte</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const q = (s) => overlay.querySelector(s);
  const cerrar = () => overlay.remove();
  q(".tu-cerrar").addEventListener("click", cerrar);
  q(".tu-cerrar2").addEventListener("click", cerrar);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) cerrar(); });
  q(".tu-pegar").addEventListener("input", () => {
    q(".tu-perror").textContent = "";
    try {
      const filas = parsearReportePatio(q(".tu-pegar").value);
      q(".tu-presumen").textContent = `${filas.length} unidades leídas.`;
    } catch (_) { q(".tu-presumen").textContent = ""; }
  });
  q(".tu-guardar").addEventListener("click", async () => {
    q(".tu-perror").textContent = "";
    let filas;
    try { filas = parsearReportePatio(q(".tu-pegar").value); }
    catch (err) { q(".tu-perror").textContent = err.message; return; }
    q(".tu-guardar").disabled = true;
    try {
      await setDoc(DOC_PATIO, {
        filas,
        importadoMs: Date.now(),
        importadoEn: serverTimestamp(),
        importadoPor: { uid, nombre: datosUsuario.nombre || "" },
      });
      cerrar();
    } catch (err) {
      q(".tu-perror").textContent = "No se pudo guardar: " + err.message;
      q(".tu-guardar").disabled = false;
    }
  });
}