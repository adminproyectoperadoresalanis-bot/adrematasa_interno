// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/public/js/formatoFestivo.js
// ##########################################################################
// ATAF104 — piezas de pantalla (2026-11-18, versión final de Ivan).
// La hoja del formato se arma en reportesHtml.js (construirPaginaAtaf104), la
// misma que usan la vista previa de Reportes y el correo automático
// (automatizacion/generar-y-enviar-ataf104.mjs, 2 días hábiles antes del
// festivo a las 9:00 am). Aquí solo queda:
//   - puedeUsarAtaf104(): solo quien autoriza ve el ATAF104 en Reportes.
//   - iniciarConfigFestivo(): Configuración › 1 · RH › destinatarios (Para/CC).
//   - abrirObservacionesAtaf104(): "Observaciones adicionales" de un festivo.
// Datos en configuracion/ataf104 (configuracion: lectura con sesión, escritura
// solo admin — no se tocan reglas):
//   destinatarios: { para: [correos], cc: [correos] }
//   observaciones: { "<fecha>": "texto" }
// El envío lo anota el workflow en configuracion/ataf104Estado { "<fecha>": { enviadoEn, ... } }.

import { db } from "./firebase-config.js";
import {
  doc, getDoc, setDoc, updateDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { CORREO_AUTORIZA_ATAF104 } from "./reportesHtml.js";

export const REF_CFG_FESTIVO = () => doc(db, "configuracion", "ataf104");
export const REF_ESTADO_FESTIVO = () => doc(db, "configuracion", "ataf104Estado");

export function puedeUsarAtaf104() {
  const u = getAuth().currentUser;
  return !!(u && String(u.email || "").toLowerCase() === CORREO_AUTORIZA_ATAF104);
}

const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const correoValido = (t) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(t || "").trim());
const listaCorreos = (txt) => String(txt || "").split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
const destinatariosDe = (cfg) => {
  const d = (cfg && cfg.destinatarios) || {};
  return { para: Array.isArray(d.para) ? d.para : [], cc: Array.isArray(d.cc) ? d.cc : [] };
};

// Configuración › 1 · RH › "Formato día festivo ATAF104 (correo)" — igual que
// "Reporte semanal de nómina" (lo llama configuracion.js).
export function iniciarConfigFestivo(cuerpo, resumen) {
  cuerpo.innerHTML = `
    <p class="nota">
      El formato ATAF104 (personal que labora en día festivo) se manda <strong>solo</strong>, 2 días hábiles antes de
      cada festivo a las 9:00 am (hora de Nuevo Laredo), con las solicitudes de horas extra aprobadas a esa hora. Un día
      hábil antes te llega aviso. Aquí defines a quién llega. Separa varios correos con comas.
    </p>
    <div id="ffc-error" class="error"></div>
    <p id="ffc-exito" class="nota oculto" style="color:#1c7a41;"></p>
    <div>
      <label for="ffc-para" style="display:block; font-weight:600; margin-bottom:4px;">Destinatarios (Para)</label>
      <input type="text" id="ffc-para" style="width:100%;" placeholder="nominas@alanis.com.mx">
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
      ? `2 días hábiles antes, 9:00 am · ${d.para.length} destinatario${d.para.length === 1 ? "" : "s"}${d.cc.length ? ` + ${d.cc.length} CC` : ""}`
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
      // updateDoc reemplaza "destinatarios" completo sin tocar las observaciones.
      const actual = await getDoc(REF_CFG_FESTIVO());
      const datos = { destinatarios: { para, cc }, actualizadoEn: new Date().toISOString() };
      if (actual.exists()) await updateDoc(REF_CFG_FESTIVO(), datos);
      else await setDoc(REF_CFG_FESTIVO(), datos);
      ok.textContent = "Guardado. Se usa en el próximo envío del ATAF104.";
      ok.classList.remove("oculto");
    } catch (x) { e.textContent = "No se pudo guardar: " + x.message; }
  });
}

// Observaciones adicionales (sección 3) de un festivo.
export function abrirObservacionesAtaf104({ fecha, nombre, texto }) {
  const ov = document.createElement("div");
  ov.className = "modal-overlay";
  ov.innerHTML = `<div class="modal-tarjeta" style="max-width:560px;width:100%;">
    <h2 style="margin:0 0 4px;">Observaciones · ATAF104</h2>
    <p class="nota" style="margin:0 0 10px;">${esc(nombre || "")} (${esc(fecha.split("-").reverse().join("/"))}). Salen en la sección 3 del formato.</p>
    <textarea id="obs-ataf" rows="4" maxlength="600" style="width:100%;box-sizing:border-box;" placeholder="Opcional">${esc(texto || "")}</textarea>
    <div class="error" id="obs-err"></div>
    <div class="modal-acciones"><button type="button" class="secundario" id="obs-cancelar">Cancelar</button><button type="button" id="obs-guardar">Guardar</button></div></div>`;
  document.body.appendChild(ov);
  const cerrar = () => ov.remove();
  ov.querySelector("#obs-cancelar").addEventListener("click", cerrar);
  ov.addEventListener("click", (e) => { if (e.target === ov) cerrar(); });
  ov.querySelector("#obs-guardar").addEventListener("click", async () => {
    try {
      await setDoc(REF_CFG_FESTIVO(), { observaciones: { [fecha]: ov.querySelector("#obs-ataf").value.trim() } }, { merge: true });
      cerrar();
    } catch (x) { ov.querySelector("#obs-err").textContent = "No se pudo guardar: " + x.message; }
  });
}