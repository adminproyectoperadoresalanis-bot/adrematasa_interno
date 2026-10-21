// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/public/js/operadores.js
// ##########################################################################
// Utilidades → Operadores (2026-10-13, pedido de Ivan).
//
// Pantallas de ADREMATASA Interno que operan sobre Alanis Operadores. El
// navegador nunca toca la base de Alanis Operadores: las ACCIONES pasan por las
// Cloud Functions de functions/operadoresAlanis.js, y las LISTAS se leen en vivo
// de los espejos espejo_op_* de este proyecto (2026-10-16, espejosOperadores.js).
//
// Paridad con el panel admin de Alanis Operadores (js/admin2.js):
//   - Aceptación de ingreso: lista + buscador + modal con número económico,
//     nombre oficial y teléfono; Rechazar / Aprobar acceso (como operador).
//   - Órdenes de trabajo: filtro por fechas (ayer–hoy por default) e
//     Imprimir (misma "Orden de Taller"). Crear/Editar: pendiente (necesitan
//     el catálogo de fallas de data.js).

import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";
import { marcarAlerta } from "./navegacion.js";
import { db, auth } from "./firebase-config.js";
import { collection, query, where, onSnapshot, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { suscribirEspejo, leerEspejo, alSalirDePantalla, detenerEspejos } from "./espejosOperadores.js";

const funciones = getFunctions(undefined, "us-central1");
const fnResolverSolicitud = httpsCallable(funciones, "resolverSolicitudOperador");
const fnGuardarDatos = httpsCallable(funciones, "guardarDatosOperador");
const fnCambiarEstado = httpsCallable(funciones, "cambiarEstadoOperador");
const fnHistorialUnidad = httpsCallable(funciones, "historialUnidadOperador");
const fnGuardarOT = httpsCallable(funciones, "guardarOrdenTrabajo");
const fnTerminarOT = httpsCallable(funciones, "terminarOrdenTrabajo");
const fnAsignarRuta = httpsCallable(funciones, "asignarRutaOperadores");

// ---- Tipo de ruta (2026-10-15) ----
// "circuito" (2026-10-22): operadores de ruta corta que trabajan un circuito; se pagan aparte en Asistencia.
const TIPOS_RUTA = ["larga", "corta", "local", "circuito"];
const ETIQUETA_RUTA = { larga: "Larga", corta: "Corta", local: "Local", circuito: "Circuito", sindefinir: "Sin definir" };

function pillRuta(ruta) {
  const r = TIPOS_RUTA.includes(ruta) ? ruta : "sindefinir";
  return `<span class="or-ruta ${r}">${ETIQUETA_RUTA[r].toUpperCase()}</span>`;
}

// Botones Larga / Corta / Local. alElegir(ruta) se llama al tocar uno.
function selectorRuta(actual) {
  return `<div class="or-ruta-sel" role="radiogroup" aria-label="Tipo de ruta">${TIPOS_RUTA.map(r =>
    `<button type="button" role="radio" class="or-ruta-op${actual === r ? " activo" : ""}" data-ruta="${r}" aria-checked="${actual === r}">${ETIQUETA_RUTA[r]}</button>`).join("")}</div>`;
}
function conectarSelectorRuta(raiz, alElegir) {
  raiz.querySelectorAll(".or-ruta-op").forEach(b => b.addEventListener("click", () => {
    raiz.querySelectorAll(".or-ruta-op").forEach(x => { x.classList.toggle("activo", x === b); x.setAttribute("aria-checked", x === b); });
    alElegir(b.dataset.ruta);
  }));
}

// Mismo logo que imprime admin2.js en Alanis Operadores.
const LOGO_ORDEN_TALLER = "https://alanis-operadores.web.app/img/logo-reporte.png";

function esc(texto) {
  const div = document.createElement("div");
  div.textContent = texto == null ? "" : String(texto);
  return div.innerHTML;
}

function iniciales(nombre) {
  return (nombre || "OP").split(" ").filter(Boolean).map(n => n[0]).join("").substring(0, 2).toUpperCase();
}

function mensajeError(err, porDefecto) {
  return (err && err.message) ? err.message : porDefecto;
}

function inyectarEstilos() {
  if (document.getElementById("estilos-operadores")) return;
  const estilo = document.createElement("style");
  estilo.id = "estilos-operadores";
  estilo.textContent = `
    .op-buscar { width: 100%; box-sizing: border-box; margin-bottom: 12px; }
    .op-fila { display: flex; align-items: center; gap: 12px; background: #fff; border: 1px solid #e2ddd5;
      border-radius: 12px; padding: 12px 14px; margin-bottom: 8px; cursor: pointer; width: 100%;
      text-align: left; font: inherit; color: #2c1e0f; }
    .op-fila:hover { border-color: #2c1e0f; }
    .op-avatar { width: 36px; height: 36px; border-radius: 50%; background: #efe9e1; display: inline-flex;
      align-items: center; justify-content: center; font-size: 13px; font-weight: 600; flex-shrink: 0; }
    .op-nombre { font-size: 14px; font-weight: 600; }
    .op-sub { font-size: 12px; color: #6b5f52; }
    .op-fecha { font-size: 12px; color: #6b5f52; white-space: nowrap; margin-left: auto; }
    .op-modal-fondo { position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 1000; display: flex;
      align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; }
    .op-modal { background: #fff; border-radius: 16px; width: 100%; max-width: 420px; max-height: 88vh;
      overflow-y: auto; padding: 22px; box-sizing: border-box; color: #2c1e0f; }
    .op-modal label { display: block; font-size: 12px; color: #6b5f52; margin: 14px 0 4px; }
    .op-modal input, .op-modal select { width: 100%; box-sizing: border-box; }
    .op-botones { display: flex; gap: 8px; margin-top: 20px; }
    .op-botones button { flex: 1; }
    .op-filtro { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 12px; }
    .op-filtro > div { flex: 1; min-width: 130px; }
    .op-filtro label { display: block; font-size: 12px; color: #6b5f52; margin-bottom: 4px; }
    .op-filtro input { width: 100%; box-sizing: border-box; }
    .ot-card { background: #fff; border: 1px solid #e2ddd5; border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; }
    .ot-folio { font-size: 15px; font-weight: 700; color: #2c1e0f; }
    .ot-falla { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; padding: 4px 0;
      border-bottom: 1px solid #f0ece6; }
    .ot-sev { font-size: 11px; font-weight: 600; color: #fff; border-radius: 4px; padding: 1px 7px; flex-shrink: 0; }
    .ot-sev.alta { background: #E24B4A; } .ot-sev.media { background: #BA7517; } .ot-sev.baja { background: #639922; }
    .ot-acciones { display: flex; gap: 6px; margin-top: 10px; }
    .ot-acciones button { flex: 1; }
    .ot-encabezado { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
    .ot-origen { font-size: 11px; color: #8a7f73; margin-top: 4px; }
    .ot-cab { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
    .ot-estado { font-size: 11px; font-weight: 700; border-radius: 10px; padding: 2px 9px; }
    .ot-estado.abierta { background: #FCEBEB; color: #A32D2D; }
    .ot-estado.terminada { background: #EAF3DE; color: #27500A; }
    .ot-card.abierta { border-color: #E9B4AE; }
    .ot-terminar { background: #3B7A1E !important; border-color: #3B7A1E !important; color: #fff !important; }
    .ot-cierre { font-size: 11.5px; color: #27500A; margin-top: 6px; }
    .ot-filtro-abiertas { margin: 4px 0 10px; }
    .ot-filtro-abiertas button.activo { background: #A32D2D; border-color: #A32D2D; color: #fff; }
    .ot-t-fila { display: flex; gap: 8px; }
    .ot-t-fila input { flex: 1; min-width: 0; }
    .ot-m-fila { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid #f0ece6; font-size: 13px; }
    .ot-m-fila .ot-sev { margin-left: auto; }
    .ot-m-quitar { background: none; border: none; color: #E24B4A; font-size: 16px; cursor: pointer; padding: 0 4px; }
    .ot-m-cat { max-height: 200px; overflow-y: auto; margin-top: 6px; border: 1px solid #efebe5; border-radius: 8px; padding: 0 8px; }
    .ot-m-cat .ot-m-fila { cursor: pointer; }
    .ot-m-cat .ot-m-fila:hover { background: #f5f3f0; }
    .ot-m-catnom { font-size: 10px; color: #8a7f73; }
    .ot-m-vacio { font-size: 12px; color: #8a7f73; padding: 6px 0; }
    .ot-combo { position: relative; }
    .ot-combo-lista { position: absolute; left: 0; right: 0; top: 100%; z-index: 5; background: #fff;
      border: 1px solid #e2ddd5; border-radius: 8px; margin-top: 2px; max-height: 220px; overflow-y: auto;
      box-shadow: 0 6px 16px rgba(0,0,0,.12); }
    .ot-combo-op { display: flex; gap: 10px; align-items: center; width: 100%; background: none; border: none;
      border-bottom: 1px solid #f0ece6; padding: 8px 10px; text-align: left; font: inherit; font-size: 13px;
      color: #2c1e0f; cursor: pointer; }
    .ot-combo-op:hover, .ot-combo-op.marcado { background: #f5f3f0; }
    .ot-combo-unidad { font-weight: 700; min-width: 48px; }
    .ot-m-opinfo { font-size: 11px; margin-top: 4px; color: #8a7f73; }
    .ot-m-opinfo.ligado { color: #1c7a41; }
    .or-encabezado { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
    .or-encabezado input { flex: 1; min-width: 180px; }
    .or-total { font-size: 12px; background: #E6F1FB; color: #0C447C; border-radius: 10px; padding: 3px 10px; white-space: nowrap; }
    .or-card { background: #fff; border: 1px solid #e2ddd5; border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; }
    .or-card.inactivo { opacity: .85; }
    .or-fila { display: flex; align-items: center; gap: 10px; }
    .or-badge { font-size: 11px; border-radius: 10px; padding: 2px 8px; white-space: nowrap; }
    .or-badge.activo { background: #EAF3DE; color: #27500A; }
    .or-badge.inactivo { background: #FCEBEB; color: #791F1F; }
    .or-badge.oficial { background: #EAF3DE; color: #27500A; }
    .or-badge.sinoficial { background: #FAEEDA; color: #633806; }
    .or-card label { display: block; font-size: 12px; color: #6b5f52; margin: 8px 0 3px; }
    .or-card input, .or-card select { width: 100%; box-sizing: border-box; }
    .or-datos { display: flex; gap: 6px; }
    .or-datos .u { width: 80px; flex-shrink: 0; }
    .or-datos .l { width: 92px; flex-shrink: 0; }
    .or-datos .t { flex: 1; min-width: 0; }
    .or-acciones { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
    .or-acciones button { flex: 1; min-width: 100px; }
    .or-hist { border-top: 1px solid #efebe5; margin-top: 10px; padding-top: 8px; font-size: 12px; color: #6b5f52; }
    .or-ruta { font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: 10px; white-space: nowrap; letter-spacing: .02em; }
    .or-ruta.larga { background: #E6F1FB; color: #0C447C; } .or-ruta.corta { background: #EAF3DE; color: #27500A; }
    .or-ruta.circuito { background: #EEE6F8; color: #4B2A7B; }
    .or-ruta.local { background: #FAEEDA; color: #633806; } .or-ruta.sindefinir { background: #F1EFE8; color: #5F5E5A; }
    .or-ruta-sel { display: flex; gap: 4px; border: 1px solid #e2ddd5; border-radius: 10px; padding: 3px; }
    .or-ruta-op { flex: 1; background: none; border: none; border-radius: 8px; padding: 8px 4px; font: inherit; font-size: 13px;
      font-weight: 600; color: #6b5f52; cursor: pointer; }
    .or-ruta-op.activo { background: #2c1e0f; color: #fff; }
    .or-chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 0 0 10px; }
    .or-chip { background: #fff; border: 1px solid #e2ddd5; border-radius: 14px; padding: 5px 11px; font: inherit; font-size: 12px;
      color: #6b5f52; cursor: pointer; }
    .or-chip.activo { background: #2c1e0f; border-color: #2c1e0f; color: #fff; }
    .or-lista { background: #fff; border: 1px solid #e2ddd5; border-radius: 12px; overflow: hidden; }
    .or-renglon { display: flex; align-items: center; gap: 10px; width: 100%; background: #fff; border: none;
      border-bottom: 1px solid #efebe5; padding: 11px 14px; text-align: left; font: inherit; color: #2c1e0f; cursor: pointer; }
    .or-renglon:last-child { border-bottom: none; }
    .or-renglon:hover { background: #f5f3f0; }
    .or-renglon.inactivo { opacity: .6; }
    .or-unidad-num { font-weight: 700; font-size: 14px; min-width: 46px; }
    .or-nom { flex: 1; min-width: 0; font-size: 14px; }
    .or-nom small { display: block; font-size: 11.5px; color: #6b5f52; }
    .or-punto { width: 8px; height: 8px; border-radius: 50%; background: #3B6D11; flex-shrink: 0; }
    .or-punto.off { background: #B4B2A9; }
    .or-volver { background: none; border: none; padding: 0; margin: 0 0 10px; font: inherit; font-size: 14px; color: #6b5f52; cursor: pointer; }
    .or-volver:hover { color: #2c1e0f; }
    .or-barra { position: sticky; bottom: 8px; margin-top: 10px; background: #2c1e0f; color: #fff; border-radius: 12px;
      padding: 10px 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 13px; }
    .or-barra-btn { background: #fff; color: #2c1e0f; border: none; border-radius: 8px; padding: 7px 12px; font: inherit;
      font-size: 13px; font-weight: 600; cursor: pointer; }
    .or-barra-btn:disabled { opacity: .5; cursor: default; }
  `;
  document.head.appendChild(estilo);
}

// ============================================================================
// Aceptación de ingreso
// ============================================================================
export function iniciarSolicitudesOperadores(contenedor) {
  inyectarEstilos();
  contenedor.innerHTML = `
    <section class="panel">
      <h2>Solicitudes de acceso pendientes</h2>
      <p class="nota">Operadores que se registraron en Alanis Operadores y esperan que se les dé acceso.</p>
      <div id="op-sol-error" class="error"></div>
      <p id="op-sol-exito" class="nota oculto" style="color:#1c7a41;"></p>
      <input type="text" id="op-sol-buscar" class="op-buscar" placeholder="Buscar por nombre o correo...">
      <div id="op-sol-lista"><p class="nota">Cargando…</p></div>
    </section>
  `;
  const lista = contenedor.querySelector("#op-sol-lista");
  const buscar = contenedor.querySelector("#op-sol-buscar");
  const errorDiv = contenedor.querySelector("#op-sol-error");
  const exitoP = contenedor.querySelector("#op-sol-exito");
  let solicitudes = [];

  // En vivo desde el espejo (2026-10-16): una solicitud nueva aparece sola.
  const cancelar = suscribirEspejo("solicitudes", (docs) => {
    errorDiv.textContent = "";
    solicitudes = docs.map(d => ({ ...d, uid: d._id }))
      .sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));
    marcarAlerta("operadoresSolicitudes", solicitudes.length > 0);
    render();
  }, (err) => {
    lista.innerHTML = "";
    errorDiv.textContent = mensajeError(err, "No se pudieron cargar las solicitudes.");
  });
  alSalirDePantalla(contenedor, cancelar);

  function render() {
    const q = (buscar.value || "").trim().toLowerCase();
    const filtradas = !q ? solicitudes : solicitudes.filter(s =>
      s.nombre.toLowerCase().includes(q) || s.correo.toLowerCase().includes(q));
    if (filtradas.length === 0) {
      lista.innerHTML = `<p class="nota" style="text-align:center;padding:16px;">No hay solicitudes pendientes.</p>`;
      return;
    }
    lista.innerHTML = filtradas.map(s => {
      const fecha = s.timestampMs
        ? new Date(s.timestampMs).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
        : "—";
      return `
        <button type="button" class="op-fila" data-uid="${esc(s.uid)}">
          <span class="op-avatar">${esc(iniciales(s.nombre))}</span>
          <span style="min-width:0;">
            <span class="op-nombre" style="display:block;">${esc(s.nombre || "Sin nombre")}</span>
            <span class="op-sub">${esc(s.correo || "—")}</span>
            <span class="op-sub" style="display:block;${s.unidad ? "" : "color:#BA7517;"}">${s.unidad ? "Unidad " + esc(s.unidad) : "Sin unidad capturada"}</span>
          </span>
          <span class="op-fecha">${esc(fecha)} ›</span>
        </button>`;
    }).join("");
    lista.querySelectorAll(".op-fila").forEach(btn => {
      btn.addEventListener("click", () => {
        const s = solicitudes.find(x => x.uid === btn.dataset.uid);
        if (s) abrirModal(s);
      });
    });
  }

  function abrirModal(s) {
    const fecha = s.timestampMs
      ? new Date(s.timestampMs).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })
      : "—";
    const fondo = document.createElement("div");
    fondo.className = "op-modal-fondo";
    fondo.innerHTML = `
      <div class="op-modal" role="dialog" aria-modal="true">
        <div style="display:flex;justify-content:space-between;gap:8px;">
          <div>
            <div style="font-size:17px;font-weight:700;">${esc(s.nombre || "Sin nombre")}</div>
            <div class="op-sub">${esc(s.correo || "—")}</div>
            <div class="op-sub">Solicitó el ${esc(fecha)}</div>
          </div>
          <button type="button" class="secundario op-cerrar" aria-label="Cerrar">✕</button>
        </div>
        <label for="op-m-numero">Número económico (opcional)</label>
        <input type="text" id="op-m-numero" placeholder="Ej: 1121" value="${esc(s.unidad || "")}">
        <label for="op-m-nombre">Nombre oficial (el que se verá en ADREMATASA)</label>
        <input type="text" id="op-m-nombre" placeholder="Nombre completo oficial">
        <label for="op-m-telefono">Teléfono (opcional)</label>
        <div style="display:flex;gap:6px;">
          <select id="op-m-lada" style="width:96px;flex-shrink:0;">
            <option value="52"${s.lada === "1" ? "" : " selected"}>MX +52</option>
            <option value="1"${s.lada === "1" ? " selected" : ""}>US +1</option>
          </select>
          <input type="tel" id="op-m-telefono" placeholder="10 dígitos" style="flex:1;min-width:0;" value="${esc(s.telefono || "")}">
        </div>
        <label>Tipo de ruta</label>
        ${selectorRuta("")}
        <div class="error op-m-error" style="margin-top:10px;"></div>
        <div class="op-botones">
          <button type="button" class="btn-rechazar op-rechazar">Rechazar</button>
          <button type="button" class="op-aprobar">Aprobar acceso</button>
        </div>
      </div>
    `;
    document.body.appendChild(fondo);
    const cerrar = () => fondo.remove();
    fondo.querySelector(".op-cerrar").addEventListener("click", cerrar);
    fondo.addEventListener("click", (e) => { if (e.target === fondo) cerrar(); });

    const errorModal = fondo.querySelector(".op-m-error");
    let tipoRuta = "";
    conectarSelectorRuta(fondo, (r) => { tipoRuta = r; errorModal.textContent = ""; });
    const btnAprobar = fondo.querySelector(".op-aprobar");
    const btnRechazar = fondo.querySelector(".op-rechazar");

    async function resolver(accion) {
      errorModal.textContent = "";
      const telefono = fondo.querySelector("#op-m-telefono").value.replace(/\D/g, "");
      if (accion === "aprobar" && telefono !== "" && telefono.length !== 10) {
        errorModal.textContent = "El teléfono debe tener 10 dígitos.";
        return;
      }
      if (accion === "aprobar" && !tipoRuta) {
        errorModal.textContent = "Elige el tipo de ruta antes de aprobar.";
        return;
      }
      btnAprobar.disabled = true;
      btnRechazar.disabled = true;
      try {
        const res = await fnResolverSolicitud({
          uid: s.uid,
          accion,
          numero: fondo.querySelector("#op-m-numero").value,
          nombreOficial: fondo.querySelector("#op-m-nombre").value,
          lada: fondo.querySelector("#op-m-lada").value,
          telefono,
          tipoRuta: accion === "aprobar" ? tipoRuta : undefined
        });
        cerrar();
        exitoP.textContent = accion === "aprobar"
          ? `${res.data.nombre || "Operador"} aprobado como operador.`
          : "Solicitud rechazada.";
        exitoP.classList.remove("oculto");
        // Se quita de inmediato; el espejo lo confirma en 1–2 segundos.
        solicitudes = solicitudes.filter(x => x.uid !== s.uid);
        render();
      } catch (err) {
        errorModal.textContent = mensajeError(err, "No se pudo resolver la solicitud.");
        btnAprobar.disabled = false;
        btnRechazar.disabled = false;
      }
    }

    btnAprobar.addEventListener("click", () => resolver("aprobar"));
    btnRechazar.addEventListener("click", () => {
      if (confirm(`¿Rechazar la solicitud de ${s.nombre || "este operador"}?`)) resolver("rechazar");
    });
  }

  buscar.addEventListener("input", render);
}

// ============================================================================
// Punto de alerta de "Aceptación de ingreso" (2026-10-14; en vivo desde el
// espejo 2026-10-16 — antes consultaba una Cloud Function cada 10 minutos).
// Usa la misma escucha que la pantalla, así que no cuesta lecturas extra.
// ============================================================================
let cancelarAlertaOperadores = null;

export function detenerAlertasOperadores() {
  if (cancelarAlertaOperadores) cancelarAlertaOperadores();
  cancelarAlertaOperadores = null;
  marcarAlerta("operadoresSolicitudes", false);
  detenerEspejos(); // se llama al cerrar sesión: cierra todas las escuchas de espejos
  detenerEscuchaOT();
}

export function iniciarAlertasOperadores() {
  // Deja lista la escucha de las órdenes de ayer–hoy para que Órdenes de
  // trabajo abra al instante (son pocas: ~10–20 lecturas por sesión).
  const hoy = new Date();
  const ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
  escucharOT(fechaLocal(ayer), fechaLocal(hoy), () => {})();
  if (cancelarAlertaOperadores) cancelarAlertaOperadores();
  cancelarAlertaOperadores = suscribirEspejo("solicitudes",
    (docs) => marcarAlerta("operadoresSolicitudes", docs.length > 0));
}

// ============================================================================
// Órdenes de trabajo (consulta + imprimir)
// ============================================================================
function fechaLocal(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

const SEV_LABEL = { alta: "Alta", media: "Media", baja: "Baja" };
// La copia inicial del espejo trajo 120 días de órdenes (2026-10-16).
const ESPEJO_OT_DESDE = "2026-06-18";

// ---- Escucha de órdenes que sobrevive al cambiar de pantalla (2026-10-16) ----
// Antes se abría una consulta nueva cada vez que se entraba a Órdenes de
// trabajo (de ahí la espera). Ahora la escucha del último rango de fechas se
// queda viva toda la sesión: al regresar, la lista sale de inmediato y sigue
// en vivo. Solo se cambia si se busca otro rango; se cierra al cerrar sesión.
let otVivo = null; // { desde, hasta, ordenes, error, oyentes:Set, cancelar }

function escucharOT(desde, hasta, alCambiar, alError) {
  if (!otVivo || otVivo.desde !== desde || otVivo.hasta !== hasta) {
    detenerEscuchaOT();
    const v = otVivo = { desde, hasta, ordenes: null, error: null, oyentes: new Set(), cancelar: null };
    const q = query(collection(db, "espejo_op_ordenes"), where("fecha", ">=", desde), where("fecha", "<=", hasta));
    v.cancelar = onSnapshot(q, (snap) => {
      v.ordenes = snap.docs.map(d => ({ ...d.data(), id: d.id }))
        .sort((a, b) => (b.fecha + (b.hora || "")).localeCompare(a.fecha + (a.hora || "")) || (b.timestampMs || 0) - (a.timestampMs || 0));
      v.error = null;
      v.oyentes.forEach(o => o.alCambiar(v.ordenes));
    }, (err) => {
      console.warn("Espejo órdenes:", err.message);
      if (otVivo === v) otVivo = null; // la próxima vez se reintenta
      v.oyentes.forEach(o => o.alError && o.alError(err));
    });
  }
  const v = otVivo;
  const oyente = { alCambiar, alError };
  v.oyentes.add(oyente);
  if (v.ordenes) alCambiar(v.ordenes);
  return () => v.oyentes.delete(oyente);
}

function detenerEscuchaOT() {
  if (otVivo && otVivo.cancelar) { try { otVivo.cancelar(); } catch (_) { /* ya cerrada */ } }
  otVivo = null;
}

export function iniciarOrdenesTrabajo(contenedor, nombreUsuario) {
  inyectarEstilos();
  const hoy = new Date();
  const ayer = new Date(); ayer.setDate(ayer.getDate() - 1);

  contenedor.innerHTML = `
    <section class="panel">
      <div class="ot-encabezado">
        <h2>Órdenes de trabajo</h2>
        <button type="button" id="ot-nueva">+ Nueva orden</button>
      </div>
      <p class="nota">Reportes de taller capturados por los operadores en Alanis Operadores, y las órdenes creadas aquí por Operaciones.</p>
      <p id="ot-exito" class="nota oculto" style="color:#1c7a41;"></p>
      <div class="op-filtro">
        <div><label for="ot-desde">Desde</label><input type="date" id="ot-desde" value="${fechaLocal(ayer)}"></div>
        <div><label for="ot-hasta">Hasta</label><input type="date" id="ot-hasta" value="${fechaLocal(hoy)}"></div>
        <div style="flex:0 0 auto;min-width:0;"><button type="button" id="ot-buscar">Buscar</button></div>
      </div>
      <div class="ot-filtro-abiertas"><button type="button" class="secundario" id="ot-abiertas">En taller ahora (…)</button></div>
      <div id="ot-error" class="error"></div>
      <div id="ot-lista"><p class="nota">Cargando…</p></div>
      <p id="ot-limite" class="nota oculto" style="margin-top:8px;"></p>
    </section>
  `;
  const lista = contenedor.querySelector("#ot-lista");
  const errorDiv = contenedor.querySelector("#ot-error");
  const inDesde = contenedor.querySelector("#ot-desde");
  const inHasta = contenedor.querySelector("#ot-hasta");
  let ordenes = [];
  let cancelarOT = null;
  // Control de taller (2026-10-19): "En taller ahora" muestra las OTs
  // abiertas sin importar la fecha (las que tienen operadores bloqueados).
  let soloAbiertas = false;
  let abiertas = [];
  const btnAbiertas = contenedor.querySelector("#ot-abiertas");
  const cancelarAbiertas = suscribirEspejo("otAbiertas", (docs) => {
    abiertas = docs.map(d => ({ ...d, id: d._id }))
      .sort((a, b) => (a.timestampMs || 0) - (b.timestampMs || 0));
    btnAbiertas.textContent = `En taller ahora (${abiertas.length})`;
    if (soloAbiertas) render();
  }, () => { btnAbiertas.textContent = "En taller ahora"; });
  alSalirDePantalla(contenedor, cancelarAbiertas);
  btnAbiertas.addEventListener("click", () => {
    soloAbiertas = !soloAbiertas;
    btnAbiertas.classList.toggle("activo", soloAbiertas);
    render();
  });
  // ¿Puede terminar OTs? admin, o puesto/área de Coordinador (igual que la función).
  let puedeTerminar = false;
  leerPuedeTerminarOT().then(v => { puedeTerminar = v; render(); });
  // Si ya se consultó otro rango en esta sesión, se abre con ese mismo rango.
  if (otVivo) { inDesde.value = otVivo.desde; inHasta.value = otVivo.hasta; }

  // En vivo desde el espejo (2026-10-16): solo se leen las órdenes del rango
  // de fechas; una orden nueva o editada en ese rango aparece sola.
  function cargar() {
    errorDiv.textContent = "";
    if (!inDesde.value || !inHasta.value) {
      errorDiv.textContent = "Selecciona ambas fechas.";
      return;
    }
    if (inDesde.value > inHasta.value) {
      errorDiv.textContent = "La fecha Desde no puede ser mayor que Hasta.";
      return;
    }
    if (cancelarOT) cancelarOT();
    const listo = otVivo && otVivo.ordenes && otVivo.desde === inDesde.value && otVivo.hasta === inHasta.value;
    if (!listo) lista.innerHTML = `<p class="nota">Cargando…</p>`;
    const limite = contenedor.querySelector("#ot-limite");
    limite.classList.toggle("oculto", inDesde.value >= ESPEJO_OT_DESDE);
    limite.textContent = `Las órdenes anteriores al ${ESPEJO_OT_DESDE.split("-").reverse().join("/")} solo aparecen si se editaron después de esa fecha.`;
    cancelarOT = escucharOT(inDesde.value, inHasta.value, (docs) => {
      ordenes = docs;
      render();
    }, (err) => {
      lista.innerHTML = "";
      errorDiv.textContent = mensajeError(err, "No se pudieron cargar las órdenes de trabajo.");
    });
  }
  alSalirDePantalla(contenedor, () => { if (cancelarOT) cancelarOT(); });

  function render() {
    const fuente = soloAbiertas ? abiertas : ordenes;
    if (fuente.length === 0) {
      lista.innerHTML = `<p class="nota" style="text-align:center;padding:16px;">${soloAbiertas ? "No hay unidades en taller." : "Sin órdenes en este período."}</p>`;
      return;
    }
    lista.innerHTML = fuente.map(o => {
      let fechaFmt = "—";
      if (o.fecha) {
        const p = o.fecha.split("-");
        fechaFmt = p[2] + "/" + p[1] + "/" + p[0] + (o.hora ? " " + o.hora : "");
      }
      const fallas = o.fallas.slice(0, 5).map(f => `
        <div class="ot-falla"><span>• ${esc(f.name)}</span>
          <span class="ot-sev ${esc(f.sev)}">${esc(SEV_LABEL[f.sev] || f.sev)}</span></div>`).join("");
      const mas = o.fallas.length > 5 ? `<div class="op-sub" style="margin-top:4px;">+${o.fallas.length - 5} más...</div>` : "";
      const estadoHtml = o.estado === "abierta"
        ? `<span class="ot-estado abierta">Abierta · operador en taller</span>`
        : o.estado === "terminada" ? `<span class="ot-estado terminada">Terminada</span>` : "";
      const cierre = o.estado === "terminada"
        ? `<div class="ot-cierre">✔ Terminada ${esc(fechaHoraCorta(o.terminadaMs))}${o.terminadaPorNombre ? " por " + esc(o.terminadaPorNombre) : ""}${o.comentarioCierre ? " · " + esc(o.comentarioCierre) : ""}</div>` : "";
      const btnTerminar = puedeTerminar && o.estado === "abierta"
        ? `<button type="button" class="ot-terminar" data-id="${esc(o.id)}">✔ Terminar OT</button>` : "";
      return `
        <div class="ot-card${o.estado === "abierta" ? " abierta" : ""}">
          <div class="ot-cab"><div class="ot-folio">${esc(o.folio)}</div>${estadoHtml}</div>
          <div class="op-sub" style="margin:4px 0 8px;">${esc(o.operador || "—")} — Unidad: ${esc(o.unidad || "—")} — ${esc(fechaFmt)}</div>
          <div>${fallas}${mas}</div>
          ${o.creadaDesde === "ADREMATASA" ? `<div class="ot-origen">Creada desde ADREMATASA${o.creadoPorNombre ? " por " + esc(o.creadoPorNombre) : ""}</div>` : ""}
          ${o.creadaDesde === "app_operador" ? `<div class="ot-origen">Reportada por el operador desde su app</div>` : ""}
          ${cierre}
          <div class="ot-acciones">
            <button type="button" class="secundario ot-editar" data-id="${esc(o.id)}">Editar</button>
            <button type="button" class="ot-imprimir" data-id="${esc(o.id)}">Imprimir</button>
            ${btnTerminar}
          </div>
        </div>`;
    }).join("");
    lista.querySelectorAll(".ot-imprimir").forEach(btn => {
      btn.addEventListener("click", () => {
        const ot = fuente.find(x => x.id === btn.dataset.id);
        if (ot) imprimirOrdenTaller(ot, nombreUsuario);
      });
    });
    lista.querySelectorAll(".ot-editar").forEach(btn => {
      btn.addEventListener("click", () => {
        const ot = fuente.find(x => x.id === btn.dataset.id);
        if (ot) abrirModalOT(ot, alGuardar);
      });
    });
    lista.querySelectorAll(".ot-terminar").forEach(btn => {
      btn.addEventListener("click", () => {
        const ot = fuente.find(x => x.id === btn.dataset.id);
        if (ot) abrirModalTerminarOT(ot, (folio) => {
          exitoP.textContent = `Orden ${folio} terminada. El operador ya puede ponerse Disponible.`;
          exitoP.classList.remove("oculto");
        });
      });
    });
  }

  const exitoP = contenedor.querySelector("#ot-exito");
  function alGuardar(folio, eraNueva) {
    exitoP.textContent = eraNueva ? `Orden ${folio} creada.` : `Orden ${folio} actualizada.`;
    exitoP.classList.remove("oculto");
    // Que la orden recién creada (de hoy) aparezca aunque el filtro esté en otras fechas.
    if (eraNueva && inHasta.value < fechaLocal(new Date())) { inHasta.value = fechaLocal(new Date()); cargar(); }
  }

  contenedor.querySelector("#ot-nueva").addEventListener("click", () => abrirModalOT(null, alGuardar));
  contenedor.querySelector("#ot-buscar").addEventListener("click", cargar);
  cargar();
}

// ---- Terminar OT (2026-10-19) — control de taller ----------------------------
function fechaHoraCorta(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function sinAcentos(t) {
  return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
let promesaPuedeTerminar = null;
function leerPuedeTerminarOT() {
  if (!promesaPuedeTerminar) {
    const uid = auth.currentUser && auth.currentUser.uid;
    promesaPuedeTerminar = !uid ? Promise.resolve(false) : getDoc(doc(db, "usuarios", uid)).then(s => {
      const u = s.exists() ? s.data() : {};
      return u.rol === "admin" || sinAcentos(u.puesto).includes("coordinador") || sinAcentos(u.area).includes("coordinador");
    }).catch(() => { promesaPuedeTerminar = null; return false; });
  }
  return promesaPuedeTerminar;
}

function abrirModalTerminarOT(ot, alTerminar) {
  const ahora = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const hoyTxt = `${ahora.getFullYear()}-${p(ahora.getMonth() + 1)}-${p(ahora.getDate())}`;
  const horaTxt = `${p(ahora.getHours())}:${p(ahora.getMinutes())}`;
  const fondo = document.createElement("div");
  fondo.className = "op-modal-fondo";
  fondo.innerHTML = `
    <div class="op-modal" role="dialog" aria-modal="true">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
        <div style="font-size:17px;font-weight:700;">Terminar OT ${esc(ot.folio)}</div>
        <button type="button" class="secundario op-cerrar" aria-label="Cerrar">✕</button>
      </div>
      <div class="op-sub" style="margin-top:4px;">${esc(ot.operador || "—")} — Unidad ${esc(ot.unidad || "—")}</div>
      <label>Fecha y hora en que se terminó</label>
      <div class="ot-t-fila">
        <input type="date" class="ot-t-fecha" value="${hoyTxt}" max="${hoyTxt}">
        <input type="time" class="ot-t-hora" value="${horaTxt}">
      </div>
      <label>Comentario (opcional)</label>
      <input type="text" class="ot-t-coment" maxlength="300" placeholder="Ej: se cambió sensor, unidad lista">
      <p class="nota" style="margin:10px 0 0;">${esc(ot.operador || "El operador")} saldrá de <b>En taller</b> y su app le pedirá ponerse Disponible.</p>
      <div class="error ot-t-error" style="margin-top:10px;"></div>
      <div class="op-botones"><button type="button" class="secundario op-cerrar2">Cancelar</button><button type="button" class="ot-t-ok">Terminar OT</button></div>
    </div>`;
  document.body.appendChild(fondo);
  const cerrar = () => fondo.remove();
  fondo.querySelector(".op-cerrar").addEventListener("click", cerrar);
  fondo.querySelector(".op-cerrar2").addEventListener("click", cerrar);
  fondo.addEventListener("click", (e) => { if (e.target === fondo) cerrar(); });
  const errorEl = fondo.querySelector(".ot-t-error");
  const btn = fondo.querySelector(".ot-t-ok");
  btn.addEventListener("click", async () => {
    errorEl.textContent = "";
    const f = fondo.querySelector(".ot-t-fecha").value;
    const h = fondo.querySelector(".ot-t-hora").value;
    if (!f || !h) { errorEl.textContent = "Indica la fecha y la hora."; return; }
    const ms = new Date(`${f}T${h}:00`).getTime();
    if (!isFinite(ms)) { errorEl.textContent = "Fecha u hora no válida."; return; }
    if (ms > Date.now() + 60 * 1000) { errorEl.textContent = "La fecha de término no puede ser futura."; return; }
    if (ot.timestampMs && ms < ot.timestampMs - 60 * 1000) { errorEl.textContent = "No puede ser anterior a la creación de la orden (" + fechaHoraCorta(ot.timestampMs) + ")."; return; }
    btn.disabled = true;
    try {
      const res = await fnTerminarOT({ id: ot.id, fechaMs: ms, comentario: fondo.querySelector(".ot-t-coment").value });
      cerrar();
      alTerminar(res.data.folio || ot.folio);
    } catch (err) {
      errorEl.textContent = mensajeError(err, "No se pudo terminar la orden.");
      btn.disabled = false;
    }
  });
}

// ---- Lista de operadores para el selector de la OT (2026-10-14) ----
// Del espejo en vivo (2026-10-16): misma escucha que "Operadores registrados".
function cargarOperadoresActivos() {
  return leerEspejo("operadores").then(docs => docs
    .map(o => ({ ...o, uid: o._id }))
    .filter(o => o.activo)
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), "es")));
}

// ---- Crear / editar OT (2026-10-14) — paridad con editarOT() de admin2.js ----
// El catálogo de fallas NO se copia: se carga directo de Alanis Operadores
// (js/data.js, el mismo archivo que usan admin.html y operador.html), así hay
// una sola copia. data.js declara `const FALLAS = [...]` como script normal;
// esa constante queda visible para este módulo una vez cargado.
const URL_CATALOGO_FALLAS = "https://alanis-operadores.web.app/js/data.js";
let promesaCatalogo = null;

function cargarCatalogoFallas() {
  if (!promesaCatalogo) {
    promesaCatalogo = new Promise((resolve, reject) => {
      const leer = () => (typeof FALLAS !== "undefined" && Array.isArray(FALLAS)) ? FALLAS : null; // eslint-disable-line no-undef
      if (leer()) { resolve(leer()); return; }
      const script = document.createElement("script");
      // Se refresca una vez al día (si agregan fallas allá, aquí aparecen a más tardar al día siguiente).
      script.src = URL_CATALOGO_FALLAS + "?d=" + fechaLocal(new Date());
      script.onload = () => {
        const lista = leer();
        if (lista) resolve(lista); else reject(new Error("El catálogo de fallas no tiene el formato esperado."));
      };
      script.onerror = () => reject(new Error("No se pudo cargar el catálogo de fallas de Alanis Operadores."));
      document.head.appendChild(script);
    }).catch(err => { promesaCatalogo = null; throw err; });
  }
  return promesaCatalogo;
}

function normalizar(texto) {
  return (texto || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function abrirModalOT(ot, alGuardar) {
  const editando = !!ot;
  let seleccionadas = editando ? ot.fallas.map(f => ({ ...f })) : [];
  let catalogo = [];

  const fondo = document.createElement("div");
  fondo.className = "op-modal-fondo";
  fondo.innerHTML = `
    <div class="op-modal" role="dialog" aria-modal="true">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
        <div style="font-size:17px;font-weight:700;">${editando ? "Editar orden " + esc(ot.folio) : "Nueva orden de trabajo"}</div>
        <button type="button" class="secundario op-cerrar" aria-label="Cerrar">✕</button>
      </div>
      <label for="ot-m-operador">Operador</label>
      <div class="ot-combo">
        <input type="text" id="ot-m-operador" maxlength="120" autocomplete="off"
          placeholder="Busca por nombre o número de unidad..." value="${editando ? esc(ot.operador) : ""}">
        <div class="ot-combo-lista oculto" id="ot-m-oplista"></div>
      </div>
      <div class="ot-m-opinfo" id="ot-m-opinfo"></div>
      <label for="ot-m-unidad">Unidad</label>
      <input type="text" id="ot-m-unidad" maxlength="20" placeholder="Ej: 1121" value="${editando ? esc(ot.unidad) : ""}">
      <label>Fallas seleccionadas</label>
      <div id="ot-m-sel"></div>
      <label for="ot-m-buscar">Agregar falla del catálogo</label>
      <input type="text" id="ot-m-buscar" placeholder="Buscar falla...">
      <div class="ot-m-cat" id="ot-m-cat"><div class="ot-m-vacio">Cargando catálogo…</div></div>
      <label for="ot-m-libre">Falla no listada (separa varias con coma)</label>
      <input type="text" id="ot-m-libre" placeholder="Ej: Sensor de temperatura">
      <button type="button" class="secundario" id="ot-m-agregar-libre" style="width:100%;margin-top:6px;">+ Agregar falla</button>
      <div class="error ot-m-error" style="margin-top:10px;"></div>
      <div class="op-botones"><button type="button" id="ot-m-guardar">${editando ? "Guardar cambios" : "Crear orden"}</button></div>
    </div>
  `;
  document.body.appendChild(fondo);
  const cerrar = () => fondo.remove();
  fondo.querySelector(".op-cerrar").addEventListener("click", cerrar);
  fondo.addEventListener("click", (e) => { if (e.target === fondo) cerrar(); });

  const selDiv = fondo.querySelector("#ot-m-sel");
  const catDiv = fondo.querySelector("#ot-m-cat");
  const buscar = fondo.querySelector("#ot-m-buscar");
  const errorDiv = fondo.querySelector(".ot-m-error");
  const btnGuardar = fondo.querySelector("#ot-m-guardar");

  // ---- Selector de operador: busca por nombre (oficial o de registro) o por
  // número de unidad; al elegir llena operador + unidad y liga la OT a su
  // cuenta. Si se escribe un nombre sin elegir de la lista, se guarda solo
  // el texto (como en admin2.js).
  const inOperador = fondo.querySelector("#ot-m-operador");
  const inUnidad = fondo.querySelector("#ot-m-unidad");
  const opLista = fondo.querySelector("#ot-m-oplista");
  const opInfo = fondo.querySelector("#ot-m-opinfo");
  let operadores = [];
  let operadorUid = "";
  const nombreDe = (o) => o.nombreOficial || o.nombre || o.correo || "Sin nombre";

  function pintarInfoOperador() {
    const o = operadores.find(x => x.uid === operadorUid);
    if (o) {
      opInfo.textContent = `✓ Operador registrado${o.numero ? " · unidad asignada " + o.numero : ""}`;
      opInfo.className = "ot-m-opinfo ligado";
    } else if (inOperador.value.trim()) {
      opInfo.textContent = "No elegiste de la lista: se guardará solo el nombre escrito.";
      opInfo.className = "ot-m-opinfo";
    } else {
      opInfo.textContent = "";
    }
  }

  function mostrarOpciones() {
    const q = normalizar(inOperador.value.trim());
    const coinciden = operadores.filter(o => !q
      || normalizar(nombreDe(o)).includes(q) || normalizar(o.nombre).includes(q)
      || normalizar(o.numero).includes(q)).slice(0, 10);
    if (operadores.length === 0 || coinciden.length === 0) { opLista.classList.add("oculto"); return; }
    opLista.innerHTML = coinciden.map(o => `
      <button type="button" class="ot-combo-op" data-uid="${esc(o.uid)}">
        <span class="ot-combo-unidad">${esc(o.numero || "—")}</span><span>${esc(nombreDe(o))}</span>
      </button>`).join("");
    opLista.querySelectorAll(".ot-combo-op").forEach(b => {
      // mousedown (no click) para que corra antes de que el input pierda el foco.
      b.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        const o = operadores.find(x => x.uid === b.dataset.uid);
        if (!o) return;
        operadorUid = o.uid;
        inOperador.value = nombreDe(o);
        if (o.numero) inUnidad.value = o.numero;
        opLista.classList.add("oculto");
        pintarInfoOperador();
      });
    });
    opLista.classList.remove("oculto");
  }

  inOperador.addEventListener("input", () => { operadorUid = ""; mostrarOpciones(); pintarInfoOperador(); });
  inOperador.addEventListener("focus", mostrarOpciones);
  inOperador.addEventListener("blur", () => setTimeout(() => opLista.classList.add("oculto"), 150));

  cargarOperadoresActivos()
    .then(lista => {
      operadores = lista;
      if (editando && ot.uid && operadores.some(o => o.uid === ot.uid)) operadorUid = ot.uid;
      pintarInfoOperador();
    })
    .catch(() => {
      opInfo.textContent = "No se pudo cargar la lista de operadores; puedes escribir el nombre a mano.";
      opInfo.className = "ot-m-opinfo";
    });

  const sevHtml = (sev) => `<span class="ot-sev ${esc(sev)}">${esc(SEV_LABEL[sev] || sev)}</span>`;

  function renderSeleccionadas() {
    if (seleccionadas.length === 0) {
      selDiv.innerHTML = `<div class="ot-m-vacio">Sin fallas. Agrega desde el catálogo.</div>`;
      return;
    }
    selDiv.innerHTML = seleccionadas.map((f, i) => `
      <div class="ot-m-fila"><span>${esc(f.name)}</span>${sevHtml(f.sev)}
        <button type="button" class="ot-m-quitar" data-i="${i}" aria-label="Quitar">✕</button></div>`).join("");
    selDiv.querySelectorAll(".ot-m-quitar").forEach(b => b.addEventListener("click", () => {
      seleccionadas.splice(Number(b.dataset.i), 1);
      renderSeleccionadas();
      renderCatalogo();
    }));
  }

  function renderCatalogo() {
    if (catalogo.length === 0) return;
    const q = normalizar(buscar.value);
    const ya = new Set(seleccionadas.map(f => f.id));
    const filtradas = catalogo.filter(f => !ya.has(f.id) && (normalizar(f.name).includes(q) || normalizar(f.cat).includes(q)));
    if (filtradas.length === 0) {
      catDiv.innerHTML = `<div class="ot-m-vacio">Sin coincidencias.</div>`;
      return;
    }
    catDiv.innerHTML = filtradas.map(f => `
      <div class="ot-m-fila" data-id="${esc(String(f.id))}"><span style="color:#2c1e0f;font-size:16px;">+</span>
        <span><span class="ot-m-catnom" style="display:block;">${esc(f.cat)}</span>${esc(f.name)}</span>${sevHtml(f.sev)}</div>`).join("");
    catDiv.querySelectorAll(".ot-m-fila").forEach(fila => fila.addEventListener("click", () => {
      const f = catalogo.find(x => String(x.id) === fila.dataset.id);
      if (f && !seleccionadas.some(x => x.id === f.id)) {
        seleccionadas.push({ id: f.id, cat: f.cat, name: f.name, sev: f.sev });
      }
      renderSeleccionadas();
      renderCatalogo();
    }));
  }

  // Igual que agregarFallaLibre() de admin2.js: "Sin clasificar", severidad
  // media, id negativo para no chocar con el catálogo, sin duplicados.
  fondo.querySelector("#ot-m-agregar-libre").addEventListener("click", () => {
    const input = fondo.querySelector("#ot-m-libre");
    const nombres = input.value.split(",").map(t => t.trim()).filter(Boolean);
    if (nombres.length === 0) { errorDiv.textContent = "Escribe al menos una falla."; return; }
    errorDiv.textContent = "";
    let agregadas = 0;
    nombres.forEach(nombre => {
      const limpio = nombre.charAt(0).toUpperCase() + nombre.slice(1);
      if (seleccionadas.some(f => normalizar(f.name) === normalizar(limpio))) return;
      seleccionadas.push({ id: -(Date.now() + agregadas), cat: "Sin clasificar", name: limpio, sev: "media", custom: true });
      agregadas++;
    });
    input.value = "";
    if (agregadas === 0) errorDiv.textContent = "Esa falla ya estaba en la lista.";
    renderSeleccionadas();
    renderCatalogo();
  });

  buscar.addEventListener("input", renderCatalogo);

  btnGuardar.addEventListener("click", async () => {
    errorDiv.textContent = "";
    const operador = inOperador.value.trim();
    const unidad = inUnidad.value.trim();
    if (!operador) { errorDiv.textContent = "El operador no puede estar vacío."; return; }
    if (seleccionadas.length === 0) { errorDiv.textContent = "Debe haber al menos una falla."; return; }
    btnGuardar.disabled = true;
    try {
      const res = await fnGuardarOT({ id: editando ? ot.id : undefined, operadorUid: operadorUid || undefined, operador, unidad, fallas: seleccionadas });
      cerrar();
      alGuardar(res.data.folio, !editando);
    } catch (err) {
      errorDiv.textContent = mensajeError(err, "No se pudo guardar la orden de trabajo.");
      btnGuardar.disabled = false;
    }
  });

  renderSeleccionadas();
  cargarCatalogoFallas()
    .then(lista => { catalogo = lista; renderCatalogo(); })
    .catch(err => {
      catDiv.innerHTML = `<div class="ot-m-vacio" style="color:#A32D2D;">${esc(err.message)} Puedes capturar la falla en "Falla no listada".</div>`;
    });
}

// Misma "Orden de Taller" que generarOrdenTaller() de admin2.js. La firma de
// COORDINADOR lleva el nombre del usuario de ADREMATASA que imprime.
function imprimirOrdenTaller(ot, nombreUsuario) {
  const SEV_COLOR = { alta: "#E24B4A", media: "#BA7517", baja: "#639922" };
  const SEV_MAYUS = { alta: "ALTA", media: "MEDIA", baja: "BAJA" };
  const ahora = new Date();
  const fechaImpresion = ahora.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) +
    " " + String(ahora.getHours()).padStart(2, "0") + ":" + String(ahora.getMinutes()).padStart(2, "0");

  const fallas = ot.fallas || [];
  let filas = "";
  const total = Math.max(fallas.length, 12);
  for (let i = 0; i < total; i++) {
    const f = fallas[i];
    filas += f
      ? `<tr><td class="num">${i + 1}</td><td class="falla">${esc(f.name)}</td>
           <td class="sev"><span class="sev-badge" style="background:${SEV_COLOR[f.sev] || "#888"}">${esc(SEV_MAYUS[f.sev] || "")}</span></td>
           <td class="realizo"></td></tr>`
      : `<tr><td class="num">${i + 1}</td><td></td><td></td><td class="realizo"></td></tr>`;
  }

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Orden de Taller ${esc(ot.folio)}</title>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family:Arial, sans-serif; color:#1a1a1a; padding:32px 40px; }
      .no-print { text-align:center; margin-bottom:20px; }
      .btn-print { background:#2C1E0F; color:#fff; border:none; padding:12px 24px; border-radius:8px; font-size:14px; font-weight:600; cursor:pointer; }
      .header { display:flex; align-items:center; justify-content:space-between; border-bottom:3px solid #2C1E0F; padding-bottom:16px; margin-bottom:20px; }
      .header img { height:64px; }
      .header .titulo { text-align:right; }
      .header .titulo h1 { font-size:22px; color:#2C1E0F; letter-spacing:1px; }
      .datos { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px 24px; margin-bottom:20px; font-size:14px; }
      .datos .campo { padding:6px 0; border-bottom:1px solid #ddd; }
      .datos .campo strong { color:#2C1E0F; display:inline-block; min-width:90px; }
      table { width:100%; border-collapse:collapse; margin-bottom:32px; }
      th { background:#2C1E0F; color:#fff; font-size:12px; padding:8px; text-align:left; text-transform:uppercase; letter-spacing:0.5px; }
      td { border:1px solid #ccc; padding:8px 10px; font-size:13px; height:34px; }
      td.num { width:36px; text-align:center; font-weight:700; background:#f5f5f5; }
      td.sev { width:90px; text-align:center; }
      td.realizo, th.realizo-th { width:180px; }
      .sev-badge { color:#fff; font-size:10px; font-weight:700; padding:3px 8px; border-radius:4px; }
      .firmas { display:flex; justify-content:space-around; gap:60px; margin-top:48px; }
      .firma { text-align:center; flex:1; }
      .firma .linea { border-top:1.5px solid #1a1a1a; margin-bottom:6px; }
      .firma .rol { font-size:13px; font-weight:700; }
      .firma .nombre { font-size:13px; margin-bottom:4px; min-height:18px; }
      .pie { margin-top:32px; font-size:10px; color:#888; text-align:center; }
      @media print { .no-print { display:none; } body { padding:0; } }
    </style></head><body>
    <div class="no-print"><button class="btn-print" onclick="window.print()">Imprimir / Guardar PDF</button></div>
    <div class="header"><img src="${LOGO_ORDEN_TALLER}" alt="Alanis"/><div class="titulo"><h1>ORDEN DE TALLER</h1></div></div>
    <div class="datos">
      <div class="campo"><strong>Folio:</strong> ${esc(ot.folio)}</div>
      <div class="campo"><strong>Unidad:</strong> ${esc(ot.unidad || "-")}</div>
      <div class="campo"><strong>Operador:</strong> ${esc(ot.operador || "-")}</div>
      <div class="campo"><strong>Fecha reporte:</strong> ${esc(ot.fecha || "-")} ${esc(ot.hora || "")}</div>
      <div class="campo"><strong>Impresion:</strong> ${esc(fechaImpresion)}</div>
      <div class="campo"><strong>Estado:</strong> ${esc(ot.estado || "-")}</div>
    </div>
    <table><thead><tr><th>#</th><th>Falla reportada</th><th>Gravedad</th><th class="realizo-th">Realizo (mecanico)</th></tr></thead>
    <tbody>${filas}</tbody></table>
    <div class="firmas">
      <div class="firma"><div class="nombre">${esc(ot.operador || "")}</div><div class="linea"></div><div class="rol">FIRMA OPERADOR</div></div>
      <div class="firma"><div class="nombre">${esc(nombreUsuario || "")}</div><div class="linea"></div><div class="rol">COORDINADOR</div></div>
    </div>
    <div class="pie">Autotransportes Alanis - Documento generado el ${esc(fechaImpresion)}</div>
    </body></html>`;

  const win = window.open("", "_blank");
  if (!win) {
    alert("El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para este sitio.");
    return;
  }
  win.document.write(html);
  win.document.close();
}

// ============================================================================
// Operadores registrados (2026-10-13) — paridad con "Operadores registrados"
// de admin2.js: editar nombre oficial / unidad / teléfono, activar o
// desactivar, e historial de unidades. Sin "Promover a admin". Todas las
// validaciones de verdad (unidad duplicada, 10 dígitos, que sea operador)
// las hace la Cloud Function; aquí solo se adelantan para avisar rápido.
// ============================================================================
export function iniciarOperadoresRegistrados(contenedor) {
  // Rediseño 2026-10-15 (pedido de Ivan): lista compacta (unidad, nombre,
  // teléfono, tipo de ruta, activo) con buscador y filtros por ruta; al tocar
  // un operador se abre su detalle para editar. Modo "Asignar rutas" para
  // poner el mismo tipo de ruta a varios a la vez.
  inyectarEstilos();
  contenedor.innerHTML = `
    <section class="panel">
      <div class="or-encabezado" style="justify-content:space-between;">
        <h2 style="margin:0;">Operadores registrados</h2>
        <button type="button" class="secundario" id="or-modo-ruta">Asignar rutas</button>
      </div>
      <div id="or-error" class="error"></div>
      <p id="or-exito" class="nota oculto" style="color:#1c7a41;"></p>
      <div id="or-vista"></div>
    </section>
  `;
  const vista = contenedor.querySelector("#or-vista");
  const errorDiv = contenedor.querySelector("#or-error");
  const exitoP = contenedor.querySelector("#or-exito");
  const btnModo = contenedor.querySelector("#or-modo-ruta");
  let operadores = [];
  let filtroRuta = "todos";
  let busqueda = "";
  let modoRuta = false;
  let enDetalle = false;
  const seleccion = new Set();

  function avisar(texto) {
    exitoP.textContent = texto;
    exitoP.classList.remove("oculto");
    setTimeout(() => exitoP.classList.add("oculto"), 4000);
  }

  // En vivo desde el espejo (2026-10-16). Si llega un cambio mientras se ve
  // el detalle de un operador, la lista se actualiza por dentro y se dibuja
  // al regresar (no se interrumpe lo que se está editando).
  function ordenar(lista) {
    return lista.slice().sort((a, b) =>
      (b.activo - a.activo) || String(a.numero).localeCompare(String(b.numero), "es", { numeric: true }));
  }
  const cancelar = suscribirEspejo("operadores", (docs) => {
    errorDiv.textContent = "";
    operadores = ordenar(docs.map(o => ({
      uid: o._id, nombre: o.nombre || "", correo: o.correo || "", nombreOficial: o.nombreOficial || "",
      numero: o.numero || "", tipoRuta: TIPOS_RUTA.includes(o.tipoRuta) ? o.tipoRuta : null,
      lada: o.lada || "52", telefono: o.telefono || "", activo: o.activo === true,
    })));
    if (!enDetalle) {
      const enfocado = document.activeElement && document.activeElement.id === "or-buscar";
      const pos = enfocado ? document.activeElement.selectionStart : 0;
      renderLista();
      if (enfocado) { const n = vista.querySelector("#or-buscar"); n.focus(); n.setSelectionRange(pos, pos); }
    }
  }, (err) => {
    vista.innerHTML = "";
    errorDiv.textContent = mensajeError(err, "No se pudieron cargar los operadores.");
  });
  alSalirDePantalla(contenedor, cancelar);
  // Mientras el espejo confirma (1–2 s), se refleja el cambio de inmediato.
  function aplicarLocal(uid, cambios) {
    operadores = ordenar(operadores.map(x => (x.uid === uid ? { ...x, ...cambios } : x)));
  }

  const nombreDe = (o) => o.nombreOficial || o.nombre || o.correo || "Sin nombre";
  const telefonoDe = (o) => o.telefono ? `+${o.lada || "52"} ${o.telefono}` : "Sin teléfono";
  const rutaDe = (o) => o.tipoRuta || "sindefinir";

  function filtrados() {
    const q = busqueda.trim().toLowerCase();
    return operadores.filter(o => (filtroRuta === "todos" || rutaDe(o) === filtroRuta) && (!q
      || o.nombre.toLowerCase().includes(q) || o.correo.toLowerCase().includes(q)
      || o.nombreOficial.toLowerCase().includes(q) || String(o.numero).toLowerCase().includes(q)));
  }

  // ---- Lista ----
  function renderLista() {
    enDetalle = false;
    btnModo.textContent = modoRuta ? "Terminar" : "Asignar rutas";
    btnModo.classList.remove("oculto");
    const cuenta = (r) => operadores.filter(o => r === "todos" || rutaDe(o) === r).length;
    const chips = ["todos", ...TIPOS_RUTA, "sindefinir"].map(r =>
      `<button type="button" class="or-chip${filtroRuta === r ? " activo" : ""}" data-ruta="${r}">${r === "todos" ? "Todos" : ETIQUETA_RUTA[r]} ${cuenta(r)}</button>`).join("");
    const lista = filtrados();
    vista.innerHTML = `
      <input type="text" id="or-buscar" class="op-buscar" placeholder="Buscar por nombre, correo o unidad..." value="${esc(busqueda)}">
      <div class="or-chips">${chips}</div>
      ${modoRuta ? `<p class="nota" style="margin:0 0 6px;">Marca a los operadores y elige la ruta abajo.</p>` : ""}
      <div class="or-lista">${lista.length === 0
        ? `<p class="nota" style="text-align:center;padding:16px;">Sin operadores${busqueda || filtroRuta !== "todos" ? " con este filtro" : " registrados"}.</p>`
        : lista.map(o => `
          <${modoRuta ? "label" : "button type=\"button\""} class="or-renglon${o.activo ? "" : " inactivo"}" data-uid="${esc(o.uid)}">
            ${modoRuta ? `<input type="checkbox" class="or-sel" data-uid="${esc(o.uid)}"${seleccion.has(o.uid) ? " checked" : ""}>` : ""}
            <span class="or-unidad-num">${esc(o.numero || "—")}</span>
            <span class="or-nom"><span>${esc(nombreDe(o))}</span><small>${o.activo ? esc(telefonoDe(o)) : "Inactivo"}</small></span>
            ${pillRuta(o.tipoRuta)}
            <span class="or-punto${o.activo ? "" : " off"}" title="${o.activo ? "Activo" : "Inactivo"}"></span>
          </${modoRuta ? "label" : "button"}>`).join("")}
      </div>
      ${modoRuta ? `
        <div class="or-barra">
          <span id="or-sel-texto">${seleccion.size} seleccionado${seleccion.size === 1 ? "" : "s"} · asignar ruta:</span>
          ${TIPOS_RUTA.map(r => `<button type="button" class="or-barra-btn" data-ruta="${r}"${seleccion.size ? "" : " disabled"}>${ETIQUETA_RUTA[r]}</button>`).join("")}
        </div>` : ""}
    `;
    const inBuscar = vista.querySelector("#or-buscar");
    inBuscar.addEventListener("input", () => {
      busqueda = inBuscar.value;
      const pos = inBuscar.selectionStart;
      renderLista();
      const nuevo = vista.querySelector("#or-buscar");
      nuevo.focus();
      nuevo.setSelectionRange(pos, pos);
    });
    vista.querySelectorAll(".or-chip").forEach(b => b.addEventListener("click", () => { filtroRuta = b.dataset.ruta; renderLista(); }));
    if (modoRuta) {
      vista.querySelectorAll(".or-sel").forEach(chk => chk.addEventListener("change", () => {
        if (chk.checked) seleccion.add(chk.dataset.uid); else seleccion.delete(chk.dataset.uid);
        vista.querySelector("#or-sel-texto").textContent = `${seleccion.size} seleccionado${seleccion.size === 1 ? "" : "s"} · asignar ruta:`;
        vista.querySelectorAll(".or-barra-btn").forEach(b => { b.disabled = seleccion.size === 0; });
      }));
      vista.querySelectorAll(".or-barra-btn").forEach(b => b.addEventListener("click", async () => {
        if (seleccion.size === 0) return;
        vista.querySelectorAll(".or-barra-btn").forEach(x => { x.disabled = true; });
        errorDiv.textContent = "";
        try {
          const res = await fnAsignarRuta({ uids: [...seleccion], tipoRuta: b.dataset.ruta });
          avisar(`Ruta ${ETIQUETA_RUTA[b.dataset.ruta]} asignada a ${res.data.total} operador${res.data.total === 1 ? "" : "es"}.`);
          seleccion.forEach(uid => aplicarLocal(uid, { tipoRuta: b.dataset.ruta }));
          seleccion.clear();
          renderLista();
        } catch (err) {
          errorDiv.textContent = mensajeError(err, "No se pudo asignar la ruta.");
          vista.querySelectorAll(".or-barra-btn").forEach(x => { x.disabled = false; });
        }
      }));
    } else {
      vista.querySelectorAll("button.or-renglon").forEach(b => b.addEventListener("click", () => {
        const o = operadores.find(x => x.uid === b.dataset.uid);
        if (o) renderDetalle(o);
      }));
    }
  }

  btnModo.addEventListener("click", () => {
    modoRuta = !modoRuta;
    seleccion.clear();
    // Al entrar, arranca en "Sin definir" (lo que falta asignar), si hay.
    if (modoRuta && operadores.some(o => !o.tipoRuta)) filtroRuta = "sindefinir";
    renderLista();
  });

  // ---- Detalle ----
  function renderDetalle(o) {
    enDetalle = true;
    btnModo.classList.add("oculto");
    let rutaElegida = o.tipoRuta || "";
    vista.innerHTML = `
      <button type="button" class="or-volver">← Operadores registrados</button>
      <div class="or-card ${o.activo ? "" : "inactivo"}">
        <div class="or-fila">
          <span class="op-avatar">${esc(iniciales(nombreDe(o)))}</span>
          <span style="flex:1;min-width:0;">
            <span class="op-nombre" style="display:block;">${esc(nombreDe(o))}</span>
            <span class="op-sub">${esc(o.correo || "—")}${o.nombreOficial && o.nombre && o.nombre !== o.nombreOficial ? " · se registró como " + esc(o.nombre) : ""}</span>
          </span>
          <span class="or-badge ${o.activo ? "activo" : "inactivo"}">${o.activo ? "Activo" : "Inactivo"}</span>
        </div>
        <label>Nombre oficial (el que se ve en ADREMATASA)</label>
        <input type="text" class="or-oficial" value="${esc(o.nombreOficial)}" placeholder="${esc(o.nombre || "Nombre completo oficial")}">
        <div class="or-datos">
          <div class="u"><label>Unidad</label><input type="text" class="or-unidad" value="${esc(o.numero)}" maxlength="10" placeholder="1121"></div>
          <div class="l"><label>Lada</label><select class="or-lada">
            <option value="52"${o.lada === "1" ? "" : " selected"}>MX +52</option>
            <option value="1"${o.lada === "1" ? " selected" : ""}>US +1</option></select></div>
          <div class="t"><label>Celular</label><input type="tel" class="or-tel" value="${esc(o.telefono)}" maxlength="14" placeholder="10 dígitos"></div>
        </div>
        <label>Tipo de ruta</label>
        ${selectorRuta(rutaElegida)}
        <div class="error or-card-error" style="margin-top:8px;"></div>
        <div class="or-acciones">
          <button type="button" class="or-guardar">Guardar datos</button>
        </div>
        <div class="or-acciones">
          <button type="button" class="secundario or-historial">Historial de unidad</button>
          <button type="button" class="secundario or-estado">${o.activo ? "Desactivar" : "Activar"}</button>
        </div>
        <div class="or-hist oculto"></div>
      </div>
    `;
    const card = vista.querySelector(".or-card");
    const errCard = card.querySelector(".or-card-error");
    const botones = card.querySelectorAll("button");
    const bloquear = (b) => botones.forEach(x => { x.disabled = b; });
    const volver = () => renderLista();
    vista.querySelector(".or-volver").addEventListener("click", volver);
    conectarSelectorRuta(card, (r) => { rutaElegida = r; });

    card.querySelector(".or-guardar").addEventListener("click", async () => {
      errCard.textContent = "";
      const numero = card.querySelector(".or-unidad").value.trim();
      const telefono = card.querySelector(".or-tel").value.replace(/\D/g, "");
      if (!numero) { errCard.textContent = "Ingresa un número de unidad."; return; }
      if (telefono !== "" && telefono.length !== 10) { errCard.textContent = "El teléfono debe tener 10 dígitos."; return; }
      if (!rutaElegida) { errCard.textContent = "Elige el tipo de ruta."; return; }
      bloquear(true);
      try {
        const datos = {
          uid: o.uid, numero, telefono, tipoRuta: rutaElegida,
          nombreOficial: card.querySelector(".or-oficial").value.trim(),
          lada: card.querySelector(".or-lada").value
        };
        await fnGuardarDatos(datos);
        avisar(`Datos de ${nombreDe(o)} guardados.`);
        aplicarLocal(o.uid, datos);
        volver();
      } catch (err) {
        errCard.textContent = mensajeError(err, "No se pudieron guardar los datos.");
        bloquear(false);
      }
    });

    card.querySelector(".or-estado").addEventListener("click", async () => {
      errCard.textContent = "";
      const activar = !o.activo;
      const pregunta = activar
        ? `¿Activar a ${nombreDe(o)}? Volverá a poder entrar a Alanis Operadores y aparecerá en el selector de Validación de QR.`
        : `¿Desactivar a ${nombreDe(o)}? Ya no podrá entrar a Alanis Operadores y saldrá del selector de Validación de QR.`;
      if (!confirm(pregunta)) return;
      bloquear(true);
      try {
        await fnCambiarEstado({ uid: o.uid, activo: activar });
        avisar(`${nombreDe(o)} ${activar ? "activado" : "desactivado"}.`);
        aplicarLocal(o.uid, { activo: activar });
        volver();
      } catch (err) {
        errCard.textContent = mensajeError(err, "No se pudo cambiar el estado.");
        bloquear(false);
      }
    });

    card.querySelector(".or-historial").addEventListener("click", async () => {
      const cont = card.querySelector(".or-hist");
      if (!cont.classList.contains("oculto")) { cont.classList.add("oculto"); return; }
      cont.classList.remove("oculto");
      cont.textContent = "Cargando…";
      try {
        const res = await fnHistorialUnidad({ uid: o.uid });
        const cambios = res.data.cambios || [];
        cont.innerHTML = cambios.length === 0
          ? "Sin cambios de unidad registrados."
          : cambios.map(c => {
              const p = (c.fecha || "").split("-");
              const f = p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : c.fecha;
              return `<div>${esc(f)} ${esc(c.hora)} · ${esc(c.anterior)} → ${esc(c.nueva)}</div>`;
            }).join("");
      } catch (err) {
        cont.textContent = mensajeError(err, "No se pudo cargar el historial.");
      }
    });
  }

  vista.innerHTML = `<p class="nota">Cargando…</p>`;
}