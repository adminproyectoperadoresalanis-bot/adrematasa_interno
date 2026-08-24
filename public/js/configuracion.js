import { db } from "./firebase-config.js";
import {
  doc, setDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { UMBRALES_DEFAULT } from "./vacacionesCalculo.js";
import { AREAS_DEFAULT } from "./estructuraOrganizacional.js";

export function iniciarConfiguracion(contenedor) {
  contenedor.innerHTML = `
    <section class="panel">
      <h2>Días de vacaciones por antigüedad</h2>
      <p class="nota">
        Con base en la Ley Federal del Trabajo vigente (reforma de "vacaciones dignas").
        "Desde" es la cantidad de años cumplidos de antigüedad a partir de los cuales le
        corresponden esos días a un empleado. El Catálogo de empleados aplica este cálculo
        automáticamente en cuanto detecta que alguien cumplió un nuevo aniversario, reemplazando
        su saldo de días. Puedes editar estos valores si Alanis maneja una política distinta.
      </p>
      <div id="config-error" class="error"></div>
      <p id="config-exito" class="nota oculto" style="color:#1c7a41;"></p>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-umbrales">
          <thead>
            <tr>
              <th>Desde (años cumplidos)</th>
              <th>Días de vacaciones</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="tbody-umbrales"></tbody>
        </table>
      </div>
      <div class="acciones-form" style="margin-top:14px;">
        <button type="button" id="btn-agregar-umbral" class="secundario">+ Agregar rango</button>
        <button type="button" id="btn-guardar-umbrales">Guardar cambios</button>
      </div>
    </section>

    <section class="panel" style="margin-top:20px;">
      <h2>Áreas y puestos</h2>
      <p class="nota">
        Catálogo de áreas y puestos de Alanis. Se usa en Catálogo de empleados y, más adelante,
        para armar el organigrama automático (la línea de mando la sigue dando "Supervisor
        asignado" — Área y Puesto son solo la etiqueta de cada quien). Los puestos que empiezan
        con "Coordinador" sugieren automáticamente el rol de supervisor al asignarlos.
      </p>
      <div id="estructura-error" class="error"></div>
      <p id="estructura-exito" class="nota oculto" style="color:#1c7a41;"></p>
      <div id="lista-areas"></div>
      <div class="acciones-form" style="margin-top:14px;">
        <button type="button" id="btn-agregar-area" class="secundario">+ Agregar área</button>
        <button type="button" id="btn-guardar-areas">Guardar cambios</button>
      </div>
    </section>
  `;

  const tbody = contenedor.querySelector("#tbody-umbrales");
  const errorDiv = contenedor.querySelector("#config-error");
  const exitoP = contenedor.querySelector("#config-exito");
  const btnAgregar = contenedor.querySelector("#btn-agregar-umbral");
  const btnGuardar = contenedor.querySelector("#btn-guardar-umbrales");

  const ref = doc(db, "configuracion", "vacaciones");
  let umbrales = [];

  onSnapshot(ref, (snap) => {
    const datos = snap.exists() ? snap.data().umbrales : null;
    umbrales = Array.isArray(datos) && datos.length > 0
      ? [...datos].sort((a, b) => a.desde - b.desde)
      : UMBRALES_DEFAULT.map(u => ({ ...u }));
    render();
  }, (err) => {
    errorDiv.textContent = "No se pudo cargar la configuración: " + err.message;
  });

  function render() {
    if (umbrales.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3">No hay rangos definidos. Agrega al menos uno.</td></tr>`;
      return;
    }

    tbody.innerHTML = umbrales.map((u, i) => `
      <tr data-i="${i}">
        <td><input type="number" min="0" step="1" class="input-umbral-desde" value="${u.desde}"></td>
        <td><input type="number" min="0" step="1" class="input-umbral-dias" value="${u.dias}"></td>
        <td class="acciones"><button type="button" class="btn-rechazar btn-quitar-umbral">Quitar</button></td>
      </tr>
    `).join("");

    tbody.querySelectorAll("tr[data-i]").forEach(fila => {
      const i = Number(fila.dataset.i);
      fila.querySelector(".input-umbral-desde").addEventListener("input", (e) => {
        umbrales[i].desde = Number(e.target.value) || 0;
      });
      fila.querySelector(".input-umbral-dias").addEventListener("input", (e) => {
        umbrales[i].dias = Number(e.target.value) || 0;
      });
      fila.querySelector(".btn-quitar-umbral").addEventListener("click", () => {
        umbrales.splice(i, 1);
        render();
      });
    });
  }

  btnAgregar.addEventListener("click", () => {
    const ultimo = umbrales[umbrales.length - 1];
    umbrales.push({
      desde: ultimo ? ultimo.desde + 1 : 1,
      dias: ultimo ? ultimo.dias + 2 : 12
    });
    render();
  });

  btnGuardar.addEventListener("click", async () => {
    errorDiv.textContent = "";
    exitoP.classList.add("oculto");

    const limpios = umbrales
      .map(u => ({
        desde: Math.max(0, Math.round(Number(u.desde) || 0)),
        dias: Math.max(0, Math.round(Number(u.dias) || 0))
      }))
      .sort((a, b) => a.desde - b.desde);

    try {
      await setDoc(ref, { umbrales: limpios, actualizadoEn: new Date().toISOString() });
      umbrales = limpios;
      render();
      exitoP.textContent = "Cambios guardados. Se aplicarán la próxima vez que se cargue el Catálogo de empleados.";
      exitoP.classList.remove("oculto");
    } catch (err) {
      errorDiv.textContent = "No se pudo guardar: " + err.message;
    }
  });

  // --- Áreas y puestos ---

  const listaAreasDiv = contenedor.querySelector("#lista-areas");
  const errorAreasDiv = contenedor.querySelector("#estructura-error");
  const exitoAreasP = contenedor.querySelector("#estructura-exito");
  const btnAgregarArea = contenedor.querySelector("#btn-agregar-area");
  const btnGuardarAreas = contenedor.querySelector("#btn-guardar-areas");

  const refEstructura = doc(db, "configuracion", "estructura");
  let areas = [];

  onSnapshot(refEstructura, (snap) => {
    const datos = snap.exists() ? snap.data().areas : null;
    areas = Array.isArray(datos) && datos.length > 0
      ? datos.map(a => ({ nombre: a.nombre, puestos: [...(a.puestos || [])] }))
      : AREAS_DEFAULT.map(a => ({ nombre: a.nombre, puestos: [...a.puestos] }));
    renderAreas();
  }, (err) => {
    errorAreasDiv.textContent = "No se pudo cargar la configuración: " + err.message;
  });

  function renderAreas() {
    if (areas.length === 0) {
      listaAreasDiv.innerHTML = `<p class="nota">No hay áreas definidas. Agrega al menos una.</p>`;
      return;
    }

    listaAreasDiv.innerHTML = areas.map((a, i) => `
      <div class="area-card" data-i="${i}">
        <div class="area-card-encabezado">
          <input type="text" class="input-area-nombre" value="${escapeHtml(a.nombre)}" placeholder="Nombre del área">
          <button type="button" class="secundario btn-quitar-area">Quitar área</button>
        </div>
        <div class="lista-puestos">
          ${a.puestos.length > 0
            ? a.puestos.map((p, j) => `
                <div class="puesto-fila" data-j="${j}">
                  <input type="text" class="input-puesto-nombre" value="${escapeHtml(p)}" placeholder="Nombre del puesto">
                  <button type="button" class="secundario btn-quitar-puesto">Quitar</button>
                </div>
              `).join("")
            : `<p class="nota" style="margin:4px 0 0;">Sin puestos capturados todavía.</p>`}
        </div>
        <button type="button" class="secundario btn-agregar-puesto" style="margin-top:8px;">+ Agregar puesto</button>
      </div>
    `).join("");

    listaAreasDiv.querySelectorAll(".area-card").forEach(tarjeta => {
      const i = Number(tarjeta.dataset.i);

      tarjeta.querySelector(".input-area-nombre").addEventListener("input", (e) => {
        areas[i].nombre = e.target.value;
      });

      tarjeta.querySelector(".btn-quitar-area").addEventListener("click", () => {
        areas.splice(i, 1);
        renderAreas();
      });

      tarjeta.querySelector(".btn-agregar-puesto").addEventListener("click", () => {
        areas[i].puestos.push("");
        renderAreas();
      });

      tarjeta.querySelectorAll(".puesto-fila").forEach(fila => {
        const j = Number(fila.dataset.j);
        fila.querySelector(".input-puesto-nombre").addEventListener("input", (e) => {
          areas[i].puestos[j] = e.target.value;
        });
        fila.querySelector(".btn-quitar-puesto").addEventListener("click", () => {
          areas[i].puestos.splice(j, 1);
          renderAreas();
        });
      });
    });
  }

  btnAgregarArea.addEventListener("click", () => {
    areas.push({ nombre: "", puestos: [] });
    renderAreas();
  });

  btnGuardarAreas.addEventListener("click", async () => {
    errorAreasDiv.textContent = "";
    exitoAreasP.classList.add("oculto");

    const limpias = areas
      .map(a => ({
        nombre: (a.nombre || "").trim(),
        puestos: (a.puestos || []).map(p => (p || "").trim()).filter(p => p !== "")
      }))
      .filter(a => a.nombre !== "");

    try {
      await setDoc(refEstructura, { areas: limpias, actualizadoEn: new Date().toISOString() });
      areas = limpias;
      renderAreas();
      exitoAreasP.textContent = "Cambios guardados. Se aplicarán la próxima vez que se abra el Catálogo de empleados.";
      exitoAreasP.classList.remove("oculto");
    } catch (err) {
      errorAreasDiv.textContent = "No se pudo guardar: " + err.message;
    }
  });
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto || "";
  return div.innerHTML;
}