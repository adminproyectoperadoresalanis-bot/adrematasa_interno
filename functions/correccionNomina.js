// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/functions/correccionNomina.js
// ##########################################################################
// Correcciones después de nómina (2026-11-20, pedido de Ivan).
// enviarCorreccionNomina (callable): manda a nóminas el correo con la
// corrección (PDF armado en el navegador) por Brevo, con el mismo secreto que
// los demás correos (BREVO_API_KEY). La clave nunca llega al navegador.
// Quién: solo admin activo.
// Remitente: su correo @alanis.com.mx; si Brevo no lo acepta, sale del
// verificado (ilanda@alanis.com.mx) con "Responder a" = quien envía.
// Al enviar: marca cada corrección como informada (informadaEn) para que no se
// repita en el reporte del jueves.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const REGION = "us-central1";
const REMITENTE_RESPALDO = { name: "Ivan Landa", email: "ilanda@alanis.com.mx" };
const MAX_DESTINATARIOS = 15;
const MAX_PDF_BYTES = 3 * 1024 * 1024;
const COLECCIONES = ["solicitudes", "faltas"];
const brevoApiKeyCorreccion = defineSecret("BREVO_API_KEY");
const VERSION = "2026-11-20a";

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

exports.enviarCorreccionNomina = onCall({ region: REGION, secrets: [brevoApiKeyCorreccion] }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const db = getFirestore();
  const snapU = await db.collection("usuarios").doc(request.auth.uid).get();
  const u = snapU.exists ? snapU.data() : null;
  if (!u || u.estatus !== "activo" || u.rol !== "admin") {
    throw new HttpsError("permission-denied", "Solo el administrador puede enviar correcciones a nómina.");
  }
  const correoActor = String(u.email || request.auth.token.email || "").trim().toLowerCase();
  const nombreActor = u.nombre || correoActor;

  const e = request.data || {};
  const para = listaDirecciones(e.para);
  const vistos = new Set(para.map((d) => d.email));
  const cc = listaDirecciones(e.cc).filter((d) => !vistos.has(d.email) && vistos.add(d.email));
  if (!para.length) throw new HttpsError("invalid-argument", "Falta al menos un destinatario válido.");
  if (para.length + cc.length > MAX_DESTINATARIOS) throw new HttpsError("invalid-argument", `Máximo ${MAX_DESTINATARIOS} destinatarios.`);
  const asunto = txt(e.asunto, 200) || "Corrección al reporte semanal de nómina";
  const mensaje = txt(e.mensaje, 8000);
  if (!mensaje) throw new HttpsError("invalid-argument", "Falta el mensaje.");
  const pdf = typeof e.pdfBase64 === "string" ? e.pdfBase64.replace(/\s/g, "") : "";
  if (!pdf || !/^[A-Za-z0-9+/=]+$/.test(pdf) || pdf.length * 0.75 > MAX_PDF_BYTES) {
    throw new HttpsError("invalid-argument", "El PDF no llegó bien.");
  }
  const nombreArchivo = (txt(e.nombreArchivo, 120) || "correccion_nomina.pdf").replace(/[^A-Za-z0-9_.-]/g, "_");
  const items = (Array.isArray(e.items) ? e.items : [])
    .map((x) => ({ col: txt(x && x.col, 30), id: txt(x && x.id, 120), en: txt(x && x.en, 40) }))
    .filter((x) => COLECCIONES.includes(x.col) && x.id && x.en);
  if (!items.length) throw new HttpsError("invalid-argument", "No hay correcciones que informar.");

  const propio = correoActor.endsWith("@alanis.com.mx") ? { name: nombreActor, email: correoActor } : null;
  const base = {
    to: para, cc: cc.length ? cc : undefined,
    bcc: correoValido(correoActor) && !vistos.has(correoActor) ? [{ email: correoActor, name: nombreActor }] : undefined,
    replyTo: correoValido(correoActor) ? { email: correoActor, name: nombreActor } : undefined,
    subject: asunto,
    textContent: mensaje,
    htmlContent: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f1a14;">${escHtml(mensaje).replace(/\n/g, "<br>")}</div>`,
    attachment: [{ name: nombreArchivo, content: pdf }],
  };

  const clave = brevoApiKeyCorreccion.value();
  let remitente = propio || REMITENTE_RESPALDO;
  let r = await enviarBrevo(clave, { ...base, sender: remitente });
  if (!r.ok && propio && propio.email !== REMITENTE_RESPALDO.email && /sender/i.test(JSON.stringify(r.datos))) {
    logger.warn("enviarCorreccionNomina: remitente no aceptado, uso el de respaldo", { remitente: propio.email, detalle: r.datos });
    remitente = REMITENTE_RESPALDO;
    r = await enviarBrevo(clave, { ...base, sender: remitente });
  }
  if (!r.ok) {
    logger.error("enviarCorreccionNomina: Brevo rechazó el envío", { version: VERSION, status: r.status, detalle: r.datos });
    throw new HttpsError("internal", `El servicio de correo rechazó el envío (${r.status}). ${txt(r.datos && r.datos.message, 200)} [v ${VERSION}]`);
  }

  // Marcar como informadas (el correo ya salió; si esto falla, se ve en el log).
  const ahora = new Date().toISOString();
  const porDoc = new Map();
  items.forEach((x) => {
    const k = `${x.col}/${x.id}`;
    if (!porDoc.has(k)) porDoc.set(k, { col: x.col, id: x.id, ens: new Set() });
    porDoc.get(k).ens.add(x.en);
  });
  let marcadas = 0;
  for (const { col, id, ens } of porDoc.values()) {
    try {
      await db.runTransaction(async (tx) => {
        const ref = db.collection(col).doc(id);
        const s = await tx.get(ref);
        if (!s.exists) return;
        const lista = Array.isArray(s.data().correcciones) ? s.data().correcciones : [];
        const nueva = lista.map((c) => {
          if (c && ens.has(c.en) && !c.informadaEn) { marcadas++; return { ...c, informadaEn: ahora, informadaVia: "correo", informadaPor: { uid: request.auth.uid, nombre: nombreActor } }; }
          return c;
        });
        tx.update(ref, { correcciones: nueva });
      });
    } catch (err) {
      logger.error("enviarCorreccionNomina: el correo salió pero no se pudo marcar", { col, id, error: err.message });
    }
  }
  logger.info("enviarCorreccionNomina: enviada", { para: para.map((d) => d.email), cc: cc.map((d) => d.email), marcadas, remitente: remitente.email });
  return { ok: true, remitente: remitente.email, marcadas };
});