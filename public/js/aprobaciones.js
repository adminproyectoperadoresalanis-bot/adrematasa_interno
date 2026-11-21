// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/public/js/aprobaciones.js
// ##########################################################################
import { db } from "./firebase-config.js";
import {
  collection, onSnapshot, doc, updateDoc, query, where
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { crearNotificacion } from "./notificaciones.js";
import { enviarCorreoResultado } from "./correo.js";
// 2026-11-20: corregir horas extra que ya se mandaron a nómina (solo admin).
import { abrirCorregirHoras } from "./correccionesNomina.js";

const ETIQUETAS_ESTATUS = {
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  rechazada: "Rechazada"
};

// ---- Solicitudes repetidas (2026-11-10, pedido de Ivan) ----------------------
// Dos solicitudes "se empalman" si sus horarios se cruzan, contando el turno que
// pasa de medianoche (22:00–02:00 del 3 choca con 01:00–03:00 del 4). "Mismo
// día" = otra solicitud con la misma fecha que no se cruza. Las rechazadas no
// cuentan (se pueden volver a pedir). Se compara contra lo que la pantalla ya
// tiene cargado: no gasta lecturas.
function intervaloDe(fecha, horaInicio, horaFin) {
  const [y, m, d] = String(fecha || "").split("-").map(Number);
  const [hi, mi] = String(horaInicio || "").split(":").map(Number);
  const [hf, mf] = String(horaFin || "").split(":").map(Number);
  if (!y || !m || !d || isNaN(hi) || isNaN(hf)) return null;
  const ini = Math.round(Date.UTC(y, m - 1, d) / 6e4) + hi * 60 + (mi || 0);
  let dur = (hf * 60 + (mf || 0)) - (hi * 60 + (mi || 0));
  if (dur <= 0) dur += 24 * 60; // cruza medianoche
  return { ini, fin: ini + dur };
}
// otras: solicitudes del MISMO empleado. Regresa { empalmes, mismoDia }.
function revisarChoques(fecha, horaInicio, horaFin, otras, excluirId) {
  const yo = intervaloDe(fecha, horaInicio, horaFin);
  const empalmes = [], mismoDia = [];
  if (!yo) return { empalmes, mismoDia };
  otras.forEach(s => {
    if (s.id === excluirId || s.estatus === "rechazada") return;
    const o = intervaloDe(s.fecha, s.horaInicio, s.horaFin);
    if (!o) return;
    if (yo.ini < o.fin && o.ini < yo.fin) empalmes.push(s);
    else if (s.fecha === fecha) mismoDia.push(s);
  });
  const orden = (a, b) => (a.fecha + a.horaInicio).localeCompare(b.fecha + b.horaInicio);
  return { empalmes: empalmes.sort(orden), mismoDia: mismoDia.sort(orden) };
}
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fechaCorta(fechaStr) {
  const [y, m, d] = String(fechaStr || "").split("-").map(Number);
  return y && m && d ? `${d} ${MESES_CORTOS[m - 1]}` : (fechaStr || "");
}
function fechaCortaIso(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : `${d.getDate()} ${MESES_CORTOS[d.getMonth()]}`;
}

// Día festivo (2026-11-18, ATAF104): chip en la fecha si la solicitud se capturó
// como día festivo (campo festivo que guarda solicitudes.js).
function chipFestivo(s) {
  return s && s.festivo ? `<br><span style="display:inline-block;margin-top:3px;background:#FFF1CC;color:#8a5a00;border-radius:10px;padding:1px 8px;font-size:11px;font-weight:600;white-space:nowrap;" title="Día festivo · formato ATAF104">🎉 ${escapeHtml(s.festivo.nombre || "Festivo")}</span>` : "";
}

// permiteRevertir: solo true para la vista de admin (iniciarGestionSolicitudes).
// Las reglas de Firestore ya lo hacían así de todos modos — un supervisor solo
// puede actualizar una solicitud mientras sigue "pendiente" (resource.data.estatus
// == 'pendiente' en su rama de la regla), nunca una ya resuelta; solo la regla
// de admin (esAdmin(), sin esa restricción) permite regresarla a pendiente. El
// botón nuevo solo se muestra donde de verdad funciona.
function construirVista(contenedor, uidRevisor, nombreRevisor, queryBase, queryUsuarios, permiteRevertir) {
  contenedor.innerHTML = `
    <section class="panel">
      <h2>Solicitudes pendientes</h2>
      <div id="sol-error" class="error"></div>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-pendientes">
          <thead>
            <tr><th>Empleado</th><th>Fecha</th><th>Horario</th><th>Horas</th><th>Motivo</th><th>Comentario</th><th>Acción</th></tr>
          </thead>
          <tbody id="tbody-pendientes"><tr><td colspan="7">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>

    ${permiteRevertir ? `
    <section class="panel" style="margin-top:20px;">
      <h2>Ajustes pendientes</h2>
      <p class="nota">Solicitudes de empleados para que se vuelva a revisar una solicitud de horas extra ya resuelta.</p>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-ajustes-pendientes">
          <thead>
            <tr><th>Empleado</th><th>Fecha</th><th>Horario</th><th>Resultado actual</th><th>Motivo del ajuste</th><th>Comentario</th><th>Acción</th></tr>
          </thead>
          <tbody id="tbody-ajustes-pendientes"><tr><td colspan="7">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>
    ` : ""}

    <section class="panel" style="margin-top:20px;">
      <h2>Historial de solicitudes</h2>
      <style>
        /* Historial compacto (2026-11-20): anchos fijos para que se vean todas las columnas. */
        .hist-top{display:flex;gap:12px;align-items:center;margin-bottom:12px;}
        .hist-buscar{flex:1;display:flex;align-items:center;gap:8px;border:1px solid #d9d0c4;border-radius:10px;padding:0 12px;background:#fff;}
        .hist-buscar input{flex:1;border:none;outline:none;padding:10px 0;font-size:15px;background:transparent;min-width:0;}
        .hist-limpiar{border:none;background:none;color:#9a8d7e;font-size:16px;cursor:pointer;padding:4px;display:none;}
        .hist-cont{font-size:13px;color:#6b5f52;white-space:nowrap;}
        #tabla-historial{table-layout:fixed;width:100%;min-width:0;}
        #tabla-historial td{vertical-align:top;overflow-wrap:anywhere;white-space:normal;}
        #tabla-historial .badge{display:inline-block;margin:0 4px 4px 0;white-space:nowrap;}
        #tabla-historial .hist-sm{font-size:12.5px;color:#6b5f52;margin-top:2px;}
        #tabla-historial td.acciones-hist button{display:block;width:100%;margin:0 0 5px 0;padding:5px 8px;font-size:12.5px;text-align:left;}
        #tabla-historial mark{background:#FFE89A;padding:0 1px;border-radius:2px;color:inherit;}
        .hist-pag{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:14px;font-size:13.5px;color:#6b5f52;}
        .hist-pp{display:flex;gap:6px;align-items:center;flex-wrap:wrap;}
        .hist-pp button{min-width:34px;height:34px;padding:0 8px;border:1px solid #d9d0c4;border-radius:8px;background:#fff;color:#2b2016;font-size:14px;cursor:pointer;margin:0;}
        .hist-pp button.on{background:#2b2016;color:#fff;border-color:#2b2016;font-weight:700;}
        .hist-pp button:disabled{color:#c4b9ab;cursor:default;}
      </style>
      <div class="hist-top">
        <div class="hist-buscar">🔍 <input type="search" id="hist-buscar" placeholder="Buscar por empleado, fecha, motivo, estatus, quién autorizó..." autocomplete="off"><button type="button" class="hist-limpiar" id="hist-limpiar" title="Limpiar búsqueda">✕</button></div>
        <div class="hist-cont" id="hist-cont"></div>
      </div>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-historial">
          <colgroup><col style="width:16%"><col style="width:12%"><col style="width:9%"><col style="width:5%"><col style="width:15%"><col style="width:15%"><col style="width:15%"><col style="width:13%"></colgroup>
          <thead>
            <tr><th>Empleado</th><th>Fecha</th><th>Horario</th><th>Hrs</th><th>Motivo</th><th>Estatus</th><th>Revisión</th><th>Acciones</th></tr>
          </thead>
          <tbody id="tbody-historial"><tr><td colspan="8">Cargando...</td></tr></tbody>
        </table>
      </div>
      <div class="hist-pag"><div id="hist-rango"></div><div class="hist-pp" id="hist-paginas"></div></div>
    </section>
  `;

  const errorDiv = contenedor.querySelector("#sol-error");
  const tbodyPendientes = contenedor.querySelector("#tbody-pendientes");
  const tbodyHistorial = contenedor.querySelector("#tbody-historial");
  const tbodyAjustes = contenedor.querySelector("#tbody-ajustes-pendientes");

  // Historial: búsqueda tipo LIKE + paginación fija de 5 (2026-11-20).
  const POR_PAGINA_HIST = 5;
  let paginaHist = 1;
  let textoBusquedaHist = "";
  const inputBuscarHist = contenedor.querySelector("#hist-buscar");
  const btnLimpiarHist = contenedor.querySelector("#hist-limpiar");
  inputBuscarHist.addEventListener("input", () => {
    textoBusquedaHist = inputBuscarHist.value;
    btnLimpiarHist.style.display = textoBusquedaHist ? "inline" : "none";
    paginaHist = 1;
    renderHistorial();
  });
  btnLimpiarHist.addEventListener("click", () => {
    inputBuscarHist.value = "";
    inputBuscarHist.dispatchEvent(new Event("input"));
    inputBuscarHist.focus();
  });

  let ultimoHistorial = [];
  let ultimasTodas = []; // todas las solicitudes cargadas (para "Mismo día" / "Se empalma")
  let usuariosPorId = {};

  onSnapshot(queryBase, (snap) => {
    const todas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    todas.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));

    ultimasTodas = todas;
    const pendientes = todas.filter(s => s.estatus === "pendiente");
    ultimoHistorial = todas.filter(s => s.estatus !== "pendiente");

    renderPendientes(pendientes);
    renderHistorial();

    if (permiteRevertir) {
      const ajustesPendientes = todas.filter(s => s.estatus !== "pendiente" && s.ajusteSolicitud && s.ajusteSolicitud.estatus === "pendiente");
      renderAjustesPendientes(ajustesPendientes);
    }
  }, (err) => {
    errorDiv.textContent = "No se pudieron cargar las solicitudes: " + err.message;
  });

  // Correo de cada empleado (para el botón "Enviar correo" del
  // historial). Puede llegar después de las solicitudes — por eso
  // renderHistorial() se vuelve a llamar cuando cambie esto también.
  onSnapshot(queryUsuarios, (snap) => {
    usuariosPorId = {};
    snap.docs.forEach(d => { usuariosPorId[d.id] = d.data(); });
    renderHistorial();
  }, (err) => {
    console.error("No se pudo cargar el móvil de los empleados:", err);
  });

  function renderPendientes(lista) {
    if (lista.length === 0) {
      tbodyPendientes.innerHTML = `<tr><td colspan="7">No hay solicitudes pendientes.</td></tr>`;
      return;
    }
    tbodyPendientes.innerHTML = lista.map(s => `
      <tr data-id="${s.id}">
        <td>${escapeHtml(s.empleadoNombre || "")}</td>
        <td>${s.fecha}${chipFestivo(s)}</td>
        <td>${s.horaInicio}–${s.horaFin}${etiquetaChoque(s)}</td>
        <td>${s.horas}</td>
        <td>${escapeHtml(s.motivo)}</td>
        <td><input type="text" class="input-comentario" placeholder="Comentario (opcional)"></td>
        <td class="acciones">
          <button type="button" class="btn-aprobar">Aprobar</button>
          <button type="button" class="btn-rechazar">Rechazar</button>
        </td>
      </tr>
    `).join("");

    tbodyPendientes.querySelectorAll("tr[data-id]").forEach(fila => {
      const id = fila.dataset.id;
      const solicitud = lista.find(s => s.id === id);
      const comentarioInput = fila.querySelector(".input-comentario");
      fila.querySelector(".btn-aprobar").addEventListener("click", () => {
        // Si se empalma con otra (casos que se escaparon del bloqueo del empleado), pide confirmación.
        const { empalmes } = choquesDe(solicitud);
        if (empalmes.length && !confirm(`Esta solicitud se empalma con otra ${empalmes.some(x => x.estatus === "aprobada") ? "ya aprobada" : "pendiente"} del mismo empleado:\n\n${empalmes.map(textoOtra).join("\n")}\n\n¿Aprobar de todos modos?`)) return;
        resolverSolicitud(solicitud, "aprobada", comentarioInput.value.trim());
      });
      fila.querySelector(".btn-rechazar").addEventListener("click", () => {
        resolverSolicitud(solicitud, "rechazada", comentarioInput.value.trim());
      });
    });
  }

  // Otras solicitudes del mismo empleado que chocan con s (2026-11-10).
  function choquesDe(s) {
    return revisarChoques(s.fecha, s.horaInicio, s.horaFin, ultimasTodas.filter(o => o.empleadoId === s.empleadoId), s.id);
  }
  function textoOtra(o) {
    return `${fechaCorta(o.fecha)}, ${o.horaInicio}–${o.horaFin} · ${ETIQUETAS_ESTATUS[o.estatus] || o.estatus}${o.enviadoANominaEn ? ` · enviada a nómina ${fechaCortaIso(o.enviadoANominaEn)}` : ""}`;
  }
  // Gris "Mismo día" = otra solicitud esa fecha sin cruzarse; roja "Se empalma" = horarios cruzados.
  function etiquetaChoque(s) {
    const { empalmes, mismoDia } = choquesDe(s);
    const chip = (txt, fondo, color, borde) => `<div><span style="display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:9px;margin-top:4px;white-space:nowrap;background:${fondo};color:${color};${borde ? `border:1px solid ${borde};` : ""}">${txt}</span></div>`;
    const detalle = (lista, prefijo) => `<div style="font-size:11.5px;color:#6b5f52;margin-top:3px;line-height:1.4;">${prefijo} ${lista.map(o => `${o.fecha !== s.fecha ? fechaCorta(o.fecha) + " " : ""}${o.horaInicio}–${o.horaFin} · <span class="badge badge-${o.estatus}">${ETIQUETAS_ESTATUS[o.estatus] || o.estatus}</span>${o.enviadoANominaEn ? ` · enviada a nómina ${fechaCortaIso(o.enviadoANominaEn)}` : ""}`).join("<br>")}</div>`;
    if (empalmes.length) return chip("Se empalma", "#FDECEA", "#c0392b", "#F3C2BC") + detalle(empalmes, "con");
    if (mismoDia.length) return chip("Mismo día", "#ECE9E4", "#4a3e33") + detalle(mismoDia, "También");
    return "";
  }

  // Tabla de ajustes pendientes (solo admin, igual que los recortes de
  // vacaciones). Aprobar regresa la solicitud a "pendiente" (mismo efecto que
  // el botón directo "Revertir a pendiente", pero aquí lo pidió el empleado)
  // y deja registro en historialAjustes; rechazar solo marca el
  // ajusteSolicitud como rechazado, la solicitud se queda resuelta como está.
  function renderAjustesPendientes(lista) {
    if (!tbodyAjustes) return;
    if (lista.length === 0) {
      tbodyAjustes.innerHTML = `<tr><td colspan="7">No hay ajustes pendientes.</td></tr>`;
      return;
    }
    tbodyAjustes.innerHTML = lista.map(s => `
      <tr data-id="${s.id}">
        <td>${escapeHtml(s.empleadoNombre || "")}</td>
        <td>${s.fecha}</td>
        <td>${s.horaInicio}–${s.horaFin}</td>
        <td><span class="badge badge-${s.estatus}">${ETIQUETAS_ESTATUS[s.estatus] || s.estatus}</span></td>
        <td>${s.ajusteSolicitud.motivo ? escapeHtml(s.ajusteSolicitud.motivo) : "—"}</td>
        <td><input type="text" class="input-comentario" placeholder="Comentario (opcional)"></td>
        <td class="acciones">
          <button type="button" class="btn-aprobar">Aprobar</button>
          <button type="button" class="btn-rechazar">Rechazar</button>
        </td>
      </tr>
    `).join("");

    tbodyAjustes.querySelectorAll("tr[data-id]").forEach(fila => {
      const id = fila.dataset.id;
      const solicitud = lista.find(s => s.id === id);
      const comentarioInput = fila.querySelector(".input-comentario");
      fila.querySelector(".btn-aprobar").addEventListener("click", () => {
        resolverAjuste(solicitud, "aprobada", comentarioInput.value.trim());
      });
      fila.querySelector(".btn-rechazar").addEventListener("click", () => {
        resolverAjuste(solicitud, "rechazada", comentarioInput.value.trim());
      });
    });
  }

  // Ajuste (unificado, 28 sep 2026) pendiente sobre una solicitud ya
  // resuelta: mismo badge/estilo que "Recorte en revisión" de vacaciones,
  // para que se vea consistente en toda la app.
  function badgeAjuste(s) {
    const a = s.ajusteSolicitud;
    if (!a) return "";
    if (a.estatus === "pendiente") return ` <span class="badge badge-pendiente">Ajuste en revisión</span>`;
    if (a.estatus === "rechazada") return ` <span class="badge badge-rechazada" title="${a.comentarioRevisor ? escapeHtml(a.comentarioRevisor) : "Sin comentario"}">Ajuste rechazado</span>`;
    return "";
  }

  // Texto en el que busca cada registro (incluye lo que muestran los badges).
  function textoBusquedaDe(s) {
    const a = s.ajusteSolicitud;
    const n = Array.isArray(s.correcciones) ? s.correcciones.length : 0;
    return [
      s.empleadoNombre, s.fecha, fechaCorta(s.fecha), `${s.horaInicio}–${s.horaFin}`, `${s.horaInicio}-${s.horaFin}`,
      s.horas, s.motivo, ETIQUETAS_ESTATUS[s.estatus] || s.estatus,
      s.festivo ? `festivo ${s.festivo.nombre || ""}` : "",
      s.enviadoANominaEn ? `nomina ${fechaCortaIso(s.enviadoANominaEn)}` : "",
      n ? "corregida" : "",
      a && a.estatus === "pendiente" ? "ajuste en revision" : "",
      a && a.estatus === "rechazada" ? "ajuste rechazado" : "",
      s.revisadoPorNombre, s.comentarioRevisor
    ].filter(Boolean).join(" ");
  }

  // Badge corto de corrección (el largo de correccionesNomina.js no cabe aquí).
  function chipCorregidaCorta(s) {
    const n = Array.isArray(s.correcciones) ? s.correcciones.length : 0;
    if (!n) return "";
    const ult = s.correcciones[n - 1] || {};
    return `<span class="badge" style="background:#EEE6F7;color:#6B3FA0;" title="${escapeHtml(ult.motivo || "")}">Corregida${ult.informadaEn ? "" : " · sin informar"}</span>`;
  }

  // Números de página: 1 … (actual ±2) … última.
  function paginasVisibles(actual, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const set = new Set([1, total]);
    let desde = Math.max(1, actual - 2), hasta = Math.min(total, actual + 2);
    if (actual <= 3) { desde = 1; hasta = 5; }
    if (actual >= total - 2) { desde = total - 4; hasta = total; }
    for (let i = desde; i <= hasta; i++) set.add(i);
    const lista = [...set].sort((x, y) => x - y);
    const res = [];
    lista.forEach((p, i) => { if (i && p - lista[i - 1] > 1) res.push("…"); res.push(p); });
    return res;
  }

  function renderHistorial() {
    const cont = contenedor.querySelector("#hist-cont");
    const rango = contenedor.querySelector("#hist-rango");
    const cajaPaginas = contenedor.querySelector("#hist-paginas");
    const palabras = palabrasBusqueda(textoBusquedaHist);
    const filtradas = palabras.length
      ? ultimoHistorial.filter(s => { const t = normalizarBusqueda(textoBusquedaDe(s)); return palabras.every(p => t.includes(p)); })
      : ultimoHistorial;

    cont.textContent = palabras.length ? `${filtradas.length} de ${ultimoHistorial.length} registros` : `${ultimoHistorial.length} registros`;
    const totalPaginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA_HIST));
    if (paginaHist > totalPaginas) paginaHist = totalPaginas;
    const ini = (paginaHist - 1) * POR_PAGINA_HIST;
    const visibles = filtradas.slice(ini, ini + POR_PAGINA_HIST);

    rango.textContent = filtradas.length ? `Mostrando ${ini + 1}–${ini + visibles.length} de ${filtradas.length}` : "";
    cajaPaginas.innerHTML = !filtradas.length ? ""
      : `<button type="button" data-pag="${paginaHist - 1}" ${paginaHist === 1 ? "disabled" : ""}>‹</button>` +
        paginasVisibles(paginaHist, totalPaginas).map(p => p === "…" ? `<span>…</span>` : `<button type="button" data-pag="${p}" class="${p === paginaHist ? "on" : ""}">${p}</button>`).join("") +
        `<button type="button" data-pag="${paginaHist + 1}" ${paginaHist === totalPaginas ? "disabled" : ""}>›</button>`;
    cajaPaginas.querySelectorAll("button[data-pag]").forEach(b => b.addEventListener("click", () => {
      const p = Number(b.dataset.pag);
      if (p >= 1 && p <= totalPaginas && p !== paginaHist) { paginaHist = p; renderHistorial(); }
    }));

    if (ultimoHistorial.length === 0) {
      tbodyHistorial.innerHTML = `<tr><td colspan="8">Todavía no hay historial.</td></tr>`;
      return;
    }
    if (filtradas.length === 0) {
      tbodyHistorial.innerHTML = `<tr><td colspan="8">Ningún registro coincide con “${escapeHtml(textoBusquedaHist.trim())}”.</td></tr>`;
      return;
    }
    const r = (t) => resaltarBusqueda(t, palabras);
    tbodyHistorial.innerHTML = visibles.map(s => `
        <tr data-id-correo="${s.id}">
          <td>${r(s.empleadoNombre || "")}</td>
          <td>${r(s.fecha)}${chipFestivo(s)}</td>
          <td>${r(`${s.horaInicio}–${s.horaFin}`)}</td>
          <td>${r(s.horas)}</td>
          <td>${r(s.motivo)}</td>
          <td><span class="badge badge-${s.estatus}">${ETIQUETAS_ESTATUS[s.estatus] || s.estatus}</span>${badgeAjuste(s)}${s.enviadoANominaEn ? `<span class="badge" style="background:#DCEAF7;color:#185FA5;" title="Enviada a nómina">Nómina ${fechaCortaIso(s.enviadoANominaEn)}</span>` : ""}${chipCorregidaCorta(s)}</td>
          <td>${s.revisadoPorNombre ? r(s.revisadoPorNombre) : "—"}<div class="hist-sm">${s.comentarioRevisor ? r(s.comentarioRevisor) : "—"}</div></td>
          <td class="acciones-hist">
            <button type="button" class="secundario btn-enviar-correo">✉️ Correo</button>
            ${permiteRevertir && !s.enviadoANominaEn ? `<button type="button" class="secundario btn-revertir-solicitud" title="Revertir a pendiente">↩️ Revertir</button>` : ""}
            ${permiteRevertir && s.enviadoANominaEn ? `<button type="button" class="secundario btn-corregir-nomina">✏️ Corregir</button>` : ""}
            <div class="nota-correo hist-sm"></div>
          </td>
        </tr>
      `).join("");

    tbodyHistorial.querySelectorAll("tr[data-id-correo]").forEach(fila => {
      const id = fila.dataset.idCorreo;
      const solicitud = ultimoHistorial.find(s => s.id === id);
      const boton = fila.querySelector(".btn-enviar-correo");
      const nota = fila.querySelector(".nota-correo");
      boton.addEventListener("click", async () => {
        boton.disabled = true;
        nota.textContent = "Enviando...";
        const usuario = usuariosPorId[solicitud.empleadoId] || {};
        const resultado = await enviarCorreoResultado(mensajeCorreoSolicitud(solicitud, usuario));
        nota.textContent = resultado.ok ? "Enviado ✅" : "No se pudo enviar: " + resultado.error;
        boton.disabled = false;
      });

      fila.querySelector(".btn-revertir-solicitud")?.addEventListener("click", () => {
        revertirSolicitud(solicitud);
      });
      fila.querySelector(".btn-corregir-nomina")?.addEventListener("click", () => {
        abrirCorregirHoras(solicitud, { uid: uidRevisor, nombre: nombreRevisor });
      });
    });
  }

  // Arma el asunto/mensaje/destinatario del correo de aviso a partir de la
  // solicitud ya resuelta y los datos del empleado (usados tanto por el
  // botón manual del historial como por el envío automático al resolver).
  function mensajeCorreoSolicitud(s, usuario) {
    const aprobada = s.estatus === "aprobada";
    return {
      destinatarioEmail: usuario.email || "",
      destinatarioNombre: s.empleadoNombre || usuario.nombre || "",
      asunto: `Solicitud de horas extra ${aprobada ? "aprobada" : "rechazada"} — Alanis`,
      // El template de EmailJS pone el saludo ("Hola {{to_name}},") y el pie
      // de página fijos; aquí solo va el cuerpo, como HTML real — el template
      // usa {{{mensaje}}} (triple llave) para no escapar las etiquetas.
      mensaje: `<p style="margin:0 0 12px;">Tu solicitud de horas extra del ${s.fecha} (${s.horaInicio}-${s.horaFin}) fue:</p>
<p style="margin:0 0 12px;"><span style="display:inline-block;padding:4px 12px;border-radius:4px;font-weight:bold;background:${aprobada ? "#e7f5ec" : "#fdecea"};color:${aprobada ? "#1c7a41" : "#c0392b"};">${aprobada ? "APROBADA ✅" : "RECHAZADA"}</span></p>${s.comentarioRevisor ? `<p style="margin:0;color:#555;font-size:0.9em;">Comentario: ${escapeHtml(s.comentarioRevisor)}</p>` : ""}`
    };
  }

  // Correo de resultado de un AJUSTE solicitado por el empleado (29 sep
  // 2026, pedido de Ivan) — no se manda cuando el admin revierte directo
  // (revertirSolicitud), porque ahí no hay nada que el empleado esté
  // esperando que se le avise; solo cuando pasó por la cola de "Ajustes
  // pendientes" porque el empleado lo pidió.
  function mensajeCorreoAjuste(s, decision, comentario, usuario) {
    const aprobada = decision === "aprobada";
    return {
      destinatarioEmail: usuario.email || "",
      destinatarioNombre: s.empleadoNombre || usuario.nombre || "",
      asunto: `Ajuste de horas extra ${aprobada ? "aprobado" : "rechazado"} — Alanis`,
      mensaje: `<p style="margin:0 0 12px;">Tu solicitud de ajuste sobre la solicitud de horas extra del ${s.fecha} (${s.horaInicio}-${s.horaFin}) fue:</p>
<p style="margin:0 0 12px;"><span style="display:inline-block;padding:4px 12px;border-radius:4px;font-weight:bold;background:${aprobada ? "#e7f5ec" : "#fdecea"};color:${aprobada ? "#1c7a41" : "#c0392b"};">${aprobada ? "APROBADA ✅" : "RECHAZADA"}</span></p>${aprobada ? `<p style="margin:0 0 12px;">Tu solicitud volvió a "Pendiente" para revisarse de nuevo.</p>` : ""}${comentario ? `<p style="margin:0;color:#555;font-size:0.9em;">Comentario: ${escapeHtml(comentario)}</p>` : ""}`
    };
  }

  async function resolverSolicitud(solicitud, estatus, comentario) {
    errorDiv.textContent = "";
    try {
      await updateDoc(doc(db, "solicitudes", solicitud.id), {
        estatus,
        comentarioRevisor: comentario || null,
        revisadoPor: uidRevisor,
        revisadoPorNombre: nombreRevisor || null,
        resueltoEn: new Date().toISOString()
      });
      const aprobada = estatus === "aprobada";
      crearNotificacion(solicitud.empleadoId, {
        titulo: aprobada ? "Solicitud de horas extra aprobada" : "Solicitud de horas extra rechazada",
        mensaje: `Tu solicitud del ${solicitud.fecha} (${solicitud.horaInicio}–${solicitud.horaFin}) fue ${aprobada ? "aprobada" : "rechazada"}${comentario ? ": " + comentario : "."}`,
        tipo: aprobada ? "aprobacion" : "rechazo"
      });

      // Aviso por correo al empleado — mejor esfuerzo: si falla (llaves de
      // EmailJS sin configurar, sin internet, etc.) no debe tumbar la
      // aprobación/rechazo, que ya quedó guardada arriba. El botón manual
      // "Enviar correo" del historial sirve para reintentar ese caso.
      const usuario = usuariosPorId[solicitud.empleadoId] || {};
      enviarCorreoResultado(mensajeCorreoSolicitud({ ...solicitud, estatus, comentarioRevisor: comentario || null }, usuario))
        .then(resultado => {
          if (!resultado.ok) console.error("No se pudo enviar el correo de aviso:", resultado.error);
        });
    } catch (err) {
      errorDiv.textContent = "No se pudo actualizar la solicitud: " + err.message;
    }
  }

  // Deshace una aprobación/rechazo por error (18 sep 2026, pedido de Ivan) —
  // regresa la solicitud a "pendiente" tal cual estaba antes de resolverla,
  // sin tocar ningún saldo (las horas extra no descuentan nada) y sin avisar
  // al empleado: no hay nada que notificar todavía, porque el caso vuelve a
  // la fila de pendientes para resolverse correctamente. Bloqueado si ya se
  // mandó a nómina (enviadoANominaEn) — el botón ni siquiera se muestra en
  // ese caso, ver renderHistorial().
  //
  // Este es el atajo DIRECTO del admin — sin solicitud ni aprobación, porque
  // si el propio admin se equivoca al resolver no tiene sentido que se
  // autorice a sí mismo (28 sep 2026, pedido de Ivan). Aun así, para que el
  // historial quede completo, se registra en historialAjustes igual que un
  // ajuste solicitado por el empleado, marcado como "directo".
  async function revertirSolicitud(solicitud) {
    if (!confirm(`¿Regresar a "Pendiente" la solicitud de ${solicitud.empleadoNombre} del ${solicitud.fecha}? Vuelve a aparecer arriba para aprobarla o rechazarla de nuevo.`)) return;
    errorDiv.textContent = "";
    try {
      const historialPrevio = Array.isArray(solicitud.historialAjustes) ? solicitud.historialAjustes : [];
      const entradaHistorial = {
        tipo: "revertir",
        origen: "directo",
        estatusAnterior: solicitud.estatus,
        comentarioRevisorAnterior: solicitud.comentarioRevisor || null,
        revisadoPorNombreAnterior: solicitud.revisadoPorNombre || null,
        resueltoPor: uidRevisor,
        resueltoPorNombre: nombreRevisor || null,
        timestamp: new Date().toISOString()
      };
      await updateDoc(doc(db, "solicitudes", solicitud.id), {
        estatus: "pendiente",
        comentarioRevisor: null,
        revisadoPor: null,
        revisadoPorNombre: null,
        resueltoEn: null,
        historialAjustes: [...historialPrevio, entradaHistorial]
      });
    } catch (err) {
      errorDiv.textContent = "No se pudo revertir la solicitud: " + err.message;
    }
  }

  // Resuelve un ajuste SOLICITADO POR EL EMPLEADO (28 sep 2026) sobre una
  // solicitud de horas extra ya resuelta — a diferencia de revertirSolicitud()
  // de arriba (atajo directo del admin), este pasa por la cola de "Ajustes
  // pendientes" porque lo pidió el empleado, no el admin. Aprobar: mismo
  // efecto que el atajo directo (regresa a "pendiente"), más el registro en
  // historialAjustes con el motivo que dio el empleado. Rechazar: solo marca
  // el ajusteSolicitud como rechazado, la solicitud se queda resuelta como
  // estaba.
  async function resolverAjuste(solicitud, decision, comentario) {
    errorDiv.textContent = "";
    try {
      if (decision === "aprobada") {
        const historialPrevio = Array.isArray(solicitud.historialAjustes) ? solicitud.historialAjustes : [];
        const entradaHistorial = {
          tipo: "revertir",
          origen: "solicitado",
          motivo: solicitud.ajusteSolicitud.motivo || null,
          estatusAnterior: solicitud.estatus,
          comentarioRevisorAnterior: solicitud.comentarioRevisor || null,
          revisadoPorNombreAnterior: solicitud.revisadoPorNombre || null,
          resueltoPor: uidRevisor,
          resueltoPorNombre: nombreRevisor || null,
          comentarioResolucion: comentario || null,
          timestamp: new Date().toISOString()
        };
        await updateDoc(doc(db, "solicitudes", solicitud.id), {
          estatus: "pendiente",
          comentarioRevisor: null,
          revisadoPor: null,
          revisadoPorNombre: null,
          resueltoEn: null,
          ajusteSolicitud: null,
          historialAjustes: [...historialPrevio, entradaHistorial]
        });
      } else {
        await updateDoc(doc(db, "solicitudes", solicitud.id), {
          "ajusteSolicitud.estatus": "rechazada",
          "ajusteSolicitud.comentarioRevisor": comentario || null,
          "ajusteSolicitud.revisadoPor": uidRevisor,
          "ajusteSolicitud.revisadoPorNombre": nombreRevisor || null,
          "ajusteSolicitud.resueltoEn": new Date().toISOString()
        });
      }

      const aprobada = decision === "aprobada";
      crearNotificacion(solicitud.empleadoId, {
        titulo: aprobada ? "Ajuste de horas extra aprobado" : "Ajuste de horas extra rechazado",
        mensaje: aprobada
          ? `Tu solicitud del ${solicitud.fecha} (${solicitud.horaInicio}–${solicitud.horaFin}) volvió a "Pendiente" para revisarse de nuevo.`
          : `Tu solicitud de ajuste sobre el ${solicitud.fecha} fue rechazada${comentario ? ": " + comentario : "."}`,
        tipo: aprobada ? "aprobacion" : "rechazo"
      });

      // Aviso por correo al empleado (29 sep 2026, pedido de Ivan) — mejor
      // esfuerzo, igual que el de una solicitud normal: si falla no tumba
      // la resolución del ajuste, que ya quedó guardada arriba.
      const usuarioAjuste = usuariosPorId[solicitud.empleadoId] || {};
      enviarCorreoResultado(mensajeCorreoAjuste(solicitud, decision, comentario, usuarioAjuste))
        .then(resultado => {
          if (!resultado.ok) console.error("No se pudo enviar el correo de aviso del ajuste:", resultado.error);
        });
    } catch (err) {
      errorDiv.textContent = "No se pudo resolver el ajuste: " + err.message;
    }
  }
}

export function iniciarGestionSolicitudes(contenedor, uid, nombre) {
  construirVista(contenedor, uid, nombre, collection(db, "solicitudes"), collection(db, "usuarios"), true);
}

export function iniciarVistaSupervisor(contenedor, uid, nombre) {
  construirVista(
    contenedor, uid, nombre,
    query(collection(db, "solicitudes"), where("supervisorId", "==", uid)),
    query(collection(db, "usuarios"), where("supervisorId", "==", uid)),
    false
  );
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto || "";
  return div.innerHTML;
}
// ---- Búsqueda tipo LIKE del historial (2026-11-20) ---------------------------
// Sin mayúsculas ni acentos ("raul" encuentra "Raúl"). Varias palabras = todas
// deben aparecer ("litzy nov").
function normalizarBusqueda(t) {
  return String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
function palabrasBusqueda(t) {
  return normalizarBusqueda(t).split(/\s+/).filter(Boolean);
}
// Escapa el texto y marca en amarillo cada palabra buscada.
function resaltarBusqueda(texto, palabras) {
  const chars = Array.from(String(texto ?? ""));
  if (!palabras || !palabras.length) return escapeHtml(chars.join(""));
  const norm = chars.map(c => normalizarBusqueda(c).charAt(0) || c);
  const marca = new Array(chars.length).fill(false);
  palabras.forEach(p => {
    const q = Array.from(p);
    for (let i = 0; i + q.length <= norm.length; i++) {
      let ok = true;
      for (let j = 0; j < q.length; j++) if (norm[i + j] !== q[j]) { ok = false; break; }
      if (ok) for (let j = 0; j < q.length; j++) marca[i + j] = true;
    }
  });
  let html = "", abierto = false;
  chars.forEach((c, i) => {
    if (marca[i] && !abierto) { html += "<mark>"; abierto = true; }
    if (!marca[i] && abierto) { html += "</mark>"; abierto = false; }
    html += escapeHtml(c);
  });
  return html + (abierto ? "</mark>" : "");
}