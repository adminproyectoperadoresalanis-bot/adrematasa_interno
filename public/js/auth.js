import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
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
import { iniciarCalendarioVacaciones } from "./calendarioVacaciones.js";
import { iniciarCentroNotificaciones, detenerCentroNotificaciones } from "./notificaciones.js";
import { iniciarCambioContrasena } from "./cuenta.js";
import { iniciarOrganigrama } from "./organigrama.js";
import { iniciarEscaneoOrigen } from "./escaneoOrigen.js";

const DOMINIO_ALANIS = "@alanis.com.mx";

const vistaCargando = document.getElementById("vista-cargando");
const vistaLogin = document.getElementById("vista-login");
const vistaRegistro = document.getElementById("vista-registro");
const vistaRecuperar = document.getElementById("vista-recuperar");
const vistaApp = document.getElementById("vista-app");

const formLogin = document.getElementById("form-login");
const formRegistro = document.getElementById("form-registro");
const errorLogin = document.getElementById("error-login");
const errorRegistro = document.getElementById("error-registro");

const linkIrRegistro = document.getElementById("link-ir-registro");
const linkIrLogin = document.getElementById("link-ir-login");
const linkIrRecuperar = document.getElementById("link-ir-recuperar");
const linkIrLoginDesdeRecuperar = document.getElementById("link-ir-login-desde-recuperar");
const btnLogout = document.getElementById("btn-logout");

const nombreUsuarioSpan = document.getElementById("nombre-usuario");
const rolUsuarioSpan = document.getElementById("rol-usuario");
const contenidoApp = document.getElementById("contenido-app");
const notificacionesWrap = document.getElementById("notificaciones-wrap");
const avatarUsuarioSpan = document.getElementById("avatar-usuario");
const avatarUsuarioGrandeSpan = document.getElementById("avatar-usuario-grande");
const btnMenuUsuario = document.getElementById("btn-menu-usuario");
const menuUsuario = document.getElementById("menu-usuario");

// Iniciales para el círculo del menú de usuario: primera letra del primer
// y (si hay) del último nombre — "Iván Landa" -> "IL", "Daniel" -> "D".
function iniciales(nombre) {
  const partes = (nombre || "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0][0].toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

// El botón y el menú viven en HTML estático (no se recrean al cambiar de
// usuario), así que se enlazan una sola vez — igual que la campanita en
// notificaciones.js.
btnMenuUsuario?.addEventListener("click", (e) => {
  e.stopPropagation();
  menuUsuario.classList.toggle("oculto");
});
document.addEventListener("click", (e) => {
  if (!menuUsuario || menuUsuario.classList.contains("oculto")) return;
  if (!menuUsuario.contains(e.target) && e.target !== btnMenuUsuario) {
    menuUsuario.classList.add("oculto");
  }
});
// Al tocar "Cambiar contraseña" o "Cerrar sesión" se cierra el menú de una
// vez (cuentan con sus propios listeners en cuenta.js / más abajo).
document.getElementById("btn-cambiar-contrasena")?.addEventListener("click", () => {
  menuUsuario?.classList.add("oculto");
});

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
  mostrarVista(vistaRecuperar);
});

linkIrLoginDesdeRecuperar?.addEventListener("click", (e) => {
  e.preventDefault();
  mostrarVista(vistaLogin);
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
  menuUsuario?.classList.add("oculto");
  await signOut(auth);
});

// Disponible para cualquier rol, en el encabezado — no depende de a qué
// pestaña esté entrando cada quien.
iniciarCambioContrasena();

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
    detenerCentroNotificaciones();
    notificacionesWrap?.classList.add("oculto");
    mostrarVista(vistaLogin);
    return;
  }

  mostrarVista(vistaCargando);

  const refUsuario = doc(db, "usuarios", user.uid);
  const snap = await getDoc(refUsuario);

  if (!snap.exists()) {
    detenerCentroNotificaciones();
    notificacionesWrap?.classList.add("oculto");
    contenidoApp.innerHTML = `<p>No se encontró tu perfil. Contacta al administrador.</p>`;
    mostrarVista(vistaApp);
    return;
  }

  const datosUsuario = snap.data();
  nombreUsuarioSpan.textContent = datosUsuario.nombre;
  rolUsuarioSpan.textContent = datosUsuario.rol;
  const iniciales_ = iniciales(datosUsuario.nombre);
  if (avatarUsuarioSpan) avatarUsuarioSpan.textContent = iniciales_;
  if (avatarUsuarioGrandeSpan) avatarUsuarioGrandeSpan.textContent = iniciales_;

  const pantallaProximamente = (c) => {
    c.innerHTML = `<div class="panel"><p>Esta sección todavía no está lista. Muy pronto.</p></div>`;
  };

  // El estatus manda antes que el rol: una cuenta pendiente, rechazada o
  // inactiva/dada de baja no debe entrar a su panel aunque su rol sea admin.
  if (datosUsuario.estatus === "pendiente") {
    detenerCentroNotificaciones();
    notificacionesWrap?.classList.add("oculto");
    ocultarNavegacion();
    contenidoApp.innerHTML = `
      <div class="panel">
        <p>Hola, ${datosUsuario.nombre}. Tu cuenta está pendiente de aprobación por un administrador.</p>
        <p class="nota">En cuanto el administrador la active podrás capturar tus solicitudes.</p>
      </div>
    `;
  } else if (datosUsuario.estatus === "rechazado") {
    detenerCentroNotificaciones();
    notificacionesWrap?.classList.add("oculto");
    ocultarNavegacion();
    contenidoApp.innerHTML = `
      <div class="panel">
        <p>Hola, ${datosUsuario.nombre}. Tu registro fue rechazado.</p>
        <p class="nota">Contacta al administrador si crees que esto es un error.</p>
      </div>
    `;
  } else if (datosUsuario.estatus === "inactivo") {
    detenerCentroNotificaciones();
    notificacionesWrap?.classList.add("oculto");
    ocultarNavegacion();
    contenidoApp.innerHTML = `
      <div class="panel">
        <p>Hola, ${datosUsuario.nombre}. Tu cuenta fue dada de baja.</p>
        <p class="nota">Contacta al administrador si crees que esto es un error.</p>
      </div>
    `;
  } else if (datosUsuario.rol === "admin") {
    notificacionesWrap?.classList.remove("oculto");
    iniciarCentroNotificaciones(user.uid);
    iniciarNavegacion("admin", {
      escaneoOrigen: (c) => iniciarEscaneoOrigen(c, datosUsuario, user.uid),
      panel: (c) => iniciarPanelResumenAdmin(c),
      solicitudes: (c) => renderEquipoYPropia(c,
        (d) => iniciarGestionSolicitudes(d, user.uid, datosUsuario.nombre),
        (d) => iniciarVistaEmpleado(d, datosUsuario, user.uid)
      ),
      vacaciones: (c) => renderEquipoYPropia(c,
        (d) => iniciarGestionVacaciones(d, user.uid, datosUsuario.nombre),
        (d) => iniciarVistaVacacionesEmpleado(d, datosUsuario, user.uid)
      ),
      calendarioVacaciones: (c) => iniciarCalendarioVacaciones(c),
      faltas: (c) => iniciarGestionFaltas(c, user.uid, datosUsuario.nombre),
      catalogo: (c) => iniciarPanelAdmin(c, user.uid),
      organigrama: (c) => iniciarOrganigrama(c),
      reportes: (c) => iniciarReportesAdmin(c),
      configuracion: (c) => iniciarConfiguracion(c)
    }, "panel");
  } else if (datosUsuario.rol === "empleado") {
    notificacionesWrap?.classList.remove("oculto");
    iniciarCentroNotificaciones(user.uid);
    iniciarNavegacion("empleado", {
      escaneoOrigen: (c) => iniciarEscaneoOrigen(c, datosUsuario, user.uid),
      horasExtra: (c) => iniciarVistaEmpleado(c, datosUsuario, user.uid),
      vacaciones: (c) => iniciarVistaVacacionesEmpleado(c, datosUsuario, user.uid),
      faltas: (c) => iniciarVistaEmpleadoFaltas(c, datosUsuario, user.uid)
    }, "horasExtra");
  } else if (datosUsuario.rol === "supervisor") {
    notificacionesWrap?.classList.remove("oculto");
    iniciarCentroNotificaciones(user.uid);
    iniciarNavegacion("supervisor", {
      escaneoOrigen: (c) => iniciarEscaneoOrigen(c, datosUsuario, user.uid),
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
      calendarioVacaciones: (c) => iniciarCalendarioVacaciones(c, { uidSupervisor: user.uid }),
      reportes: (c) => iniciarReportesSupervisor(c, user.uid)
    }, "panel");
  } else {
    detenerCentroNotificaciones();
    notificacionesWrap?.classList.add("oculto");
    ocultarNavegacion();
    contenidoApp.innerHTML = `<p>No se reconoce tu rol. Contacta al administrador.</p>`;
  }

  mostrarVista(vistaApp);
});
