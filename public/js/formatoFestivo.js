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
//
// 2026-11-20: "Actividades por puesto" (tarjeta nueva en Configuración › RH,
// justo debajo de la del ATAF104; la crea iniciarConfigFestivo, así que
// configuracion.js no cambia). Datos en configuracion/actividadesPuesto:
//   lista: [{ area, puesto, actividades }]
// Es lo que sale en la sección 2 del ATAF104 y lo que ve el empleado al pedir
// horas extra en festivo. Al abrirse también refresca
// configuracion/directorioEmpleados (lista para "Cubrir falta de"; la mantiene
// la función actualizarDirectorioEmpleados, esto sirve como carga inicial).

import { db } from "./firebase-config.js";
import {
  doc, getDoc, setDoc, updateDoc, onSnapshot, collection, getDocs
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { CORREO_AUTORIZA_ATAF104, areaExcluidaHorasExtra, actividadesDePuesto } from "./reportesHtml.js";
import { AREAS_DEFAULT } from "./estructuraOrganizacional.js";

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
  crearTarjetaActividades(cuerpo);
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

// ---- Actividades por puesto (2026-11-20) -------------------------------------
const ICONO_ACTIVIDADES = `<svg class="cfg-icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;
function crearTarjetaActividades(cuerpoFestivo) {
  if (document.getElementById("cfg-actividades-puesto")) return;
  const tarjetaFestivo = cuerpoFestivo.closest("details");
  const nueva = document.createElement(tarjetaFestivo ? "details" : "div");
  nueva.id = "cfg-actividades-puesto";
  if (tarjetaFestivo) nueva.className = tarjetaFestivo.className;
  nueva.innerHTML = tarjetaFestivo
    ? `<summary>${ICONO_ACTIVIDADES}<span class="cfg-titulos"><span class="cfg-titulo">Actividades por puesto (día festivo)</span><span class="cfg-resumen" id="act-resumen"></span></span><span class="cfg-chevron" aria-hidden="true">›</span></summary><div class="cfg-cuerpo" id="act-cuerpo"></div>`
    : `<h3 style="margin-top:20px;">Actividades por puesto (día festivo)</h3><div id="act-resumen" class="nota"></div><div id="act-cuerpo"></div>`;
  if (tarjetaFestivo) tarjetaFestivo.after(nueva); else cuerpoFestivo.after(nueva);
  iniciarActividadesPuesto(nueva.querySelector("#act-cuerpo"), nueva.querySelector("#act-resumen"));
}

const REF_ACTIVIDADES = () => doc(db, "configuracion", "actividadesPuesto");
const normal = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function iniciarActividadesPuesto(cuerpo, resumen) {
  cuerpo.innerHTML = `
    <p class="nota">
      Lo que hace cada puesto en un día festivo. Sale en la sección 2 del formato ATAF104 de cada persona
      aprobada y el empleado lo ve al pedir sus horas extra (ya no lo escribe). Los puestos salen de
      "Áreas y puestos"; Gerencia, Dirección y No especificado no aparecen.
    </p>
    <div id="act-error" class="error"></div>
    <p id="act-exito" class="nota oculto" style="color:#1c7a41;"></p>
    <div id="act-lista">Cargando…</div>
    <div class="acciones-form" style="margin-top:14px;"><button type="button" id="act-guardar">Guardar actividades</button></div>`;
  const caja = cuerpo.querySelector("#act-lista");
  const err = cuerpo.querySelector("#act-error"), ok = cuerpo.querySelector("#act-exito");
  let grupos = [];   // [{ area, puestos: [{ puesto, empleados }] }]
  let guardadas = []; // configuracion/actividadesPuesto.lista
  let cargado = { estructura: false, usuarios: false, actividades: false };

  function pintar() {
    if (!cargado.estructura || !cargado.usuarios || !cargado.actividades) return;
    // Conserva lo que se esté escribiendo si llega un cambio de Firestore.
    const escrito = new Map([...caja.querySelectorAll("textarea[data-area]")].map(x => [`${normal(x.dataset.area)}|${normal(x.dataset.puesto)}`, x.value]));
    let sinActividades = 0;
    caja.innerHTML = grupos.length ? grupos.map(g => `
      <div style="border:1px solid #e6dfd5;border-radius:12px;margin-bottom:12px;overflow:hidden;">
        <div style="padding:9px 14px;background:#faf7f3;font-weight:700;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <span>${esc(g.area)}</span><span style="font-weight:400;font-size:12.5px;color:#6b5f52;">${g.puestos.length} puesto${g.puestos.length === 1 ? "" : "s"} · ${g.puestos.reduce((s, p) => s + p.empleados, 0)} empleados</span>
        </div>
        ${g.puestos.map(p => {
          const clave = `${normal(g.area)}|${normal(p.puesto)}`;
          const valor = escrito.has(clave) ? escrito.get(clave) : actividadesDePuesto(guardadas, g.area, p.puesto);
          if (!valor.trim()) sinActividades++;
          return `<div style="display:flex;gap:12px;padding:10px 14px;border-top:1px solid #f1ece5;flex-wrap:wrap;">
            <div style="flex:0 0 220px;font-weight:600;font-size:14px;">${esc(p.puesto)}<div style="font-weight:400;color:#6b5f52;font-size:12px;">${p.empleados} empleado${p.empleados === 1 ? "" : "s"}</div></div>
            <textarea rows="2" maxlength="400" data-area="${esc(g.area)}" data-puesto="${esc(p.puesto)}" placeholder="Sin actividades capturadas…" style="flex:1;min-width:220px;box-sizing:border-box;${valor.trim() ? "" : "border-color:#F3C2BC;background:#FFF8F7;"}">${esc(valor)}</textarea>
          </div>`;
        }).join("")}
      </div>`).join("") : `<p class="nota">No hay puestos en "Áreas y puestos".</p>`;
    if (resumen) resumen.textContent = sinActividades ? `${sinActividades} puesto${sinActividades === 1 ? "" : "s"} sin actividades` : "Todos los puestos con actividades";
  }

  // Áreas y puestos (catálogo) + combinaciones reales de los empleados activos.
  let areasCatalogo = [], usuarios = [];
  function armarGrupos() {
    const mapa = new Map(); // areaNorm -> { area, puestos: Map(puestoNorm -> { puesto, empleados }) }
    const agregar = (area, puesto) => {
      if (!area || !puesto || areaExcluidaHorasExtra(area)) return null;
      const ka = normal(area), kp = normal(puesto);
      if (!mapa.has(ka)) mapa.set(ka, { area, puestos: new Map() });
      const g = mapa.get(ka);
      if (!g.puestos.has(kp)) g.puestos.set(kp, { puesto, empleados: 0 });
      return g.puestos.get(kp);
    };
    areasCatalogo.forEach(a => (a && Array.isArray(a.puestos) ? a.puestos : []).forEach(p => agregar(a.nombre, p)));
    usuarios.filter(u => u.estatus === "activo").forEach(u => { const x = agregar(u.area, u.puesto); if (x) x.empleados++; });
    grupos = [...mapa.values()].map(g => ({ area: g.area, puestos: [...g.puestos.values()].sort((a, b) => a.puesto.localeCompare(b.puesto, "es")) }))
      .sort((a, b) => a.area.localeCompare(b.area, "es"));
  }

  getDoc(doc(db, "configuracion", "estructura")).then(s => {
    areasCatalogo = (s.exists() && Array.isArray(s.data().areas)) ? s.data().areas : AREAS_DEFAULT;
    cargado.estructura = true; armarGrupos(); pintar();
  }).catch(x => { err.textContent = "No se pudo cargar Áreas y puestos: " + x.message; });

  getDocs(collection(db, "usuarios")).then(async (snap) => {
    usuarios = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    cargado.usuarios = true; armarGrupos(); pintar();
    // Carga inicial / refresco del directorio para "Cubrir falta de".
    const lista = usuarios.filter(u => u.estatus === "activo" && u.nombre)
      .map(u => ({ uid: u.uid, nombre: String(u.nombre || ""), area: String(u.area || ""), puesto: String(u.puesto || "") }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    try {
      const ref = doc(db, "configuracion", "directorioEmpleados");
      const actual = await getDoc(ref);
      const antes = actual.exists() && Array.isArray(actual.data().lista) ? actual.data().lista : null;
      if (!antes || JSON.stringify(antes) !== JSON.stringify(lista)) await setDoc(ref, { lista, actualizadoEn: new Date().toISOString() });
    } catch (x) { console.warn("No se pudo refrescar el directorio de empleados:", x); }
  }).catch(x => { err.textContent = "No se pudieron cargar los empleados: " + x.message; });

  onSnapshot(REF_ACTIVIDADES(), (s) => {
    guardadas = s.exists() && Array.isArray(s.data().lista) ? s.data().lista : [];
    cargado.actividades = true; pintar();
  }, (x) => { err.textContent = "No se pudieron cargar las actividades: " + x.message; });

  cuerpo.querySelector("#act-guardar").addEventListener("click", async () => {
    err.textContent = ""; ok.classList.add("oculto");
    const nuevas = [...caja.querySelectorAll("textarea[data-area]")]
      .map(x => ({ area: x.dataset.area, puesto: x.dataset.puesto, actividades: x.value.trim() }))
      .filter(x => x.actividades);
    // Conserva actividades guardadas de puestos que hoy no se muestran (ej. sin empleados ni catálogo).
    const mostradas = new Set([...caja.querySelectorAll("textarea[data-area]")].map(x => `${normal(x.dataset.area)}|${normal(x.dataset.puesto)}`));
    const conservar = guardadas.filter(g => g && !mostradas.has(`${normal(g.area)}|${normal(g.puesto)}`));
    try {
      await setDoc(REF_ACTIVIDADES(), { lista: [...nuevas, ...conservar], actualizadoEn: new Date().toISOString() });
      ok.textContent = "Guardado. Se usa en el próximo ATAF104 y en las solicitudes de festivo.";
      ok.classList.remove("oculto");
    } catch (x) { err.textContent = "No se pudo guardar: " + x.message; }
  });
}