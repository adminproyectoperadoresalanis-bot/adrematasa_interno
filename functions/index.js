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
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

// TODO (Ivan): ajusta REGION a la ubicación real de tus bases de Firestore
// (Firebase Console → Configuración del proyecto → General → "Ubicación de
// recursos de Google Cloud predeterminada"). Debe ser la MISMA región en la
// que ya vive Firestore en cada proyecto — Cloud Functions 2da gen no puede
// desplegarse en cualquier región si el trigger es de Firestore.
const REGION = "us-central1";

// App local: appadrematasainterno (usa las credenciales del runtime, sin
// configuración extra).
initializeApp();
const dbLocal = getFirestore();

// App remota: alanis-operadores. Requiere que la cuenta de servicio de
// runtime de ESTA función (ver README de IAM) tenga el rol "Cloud Datastore
// User" otorgado en el proyecto alanis-operadores.
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

// ============================================================================
// 1) verificaciones_cfdi_local (LOCAL) —estadoSync:'pendiente'→
//    repositorio_mccain (ALANIS)
//
// Equivalente a sincronizarOrigenNuevos_ de Codigo.gs. Se dispara en
// CUALQUIER escritura del documento, pero solo actúa cuando el estado
// DESPUÉS del escrito es 'pendiente' — igual que el query original. No hay
// riesgo de bucle: esta misma función es la que mueve estadoSync a
// 'sincronizado' o 'error', y ninguno de esos valores vuelve a disparar el
// bloque de abajo.
// ============================================================================
exports.sincronizarOrigenNuevos = onDocumentWritten(
  { document: `${COLECCION_LOCAL}/{embarqueId}`, region: REGION },
  async (event) => {
    const after = event.data.after;
    if (!after || !after.exists) return; // documento borrado, nada que hacer

    const data = after.data();
    if (data.estadoSync !== "pendiente") return;
    if (!data.origenEscaneo) return; // igual que Codigo.gs: sin origenEscaneo no hay nada que mandar

    const embarqueId = event.params.embarqueId;

    const paraAlanis = {
      uuidEsperado: data.uuidEsperado ?? null,
      receptorRFCEsperado: data.receptorRFCEsperado ?? null,
      origenEscaneo: data.origenEscaneo,
    };
    // validacion2 (2da validación, Operaciones) y operadorAsignado — se
    // agregan solo si existen, igual que en Codigo.gs, para no tronar con
    // documentos viejos que no los tengan.
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
      throw error; // deja la excepción visible en los logs / habilita reintento
    }
  }
);

// ============================================================================
// 5) Borrado de prueba — TEMPORAL, misma vigencia que en Codigo.gs (fase de
//    pruebas con McCain en pausa). Equivalente a
//    procesarSolicitudesBorradoPrueba_.
//
// Se usa onDocumentCreated (no onDocumentWritten) porque la solicitud se
// borra sola al procesarse — no tiene sentido reaccionar a un update de un
// documento que va a desaparecer de inmediato.
//
// MEJORA respecto al Apps Script actual: Codigo.gs borra repositorio_mccain,
// verificaciones_cfdi_local y embarques_pendientes_origen, pero NO
// verificaciones_cfdi_resultado — así que si el embarque ya estaba validado,
// el espejo de resultado quedaba huérfano tras un borrado de prueba (aunque
// el comentario de limpiarResultadosObsoletos_ en Codigo.gs da a entender
// que sí se limpiaba). Aquí SÍ se limpia también verificaciones_cfdi_resultado,
// como consecuencia natural de que borrar repositorio_mccain dispara el
// trigger procesarCambioRepositorioMccain (ver el otro codebase) con
// after.exists === false. Avísame si prefieres que NO se limpie, para igualar
// el comportamiento actual al 100%.
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
      // sigue igual: la solicitud se borra pase lo que pase (ver finally),
      // para no reintentar en loop un id que ya no exista.
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
// 6) Reiniciar flujo — SOLO ADMIN (2026-09-14, pedido de Ivan). El botón en
//    ADREMATASA únicamente crea la solicitud (ver firestore.rules); esta
//    función es la que borra de verdad.
//
// Regresa un embarque a "recién llegado, sin ningún escaneo": borra
// verificaciones_cfdi_local (origen + 2da validación + operador asignado —
// TODO eso vive en ese único documento) para que Atención al Cliente lo
// vea otra vez como pendiente.
//
// CORREGIDO 2026-09-14 (bug encontrado en producción, gracias a Ivan): la
// primera versión de esta función BORRABA repositorio_mccain por completo,
// igual que procesarSolicitudBorradoPrueba. Eso estaba mal: ese documento no
// es solo "avance de validación" — también carga la identidad del embarque
// que capturó la VBA de Outlook (ocCliente, shipment, clienteNombre, caja,
// fechaEntrega, uuidFactura). Borrarlo entero destruye esos datos, y sin
// ellos procesarCambioRepositorioMccain (el otro codebase, en
// alanis-operadores) ya no tiene de dónde reconstruir la entrada en
// embarques_pendientes_origen — el embarque queda huérfano, no "reiniciado".
//
// Ahora, en vez de borrar, se hace un UPDATE que limpia solo los campos de
// AVANCE (uuidEsperado se deja en '' a propósito — es lo que le indica a
// procesarCambioRepositorioMccain que este embarque todavía no se escanea) y
// deja intactos los campos de IDENTIDAD del embarque. Ese mismo update
// dispara procesarCambioRepositorioMccain de forma normal (ya no por la rama
// de "documento borrado"), y esa función ya sabe, con uuidEsperado vacío:
//   - republicar embarques_pendientes_origen con lo que quedó (ocCliente/
//     shipment/caja/etc.) — así reaparece como pendiente de verdad.
//   - borrar verificaciones_cfdi_resultado si ya no hay estatusValidacion ni
//     recepcionOperador vigentes (limpiarResultadosObsoletos_) — mismo
//     resultado que antes, sin necesitar la rama de documento borrado.
//
// Si repositorio_mccain/{embarqueId} ya no existe (por ejemplo, se usó
// "Borrar embarque" antes, o es un reinicio de un reinicio ya corregido a
// medias como el de OC-606313 del 2026-09-14), no hay nada que actualizar —
// se registra un aviso en los logs y se sigue con el resto, en vez de
// tronar. En ese caso el embarque NO puede reaparecer solo en pendientes
// (su identidad ya se perdió); hay que recrearlo a mano o esperar a que la
// VBA vuelva a capturarlo si llega un correo de corrección.
//
// NO se toca embarques_pendientes_origen directamente aquí — eso lo hace
// procesarCambioRepositorioMccain como reacción al update de arriba, no esta
// función.
//
// Antes de tocar nada, se guarda una copia del documento local en
// historial_reinicios_flujo — así el reinicio queda auditado (quién, cuándo,
// qué embarque, qué traía) aunque el documento vivo ya no exista para
// consultarlo.
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
      // COLECCION_PENDIENTES NO se toca aquí — la repuebla
      // procesarCambioRepositorioMccain como reacción al update de arriba.
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