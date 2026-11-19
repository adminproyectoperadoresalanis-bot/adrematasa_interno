// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/public/js/formatoFestivo.js
// ##########################################################################
// Digitalización del ATAF104 "Formato de planeación de personal a laborar —
// día festivo" (2026-11-18, pedido de Ivan / RH). Hermano de
// formatoVacaciones.js (ATAF050).
//
// De dónde sale cada dato:
//   - El empleado captura sus horas extra con la fecha del festivo (aunque
//     todavía no ocurra) y una justificación breve (solicitudes.js).
//   - Entran SOLO las solicitudes APROBADAS de esa fecha, TODAS las áreas en
//     un solo formato (opción B de Ivan, 2026-11-18): encabezado "Varias (N
//     áreas)" y columna Área en la tabla. Las pendientes se avisan pero no entran.
//   - Un solo correo por festivo, igual que el reporte semanal de nómina:
//     una sola lista de destinatarios en Configuración › 1 · RH.
//   - Jefe/Gerente responsable = quien autoriza (Ivan). Fecha de solicitud =
//     el día en que se descarga o se envía.
//   - La tabla crece con el número de personas (mínimo 6 renglones, como el
//     formato original); si no cabe, el PDF pasa a otra hoja.
//
// Quién lo usa: solo quien autoriza (AUTORIZA_ATAF104), desde Reportes.
// Correo: función enviarAtaf104 (functions/ataf104Correo.js), la misma forma
// segura que usa Comercial: Brevo con la clave en el servidor, PDF adjunto.
//
// Datos en configuracion/ataf104 (configuracion: lectura con sesión,
// escritura solo admin — no se tocan reglas):
//   destinatarios: { para: [correos], cc: [correos] }               ← Configuración › RH
//   observaciones: { "<fecha>": "texto" }                            ← Reportes
//   envios:        { "<fecha>": [{ ms, para, cc, personas, por }] }  ← la función

import { db } from "./firebase-config.js";
import {
  doc, getDoc, setDoc, updateDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";
import { LOGO_ALANIS } from "./comercialLogo.js";

// Si algún día se delega, se agrega el correo aquí Y en functions/ataf104Correo.js.
export const AUTORIZA_ATAF104 = ["ilanda@alanis.com.mx"];
export function puedeUsarAtaf104() {
  const u = getAuth().currentUser;
  return !!(u && AUTORIZA_ATAF104.includes(String(u.email || "").toLowerCase()));
}
export const REF_CFG_FESTIVO = () => doc(db, "configuracion", "ataf104");

const URL_JSPDF = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const SIN_AREA = "Sin área";

const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const correoValido = (t) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(t || "").trim());
const dd = (n) => String(n).padStart(2, "0");
export const fechaNum = (iso) => { const [y, m, d] = String(iso || "").split("-"); return y ? `${d}/${m}/${y}` : ""; };
const fechaLarga = (iso) => { const [y, m, d] = String(iso || "").split("-").map(Number); return y ? `${d} de ${MESES[m - 1]} de ${y}` : ""; };
const hoyIso = () => { const d = new Date(); return `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`; };
export const claveFestivo = (fecha) => String(fecha || "");
const slug = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
const listaCorreos = (txt) => String(txt || "").split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
export const fechaHoraCorta = (ms) => { const d = new Date(ms); return `${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)} ${dd(d.getHours())}:${dd(d.getMinutes())}`; };

function cargarScript(url, global) {
  if (window[global]) return Promise.resolve(window[global]);
  return new Promise((ok, mal) => {
    const s = document.createElement("script");
    s.src = url; s.onload = () => ok(window[global]); s.onerror = () => mal(new Error("No se pudo cargar " + url));
    document.head.appendChild(s);
  });
}

// =============================================================================
// Datos
// =============================================================================
// solicitudes: TODAS las de horas extra (ya cargadas). Regresa, por área, las
// aprobadas y las pendientes de esa fecha, ordenado por nombre de área.
export function agruparFestivoPorArea(solicitudes, mapUsuarios, fecha) {
  const m = new Map();
  solicitudes.filter(s => s.fecha === fecha && (s.estatus === "aprobada" || s.estatus === "pendiente")).forEach(s => {
    const area = (mapUsuarios.get(s.empleadoId) || {}).area || SIN_AREA;
    if (!m.has(area)) m.set(area, { area, aprobadas: [], pendientes: [] });
    (s.estatus === "aprobada" ? m.get(area).aprobadas : m.get(area).pendientes).push(s);
  });
  return [...m.values()].sort((a, b) => a.area.localeCompare(b.area, "es"));
}

// Un renglón por persona, todas las áreas; si alguien trae dos bloques ese
// día, se juntan. Orden: área y luego nombre.
export function personasDeGrupos(grupos, mapUsuarios) {
  const m = new Map();
  grupos.forEach(g => (g.aprobadas || []).slice().sort((a, b) => (a.horaInicio || "").localeCompare(b.horaInicio || "")).forEach(s => {
    const u = mapUsuarios.get(s.empleadoId) || {};
    if (!m.has(s.empleadoId)) m.set(s.empleadoId, { nombre: u.nombre || s.empleadoNombre || "", area: g.area, puesto: u.puesto || "", horarios: [], motivos: [] });
    const p = m.get(s.empleadoId);
    p.horarios.push(`${s.horaInicio} – ${s.horaFin}`);
    if (s.motivo) p.motivos.push(String(s.motivo).trim());
  }));
  return [...m.values()].sort((a, b) => a.area.localeCompare(b.area, "es") || a.nombre.localeCompare(b.nombre, "es"))
    .map(p => ({ nombre: p.nombre, area: p.area, puesto: p.puesto, horario: p.horarios.join(" y "), motivo: p.motivos.join("; ") }));
}

// "Operaciones MEX" si es una sola área; "Varias (3 áreas)" si son más.
export function textoArea(personas) {
  const areas = [...new Set(personas.map(p => p.area))];
  return areas.length === 1 ? areas[0] : areas.length ? `Varias (${areas.length} áreas)` : "";
}

// =============================================================================
// Hoja en pantalla (misma información que el PDF)
// =============================================================================
const ESTILOS = `
.ff-hoja{background:#fff;max-width:816px;margin:0 auto;padding:26px 34px;border:1px solid #e2ddd5;font-family:Arial,Helvetica,sans-serif;color:#222;}
.ff-hoja img{height:44px}
.ff-tit{text-align:center;font-size:17px;font-weight:700;margin-top:6px}.ff-tit2{text-align:center;font-weight:700;font-size:12px;margin-bottom:12px}
.ff-enc{width:100%;border-collapse:collapse;font-size:11px}.ff-enc td{padding:7px 8px;border:0}
.ff-enc .k{background:#3d2b26;color:#fff;font-weight:700;font-size:9px;width:17%;text-transform:uppercase}.ff-enc .v{background:#efe9df;width:33%}
.ff-sec{font-size:11px;font-weight:700;border-bottom:1px solid #c9b58f;margin:16px 0 5px;padding-bottom:3px}
.ff-nota{font-size:9px;margin-bottom:4px}
.ff-tf{width:100%;border-collapse:collapse;font-size:10.5px}.ff-tf th{background:#3d2b26;color:#fff;font-size:9px;padding:3px;border:0}
.ff-tf td{border:1px solid #444;padding:6px;height:24px}.ff-tf td:first-child{text-align:center;width:6%}
.ff-box{border:1px solid #444;padding:7px 9px;font-size:10.5px;min-height:46px}.ff-box ol{margin:0;padding-left:18px}.ff-box li{margin:2px 0;min-height:13px}
.ff-firmas{display:flex;justify-content:space-around;margin-top:28px;font-size:9.5px;text-align:center}.ff-firmas div{width:30%}
.ff-firmas .l{border-top:1px solid #999;margin:0 12% 3px}.ff-firmas b{display:block}
.ff-pie{display:flex;justify-content:space-between;font-size:9px;margin-top:16px}
.ff-aviso{border-radius:10px;padding:9px 12px;font-size:13px;margin:8px 0;background:#FFF6E0;border:1px solid #F0D79A;color:#6b4a06}
.ff-acc{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px}
.ff-campo label{display:block;font-size:12px;color:#6b5f52;margin:10px 0 3px}
.ff-campo input,.ff-campo textarea{width:100%;box-sizing:border-box}
.ff-chip{display:inline-block;border-radius:10px;padding:1px 8px;font-size:11px;font-weight:600;white-space:nowrap}
.ff-pend{background:#FFF1CC;color:#8a5a00}.ff-env{background:#DCEAF7;color:#185FA5}.ff-sin{background:#eee;color:#555}
@media (max-width:640px){.ff-hoja{padding:14px 10px}.ff-enc .k{font-size:8px}.ff-acc{justify-content:flex-start}}
`;
export function inyectarEstilosFestivo() {
  if (document.getElementById("estilos-formato-festivo")) return;
  const st = document.createElement("style"); st.id = "estilos-formato-festivo"; st.textContent = ESTILOS; document.head.appendChild(st);
}

// d: { fecha, festivoNombre, area, responsable, fechaSolicitud, personas[], observaciones }
export function htmlHojaFestivo(d) {
  const filas = Math.max(6, d.personas.length);
  return `<div class="ff-hoja">
    <img src="${LOGO_ALANIS.datos}" alt="Alanis">
    <div class="ff-tit">FORMATO DE PLANEACIÓN DE PERSONAL A LABORAR</div><div class="ff-tit2">DÍA FESTIVO</div>
    <table class="ff-enc">
      <tr><td class="k">Fecha del día festivo</td><td class="v">${esc(fechaNum(d.fecha))}${d.festivoNombre ? ` — ${esc(d.festivoNombre)}` : ""}</td><td class="k">Área / Departamento</td><td class="v">${esc(d.area)}</td></tr>
      <tr><td class="k">Jefe / Gerente responsable</td><td class="v">${esc(d.responsable)}</td><td class="k">Fecha de solicitud</td><td class="v">${esc(fechaNum(d.fechaSolicitud))}</td></tr>
    </table>
    <div class="ff-sec">1. RELACIÓN DEL PERSONAL PROGRAMADO</div>
    <div class="ff-nota"><i>Registrar únicamente al personal estrictamente necesario para garantizar la continuidad de la operación.</i></div>
    <table class="ff-tf"><tr><th>No.</th><th>Nombre del colaborador</th><th>Área</th><th>Puesto</th><th>Horario de entrada y salida</th></tr>
      ${Array.from({ length: filas }, (_, i) => { const p = d.personas[i]; return `<tr><td>${i + 1}</td><td>${p ? esc(p.nombre) : ""}</td><td>${p ? esc(p.area) : ""}</td><td>${p ? esc(p.puesto) : ""}</td><td>${p ? esc(p.horario) : ""}</td></tr>`; }).join("")}
    </table>
    <div class="ff-sec">2. JUSTIFICACIÓN DE LA PROGRAMACIÓN</div>
    <div class="ff-nota">Describir el motivo por trabajador, por el cual se requiere la presencia del personal durante el día festivo y la actividad operativa que deberá atender.</div>
    <div class="ff-box"><ol>${Array.from({ length: filas }, (_, i) => `<li>${d.personas[i] ? esc(d.personas[i].motivo) : ""}</li>`).join("")}</ol></div>
    <div class="ff-sec">3. OBSERVACIONES ADICIONALES</div>
    <div class="ff-box" style="white-space:pre-wrap;">${esc(d.observaciones)}</div>
    <div class="ff-sec">4. AUTORIZACIONES</div>
    <div class="ff-firmas">
      <div><div class="l"></div><b>GERENTE DEL ÁREA</b>Nombre y firma<br><br>Fecha: ___ / ___ / _____</div>
      <div><div class="l"></div><b>GERENCIA DE RECURSOS HUMANOS</b>Nombre y firma<br><br>Fecha: ___ / ___ / _____</div>
      <div><div class="l"></div><b>DIRECCIÓN FINANCIERA</b>Nombre y firma<br><br>Fecha: ___ / ___ / _____</div>
    </div>
    <div style="text-align:center;font-size:8.5px;font-style:italic;color:#666;margin-top:10px;">La programación de personal para días festivos deberá contar con las autorizaciones correspondientes antes de su ejecución.</div>
    <div class="ff-pie"><span>ATAF104</span><span>Rev 0. &nbsp; 13/11/2026</span></div>
  </div>`;
}

// =============================================================================
// Ver / PDF  (lo abre Reportes)
// =============================================================================
// d: datos del formato (sin observaciones; se toman de cfg)
// pendientes: solicitudes pendientes de esa fecha, todas las áreas (solo para avisar)
// cfg: configuracion/ataf104 tal como está ahora
// yo: { nombre, puesto }
export function abrirVerFestivo({ d, pendientes, cfg, yo }) {
  inyectarEstilosFestivo();
  const k = claveFestivo(d.fecha);
  let datos = { ...d, observaciones: ((cfg && cfg.observaciones) || {})[k] || "" };
  const ov = document.createElement("div");
  ov.className = "modal-overlay";
  ov.innerHTML = `<div class="modal-tarjeta ff-campo" style="max-width:880px;width:100%;max-height:94vh;overflow:auto;">
    <h2 style="margin:0 0 4px;">ATAF104 · ${esc(fechaNum(d.fecha))} ${esc(d.festivoNombre)}</h2>
    <p class="nota" style="margin:0;">${d.personas.length} persona${d.personas.length === 1 ? "" : "s"} aprobada${d.personas.length === 1 ? "" : "s"}${d.area ? ` · ${esc(d.area)}` : ""}</p>
    ${pendientes.length ? `<div class="ff-aviso">Hay <b>${pendientes.length} solicitud${pendientes.length === 1 ? "" : "es"} pendiente${pendientes.length === 1 ? "" : "s"}</b> (${pendientes.map(s => esc(s.empleadoNombre || "")).join(", ")}). No entra${pendientes.length === 1 ? "" : "n"} al formato hasta que la${pendientes.length === 1 ? "" : "s"} apruebes.</div>` : ""}
    <div id="ff-hoja" style="margin-top:10px;">${htmlHojaFestivo(datos)}</div>
    <label>Observaciones adicionales (sección 3) · se guardan para este festivo</label>
    <textarea id="ff-obs" rows="2" maxlength="600" placeholder="Opcional">${esc(datos.observaciones)}</textarea>
    <div class="nota" id="ff-obs-estado" style="margin:3px 0 0;"></div>
    <div class="error" id="ff-err"></div>
    <div class="ff-acc">
      <button type="button" class="secundario" id="ff-cerrar">Cerrar</button>
      <button type="button" class="secundario" id="ff-pdf"${d.personas.length ? "" : " disabled"}>⬇️ Descargar PDF</button>
      <button type="button" id="ff-enviar"${d.personas.length ? "" : " disabled"}>✉️ Enviar</button>
    </div></div>`;
  document.body.appendChild(ov);
  const q = (s) => ov.querySelector(s);
  const obs = q("#ff-obs");
  const cerrar = () => ov.remove();
  q("#ff-cerrar").addEventListener("click", cerrar);
  ov.addEventListener("click", (e) => { if (e.target === ov) cerrar(); });
  obs.addEventListener("input", () => { datos = { ...datos, observaciones: obs.value }; q("#ff-hoja").innerHTML = htmlHojaFestivo(datos); });
  const guardarObs = async () => {
    const texto = obs.value.trim();
    if (texto === ((((cfg && cfg.observaciones) || {})[k]) || "")) return;
    try {
      await setDoc(REF_CFG_FESTIVO(), { observaciones: { [k]: texto } }, { merge: true });
      cfg = { ...(cfg || {}), observaciones: { ...((cfg && cfg.observaciones) || {}), [k]: texto } };
      q("#ff-obs-estado").textContent = "Observaciones guardadas.";
    } catch (x) { q("#ff-obs-estado").textContent = "No se pudieron guardar las observaciones: " + x.message; }
  };
  obs.addEventListener("change", guardarObs);
  q("#ff-pdf").addEventListener("click", async () => {
    try { await guardarObs(); const a = await generarPdfFestivo({ ...datos, observaciones: obs.value.trim() }); a.descargar(); }
    catch (x) { q("#ff-err").textContent = "No se pudo generar el PDF: " + x.message; }
  });
  q("#ff-enviar").addEventListener("click", async () => {
    await guardarObs();
    abrirEnvioFestivo({ d: { ...datos, observaciones: obs.value.trim() }, cfg, yo, alEnviar: cerrar });
  });
}

// =============================================================================
// Envío por correo (función segura enviarAtaf104) — un solo correo por festivo
// =============================================================================
function mensajeDefault(d, yo) {
  const n = d.personas.length;
  return `Buen día.\n\nPor medio del presente les comparto el formato ATAF104 de planeación del personal que laborará el día festivo ${fechaLarga(d.fecha)}${d.festivoNombre ? ` (${d.festivoNombre})` : ""}.\n\nPersonal programado (${n} colaborador${n === 1 ? "" : "es"}):\n${d.personas.map(p => `- ${p.nombre}${p.puesto ? `, ${p.puesto}` : ""} (${p.area}): ${p.horario}`).join("\n")}\n\nAdjunto el formato para su revisión y autorización.\n\nQuedo a sus órdenes.\n\nUn saludo.\n\n${[yo.nombre, yo.puesto, "Autotransportes Alanis"].filter(Boolean).join("\n")}`;
}

// Destinatarios guardados: { para, cc }.
const destinatariosDe = (cfg) => {
  const d = (cfg && cfg.destinatarios) || {};
  return { para: Array.isArray(d.para) ? d.para : [], cc: Array.isArray(d.cc) ? d.cc : [] };
};

export function abrirEnvioFestivo({ d, cfg, yo, alEnviar }) {
  inyectarEstilosFestivo();
  const guardados = destinatariosDe(cfg);
  const md = document.createElement("div");
  md.className = "modal-overlay";
  md.style.zIndex = "10001";
  md.innerHTML = `<div class="modal-tarjeta ff-campo" style="max-width:620px;width:100%;max-height:92vh;overflow:auto;">
    <h2 style="margin:0 0 4px;">Enviar ATAF104 · ${esc(fechaNum(d.fecha))} ${esc(d.festivoNombre)}</h2>
    <p class="nota" style="margin:0;">${d.personas.length} persona${d.personas.length === 1 ? "" : "s"}${d.area ? ` · ${esc(d.area)}` : ""} · sale de tu correo con el PDF adjunto.</p>
    <label>Para</label><input type="text" id="fe-para" value="${esc(guardados.para.join(", "))}" placeholder="rh@alanis.com.mx, finanzas@alanis.com.mx">
    <label>CC</label><input type="text" id="fe-cc" value="${esc(guardados.cc.join(", "))}">
    <p class="nota" style="margin:4px 0 0;">${guardados.para.length ? "Vienen de Configuración › 1 · RH › Formato día festivo ATAF104. Lo que cambies aquí aplica solo a este envío." : "Todavía no hay destinatarios en Configuración › 1 · RH › Formato día festivo ATAF104."}</p>
    <label style="display:flex;gap:6px;align-items:center;font-weight:400;font-size:12.5px;color:inherit;"><input type="checkbox" id="fe-yo" checked style="width:auto;"> Copia oculta para mí</label>
    <label>Asunto</label><input type="text" id="fe-asunto" value="${esc(`ATAF104 · Personal a laborar día festivo ${fechaNum(d.fecha)}${d.festivoNombre ? " · " + d.festivoNombre : ""}`)}">
    <label>Mensaje</label><textarea id="fe-msg" rows="12">${esc(mensajeDefault(d, yo))}</textarea>
    <div class="error" id="fe-err"></div>
    <div class="modal-acciones"><button type="button" class="secundario" id="fe-cancelar">Cancelar</button><button type="button" id="fe-ok">Enviar</button></div></div>`;
  document.body.appendChild(md);
  const q = (s) => md.querySelector(s);
  const err = (t) => { q("#fe-err").textContent = t || ""; };
  q("#fe-cancelar").addEventListener("click", () => md.remove());
  q("#fe-ok").addEventListener("click", async () => {
    const para = listaCorreos(q("#fe-para").value), cc = listaCorreos(q("#fe-cc").value).filter(c => !para.includes(c));
    const malos = [...para, ...cc].filter(c => !correoValido(c));
    if (!para.length) { err("Escribe al menos un correo en Para."); return; }
    if (malos.length) { err("Revisa estos correos: " + malos.join(", ")); return; }
    const asunto = q("#fe-asunto").value.trim(), mensaje = q("#fe-msg").value.trim();
    if (!asunto || !mensaje) { err("Escribe el asunto y el mensaje."); return; }
    err();
    const b = q("#fe-ok"); b.disabled = true; b.textContent = "Enviando…";
    try {
      const archivo = await generarPdfFestivo(d);
      const fn = httpsCallable(getFunctions(undefined, "us-central1"), "enviarAtaf104");
      await fn({
        fecha: d.fecha, festivoNombre: d.festivoNombre, area: d.area, personas: d.personas.length,
        para: para.map(c => ({ email: c })), cc: cc.map(c => ({ email: c })), copiaParaMi: q("#fe-yo").checked,
        asunto, mensaje, pdfBase64: archivo.base64, nombreArchivo: archivo.nombre,
      });
      md.remove();
      if (alEnviar) alEnviar();
      alert(`ATAF104 del ${fechaNum(d.fecha)} enviado a ${para.join(", ")}.`);
    } catch (x) {
      b.disabled = false; b.textContent = "Enviar";
      err("No se pudo enviar: " + (x.message || x));
    }
  });
}

// =============================================================================
// Configuración › 1 · RH › "Formato día festivo ATAF104 (correo)"
// Igual que "Reporte semanal de nómina": Para y CC (lo llama configuracion.js).
// =============================================================================
export function iniciarConfigFestivo(cuerpo, resumen) {
  inyectarEstilosFestivo();
  cuerpo.innerHTML = `
    <p class="nota">Cuando envías el formato ATAF104 de un festivo desde Reportes, sale un solo correo con el PDF
      de todo el personal programado. Aquí defines a quién llega. Separa varios correos con comas.</p>
    <div id="ffc-error" class="error"></div>
    <p id="ffc-exito" class="nota oculto" style="color:#1c7a41;"></p>
    <div>
      <label for="ffc-para" style="display:block; font-weight:600; margin-bottom:4px;">Destinatarios (Para)</label>
      <input type="text" id="ffc-para" style="width:100%;" placeholder="rh@alanis.com.mx, finanzas@alanis.com.mx">
    </div>
    <div style="margin-top:12px;">
      <label for="ffc-cc" style="display:block; font-weight:600; margin-bottom:4px;">Con copia (CC) — opcional</label>
      <input type="text" id="ffc-cc" style="width:100%;" placeholder="ilanda@alanis.com.mx">
    </div>
    <div class="acciones-form" style="margin-top:14px;"><button type="button" id="ffc-guardar">Guardar cambios</button></div>`;
  const inPara = cuerpo.querySelector("#ffc-para"), inCc = cuerpo.querySelector("#ffc-cc");
  onSnapshot(REF_CFG_FESTIVO(), (s) => {
    const d = destinatariosDe(s.exists() ? s.data() : {});
    inPara.value = d.para.join(", ");
    inCc.value = d.cc.join(", ");
    if (resumen) resumen.textContent = d.para.length
      ? `Un correo por festivo · ${d.para.length} destinatario${d.para.length === 1 ? "" : "s"}${d.cc.length ? ` + ${d.cc.length} CC` : ""}`
      : "Sin destinatarios todavía";
  });
  cuerpo.querySelector("#ffc-guardar").addEventListener("click", async () => {
    const e = cuerpo.querySelector("#ffc-error"), ok = cuerpo.querySelector("#ffc-exito");
    e.textContent = ""; ok.classList.add("oculto");
    const para = listaCorreos(inPara.value), cc = listaCorreos(inCc.value).filter(c => !para.includes(c));
    const malos = [...para, ...cc].filter(c => !correoValido(c));
    if (!para.length) { e.textContent = 'Agrega al menos un correo en "Destinatarios (Para)".'; return; }
    if (malos.length) { e.textContent = "Correo no válido: " + malos.join(", "); return; }
    try {
      // updateDoc reemplaza "destinatarios" completo sin tocar observaciones ni envíos.
      const actual = await getDoc(REF_CFG_FESTIVO());
      const datos = { destinatarios: { para, cc }, actualizadoEn: new Date().toISOString() };
      if (actual.exists()) await updateDoc(REF_CFG_FESTIVO(), datos);
      else await setDoc(REF_CFG_FESTIVO(), datos);
      ok.textContent = "Guardado. Se usa la próxima vez que envíes un formato ATAF104.";
      ok.classList.remove("oculto");
    } catch (x) { e.textContent = "No se pudo guardar: " + x.message; }
  });
}

// =============================================================================
// PDF (carta vertical, réplica del ATAF104 Rev 0, con el logo de la app)
// =============================================================================
export async function generarPdfFestivo(d) {
  const { jsPDF } = await cargarScript(URL_JSPDF, "jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "letter" });
  const CAFE = [61, 43, 38], BEIGE = [239, 233, 223], LINEA = [201, 181, 143], NEGRO = [34, 34, 34], GRIS = [102, 102, 102];
  const X0 = 16, X1 = 199.9, W = X1 - X0, LIMITE = 262;
  let y = 12;
  const nuevaHoja = () => { pdf.addPage(); y = 16; };
  const seccion = (t) => {
    if (y + 12 > LIMITE) nuevaHoja();
    y += 5;
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(9.5); pdf.setTextColor(...NEGRO);
    pdf.text(t, X0, y);
    pdf.setDrawColor(...LINEA); pdf.setLineWidth(0.3); pdf.line(X0, y + 1.5, X1, y + 1.5);
    y += 5;
  };

  const anchoLogo = 34, altoLogo = anchoLogo * LOGO_ALANIS.alto / LOGO_ALANIS.ancho;
  pdf.addImage(LOGO_ALANIS.datos, "JPEG", X0, y, anchoLogo, altoLogo);
  y += altoLogo + 6;
  pdf.setFont("helvetica", "bold"); pdf.setTextColor(...NEGRO);
  pdf.setFontSize(14.5); pdf.text("FORMATO DE PLANEACIÓN DE PERSONAL A LABORAR", (X0 + X1) / 2, y, { align: "center" });
  y += 5.5; pdf.setFontSize(9.5); pdf.text("DÍA FESTIVO", (X0 + X1) / 2, y, { align: "center" });
  y += 4;

  const kw = 31, vw = W / 2 - kw, hRen = 10;
  [
    ["FECHA DEL DÍA FESTIVO", `${fechaNum(d.fecha)}${d.festivoNombre ? " — " + d.festivoNombre : ""}`, "ÁREA / DEPARTAMENTO", d.area],
    ["JEFE / GERENTE RESPONSABLE", d.responsable, "FECHA DE SOLICITUD", fechaNum(d.fechaSolicitud)],
  ].forEach(r => {
    [[X0, r[0], r[1]], [X0 + W / 2, r[2], r[3]]].forEach(([x, k, v]) => {
      pdf.setFillColor(...CAFE); pdf.rect(x, y, kw, hRen, "F");
      pdf.setFillColor(...BEIGE); pdf.rect(x + kw, y, vw, hRen, "F");
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(6.5); pdf.setTextColor(255, 255, 255);
      const lk = pdf.splitTextToSize(k, kw - 4);
      pdf.text(lk, x + 2, y + hRen / 2 - (lk.length - 1) * 1.3 + 1);
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(8.5); pdf.setTextColor(...NEGRO);
      const lv = pdf.splitTextToSize(String(v || ""), vw - 4).slice(0, 2);
      pdf.text(lv, x + kw + 2, y + hRen / 2 - (lv.length - 1) * 1.6 + 1.2);
    });
    y += hRen;
  });

  seccion("1. RELACIÓN DEL PERSONAL PROGRAMADO");
  pdf.setFont("helvetica", "italic"); pdf.setFontSize(7); pdf.setTextColor(...NEGRO);
  pdf.text("Registrar únicamente al personal estrictamente necesario para garantizar la continuidad de la operación.", X0, y);
  y += 2;
  const cols = [10, 50, 40, 40, W - 140];
  const encabezadoTabla = () => {
    pdf.setFillColor(...CAFE); pdf.rect(X0, y, W, 5, "F");
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(7); pdf.setTextColor(255, 255, 255);
    let x = X0;
    ["No.", "Nombre del colaborador", "Área", "Puesto", "Horario de entrada y salida"].forEach((t, i) => { pdf.text(t, x + cols[i] / 2, y + 3.4, { align: "center" }); x += cols[i]; });
    y += 5;
  };
  encabezadoTabla();
  const filas = Math.max(6, d.personas.length);
  for (let i = 0; i < filas; i++) {
    const p = d.personas[i];
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(8.5);
    const celdas = [String(i + 1), p ? p.nombre : "", p ? p.area : "", p ? p.puesto : "", p ? p.horario : ""].map((t, j) => pdf.splitTextToSize(t, cols[j] - 3));
    const h = Math.max(8, Math.max(...celdas.map(c => c.length)) * 3.6 + 3);
    if (y + h > LIMITE) { nuevaHoja(); encabezadoTabla(); pdf.setFont("helvetica", "normal"); pdf.setFontSize(8.5); }
    pdf.setDrawColor(68, 68, 68); pdf.setLineWidth(0.25); pdf.setTextColor(...NEGRO);
    let x = X0;
    celdas.forEach((c, j) => {
      pdf.rect(x, y, cols[j], h);
      const ty = y + h / 2 - (c.length - 1) * 1.8 + 1.2;
      if (j === 0) pdf.text(c, x + cols[j] / 2, ty, { align: "center" }); else pdf.text(c, x + 1.5, ty);
      x += cols[j];
    });
    y += h;
  }

  seccion("2. JUSTIFICACIÓN DE LA PROGRAMACIÓN");
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(7); pdf.setTextColor(...NEGRO);
  const notaJ = pdf.splitTextToSize("Describir el motivo por trabajador, por el cual se requiere la presencia del personal durante el día festivo y la actividad operativa que deberá atender.", W);
  pdf.text(notaJ, X0, y); y += notaJ.length * 3 + 1;
  pdf.setFontSize(8.5);
  let y0 = y; y += 4.5;
  const cerrarCaja = () => { pdf.setDrawColor(68, 68, 68); pdf.setLineWidth(0.25); pdf.rect(X0, y0, W, y - y0); };
  for (let i = 0; i < filas; i++) {
    const p = d.personas[i];
    const lineas = pdf.splitTextToSize(p ? p.motivo : "", W - 14);
    const h = Math.max(1, lineas.length) * 3.8;
    if (y + h > LIMITE) { y += 1; cerrarCaja(); nuevaHoja(); y0 = y; y += 4.5; pdf.setFont("helvetica", "normal"); pdf.setFontSize(8.5); }
    pdf.setTextColor(...NEGRO);
    pdf.text(`${i + 1}.`, X0 + 3, y);
    if (lineas.length) pdf.text(lineas, X0 + 9, y);
    y += h;
  }
  y += 1; cerrarCaja();

  seccion("3. OBSERVACIONES ADICIONALES");
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(8.5);
  const lObs = pdf.splitTextToSize(d.observaciones || "", W - 6);
  const hObs = Math.max(14, lObs.length * 3.8 + 5);
  if (y + hObs > LIMITE) nuevaHoja();
  pdf.setDrawColor(68, 68, 68); pdf.rect(X0, y, W, hObs);
  if (lObs.length) { pdf.setTextColor(...NEGRO); pdf.text(lObs, X0 + 3, y + 5); }
  y += hObs;

  if (y + 46 > LIMITE) nuevaHoja();
  seccion("4. AUTORIZACIONES");
  y += 14;
  const anchoCol = W / 3;
  ["GERENTE DEL ÁREA", "GERENCIA DE RECURSOS HUMANOS", "DIRECCIÓN FINANCIERA"].forEach((t, i) => {
    const cx = X0 + anchoCol * i + anchoCol / 2;
    pdf.setDrawColor(150, 150, 150); pdf.line(cx - 22, y, cx + 22, y);
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(7.5); pdf.setTextColor(...NEGRO);
    pdf.text(t, cx, y + 4, { align: "center" });
    pdf.text("Nombre y firma", cx, y + 7.5, { align: "center" });
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(7); pdf.setTextColor(...GRIS);
    pdf.text("Fecha: ____ / ____ / ______", cx, y + 13, { align: "center" });
  });
  y += 19;
  pdf.setFont("helvetica", "italic"); pdf.setFontSize(6.5); pdf.setTextColor(...GRIS);
  pdf.text("La programación de personal para días festivos deberá contar con las autorizaciones correspondientes antes de su ejecución.", (X0 + X1) / 2, y, { align: "center" });

  const total = pdf.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(7.5); pdf.setTextColor(...NEGRO);
    pdf.text("ATAF104", X0 + 4, 271);
    pdf.text("Rev 0.     13/11/2026", X1 - 4, 271, { align: "right" });
    if (total > 1) pdf.text(`Hoja ${i} de ${total}`, (X0 + X1) / 2, 271, { align: "center" });
  }

  const nombre = `ATAF104_${d.fecha}${d.festivoNombre ? "_" + slug(d.festivoNombre) : ""}.pdf`;
  const base64 = pdf.output("datauristring").split(",")[1];
  return { nombre, base64, descargar: () => pdf.save(nombre) };
}

// Fecha de solicitud = hoy (el día en que se descarga o se envía).
// grupos: los de agruparFestivoPorArea (todas las áreas en un solo formato).
export function datosFormatoFestivo({ festivo, grupos, mapUsuarios, responsable }) {
  const personas = personasDeGrupos(grupos, mapUsuarios);
  return {
    fecha: festivo.fecha, festivoNombre: festivo.nombre || "", area: textoArea(personas),
    responsable: responsable || "", fechaSolicitud: hoyIso(),
    personas, observaciones: "",
  };
}