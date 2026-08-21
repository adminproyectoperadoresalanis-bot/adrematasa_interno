// Herramienta de admin: restablece la contraseña de un empleado sin depender
// de ningún correo (ni el de Firebase ni EmailJS). Se corre a mano, una sola
// vez por caso, directo en la terminal de Codespaces — no se despliega en
// ningún lado, no toca el plan de Firebase (sigue siendo 100% Spark/gratis).
//
// CÓMO SE USA (ver instrucciones completas en LEEME.md de esta carpeta):
//   node restablecer-contrasena.js correo@alanis.com.mx nuevaContrasenaTemporal
//
// Qué hace: busca al usuario por su correo en Firebase Authentication y le
// asigna directamente la contraseña nueva que le pases — sin mandar ningún
// correo, sin tocar su perfil en Firestore, sin cambiar su historial.
// Después le compartes tú esa contraseña temporal al empleado (WhatsApp, en
// persona, como sea) para que entre y, si quieres, la cambie una vez adentro.

console.log("Iniciando...");

// Estilo moderno de importación (recomendado por Firebase desde hace varias
// versiones) en vez del objeto "admin.credential.cert(...)" de antes — ese
// estilo viejo a veces no expone bien "admin.credential" en versiones
// recientes de la librería, y por eso fallaba.
const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const path = require("path");

const RUTA_LLAVE = path.join(__dirname, "serviceAccountKey.json");

let serviceAccount;
try {
  serviceAccount = require(RUTA_LLAVE);
  console.log("Llave de administración cargada (proyecto: " + (serviceAccount.project_id || "?") + ").");
} catch (err) {
  console.error("No pude leer serviceAccountKey.json en esta carpeta.");
  console.error("Detalle: " + err.message);
  console.error("Revisa que el archivo exista, se llame exactamente así, y que sea el .json que descargaste de Firebase Console (sin editarlo).");
  process.exit(1);
}

let auth;
try {
  const app = initializeApp({ credential: cert(serviceAccount) });
  auth = getAuth(app);
  console.log("Conexión con Firebase inicializada.");
} catch (err) {
  console.error("No pude inicializar la conexión con Firebase.");
  console.error("Detalle: " + err.message);
  console.error("Es posible que el archivo serviceAccountKey.json se haya dañado al subirlo. Prueba descargarlo de nuevo desde Firebase Console.");
  process.exit(1);
}

const [, , correo, nuevaContrasena] = process.argv;

if (!correo || !nuevaContrasena) {
  console.error("Uso: node restablecer-contrasena.js correo@alanis.com.mx nuevaContrasenaTemporal");
  process.exit(1);
}
if (!correo.includes("@")) {
  console.error("Ese correo no se ve válido: " + correo);
  process.exit(1);
}
if (nuevaContrasena.length < 6) {
  console.error("La contraseña debe tener al menos 6 caracteres.");
  process.exit(1);
}

// Límite de tiempo: si en 20 segundos no hay respuesta de Firebase (problema
// de red desde Codespaces, por ejemplo), avisamos en vez de quedarnos
// esperando en silencio para siempre.
const limiteTiempo = () => new Promise((_, reject) => {
  setTimeout(() => reject(new Error("TIMEOUT")), 20000);
});

console.log(`Buscando la cuenta de ${correo}...`);

Promise.race([auth.getUserByEmail(correo), limiteTiempo()])
  .then((userRecord) => {
    console.log(`Cuenta encontrada (uid: ${userRecord.uid}). Actualizando contraseña...`);
    return Promise.race([
      auth.updateUser(userRecord.uid, { password: nuevaContrasena }),
      limiteTiempo()
    ]);
  })
  .then((userRecord) => {
    console.log("");
    console.log("Listo ✅");
    console.log(`Correo: ${userRecord.email}`);
    console.log(`Contraseña nueva: ${nuevaContrasena}`);
    console.log("");
    console.log("Ahora compártele esa contraseña al empleado por otro medio (WhatsApp, en persona, etc.)");
    console.log("para que pueda iniciar sesión. Su perfil, historial y saldo de vacaciones siguen intactos.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("");
    if (err.message === "TIMEOUT") {
      console.error("Se agotó el tiempo de espera (20s) sin respuesta de Firebase.");
      console.error("Puede ser un tema de conexión desde este Codespace. Intenta de nuevo, o revisa tu internet.");
    } else if (err.code === "auth/user-not-found") {
      console.error(`No existe ninguna cuenta registrada con el correo ${correo}.`);
    } else {
      console.error("Error: " + (err.message || err));
    }
    process.exit(1);
  });