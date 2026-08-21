// Herramienta de admin: restablece la contraseña de un empleado sin depender
// de ningún correo (ni el de Firebase ni EmailJS). Se corre a mano, una sola
// vez por caso, directo en la terminal de Codespaces — no se despliega en
// ningún lado, no toca el plan de Firebase (sigue siendo 100% Spark/gratis).
//
// CÓMO SE USA (ver instrucciones completas en LEEME.md de esta carpeta):
//   node restablecer-contrasena.js
//   (y responde las dos preguntas que te va haciendo la terminal)
//
// También puedes seguir pasándolos directo si prefieres, sin que te pregunte:
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
const readline = require("readline");

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

// Límite de tiempo: si en 20 segundos no hay respuesta de Firebase (problema
// de red desde Codespaces, por ejemplo), avisamos en vez de quedarnos
// esperando en silencio para siempre.
const limiteTiempo = () => new Promise((_, reject) => {
  setTimeout(() => reject(new Error("TIMEOUT")), 20000);
});

function preguntar(rl, texto) {
  return new Promise((resolve) => rl.question(texto, (respuesta) => resolve(respuesta.trim())));
}

async function pedirDatosPorTerminal() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let correo = "";
  while (true) {
    correo = await preguntar(rl, "\nCorreo del empleado: ");
    if (!correo) { console.log("Escribe un correo."); continue; }
    if (!correo.includes("@")) { console.log("Ese correo no se ve válido, intenta de nuevo."); continue; }
    break;
  }

  let nuevaContrasena = "";
  while (true) {
    nuevaContrasena = await preguntar(rl, "Contraseña temporal nueva (mínimo 6 caracteres): ");
    if (nuevaContrasena.length < 6) { console.log("Debe tener al menos 6 caracteres, intenta de nuevo."); continue; }
    break;
  }

  rl.close();
  return { correo, nuevaContrasena };
}

async function restablecer(correo, nuevaContrasena) {
  console.log(`\nBuscando la cuenta de ${correo}...`);
  try {
    const userRecord = await Promise.race([auth.getUserByEmail(correo), limiteTiempo()]);
    console.log(`Cuenta encontrada (uid: ${userRecord.uid}). Actualizando contraseña...`);
    const actualizado = await Promise.race([
      auth.updateUser(userRecord.uid, { password: nuevaContrasena }),
      limiteTiempo()
    ]);
    console.log("");
    console.log("Listo ✅");
    console.log(`Correo: ${actualizado.email}`);
    console.log(`Contraseña nueva: ${nuevaContrasena}`);
    console.log("");
    console.log("Ahora compártele esa contraseña al empleado por otro medio (WhatsApp, en persona, etc.)");
    console.log("para que pueda iniciar sesión. Su perfil, historial y saldo de vacaciones siguen intactos.");
    process.exit(0);
  } catch (err) {
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
  }
}

const [, , correoArg, contrasenaArg] = process.argv;

if (correoArg && contrasenaArg) {
  // Uso directo con argumentos, sin preguntas — sigue funcionando igual que antes.
  if (!correoArg.includes("@")) {
    console.error("Ese correo no se ve válido: " + correoArg);
    process.exit(1);
  }
  if (contrasenaArg.length < 6) {
    console.error("La contraseña debe tener al menos 6 caracteres.");
    process.exit(1);
  }
  restablecer(correoArg, contrasenaArg);
} else {
  // Sin argumentos: modo interactivo, pregunta paso a paso.
  pedirDatosPorTerminal().then(({ correo, nuevaContrasena }) => restablecer(correo, nuevaContrasena));
}