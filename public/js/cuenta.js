import { auth } from "./firebase-config.js";
import {
  EmailAuthProvider, reauthenticateWithCredential, updatePassword
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";

// Disponible para cualquier rol (empleado, supervisor, admin) — vive en el
// encabezado de la app, no en la navegación por pestañas de cada rol. Sirve
// tanto para el uso normal ("quiero cambiar mi contraseña") como para que
// alguien reemplace la contraseña temporal que le dio el administrador
// (ver herramientas-admin/restablecer-contrasena.js) por una propia.
export function iniciarCambioContrasena() {
  const boton = document.getElementById("btn-cambiar-contrasena");
  if (!boton || boton.dataset.wired) return;
  boton.dataset.wired = "1";
  boton.addEventListener("click", abrirModal);
}

function abrirModal() {
  if (document.getElementById("modal-cambiar-contrasena")) return;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "modal-cambiar-contrasena";
  overlay.innerHTML = `
    <div class="modal-tarjeta">
      <h2>Cambiar contraseña</h2>
      <div id="cc-error" class="error"></div>
      <p id="cc-exito" class="nota nota-ok oculto"></p>
      <form id="form-cambiar-contrasena">
        <div class="modal-fila">
          <label>Contraseña actual
            <input type="password" id="cc-actual" required autocomplete="current-password">
          </label>
        </div>
        <div class="modal-fila">
          <label>Contraseña nueva
            <input type="password" id="cc-nueva" required minlength="6" autocomplete="new-password">
          </label>
          <label>Confirmar contraseña nueva
            <input type="password" id="cc-nueva2" required minlength="6" autocomplete="new-password">
          </label>
        </div>
        <div class="modal-acciones">
          <button type="button" class="secundario" id="cc-cancelar">Cerrar</button>
          <button type="submit" id="cc-guardar">Guardar</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  const errorDiv = overlay.querySelector("#cc-error");
  const exitoP = overlay.querySelector("#cc-exito");
  const form = overlay.querySelector("#form-cambiar-contrasena");
  const btnGuardar = overlay.querySelector("#cc-guardar");
  const btnCancelar = overlay.querySelector("#cc-cancelar");

  const cerrar = () => overlay.remove();
  btnCancelar.addEventListener("click", cerrar);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) cerrar();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorDiv.textContent = "";
    exitoP.classList.add("oculto");

    const actual = overlay.querySelector("#cc-actual").value;
    const nueva = overlay.querySelector("#cc-nueva").value;
    const nueva2 = overlay.querySelector("#cc-nueva2").value;

    if (nueva.length < 6) {
      errorDiv.textContent = "La contraseña nueva debe tener al menos 6 caracteres.";
      return;
    }
    if (nueva !== nueva2) {
      errorDiv.textContent = "Las contraseñas nuevas no coinciden.";
      return;
    }

    const usuario = auth.currentUser;
    if (!usuario) {
      errorDiv.textContent = "Tu sesión ya no está activa. Vuelve a iniciar sesión.";
      return;
    }

    btnGuardar.disabled = true;
    btnGuardar.textContent = "Guardando...";
    try {
      const credencial = EmailAuthProvider.credential(usuario.email, actual);
      await reauthenticateWithCredential(usuario, credencial);
      await updatePassword(usuario, nueva);
      exitoP.textContent = "Listo, tu contraseña quedó actualizada.";
      exitoP.classList.remove("oculto");
      form.querySelectorAll("input").forEach((i) => (i.value = ""));
      btnCancelar.textContent = "Cerrar";
    } catch (err) {
      errorDiv.textContent = traducirErrorContrasena(err);
    } finally {
      btnGuardar.disabled = false;
      btnGuardar.textContent = "Guardar";
    }
  });

  overlay.querySelector("#cc-actual").focus();
}

function traducirErrorContrasena(err) {
  const codigo = err.code || "";
  const mensajes = {
    "auth/wrong-password": "Tu contraseña actual no es correcta.",
    "auth/invalid-credential": "Tu contraseña actual no es correcta.",
    "auth/weak-password": "La contraseña nueva es muy débil.",
    "auth/too-many-requests": "Demasiados intentos. Espera un momento e intenta de nuevo.",
    "auth/requires-recent-login": "Por seguridad, cierra sesión y vuelve a entrar antes de cambiar tu contraseña."
  };
  return mensajes[codigo] || `Ocurrió un error (${codigo}). Intenta de nuevo.`;
}