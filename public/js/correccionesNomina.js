// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/public/js/correccionesNomina.js
// ##########################################################################
// Correcciones después de nómina (2026-11-20, pedido de Ivan).
// Caso: algo ya se mandó a nómina (enviadoANominaEn) y estaba mal — horas extra
// reportadas de más, o una falta con el tipo equivocado. Solo el admin corrige.
//   - abrirCorregirHoras(solicitud, actor): horario correcto o "no procedía".
//   - abrirCorregirFalta(falta, actor): tipo correcto o "no hubo falta". Con
//     { sinNomina: true } solo define el tipo (faltas viejas "POR DEFINIR" que
//     todavía no se mandan a nómina; ahí no hay nada que informar).
//   - iniciarSeccionCorrecciones(): en Reportes, lista lo corregido que falta
//     informar y el botón "Enviar corrección a nóminas" (correo con PDF por la
//     función segura enviarCorreccionNomina, mismos destinatarios del reporte
//     semanal). Lo que no se mande así sale solo en el reporte del jueves.
// Se conserva lo original: cada documento guarda `correcciones` (ver
// reportesHtml.js) y, en horas extra, una entrada en historialAjustes.

import { db } from "./firebase-config.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";
import { crearNotificacion } from "./notificaciones.js";
import { LOGO_ALANIS } from "./comercialLogo.js";
import {
  TIPOS_FALTA, etiquetaTipoFalta, tipoFaltaNormalizado, calcularSemanaLaboral, numeroSemanaISO, sumarDias,
  formatearHora12, formatearFechaLargaCap, correccionesPendientes, describirCorreccion
} from "./reportesHtml.js";

const URL_JSPDF = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
const URL_AUTOTABLE = "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js";
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const esc = (t) => { const d = document.createElement("div"); d.textContent = t == null ? "" : String(t); return d.innerHTML; };
const correoValido = (t) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(t || "").trim());
const listaCorreos = (txt) => String(txt || "").split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
const fechaLarga = (iso) => { const [y, m, d] = String(iso || "").split("-").map(Number); return y ? `${d} de ${MESES[m - 1]}` : ""; };

function cargarScript(url, global) {
  if (global && window[global]) return Promise.resolve(window[global]);
  return new Promise((ok, mal) => {
    const s = document.createElement("script");
    s.src = url; s.onload = () => ok(global ? window[global] : true); s.onerror = () => mal(new Error("No se pudo cargar " + url));
    document.head.appendChild(s);
  });
}

function calcularHoras(horaInicio, horaFin) {
  const [hi, mi] = String(horaInicio || "").split(":").map(Number);
  const [hf, mf] = String(horaFin || "").split(":").map(Number);
  if ([hi, hf].some(isNaN)) return 0;
  let diff = (hf * 60 + (mf || 0)) - (hi * 60 + (mi || 0));
  if (diff <= 0) diff += 24 * 60;
  return Math.round((diff / 60) * 100) / 100;
}

function estilosUnaVez() {
  if (document.getElementById("estilos-correcciones-nomina")) return;
  const s = document.createElement("style"); s.id = "estilos-correcciones-nomina";
  s.textContent = `
    .cn-res { background:#f7f3ee; border-radius:10px; padding:10px 12px; font-size:13px; margin:10px 0; }
    .cn-opc { display:flex; gap:8px; flex-wrap:wrap; margin-top:4px; }
    .cn-op { border:2px solid #e2ddd5; border-radius:10px; padding:8px 12px; font-weight:700; font-size:13px; background:#fff; color:#2c1e0f; cursor:pointer; }
    .cn-op.on { border-color:#2c1e0f; background:#f7f3ee; }
    .cn-dif { font-weight:800; color:#8a2318; }
    .cn-campo label { display:block; font-size:12px; color:#6b5f52; margin:10px 0 3px; }
    .cn-campo input, .cn-campo textarea { width:100%; box-sizing:border-box; }
    .cn-badge { display:inline-block; border-radius:10px; padding:1px 8px; font-size:11px; font-weight:700; white-space:nowrap; background:#F1E6FA; color:#6A3A9A; }
  `;
  document.head.appendChild(s);
}

// Chip para tablas: "Corregida después de nómina".
export function chipCorregida(registro) {
  const n = Array.isArray(registro && registro.correcciones) ? registro.correcciones.length : 0;
  if (!n) return "";
  estilosUnaVez();
  const ult = registro.correcciones[n - 1];
  return ` <span class="cn-badge" title="${esc(ult.motivo || "")}">Corregida después de nómina${ult.informadaEn ? "" : " · falta informar"}</span>`;
}

function modal(html) {
  estilosUnaVez();
  const ov = document.createElement("div");
  ov.className = "modal-overlay";
  ov.innerHTML = `<div class="modal-tarjeta cn-campo" style="max-width:560px;width:100%;max-height:92vh;overflow:auto;">${html}</div>`;
  document.body.appendChild(ov);
  const cerrar = () => ov.remove();
  ov.addEventListener("click", (e) => { if (e.target === ov) cerrar(); });
  return { ov, q: (s) => ov.querySelector(s), cerrar };
}

// ---------------------------------------------------------------------------
// Horas extra
// ---------------------------------------------------------------------------
export function abrirCorregirHoras(s, actor) {
  let modo = "horario";
  const { ov, q, cerrar } = modal(`
    <h2 style="margin:0 0 4px;">Corregir horas extra</h2>
    <p class="nota" style="margin:0;">${esc(s.empleadoNombre || "")} · ${esc(fechaLarga(s.fecha))}</p>
    <div class="cn-res">Se reportó a nómina: <b>${esc(s.horaInicio)}–${esc(s.horaFin)} · ${esc(s.horas)} h</b></div>
    <label>¿Qué debió ser?</label>
    <div class="cn-opc"><button type="button" class="cn-op on" data-m="horario">Otro horario</button><button type="button" class="cn-op" data-m="anular">No procedía (0 h)</button></div>
    <div id="cn-horario" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      <div><label>Entrada</label><input type="time" id="cn-ini" value="${esc(s.horaInicio)}"></div>
      <div><label>Salida</label><input type="time" id="cn-fin" value="${esc(s.horaFin)}"></div>
    </div>
    <label>Motivo de la corrección (obligatorio)</label>
    <textarea id="cn-motivo" rows="2" maxlength="300" placeholder="Ej. Reportó la jornada completa; las horas extra reales fueron de 1 a 7 pm."></textarea>
    <div class="cn-res" id="cn-queda"></div>
    <div class="error" id="cn-err"></div>
    <div class="modal-acciones"><button type="button" class="secundario" id="cn-cancelar">Cancelar</button><button type="button" id="cn-ok">Guardar corrección</button></div>`);
  const pintar = () => {
    const nuevas = modo === "anular" ? 0 : calcularHoras(q("#cn-ini").value, q("#cn-fin").value);
    const dif = Math.round((nuevas - (Number(s.horas) || 0)) * 100) / 100;
    q("#cn-horario").style.display = modo === "anular" ? "none" : "grid";
    q("#cn-queda").innerHTML = `Queda: <s>${esc(s.horas)} h</s> → <b>${nuevas} h</b> · Diferencia <span class="cn-dif">${dif === 0 ? "sin cambio" : dif < 0 ? `−${Math.abs(dif)} h a descontar` : `+${dif} h a pagar`}</span>`;
  };
  q("#cn-ini").addEventListener("input", pintar); q("#cn-fin").addEventListener("input", pintar);
  ov.querySelectorAll(".cn-op").forEach(b => b.addEventListener("click", () => {
    modo = b.dataset.m; b.parentElement.querySelectorAll(".cn-op").forEach(x => x.classList.toggle("on", x === b)); pintar();
  }));
  pintar();
  q("#cn-cancelar").addEventListener("click", cerrar);
  q("#cn-ok").addEventListener("click", async () => {
    const motivo = q("#cn-motivo").value.trim();
    const ini = q("#cn-ini").value, fin = q("#cn-fin").value;
    const err = (t) => { q("#cn-err").textContent = t; };
    if (!motivo) return err("Escribe el motivo de la corrección.");
    const horas = modo === "anular" ? 0 : calcularHoras(ini, fin);
    if (modo !== "anular" && (!ini || !fin || horas <= 0)) return err("Revisa la hora de entrada y salida.");
    if (modo !== "anular" && ini === s.horaInicio && fin === s.horaFin) return err("El horario es igual al que ya se reportó.");
    const ahora = new Date().toISOString();
    const antes = { horaInicio: s.horaInicio, horaFin: s.horaFin, horas: Number(s.horas) || 0, estatus: s.estatus };
    const despues = modo === "anular"
      ? { horaInicio: s.horaInicio, horaFin: s.horaFin, horas: 0, estatus: "rechazada" }
      : { horaInicio: ini, horaFin: fin, horas, estatus: "aprobada" };
    const correccion = {
      en: ahora, por: { uid: actor.uid, nombre: actor.nombre || "" }, motivo, antes, despues,
      semanaReportada: calcularSemanaLaboral(s.fecha), informadaEn: null, informadaPor: null, informadaVia: null
    };
    const historial = Array.isArray(s.historialAjustes) ? s.historialAjustes : [];
    const cambios = {
      correcciones: [...(Array.isArray(s.correcciones) ? s.correcciones : []), correccion],
      historialAjustes: [...historial, {
        tipo: "correccion", origen: "correccion",
        motivo: `${motivo} (se reportó ${antes.horaInicio}–${antes.horaFin}, ${antes.horas} h; queda ${modo === "anular" ? "0 h" : `${ini}–${fin}, ${horas} h`})`,
        estatusAnterior: s.estatus, comentarioRevisorAnterior: s.comentarioRevisor || null, revisadoPorNombreAnterior: s.revisadoPorNombre || null,
        resueltoPor: actor.uid, resueltoPorNombre: actor.nombre || null, timestamp: ahora
      }]
    };
    if (modo === "anular") {
      cambios.estatus = "rechazada";
      cambios.comentarioRevisor = `Anulada después de nómina: ${motivo}`;
    } else {
      Object.assign(cambios, { horaInicio: ini, horaFin: fin, horas });
    }
    q("#cn-ok").disabled = true;
    try {
      await updateDoc(doc(db, "solicitudes", s.id), cambios);
      crearNotificacion(s.empleadoId, {
        titulo: "Corrección de horas extra",
        mensaje: `Tu solicitud del ${s.fecha} se corrigió después de nómina: ${modo === "anular" ? "no procedía (0 h)" : `${ini}–${fin} (${horas} h)`}. Motivo: ${motivo}`,
        tipo: "correccion"
      });
      cerrar();
    } catch (x) { q("#cn-ok").disabled = false; err("No se pudo guardar: " + x.message); }
  });
}

// ---------------------------------------------------------------------------
// Faltas
// ---------------------------------------------------------------------------
export function abrirCorregirFalta(f, actor, { sinNomina = false } = {}) {
  const actual = tipoFaltaNormalizado(f.tipo);
  let elegido = actual === "por_definir" ? "" : actual;
  const opciones = [...TIPOS_FALTA.map(t => [t.value, t.label]), ...(sinNomina ? [] : [["no_hubo", "No hubo falta"]])];
  const { ov, q, cerrar } = modal(`
    <h2 style="margin:0 0 4px;">${sinNomina ? "Definir tipo de falta" : "Corregir falta"}</h2>
    <p class="nota" style="margin:0;">${esc(f.empleadoNombre || "")} · ${esc(fechaLarga(f.fecha))}</p>
    <div class="cn-res">${sinNomina ? "Tipo actual" : "Se reportó a nómina"}: <b>${esc(f.tipo === "justificada" ? "Justificada (no decía si se paga)" : etiquetaTipoFalta(f.tipo))}</b>${f.comentario ? `<br><small>${esc(f.comentario)}</small>` : ""}</div>
    <label>Tipo correcto</label>
    <div class="cn-opc">${opciones.map(([v, l]) => `<button type="button" class="cn-op${v === elegido ? " on" : ""}" data-v="${v}">${l}</button>`).join("")}</div>
    ${sinNomina ? "" : `<label>Motivo de la corrección (obligatorio)</label><textarea id="cn-motivo" rows="2" maxlength="300" placeholder="Ej. Se reportó como justificada; no se paga."></textarea>`}
    <div class="error" id="cn-err"></div>
    <div class="modal-acciones"><button type="button" class="secundario" id="cn-cancelar">Cancelar</button><button type="button" id="cn-ok">${sinNomina ? "Guardar" : "Guardar corrección"}</button></div>`);
  ov.querySelectorAll(".cn-op").forEach(b => b.addEventListener("click", () => {
    elegido = b.dataset.v; b.parentElement.querySelectorAll(".cn-op").forEach(x => x.classList.toggle("on", x === b));
  }));
  q("#cn-cancelar").addEventListener("click", cerrar);
  q("#cn-ok").addEventListener("click", async () => {
    const err = (t) => { q("#cn-err").textContent = t; };
    if (!elegido) return err("Elige el tipo correcto.");
    if (elegido === f.tipo) return err("Es el mismo tipo que ya tiene.");
    q("#cn-ok").disabled = true;
    try {
      if (sinNomina) {
        await updateDoc(doc(db, "faltas", f.id), { tipo: elegido, afectaPago: elegido === "sin_goce" });
        cerrar();
        return;
      }
      const motivo = q("#cn-motivo").value.trim();
      if (!motivo) { q("#cn-ok").disabled = false; return err("Escribe el motivo de la corrección."); }
      const ahora = new Date().toISOString();
      const antes = { tipo: f.tipo, estatus: f.estatus };
      const despues = elegido === "no_hubo" ? { tipo: f.tipo, estatus: "rechazada" } : { tipo: elegido, estatus: "aprobada" };
      const cambios = {
        correcciones: [...(Array.isArray(f.correcciones) ? f.correcciones : []), {
          en: ahora, por: { uid: actor.uid, nombre: actor.nombre || "" }, motivo, antes, despues,
          semanaReportada: calcularSemanaLaboral(f.fecha), informadaEn: null, informadaPor: null, informadaVia: null
        }]
      };
      if (elegido === "no_hubo") Object.assign(cambios, { estatus: "rechazada", comentario: `${f.comentario ? f.comentario + " · " : ""}Anulada después de nómina: ${motivo}` });
      else Object.assign(cambios, { tipo: elegido, afectaPago: elegido === "sin_goce" });
      await updateDoc(doc(db, "faltas", f.id), cambios);
      crearNotificacion(f.empleadoId, {
        titulo: "Corrección de falta",
        mensaje: `Tu falta del ${f.fecha} se corrigió después de nómina: ${elegido === "no_hubo" ? "no hubo falta" : etiquetaTipoFalta(elegido)}. Motivo: ${motivo}`,
        tipo: "correccion"
      });
      cerrar();
    } catch (x) { q("#cn-ok").disabled = false; err("No se pudo guardar: " + x.message); }
  });
}

// ---------------------------------------------------------------------------
// Reportes › Correcciones pendientes de informar + envío
// ---------------------------------------------------------------------------
// caja: elemento donde se dibuja. datos(): { listaHoras, listaFaltas, mapUsuarios }.
export function pintarSeccionCorrecciones(caja, datos) {
  if (!caja) return;
  estilosUnaVez();
  const { listaHoras, listaFaltas, mapUsuarios } = datos();
  const items = correccionesPendientes({ listaHoras, listaFaltas });
  if (!items.length) { caja.innerHTML = ""; return; }
  const filas = items.map(it => ({ it, d: describirCorreccion(it, mapUsuarios) }));
  caja.innerHTML = `
    <section class="panel" style="margin-top:20px;border:1.5px solid #6A3A9A;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
        <h2 style="margin:0;">⚠️ Correcciones pendientes de informar a nóminas (${items.length})</h2>
        <button type="button" id="cn-enviar">✉️ Enviar corrección a nóminas</button>
      </div>
      <div class="tabla-wrap" style="margin-top:8px;"><table class="tabla">
        <thead><tr><th>Empleado</th><th>Concepto</th><th>Fecha</th><th>Semana</th><th>Se reportó</th><th>Debe ser</th><th>Diferencia</th><th>Motivo</th></tr></thead>
        <tbody>${filas.map(({ d }) => `<tr><td>${esc(d.nombre)}</td><td>${d.concepto}</td><td>${esc(d.fechaCorta)}</td><td>${d.semana}</td>
          <td>${esc(d.antes)}</td><td${d.enRojo ? ` style="color:#a32424;font-weight:700;"` : ""}>${esc(d.despues)}</td>
          <td class="cn-dif"${d.enRojo ? "" : ` style="color:#3B7A1E;"`}>${esc(d.diferencia)}</td><td>${esc(d.motivo)}</td></tr>`).join("")}</tbody>
      </table></div>
      <p class="nota" style="margin:8px 0 0;">Si no las envías con el botón, salen solas en el reporte del jueves, en "Correcciones a reportes anteriores". Una vez informadas no se repiten.</p>
    </section>`;
  caja.querySelector("#cn-enviar").addEventListener("click", () => abrirEnvio(items, mapUsuarios));
}

function semanasDe(filas) {
  return [...new Set(filas.map(f => f.d.semana))].sort((a, b) => a - b);
}
const textoSemanas = (s) => s.length === 1 ? `Semana ${s[0]}` : `Semanas ${s.slice(0, -1).join(", ")} y ${s[s.length - 1]}`;

function mensajeDefault(filas, primerNombre, yo) {
  const sem = semanasDe(filas);
  const lineas = filas.map(({ d, it }, i) => {
    if (it.col === "solicitudes") {
      const a = it.c.antes || {}, n = it.c.despues || {};
      const h = (x) => x.horas > 0 ? `${x.horas} h (${formatearHora12(x.horaInicio)} a ${formatearHora12(x.horaFin)})` : "0 h (no procedía)";
      const dif = Math.round(((Number(n.horas) || 0) - (Number(a.horas) || 0)) * 100) / 100;
      return `${i + 1}. ${d.nombre} — horas extra del ${fechaLarga(d.fecha)}: se reportaron ${h(a)}; lo correcto son ${h(n)}. ${dif < 0 ? `Descontar ${Math.abs(dif)} h.` : dif > 0 ? `Pagar ${dif} h adicionales.` : ""}`.trim();
    }
    return `${i + 1}. ${d.nombre} — falta del ${fechaLarga(d.fecha)}: se reportó como ${it.c.antes && it.c.antes.tipo === "justificada" ? "Justificada" : d.antes}; lo correcto es ${d.despues} (${d.diferencia.toLowerCase()}).`;
  }).join("\n");
  return `${primerNombre ? primerNombre + ", buen día." : "Buen día."}\n\nPor medio del presente te comparto la corrección al reporte semanal de nómina de la ${textoSemanas(sem).toLowerCase()}, que ya se te había enviado:\n\n${lineas}\n\nAdjunto el formato con el detalle.\n\nQuedo a tus órdenes.\n\nUn saludo.\n\n${[yo.nombre, yo.puesto, "Autotransportes Alanis"].filter(Boolean).join("\n")}`;
}

async function abrirEnvio(items, mapUsuarios) {
  const filas = items.map(it => ({ it, d: describirCorreccion(it, mapUsuarios) }));
  const yoUid = (await import("https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js")).getAuth().currentUser?.uid;
  const yoDatos = (yoUid && mapUsuarios.get(yoUid)) || {};
  const yo = { nombre: yoDatos.nombre || "Ivan Landa", puesto: yoDatos.puesto || "" };
  let para = [], cc = [];
  try {
    const s = await getDoc(doc(db, "configuracion", "reporteSemanal"));
    if (s.exists()) { para = (s.data().destinatarios || []).filter(Boolean); cc = (s.data().cc || []).filter(Boolean); }
  } catch (x) { /* se capturan a mano */ }
  // Saludo con el nombre del primer destinatario si es un usuario de la app.
  const primero = [...mapUsuarios.values()].find(u => String(u.email || "").toLowerCase() === String(para[0] || "").toLowerCase());
  const primerNombre = primero && primero.nombre ? primero.nombre.split(/\s+/)[0] : "";
  const sem = semanasDe(filas);
  const { ov, q, cerrar } = modal(`
    <h2 style="margin:0 0 4px;">Enviar corrección a nóminas</h2>
    <p class="nota" style="margin:0;">${filas.length} corrección${filas.length === 1 ? "" : "es"} · ${textoSemanas(sem)} · sale de tu correo con el PDF adjunto.</p>
    <label>Para</label><input type="text" id="ce-para" value="${esc(para.join(", "))}">
    <label>CC</label><input type="text" id="ce-cc" value="${esc(cc.join(", "))}">
    <p class="nota" style="margin:4px 0 0;">Vienen de Configuración › RH › Reporte semanal de nómina. Lo que cambies aquí aplica solo a este envío.</p>
    <label>Asunto</label><input type="text" id="ce-asunto" value="${esc(`Corrección al reporte semanal de nómina — ${textoSemanas(sem)}`)}">
    <label>Mensaje</label><textarea id="ce-msg" rows="14">${esc(mensajeDefault(filas, primerNombre, yo))}</textarea>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;"><button type="button" class="secundario" id="ce-pdf">⬇️ Ver PDF</button></div>
    <div class="error" id="ce-err"></div>
    <div class="modal-acciones"><button type="button" class="secundario" id="ce-cancelar">Cancelar</button><button type="button" id="ce-ok">Enviar</button></div>`);
  const err = (t) => { q("#ce-err").textContent = t || ""; };
  q("#ce-cancelar").addEventListener("click", cerrar);
  q("#ce-pdf").addEventListener("click", async () => {
    try { (await generarPdf(filas, sem, yo)).descargar(); } catch (x) { err("No se pudo generar el PDF: " + x.message); }
  });
  q("#ce-ok").addEventListener("click", async () => {
    const p = listaCorreos(q("#ce-para").value), c = listaCorreos(q("#ce-cc").value).filter(x => !p.includes(x));
    const malos = [...p, ...c].filter(x => !correoValido(x));
    if (!p.length) return err("Escribe al menos un correo en Para.");
    if (malos.length) return err("Revisa estos correos: " + malos.join(", "));
    const asunto = q("#ce-asunto").value.trim(), mensaje = q("#ce-msg").value.trim();
    if (!asunto || !mensaje) return err("Escribe el asunto y el mensaje.");
    err();
    const b = q("#ce-ok"); b.disabled = true; b.textContent = "Enviando…";
    try {
      const pdf = await generarPdf(filas, sem, yo);
      const fn = httpsCallable(getFunctions(undefined, "us-central1"), "enviarCorreccionNomina");
      const r = await fn({
        para: p.map(x => ({ email: x })), cc: c.map(x => ({ email: x })), asunto, mensaje,
        pdfBase64: pdf.base64, nombreArchivo: pdf.nombre,
        items: filas.map(({ it }) => ({ col: it.col, id: it.id, en: it.c.en }))
      });
      cerrar();
      alert(`Corrección enviada a ${p.join(", ")}${r.data && r.data.remitente ? ` (salió de ${r.data.remitente})` : ""}.`);
    } catch (x) {
      b.disabled = false; b.textContent = "Enviar";
      err("No se pudo enviar: " + (x.message || x));
    }
  });
}

// PDF carta horizontal, mismo estilo del reporte de nómina.
async function generarPdf(filas, sem, yo) {
  const { jsPDF } = await cargarScript(URL_JSPDF, "jspdf");
  if (typeof jsPDF.API.autoTable !== "function") await cargarScript(URL_AUTOTABLE);
  const pdf = new jsPDF({ unit: "mm", format: "letter", orientation: "landscape" });
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), X0 = 12, X1 = W - 12;
  const altoLogo = 32 * LOGO_ALANIS.alto / LOGO_ALANIS.ancho;
  pdf.addImage(LOGO_ALANIS.datos, "JPEG", X0, 8, 32, altoLogo);
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(12.5); pdf.setTextColor(26, 26, 26);
  pdf.text(`CORRECCIÓN AL REPORTE SEMANAL DE NÓMINA · ${textoSemanas(sem).toUpperCase()}`, W / 2, 15, { align: "center" });
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(9);
  const rango = sem.map(n => { const f = filas.find(x => x.d.semana === n); const vie = (f && f.it.c.semanaReportada) || calcularSemanaLaboral(f.d.fecha); return `Semana ${n}: del ${formatearFechaLargaCap(vie)} al ${formatearFechaLargaCap(sumarDias(vie, 6))}`; }).join(" · ");
  pdf.text(rango, W / 2, 20.5, { align: "center" });
  pdf.setDrawColor(26, 26, 26); pdf.setLineWidth(0.5); pdf.line(X0, 10 + altoLogo, X1, 10 + altoLogo);
  pdf.autoTable({
    startY: 14 + altoLogo,
    head: [["No. Emp.", "Nombre", "Concepto", "Fecha", "Semana", "Se reportó", "Debe ser", "Diferencia", "Motivo"]],
    body: filas.map(({ d }) => [d.numeroEmpleado, d.nombre, d.concepto, d.fechaCorta, d.semana, d.antes, d.despues, d.diferencia, d.motivo]),
    styles: { fontSize: 8.5, cellPadding: 2, lineColor: [26, 26, 26], lineWidth: 0.2, textColor: [26, 26, 26] },
    headStyles: { fillColor: [247, 248, 250], textColor: [26, 26, 26], fontStyle: "bold", halign: "center" },
    columnStyles: { 0: { halign: "center", cellWidth: 16 }, 3: { halign: "center", cellWidth: 18 }, 4: { halign: "center", cellWidth: 16 }, 8: { cellWidth: 60 } },
    didParseCell: (h) => { if (h.section === "body" && (h.column.index === 6 || h.column.index === 7) && filas[h.row.index].d.enRojo) { h.cell.styles.textColor = [163, 36, 36]; h.cell.styles.fontStyle = "bold"; } },
    margin: { left: X0, right: 12 }
  });
  let y = pdf.lastAutoTable.finalY + 24;
  if (y > H - 30) { pdf.addPage(); y = 40; }
  pdf.setDrawColor(150, 150, 150); pdf.setLineWidth(0.3);
  pdf.line(X0 + 20, y, X0 + 100, y); pdf.line(X1 - 100, y, X1 - 20, y);
  pdf.setFontSize(9); pdf.setFont("helvetica", "normal");
  pdf.text(yo.nombre || "Ivan Landa", X0 + 60, y + 4, { align: "center" }); pdf.text("Autorización", X0 + 60, y + 8, { align: "center" });
  pdf.text("Firma del Depto. de Nóminas", X1 - 60, y + 4, { align: "center" }); pdf.text("Revisión", X1 - 60, y + 8, { align: "center" });
  const ahora = new Date();
  pdf.setFont("helvetica", "bold"); pdf.text("AUTOTRANSPORTES ALANIS, S.A. DE C.V.", W / 2, H - 8, { align: "center" });
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(7.5); pdf.setTextColor(110, 110, 110);
  pdf.text(`Generado el ${ahora.getDate()} de ${MESES[ahora.getMonth()]} de ${ahora.getFullYear()}, ${formatearHora12(`${ahora.getHours()}:${String(ahora.getMinutes()).padStart(2, "0")}`)}`, X1, H - 8, { align: "right" });
  const nombre = `correccion_${textoSemanas(sem).toLowerCase().replace(/[^a-z0-9]+/g, "_")}.pdf`;
  return { nombre, base64: pdf.output("datauristring").split(",")[1], descargar: () => pdf.save(nombre) };
}