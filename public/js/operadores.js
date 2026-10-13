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

const funciones = getFunctions(undefined, "us-central1");
const fnListarSolicitudes = httpsCallable(funciones, "listarSolicitudesOperadores");
const fnResolverSolicitud = httpsCallable(funciones, "resolverSolicitudOperador");
const fnListarOTs = httpsCallable(funciones, "listarOrdenesTrabajo");

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
        <input type="text" id="op-m-numero" placeholder="Ej: OP-1021">
        <label for="op-m-nombre">Nombre oficial (el que se verá en ADREMATASA)</label>
        <input type="text" id="op-m-nombre" placeholder="Nombre completo oficial">
        <label for="op-m-telefono">Teléfono (opcional)</label>
        <div style="display:flex;gap:6px;">
          <select id="op-m-lada" style="width:96px;flex-shrink:0;">
            <option value="52">MX +52</option>
            <option value="1">US +1</option>
          </select>
          <input type="tel" id="op-m-telefono" placeholder="10 dígitos" style="flex:1;min-width:0;">
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
      <h2>Órdenes de trabajo</h2>
      <p class="nota">Reportes de taller capturados por los operadores en Alanis Operadores.</p>
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
          <div class="ot-acciones"><button type="button" class="ot-imprimir" data-id="${esc(o.id)}">Imprimir</button></div>
        </div>`;
    }).join("");
    lista.querySelectorAll(".ot-imprimir").forEach(btn => {
      btn.addEventListener("click", () => {
        const ot = ordenes.find(x => x.id === btn.dataset.id);
        if (ot) imprimirOrdenTaller(ot, nombreUsuario);
      });
    });
  }

  contenedor.querySelector("#ot-buscar").addEventListener("click", cargar);
  cargar();
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