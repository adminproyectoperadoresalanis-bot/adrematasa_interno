// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/public/js/avisosPush.js
// ##########################################################################
// Avisos push en el celular (2026-11-13, pedido de Ivan). Mismo esquema que
// js/avisos.js de Alanis Operadores, para ADREMATASA Interno:
// - Solo en celulares (iPhone/iPad/Android). En computadora no hace nada.
// - Cinta "Activa los avisos" hasta que se activen. En iPhone solo funciona
//   con la app agregada a la pantalla de inicio; si se abre en Safari, la
//   cinta explica cómo agregarla.
// - Al activar: pide permiso, obtiene el token del celular, lo registra con
//   registrarDispositivoAvisos y manda un aviso de prueba (avisoPrueba).
// - Cada vez que se abre la app revisa el token en silencio (puede cambiar).
// - Con la app abierta, el aviso igual se muestra.
// Qué avisos llegan lo deciden las funciones (avisosPushAdrematasa.js):
// todo lo que cae en la campanita + embarques McCain para Atención al cliente.
// Se carga desde index.html: <script type="module" src="js/avisosPush.js"></script>

import { auth } from "./firebase-config.js";
import { getApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";
import { getMessaging, getToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging.js";

// Llave pública web push (VAPID) de appadrematasainterno:
// Firebase → Configuración del proyecto → Cloud Messaging → Certificados push web.
const VAPID = "PEGA_AQUI_LA_LLAVE_VAPID";
const ALCANCE_SW = "/firebase-cloud-messaging-push-scope";
const CLAVE_TOKEN = "adr_avisos_token_";          // + uid
const CLAVE_DESPUES = "adr_avisos_despues_hasta";  // "Ahora no" / ✕: la oculta 7 días
const ICONO = "/img/logo-alanis.png";
const funciones = getFunctions(getApp(), "us-central1");

let regSW = null, escuchando = false, uidActual = null;

const leer = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } };
const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const esInstalada = () => (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
const esCelular = () => esIOS() || /android|mobi/i.test(navigator.userAgent);
const plataforma = () => esIOS() ? "ios" : (/android/i.test(navigator.userAgent) ? "android" : "otro");

// ---------- Cinta ----------
function estilos() {
  if (document.getElementById("adr-avisos-estilos")) return;
  const s = document.createElement("style");
  s.id = "adr-avisos-estilos";
  s.textContent =
    "#adr-avisos-cinta{position:fixed;left:8px;right:8px;top:calc(env(safe-area-inset-top,0px) + 8px);z-index:9998;background:#2C1E0F;color:#fff;" +
    "border-radius:12px;padding:12px 14px;box-shadow:0 6px 20px rgba(0,0,0,.25);font:14px/1.4 -apple-system,'Segoe UI',Roboto,sans-serif;}" +
    "#adr-avisos-cinta b{display:block;font-size:15px;margin-bottom:2px;}" +
    "#adr-avisos-cinta .av-btns{display:flex;gap:8px;margin-top:10px;}" +
    "#adr-avisos-cinta button{border:0;border-radius:8px;padding:9px 14px;font-size:14px;font-weight:700;cursor:pointer;}" +
    "#adr-avisos-cinta .av-si{background:#fff;color:#2C1E0F;}" +
    "#adr-avisos-cinta .av-no{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.5);}" +
    "#adr-avisos-cinta.av-ok{background:#3B7A1E;}#adr-avisos-cinta.av-err{background:#C0392B;}";
  document.head.appendChild(s);
}
function quitarCinta() { const c = document.getElementById("adr-avisos-cinta"); if (c) c.remove(); }
function cinta(titulo, texto, botones, tipo) {
  estilos(); quitarCinta();
  const c = document.createElement("div");
  c.id = "adr-avisos-cinta";
  if (tipo) c.className = tipo;
  const b = document.createElement("b"); b.textContent = titulo; c.appendChild(b);
  const p = document.createElement("div"); p.textContent = texto; c.appendChild(p);
  if (botones && botones.length) {
    const caja = document.createElement("div"); caja.className = "av-btns";
    botones.forEach(x => {
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = x.clase; btn.textContent = x.txt;
      btn.addEventListener("click", () => x.fn(btn));
      caja.appendChild(btn);
    });
    c.appendChild(caja);
  }
  document.body.appendChild(c);
  return c;
}
function mensaje(titulo, texto, tipo, segundos) {
  cinta(titulo, texto, [{ txt: "Cerrar", clase: "av-no", fn: quitarCinta }], tipo);
  if (segundos) setTimeout(quitarCinta, segundos * 1000);
}
function ahoraNo() { guardar(CLAVE_DESPUES, String(Date.now() + 7 * 24 * 3600 * 1000)); quitarCinta(); }

// ---------- Firebase Messaging ----------
async function soportado() {
  if (!("serviceWorker" in navigator) || !("Notification" in window)) return false;
  try { return await isSupported(); } catch (e) { return false; }
}
async function registrarSW() {
  if (!regSW) regSW = await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: ALCANCE_SW });
  return regSW;
}
async function obtenerYGuardarToken(forzar) {
  if (!VAPID || VAPID.startsWith("PEGA_AQUI")) throw new Error("Falta la llave VAPID en avisosPush.js.");
  const reg = await registrarSW();
  const token = await getToken(getMessaging(getApp()), { vapidKey: VAPID, serviceWorkerRegistration: reg });
  if (!token) throw new Error("El celular no entregó el token de avisos.");
  const clave = CLAVE_TOKEN + uidActual;
  if (forzar || leer(clave) !== token) {
    await httpsCallable(funciones, "registrarDispositivoAvisos")({ token, plataforma: plataforma(), instalada: !!esInstalada() });
    guardar(clave, token);
  }
  return token;
}
// Con la app abierta, Firebase no muestra el aviso solo: lo mostramos aquí.
function escucharPrimerPlano() {
  if (escuchando) return;
  escuchando = true;
  onMessage(getMessaging(getApp()), (p) => {
    const n = (p && p.notification) || {};
    const titulo = n.title || "Adrematasa Interno", cuerpo = n.body || "";
    registrarSW()
      .then(reg => reg.showNotification(titulo, { body: cuerpo, icon: ICONO, data: { link: "/" } }))
      .catch(() => mensaje(titulo, cuerpo, null, 10));
  });
}

async function activar(btn) {
  btn.disabled = true;
  btn.textContent = "Activando…";
  let permiso = "default";
  // En iPhone el permiso se pide justo al tocar el botón, antes de cualquier espera.
  try { permiso = await Notification.requestPermission(); } catch (e) { permiso = "default"; }
  if (permiso !== "granted") {
    mensaje("Avisos no activados",
      esIOS()
        ? "Si cambias de opinión: Ajustes del iPhone > Notificaciones > Adrematasa > Permitir notificaciones."
        : "Si cambias de opinión: toca el candado junto a la dirección > Permisos > Notificaciones > Permitir.",
      "av-err");
    return;
  }
  try {
    await obtenerYGuardarToken(true);
    escucharPrimerPlano();
    const r = await httpsCallable(funciones, "avisoPrueba")({});
    const d = (r && r.data) || {};
    if (d.enviados > 0) mensaje("Avisos activados", "Te enviamos un aviso de prueba. Debe llegarte en unos segundos.", "av-ok", 10);
    else mensaje("Avisos activados", "Quedó registrado tu celular, pero el aviso de prueba no salió. Avísale a Ivan.", "av-err");
  } catch (e) {
    console.error("[avisos]", e);
    mensaje("No se pudieron activar", (e && e.message) || String(e), "av-err");
  }
}

async function revisar(user) {
  quitarCinta();
  uidActual = user ? user.uid : null;
  if (!user || !esCelular()) return;

  if (!(await soportado())) {
    if (esIOS() && !esInstalada()) {
      if (Number(leer(CLAVE_DESPUES) || 0) > Date.now()) return;
      cinta("Recibe avisos en tu celular",
        "En iPhone: toca Compartir y luego \"Agregar a pantalla de inicio\". Después abre Adrematasa desde ese ícono.",
        [{ txt: "Entendido", clase: "av-no", fn: ahoraNo }]);
    }
    return;
  }
  registrarSW().catch(e => console.warn("[avisos] service worker:", e));

  if (Notification.permission === "granted") {
    escucharPrimerPlano();
    obtenerYGuardarToken(false).catch(e => console.warn("[avisos] token:", e));
    return;
  }
  if (Notification.permission === "denied") return;
  if (Number(leer(CLAVE_DESPUES) || 0) > Date.now()) return;

  cinta("Activa los avisos",
    "Te llegarán al celular las solicitudes y respuestas de RH y, si eres de Atención al cliente, los embarques McCain nuevos.",
    [{ txt: "Activar avisos", clase: "av-si", fn: activar },
     { txt: "Ahora no", clase: "av-no", fn: ahoraNo }]);
}

onAuthStateChanged(auth, (user) => {
  // Espera un momento a que la app termine de pintar la pantalla.
  setTimeout(() => revisar(user).catch(e => console.warn("[avisos]", e)), 1500);
});