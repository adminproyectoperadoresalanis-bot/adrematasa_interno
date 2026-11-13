// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/functions/avisosPushAdrematasa.js
// ##########################################################################
// Avisos push en el celular (2026-11-13, pedido de Ivan). Mismo esquema que
// ya funciona en Alanis Operadores (functions/avisosPush.js de allá):
// - registrarDispositivoAvisos (callable): guarda el token del celular en
//   avisos_dispositivos/{hash del token}. Solo el servidor escribe ahí (el
//   navegador no tiene acceso: no hace falta regla nueva).
// - avisoPrueba (callable): aviso de prueba a los celulares del propio usuario.
// - pushDesdeCampanita (trigger): cada aviso nuevo de la campanita
//   (notificaciones/{id}) también sale como push al celular de su
//   destinatario. Así cubre, con la MISMA lógica de "a quién" que ya usa la
//   app: solicitudes nuevas de horas extra y vacaciones (al supervisor, o a
//   los admin si no tiene), solicitudes de ajuste, y aprobada / rechazada /
//   adelanto (al empleado).
// - pushMcCain (trigger): embarque McCain nuevo o corregido en
//   embarques_pendientes_origen → push a Atención al cliente (decisión de
//   Ivan: solo esa área, 24 h). Respeta el acceso por área a "Validación de
//   QR". Cada embarque avisa una sola vez como nuevo y una vez por cada
//   corrección (avisos_mccain_enviados evita repetir si el documento se
//   reescribe).
// Los tokens que Firebase reporta como inválidos se borran solos.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const crypto = require("crypto");

const REGION = "us-central1";
const COL = "avisos_dispositivos";
const COL_MCCAIN = "avisos_mccain_enviados";
const SITIO = "https://adrematasainterno.web.app";
const ICONO = SITIO + "/img/logo-alanis.png";
const AREA_ATENCION_CLIENTE = "Atención al cliente";

const idDe = (token) => crypto.createHash("sha256").update(token).digest("hex").slice(0, 40);
const corto = (t, n) => { const s = String(t == null ? "" : t).trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

// Manda a todos los celulares registrados de esos uid.
async function enviarAUids(uids, titulo, cuerpo, link) {
  const db = getFirestore();
  const lista = [...new Set((uids || []).filter(Boolean))];
  if (!lista.length) return { dispositivos: 0, enviados: 0, fallidos: 0 };
  const docs = [];
  for (let i = 0; i < lista.length; i += 30) {
    const snap = await db.collection(COL).where("uid", "in", lista.slice(i, i + 30)).get();
    docs.push(...snap.docs);
  }
  if (!docs.length) return { dispositivos: 0, enviados: 0, fallidos: 0 };

  let enviados = 0, fallidos = 0;
  const borrar = [];
  for (let i = 0; i < docs.length; i += 500) {
    const grupo = docs.slice(i, i + 500);
    const r = await getMessaging().sendEachForMulticast({
      tokens: grupo.map(d => d.get("token")),
      webpush: {
        notification: { title: corto(titulo, 80), body: corto(cuerpo, 240), icon: ICONO },
        fcmOptions: { link: link || SITIO + "/" },
      },
    });
    enviados += r.successCount; fallidos += r.failureCount;
    r.responses.forEach((x, k) => {
      if (x.success) return;
      const code = (x.error && x.error.code) || "";
      if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
        borrar.push(grupo[k].ref.delete());
      } else {
        console.warn("[avisos] fallo", grupo[k].get("uid"), code, x.error && x.error.message);
      }
    });
  }
  await Promise.all(borrar);
  return { dispositivos: docs.length, enviados, fallidos };
}

exports.registrarDispositivoAvisos = onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Inicia sesión.");
  const datos = req.data || {};
  const token = String(datos.token || "");
  if (token.length < 20 || token.length > 4096) throw new HttpsError("invalid-argument", "Token inválido.");
  const plataforma = ["ios", "android", "otro"].includes(datos.plataforma) ? datos.plataforma : "otro";
  await getFirestore().collection(COL).doc(idDe(token)).set({
    uid: req.auth.uid,
    correo: req.auth.token.email || "",
    token,
    plataforma,
    instalada: !!datos.instalada,
    actualizadoMs: Date.now(),
  }, { merge: true });
  return { ok: true };
});

exports.avisoPrueba = onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Inicia sesión.");
  return enviarAUids([req.auth.uid], "Prueba de avisos · Adrematasa",
    "Si ves este mensaje, los avisos ya funcionan en este celular.");
});

// ---- Campanita → push ----------------------------------------------------
exports.pushDesdeCampanita = onDocumentCreated({ document: "notificaciones/{id}", region: REGION }, async (event) => {
  const n = (event.data && event.data.data()) || {};
  if (!n.destinatarioId) return;
  const titulo = n.titulo || "Adrematasa Interno";
  const cuerpo = [n.mensaje, n.fechaEvento].filter(Boolean).join(" · ") || "Abre la app para ver el detalle.";
  const r = await enviarAUids([n.destinatarioId], titulo, cuerpo, SITIO + "/");
  console.log("[avisos] campanita", event.params.id, n.tipo || "", JSON.stringify(r));
});

// ---- McCain → push a Atención al cliente ----------------------------------
async function uidsAtencionCliente() {
  const db = getFirestore();
  const [snap, acc] = await Promise.all([
    db.collection("usuarios").where("area", "==", AREA_ATENCION_CLIENTE).get(),
    db.collection("configuracion").doc("accesosUtilidades").get(),
  ]);
  // Mismo criterio que firestore.rules (tieneAccesoUtilidad): sin la tabla guardada, todos; con ella, solo si el área tiene la opción.
  const porArea = acc.exists ? (acc.get("porArea") || {}) : null;
  const areaConQR = !porArea || (porArea[AREA_ATENCION_CLIENTE] || []).includes("validacionQR");
  return snap.docs.filter(d => d.get("estatus") === "activo" && (areaConQR || d.get("rol") === "admin")).map(d => d.id);
}

// Regresa true solo la primera vez para esa clave (transacción: no se repite aunque el documento se reescriba).
async function primeraVez(clave, datos) {
  const db = getFirestore();
  const ref = db.collection(COL_MCCAIN).doc(clave);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (s.exists) return false;
    tx.set(ref, { ...datos, enviadoMs: Date.now() });
    return true;
  });
}

exports.pushMcCain = onDocumentWritten({ document: "embarques_pendientes_origen/{id}", region: REGION }, async (event) => {
  const antes = event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
  const despues = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
  if (!despues) return; // se borró: nada que avisar
  const id = event.params.id;
  const nombre = despues.shipment || despues.ocCliente || id;
  const cliente = despues.clienteNombre || "McCain";
  const caja = despues.caja || despues.correccionCajaNueva || "";

  let titulo = null, cuerpo = "", clave = null;
  const cajaCambio = antes && (antes.caja || "") !== (despues.caja || "") && (despues.caja || despues.correccionCajaNueva);
  const postNueva = !!despues.correccionPostValidacion && !(antes && antes.correccionPostValidacion);

  if (!antes) {
    titulo = "Nuevo embarque McCain";
    cuerpo = `Embarque ${nombre} · ${cliente}${caja ? " · caja " + caja : ""}${despues.fechaEntrega ? " · entrega " + despues.fechaEntrega : ""}. Pendiente de 1ra validación.`;
    clave = `${id}__nuevo`;
  } else if (postNueva || cajaCambio) {
    const anterior = despues.correccionCajaAnterior || (antes && antes.caja) || "";
    titulo = postNueva ? "Corrección McCain: re-validar" : "Corrección de McCain";
    cuerpo = `Embarque ${nombre} · ${cliente}${anterior && caja && anterior !== caja ? ` · caja ${anterior} → ${caja}` : (caja ? " · caja " + caja : "")}.`
      + (postNueva ? " Ya estaba validado: hay que volver a validarlo." : " Revisa antes de validar.");
    clave = `${id}__corr__${crypto.createHash("sha256").update(String(caja) + "|" + String(postNueva)).digest("hex").slice(0, 16)}`;
  } else {
    return;
  }

  if (!(await primeraVez(clave, { embarqueId: id, titulo }))) return;
  const uids = await uidsAtencionCliente();
  const r = await enviarAUids(uids, titulo, cuerpo, SITIO + "/");
  console.log("[avisos] mccain", id, titulo, uids.length, JSON.stringify(r));
});