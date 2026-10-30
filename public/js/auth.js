// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/public/js/auth.js
// ##########################################################################
import { auth, db } from "./firebase-config.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";
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
import { iniciarEscaneoOrigen, APP_VERSION } from "./escaneoOrigen.js";
import { iniciarAutorizacionesExtra } from "./autorizacionesExtra.js";
import { iniciarSolicitudesOperadores, iniciarOrdenesTrabajo, iniciarOperadoresRegistrados, iniciarAlertasOperadores, detenerAlertasOperadores } from "./operadores.js";
import { iniciarAlertasRH, detenerAlertasRH } from "./alertasRH.js";
import { iniciarAlertasQR, detenerAlertasQR } from "./alertasQR.js";
import { iniciarTurnos } from "./turnos.js";
import { iniciarAsignacion } from "./asignacion.js";
import { iniciarRentabilidad } from "./rentabilidad.js";
import { iniciarMantenimiento } from "./mantenimiento.js";
import { iniciarComercial } from "./comercial.js";
import "./actualizacion.js"; // 2026-10-28: cinta "Hay una versión nueva"
import { iniciarAsistencia } from "./asistencia.js";
import { iniciarInventario } from "./inventario.js";

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

// Versión de la app en el menú de cuenta (2026-09-14, pedido de Ivan):
// mismo APP_VERSION que escaneoOrigen.js ya usa para comparar contra
// version.json y decidir si mostrar el banner de "hay una versión
// nueva" — aquí nomás se muestra, sin comparar nada. Se inserta una sola
// vez, justo debajo del rol ("Admin"/"Supervisor"/etc.), sin depender de
// que el HTML estático ya traiga el elemento.
if (rolUsuarioSpan && !document.getElementById("version-usuario")) {
  const versionUsuarioSpan = document.createElement("span");
  versionUsuarioSpan.id = "version-usuario";
  versionUsuarioSpan.style.cssText = "display:block;font-size:11px;color:#a8a29a;margin-top:2px;";
  versionUsuarioSpan.textContent = `v${APP_VERSION}`;
  rolUsuarioSpan.insertAdjacentElement("afterend", versionUsuarioSpan);
}

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

// Acceso a Utilidades por área (paso 2, 12 oct 2026): devuelve la lista de
// opciones de Utilidades que puede ver este usuario según su área
// (`usuarios.area`), leída de `configuracion/accesosUtilidades`.
//   - null  → ver todas: todavía no se ha guardado ninguna configuración (así
//             el cambio no deja a nadie sin nada el día que se publica).
//   - []    → ninguna: sin área asignada, área sin casillas marcadas, o no se
//             pudo leer la configuración.
// El admin no pasa por aquí: siempre ve todo.
async function opcionesUtilidadesPermitidas(datosUsuario) {
  try {
    const snap = await getDoc(doc(db, "configuracion", "accesosUtilidades"));
    if (!snap.exists()) return null;
    const porArea = snap.data().porArea || {};
    const lista = porArea[datosUsuario.area];
    return Array.isArray(lista) ? lista : [];
  } catch (err) {
    console.error("No se pudo leer accesosUtilidades:", err);
    return [];
  }
}

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

// Recuperar contraseña: llama a la Cloud Function que genera el link
// con Admin SDK y lo manda por Brevo (el correo nativo de Firebase
// lo filtra el servidor corporativo de Alanis).
const funciones = getFunctions(undefined, "us-central1");
const enviarResetContrasena = httpsCallable(funciones, "enviarResetContrasena");

const formRecuperar = document.getElementById("form-recuperar");
const mensajeRecuperar = document.getElementById("mensaje-recuperar");
const errorRecuperar = document.getElementById("error-recuperar");

formRecuperar?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (mensajeRecuperar) mensajeRecuperar.textContent = "";
  if (errorRecuperar) errorRecuperar.textContent = "";

  const correo = document.getElementById("recuperar-correo").value.trim().toLowerCase();

  if (!correo.endsWith(DOMINIO_ALANIS)) {
    if (errorRecuperar) errorRecuperar.textContent = `Debes usar tu correo Alanis (${DOMINIO_ALANIS})`;
    return;
  }

  const btnEnviar = formRecuperar.querySelector("button[type=submit]");
  if (btnEnviar) btnEnviar.disabled = true;

  try {
    await enviarResetContrasena({ email: correo });
    if (mensajeRecuperar) {
      mensajeRecuperar.textContent =
        `Listo. Si ese correo tiene una cuenta activa, en un momento recibirás el enlace para restablecer tu contraseña.`;
    }
    formRecuperar.reset();
  } catch (err) {
    if (errorRecuperar) {
      errorRecuperar.textContent = "Ocurrió un error al enviar el correo. Intenta de nuevo o contacta al administrador.";
    }
  } finally {
    if (btnEnviar) btnEnviar.disabled = false;
  }
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

// 2026-10-28 (caso de Litzy): si alguien tiene cuenta pero no ficha en
// usuarios (el guardado falló al registrarse), en vez de dejarlo atorado en
// "No se encontró tu perfil" se le pide su nombre y se crea la ficha como
// pendiente, igual que el registro normal. Así le aparece al admin en
// Registros pendientes.
function mostrarCompletarRegistro(user) {
  const correo = String(user.email || "");
  contenidoApp.innerHTML = `
    <div class="panel" style="max-width:520px;margin:0 auto;">
      <h2 style="margin-top:0;">Completa tu registro</h2>
      <p class="nota">Tu cuenta se creó, pero falta tu ficha de empleado. Escribe tu nombre completo y envíala; el administrador la revisará para darte acceso.</p>
      <p class="nota" id="completar-correo"></p>
      <label for="completar-nombre">Nombre completo</label>
      <input type="text" id="completar-nombre" maxlength="120" autocomplete="name">
      <div class="error" id="completar-error"></div>
      <div class="acciones-form" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" id="btn-completar">Enviar registro</button>
        <button type="button" class="secundario" id="btn-completar-salir">Cerrar sesión</button>
      </div>
    </div>`;
  contenidoApp.querySelector("#completar-correo").textContent = "Cuenta: " + correo;
  const previo = document.getElementById("registro-nombre");
  if (previo && previo.value.trim()) contenidoApp.querySelector("#completar-nombre").value = previo.value.trim();
  contenidoApp.querySelector("#btn-completar-salir").addEventListener("click", () => signOut(auth));
  contenidoApp.querySelector("#btn-completar").addEventListener("click", async (ev) => {
    const err = contenidoApp.querySelector("#completar-error");
    err.textContent = "";
    const nombre = contenidoApp.querySelector("#completar-nombre").value.trim();
    if (nombre.length < 3) { err.textContent = "Escribe tu nombre completo."; return; }
    if (!correo.toLowerCase().endsWith(DOMINIO_ALANIS)) { err.textContent = `Esta cuenta no es un correo Alanis (${DOMINIO_ALANIS}). Contacta al administrador.`; return; }
    ev.target.disabled = true;
    try {
      await setDoc(doc(db, "usuarios", user.uid), {
        nombre,
        email: correo,
        rol: "empleado",
        supervisorId: null,
        estatus: "pendiente",
        creadoEn: new Date().toISOString()
      });
      window.location.reload();
    } catch (e) {
      err.textContent = "No se pudo enviar: " + (e.message || e);
      ev.target.disabled = false;
    }
  });
}

onAuthStateChanged(auth, async (user) => {
  detenerAlertasRH();
  detenerAlertasQR();
  detenerAlertasOperadores();
  if (!user) {
    detenerCentroNotificaciones();
    notificacionesWrap?.classList.add("oculto");
    mostrarVista(vistaLogin);
    return;
  }

  mostrarVista(vistaCargando);

  const refUsuario = doc(db, "usuarios", user.uid);
  let snap = await getDoc(refUsuario);
  // 2026-10-28: justo al registrarse, la cuenta existe un instante antes que su
  // ficha (usuarios/{uid}). Se reintenta unos segundos antes de darla por faltante.
  for (let i = 0; i < 3 && !snap.exists(); i++) {
    await new Promise(r => setTimeout(r, 1200));
    snap = await getDoc(refUsuario);
  }

  if (!snap.exists()) {
    detenerCentroNotificaciones();
    notificacionesWrap?.classList.add("oculto");
    mostrarCompletarRegistro(user);
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
      operadoresSolicitudes: (c) => iniciarSolicitudesOperadores(c),
      operadoresOrdenes: (c) => iniciarOrdenesTrabajo(c, datosUsuario.nombre),
      operadoresRegistrados: (c) => iniciarOperadoresRegistrados(c),
      operadoresTurnos: (c) => iniciarTurnos(c, datosUsuario, user.uid),
      traficoAsignacion: (c) => iniciarAsignacion(c, datosUsuario),
      operadoresAsistencia: (c) => iniciarAsistencia(c),
      inventario: (c) => iniciarInventario(c, datosUsuario, user.uid),
      mantenimiento: (c) => iniciarMantenimiento(c, datosUsuario, user.uid),
      comercial: (c) => iniciarComercial(c, datosUsuario, user.uid, user.email),
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
      autorizacionesExtra: (c) => iniciarAutorizacionesExtra(c, user.uid, datosUsuario.nombre),
      catalogo: (c) => iniciarPanelAdmin(c, user.uid),
      organigrama: (c) => iniciarOrganigrama(c),
      reportes: (c) => iniciarReportesAdmin(c),
      configuracion: (c) => iniciarConfiguracion(c),
      rentabilidad: (c) => iniciarRentabilidad(c, datosUsuario, user.uid)
    }, "panel", null, user.email);
    iniciarAlertasRH("admin", user.uid);
    iniciarAlertasQR(datosUsuario);
    iniciarAlertasOperadores();
  } else if (datosUsuario.rol === "empleado") {
    notificacionesWrap?.classList.remove("oculto");
    iniciarCentroNotificaciones(user.uid);
    const permitidasEmpleado = await opcionesUtilidadesPermitidas(datosUsuario);
    iniciarNavegacion("empleado", {
      escaneoOrigen: (c) => iniciarEscaneoOrigen(c, datosUsuario, user.uid),
      operadoresSolicitudes: (c) => iniciarSolicitudesOperadores(c),
      operadoresOrdenes: (c) => iniciarOrdenesTrabajo(c, datosUsuario.nombre),
      operadoresRegistrados: (c) => iniciarOperadoresRegistrados(c),
      operadoresTurnos: (c) => iniciarTurnos(c, datosUsuario, user.uid),
      traficoAsignacion: (c) => iniciarAsignacion(c, datosUsuario),
      operadoresAsistencia: (c) => iniciarAsistencia(c),
      inventario: (c) => iniciarInventario(c, datosUsuario, user.uid),
      mantenimiento: (c) => iniciarMantenimiento(c, datosUsuario, user.uid),
      comercial: (c) => iniciarComercial(c, datosUsuario, user.uid, user.email),
      horasExtra: (c) => iniciarVistaEmpleado(c, datosUsuario, user.uid),
      vacaciones: (c) => iniciarVistaVacacionesEmpleado(c, datosUsuario, user.uid),
      faltas: (c) => iniciarVistaEmpleadoFaltas(c, datosUsuario, user.uid)
    }, "utilidades", permitidasEmpleado);
    if (!Array.isArray(permitidasEmpleado) || permitidasEmpleado.includes("validacionQR")) {
      iniciarAlertasQR(datosUsuario);
    }
    if (!Array.isArray(permitidasEmpleado) || permitidasEmpleado.includes("operadores")) {
      iniciarAlertasOperadores();
    }
  } else if (datosUsuario.rol === "supervisor") {
    notificacionesWrap?.classList.remove("oculto");
    iniciarCentroNotificaciones(user.uid);
    const permitidasSupervisor = await opcionesUtilidadesPermitidas(datosUsuario);
    iniciarNavegacion("supervisor", {
      escaneoOrigen: (c) => iniciarEscaneoOrigen(c, datosUsuario, user.uid),
      operadoresSolicitudes: (c) => iniciarSolicitudesOperadores(c),
      operadoresOrdenes: (c) => iniciarOrdenesTrabajo(c, datosUsuario.nombre),
      operadoresRegistrados: (c) => iniciarOperadoresRegistrados(c),
      operadoresTurnos: (c) => iniciarTurnos(c, datosUsuario, user.uid),
      traficoAsignacion: (c) => iniciarAsignacion(c, datosUsuario),
      operadoresAsistencia: (c) => iniciarAsistencia(c),
      inventario: (c) => iniciarInventario(c, datosUsuario, user.uid),
      mantenimiento: (c) => iniciarMantenimiento(c, datosUsuario, user.uid),
      comercial: (c) => iniciarComercial(c, datosUsuario, user.uid, user.email),
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
    }, "panel", permitidasSupervisor);
    if (!Array.isArray(permitidasSupervisor) || permitidasSupervisor.includes("rh")) {
      iniciarAlertasRH("supervisor", user.uid);
    }
    if (!Array.isArray(permitidasSupervisor) || permitidasSupervisor.includes("validacionQR")) {
      iniciarAlertasQR(datosUsuario);
    }
    if (!Array.isArray(permitidasSupervisor) || permitidasSupervisor.includes("operadores")) {
      iniciarAlertasOperadores();
    }
  } else {
    detenerCentroNotificaciones();
    notificacionesWrap?.classList.add("oculto");
    ocultarNavegacion();
    contenidoApp.innerHTML = `<p>No se reconoce tu rol. Contacta al administrador.</p>`;
  }

  mostrarVista(vistaApp);
});