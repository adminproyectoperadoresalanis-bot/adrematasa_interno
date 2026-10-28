// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/public/js/actualizacion.js
// ##########################################################################
// Cinta "Hay una versión nueva" (2026-10-28, pedido de Ivan).
// La app instalada en el celular no tiene botón de recargar, y jalar hacia
// abajo no recarga. publicar.sh escribe public/version.json con la fecha de
// cada publicación; aquí se lee al abrir la app y cada vez que se regresa a
// ella. Si cambió, sale una cinta con "Actualizar" (recarga la página).
// firebase.json manda los .js/.css/.html/.json con Cache-Control: no-cache,
// así que la recarga trae lo más nuevo.

const URL_VERSION = "/version.json";
const CADA_MS = 10 * 60 * 1000;
let versionCargada = null;

async function leerVersion() {
  try {
    const r = await fetch(`${URL_VERSION}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.version ? String(j.version) : null;
  } catch (e) {
    return null;
  }
}

function mostrarCinta() {
  if (document.getElementById("cinta-version")) return;
  const c = document.createElement("div");
  c.id = "cinta-version";
  c.setAttribute("role", "status");
  c.style.cssText = "position:fixed;left:8px;right:8px;top:8px;z-index:9999;background:#2C1E0F;color:#fff;" +
    "border-radius:12px;padding:12px 14px;box-shadow:0 6px 20px rgba(0,0,0,.25);display:flex;gap:10px;" +
    "align-items:center;justify-content:space-between;flex-wrap:wrap;font:14px/1.4 -apple-system,'Segoe UI',Roboto,sans-serif;";
  const t = document.createElement("span");
  t.textContent = "Hay una versión nueva de la app.";
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = "Actualizar";
  b.style.cssText = "background:#fff;color:#2C1E0F;border:0;border-radius:8px;padding:8px 14px;font-weight:700;font-size:14px;cursor:pointer;";
  b.addEventListener("click", () => window.location.reload());
  c.appendChild(t);
  c.appendChild(b);
  document.body.appendChild(c);
}

async function revisar() {
  const v = await leerVersion();
  if (!v) return;
  if (!versionCargada) { versionCargada = v; return; }
  if (v !== versionCargada) mostrarCinta();
}

revisar();
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") revisar(); });
setInterval(revisar, CADA_MS);