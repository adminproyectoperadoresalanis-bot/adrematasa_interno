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
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const https = require("https");
const logger = require("firebase-functions/logger");

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