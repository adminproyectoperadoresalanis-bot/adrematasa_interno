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
//    Contrato (acordado con el chat de Alanis Operadores):
//      entrada : { embarqueId }   — todo lo demás se lee de repositorio_mccain
//      registro: enlaces_checkpoint/{sha256(codigo)} en alanis-operadores,
//                con reglas "denegar todo" (solo Admin SDK lo toca).
//      salida  : { ok, enlace, venceEnMs, operadorNombre, operadorNumero, embarqueId }
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
      if (d.recepcionOperador && d.recepcionOperador.resultado) {
        throw new HttpsError("failed-precondition", "El operador ya hizo el Checkpoint 1 de este embarque.");
      }

      // Solo un enlace vivo por embarque: los anteriores quedan revocados.
      const previos = await dbAlanis.collection(COLECCION_ENLACES_CHECKPOINT)
        .where("embarqueId", "==", embarqueId).get();
      const vivos = previos.docs.filter(x => {
        const e = x.data();
        return e.usado !== true && e.revocado !== true;
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
        checkpoint: "recepcion",
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
        generadoPor: creadoPor,
        timestamp: FieldValue.serverTimestamp(),
        venceEn: Timestamp.fromMillis(venceEnMs),
        enlacesAnterioresRevocados: vivos.length,
      });

      logger.info(`[generarEnlaceCheckpoint] ${embarqueId} → operador ${operador.uid}, generado por ${uid}, revocados previos: ${vivos.length}`);
      return {
        ok: true,
        enlace: `${URL_ENLACE_CHECKPOINT}?enlace=${codigo}`,
        venceEnMs,
        operadorNombre: operador.nombre || null,
        operadorNumero: operador.numero || null,
        embarqueId,
      };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error(`[generarEnlaceCheckpoint] falló para ${embarqueId}: ${error.message}`);
      throw new HttpsError("internal", "No se pudo generar el enlace. Intenta de nuevo.");
    }
  }
);