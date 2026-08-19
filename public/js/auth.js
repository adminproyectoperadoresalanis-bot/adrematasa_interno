import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  doc, setDoc, getDoc
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { iniciarPanelAdmin } from "./admin.js";
import { iniciarVistaEmpleado } from "./solicitudes.js";
import { iniciarGestionSolicitudes, iniciarVistaSupervisor } from "./aprobaciones.js";
import { iniciarNavegacion, ocultarNavegacion } from "./navegacion.js";
import { iniciarVistaVacacionesEmpleado } from "./vacaciones.js";
import { iniciarGestionVacaciones, iniciarVistaSupervisorVacaciones } from "./aprobacionesVacaciones.js";
import { iniciarPanelResumenAdmin, iniciarPanelResumenSupervisor } from "./panel.js";
import { iniciarGestionFaltas, iniciarVistaSupervisorFaltas, iniciarVistaEmpleadoFaltas } from "./faltas.js";
import { iniciarMiEquipo } from "./equipo.js";
import { iniciarConfiguracion } from "./configuracion.js";
import { iniciarReportesAdmin, iniciarReportesSupervisor } from "./reportes.js";

const DOMINIO_ALANIS = "@alanis.com.mx";

const vistaCargando = document.getElementById("vista-cargando");
const vistaLogin = document.getElementById("vista-login");
const vistaRegistro = document.getElementById("vista-registro");
const vistaRecuperar = document.getElementById("vista-recuperar");
const vistaApp = document.getElementById("vista-app");

const formLogin = document.getElementById("form-login");
const formRegistro = document.getElementById("form-registro");
const formRecuperar = document.getElementById("form-recuperar");
const errorLogin = document.getElementById("error-login");
const errorRegistro = document.getElementById("error-registro");
const errorRecuperar = document.getElementById("error-recuperar");
const exitoRecuperar = document.getElementById("exito-recuperar");

const linkIrRegistro = document.getElementById("link-ir-registro");
const linkIrLogin = document.getElementById("link-ir-login");
const linkIrRecuperar = document.getElementById("link-ir-recuperar");
const linkIrLoginDesdeRecuperar = document.getElementById("link-ir-login-desde-recuperar");
const btnLogout = document.getElementById("btn-logout");

const nombreUsuarioSpan = document.getElementById("nombre-usuario");
const rolUsuarioSpan = document.getElementById("rol-usuario");
const contenidoApp = document.getElementById("contenido-app");

function mostrarVista(vista) {
  [vistaCargando, vistaLogin, vistaRegistro, vistaRecuperar, vistaApp].forEach(v => v.classList.add("oculto"));
  vista.classList.remove("oculto");
}

// Supervisores y admins también son empleados: además de revisar/aprobar las
// solicitudes de su equipo, necesitan poder capturar las suyas propias (por
// ejemplo, sus propias horas extra o vacaciones). Esta función dibuja las dos
// cosas en la misma pestaña: primero la vista de revisión que ya tenían,
// después su propio formulario de captura.
function renderEquipoYPropia(contenedor, dibujarEquipo, dibujarPropia) {
  const equipoDiv = document.createElement("div");
  const propiaDiv = document.createElement("div");
  propiaDiv.style.marginTop = "20px";
  contenedor.innerHTML = "";
  contenedor.appendChild(equipoDiv);
  contenedor.appendChild(propiaDiv);
  dibujarEquipo(equipoDiv);
  dibujarPropia(propiaDiv);
}

linkIrRegistro?.addEventListener("click", (e) => {
  e.preventDefault();
  errorLogin.textContent = "";
  mostrarVista(vistaRegistro);
});

linkIrLogin?.addEventListener("click", (e) => {
  e.preventDefault();
  errorRegistro.textContent = "";
  mostrarVista(vistaLogin);
});

linkIrRecuperar?.addEventListener("click", (e) => {
  e.preventDefault();
  errorLogin.textContent = "";
  errorRecuperar.textContent = "";
  exitoRecuperar.textContent = "";
  exitoRecuperar.classList.add("oculto");
  formRecuperar.reset();
  mostrarVista(vistaRecuperar);
});

linkIrLoginDesdeRecuperar?.addEventListener("click", (e) => {
  e.preventDefault();
  errorRecuperar.textContent = "";
  mostrarVista(vistaLogin);
});

formRecuperar?.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorRecuperar.textContent = "";
  exitoRecuperar.textContent = "";
  exitoRecuperar.classList.add("oculto");

  const correo = document.getElementById("recuperar-correo").value.trim().toLowerCase();

  if (!correo.endsWith(DOMINIO_ALANIS)) {
    errorRecuperar.textContent = `Escribe tu correo Alanis (${DOMINIO_ALANIS})`;
    return;
  }

  try {
    await sendPasswordResetEmail(auth, correo);
    exitoRecuperar.textContent = `Listo. Revisa la bandeja de entrada (y spam) de ${correo} para definir tu nueva contraseña.`;
    exitoRecuperar.classList.remove("oculto");
    formRecuperar.reset();
  } catch (err) {
    errorRecuperar.textContent = traducirError(err);
  }
});

formRegistro?.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorRegistro.textContent = "";

  const nombre = document.getElementById("registro-nombre").value.trim();
  const correo = document.getElementById("registro-correo").value.trim().toLowerCase();
  const password = document.getElementById("registro-password").value;
  const password2 = document.getElementById("registro-password2").value;

  if (!correo.endsWith(DOMINIO_ALANIS)) {
    errorRegistro.textContent = `Debes registrarte con tu correo Alanis (${DOMINIO_ALANIS})`;
    return;
  }
  if (password.length < 6) {
    errorRegistro.textContent = "La contraseña debe tener al menos 6 caracteres.";
    return;
  }
  if (password !== password2) {
    errorRegistro.textContent = "Las contraseñas no coinciden.";
    return;
  }

  try {
    const cred = await createUserWithEmailAndPassword(auth, correo, password);
    await setDoc(doc(db, "usuarios", cred.user.uid), {
      nombre,
      email: correo,
      rol: "empleado",
      supervisorId: null,
      estatus: "pendiente",
      creadoEn: new Date().toISOString()
    });
    // onAuthStateChanged se encarga de mostrar la app despues de esto.
  } catch (err) {
    errorRegistro.textContent = traducirError(err);
  }
});

formLogin?.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorLogin.textContent = "";

  const correo = document.getElementById("login-correo").value.trim().toLowerCase();
  const password = document.getElementById("login-password").value;

  try {
    await signInWithEmailAndPassword(auth, correo, password);
  } catch (err) {
    errorLogin.textContent = traducirError(err);
  }
});

btnLogout?.addEventListener("click", async () => {
  await signOut(auth);
});

function traducirError(err) {
  const codigo = err.code || "";
  const mensajes = {
    "auth/email-already-in-use": "Ese correo ya está registrado. Inicia sesión.",
    "auth/invalid-email": "El correo no es válido.",
    "auth/weak-password": "La contraseña es muy débil.",
    "auth/user-not-found": "No existe una cuenta con ese correo.",
    "auth/wrong-password": "Contraseña incorrecta.",
    "auth/invalid-credential": "Correo o contraseña incorrectos.",
    "auth/too-many-requests": "Demasiados intentos. Espera un momento e intenta de nuevo."
  };
  return mensajes[codigo] || `Ocurrió un error (${codigo}). Intenta de nuevo.`;
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    mostrarVista(vistaLogin);
    return;
  }

  mostrarVista(vistaCargando);

  const refUsuario = doc(db, "usuarios", user.uid);
  const snap = await getDoc(refUsuario);

  if (!snap.exists()) {
    contenidoApp.innerHTML = `<p>No se encontró tu perfil. Contacta al administrador.</p>`;
    mostrarVista(vistaApp);
    return;
  }

  const datosUsuario = snap.data();
  nombreUsuarioSpan.textContent = datosUsuario.nombre;
  rolUsuarioSpan.textContent = datosUsuario.rol;

  const pantallaProximamente = (c) => {
    c.innerHTML = `<div class="panel"><p>Esta sección todavía no está lista. Muy pronto.</p></div>`;
  };

  if (datosUsuario.rol === "admin") {
    iniciarNavegacion("admin", {
      panel: (c) => iniciarPanelResumenAdmin(c),
      solicitudes: (c) => renderEquipoYPropia(c,
        (d) => iniciarGestionSolicitudes(d, user.uid, datosUsuario.nombre),
        (d) => iniciarVistaEmpleado(d, datosUsuario, user.uid)
      ),
      vacaciones: (c) => renderEquipoYPropia(c,
        (d) => iniciarGestionVacaciones(d, user.uid, datosUsuario.nombre),
        (d) => iniciarVistaVacacionesEmpleado(d, datosUsuario, user.uid)
      ),
      faltas: (c) => iniciarGestionFaltas(c, user.uid, datosUsuario.nombre),
      catalogo: (c) => iniciarPanelAdmin(c, user.uid),
      reportes: (c) => iniciarReportesAdmin(c),
      configuracion: (c) => iniciarConfiguracion(c)
    }, "panel");
  } else if (datosUsuario.estatus === "pendiente") {
    ocultarNavegacion();
    contenidoApp.innerHTML = `
      <div class="panel">
        <p>Hola, ${datosUsuario.nombre}. Tu cuenta está pendiente de aprobación por un administrador.</p>
        <p class="nota">En cuanto el administrador la active podrás capturar tus solicitudes.</p>
      </div>
    `;
  } else if (datosUsuario.estatus === "rechazado") {
    ocultarNavegacion();
    contenidoApp.innerHTML = `
      <div class="panel">
        <p>Hola, ${datosUsuario.nombre}. Tu registro fue rechazado.</p>
        <p class="nota">Contacta al administrador si crees que esto es un error.</p>
      </div>
    `;
  } else if (datosUsuario.rol === "empleado") {
    iniciarNavegacion("empleado", {
      horasExtra: (c) => iniciarVistaEmpleado(c, datosUsuario, user.uid),
      vacaciones: (c) => iniciarVistaVacacionesEmpleado(c, datosUsuario, user.uid),
      faltas: (c) => iniciarVistaEmpleadoFaltas(c, datosUsuario, user.uid)
    }, "horasExtra");
  } else if (datosUsuario.rol === "supervisor") {
    iniciarNavegacion("supervisor", {
      panel: (c) => iniciarPanelResumenSupervisor(c, user.uid),
      solicitudes: (c) => renderEquipoYPropia(c,
        (d) => iniciarVistaSupervisor(d, user.uid, datosUsuario.nombre),
        (d) => iniciarVistaEmpleado(d, datosUsuario, user.uid)
      ),
      vacaciones: (c) => renderEquipoYPropia(c,
        (d) => iniciarVistaSupervisorVacaciones(d, user.uid, datosUsuario.nombre),
        (d) => iniciarVistaVacacionesEmpleado(d, datosUsuario, user.uid)
      ),
      faltas: (c) => iniciarVistaSupervisorFaltas(c, user.uid, datosUsuario.nombre),
      equipo: (c) => iniciarMiEquipo(c, user.uid),
      reportes: (c) => iniciarReportesSupervisor(c, user.uid)
    }, "panel");
  } else {
    ocultarNavegacion();
    contenidoApp.innerHTML = `<p>No se reconoce tu rol. Contacta al administrador.</p>`;
  }

  mostrarVista(vistaApp);
});