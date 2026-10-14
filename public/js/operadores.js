// Utilidades → Operadores (2026-10-13, pedido de Ivan).
//
// Pantallas de ADREMATASA Interno que operan sobre Alanis Operadores. El
// navegador nunca toca la base de Alanis Operadores: todo pasa por las Cloud
// Functions de functions/operadoresAlanis.js (listarSolicitudesOperadores,
// resolverSolicitudOperador, listarOrdenesTrabajo).
//
// Paridad con el panel admin de Alanis Operadores (js/admin2.js):
//   - Aceptación de ingreso: lista + buscador + modal con número económico,
//     nombre oficial y teléfono; Rechazar / Aprobar acceso (como operador).
//   - Órdenes de trabajo: filtro por fechas (ayer–hoy por default) e
//     Imprimir (misma "Orden de Taller"). Crear/Editar: pendiente (necesitan
//     el catálogo de fallas de data.js).

import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";
import { marcarAlerta } from "./navegacion.js";

const funciones = getFunctions(undefined, "us-central1");
const fnListarSolicitudes = httpsCallable(funciones, "listarSolicitudesOperadores");
const fnResolverSolicitud = httpsCallable(funciones, "resolverSolicitudOperador");
const fnListarOTs = httpsCallable(funciones, "listarOrdenesTrabajo");
const fnListarRegistrados = httpsCallable(funciones, "listarOperadoresRegistrados");
const fnGuardarDatos = httpsCallable(funciones, "guardarDatosOperador");
const fnCambiarEstado = httpsCallable(funciones, "cambiarEstadoOperador");
const fnHistorialUnidad = httpsCallable(funciones, "historialUnidadOperador");
const fnGuardarOT = httpsCallable(funciones, "guardarOrdenTrabajo");

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
    .ot-m-fila { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid #f0ece6; font-size: 13px; }
    .ot-m-fila .ot-sev { margin-left: auto; }
    .ot-m-quitar { background: none; border: none; color: #E24B4A; font-size: 16px; cursor: pointer; padding: 0 4px; }
    .ot-m-cat { max-height: 200px; overflow-y: auto; margin-top: 6px; border: 1px solid #efebe5; border-radius: 8px; padding: 0 8px; }
    .ot-m-cat .ot-m-fila { cursor: pointer; }
    .ot-m-cat .ot-m-fila:hover { background: #f5f3f0; }
    .ot-m-catnom { font-size: 10px; color: #8a7f73; }
    .ot-m-vacio { font-size: 12px; color: #8a7f73; padding: 6px 0; }
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

  async function cargar() {
    errorDiv.textContent = "";
    try {
      const res = await fnListarSolicitudes();
      solicitudes = res.data.solicitudes || [];
      marcarAlerta("operadoresSolicitudes", solicitudes.length > 0);
      render();
    } catch (err) {
      lista.innerHTML = "";
      errorDiv.textContent = mensajeError(err, "No se pudieron cargar las solicitudes.");
    }
  }

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
    const btnAprobar = fondo.querySelector(".op-aprobar");
    const btnRechazar = fondo.querySelector(".op-rechazar");

    async function resolver(accion) {
      errorModal.textContent = "";
      const telefono = fondo.querySelector("#op-m-telefono").value.replace(/\D/g, "");
      if (accion === "aprobar" && telefono !== "" && telefono.length !== 10) {
        errorModal.textContent = "El teléfono debe tener 10 dígitos.";
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
          telefono
        });
        cerrar();
        exitoP.textContent = accion === "aprobar"
          ? `${res.data.nombre || "Operador"} aprobado como operador.`
          : "Solicitud rechazada.";
        exitoP.classList.remove("oculto");
        cargar();
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
  cargar();
}

// ============================================================================
// Punto de alerta de "Aceptación de ingreso" (2026-10-14, pedido de Ivan).
// Las solicitudes viven en Alanis Operadores, así que no se pueden vigilar en
// vivo desde el navegador: se consulta la misma Cloud Function de la pantalla
// al entrar a la app y luego cada 10 minutos (y se vuelve a revisar sola
// cada vez que se abre Aceptación de ingreso o se resuelve una solicitud,
// ver cargar() arriba). Si la llamada falla, el punto simplemente no cambia.
// ============================================================================
const MINUTOS_REVISION_OPERADORES = 10;
let relojAlertasOperadores = null;

async function revisarAlertaOperadores() {
  try {
    const res = await fnListarSolicitudes();
    marcarAlerta("operadoresSolicitudes", (res.data.solicitudes || []).length > 0);
  } catch (err) {
    console.warn("Alertas Operadores:", err.message);
  }
}

export function detenerAlertasOperadores() {
  if (relojAlertasOperadores) clearInterval(relojAlertasOperadores);
  relojAlertasOperadores = null;
  marcarAlerta("operadoresSolicitudes", false);
}

export function iniciarAlertasOperadores() {
  detenerAlertasOperadores();
  revisarAlertaOperadores();
  relojAlertasOperadores = setInterval(revisarAlertaOperadores, MINUTOS_REVISION_OPERADORES * 60 * 1000);
}

// ============================================================================
// Órdenes de trabajo (consulta + imprimir)
// ============================================================================
function fechaLocal(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

const SEV_LABEL = { alta: "Alta", media: "Media", baja: "Baja" };

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
      <div id="ot-error" class="error"></div>
      <div id="ot-lista"><p class="nota">Cargando…</p></div>
    </section>
  `;
  const lista = contenedor.querySelector("#ot-lista");
  const errorDiv = contenedor.querySelector("#ot-error");
  const inDesde = contenedor.querySelector("#ot-desde");
  const inHasta = contenedor.querySelector("#ot-hasta");
  let ordenes = [];

  async function cargar() {
    errorDiv.textContent = "";
    if (!inDesde.value || !inHasta.value) {
      errorDiv.textContent = "Selecciona ambas fechas.";
      return;
    }
    lista.innerHTML = `<p class="nota">Cargando…</p>`;
    try {
      const res = await fnListarOTs({ desde: inDesde.value, hasta: inHasta.value });
      ordenes = res.data.ordenes || [];
      render();
    } catch (err) {
      lista.innerHTML = "";
      errorDiv.textContent = mensajeError(err, "No se pudieron cargar las órdenes de trabajo.");
    }
  }

  function render() {
    if (ordenes.length === 0) {
      lista.innerHTML = `<p class="nota" style="text-align:center;padding:16px;">Sin órdenes en este período.</p>`;
      return;
    }
    lista.innerHTML = ordenes.map(o => {
      let fechaFmt = "—";
      if (o.fecha) {
        const p = o.fecha.split("-");
        fechaFmt = p[2] + "/" + p[1] + "/" + p[0] + (o.hora ? " " + o.hora : "");
      }
      const fallas = o.fallas.slice(0, 5).map(f => `
        <div class="ot-falla"><span>• ${esc(f.name)}</span>
          <span class="ot-sev ${esc(f.sev)}">${esc(SEV_LABEL[f.sev] || f.sev)}</span></div>`).join("");
      const mas = o.fallas.length > 5 ? `<div class="op-sub" style="margin-top:4px;">+${o.fallas.length - 5} más...</div>` : "";
      return `
        <div class="ot-card">
          <div class="ot-folio">${esc(o.folio)}</div>
          <div class="op-sub" style="margin:4px 0 8px;">${esc(o.operador || "—")} — Unidad: ${esc(o.unidad || "—")} — ${esc(fechaFmt)}</div>
          <div>${fallas}${mas}</div>
          ${o.creadaDesde === "ADREMATASA" ? `<div class="ot-origen">Creada desde ADREMATASA${o.creadoPorNombre ? " por " + esc(o.creadoPorNombre) : ""}</div>` : ""}
          <div class="ot-acciones">
            <button type="button" class="secundario ot-editar" data-id="${esc(o.id)}">Editar</button>
            <button type="button" class="ot-imprimir" data-id="${esc(o.id)}">Imprimir</button>
          </div>
        </div>`;
    }).join("");
    lista.querySelectorAll(".ot-imprimir").forEach(btn => {
      btn.addEventListener("click", () => {
        const ot = ordenes.find(x => x.id === btn.dataset.id);
        if (ot) imprimirOrdenTaller(ot, nombreUsuario);
      });
    });
    lista.querySelectorAll(".ot-editar").forEach(btn => {
      btn.addEventListener("click", () => {
        const ot = ordenes.find(x => x.id === btn.dataset.id);
        if (ot) abrirModalOT(ot, alGuardar);
      });
    });
  }

  const exitoP = contenedor.querySelector("#ot-exito");
  function alGuardar(folio, eraNueva) {
    exitoP.textContent = eraNueva ? `Orden ${folio} creada.` : `Orden ${folio} actualizada.`;
    exitoP.classList.remove("oculto");
    // Que la orden recién creada (de hoy) aparezca aunque el filtro esté en otras fechas.
    if (eraNueva && inHasta.value < fechaLocal(new Date())) inHasta.value = fechaLocal(new Date());
    cargar();
  }

  contenedor.querySelector("#ot-nueva").addEventListener("click", () => abrirModalOT(null, alGuardar));
  contenedor.querySelector("#ot-buscar").addEventListener("click", cargar);
  cargar();
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
      <input type="text" id="ot-m-operador" maxlength="120" placeholder="Nombre del operador" value="${editando ? esc(ot.operador) : ""}">
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
    const operador = fondo.querySelector("#ot-m-operador").value.trim();
    const unidad = fondo.querySelector("#ot-m-unidad").value.trim();
    if (!operador) { errorDiv.textContent = "El operador no puede estar vacío."; return; }
    if (seleccionadas.length === 0) { errorDiv.textContent = "Debe haber al menos una falla."; return; }
    btnGuardar.disabled = true;
    try {
      const res = await fnGuardarOT({ id: editando ? ot.id : undefined, operador, unidad, fallas: seleccionadas });
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
  inyectarEstilos();
  contenedor.innerHTML = `
    <section class="panel">
      <h2>Operadores registrados</h2>
      <p class="nota">Operadores con acceso a Alanis Operadores. El nombre oficial es el que se ve en ADREMATASA; desactivar a un operador lo quita del selector de Validación de QR.</p>
      <div id="or-error" class="error"></div>
      <p id="or-exito" class="nota oculto" style="color:#1c7a41;"></p>
      <div class="or-encabezado">
        <input type="text" id="or-buscar" placeholder="Buscar por nombre, correo o unidad...">
        <span class="or-total" id="or-total">—</span>
      </div>
      <div id="or-lista"><p class="nota">Cargando…</p></div>
    </section>
  `;
  const lista = contenedor.querySelector("#or-lista");
  const buscar = contenedor.querySelector("#or-buscar");
  const totalEl = contenedor.querySelector("#or-total");
  const errorDiv = contenedor.querySelector("#or-error");
  const exitoP = contenedor.querySelector("#or-exito");
  let operadores = [];

  function avisar(texto) {
    exitoP.textContent = texto;
    exitoP.classList.remove("oculto");
    setTimeout(() => exitoP.classList.add("oculto"), 4000);
  }

  async function cargar() {
    errorDiv.textContent = "";
    try {
      const res = await fnListarRegistrados();
      operadores = res.data.operadores || [];
      const activos = operadores.filter(o => o.activo).length;
      totalEl.textContent = `${operadores.length} operadores · ${activos} activos`;
      render();
    } catch (err) {
      lista.innerHTML = "";
      errorDiv.textContent = mensajeError(err, "No se pudieron cargar los operadores.");
    }
  }

  function render() {
    const q = (buscar.value || "").trim().toLowerCase();
    const filtrados = !q ? operadores : operadores.filter(o =>
      o.nombre.toLowerCase().includes(q) || o.correo.toLowerCase().includes(q) ||
      o.nombreOficial.toLowerCase().includes(q) || String(o.numero).toLowerCase().includes(q));
    if (filtrados.length === 0) {
      lista.innerHTML = `<p class="nota" style="text-align:center;padding:16px;">Sin operadores${q ? " que coincidan" : " registrados"}.</p>`;
      return;
    }
    lista.innerHTML = filtrados.map(o => `
      <div class="or-card ${o.activo ? "" : "inactivo"}" data-uid="${esc(o.uid)}">
        <div class="or-fila">
          <span class="op-avatar">${esc(iniciales(o.nombre))}</span>
          <span style="flex:1;min-width:0;">
            <span class="op-nombre" style="display:block;">${esc(o.nombre || "—")}</span>
            <span class="op-sub">${esc(o.correo || "—")}</span>
          </span>
          <span class="or-badge ${o.activo ? "activo" : "inactivo"}">${o.activo ? "Activo" : "Inactivo"}</span>
        </div>
        <div style="margin-top:8px;">
          <span class="or-badge ${o.nombreOficial ? "oficial" : "sinoficial"}">${o.nombreOficial ? "✓ Nombre oficial" : "Sin nombre oficial"}</span>
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
        <div class="error or-card-error" style="margin-top:8px;"></div>
        <div class="or-acciones">
          <button type="button" class="or-guardar">Guardar datos</button>
          <button type="button" class="secundario or-estado">${o.activo ? "Desactivar" : "Activar"}</button>
          <button type="button" class="secundario or-historial">Historial</button>
        </div>
        <div class="or-hist oculto"></div>
      </div>`).join("");

    lista.querySelectorAll(".or-card").forEach(card => {
      const uid = card.dataset.uid;
      const op = operadores.find(o => o.uid === uid);
      const errCard = card.querySelector(".or-card-error");
      const botones = card.querySelectorAll("button");
      const bloquear = (b) => botones.forEach(x => { x.disabled = b; });

      card.querySelector(".or-guardar").addEventListener("click", async () => {
        errCard.textContent = "";
        const numero = card.querySelector(".or-unidad").value.trim();
        const telefono = card.querySelector(".or-tel").value.replace(/\D/g, "");
        if (!numero) { errCard.textContent = "Ingresa un número de unidad."; return; }
        if (telefono !== "" && telefono.length !== 10) { errCard.textContent = "El teléfono debe tener 10 dígitos."; return; }
        bloquear(true);
        try {
          await fnGuardarDatos({
            uid, numero, telefono,
            nombreOficial: card.querySelector(".or-oficial").value,
            lada: card.querySelector(".or-lada").value
          });
          avisar(`Datos de ${op.nombre || "operador"} guardados.`);
          await cargar();
        } catch (err) {
          errCard.textContent = mensajeError(err, "No se pudieron guardar los datos.");
          bloquear(false);
        }
      });

      card.querySelector(".or-estado").addEventListener("click", async () => {
        errCard.textContent = "";
        const activar = !op.activo;
        const pregunta = activar
          ? `¿Activar a ${op.nombre || "este operador"}? Volverá a poder entrar a Alanis Operadores y aparecerá en el selector de Validación de QR.`
          : `¿Desactivar a ${op.nombre || "este operador"}? Ya no podrá entrar a Alanis Operadores y saldrá del selector de Validación de QR.`;
        if (!confirm(pregunta)) return;
        bloquear(true);
        try {
          await fnCambiarEstado({ uid, activo: activar });
          avisar(`${op.nombre || "Operador"} ${activar ? "activado" : "desactivado"}.`);
          await cargar();
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
          const res = await fnHistorialUnidad({ uid });
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
    });
  }

  buscar.addEventListener("input", render);
  cargar();
}