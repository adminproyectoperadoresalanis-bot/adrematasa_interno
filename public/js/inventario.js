// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/public/js/inventario.js
// ##########################################################################
import { db } from "./firebase-config.js";
import {
  collection, doc, getDocs, setDoc, writeBatch, query, where, limit, arrayUnion, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { suscribirEspejo } from "./espejosOperadores.js";

// ============================================================================
// Utilidades → Inventario (2026-10-24, pedido de Ivan) — fase 1.
//
// Catálogo de unidades (tractocamiones, remolques, unidades de refrigeración y
// otros) tomado del Excel "unidades.xls" que se exporta del Adrematasa oficial.
//   - inventario_catalogo/{pNN}: el catálogo partido en bloques de ~350
//     unidades (así abrir la pantalla cuesta ~11 lecturas, no 3,657).
//     inventario_catalogo/meta: cuándo y quién lo actualizó.
//   - inventario_estatus/{económico}: estatus PROPIO de ADREMATASA Interno
//     (Activa / Baja / Vendida) con fecha del evento, motivo e historial. El
//     Excel nunca lo pisa (el archivo del Adrematasa oficial no trae bajas).
//     Se guarda también la SERIE de la unidad (2026-10-26): si LIS reutiliza
//     el mismo económico para otra unidad física (otra serie), el estatus NO
//     se le aplica y se avisa. Un económico con punto o letra extra ("R1409.")
//     es otro activo para LIS, así que aquí también es otra unidad.
//   - inventario_importaciones/{auto}: bitácora de cada actualización.
// Cruce de operador: el operador del archivo contra el que tiene esa unidad
// en Alanis Operadores (espejo en vivo; requiere acceso a Operadores).
// Actualizar catálogo y cambiar estatus: solo admin (fase 1).
// ============================================================================

const URL_SHEETJS = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
const TAM_PARTE = 350;
const POR_PAGINA = 50;
const TIPOS = [
  { id: "tracto", etiqueta: "Tractocamiones", desc: ["TRACTOCAMION"] },
  { id: "remolque", etiqueta: "Remolques", desc: ["REMOLQUE"] },
  { id: "refri", etiqueta: "Unidades de refrigeración", desc: ["UNIDAD DE REFRIGERACION"] },
  { id: "otros", etiqueta: "Otros", desc: null },
];
const ESTATUS = {
  activa: { txt: "Activa", clase: "in-ok" },
  baja: { txt: "Baja", clase: "in-no" },
  vendida: { txt: "Vendida", clase: "in-gris" },
};
const CAMPOS_CAMBIO = [
  ["tipo", "Tipo"], ["marca", "Marca"], ["modelo", "Año"], ["serie", "Serie"], ["placas", "Placas"],
  ["kms", "Kms"], ["area", "Área"], ["tarjeta", "Tarjeta/llave"],
  ["motor", "Motor"], ["operador", "Operador"],
];

// Caché de la sesión: se lee una vez; "Recargar" vuelve a leer.
let cache = null; // { unidades: [], porId: Map, meta, estatus: Map }

function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}
function norm(t) {
  return String(t == null ? "" : t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
function miles(n) { return Number(n || 0).toLocaleString("es-MX"); }
function fechaHora(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fechaCorta(iso) { return iso ? iso.split("-").reverse().join("/") : "—"; }
function hoyIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function tipoDe(u) {
  const t = TIPOS.find(x => x.desc && x.desc.includes(u.tipo));
  return t ? t.id : "otros";
}
function nombresCoinciden(a, b) {
  const ta = new Set(norm(a).split(" ").filter(w => w.length > 2));
  const tb = norm(b).split(" ").filter(w => w.length > 2);
  if (ta.size === 0 || tb.length === 0) return true;
  return tb.filter(w => ta.has(w)).length >= Math.min(2, ta.size, tb.length);
}

function inyectarEstilos() {
  if (document.getElementById("estilos-inventario")) return;
  const s = document.createElement("style");
  s.id = "estilos-inventario";
  s.textContent = `
    .in-tabs { display: flex; gap: 4px; background: #fff; border: 1px solid #e2ddd5; border-radius: 12px; padding: 4px; margin-bottom: 14px; flex-wrap: wrap; }
    .in-tab { flex: 1; min-width: 0; background: none; border: none; border-radius: 9px; padding: 8px 10px; font: inherit; font-size: 13px; font-weight: 600; color: #5c5045; cursor: pointer; white-space: nowrap; }
    .in-tab.activo { background: #2c1e0f; color: #fff; }
    .in-tab em { font-style: normal; font-weight: 400; opacity: .75; margin-left: 4px; }
    .in-kpis { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
    .in-kpi { flex: 1; min-width: 130px; border: 1px solid #e2ddd5; border-radius: 12px; padding: 9px 12px; background: #fff; }
    .in-kpi b { display: block; font-size: 20px; } .in-kpi small { color: #6b5f52; font-size: 12px; }
    .in-kpi.v { background: #EAF3DE; border-color: #B9E3A0; } .in-kpi.a { background: #FBF0D5; border-color: #F2D58A; } .in-kpi.r { background: #FCEBEB; border-color: #F5B7B1; }
    .in-filtros { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; align-items: center; }
    .in-filtros input[type=text] { flex: 2; min-width: 220px; }
    .in-filtros select { width: auto; flex: 0 1 auto; }
    .in-tabla { border-collapse: collapse; width: 100%; font-size: 13px; min-width: 880px; }
    .in-tabla th { text-align: left; font-size: 11.5px; color: #6b5f52; text-transform: uppercase; letter-spacing: .3px; padding: 8px; border-bottom: 1px solid #e2ddd5; font-weight: 600; }
    .in-tabla td { padding: 8px; border-bottom: 1px solid #f0ece6; cursor: pointer; }
    .in-tabla tr:hover td { background: #f8f5f0; }
    .in-tabla tr.in-fuera td { color: #9A938A; }
    .in-eco { font-weight: 800; font-size: 14px; }
    .in-chip { display: inline-block; font-size: 11px; font-weight: 700; border-radius: 10px; padding: 2px 8px; white-space: nowrap; }
    .in-ok { background: #EAF3DE; color: #27500A; }
    .in-no { background: #FCEBEB; color: #A32D2D; } .in-gris { background: #F1EFE8; color: #6b5f52; }
    .in-rev { background: #FBF0D5; color: #7a3e06; }
    .in-sub { color: #6b5f52; font-size: 11.5px; display: block; }
    .in-mas { display: block; margin: 10px auto 0; }
    .in-campos { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; font-size: 13px; margin-top: 10px; }
    .in-campos small { display: block; color: #6b5f52; font-size: 11px; text-transform: uppercase; letter-spacing: .3px; }
    .in-campos b { font-weight: 600; word-break: break-all; }
    .in-bloque { margin-top: 14px; border-top: 1px solid #f0ece6; padding-top: 10px; font-size: 13px; }
    .in-bloque h4 { margin: 0 0 6px; font-size: 13px; }
    .in-cruce { border-radius: 10px; padding: 8px 10px; font-size: 12.5px; line-height: 1.5; }
    .in-cruce.ok { background: #EAF3DE; } .in-cruce.no { background: #FCEBEB; color: #7a1f15; } .in-cruce.gris { background: #F1EFE8; }
    .in-hist { font-size: 12px; color: #3D342B; line-height: 1.6; margin-top: 6px; }
    .in-res { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
    .in-res span { flex: 1; min-width: 120px; border-radius: 10px; padding: 8px 10px; font-size: 12.5px; }
    .in-res b { display: block; font-size: 18px; }
    .in-drop { border: 2px dashed #cfc7bb; border-radius: 12px; padding: 18px; text-align: center; color: #6b5f52; margin: 10px 0; }
    .in-modal { max-width: 560px !important; }
    .in-modal label { display: block; font-size: 12px; color: #6b5f52; margin: 12px 0 4px; }
    .in-modal input, .in-modal select { width: 100%; box-sizing: border-box; }
    .in-modal-fondo { position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; }
    .in-modal-caja { background: #fff; border-radius: 16px; width: 100%; max-width: 560px; max-height: 88vh; overflow-y: auto; padding: 20px; box-sizing: border-box; color: #2c1e0f; }
    .in-botones { display: flex; gap: 8px; margin-top: 16px; } .in-botones button { flex: 1; }
  `;
  document.head.appendChild(s);
}

async function cargarCatalogo(forzar) {
  if (cache && !forzar) return cache;
  const [snapCat, snapEst] = await Promise.all([
    getDocs(collection(db, "inventario_catalogo")),
    getDocs(collection(db, "inventario_estatus")),
  ]);
  let meta = null;
  const unidades = [];
  snapCat.docs.sort((a, b) => a.id.localeCompare(b.id)).forEach(d => {
    if (d.id === "meta") { meta = d.data(); return; }
    (d.data().unidades || []).forEach(u => unidades.push(u));
  });
  const estatus = new Map();
  snapEst.docs.forEach(d => estatus.set(d.id, d.data()));
  cache = { unidades, porId: new Map(unidades.map(u => [u.id, u])), meta, estatus };
  return cache;
}

// Motivos para revisar si sigue en la flota (el archivo no trae bajas).
function motivosRevisar(u, porId) {
  const m = [];
  if (porId.has(u.id + ".")) m.push(`Económico reutilizado (existe ${u.id}.)`);
  if (!u.placas) m.push("Sin placas");
  const anio = Number(u.modelo);
  if (!anio || anio < 2010) m.push(anio ? `Modelo ${anio}` : "Sin año");
  if (u.tipo === "TRACTOCAMION" && Number(u.kms) <= 1) m.push("Sin kilometraje");
  return m;
}

export function iniciarInventario(contenedor, datosUsuario, uid) {
  inyectarEstilos();
  const esAdmin = datosUsuario && datosUsuario.rol === "admin";
  let tab = "tracto";
  let pagina = 1;
  let operadoresPorUnidad = null; // Map unidad -> operador de Alanis Operadores (o null si no hay acceso)
  const f = { q: "", marca: "", estatus: "activas", operador: "", revisar: false };

  contenedor.innerHTML = `
    <section class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
        <h2 style="margin:0;">Inventario</h2>
        <button type="button" class="secundario" id="in-recargar">Recargar</button>
      </div>
      <p class="nota" id="in-meta" style="margin:6px 0 12px;"></p>
      <div class="in-tabs" id="in-tabs"></div>
      <div id="in-error" class="error"></div>
      <p id="in-exito" class="nota oculto" style="color:#1c7a41;"></p>
      <div id="in-cuerpo"><p class="nota">Cargando catálogo…</p></div>
    </section>`;
  const $ = (s) => contenedor.querySelector(s);

  // Operador en Alanis Operadores, para el cruce (si el usuario tiene acceso a Operadores).
  const cancelarOps = suscribirEspejo("operadores", (docs) => {
    operadoresPorUnidad = new Map();
    docs.filter(o => o.activo && o.numero).forEach(o => operadoresPorUnidad.set(String(o.numero).trim().toUpperCase(), o));
    if (cache && tab !== "importar") renderLista();
  }, () => { operadoresPorUnidad = null; });
  const vigilar = setInterval(() => { if (!contenedor.isConnected) { clearInterval(vigilar); cancelarOps(); } }, 3000);

  function avisar(t) {
    $("#in-exito").textContent = t;
    $("#in-exito").classList.remove("oculto");
    setTimeout(() => $("#in-exito").classList.add("oculto"), 6000);
  }

  // Estatus guardado de OTRA unidad física con el mismo económico (otra serie).
  function estatusDeOtraSerie(u) {
    const e = cache.estatus.get(u.id);
    return !!(e && e.serie && u.serie && e.serie !== u.serie);
  }
  function estatusDe(u) {
    const e = cache.estatus.get(u.id);
    if (!e || !ESTATUS[e.estatus] || estatusDeOtraSerie(u)) return "activa";
    return e.estatus;
  }
  function cruce(u) {
    if (u.tipo !== "TRACTOCAMION") return { clave: "na" };
    if (!operadoresPorUnidad) return { clave: "sinacceso" };
    const op = operadoresPorUnidad.get(String(u.id).toUpperCase());
    const tieneArchivo = u.operador && u.operador !== "SIN ASIGNAR";
    if (!op) return { clave: tieneArchivo ? "sincuenta" : "na" };
    const nombre = op.nombreOficial || op.nombre || "";
    if (!tieneArchivo) return { clave: "soloalla", nombre };
    return nombresCoinciden(u.operador, nombre) ? { clave: "ok", nombre } : { clave: "no", nombre };
  }

  function renderTabs() {
    const cuenta = (id) => cache.unidades.filter(u => tipoDe(u) === id).length;
    $("#in-tabs").innerHTML = TIPOS.map(t => `<button type="button" class="in-tab${tab === t.id ? " activo" : ""}" data-tab="${t.id}">${t.etiqueta}<em>${miles(cuenta(t.id))}</em></button>`).join("")
      + (esAdmin ? `<button type="button" class="in-tab${tab === "importar" ? " activo" : ""}" data-tab="importar">Actualizar catálogo</button>` : "");
    $("#in-tabs").querySelectorAll(".in-tab").forEach(b => b.addEventListener("click", () => {
      tab = b.dataset.tab; pagina = 1;
      f.q = ""; f.marca = ""; f.estatus = "activas"; f.operador = ""; f.revisar = false;
      renderTabs();
      tab === "importar" ? renderImportar() : renderLista();
    }));
  }

  function filtrar() {
    const q = norm(f.q);
    return cache.unidades.filter(u => {
      if (tipoDe(u) !== tab) return false;
      const est = estatusDe(u);
      if (f.estatus === "activas" && est !== "activa") return false;
      if (f.estatus !== "activas" && f.estatus !== "todas" && est !== f.estatus) return false;
      if (f.marca && u.marca !== f.marca) return false;
      if (f.operador === "con" && (!u.operador || u.operador === "SIN ASIGNAR")) return false;
      if (f.operador === "sin" && u.operador && u.operador !== "SIN ASIGNAR") return false;
      if (f.operador === "nocoincide" && cruce(u).clave !== "no") return false;
      if (f.revisar && (est !== "activa" || motivosRevisar(u, cache.porId).length === 0)) return false;
      if (q && !norm([u.id, u.serie, u.placas, u.motor, u.operador, u.tarjeta].join(" ")).includes(q)) return false;
      return true;
    }).sort((a, b) => String(a.id).localeCompare(String(b.id), "es", { numeric: true }));
  }

  function renderLista() {
    const delTipo = cache.unidades.filter(u => tipoDe(u) === tab);
    if (!delTipo.length) {
      $("#in-cuerpo").innerHTML = `<p class="nota" style="text-align:center;padding:16px;">${cache.unidades.length ? "No hay unidades de este tipo." : "Todavía no se ha cargado el catálogo." + (esAdmin ? " Usa la pestaña <b>Actualizar catálogo</b>." : "")}</p>`;
      return;
    }
    const esTracto = tab === "tracto";
    const activas = delTipo.filter(u => estatusDe(u) === "activa");
    const kpis = [
      `<div class="in-kpi v"><b>${miles(activas.length)}</b><small>Activas</small></div>`,
      `<div class="in-kpi r"><b>${miles(delTipo.length - activas.length)}</b><small>Baja / vendida</small></div>`,
      `<div class="in-kpi a"><b>${miles(activas.filter(u => motivosRevisar(u, cache.porId).length).length)}</b><small>Por revisar si siguen en la flota</small></div>`,
    ];
    if (esTracto) {
      kpis.push(`<div class="in-kpi"><b>${miles(activas.filter(u => u.operador && u.operador !== "SIN ASIGNAR").length)}</b><small>Con operador (archivo)</small></div>`);
      if (operadoresPorUnidad) kpis.push(`<div class="in-kpi r"><b>${miles(activas.filter(u => cruce(u).clave === "no").length)}</b><small>No coincide con Alanis Operadores</small></div>`);
    }
    const marcas = [...new Set(delTipo.map(u => u.marca).filter(Boolean))].sort();
    const lista = filtrar();
    const visibles = lista.slice(0, pagina * POR_PAGINA);
    $("#in-cuerpo").innerHTML = `
      <div class="in-kpis">${kpis.join("")}</div>
      <div class="in-filtros">
        <input type="text" id="in-q" placeholder="Buscar económico, serie, placas, motor${esTracto ? " u operador" : ""}…" value="${esc(f.q)}">
        <select id="in-marca"><option value="">Marca: todas</option>${marcas.map(m => `<option${f.marca === m ? " selected" : ""}>${esc(m)}</option>`).join("")}</select>
        <select id="in-estatus">
          <option value="activas"${f.estatus === "activas" ? " selected" : ""}>Solo activas</option>
          <option value="baja"${f.estatus === "baja" ? " selected" : ""}>Bajas</option>
          <option value="vendida"${f.estatus === "vendida" ? " selected" : ""}>Vendidas</option>
          <option value="todas"${f.estatus === "todas" ? " selected" : ""}>Todas</option>
        </select>
        ${esTracto ? `<select id="in-op"><option value="">Operador: todos</option><option value="con"${f.operador === "con" ? " selected" : ""}>Con operador</option><option value="sin"${f.operador === "sin" ? " selected" : ""}>Sin operador</option>${operadoresPorUnidad ? `<option value="nocoincide"${f.operador === "nocoincide" ? " selected" : ""}>No coincide</option>` : ""}</select>` : ""}
        <label style="display:inline-flex;gap:5px;align-items:center;margin:0;font-size:13px;"><input type="checkbox" id="in-rev" style="width:auto;"${f.revisar ? " checked" : ""}> Por revisar</label>
        <button type="button" class="secundario" id="in-excel">Exportar Excel</button>
      </div>
      <div class="tabla-wrap"><table class="in-tabla">
        <thead><tr><th>Económico</th><th>Marca · Año</th><th>Serie</th><th>Placas</th>${esTracto ? "<th>Kms</th><th>Operador (archivo)</th><th>Alanis Operadores</th>" : ""}<th>Estatus</th></tr></thead>
        <tbody>${visibles.map(u => {
          const est = estatusDe(u);
          const rev = est === "activa" ? motivosRevisar(u, cache.porId) : [];
          let celdaCruce = "";
          if (esTracto) {
            const c = cruce(u);
            celdaCruce = c.clave === "ok" ? `<span class="in-chip in-ok">✔ Coincide</span>`
              : c.clave === "no" ? `<span class="in-chip in-no">✖ Allá: ${esc(c.nombre)}</span>`
              : c.clave === "soloalla" ? `<span class="in-chip in-rev">Allá: ${esc(c.nombre)}</span>`
              : c.clave === "sincuenta" ? `<span class="in-chip in-gris">Sin cuenta</span>`
              : c.clave === "sinacceso" ? `<span class="in-sub">—</span>` : "—";
          }
          return `<tr data-id="${esc(u.id)}" class="${est !== "activa" ? "in-fuera" : ""}">
            <td class="in-eco">${esc(u.id)}</td>
            <td>${esc(u.marca || "—")} · ${esc(u.modelo || "—")}</td>
            <td>${esc(u.serie || "—")}</td>
            <td>${esc(u.placas || "—")}</td>
            ${esTracto ? `<td>${u.kms ? miles(u.kms) : "—"}</td><td>${u.operador && u.operador !== "SIN ASIGNAR" ? esc(u.operador) : `<span class="in-sub" style="display:inline">Sin asignar</span>`}</td><td>${celdaCruce}</td>` : ""}
            <td><span class="in-chip ${ESTATUS[est].clase}">${ESTATUS[est].txt}</span>${rev.length ? ` <span class="in-chip in-rev" title="${esc(rev.join(" · "))}">Revisar</span>` : ""}${estatusDeOtraSerie(u) ? ` <span class="in-chip in-no" title="El estatus guardado era de otra serie">Cambió la serie</span>` : ""}</td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>
      <p class="nota" style="margin-top:8px;">Mostrando ${miles(visibles.length)} de ${miles(lista.length)}.</p>
      ${lista.length > visibles.length ? `<button type="button" class="secundario in-mas" id="in-mas">Ver ${Math.min(POR_PAGINA, lista.length - visibles.length)} más</button>` : ""}`;

    const q = $("#in-q");
    q.addEventListener("input", () => { f.q = q.value; pagina = 1; const pos = q.selectionStart; renderLista(); const n = $("#in-q"); n.focus(); n.setSelectionRange(pos, pos); });
    const enlazar = (id, campo) => { const el = $(id); if (el) el.addEventListener("change", () => { f[campo] = el.type === "checkbox" ? el.checked : el.value; pagina = 1; renderLista(); }); };
    enlazar("#in-marca", "marca"); enlazar("#in-estatus", "estatus"); enlazar("#in-op", "operador"); enlazar("#in-rev", "revisar");
    const mas = $("#in-mas"); if (mas) mas.addEventListener("click", () => { pagina++; renderLista(); });
    $("#in-excel").addEventListener("click", () => exportarExcel(lista));
    $("#in-cuerpo").querySelectorAll("tbody tr").forEach(tr => tr.addEventListener("click", () => {
      const u = cache.porId.get(tr.dataset.id);
      if (u) abrirFicha(u);
    }));
  }

  async function abrirFicha(u) {
    const est = estatusDe(u);
    const e = cache.estatus.get(u.id) || null;
    const rev = motivosRevisar(u, cache.porId);
    const c = cruce(u);
    const fondo = document.createElement("div");
    fondo.className = "in-modal-fondo";
    let cruceHtml = "";
    if (u.tipo === "TRACTOCAMION") {
      cruceHtml = c.clave === "ok" ? `<div class="in-cruce ok">Archivo: <b>${esc(u.operador)}</b><br>Alanis Operadores (unidad ${esc(u.id)}): <b>${esc(c.nombre)}</b> · ✔ coincide</div>`
        : c.clave === "no" ? `<div class="in-cruce no">Archivo: <b>${esc(u.operador)}</b><br>Alanis Operadores (unidad ${esc(u.id)}): <b>${esc(c.nombre)}</b> · ✖ no coincide</div>`
        : c.clave === "soloalla" ? `<div class="in-cruce gris">Archivo: sin asignar<br>Alanis Operadores (unidad ${esc(u.id)}): <b>${esc(c.nombre)}</b></div>`
        : c.clave === "sincuenta" ? `<div class="in-cruce gris">Archivo: <b>${esc(u.operador)}</b><br>Nadie tiene esta unidad en Alanis Operadores.</div>`
        : c.clave === "sinacceso" ? `<div class="in-cruce gris">Archivo: <b>${esc(u.operador || "Sin asignar")}</b></div>`
        : `<div class="in-cruce gris">Sin operador asignado.</div>`;
    }
    const hist = (e && Array.isArray(e.historial) ? e.historial.slice().sort((a, b) => (b.ms || 0) - (a.ms || 0)) : [])
      .map(h => `• ${fechaCorta(h.fechaEvento)} · <b>${esc((ESTATUS[h.estatus] || {}).txt || h.estatus)}</b> · ${esc(h.motivo || "")} <span class="in-sub" style="display:inline">(${esc(h.porNombre || "")}, ${fechaHora(h.ms)})</span>`).join("<br>");
    fondo.innerHTML = `
      <div class="in-modal-caja in-modal" role="dialog" aria-modal="true">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
          <div style="font-size:18px;font-weight:800;">${esc(u.id)} <span class="in-chip ${ESTATUS[est].clase}" style="vertical-align:middle;">${ESTATUS[est].txt}</span></div>
          <button type="button" class="secundario in-cerrar" aria-label="Cerrar">✕</button>
        </div>
        <div class="in-sub" style="font-size:13px;margin-top:2px;">${esc(u.tipo)} · ${esc(u.marca || "—")} · ${esc(u.modelo || "—")} · ${esc(u.area || "—")}</div>
        <div class="in-campos">
          <div><small>No. de serie (VIN)</small><b>${esc(u.serie || "—")}</b></div>
          <div><small>Placas</small><b>${esc(u.placas || "—")}</b></div>
          <div><small>No. de motor</small><b>${esc(u.motor || "—")}</b></div>
          <div><small>Tarjeta / llave</small><b>${esc(u.tarjeta || "—")}</b></div>
          <div><small>Kms acumulados</small><b>${u.kms ? miles(u.kms) : "—"}</b></div>
          <div><small>Empresa</small><b>${esc(u.empresa || "—")}</b></div>
        </div>
        ${rev.length && est === "activa" ? `<div class="in-bloque"><span class="in-chip in-rev">Revisar</span> ${esc(rev.join(" · "))}</div>` : ""}
        ${u.tipo === "TRACTOCAMION" ? `<div class="in-bloque"><h4>Operador</h4>${cruceHtml}</div>` : ""}
        ${u.tipo === "TRACTOCAMION" ? `<div class="in-bloque"><h4>Órdenes de trabajo (últimas)</h4><div class="in-hist" id="in-ots">Cargando…</div></div>` : ""}
        <div class="in-bloque">
          <h4>Estatus en ADREMATASA Interno</h4>
          ${estatusDeOtraSerie(u) ? `<div class="in-cruce no" style="margin-bottom:8px;">⚠️ Hay un estatus <b>${esc((ESTATUS[e.estatus] || {}).txt || e.estatus)}</b> del ${fechaCorta(e.fechaEvento)} guardado para la serie <b>${esc(e.serie)}</b>. Esta unidad trae otra serie (<b>${esc(u.serie)}</b>), así que no se le aplica: se considera Activa.</div>` : ""}
          ${e && est !== "activa" && !estatusDeOtraSerie(u) ? `<div><b>${ESTATUS[est].txt}</b> desde el ${fechaCorta(e.fechaEvento)} · ${esc(e.motivo || "")}</div>` : `<div>Activa${e ? ` (reactivada el ${fechaCorta(e.fechaEvento)})` : ""}</div>`}
          ${hist ? `<div class="in-hist">${hist}</div>` : ""}
          ${esAdmin ? `
            <label>Cambiar estatus</label>
            <select class="in-f-est">${Object.entries(ESTATUS).map(([k, v]) => `<option value="${k}"${k === est ? " selected" : ""}>${v.txt}</option>`).join("")}</select>
            <label>Fecha del evento</label>
            <input type="date" class="in-f-fecha" value="${hoyIso()}" max="${hoyIso()}">
            <label>Motivo</label>
            <input type="text" class="in-f-motivo" maxlength="300" placeholder="Ej: vendida a tercero, siniestro, fin de vida útil, económico reutilizado…">
            <div class="error in-f-error" style="margin-top:8px;"></div>
            <div class="in-botones"><button type="button" class="secundario in-cerrar2">Cerrar</button><button type="button" class="in-f-guardar">Guardar estatus</button></div>
          ` : `<div class="in-botones"><button type="button" class="secundario in-cerrar2">Cerrar</button></div>`}
        </div>
      </div>`;
    document.body.appendChild(fondo);
    const cerrar = () => fondo.remove();
    fondo.querySelector(".in-cerrar").addEventListener("click", cerrar);
    fondo.querySelector(".in-cerrar2").addEventListener("click", cerrar);
    fondo.addEventListener("click", (ev) => { if (ev.target === fondo) cerrar(); });

    if (u.tipo === "TRACTOCAMION") {
      const caja = fondo.querySelector("#in-ots");
      try {
        const s = await getDocs(query(collection(db, "espejo_op_ordenes"), where("unidad", "==", String(u.id)), limit(20)));
        const ots = s.docs.map(d => d.data()).sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0)).slice(0, 5);
        caja.innerHTML = ots.length ? ots.map(o => `${esc(o.folio)} · ${fechaCorta(o.fecha)} · ${esc((o.fallas || []).slice(0, 2).map(x => x.name).join(", "))}${o.estado === "abierta" ? ` <span class="in-chip in-no">Abierta</span>` : o.estado === "terminada" ? ` <span class="in-chip in-ok">Terminada</span>` : ""}`).join("<br>") : "Sin órdenes registradas.";
      } catch (err) {
        caja.textContent = "No disponible (requiere acceso a Operadores).";
      }
    }

    const btn = fondo.querySelector(".in-f-guardar");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      const err = fondo.querySelector(".in-f-error");
      err.textContent = "";
      const nuevo = fondo.querySelector(".in-f-est").value;
      const fecha = fondo.querySelector(".in-f-fecha").value;
      const motivo = fondo.querySelector(".in-f-motivo").value.trim();
      if (!fecha) { err.textContent = "Indica la fecha del evento."; return; }
      if (fecha > hoyIso()) { err.textContent = "La fecha no puede ser futura."; return; }
      if (!motivo) { err.textContent = "Escribe el motivo."; return; }
      btn.disabled = true;
      const ms = Date.now();
      const entrada = { estatus: nuevo, fechaEvento: fecha, motivo, serie: u.serie || "", porUid: uid, porNombre: datosUsuario.nombre || "", ms };
      try {
        await setDoc(doc(db, "inventario_estatus", u.id), {
          unidad: u.id, tipo: u.tipo, serie: u.serie || "", estatus: nuevo, fechaEvento: fecha, motivo,
          por: { uid, nombre: datosUsuario.nombre || "" }, ms, actualizadoEn: serverTimestamp(),
          historial: arrayUnion(entrada),
        }, { merge: true });
        const previo = cache.estatus.get(u.id) || {};
        cache.estatus.set(u.id, { ...previo, serie: u.serie || "", estatus: nuevo, fechaEvento: fecha, motivo, ms, historial: [...(previo.historial || []), entrada] });
        cerrar();
        avisar(`${u.id}: estatus ${ESTATUS[nuevo].txt} guardado.`);
        renderTabs(); renderLista();
      } catch (e2) {
        err.textContent = "No se pudo guardar: " + e2.message;
        btn.disabled = false;
      }
    });
  }

  function cargarSheetJS() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = URL_SHEETJS;
      s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error("No cargó la librería de Excel.")));
      s.onerror = () => reject(new Error("No se pudo cargar la librería de Excel."));
      document.head.appendChild(s);
    });
  }

  async function exportarExcel(lista) {
    try {
      const XLSX = await cargarSheetJS();
      const filas = lista.map(u => {
        const est = estatusDe(u);
        const e = cache.estatus.get(u.id) || {};
        return {
          "Económico": u.id, "Tipo": u.tipo, "Marca": u.marca, "Año": u.modelo, "Serie": u.serie, "Placas": u.placas,
          "Motor": u.motor, "Tarjeta/llave": u.tarjeta, "Kms": u.kms, "Área": u.area, "Operador (archivo)": u.operador,
          "Estatus": ESTATUS[est].txt,
          "Fecha evento": est !== "activa" ? e.fechaEvento || "" : "", "Motivo": est !== "activa" ? e.motivo || "" : "",
          "Por revisar": est === "activa" ? motivosRevisar(u, cache.porId).join(" · ") : "",
        };
      });
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filas), "Inventario");
      XLSX.writeFile(libro, `Inventario_${(TIPOS.find(t => t.id === tab) || {}).etiqueta || "unidades"}_${hoyIso()}.xlsx`);
    } catch (e) {
      $("#in-error").textContent = "No se pudo generar el Excel: " + e.message;
    }
  }

  // ---- Actualizar catálogo con el Excel del Adrematasa oficial (solo admin) ----
  function leerFilas(XLSX, buf) {
    const wb = XLSX.read(buf, { type: "array" });
    const hoja = wb.Sheets[wb.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: false, defval: "" });
    if (!filas.length) throw new Error("El archivo está vacío.");
    const cab = filas[0].map(h => norm(h));
    const pos = (nombre, n = 1) => { let k = 0; for (let i = 0; i < cab.length; i++) if (cab[i] === nombre && ++k === n) return i; return -1; };
    const col = {
      id: pos("id_unidad"), modelo: pos("modelo"), kms: pos("kms_acumulados"), serie: pos("no_serie"),
      placas: pos("placas"), estado: pos("estado"), marca: pos("nombre", 1), tipo: pos("descripcion", 1),
      empresa: pos("nombre", 2), area: pos("descripcion", 2), tarjeta: pos("no_tarjeta_llave"), motor: pos("no_motor"),
      operador: pos("compute_0023"),
    };
    const faltan = Object.entries(col).filter(([, i]) => i < 0).map(([k]) => k);
    if (faltan.length) throw new Error("El archivo no tiene el formato esperado de unidades del Adrematasa (faltan columnas: " + faltan.join(", ") + ").");
    const v = (r, k) => String(r[col[k]] == null ? "" : r[col[k]]).trim();
    const unidades = [];
    const vistos = new Set();
    filas.slice(1).forEach(r => {
      const id = v(r, "id");
      if (!id || id.includes("/") || vistos.has(id)) return;
      vistos.add(id);
      const limpio = (x) => (/^0+$/.test(x) ? "" : x); // "000" = sin dato
      unidades.push({
        id, tipo: v(r, "tipo").toUpperCase(), marca: v(r, "marca"), modelo: v(r, "modelo") === "0" ? "" : v(r, "modelo"),
        kms: Number(v(r, "kms").replace(/,/g, "")) || 0, serie: limpio(v(r, "serie")), placas: v(r, "placas"),
        estadoArchivo: v(r, "estado").toUpperCase(), empresa: v(r, "empresa"), area: v(r, "area"),
        tarjeta: v(r, "tarjeta"), motor: limpio(v(r, "motor")), operador: v(r, "operador") || "SIN ASIGNAR",
      });
    });
    if (!unidades.length) throw new Error("No encontré unidades en el archivo.");
    return unidades;
  }

  function renderImportar() {
    const m = cache.meta;
    $("#in-cuerpo").innerHTML = `
      <div style="max-width:720px;">
        <h3 style="margin:0 0 6px;">Actualizar catálogo</h3>
        <p class="nota" style="margin:0;">Sube el Excel de unidades que exportas del Adrematasa oficial (formato de <b>unidades.xls</b>). Antes de guardar se muestra qué cambia. El estatus propio (Activa / Baja / Vendida) no se modifica.</p>
        <p class="nota">Última actualización: ${m ? `${fechaHora(m.importadoMs)} por ${esc((m.importadoPor || {}).nombre || "")} · ${miles(m.total)} unidades` : "nunca"}.</p>
        <label class="in-drop" style="display:block;cursor:pointer;">📄 Toca para elegir <b>unidades.xls</b>
          <input type="file" id="in-archivo" accept=".xls,.xlsx,.csv" style="display:none;"></label>
        <div id="in-imp-res"></div>
      </div>`;
    $("#in-archivo").addEventListener("change", async (ev) => {
      const archivo = ev.target.files && ev.target.files[0];
      const res = $("#in-imp-res");
      if (!archivo) return;
      res.innerHTML = `<p class="nota">Leyendo ${esc(archivo.name)}…</p>`;
      try {
        const XLSX = await cargarSheetJS();
        const nuevas = leerFilas(XLSX, await archivo.arrayBuffer());
        const idsNuevos = new Set(nuevas.map(u => u.id));
        const altas = [], cambios = [];
        nuevas.forEach(u => {
          const a = cache.porId.get(u.id);
          if (!a) { altas.push(u); return; }
          const dif = CAMPOS_CAMBIO.filter(([k]) => String(a[k] ?? "") !== String(u[k] ?? "")).map(([k, et]) => ({ campo: et, antes: a[k] ?? "", despues: u[k] ?? "" }));
          if (dif.length) cambios.push({ id: u.id, dif });
        });
        const fuera = cache.unidades.filter(u => !idsNuevos.has(u.id));
        // Económicos con estatus propio cuya SERIE ya no coincide: era otra unidad física.
        const otraSerie = nuevas.filter(u => {
          const e = cache.estatus.get(u.id);
          if (!e || !ESTATUS[e.estatus] || e.estatus === "activa") return false;
          return !!(e.serie && u.serie && e.serie !== u.serie);
        });
        const sinCambio = nuevas.length - altas.length - cambios.length;
        res.innerHTML = `
          <div class="in-res">
            <span style="background:#EAF3DE;"><b>${miles(altas.length)}</b>Unidades nuevas</span>
            <span style="background:#FBF0D5;"><b>${miles(cambios.length)}</b>Con cambios</span>
            <span style="background:#FCEBEB;"><b>${miles(fuera.length)}</b>Ya no vienen en el archivo</span>
            <span style="background:#F1EFE8;"><b>${miles(sinCambio)}</b>Sin cambios</span>
          </div>
          ${cambios.length ? `<div class="tabla-wrap"><table class="in-tabla" style="min-width:600px;"><thead><tr><th>Económico</th><th>Cambio</th></tr></thead><tbody>${cambios.slice(0, 40).map(c => `<tr><td class="in-eco">${esc(c.id)}</td><td>${c.dif.map(d => `${esc(d.campo)}: <i>${esc(d.antes || "—")}</i> → <b>${esc(d.despues || "—")}</b>`).join("<br>")}</td></tr>`).join("")}</tbody></table></div>${cambios.length > 40 ? `<p class="nota">… y ${miles(cambios.length - 40)} más.</p>` : ""}` : ""}
          ${otraSerie.length ? `<div class="in-cruce no" style="margin:10px 0;">⚠️ <b>${otraSerie.length}</b> económico${otraSerie.length === 1 ? "" : "s"} con estatus propio ahora trae${otraSerie.length === 1 ? "" : "n"} <b>otra serie</b> (LIS lo reutilizó para otra unidad). Su estatus no se aplicará a la unidad nueva:<br>${otraSerie.slice(0, 20).map(u => { const e = cache.estatus.get(u.id); return `<b>${esc(u.id)}</b>: ${esc((ESTATUS[e.estatus] || {}).txt || e.estatus)} del ${fechaCorta(e.fechaEvento)} era de la serie ${esc(e.serie)}; ahora ${esc(u.serie)}`; }).join("<br>")}</div>` : ""}
          ${fuera.length ? `<p class="nota">Ya no vienen: ${fuera.slice(0, 30).map(u => esc(u.id)).join(", ")}${fuera.length > 30 ? "…" : ""}. Saldrán del catálogo (su estatus propio se conserva).</p>` : ""}
          <div class="error" id="in-imp-error"></div>
          <div class="in-botones" style="max-width:420px;"><button type="button" class="secundario" id="in-imp-cancelar">Cancelar</button><button type="button" id="in-imp-aplicar">Aplicar cambios (${miles(nuevas.length)} unidades)</button></div>`;
        $("#in-imp-cancelar").addEventListener("click", renderImportar);
        $("#in-imp-aplicar").addEventListener("click", async () => {
          const btn = $("#in-imp-aplicar");
          btn.disabled = true;
          btn.textContent = "Guardando…";
          try {
            await guardarCatalogo(nuevas, { nuevas: altas.length, cambios: cambios.length, fuera: fuera.length, sinCambio, archivo: archivo.name }, cambios, fuera);
            await cargarCatalogo(true);
            renderTabs();
            tab = "tracto";
            renderTabs(); renderLista(); pintarMeta();
            avisar(`Catálogo actualizado: ${miles(nuevas.length)} unidades (${altas.length} nuevas, ${cambios.length} con cambios, ${fuera.length} fuera).`);
          } catch (e3) {
            $("#in-imp-error").textContent = "No se pudo guardar: " + e3.message;
            btn.disabled = false;
            btn.textContent = "Aplicar cambios";
          }
        });
      } catch (e) {
        res.innerHTML = `<div class="error">${esc(e.message)}</div>`;
      }
    });
  }

  async function guardarCatalogo(unidades, resumen, cambios, fuera) {
    const partes = [];
    for (let i = 0; i < unidades.length; i += TAM_PARTE) partes.push(unidades.slice(i, i + TAM_PARTE));
    const ms = Date.now();
    const lote = writeBatch(db);
    partes.forEach((p, i) => lote.set(doc(db, "inventario_catalogo", "p" + String(i).padStart(2, "0")), { unidades: p, parte: i, importadoMs: ms }));
    // Borrar partes que sobren de una carga anterior más grande.
    const existentes = await getDocs(collection(db, "inventario_catalogo"));
    existentes.docs.forEach(d => {
      if (d.id !== "meta" && Number(d.id.slice(1)) >= partes.length) lote.delete(d.ref);
    });
    const por = { uid, nombre: datosUsuario.nombre || "" };
    lote.set(doc(db, "inventario_catalogo", "meta"), { total: unidades.length, partes: partes.length, importadoMs: ms, importadoPor: por, archivo: resumen.archivo });
    lote.set(doc(collection(db, "inventario_importaciones")), {
      ms, por, resumen,
      cambios: cambios.slice(0, 300),
      fuera: fuera.slice(0, 300).map(u => u.id),
    });
    await lote.commit();
  }

  function pintarMeta() {
    const m = cache.meta;
    $("#in-meta").textContent = m
      ? `Catálogo del Adrematasa oficial · actualizado ${fechaHora(m.importadoMs)} por ${(m.importadoPor || {}).nombre || ""} · ${miles(m.total)} unidades. El estatus Activa/Baja/Vendida es propio de esta app.`
      : "Todavía no se ha cargado el catálogo.";
  }

  async function iniciar(forzar) {
    $("#in-error").textContent = "";
    try {
      await cargarCatalogo(forzar);
      pintarMeta();
      if (!cache.unidades.length && esAdmin) tab = "importar";
      renderTabs();
      tab === "importar" ? renderImportar() : renderLista();
    } catch (e) {
      $("#in-cuerpo").innerHTML = "";
      $("#in-error").textContent = "No se pudo cargar el inventario: " + e.message;
    }
  }
  $("#in-recargar").addEventListener("click", () => iniciar(true));
  iniciar(false);
}