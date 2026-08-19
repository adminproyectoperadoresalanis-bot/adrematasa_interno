import { db } from "./firebase-config.js";
import {
  collection, onSnapshot, doc, updateDoc, query, where
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const NOMBRES_DIA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

// Mismo horario semanal (con comida) que en Catálogo de empleados (admin.js) —
// se duplica aquí porque el supervisor edita el horario de su equipo desde
// este panel, sin acceso al resto de los campos que sí administra el admin.
function horarioSemanalPorDefault(diaDescansoActual) {
  return NOMBRES_DIA.map((_, i) => (
    i === diaDescansoActual
      ? { descanso: true, horaInicio: "", horaFin: "", comida: 0 }
      : { descanso: false, horaInicio: "08:00", horaFin: "17:00", comida: 1 }
  ));
}

function normalizarHorarioSemanal(u) {
  if (Array.isArray(u.horarioSemanal) && u.horarioSemanal.length === 7) {
    return u.horarioSemanal.map(dia => ({
      descanso: !!(dia && dia.descanso),
      horaInicio: (dia && dia.horaInicio) || "",
      horaFin: (dia && dia.horaFin) || "",
      comida: Number(dia && dia.comida) || 0
    }));
  }
  return horarioSemanalPorDefault(u.diaDescanso ?? 0);
}

function calcularHorasDia(horaInicio, horaFin) {
  if (!horaInicio || !horaFin) return 0;
  const [hi, mi] = horaInicio.split(":").map(Number);
  const [hf, mf] = horaFin.split(":").map(Number);
  if ([hi, mi, hf, mf].some(n => isNaN(n))) return 0;
  let minutos = (hf * 60 + mf) - (hi * 60 + mi);
  if (minutos <= 0) minutos += 24 * 60; // turno que cruza la medianoche
  return minutos / 60;
}

function calcularHorasNetasDia(horaInicio, horaFin, comida) {
  return Math.max(0, calcularHorasDia(horaInicio, horaFin) - (Number(comida) || 0));
}

function calcularHorasSemanales(horarioSemanal) {
  return horarioSemanal.reduce(
    (acc, dia) => acc + (dia.descanso ? 0 : calcularHorasNetasDia(dia.horaInicio, dia.horaFin, dia.comida)),
    0
  );
}

function filasHorarioSemanal(horarioSemanal) {
  return horarioSemanal.map((dia, i) => `
    <tr data-dia="${i}">
      <td>${NOMBRES_DIA[i]}</td>
      <td class="centrado"><input type="checkbox" class="chk-descanso-dia" ${dia.descanso ? "checked" : ""}></td>
      <td><input type="time" class="input-hora-inicio-dia" value="${dia.horaInicio || ""}" ${dia.descanso ? "disabled" : ""}></td>
      <td><input type="time" class="input-hora-fin-dia" value="${dia.horaFin || ""}" ${dia.descanso ? "disabled" : ""}></td>
      <td><input type="number" min="0" step="0.25" class="input-comida-dia" value="${dia.comida || 0}" ${dia.descanso ? "disabled" : ""}></td>
      <td class="centrado horas-dia-valor">${dia.descanso ? "—" : calcularHorasNetasDia(dia.horaInicio, dia.horaFin, dia.comida).toFixed(2)}</td>
    </tr>
  `).join("");
}

export function iniciarMiEquipo(contenedor, uid) {
  contenedor.innerHTML = `
    <section class="panel">
      <h2>Mi equipo</h2>
      <p class="nota">Empleados que tienes asignados. Puedes ajustar su horario semanal aquí; el resto de los datos (rol, saldo de vacaciones, etc.) los administra el admin desde Catálogo de empleados.</p>
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
              <th>Horario semanal</th>
            </tr>
          </thead>
          <tbody id="tbody-mi-equipo"><tr><td colspan="6">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>
  `;

  const tbody = contenedor.querySelector("#tbody-mi-equipo");
  const errorDiv = contenedor.querySelector("#equipo-error");
  let equipoActual = [];

  onSnapshot(query(collection(db, "usuarios"), where("supervisorId", "==", uid)), (snap) => {
    equipoActual = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    equipoActual.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
    render(equipoActual);
  }, (err) => {
    errorDiv.textContent = "No se pudo cargar tu equipo: " + err.message;
  });

  function render(equipo) {
    if (equipo.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6">Todavía no tienes empleados asignados.</td></tr>`;
      return;
    }

    tbody.innerHTML = equipo.map(u => {
      const horas = calcularHorasSemanales(normalizarHorarioSemanal(u));
      return `
        <tr data-id="${u.id}">
          <td>${escapeHtml(u.nombre || "")}</td>
          <td>${escapeHtml(u.email || "")}</td>
          <td><span class="valor-fijo">${escapeHtml(u.rol || "")}</span></td>
          <td><span class="valor-fijo">${escapeHtml(u.estatus || "")}</span></td>
          <td><span class="valor-fijo">${u.diasVacacionesDisponibles ?? 0}</span></td>
          <td>
            <span class="valor-fijo">${horas.toFixed(2)} hrs/sem</span>
            <button type="button" class="secundario btn-editar-horario">Editar horario</button>
          </td>
        </tr>
      `;
    }).join("");

    tbody.querySelectorAll(".btn-editar-horario").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.closest("tr").dataset.id;
        const u = equipoActual.find(x => x.id === id);
        if (u) abrirModalHorario(u);
      });
    });
  }

  function abrirModalHorario(u) {
    cerrarModal();

    const horarioSemanal = normalizarHorarioSemanal(u);

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.id = "modal-editar-horario-equipo";
    overlay.innerHTML = `
      <div class="modal-tarjeta">
        <h2>Horario semanal — ${escapeHtml(u.nombre || "")}</h2>
        <div id="modal-horario-error" class="error"></div>

        <div class="horario-semanal">
          <p class="nota">Marca "Descanso" en el día que no labora; en los demás captura su hora de entrada, salida y comida. El total de horas laboradas se calcula solo.</p>
          <div class="tabla-wrap">
            <table class="tabla tabla-horario">
              <thead>
                <tr><th>Día</th><th>Descanso</th><th>Entrada</th><th>Salida</th><th>Comida (hrs)</th><th>Horas</th></tr>
              </thead>
              <tbody id="tbody-horario-semanal">
                ${filasHorarioSemanal(horarioSemanal)}
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="5" class="total-horas-label">Total horas laboradas / semana</td>
                  <td id="total-horas-semana" class="total-horas-valor">${calcularHorasSemanales(horarioSemanal).toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div class="modal-acciones">
          <button type="button" class="secundario" id="modal-btn-cancelar-horario">Cancelar</button>
          <button type="button" id="modal-btn-guardar-horario">Guardar</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const tbodyHorario = overlay.querySelector("#tbody-horario-semanal");
    const totalHorasSpan = overlay.querySelector("#total-horas-semana");
    const modalErrorDiv = overlay.querySelector("#modal-horario-error");

    function leerFilaHorario(fila) {
      const descanso = fila.querySelector(".chk-descanso-dia").checked;
      const horaInicio = fila.querySelector(".input-hora-inicio-dia").value;
      const horaFin = fila.querySelector(".input-hora-fin-dia").value;
      const comida = Number(fila.querySelector(".input-comida-dia").value) || 0;
      return { descanso, horaInicio, horaFin, comida };
    }

    function leerHorarioSemanalDelForm() {
      return [...tbodyHorario.querySelectorAll("tr[data-dia]")].map(leerFilaHorario);
    }

    function actualizarFilaHorario(fila) {
      const inputInicio = fila.querySelector(".input-hora-inicio-dia");
      const inputFin = fila.querySelector(".input-hora-fin-dia");
      const inputComida = fila.querySelector(".input-comida-dia");
      const celdaHoras = fila.querySelector(".horas-dia-valor");
      const { descanso, horaInicio, horaFin, comida } = leerFilaHorario(fila);

      inputInicio.disabled = descanso;
      inputFin.disabled = descanso;
      inputComida.disabled = descanso;
      celdaHoras.textContent = descanso ? "—" : calcularHorasNetasDia(horaInicio, horaFin, comida).toFixed(2);
    }

    function actualizarTotalHorasSemana() {
      totalHorasSpan.textContent = calcularHorasSemanales(leerHorarioSemanalDelForm()).toFixed(2);
    }

    tbodyHorario.querySelectorAll("tr[data-dia]").forEach(fila => {
      fila.querySelector(".chk-descanso-dia").addEventListener("change", () => {
        actualizarFilaHorario(fila);
        actualizarTotalHorasSemana();
      });
      fila.querySelectorAll("input[type='time'], .input-comida-dia").forEach(input => {
        input.addEventListener("input", () => {
          actualizarFilaHorario(fila);
          actualizarTotalHorasSemana();
        });
      });
    });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cerrarModal();
    });
    overlay.querySelector("#modal-btn-cancelar-horario").addEventListener("click", cerrarModal);

    overlay.querySelector("#modal-btn-guardar-horario").addEventListener("click", async () => {
      modalErrorDiv.textContent = "";

      const filasHorario = [...tbodyHorario.querySelectorAll("tr[data-dia]")];
      let horarioValido = true;
      const horarioSemanalNuevo = filasHorario.map(fila => {
        const { descanso, horaInicio, horaFin, comida } = leerFilaHorario(fila);
        const inputInicio = fila.querySelector(".input-hora-inicio-dia");
        const inputFin = fila.querySelector(".input-hora-fin-dia");
        const incompleto = !descanso && (!horaInicio || !horaFin);
        inputInicio.classList.toggle("campo-vacio", incompleto && !horaInicio);
        inputFin.classList.toggle("campo-vacio", incompleto && !horaFin);
        if (incompleto) horarioValido = false;
        return descanso
          ? { descanso: true, horaInicio: "", horaFin: "", comida: 0 }
          : { descanso: false, horaInicio, horaFin, comida };
      });

      if (!horarioValido) {
        modalErrorDiv.textContent = "Falta hora de entrada y/o salida en algún día que no es descanso.";
        return;
      }

      const horasSemanales = Number(calcularHorasSemanales(horarioSemanalNuevo).toFixed(2));
      const primerDescanso = horarioSemanalNuevo.findIndex(dia => dia.descanso);
      const diaDescanso = primerDescanso === -1 ? (u.diaDescanso ?? 0) : primerDescanso;

      try {
        await updateDoc(doc(db, "usuarios", u.id), {
          horarioSemanal: horarioSemanalNuevo,
          horasSemanales,
          diaDescanso
        });
        cerrarModal();
      } catch (err) {
        modalErrorDiv.textContent = "No se pudo guardar: " + err.message;
      }
    });
  }

  function cerrarModal() {
    document.getElementById("modal-editar-horario-equipo")?.remove();
  }
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto || "";
  return div.innerHTML;
}