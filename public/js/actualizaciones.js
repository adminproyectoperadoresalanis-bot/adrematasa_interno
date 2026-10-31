// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/public/js/actualizaciones.js
// ##########################################################################
import { db } from "./firebase-config.js";
import { collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { suscribirEspejo, alSalirDePantalla } from "./espejosOperadores.js";
import { tomarFiltro } from "./navegacion.js";

// ============================================================================
// Tráfico → Actualizaciones (2026-10-31, pedido de Ivan).
// Lo que los operadores reportan del VIAJE en Alanis Operadores (Incidencia en
// viaje, Arribo a destino, Fin de descarga; pueden venir combinados), en vivo.
// La función espejoEstatusOperadores (alanis-operadores) copia cada reporte a
// espejo_op_eventos_viaje/{id del evento}. Aquí solo se lee.
//   - Lista: un renglón por operador con reportes en el periodo (hoy, 3 o 7
//     días): su último reporte, hace cuánto, ubicación (Maps) y el viaje al que
//     pertenece (su última asignación antes del reporte, del espejo de
//     asignaciones).
//   - Al tocarlo: la bitácora del periodo (asignación aceptada + reportes).
//   - Sin avisos por tiempo sin reportar (decisión de Ivan).
// ============================================================================

const TIPOS = {
  incidencia_viaje: { txt: "INCIDENCIA", clase: "ac-inc" },
  arribo_destino: { txt: "ARRIBO A DESTINO", clase: "ac-arr" },
  fin_descarga: { txt: "FIN DE DESCARGA", clase: "ac-fin" },
};
const PERIODOS = [[1, "Hoy"], [3, "3 días"], [7, "7 días"]];
const DIA = 864e5;

function esc(t) { const d = document.createElement("div"); d.textContent = t == null ? "" : String(t); return d.innerHTML; }
const pad = (n) => String(n).padStart(2, "0");
const fechaHora = (ms) => { if (!ms) return "—"; const d = new Date(ms); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function hace(ms) {
  if (!ms) return "—";
  const min = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (min < 1) return "ahora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${min % 60} min`;
  const d = Math.floor(h / 24);
  return `${d} día${d === 1 ? "" : "s"}`;
}
const normTxt = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const liga = (ev) => ev.lat != null && ev.lng != null ? `https://www.google.com/maps?q=${ev.lat},${ev.lng}` : null;
function inicioPeriodo(dias) { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() - (dias - 1) * DIA; }

function inyectarEstilos() {
  if (document.getElementById("ac-estilos")) return;
  const s = document.createElement("style");
  s.id = "ac-estilos";
  s.textContent = `
    .ac-kpis { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px; }
    .ac-kpi { border:1px solid #e2ddd5; border-radius:12px; padding:9px 14px; min-width:120px; background:#fff; }
    .ac-kpi b { display:block; font-size:20px; } .ac-kpi small { color:#8a7f73; font-size:11.5px; }
    .ac-kpi.r b { color:#B83227; } .ac-kpi.v b { color:#3B7A1E; }
    .ac-filtros { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:10px; }
    .ac-filtros input { width:auto; min-width:220px; flex:1; max-width:360px; }
    .ac-seg { display:inline-flex; border:1px solid #e2ddd5; border-radius:9px; overflow:hidden; flex-wrap:wrap; }
    .ac-seg button { background:#fff; border:0; border-left:1px solid #e2ddd5; padding:7px 12px; font:inherit; font-size:12.5px; color:#6b5f52; cursor:pointer; }
    .ac-seg button:first-child { border-left:0; } .ac-seg button.activo { background:#2c1e0f; color:#fff; font-weight:700; }
    .ac-chip { display:inline-block; font-size:10px; font-weight:800; padding:3px 8px; border-radius:9px; white-space:nowrap; margin:0 3px 3px 0; }
    .ac-inc { background:#FBE4E1; color:#A32D2D; } .ac-arr { background:#EAF3DE; color:#3B7A1E; } .ac-fin { background:#DDF1EC; color:#11705F; } .ac-asg { background:#ECE9E4; color:#5c5045; }
    .ac-tabla td { vertical-align:top; } .ac-tabla tr.clic { cursor:pointer; } .ac-tabla tr.clic:hover td { background:#faf8f5; }
    .ac-com { color:#5c5045; font-size:12.5px; }
    .ac-link { color:#185FA5; text-decoration:underline; }
    .ac-linea { position:relative; padding-left:22px; margin-top:10px; }
    .ac-linea::before { content:""; position:absolute; left:6px; top:6px; bottom:10px; width:2px; background:#eee8e0; }
    .ac-ev { position:relative; padding:0 0 14px; font-size:13px; }
    .ac-ev::before { content:""; position:absolute; left:-20px; top:4px; width:10px; height:10px; border-radius:50%; background:#cfc8bf; }
    .ac-ev.ult::before { background:#185FA5; box-shadow:0 0 0 4px #E6F1FB; }
    @media (max-width:700px) {
      .ac-tabla thead { display:none; }
      .ac-tabla, .ac-tabla tbody { display:block; }
      .ac-tabla tr.clic { display:block; border:1px solid #e2ddd5; border-radius:12px; padding:10px 12px; margin-bottom:10px; background:#fff; }
      .ac-tabla td { display:block; border:0 !important; padding:2px 0 !important; }
      .ac-tabla td[data-et]::before { content:attr(data-et) ": "; color:#8a7f73; font-size:11.5px; }
    }
  `;
  document.head.appendChild(s);
}

export function iniciarActualizaciones(contenedor) {
  inyectarEstilos();
  const filtroInicial = tomarFiltro("trafico") || {};
  const f = { dias: 1, tipo: filtroInicial.tipo || "", q: "" };
  let eventos = null, asignaciones = [], cancelarEv = null;
  contenedor.innerHTML = `
    <section class="panel">
      <h2 style="margin:0 0 4px;">Actualizaciones</h2>
      <p class="nota" style="margin:0 0 12px;">Lo que reportan los operadores durante el viaje en Alanis Operadores: incidencias, arribo a destino y fin de descarga. Se actualiza solo.</p>
      <div id="ac-error" class="error"></div>
      <div id="ac-cuerpo"><p class="nota">Cargando…</p></div>
    </section>`;
  const $ = (s) => contenedor.querySelector(s);

  function escuchar() {
    if (cancelarEv) cancelarEv();
    eventos = null; render();
    cancelarEv = onSnapshot(query(collection(db, "espejo_op_eventos_viaje"), where("ms", ">=", inicioPeriodo(f.dias))), (snap) => {
      eventos = snap.docs.map(d => ({ ...d.data(), _id: d.id }));
      render();
    }, (err) => { $("#ac-error").textContent = "No se pudieron leer las actualizaciones: " + err.message; });
  }
  const cancelarAsg = suscribirEspejo("asignaciones", (lista) => { asignaciones = lista; render(); }, () => {});
  alSalirDePantalla(contenedor, () => { if (cancelarEv) cancelarEv(); cancelarAsg(); });

  // Viaje de un reporte: la última asignación (no cancelada ni rechazada) de ese
  // operador hecha antes del reporte.
  function viajeDe(ev) {
    let mejor = null;
    asignaciones.forEach(a => {
      if (a.uidOperador !== ev.uid || ["cancelada", "rechazada"].includes(a.estado)) return;
      if ((a.timestampMs || 0) > (ev.ms || 0)) return;
      if (!mejor || (a.timestampMs || 0) > (mejor.timestampMs || 0)) mejor = a;
    });
    return mejor;
  }
  const chips = (ev) => (ev.ids || []).map(id => TIPOS[id] ? `<span class="ac-chip ${TIPOS[id].clase}">${TIPOS[id].txt}</span>` : "").join("");

  function render() {
    if (!eventos) { $("#ac-cuerpo").innerHTML = `<p class="nota">Cargando…</p>`; return; }
    // Agrupar por operador
    const porOp = new Map();
    eventos.forEach(ev => { const l = porOp.get(ev.uid) || []; l.push(ev); porOp.set(ev.uid, l); });
    const q = normTxt(f.q);
    let filas = [...porOp.values()].map(lista => {
      lista.sort((a, b) => (b.ms || 0) - (a.ms || 0));
      const delTipo = f.tipo ? lista.filter(e => (e.ids || []).includes(f.tipo)) : lista;
      const ult = delTipo[0];
      return ult ? { lista, ult, viaje: viajeDe(ult) } : null;
    }).filter(Boolean);
    if (q) filas = filas.filter(r => normTxt([r.ult.operador, r.ult.numero, r.viaje && r.viaje.unidad, r.viaje && r.viaje.remolque, r.viaje && r.viaje.cliente, r.viaje && r.viaje.destino].join(" ")).includes(q));
    filas.sort((a, b) => (b.ult.ms || 0) - (a.ult.ms || 0));
    const cuenta = (id) => eventos.filter(e => (e.ids || []).includes(id)).length;
    $("#ac-cuerpo").innerHTML = `
      <div class="ac-kpis">
        <div class="ac-kpi"><b>${porOp.size}</b><small>Operadores con reportes</small></div>
        <div class="ac-kpi r"><b>${cuenta("incidencia_viaje")}</b><small>Incidencias</small></div>
        <div class="ac-kpi v"><b>${cuenta("arribo_destino")}</b><small>Arribos a destino</small></div>
        <div class="ac-kpi v"><b>${cuenta("fin_descarga")}</b><small>Fin de descarga</small></div>
      </div>
      <div class="ac-filtros">
        <input type="text" id="ac-q" placeholder="Buscar operador, unidad, cliente o destino" value="${esc(f.q)}">
        <span class="ac-seg">${PERIODOS.map(([d, t]) => `<button type="button" class="${f.dias === d ? "activo" : ""}" data-dias="${d}">${t}</button>`).join("")}</span>
        <span class="ac-seg"><button type="button" class="${!f.tipo ? "activo" : ""}" data-tipo="">Todo</button>${Object.entries(TIPOS).map(([k, v]) => `<button type="button" class="${f.tipo === k ? "activo" : ""}" data-tipo="${k}">${v.txt.charAt(0) + v.txt.slice(1).toLowerCase()} ${cuenta(k)}</button>`).join("")}</span>
      </div>
      ${filas.length ? `<div class="tabla-wrap"><table class="tabla ac-tabla">
        <thead><tr><th>Operador</th><th>Unidad · Remolque</th><th>Viaje</th><th>Último reporte</th><th>Cuándo</th><th>Ubicación</th></tr></thead>
        <tbody>${filas.map(r => { const v = r.viaje, u = liga(r.ult); return `<tr class="clic" data-uid="${esc(r.ult.uid)}">
          <td><b>${esc(r.ult.operador || "—")}</b>${r.ult.numero ? `<br><small class="nota">#${esc(r.ult.numero)}</small>` : ""}</td>
          <td data-et="Unidad">${v ? esc([v.unidad, v.remolque].filter(Boolean).join(" · ") || "—") : "—"}</td>
          <td data-et="Viaje">${v ? `${esc(v.cliente || "—")}${v.destino ? `<br><small class="nota">${esc(v.destino)}</small>` : ""}` : `<small class="nota">sin asignación ligada</small>`}</td>
          <td>${chips(r.ult)}${r.ult.comentario ? `<div class="ac-com">${esc(r.ult.comentario)}</div>` : ""}${r.lista.length > 1 ? `<small class="nota">${r.lista.length} reportes en el periodo</small>` : ""}</td>
          <td data-et="Cuándo">${esc(fechaHora(r.ult.ms))}<br><small class="nota">hace ${esc(hace(r.ult.ms))}</small></td>
          <td data-et="Ubicación">${u ? `<a class="ac-link" href="${u}" target="_blank" rel="noopener">Ver en Maps</a>` : `<small class="nota">sin GPS</small>`}</td></tr>`; }).join("")}</tbody>
      </table></div>`
        : `<p class="nota" style="text-align:center;padding:18px;">${eventos.length ? "No hay reportes con este filtro." : "Ningún operador ha reportado en este periodo."}</p>`}`;
    const qi = $("#ac-q");
    qi.addEventListener("input", () => { f.q = qi.value; const p = qi.selectionStart; render(); const n = $("#ac-q"); n.focus(); n.setSelectionRange(p, p); });
    $("#ac-cuerpo").querySelectorAll("[data-dias]").forEach(b => b.addEventListener("click", () => { f.dias = Number(b.dataset.dias); escuchar(); }));
    $("#ac-cuerpo").querySelectorAll("[data-tipo]").forEach(b => b.addEventListener("click", () => { f.tipo = b.dataset.tipo; render(); }));
    $("#ac-cuerpo").querySelectorAll("tr.clic").forEach(tr => tr.addEventListener("click", () => abrirBitacora(tr.dataset.uid)));
  }

  function abrirBitacora(uidOp) {
    const lista = (eventos || []).filter(e => e.uid === uidOp).sort((a, b) => (b.ms || 0) - (a.ms || 0));
    if (!lista.length) return;
    const ult = lista[0], v = viajeDe(ult);
    const items = lista.map((e, i) => ({ ms: e.ms, html: `<div class="ac-ev${i === 0 ? " ult" : ""}">${chips(e)} <b>${esc(fechaHora(e.ms))}</b>
        ${e.comentario ? `<div class="ac-com">"${esc(e.comentario)}"</div>` : ""}
        ${liga(e) ? `<a class="ac-link" href="${liga(e)}" target="_blank" rel="noopener" style="font-size:12px;">Ver ubicación</a>` : `<small class="nota">sin GPS</small>`}</div>` }));
    if (v && v.respuestaMs && v.estado === "aceptada") items.push({ ms: v.respuestaMs, html: `<div class="ac-ev"><span class="ac-chip ac-asg">ASIGNACIÓN ACEPTADA</span> <b>${esc(fechaHora(v.respuestaMs))}</b></div>` });
    items.sort((a, b) => (b.ms || 0) - (a.ms || 0));
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML = `<div class="modal-tarjeta" style="max-width:620px;width:100%;max-height:90vh;overflow:auto;">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
        <div><h2 style="margin:0;font-size:17px;">${esc(ult.operador || "Operador")}${ult.numero ? ` · #${esc(ult.numero)}` : ""}</h2>
          <div class="nota" style="margin:4px 0 0;">${v ? esc([v.cliente, v.destino].filter(Boolean).join(" · ")) + "<br>" + esc(["Unidad " + (v.unidad || "—"), "Remolque " + (v.remolque || "—"), v.cita ? "Cita " + v.cita : ""].filter(Boolean).join(" · ")) : "Sin asignación ligada"}</div></div>
        <button type="button" class="secundario" data-cerrar>✕</button></div>
      <div class="ac-linea">${items.map(x => x.html).join("")}</div>
      <p class="nota">${f.dias === 1 ? "Reportes de hoy" : `Reportes de los últimos ${f.dias} días`}. Cambia el periodo arriba para ver más.</p>
      <div class="modal-acciones"><button type="button" data-cerrar>Cerrar</button></div></div>`;
    document.body.appendChild(ov);
    ov.querySelectorAll("[data-cerrar]").forEach(b => b.addEventListener("click", () => ov.remove()));
    ov.addEventListener("click", (e) => { if (e.target === ov) ov.remove(); });
  }

  escuchar();
}