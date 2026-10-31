// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/functions/comercialCorreo.js
// ##########################################################################
// Comercial (2026-10-30, pedido de Ivan). enviarCotizacionComercial (callable):
// manda una cotización por correo con su PDF adjunto, por Brevo, con el MISMO
// secreto que el reporte de nómina (BREVO_API_KEY). La clave nunca llega al
// navegador: el navegador solo manda folio, destinatarios, asunto, mensaje y
// el PDF que ya armó (jsPDF).
//
// Quién: usuario activo con la opción Comercial (o admin), dueño de la
// cotización (o admin).
// Remitente: el correo @alanis.com.mx de quien envía. Si Brevo no acepta ese
// remitente (no verificado), se manda desde ilanda@alanis.com.mx (verificado,
// el mismo de nómina) con "Responder a" = quien envía.
// Al enviar: agrega el envío a cot.envios y, si estaba en borrador, la pasa a
// "enviada".

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const REGION = "us-central1";
const ID_OPCION = "comercial";
const COL_COT = "com_cotizaciones";
const REMITENTE_RESPALDO = { name: "Ivan Landa", email: "ilanda@alanis.com.mx" };
const MAX_DESTINATARIOS = 10;
const MAX_PDF_BYTES = 3 * 1024 * 1024;
const brevoApiKeyComercial = defineSecret("BREVO_API_KEY");
const VERSION = "2026-10-30c"; // sale en los mensajes de error y en el log, para saber qué versión está publicada

const txt = (v, max) => (typeof v === "string" ? v.trim().slice(0, max || 200) : "");
const correoValido = (t) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
const escHtml = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function leerActor(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const db = getFirestore();
  const snap = await db.collection("usuarios").doc(request.auth.uid).get();
  const u = snap.exists ? snap.data() : null;
  if (!u || u.estatus !== "activo" || !["admin", "supervisor", "empleado"].includes(u.rol)) {
    throw new HttpsError("permission-denied", "Tu cuenta no está activa.");
  }
  if (u.rol !== "admin") {
    const acc = await db.collection("configuracion").doc("accesosUtilidades").get();
    if (acc.exists) {
      const lista = (acc.data().porArea || {})[u.area || ""];
      if (!Array.isArray(lista) || !lista.includes(ID_OPCION)) {
        throw new HttpsError("permission-denied", "Tu área no tiene acceso a Comercial.");
      }
    }
  }
  const correo = String(u.email || request.auth.token.email || "").trim().toLowerCase();
  return { uid: request.auth.uid, nombre: u.nombre || "", rol: u.rol, correo };
}

// Brevo exige "name" en cada destinatario ("name is missing in to"): si el
// contacto no tiene nombre, se usa el mismo correo.
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

exports.enviarCotizacionComercial = onCall({ region: REGION, secrets: [brevoApiKeyComercial] }, async (request) => {
  const actor = await leerActor(request);
  const e = request.data || {};
  const folio = txt(e.folio, 40);
  if (!folio) throw new HttpsError("invalid-argument", "Falta el folio.");

  const db = getFirestore();
  const ref = db.collection(COL_COT).doc(folio);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", `No existe la cotización ${folio}.`);
  const cot = snap.data();
  if (actor.rol !== "admin" && cot.creadoPorUid !== actor.uid) {
    throw new HttpsError("permission-denied", "Solo quien hizo la cotización (o un admin) puede enviarla.");
  }

  const para = listaDirecciones(e.para);
  const vistos = new Set(para.map((d) => d.email));
  const cc = listaDirecciones(e.cc).filter((d) => !vistos.has(d.email) && vistos.add(d.email));
  if (!para.length) throw new HttpsError("invalid-argument", "Falta al menos un destinatario válido.");
  if (para.length + cc.length > MAX_DESTINATARIOS) throw new HttpsError("invalid-argument", `Máximo ${MAX_DESTINATARIOS} destinatarios.`);
  const asunto = txt(e.asunto, 200) || `Cotización ${folio} · Autotransportes Alanis`;
  const mensaje = txt(e.mensaje, 5000);
  if (!mensaje) throw new HttpsError("invalid-argument", "Falta el mensaje.");
  const pdf = typeof e.pdfBase64 === "string" ? e.pdfBase64.replace(/\s/g, "") : "";
  if (!pdf || !/^[A-Za-z0-9+/=]+$/.test(pdf) || pdf.length * 0.75 > MAX_PDF_BYTES) {
    throw new HttpsError("invalid-argument", "El PDF no llegó bien.");
  }

  const propio = actor.correo.endsWith("@alanis.com.mx") ? { name: actor.nombre || actor.correo, email: actor.correo } : null;
  const bcc = e.copiaParaMi && correoValido(actor.correo) && !vistos.has(actor.correo) ? [{ email: actor.correo, name: actor.nombre || actor.correo }] : undefined;
  const base = {
    to: para, cc: cc.length ? cc : undefined, bcc,
    replyTo: correoValido(actor.correo) ? { email: actor.correo, name: actor.nombre || actor.correo } : undefined,
    subject: asunto,
    textContent: mensaje,
    htmlContent: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f1a14;">${escHtml(mensaje).replace(/\n/g, "<br>")}</div>`,
    attachment: [{ name: `${folio}.pdf`, content: pdf }],
  };

  const clave = brevoApiKeyComercial.value();
  let remitente = propio || REMITENTE_RESPALDO;
  let r = await enviarBrevo(clave, { ...base, sender: remitente });
  if (!r.ok && propio && propio.email !== REMITENTE_RESPALDO.email && /sender/i.test(JSON.stringify(r.datos))) {
    // Remitente no verificado en Brevo: sale del verificado, con respuesta a quien envía.
    logger.warn("enviarCotizacionComercial: remitente no aceptado, uso el de respaldo", { remitente: propio.email, detalle: r.datos });
    remitente = REMITENTE_RESPALDO;
    r = await enviarBrevo(clave, { ...base, sender: remitente });
  }
  if (!r.ok) {
    logger.error("enviarCotizacionComercial: Brevo rechazó el envío", { version: VERSION, folio, status: r.status, detalle: r.datos, to: base.to, cc: base.cc });
    throw new HttpsError("internal", `El servicio de correo rechazó el envío (${r.status}). ${txt(r.datos && r.datos.message, 200)} [v ${VERSION}]`);
  }

  const envio = {
    ms: Date.now(), canal: "correo", remitente: remitente.email,
    para: para.map((d) => d.email), cc: cc.map((d) => d.email),
    por: { uid: actor.uid, nombre: actor.nombre }, messageId: txt(r.datos && r.datos.messageId, 200),
  };
  const cambios = { envios: FieldValue.arrayUnion(envio), actualizadoMs: Date.now() };
  if (cot.estado === "borrador") cambios.estado = "enviada";
  await ref.update(cambios);
  logger.info("enviarCotizacionComercial: enviada", { folio, para: envio.para, cc: envio.cc, remitente: remitente.email });
  return { ok: true, remitente: remitente.email, estado: cambios.estado || cot.estado };
});