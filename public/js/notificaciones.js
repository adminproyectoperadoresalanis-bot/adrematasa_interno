import { db } from "./firebase-config.js";
import {
  collection, addDoc, doc, updateDoc, onSnapshot, query, where, writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// Crea una notificación in-app para "destinatarioId". Se usa desde
// aprobaciones.js, aprobacionesVacaciones.js, admin.js y equipo.js cada vez
// que pasa algo que le interesa al empleado (le aprueban/rechazan algo, le
// cambian su horario). Nunca truena hacia quien la llama: si falla, solo se
// registra en consola — no queremos que un error de notificación tumbe la
// acción principal (la aprobación, el guardado del horario, etc).
export async function crearNotificacion(destinatarioId, { titulo, mensaje, tipo } = {}) {
  if (!destinatarioId) return;
  try {
    await addDoc(collection(db, "notificaciones"), {
      destinatarioId,
      titulo: titulo || "Notificación",
      mensaje: mensaje || "",
      tipo: tipo || "info",
      leida: false,
      creadoEn: new Date().toISOString()
    });
  } catch (err) {
    console.error("No se pudo crear la notificación:", err);
  }
}

// El botón de la campanita, su contador y el panel viven en el HTML estático
// de index.html (no se reconstruyen cada vez que cambia el usuario), así que
// este módulo guarda su propio estado a nivel de módulo en vez de depender
// de variables locales por-llamada.
let unsubscribeActual = null;
let notificacionesActuales = [];

export function iniciarCentroNotificaciones(uid) {
  const btn = document.getElementById("btn-notificaciones");
  const badge = document.getElementById("badge-notificaciones");
  const panel = document.getElementById("panel-notificaciones");
  const lista = document.getElementById("lista-notificaciones");
  const btnMarcarTodas = document.getElementById("btn-marcar-todas-leidas");
  if (!btn || !badge || !panel || !lista) return;

  // Si había un listener de otra sesión (otro usuario, o el mismo tras
  // recargar), se cierra antes de abrir el nuevo para no mezclar datos.
  if (unsubscribeActual) {
    unsubscribeActual();
    unsubscribeActual = null;
  }
  notificacionesActuales = [];
  panel.classList.add("oculto");

  // Ojo: solo se filtra por destinatarioId, sin orderBy en la consulta —
  // combinar un "where" con un "orderBy" en un campo distinto le exige a
  // Firestore un índice compuesto que este proyecto no tiene creado (por
  // eso el resto de la app, ej. vacaciones.js, también ordena en JS en vez
  // de pedírselo a Firestore). El orden y el límite a 30 se hacen aquí abajo.
  const q = query(
    collection(db, "notificaciones"),
    where("destinatarioId", "==", uid)
  );

  unsubscribeActual = onSnapshot(q, (snap) => {
    const todas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    todas.sort((a, b) => (b.creadoEn || "").localeCompare(a.creadoEn || ""));
    notificacionesActuales = todas.slice(0, 30);
    renderPanel(badge, lista);
  }, (err) => {
    console.error("No se pudieron cargar las notificaciones:", err);
    lista.innerHTML = `<li class="notif-vacia">No se pudieron cargar tus notificaciones.</li>`;
  });

  // El click-handler del botón, el de "clic afuera para cerrar" y el de
  // "marcar todas" se enlazan una sola vez (el botón vive en HTML estático
  // que no se recrea). Usan siempre el estado más reciente vía la variable
  // de módulo "notificacionesActuales", así que funcionan bien aunque el
  // usuario cierre sesión y entre con otra cuenta después.
  if (!btn.dataset.listo) {
    btn.dataset.listo = "1";

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      panel.classList.toggle("oculto");
    });

    document.addEventListener("click", (e) => {
      if (!panel.classList.contains("oculto") && !panel.contains(e.target) && e.target !== btn) {
        panel.classList.add("oculto");
      }
    });

    lista.addEventListener("click", (e) => {
      const li = e.target.closest(".notif-item");
      if (!li) return;
      const n = notificacionesActuales.find(x => x.id === li.dataset.id);
      if (n && !n.leida) {
        updateDoc(doc(db, "notificaciones", n.id), { leida: true }).catch(err => console.error(err));
      }
    });

    btnMarcarTodas?.addEventListener("click", async (e) => {
      e.stopPropagation();
      const noLeidas = notificacionesActuales.filter(n => !n.leida);
      if (noLeidas.length === 0) return;
      try {
        const batch = writeBatch(db);
        noLeidas.forEach(n => batch.update(doc(db, "notificaciones", n.id), { leida: true }));
        await batch.commit();
      } catch (err) {
        console.error("No se pudieron marcar como leídas:", err);
      }
    });
  }
}

// Se llama al cerrar sesión, o cuando el estatus del usuario no le da acceso
// a la app (pendiente/rechazado/inactivo) — para no dejar un listener de
// Firestore corriendo de más, ni una campanita con datos del usuario anterior.
export function detenerCentroNotificaciones() {
  if (unsubscribeActual) {
    unsubscribeActual();
    unsubscribeActual = null;
  }
  notificacionesActuales = [];
  document.getElementById("panel-notificaciones")?.classList.add("oculto");
  const badge = document.getElementById("badge-notificaciones");
  if (badge) badge.classList.add("oculto");
  const lista = document.getElementById("lista-notificaciones");
  if (lista) lista.innerHTML = "";
}

function renderPanel(badge, lista) {
  const noLeidas = notificacionesActuales.filter(n => !n.leida).length;
  badge.textContent = noLeidas > 9 ? "9+" : String(noLeidas);
  badge.classList.toggle("oculto", noLeidas === 0);

  if (notificacionesActuales.length === 0) {
    lista.innerHTML = `<li class="notif-vacia">No tienes notificaciones.</li>`;
    return;
  }

  lista.innerHTML = notificacionesActuales.map(n => `
    <li class="notif-item ${n.leida ? "" : "notif-no-leida"}" data-id="${n.id}">
      <span class="notif-titulo">${escapeHtml(n.titulo)}</span>
      <span class="notif-mensaje">${escapeHtml(n.mensaje)}</span>
      <span class="notif-fecha">${formatearFecha(n.creadoEn)}</span>
    </li>
  `).join("");
}

function formatearFecha(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const fecha = d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
  const hora = d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  return `${fecha} · ${hora}`;
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto || "";
  return div.innerHTML;
}