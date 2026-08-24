// Herramienta de admin: crea de una vez un usuario ya activo (cuenta +
// perfil), sin que esa persona tenga que registrarse ella misma en la app.
// Pensada para gente que necesita aparecer en el Organigrama / Catálogo de
// empleados pero que nunca va a usar la app para nada (pedir horas extra,
// vacaciones, etc.) — por ejemplo, un director que solo necesita salir
// como "titular" de su puesto en el organigrama.
//
// A diferencia del registro normal (que crea al usuario en estatus
// "pendiente" y requiere que un admin lo apruebe), esta herramienta lo deja
// "activo" desde el primer momento, con el Área y Puesto que le indiques.
//
// Se corre a mano, desde la terminal de Codespaces — no se despliega en
// ningún lado, no toca el plan de Firebase (sigue siendo 100% Spark/gratis).
// Usa la misma llave de administración (serviceAccountKey.json) que ya
// tienes configurada para restablecer-contrasena.js — si no la tienes,
// revisa LEEME.md de esta carpeta primero.
//
// CÓMO SE USA:
//   node crear-usuario.js
//   (y responde las preguntas que te va haciendo la terminal)

console.log("Iniciando...");

const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");

const RUTA_LLAVE = path.join(__dirname, "serviceAccountKey.json");

let serviceAccount;
try {
  serviceAccount = require(RUTA_LLAVE);
  console.log("Llave de administración cargada (proyecto: " + (serviceAccount.project_id || "?") + ").");
} catch (err) {
  console.error("No pude leer serviceAccountKey.json en esta carpeta.");
  console.error("Detalle: " + err.message);
  console.error("Revisa LEEME.md de esta carpeta para configurarla (es la misma llave que usa restablecer-contrasena.js).");
  process.exit(1);
}

let auth, db;
try {
  const app = initializeApp({ credential: cert(serviceAccount) });
  auth = getAuth(app);
  db = getFirestore(app);
  console.log("Conexión con Firebase inicializada.");
} catch (err) {
  console.error("No pude inicializar la conexión con Firebase.");
  console.error("Detalle: " + err.message);
  process.exit(1);
}

const limiteTiempo = () => new Promise((_, reject) => {
  setTimeout(() => reject(new Error("TIMEOUT")), 20000);
});

function preguntar(rl, texto) {
  return new Promise((resolve) => rl.question(texto, (respuesta) => resolve(respuesta.trim())));
}

async function pedirDatosPorTerminal() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let nombre = "";
  while (true) {
    nombre = await preguntar(rl, "\nNombre completo: ");
    if (!nombre) { console.log("Escribe un nombre."); continue; }
    break;
  }

  let correo = "";
  while (true) {
    correo = await preguntar(rl, "Correo Alanis (@alanis.com.mx): ");
    if (!correo.includes("@")) { console.log("Ese correo no se ve válido, intenta de nuevo."); continue; }
    break;
  }

  let area = "";
  while (true) {
    area = await preguntar(rl, "Área (debe coincidir exactamente con Configuración > Áreas y puestos): ");
    if (!area) { console.log("Escribe un área."); continue; }
    break;
  }

  let puesto = "";
  while (true) {
    puesto = await preguntar(rl, "Puesto (debe coincidir exactamente con esa Área en Configuración): ");
    if (!puesto) { console.log("Escribe un puesto."); continue; }
    break;
  }

  let rol = await preguntar(rl, "Rol (empleado / supervisor / admin) [empleado]: ");
  rol = rol.toLowerCase();
  if (!["empleado", "supervisor", "admin"].includes(rol)) rol = "empleado";

  rl.close();
  return { nombre, correo, area, puesto, rol };
}

async function crear({ nombre, correo, area, puesto, rol }) {
  // No necesita ponerse a pensar una contraseña: como esta persona no va a
  // iniciar sesión, se genera una aleatoria y segura solo para satisfacer a
  // Firebase Auth (que exige alguna). Si algún día sí necesita entrar,
  // usa restablecer-contrasena.js para ponerle una que sí conozca.
  const contrasenaAleatoria = crypto.randomBytes(12).toString("base64url");

  console.log(`\nCreando la cuenta de ${correo}...`);
  try {
    const userRecord = await Promise.race([
      auth.createUser({ email: correo, password: contrasenaAleatoria, displayName: nombre }),
      limiteTiempo()
    ]);
    console.log(`Cuenta creada en Authentication (uid: ${userRecord.uid}). Creando su perfil...`);

    await Promise.race([
      db.collection("usuarios").doc(userRecord.uid).set({
        nombre,
        email: correo,
        rol,
        area,
        puesto,
        supervisorId: null,
        estatus: "activo",
        creadoEn: new Date().toISOString()
      }),
      limiteTiempo()
    ]);

    console.log("");
    console.log("Listo ✅");
    console.log(`Nombre: ${nombre}`);
    console.log(`Correo: ${correo}`);
    console.log(`Área: ${area}`);
    console.log(`Puesto: ${puesto}`);
    console.log(`Rol: ${rol}`);
    console.log("");
    console.log("Ya está activo — no necesita registrarse ni que nadie lo apruebe.");
    console.log("Como no lo vas a usar para iniciar sesión, no hace falta que guardes ni compartas su contraseña.");
    console.log("Si en algún momento sí necesita entrar a la app, usa restablecer-contrasena.js para ponerle una que sí conozca.");
    process.exit(0);
  } catch (err) {
    console.error("");
    if (err.message === "TIMEOUT") {
      console.error("Se agotó el tiempo de espera (20s) sin respuesta de Firebase. Intenta de nuevo.");
    } else if (err.code === "auth/email-already-exists") {
      console.error(`Ya existe una cuenta con el correo ${correo}. Si quieres editar su Área/Puesto, hazlo desde Catálogo de empleados en la app.`);
    } else {
      console.error("Error: " + (err.message || err));
    }
    process.exit(1);
  }
}

pedirDatosPorTerminal().then(crear);