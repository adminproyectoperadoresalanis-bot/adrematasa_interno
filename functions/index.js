// ============================================================================
// QR/CFDI — Cloud Functions 2da gen desplegadas en appadrematasainterno.
//
// Reemplaza, del lado de ADREMATASA Interno, a Codigo.gs (Apps Script):
//   - sincronizarOrigenNuevos_   → exports.sincronizarOrigenNuevos
//   - procesarSolicitudesBorradoPrueba_ → exports.procesarSolicitudBorradoPrueba
//
// Traducido campo por campo desde Codigo.gs (leído el 2026-09-10) para
// mantener el comportamiento idéntico, ahora disparado por escritura real
// en vez de un escaneo periódico cada 5 minutos.
//
// FUERA DE ALCANCE A PROPÓSITO (instrucción de Ivan, 2026-09-10):
//   - El mecanismo de alertas por correo/ntfy.sh (notificarErroresConsolidado_)
//     no se reconstruye aquí por ahora. Los errores de estas funciones quedan
//     en los logs de Cloud Functions (Google Cloud Console → Logging), y una
//     excepción sin capturar hace que Cloud Functions reintente automáticamente
//     si el trigger se configuró con reintentos (ver README de despliegue).
//
// Codigo.gs (Apps Script) SIGUE CORRIENDO EN PARALELO como respaldo durante
// la migración — no lo desactives hasta confirmar que esto funciona en
// producción.
// ============================================================================

const { onDocumentWritten, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { randomBytes, createHash } = require("crypto");
const { getAuth } = require("firebase-admin/auth");
const https = require("https");
const logger = require("firebase-functions/logger");
// Checkpoint 2 (Pre Entrega) validado por Operaciones en nombre del operador
// (2026-10-08). El archivo vive junto a este index.js, dentro de functions/.
const { ejecutarValidacionRemota, ErrorValidacion, COL_BITACORA: COL_BITACORA_VALIDACIONES_REMOTAS } = require("./validacionRemotaPreEntrega");

const REGION = "us-central1";

initializeApp();
const dbLocal = getFirestore();

const alanisApp = initializeApp(
  { credential: applicationDefault(), projectId: "alanis-operadores" },
  "alanis"
);
const dbAlanis = getFirestore(alanisApp);

const COLECCION_LOCAL = "verificaciones_cfdi_local";
const COLECCION_REPO = "repositorio_mccain";
const COLECCION_PENDIENTES = "embarques_pendientes_origen";
const COLECCION_SOLICITUDES_BORRADO = "solicitudes_borrado_prueba";
const COLECCION_SOLICITUDES_REINICIO = "solicitudes_reinicio_flujo";
const COLECCION_HISTORIAL_REINICIOS = "historial_reinicios_flujo";
const COLECCION_QR_INTERNOS = "qr_internos_generados";
const COLECCION_ENLACES_CHECKPOINT = "enlaces_checkpoint";            // vive en alanis-operadores
const COLECCION_HISTORIAL_ENLACES = "historial_enlaces_checkpoint";   // bitácora en este proyecto
const COLECCION_SOLICITUDES_ENLACE = "solicitudes_enlace_checkpoint"; // solicitud/autorización del enlace (este proyecto)
const CHECKPOINTS_ENLACE = ["recepcion", "pre_entrega"];

// Al reiniciar el flujo o borrar un embarque de prueba: borra sus solicitudes
// de enlace y revoca los enlaces que sigan vivos (en alanis-operadores), para
// que una autorización o un enlace viejo no sobreviva a un embarque "nuevo".
// Nunca debe tumbar la operación principal: quien lo llama lo envuelve.
async function limpiarEnlacesYSolicitudes_(embarqueId) {
  await Promise.all(CHECKPOINTS_ENLACE.map(c =>
    dbLocal.collection(COLECCION_SOLICITUDES_ENLACE).doc(`${embarqueId}__${c}`).delete()
  ));
  const previos = await dbAlanis.collection(COLECCION_ENLACES_CHECKPOINT)
    .where("embarqueId", "==", embarqueId).get();
  const vivos = previos.docs.filter(x => x.data().usado !== true && x.data().revocado !== true);
  if (vivos.length > 0) {
    const lote = dbAlanis.batch();
    vivos.forEach(x => lote.update(x.ref, {
      revocado: true,
      revocadoEn: FieldValue.serverTimestamp(),
      revocadoPor: "sistema:flujo-reiniciado-o-borrado",
    }));
    await lote.commit();
  }
}

const brevoApiKey = defineSecret("BREVO_API_KEY");

// ============================================================================
// 1) verificaciones_cfdi_local (LOCAL) —estadoSync:'pendiente'→
//    repositorio_mccain (ALANIS)
// ============================================================================
exports.sincronizarOrigenNuevos = onDocumentWritten(
  { document: `${COLECCION_LOCAL}/{embarqueId}`, region: REGION },
  async (event) => {
    const after = event.data.after;
    if (!after || !after.exists) return;

    const data = after.data();
    if (data.estadoSync !== "pendiente") return;
    if (!data.origenEscaneo) return;

    const embarqueId = event.params.embarqueId;

    const paraAlanis = {
      uuidEsperado: data.uuidEsperado ?? null,
      receptorRFCEsperado: data.receptorRFCEsperado ?? null,
      origenEscaneo: data.origenEscaneo,
    };
    if (data.validacion2) paraAlanis.validacion2 = data.validacion2;
    if (data.operadorAsignado) paraAlanis.operadorAsignado = data.operadorAsignado;

    try {
      await dbAlanis.collection(COLECCION_REPO).doc(embarqueId).set(paraAlanis, { merge: true });
      await dbLocal.collection(COLECCION_LOCAL).doc(embarqueId).update({ estadoSync: "sincronizado" });
    } catch (error) {
      logger.error(`[sincronizarOrigenNuevos] embarqueId ${embarqueId}: ${error.message}`, error);
      try {
        await dbLocal.collection(COLECCION_LOCAL).doc(embarqueId).update({ estadoSync: "error" });
      } catch (errorSecundario) {
        logger.error(`[sincronizarOrigenNuevos] no se pudo marcar estadoSync:'error' en ${embarqueId}: ${errorSecundario.message}`);
      }
      throw error;
    }
  }
);

// ============================================================================
// 5) Borrado de prueba — TEMPORAL
// ============================================================================
exports.procesarSolicitudBorradoPrueba = onDocumentCreated(
  { document: `${COLECCION_SOLICITUDES_BORRADO}/{embarqueId}`, region: REGION },
  async (event) => {
    const embarqueId = event.params.embarqueId;
    try {
      await dbAlanis.collection(COLECCION_REPO).doc(embarqueId).delete();
      await dbLocal.collection(COLECCION_LOCAL).doc(embarqueId).delete();
      await dbLocal.collection(COLECCION_PENDIENTES).doc(embarqueId).delete();
      try { await limpiarEnlacesYSolicitudes_(embarqueId); }
      catch (e) { logger.warn(`[procesarSolicitudBorradoPrueba] no se pudieron limpiar enlaces/solicitudes de ${embarqueId}: ${e.message}`); }
    } catch (error) {
      logger.error(`[procesarSolicitudBorradoPrueba] embarqueId ${embarqueId}: ${error.message}`, error);
    } finally {
      try {
        await dbLocal.collection(COLECCION_SOLICITUDES_BORRADO).doc(embarqueId).delete();
      } catch (errorFinal) {
        logger.error(`[procesarSolicitudBorradoPrueba] no se pudo borrar la solicitud ${embarqueId}: ${errorFinal.message}`);
      }
    }
  }
);

// ============================================================================
// 6) Reiniciar flujo — SOLO ADMIN (2026-09-14)
// ============================================================================
const CAMPOS_AVANCE_REPO_A_BORRAR = [
  "receptorRFCEsperado",
  "origenEscaneo",
  "validacion2",
  "operadorAsignado",
  "estatusValidacion",
  "discrepanciaDetalle",
  "recepcionOperador",
];
exports.procesarSolicitudReinicioFlujo = onDocumentCreated(
  { document: `${COLECCION_SOLICITUDES_REINICIO}/{embarqueId}`, region: REGION },
  async (event) => {
    const embarqueId = event.params.embarqueId;
    const solicitud = event.data.data();
    try {
      const snapLocal = await dbLocal.collection(COLECCION_LOCAL).doc(embarqueId).get();
      if (snapLocal.exists) {
        const datosPrevios = snapLocal.data();
        await dbLocal.collection(COLECCION_HISTORIAL_REINICIOS).add({
          embarqueId,
          reiniciadoPor: solicitud.solicitadoPor,
          timestamp: solicitud.timestamp,
          valorAnterior: {
            uuidEsperado: datosPrevios.uuidEsperado ?? null,
            receptorRFCEsperado: datosPrevios.receptorRFCEsperado ?? null,
            origenEscaneo: datosPrevios.origenEscaneo ?? null,
            validacion2: datosPrevios.validacion2 ?? null,
            operadorAsignado: datosPrevios.operadorAsignado ?? null,
            estadoSync: datosPrevios.estadoSync ?? null,
          },
        });
      }

      const snapRepo = await dbAlanis.collection(COLECCION_REPO).doc(embarqueId).get();
      if (snapRepo.exists) {
        const limpieza = { uuidEsperado: "" };
        CAMPOS_AVANCE_REPO_A_BORRAR.forEach((campo) => {
          limpieza[campo] = FieldValue.delete();
        });
        await dbAlanis.collection(COLECCION_REPO).doc(embarqueId).update(limpieza);
      } else {
        logger.warn(
          `[procesarSolicitudReinicioFlujo] repositorio_mccain/${embarqueId} ya no existe — no hay identidad de embarque que limpiar/republicar. El embarque no va a reaparecer solo en embarques_pendientes_origen.`
        );
      }

      await dbLocal.collection(COLECCION_LOCAL).doc(embarqueId).delete();

      // FIX 2026-09-30 (Ivan): "Reiniciar flujo" nunca borraba el QR interno
      // generado (qr_internos_generados es create-only). Si un embarque sin
      // factura ya tenía un QR generado antes del reinicio, ese documento
      // sobrevivía y bloqueaba a "Asignar operador y generar QR (sin
      // factura)" con "Missing or insufficient permissions" — Firestore lo
      // trataba como update (solo permite cambiar operadorNombre) en vez de
      // create. .delete() en un doc que no existe no truena, así que es
      // seguro llamarlo siempre, aunque el embarque haya sido con factura
      // real y nunca haya tenido QR interno.
      await dbLocal.collection(COLECCION_QR_INTERNOS).doc(embarqueId).delete();

      // Una autorización o un enlace de respaldo de ANTES del reinicio no
      // debe valer para el embarque "nuevo" (2026-10-08).
      try { await limpiarEnlacesYSolicitudes_(embarqueId); }
      catch (e) { logger.warn(`[procesarSolicitudReinicioFlujo] no se pudieron limpiar enlaces/solicitudes de ${embarqueId}: ${e.message}`); }
    } catch (error) {
      logger.error(`[procesarSolicitudReinicioFlujo] embarqueId ${embarqueId}: ${error.message}`, error);
    } finally {
      try {
        await dbLocal.collection(COLECCION_SOLICITUDES_REINICIO).doc(embarqueId).delete();
      } catch (errorFinal) {
        logger.error(`[procesarSolicitudReinicioFlujo] no se pudo borrar la solicitud ${embarqueId}: ${errorFinal.message}`);
      }
    }
  }
);

// ============================================================================
// 7) Recuperar contraseña — genera link con Admin SDK y lo manda por Brevo.
//    Se llama desde el cliente vía httpsCallable. Solo acepta @alanis.com.mx.
// ============================================================================
exports.enviarResetContrasena = onCall(
  { region: REGION, secrets: [brevoApiKey] },
  async (request) => {
    const email = (request.data.email || "").trim().toLowerCase();

    if (!email.endsWith("@alanis.com.mx")) {
      throw new HttpsError("invalid-argument", "Solo se permiten correos @alanis.com.mx.");
    }

    let link;
    try {
      link = await getAuth().generatePasswordResetLink(email);
    } catch (error) {
      logger.warn(`[enviarResetContrasena] generatePasswordResetLink falló para ${email}: ${error.code}`);
      return { ok: true };
    }

    const cuerpo = JSON.stringify({
      sender: { name: "Ivan Landa", email: "ilanda@alanis.com.mx" },
      to: [{ email }],
      subject: "Restablecer contraseña — App Alanis",
      htmlContent: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
          <p>Hola,</p>
          <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta en la app interna de Alanis.</p>
          <p style="margin:24px 0">
            <a href="${link}"
               style="background:#2c1e0f;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">
              Restablecer contraseña
            </a>
          </p>
          <p style="color:#666;font-size:13px">
            Este enlace expira en 1 hora. Si no solicitaste este cambio, ignora este correo —
            tu contraseña actual sigue siendo la misma.
          </p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
          <p style="color:#999;font-size:12px">Autotransportes Alanis — uso interno</p>
        </div>
      `,
    });

    await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: "api.brevo.com",
          path: "/v3/smtp/email",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "api-key": brevoApiKey.value(),
          },
        },
        (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => reject(new Error(`Brevo ${res.statusCode}: ${body}`)));
          }
        }
      );
      req.on("error", reject);
      req.write(cuerpo);
      req.end();
    });

    logger.info(`[enviarResetContrasena] correo de restablecimiento enviado a ${email}`);
    return { ok: true };
  }
);

// ============================================================================
// 8) Enlace de respaldo para el Checkpoint 1 (2026-10-06, pedido de Ivan).
//
//    Cuando el operador no puede escanear (ni con la foto del QR), Operaciones
//    o un admin generan aquí un enlace de un solo uso. Lo manda por WhatsApp y
//    el operador hace el Checkpoint 1 sin escanear. Quien CONSUME el enlace es
//    consumirEnlaceCheckpoint, en alanis-operadores (otro chat/otra pieza).
//
//    Por qué vive aquí y no en alanis-operadores: quien lo genera es usuario de
//    ESTE proyecto (Auth y rol/área/puesto están en usuarios/{uid} de aquí), y
//    estas funciones ya escriben en alanis-operadores con la cuenta de
//    servicio (dbAlanis) — no hace falta validar tokens de otro proyecto ni
//    compartir ningún secreto.
//
//    (2026-10-08) El enlace de pre_entrega YA NO SE GENERA: Alanis Operadores no
//    lo acepta ("checkpoint_distinto"). Solo sigue vigente el de "recepcion";
//    el Checkpoint 2 sin escanear es validarPreEntregaRemota (sección 9).
//
//    Cubre los DOS checkpoints (ampliado 2026-10-06, pedido de Ivan: "si no
//    pudo escanear el 1, tampoco va a poder el 2"): "recepcion" (Checkpoint 1,
//    Despacho) y "pre_entrega" (Checkpoint 2). El 2 es la última barrera antes
//    de entregar al cliente, así que exige además confirmacionManual: true
//    (queda en la bitácora) y que el Checkpoint 1 ya esté en COINCIDE.
//
//    AUTORIZACIÓN (2026-10-08, pedido de Ivan: "que no se use
//    indiscriminadamente"): Operaciones ya no genera el enlace por su cuenta.
//    Primero SOLICITA uno (solicitudes_enlace_checkpoint/{embarque}__{cp},
//    escrito desde el navegador con reglas) y un ADMIN lo autoriza. La
//    autorización dura 12 h desde que se resuelve y permite regenerar el
//    enlace dentro de esa ventana (p. ej. si el operador lo pierde). Un admin
//    puede generarlo directo sin solicitud; queda registrado como
//    "admin_directo". Esta función es quien lo hace cumplir de verdad (el
//    botón de la pantalla es solo comodidad).
//
//    Contrato (acordado con el chat de Alanis Operadores):
//      entrada : { embarqueId, checkpoint?: "recepcion" | "pre_entrega",
//                  confirmacionManual?: true }   — por defecto "recepcion";
//                confirmacionManual solo se pide a un admin que genera el
//                Checkpoint 2 directo (sin solicitud autorizada);
//                todo lo demás se lee de repositorio_mccain
//      registro: enlaces_checkpoint/{sha256(codigo)} en alanis-operadores,
//                con reglas "denegar todo" (solo Admin SDK lo toca).
//      salida  : { ok, enlace, venceEnMs, operadorNombre, operadorNumero, embarqueId, checkpoint }
//    El código (32 bytes aleatorios, base64url) solo existe en esta respuesta.
// ============================================================================
const VIGENCIA_ENLACE_CHECKPOINT_HORAS = 12;
const URL_ENLACE_CHECKPOINT = "https://alanis-operadores.web.app/operador.html";
const AREA_OPERACIONES_MEX = "Operaciones MEX";
const PUESTOS_VALIDADOR2 = ["Coordinador", "Supervisor", "Auxiliar", "Despachador"];

exports.generarEnlaceCheckpoint = onCall(
  { region: REGION },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Inicia sesión para generar el enlace.");
    }
    const uid = request.auth.uid;

    // Mismo criterio que esValidador2() en firestore.rules: usuario activo y
    // (admin, o área Operaciones MEX con uno de los 4 puestos).
    const snapUsuario = await dbLocal.collection("usuarios").doc(uid).get();
    const u = snapUsuario.exists ? snapUsuario.data() : null;
    const activo = !!u && u.estatus === "activo" && ["admin", "supervisor", "empleado"].includes(u.rol);
    const autorizado = activo && (
      u.rol === "admin" ||
      (u.area === AREA_OPERACIONES_MEX && PUESTOS_VALIDADOR2.includes(u.puesto))
    );
    if (!autorizado) {
      throw new HttpsError("permission-denied", "Solo Operaciones o un administrador pueden generar este enlace.");
    }

    const embarqueId = request.data && typeof request.data.embarqueId === "string" ? request.data.embarqueId.trim() : "";
    if (!embarqueId || embarqueId.includes("/")) {
      throw new HttpsError("invalid-argument", "Falta el embarque.");
    }
    const checkpoint = request.data && request.data.checkpoint !== undefined ? request.data.checkpoint : "recepcion";
    if (checkpoint !== "recepcion" && checkpoint !== "pre_entrega") {
      throw new HttpsError("invalid-argument", "Checkpoint no válido.");
    }
    // 2026-10-08: Alanis Operadores no acepta enlaces de pre_entrega (los
    // rechaza con "checkpoint_distinto") y ya no se usan: el Checkpoint 2
    // sin escanear se resuelve con validarPreEntregaRemota. Los de
    // "recepcion" siguen igual.
    if (checkpoint === "pre_entrega") {
      throw new HttpsError("failed-precondition", "Los enlaces del Checkpoint 2 ya no se usan. Usa la validación remota.");
    }
    const confirmacionManual = !!(request.data && request.data.confirmacionManual === true);
    const esAdminUsuario = u.rol === "admin";

    try {
      // La fuente de verdad es repositorio_mccain (alanis-operadores), no lo
      // que mande el navegador: de ahí salen el operador y las condiciones.
      const snapEmbarque = await dbAlanis.collection(COLECCION_REPO).doc(embarqueId).get();
      if (!snapEmbarque.exists) {
        throw new HttpsError("not-found", "El embarque no existe en Alanis Operadores.");
      }
      const d = snapEmbarque.data();
      const operador = d.operadorAsignado || null;
      if (!operador || !operador.uid) {
        throw new HttpsError("failed-precondition", "El embarque no tiene operador asignado.");
      }
      if (!d.uuidEsperado) {
        throw new HttpsError("failed-precondition", "El embarque todavía no tiene la factura validada (sin UUID esperado).");
      }
      if (d.estatusValidacion === "VALIDADO" || d.estatusValidacion === "DISCREPANCIA") {
        throw new HttpsError("failed-precondition", "El embarque ya terminó su flujo; no necesita enlace.");
      }
      const resultadoCp1 = d.recepcionOperador && d.recepcionOperador.resultado;
      if (checkpoint === "recepcion" && resultadoCp1) {
        throw new HttpsError("failed-precondition", "El operador ya hizo el Checkpoint 1 de este embarque.");
      }
      // Mismo orden que impone la app del operador: el Checkpoint 2 solo se
      // habilita con el Checkpoint 1 en COINCIDE.
      if (checkpoint === "pre_entrega" && resultadoCp1 !== "COINCIDE") {
        throw new HttpsError("failed-precondition", "El Checkpoint 2 solo se puede habilitar cuando el Checkpoint 1 ya está en COINCIDE.");
      }

      // ---- Autorización (2026-10-08) ----
      const idSolicitud = `${embarqueId}__${checkpoint}`;
      const refSolicitud = dbLocal.collection(COLECCION_SOLICITUDES_ENLACE).doc(idSolicitud);
      const snapSolicitud = await refSolicitud.get();
      const sol = snapSolicitud.exists ? snapSolicitud.data() : null;
      const resueltoEnMs = sol && sol.resueltoEn && typeof sol.resueltoEn.toMillis === "function" ? sol.resueltoEn.toMillis() : 0;
      const vigenciaMs = VIGENCIA_ENLACE_CHECKPOINT_HORAS * 60 * 60 * 1000;
      const mismoOperador = !!sol && sol.operadorUid === operador.uid;
      const autorizacionVigente = !!sol && sol.estado === "autorizada" && mismoOperador
        && resueltoEnMs > 0 && (resueltoEnMs + vigenciaMs) > Date.now();

      let autorizacion;
      let operacionSolicitud;   // qué hacer con el documento de solicitud al terminar
      const nombreUsuario = u.nombre || null;
      if (autorizacionVigente) {
        if (checkpoint === "pre_entrega" && sol.verificacionManual !== true) {
          throw new HttpsError("failed-precondition", "La autorización del Checkpoint 2 no incluye la verificación manual de la documentación. Solicítala de nuevo.");
        }
        autorizacion = {
          tipo: "solicitud",
          solicitadoPor: sol.solicitadoPor || null,
          motivo: sol.motivo || null,
          autorizadoPor: sol.resueltoPor || null,
        };
        operacionSolicitud = "solo_ultimo_enlace";
      } else if (esAdminUsuario) {
        // Admin sin solicitud autorizada vigente: puede generar directo; para
        // el Checkpoint 2 el cliente debe haber confirmado la verificación.
        if (checkpoint === "pre_entrega" && !confirmacionManual) {
          throw new HttpsError("failed-precondition", "Para el Checkpoint 2 debes confirmar que verificaste la documentación por otro medio.");
        }
        autorizacion = { tipo: "admin_directo", solicitadoPor: null, motivo: null, autorizadoPor: { uid, nombre: nombreUsuario } };
        operacionSolicitud = (sol && sol.estado === "solicitada" && mismoOperador) ? "admin_resuelve_pendiente" : "admin_reemplaza";
      } else if (!sol) {
        throw new HttpsError("permission-denied", "Este enlace necesita la autorización de un administrador. Solicítala primero.");
      } else if (!mismoOperador) {
        throw new HttpsError("failed-precondition", "El operador asignado cambió desde que se hizo la solicitud. Solicita el enlace de nuevo.");
      } else if (sol.estado === "solicitada") {
        throw new HttpsError("failed-precondition", "La solicitud sigue esperando la autorización de un administrador.");
      } else if (sol.estado === "rechazada") {
        throw new HttpsError("permission-denied", "Un administrador rechazó la solicitud. Puedes enviar otra.");
      } else {
        throw new HttpsError("failed-precondition", "La autorización venció (dura 12 horas). Solicita el enlace de nuevo.");
      }

      // Solo un enlace vivo por embarque Y checkpoint: los anteriores del
      // mismo checkpoint quedan revocados. (Registros viejos sin campo
      // checkpoint se tratan como "recepcion".)
      const previos = await dbAlanis.collection(COLECCION_ENLACES_CHECKPOINT)
        .where("embarqueId", "==", embarqueId).get();
      const vivos = previos.docs.filter(x => {
        const e = x.data();
        return e.usado !== true && e.revocado !== true && (e.checkpoint || "recepcion") === checkpoint;
      });
      if (vivos.length > 0) {
        const lote = dbAlanis.batch();
        vivos.forEach(x => lote.update(x.ref, {
          revocado: true,
          revocadoEn: FieldValue.serverTimestamp(),
          revocadoPor: uid,
        }));
        await lote.commit();
      }

      const codigo = randomBytes(32).toString("base64url");               // 256 bits
      const idRegistro = createHash("sha256").update(codigo).digest("hex"); // el código en claro no se guarda
      const ahoraMs = Date.now();
      const venceEnMs = ahoraMs + VIGENCIA_ENLACE_CHECKPOINT_HORAS * 60 * 60 * 1000;
      const creadoPor = {
        uid,
        nombre: u.nombre || null,
        correo: request.auth.token.email || null,
        proyecto: "appadrematasainterno",
      };

      await dbAlanis.collection(COLECCION_ENLACES_CHECKPOINT).doc(idRegistro).create({
        operadorUid: operador.uid,
        operadorNombre: operador.nombre || null,
        embarqueId,
        checkpoint,
        // Copia del UUID al generar: si después llega una corrección de
        // factura, el consumo debe rechazar el enlace (este enlace se salta
        // justo la prueba de la factura física).
        uuidEsperado: d.uuidEsperado,
        creadoPor,
        creadoEn: FieldValue.serverTimestamp(),
        venceEn: Timestamp.fromMillis(venceEnMs),
        usado: false,
        usadoEn: null,
        revocado: false,
      });

      // Bitácora en este proyecto (sin el código).
      await dbLocal.collection(COLECCION_HISTORIAL_ENLACES).add({
        embarqueId,
        operadorUid: operador.uid,
        operadorNombre: operador.nombre || null,
        checkpoint,
        confirmacionManual,
        autorizacion,
        generadoPor: creadoPor,
        timestamp: FieldValue.serverTimestamp(),
        venceEn: Timestamp.fromMillis(venceEnMs),
        enlacesAnterioresRevocados: vivos.length,
      });

      // Deja en la solicitud el rastro del último enlace emitido (la pantalla
      // lo usa para mostrar "Emitido"). Si esto falla, el enlace ya existe:
      // no se tumba la respuesta, solo se avisa en el log.
      try {
        const ultimoEnlace = {
          generadoPor: { uid, nombre: nombreUsuario },
          generadoEn: Timestamp.fromMillis(ahoraMs),
          venceEn: Timestamp.fromMillis(venceEnMs),
        };
        if (operacionSolicitud === "solo_ultimo_enlace") {
          await refSolicitud.update({ ultimoEnlace });
        } else if (operacionSolicitud === "admin_resuelve_pendiente") {
          await refSolicitud.update({
            estado: "autorizada",
            resueltoPor: { uid, nombre: nombreUsuario },
            resueltoEn: Timestamp.fromMillis(ahoraMs),
            comentarioAdmin: "Generado directo por el administrador.",
            verificacionManual: checkpoint === "pre_entrega" ? true : false,
            directoAdmin: true,
            ultimoEnlace,
          });
        } else {
          await refSolicitud.set({
            embarqueId,
            checkpoint,
            estado: "autorizada",
            operadorUid: operador.uid,
            operadorNombre: operador.nombre || "",
            motivo: "Generado directo por admin",
            detalle: "",
            solicitadoPor: { uid, nombre: nombreUsuario || "" },
            solicitadoEn: Timestamp.fromMillis(ahoraMs),
            resueltoPor: { uid, nombre: nombreUsuario || "" },
            resueltoEn: Timestamp.fromMillis(ahoraMs),
            comentarioAdmin: "",
            verificacionManual: checkpoint === "pre_entrega" ? true : false,
            directoAdmin: true,
            ultimoEnlace,
          });
        }
      } catch (eSol) {
        logger.warn(`[generarEnlaceCheckpoint] no se pudo actualizar la solicitud ${idSolicitud}: ${eSol.message}`);
      }

      logger.info(`[generarEnlaceCheckpoint] ${embarqueId} (${checkpoint}) → operador ${operador.uid}, generado por ${uid} (${autorizacion.tipo}), revocados previos: ${vivos.length}`);
      return {
        ok: true,
        enlace: `${URL_ENLACE_CHECKPOINT}?enlace=${codigo}`,
        venceEnMs,
        operadorNombre: operador.nombre || null,
        operadorNumero: operador.numero || null,
        embarqueId,
        checkpoint,
      };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error(`[generarEnlaceCheckpoint] falló para ${embarqueId}: ${error.message}`);
      throw new HttpsError("internal", "No se pudo generar el enlace. Intenta de nuevo.");
    }
  }
);

// ============================================================================
// 9) Checkpoint 2 (Pre Entrega) por validación REMOTA — Operaciones valida en
//    nombre del operador que no puede escanear (2026-10-08).
//
//    Reemplaza a los enlaces de pre_entrega. Operaciones recibe por WhatsApp la
//    foto de la factura que lleva el operador, lee el QR (o teclea folio y RFC)
//    en ADREMATASA Interno, y esta función compara contra la factura esperada
//    DEL LADO DEL SERVIDOR (el navegador nunca ve el UUID/RFC esperado) y
//    escribe el resultado en repositorio_mccain igual que la app del operador.
//    La lógica vive en validacionRemotaPreEntrega.js (probada aparte).
//
//    Primera etapa: igual que el enlace del Checkpoint 1, necesita que un admin
//    haya AUTORIZADO la solicitud (solicitudes_enlace_checkpoint/{id}__pre_entrega,
//    vigente 12 h, mismo operador asignado). Un admin puede validar directo.
//
//    El "actor" sale SOLO de usuarios/{uid} de este proyecto, nunca de lo que
//    mande el navegador.
// ============================================================================
async function leerActorOperaciones_(request) {
  const uid = request.auth.uid;
  const snapUsuario = await dbLocal.collection("usuarios").doc(uid).get();
  const u = snapUsuario.exists ? snapUsuario.data() : null;
  const activo = !!u && u.estatus === "activo" && ["admin", "supervisor", "empleado"].includes(u.rol);
  const autorizado = activo && (
    u.rol === "admin" ||
    (u.area === AREA_OPERACIONES_MEX && PUESTOS_VALIDADOR2.includes(u.puesto))
  );
  if (!autorizado) {
    throw new HttpsError("permission-denied", "Solo Operaciones o un administrador pueden hacer esta validación.");
  }
  return {
    u,
    actor: {
      uid,
      nombre: u.nombre || null,
      correo: u.correo || u.email || request.auth.token.email || null,
      rol: u.rol || null,
      puesto: u.puesto || null,
      area: u.area || null,
      proyecto: "appadrematasainterno",
    },
  };
}

exports.validarPreEntregaRemota = onCall(
  { region: REGION },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    }
    const { u, actor } = await leerActorOperaciones_(request);
    const entrada = request.data || {};
    const embarqueId = typeof entrada.embarqueId === "string" ? entrada.embarqueId.trim() : "";
    if (!embarqueId || embarqueId.includes("/")) {
      throw new HttpsError("invalid-argument", "Falta el embarque.");
    }
    const esAdminUsuario = u.rol === "admin";

    try {
      // ---- Autorización del admin (solo para quien no es admin) ----
      const refSolicitud = dbLocal.collection(COLECCION_SOLICITUDES_ENLACE).doc(`${embarqueId}__pre_entrega`);
      const [snapSol, snapEmb] = await Promise.all([
        refSolicitud.get(),
        dbAlanis.collection(COLECCION_REPO).doc(embarqueId).get(),
      ]);
      if (!snapEmb.exists) {
        throw new HttpsError("not-found", "El embarque no existe en Alanis Operadores.");
      }
      const operadorUid = (snapEmb.data().operadorAsignado || {}).uid || null;
      const sol = snapSol.exists ? snapSol.data() : null;
      const resueltoEnMs = sol && sol.resueltoEn && typeof sol.resueltoEn.toMillis === "function" ? sol.resueltoEn.toMillis() : 0;
      const vigenciaMs = VIGENCIA_ENLACE_CHECKPOINT_HORAS * 60 * 60 * 1000;
      const mismoOperador = !!sol && !!operadorUid && sol.operadorUid === operadorUid;
      const autorizacionVigente = !!sol && sol.estado === "autorizada" && mismoOperador
        && resueltoEnMs > 0 && (resueltoEnMs + vigenciaMs) > Date.now();

      if (!autorizacionVigente && !esAdminUsuario) {
        if (!sol) {
          throw new HttpsError("permission-denied", "Esta validación necesita la autorización de un administrador. Solicítala primero.");
        } else if (!mismoOperador) {
          throw new HttpsError("failed-precondition", "El operador asignado cambió desde que se hizo la solicitud. Solicita de nuevo.");
        } else if (sol.estado === "solicitada") {
          throw new HttpsError("failed-precondition", "La solicitud sigue esperando la autorización de un administrador.");
        } else if (sol.estado === "rechazada") {
          throw new HttpsError("permission-denied", "Un administrador rechazó la solicitud. Puedes enviar otra.");
        }
        throw new HttpsError("failed-precondition", "La autorización venció (dura 12 horas). Solicita de nuevo.");
      }

      let resultado;
      try {
        resultado = await ejecutarValidacionRemota({
          db: dbAlanis,
          FieldValue,
          actor,
          entrada: { ...entrada, embarqueId },
        });
      } catch (e) {
        if (e instanceof ErrorValidacion) {
          throw new HttpsError(e.codigoHttps, e.message, { motivo: e.motivo });
        }
        throw e;
      }

      logger.info(`[validarPreEntregaRemota] ${embarqueId} → ${resultado.estatusValidacion} por ${actor.uid} (${autorizacionVigente ? "solicitud autorizada" : "admin directo"})`);

      // Rastro en la solicitud (la bitácora de alanis-operadores no se edita).
      // Si falla, la validación ya quedó registrada: solo se avisa en el log.
      if (sol) {
        try {
          await refSolicitud.update({
            validacionRealizada: {
              por: { uid: actor.uid, nombre: actor.nombre },
              en: Timestamp.now(),
              resultado: resultado.estatusValidacion,
              bitacoraId: resultado.bitacoraId,
              tipo: autorizacionVigente ? "solicitud" : "admin_directo",
            },
          });
        } catch (eSol) {
          logger.warn(`[validarPreEntregaRemota] no se pudo anotar en la solicitud ${embarqueId}__pre_entrega: ${eSol.message}`);
        }
      }
      return resultado;
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error(`[validarPreEntregaRemota] falló para ${embarqueId}: ${error.message}`);
      throw new HttpsError("internal", "No se pudo registrar la validación. Intenta de nuevo.");
    }
  }
);

// Consulta de la bitácora de validaciones remotas (vive en alanis-operadores,
// por eso se lee aquí con el Admin SDK y no desde el navegador). Solo
// Operaciones y admin. No devuelve el UUID/RFC esperados.
exports.listarValidacionesRemotas = onCall(
  { region: REGION },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    }
    await leerActorOperaciones_(request);
    try {
      const snap = await dbAlanis.collection(COL_BITACORA_VALIDACIONES_REMOTAS)
        .orderBy("creadoEn", "desc").limit(100).get();
      const registros = snap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          creadoEnMs: x.creadoEn && typeof x.creadoEn.toMillis === "function" ? x.creadoEn.toMillis() : null,
          embarqueId: x.embarqueId || null,
          shipment: x.shipment || null,
          ocCliente: x.ocCliente || null,
          caja: x.caja || null,
          resultado: x.resultado || null,
          discrepanciaDetalle: x.discrepanciaDetalle || null,
          realizadoPor: x.realizadoPor ? { nombre: x.realizadoPor.nombre || null, puesto: x.realizadoPor.puesto || null } : null,
          enNombreDe: x.enNombreDe ? { nombre: x.enNombreDe.nombre || null, numero: x.enNombreDe.numero || null } : null,
          lecturaManual: x.lecturaManual === true,
          motivoOperador: x.motivoOperador || null,
          notaMotivo: x.notaMotivo || null,
          evidencia: x.evidencia ? { tipo: x.evidencia.tipo || null, nota: x.evidencia.nota || null } : null,
        };
      });
      return { ok: true, registros };
    } catch (error) {
      logger.error(`[listarValidacionesRemotas] ${error.message}`);
      throw new HttpsError("internal", "No se pudo cargar la bitácora.");
    }
  }
);
// 8 — Reporte Walmart: procesa correos de citas (ver walmartCitas.js)
exports.procesarCorreoWalmart = require("./walmartCitas").procesarCorreoWalmart;
