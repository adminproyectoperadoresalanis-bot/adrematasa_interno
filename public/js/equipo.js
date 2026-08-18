import { db } from "./firebase-config.js";
import {
  collection, onSnapshot, doc, updateDoc, query, where
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const NOMBRES_DIA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export function iniciarMiEquipo(contenedor, uid) {
  contenedor.innerHTML = `
    <section class="panel">
      <h2>Mi equipo</h2>
      <p class="nota">Empleados que tienes asignados. Puedes ajustar su día de descanso aquí; el resto de los datos (rol, saldo de vacaciones, etc.) los administra el admin desde Catálogo de empleados.</p>
      <div id="equipo-error" class="error"></div>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-mi-equipo">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Correo</th>
              <th>Rol</th>
              <th>Estatus</th>
              <th>Días vacaciones</th>
              <th>Día de descanso</th>
            </tr>
          </thead>
          <tbody id="tbody-mi-equipo"><tr><td colspan="6">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>
  `;

  const tbody = contenedor.querySelector("#tbody-mi-equipo");
  const errorDiv = contenedor.querySelector("#equipo-error");

  onSnapshot(query(collection(db, "usuarios"), where("supervisorId", "==", uid)), (snap) => {
    const equipo = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    equipo.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
    render(equipo);
  }, (err) => {
    errorDiv.textContent = "No se pudo cargar tu equipo: " + err.message;
  });

  function render(equipo) {
    if (equipo.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6">Todavía no tienes empleados asignados.</td></tr>`;
      return;
    }

    tbody.innerHTML = equipo.map(u => {
      const diaDescansoActual = u.diaDescanso ?? 0;
      const opcionesDiaDescanso = NOMBRES_DIA.map((nombreDia, i) =>
        `<option value="${i}" ${diaDescansoActual === i ? "selected" : ""}>${nombreDia}</option>`
      ).join("");

      return `
        <tr data-id="${u.id}">
          <td>${escapeHtml(u.nombre || "")}</td>
          <td>${escapeHtml(u.email || "")}</td>
          <td><span class="valor-fijo">${escapeHtml(u.rol || "")}</span></td>
          <td><span class="valor-fijo">${escapeHtml(u.estatus || "")}</span></td>
          <td><span class="valor-fijo">${u.diasVacacionesDisponibles ?? 0}</span></td>
          <td><select class="sel-dia-descanso">${opcionesDiaDescanso}</select></td>
        </tr>
      `;
    }).join("");

    tbody.querySelectorAll("tr[data-id]").forEach(fila => {
      const id = fila.dataset.id;
      fila.querySelector(".sel-dia-descanso").addEventListener("change", async (e) => {
        errorDiv.textContent = "";
        try {
          await updateDoc(doc(db, "usuarios", id), { diaDescanso: Number(e.target.value) });
        } catch (err) {
          errorDiv.textContent = "No se pudo guardar el cambio: " + err.message;
        }
      });
    });
  }
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto || "";
  return div.innerHTML;
}