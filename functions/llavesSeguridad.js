// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/functions/llavesSeguridad.js
// ACCION:   archivo NUEVO (crearlo y pegar todo el contenido, Ctrl+S)
// ##########################################################################
// ============================================================================
// Llave de acceso para la presentacion "Estrategia de seguridad"
// (proyecto separado: flowseguridad).
//
// Un administrador activo de ADREMATASA pide una llave; la funcion la firma con
// la clave PRIVADA (secreto FLOW_LLAVE_PRIVADA, Secret Manager de este proyecto)
// y la entrega como texto para convertirla en QR. Dura 60 segundos y solo
// sirve una vez: el proyecto flowseguridad la verifica con la clave PUBLICA
// (sin comunicarse con esta base de datos) y registra su uso.
//
// Formato de la llave:  FLOW1.<carga>.<firma>
//   carga = base64url({ j: id aleatorio, e: vencimiento en ms })
//   firma = Ed25519 sobre el texto de la carga, en base64url
//
// Cada llave generada queda en la coleccion bitacora_llaves_seguridad
// (solo la escribe esta funcion; sin reglas de lectura = nadie la lee desde
// el navegador). Nunca se guarda el texto de la llave, solo su id.
// ============================================================================

const crypto = require("node:crypto");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");

const REGION = "us-central1";
const dbLocal = getFirestore(); // appadrematasainterno
const FLOW_LLAVE_PRIVADA = defineSecret("FLOW_LLAVE_PRIVADA");

const VIGENCIA_SEG = 60;
const COL_BITACORA = "bitacora_llaves_seguridad";

function firmarLlave_(pemPrivada, ahoraMs) {
  const jti = crypto.randomBytes(16).toString("hex");
  const exp = ahoraMs + VIGENCIA_SEG * 1000;
  const carga = Buffer.from(JSON.stringify({ j: jti, e: exp })).toString("base64url");
  const firma = crypto
    .sign(null, Buffer.from(carga), crypto.createPrivateKey(pemPrivada))
    .toString("base64url");
  return { llave: "FLOW1." + carga + "." + firma, jti, exp };
}

exports.generarLlaveSeguridad = onCall(
  { region: REGION, secrets: [FLOW_LLAVE_PRIVADA], maxInstances: 2 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    }
    const uid = request.auth.uid;

    // Mismo criterio de "cuenta activa" que leerActor_ (operadoresAlanis.js),
    // pero SOLO administradores.
    const snapUsuario = await dbLocal.collection("usuarios").doc(uid).get();
    const u = snapUsuario.exists ? snapUsuario.data() : null;
    if (!u || u.estatus !== "activo" || u.rol !== "admin") {
      throw new HttpsError("permission-denied", "Solo un administrador puede generar la llave.");
    }

    const ahora = Date.now();
    const { llave, jti, exp } = firmarLlave_(FLOW_LLAVE_PRIVADA.value(), ahora);

    // Si no se puede dejar constancia, no se entrega la llave.
    await dbLocal.collection(COL_BITACORA).add({
      jti,
      generadaPor: {
        uid,
        nombre: u.nombre || null,
        correo: u.email || request.auth.token.email || null,
      },
      creadaEn: FieldValue.serverTimestamp(),
      expiraEn: Timestamp.fromMillis(exp),
    });

    return { ok: true, llave, vigenciaSeg: VIGENCIA_SEG };
  }
);
