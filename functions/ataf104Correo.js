// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/functions/ataf104Correo.js
// ##########################################################################
// ATAF104 — Planeación de personal a laborar en día festivo (2026-11-18).
// enviarAtaf104 (callable): manda el formato de un festivo por correo (un solo
// correo por festivo con todas las áreas, igual que el reporte de nómina)
// con el PDF adjunto, por Brevo, con el MISMO secreto que nómina y Comercial
// (BREVO_API_KEY). La clave nunca llega al navegador: el navegador manda
// destinatarios, asunto, mensaje y el PDF que ya armó (jsPDF).
//
// Quién: solo quien autoriza (AUTORIZA_ATAF104), con rol admin y cuenta activa.
// Remitente: su correo @alanis.com.mx; si Brevo no lo acepta, sale del
// verificado (ilanda@alanis.com.mx) con "Responder a" = quien envía.
// Al enviar: agrega el envío a configuracion/ataf104.envios["<fecha>"].

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const REGION = "us-central1";
const AUTORIZA_ATAF104 = ["ilanda@alanis.com.mx"]; // igual que public/js/ataf104.js
const REMITENTE_RESPALDO = { name: "Ivan Landa", email: "ilanda@alanis.com.mx" };
const MAX_DESTINATARIOS = 15;
const MAX_PDF_BYTES = 3 * 1024 * 1024;
const brevoApiKeyAtaf104 = defineSecret("BREVO_API_KEY");
const VERSION = "2026-11-18b";

const txt = (v, max) => (typeof v === "string" ? v.trim().slice(0, max || 200) : "");
const correoValido = (t) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
const escHtml = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function listaDirecciones(v) {
  return (Array.isArray(v) ? v : []).map((d) => {
    const email = txt(d && d.email, 120).toLowerCase();
    return { email, name: txt(d && d.nombre, 80) || email };
  }).filter((d) => correoValido(d.email));
}

async function enviarBrevo(clave, cuerpo) {
  const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": clave, "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  const texto = await resp.text();
  let datos = {};
  try { datos = texto ? JSON.parse(texto) : {}; } catch (e) { datos = { message: texto }; }
  return { ok: resp.ok, status: resp.status, datos };
}

exports.enviarAtaf104 = onCall({ region: REGION, secrets: [brevoApiKeyAtaf104] }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const db = getFirestore();
  const snapU = await db.collection("usuarios").doc(request.auth.uid).get();
  const u = snapU.exists ? snapU.data() : null;
  const correoActor = String((u && u.email) || request.auth.token.email || "").trim().toLowerCase();
  if (!u || u.estatus !== "activo" || u.rol !== "admin" || !AUTORIZA_ATAF104.includes(correoActor)) {
    throw new HttpsError("permission-denied", "Solo quien autoriza puede enviar el formato ATAF104.");
  }

  const e = request.data || {};
  const fecha = txt(e.fecha, 10);
  const area = txt(e.area, 80); // "Operaciones MEX" o "Varias (3 áreas)", solo informativo
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new HttpsError("invalid-argument", "Falta la fecha del festivo.");

  const para = listaDirecciones(e.para);
  const vistos = new Set(para.map((d) => d.email));
  const cc = listaDirecciones(e.cc).filter((d) => !vistos.has(d.email) && vistos.add(d.email));
  if (!para.length) throw new HttpsError("invalid-argument", "Falta al menos un destinatario válido.");
  if (para.length + cc.length > MAX_DESTINATARIOS) throw new HttpsError("invalid-argument", `Máximo ${MAX_DESTINATARIOS} destinatarios.`);
  const asunto = txt(e.asunto, 200) || `ATAF104 · Personal a laborar día festivo ${fecha}`;
  const mensaje = txt(e.mensaje, 6000);
  if (!mensaje) throw new HttpsError("invalid-argument", "Falta el mensaje.");
  const pdf = typeof e.pdfBase64 === "string" ? e.pdfBase64.replace(/\s/g, "") : "";
  if (!pdf || !/^[A-Za-z0-9+/=]+$/.test(pdf) || pdf.length * 0.75 > MAX_PDF_BYTES) {
    throw new HttpsError("invalid-argument", "El PDF no llegó bien.");
  }
  const nombreArchivo = (txt(e.nombreArchivo, 120) || `ATAF104_${fecha}.pdf`).replace(/[^A-Za-z0-9_.-]/g, "_");

  const nombreActor = u.nombre || correoActor;
  const propio = correoActor.endsWith("@alanis.com.mx") ? { name: nombreActor, email: correoActor } : null;
  const bcc = e.copiaParaMi && correoValido(correoActor) && !vistos.has(correoActor) ? [{ email: correoActor, name: nombreActor }] : undefined;
  const base = {
    to: para, cc: cc.length ? cc : undefined, bcc,
    replyTo: correoValido(correoActor) ? { email: correoActor, name: nombreActor } : undefined,
    subject: asunto,
    textContent: mensaje,
    htmlContent: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f1a14;">${escHtml(mensaje).replace(/\n/g, "<br>")}</div>`,
    attachment: [{ name: nombreArchivo, content: pdf }],
  };

  const clave = brevoApiKeyAtaf104.value();
  let remitente = propio || REMITENTE_RESPALDO;
  let r = await enviarBrevo(clave, { ...base, sender: remitente });
  if (!r.ok && propio && propio.email !== REMITENTE_RESPALDO.email && /sender/i.test(JSON.stringify(r.datos))) {
    logger.warn("enviarAtaf104: remitente no aceptado, uso el de respaldo", { remitente: propio.email, detalle: r.datos });
    remitente = REMITENTE_RESPALDO;
    r = await enviarBrevo(clave, { ...base, sender: remitente });
  }
  if (!r.ok) {
    logger.error("enviarAtaf104: Brevo rechazó el envío", { version: VERSION, fecha, area, status: r.status, detalle: r.datos });
    throw new HttpsError("internal", `El servicio de correo rechazó el envío (${r.status}). ${txt(r.datos && r.datos.message, 200)} [v ${VERSION}]`);
  }

  const envio = {
    ms: Date.now(), remitente: remitente.email,
    para: para.map((d) => d.email), cc: cc.map((d) => d.email),
    personas: Number(e.personas) || 0, festivoNombre: txt(e.festivoNombre, 80), area,
    por: { uid: request.auth.uid, nombre: nombreActor }, messageId: txt(r.datos && r.datos.messageId, 200),
  };
  await db.collection("configuracion").doc("ataf104").set(
    { envios: { [fecha]: FieldValue.arrayUnion(envio) } }, { merge: true });
  logger.info("enviarAtaf104: enviado", { fecha, area, para: envio.para, cc: envio.cc, personas: envio.personas });
  return { ok: true, remitente: remitente.email };
});