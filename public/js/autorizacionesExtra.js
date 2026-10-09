import { db } from "./firebase-config.js";
import {
  collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import {
  calcularSemanaLaboral, sumarDias, numeroSemanaISO, formatearFechaLargaCap, escapeHtml
} from "./reportesHtml.js";
import { construirBloqueCorreo, formatearMontoMXN } from "./autorizacionesExtraCorreo.js";

// Autorizaciones extra (bonos, gratificaciones por desempeño o volumen de
// trabajo, etc.) — solo admin. Antes se mencionaban a mano en el texto del
// correo semanal de nómina; como ese correo ahora sale automático los jueves
// (ver automatizacion/generar-y-enviar-reporte.mjs), aquí se captura UNA vez
// cada autorización y el script la agrega solita al correo de la semana que
// corresponda. Una vez enviada queda bloqueada (igual que enviadoANominaEn en
// horas extra/faltas/vacaciones) y nunca se repite.
//
// Si una autorización queda sin enviar de una semana que ya pasó (por ejemplo
// se capturó el jueves en la noche, después del corte), no se pierde: sale en
// el siguiente correo, marcada como "Autorizada en la semana N" — misma idea
// que "Pendientes de semanas anteriores" en el reporte.
const CONCEPTOS = ["Bono por desempeño", "Gratificación por volumen de trabajo"];
const OTRO = "__otro__";

// "yyyy-mm-dd" de hoy, en hora local.
function hoyStr() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function infoSemana(fechaStr) {
  const viernes = calcularSemanaLaboral(fechaStr);
  const jueves = sumarDias(viernes, 6);
  return { viernes, jueves, numero: numeroSemanaISO(jueves) };
}

// "2026-10-15" -> "15 oct"
function fechaCorta(fechaStr) {
  const d = new Date(fechaStr + "T00:00:00");
  if (isNaN(d.getTime())) return fechaStr;
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" }).replace(".", "");
}

export function iniciarAutorizacionesExtra(contenedor, uid, nombreAdmin) {
  contenedor.innerHTML = `
    <section class="panel">
      <h2 id="ax-titulo-form">Nueva autorización extra</h2>
      <p class="nota">
        Bonos, gratificaciones por desempeño o volumen de trabajo y cualquier otro concepto
        extraordinario que quieras que nóminas conozca. Se agrega solo al correo del jueves de la
        semana que elijas — la capturas una vez y no se repite.
      </p>
      <div id="ax-error" class="error"></div>
      <form id="ax-form">
        <div class="fila-captura">
          <label>Colaborador
            <select id="ax-empleado" required><option value="">Cargando...</option></select>
          </label>
          <label>Concepto
            <select id="ax-concepto" required>
              ${CONCEPTOS.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")}
              <option value="${OTRO}">Otro…</option>
            </select>
          </label>
          <label id="ax-otro-wrap" class="oculto">Nombre del concepto
            <input type="text" id="ax-concepto-otro" maxlength="80" placeholder="Ej. Compensación por guardia">
          </label>
        </div>
        <div class="fila-captura">
          <label>Monto en MXN (opcional)
            <input type="number" id="ax-monto" min="0" step="0.01" placeholder="1500.00">
          </label>
          <label>Aplica en la semana del
            <input type="date" id="ax-fecha" required>
          </label>
        </div>
        <p class="nota" id="ax-semana-info" style="margin:0;"></p>
        <label>Nota para el correo (opcional)
          <textarea id="ax-nota" rows="2" maxlength="500" placeholder="Ej. Cumplió la meta de entregas a tiempo del trimestre."></textarea>
        </label>
        <div class="acciones-form">
          <button type="submit" id="ax-btn-guardar">Registrar autorización</button>
          <button type="button" id="ax-btn-vista-previa" class="secundario">Ver cómo quedará en el correo</button>
          <button type="button" id="ax-btn-cancelar" class="secundario oculto">Cancelar edición</button>
        </div>
      </form>
    </section>

    <section class="panel" style="margin-top:20px;">
      <h2>Autorizaciones registradas</h2>
      <div class="tabla-wrap">
        <table class="tabla">
          <thead>
            <tr><th>Colaborador</th><th>Concepto</th><th>Monto</th><th>Semana</th><th>Estatus</th><th>Registró</th><th>Acción</th></tr>
          </thead>
          <tbody id="ax-tbody"><tr><td colspan="7">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>
  `;

  const form = contenedor.querySelector("#ax-form");
  const errorDiv = contenedor.querySelector("#ax-error");
  const tituloForm = contenedor.querySelector("#ax-titulo-form");
  const selEmpleado = contenedor.querySelector("#ax-empleado");
  const selConcepto = contenedor.querySelector("#ax-concepto");
  const otroWrap = contenedor.querySelector("#ax-otro-wrap");
  const inputOtro = contenedor.querySelector("#ax-concepto-otro");
  const inputMonto = contenedor.querySelector("#ax-monto");
  const inputFecha = contenedor.querySelector("#ax-fecha");
  const semanaInfo = contenedor.querySelector("#ax-semana-info");
  const inputNota = contenedor.querySelector("#ax-nota");
  const btnGuardar = contenedor.querySelector("#ax-btn-guardar");
  const btnVistaPrevia = contenedor.querySelector("#ax-btn-vista-previa");
  const btnCancelar = contenedor.querySelector("#ax-btn-cancelar");
  const tbody = contenedor.querySelector("#ax-tbody");

  let usuarios = [];
  let lista = [];
  let editandoId = null;

  inputFecha.value = hoyStr();

  function actualizarSemanaInfo() {
    if (!inputFecha.value) { semanaInfo.textContent = ""; return; }
    const s = infoSemana(inputFecha.value);
    semanaInfo.innerHTML = `Semana <strong>${s.numero}</strong> · del ${escapeHtml(formatearFechaLargaCap(s.viernes))} al ${escapeHtml(formatearFechaLargaCap(s.jueves))} — saldrá en el correo del <strong>${escapeHtml(formatearFechaLargaCap(s.jueves))}</strong>, 6:00 pm.`;
  }
  inputFecha.addEventListener("input", actualizarSemanaInfo);
  actualizarSemanaInfo();

  selConcepto.addEventListener("change", () => {
    otroWrap.classList.toggle("oculto", selConcepto.value !== OTRO);
  });

  // Colaboradores activos para el selector (el admin ya puede leer toda la
  // colección usuarios — igual que en el Catálogo de empleados).
  onSnapshot(collection(db, "usuarios"), (snap) => {
    usuarios = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(u => u.estatus === "activo")
      .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));
    const previo = selEmpleado.value;
    selEmpleado.innerHTML = `<option value="">Selecciona...</option>` +
      usuarios.map(u => `<option value="${u.id}">${escapeHtml(u.nombre)}</option>`).join("");
    if (previo) selEmpleado.value = previo;
  }, (err) => {
    errorDiv.textContent = "No se pudo cargar la lista de colaboradores: " + err.message;
  });

  onSnapshot(collection(db, "autorizacionesExtra"), (snap) => {
    lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTabla();
  }, (err) => {
    errorDiv.textContent = "No se pudieron cargar las autorizaciones: " + err.message;
  });

  // Lee y valida el formulario. Devuelve null (y deja el mensaje en errorDiv)
  // si algo falta.
  function leerFormulario() {
    errorDiv.textContent = "";
    const empleado = usuarios.find(u => u.id === selEmpleado.value);
    if (!empleado) { errorDiv.textContent = "Selecciona al colaborador."; return null; }

    const concepto = selConcepto.value === OTRO ? inputOtro.value.trim() : selConcepto.value;
    if (!concepto) { errorDiv.textContent = "Escribe el nombre del concepto."; return null; }

    if (!inputFecha.value) { errorDiv.textContent = "Elige la fecha (define la semana en que sale en el correo)."; return null; }

    let monto = null;
    if (inputMonto.value !== "") {
      monto = Math.round(Number(inputMonto.value) * 100) / 100;
      if (!isFinite(monto) || monto <= 0) { errorDiv.textContent = "El monto debe ser mayor a cero (o déjalo vacío)."; return null; }
    }

    const s = infoSemana(inputFecha.value);
    return {
      empleadoId: empleado.id,
      empleadoNombre: empleado.nombre,
      concepto,
      monto,
      nota: inputNota.value.trim() || null,
      aplicaEn: inputFecha.value,
      semanaViernes: s.viernes,
      numeroSemana: s.numero
    };
  }

  function salirModoEdicion() {
    editandoId = null;
    form.reset();
    inputFecha.value = hoyStr();
    otroWrap.classList.add("oculto");
    actualizarSemanaInfo();
    tituloForm.textContent = "Nueva autorización extra";
    btnGuardar.textContent = "Registrar autorización";
    btnCancelar.classList.add("oculto");
    errorDiv.textContent = "";
  }
  btnCancelar.addEventListener("click", salirModoEdicion);

  function entrarModoEdicion(a) {
    editandoId = a.id;
    selEmpleado.value = a.empleadoId;
    if (CONCEPTOS.includes(a.concepto)) {
      selConcepto.value = a.concepto;
      otroWrap.classList.add("oculto");
      inputOtro.value = "";
    } else {
      selConcepto.value = OTRO;
      otroWrap.classList.remove("oculto");
      inputOtro.value = a.concepto || "";
    }
    inputMonto.value = a.monto ?? "";
    inputFecha.value = a.aplicaEn || a.semanaViernes;
    inputNota.value = a.nota || "";
    actualizarSemanaInfo();
    tituloForm.textContent = "Editar autorización extra";
    btnGuardar.textContent = "Guardar cambios";
    btnCancelar.classList.remove("oculto");
    form.scrollIntoView({ behavior: "smooth" });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const datos = leerFormulario();
    if (!datos) return;

    btnGuardar.disabled = true;
    try {
      if (editandoId) {
        await updateDoc(doc(db, "autorizacionesExtra", editandoId), {
          ...datos,
          actualizadoEn: new Date().toISOString(),
          actualizadoPorNombre: nombreAdmin
        });
        salirModoEdicion();
      } else {
        await addDoc(collection(db, "autorizacionesExtra"), {
          ...datos,
          creadoPor: uid,
          creadoPorNombre: nombreAdmin,
          creadoEn: new Date().toISOString(),
          enviadoEn: null,
          enviadoEnSemana: null
        });
        salirModoEdicion();
      }
    } catch (err) {
      errorDiv.textContent = "No se pudo guardar: " + err.message;
    } finally {
      btnGuardar.disabled = false;
    }
  });

  // Vista previa: el mismo bloque que construye el script del jueves
  // (autorizacionesExtraCorreo.js), con lo que haya en el formulario.
  btnVistaPrevia.addEventListener("click", () => {
    const datos = leerFormulario();
    if (!datos) return;
    const bloque = construirBloqueCorreo({ autorizaciones: [datos], viernesActual: datos.semanaViernes });
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-tarjeta">
        <h2>Así se verá en el correo</h2>
        <p class="nota">Se agrega al final del cuerpo del correo semanal, junto con las demás autorizaciones de esa semana.</p>
        <div style="border:1px solid #e0ddd8;border-radius:8px;padding:14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222;">${bloque}</div>
        <div class="modal-acciones">
          <button type="button" class="secundario" id="ax-cerrar-vista-previa">Cerrar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const cerrar = () => overlay.remove();
    overlay.querySelector("#ax-cerrar-vista-previa").addEventListener("click", cerrar);
    overlay.addEventListener("click", (ev) => { if (ev.target === overlay) cerrar(); });
  });

  function filaHtml(a, estatusHtml, puedeEditar) {
    return `
      <tr data-id="${a.id}">
        <td><strong>${escapeHtml(a.empleadoNombre)}</strong>${a.nota ? `<div class="nota" style="margin:2px 0 0;">${escapeHtml(a.nota)}</div>` : ""}</td>
        <td>${escapeHtml(a.concepto)}</td>
        <td>${a.monto != null ? escapeHtml(formatearMontoMXN(a.monto)) : "—"}</td>
        <td>${a.numeroSemana ?? "—"}</td>
        <td>${estatusHtml}</td>
        <td>${a.creadoPorNombre ? escapeHtml(a.creadoPorNombre) : "—"}${a.creadoEn ? `<div class="nota" style="margin:2px 0 0;">${fechaCorta(a.creadoEn.slice(0, 10))}</div>` : ""}</td>
        <td class="acciones">${puedeEditar
          ? `<button type="button" class="btn-editar">Editar</button><button type="button" class="btn-eliminar btn-rechazar">Eliminar</button>`
          : `<span class="nota" style="margin:0;">Bloqueada</span>`}</td>
      </tr>`;
  }

  function renderTabla() {
    if (lista.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7">Todavía no hay autorizaciones registradas.</td></tr>`;
      return;
    }
    const hoy = infoSemana(hoyStr());
    const porSemana = (a, b) => (a.semanaViernes || "").localeCompare(b.semanaViernes || "")
      || (a.empleadoNombre || "").localeCompare(b.empleadoNombre || "", "es");

    const enviadas = lista.filter(a => a.enviadoEn).sort((a, b) => porSemana(b, a));
    const sinEnviar = lista.filter(a => !a.enviadoEn);
    const rezagadas = sinEnviar.filter(a => a.semanaViernes < hoy.viernes).sort(porSemana);
    const estaSemana = sinEnviar.filter(a => a.semanaViernes === hoy.viernes).sort(porSemana);
    const proximas = sinEnviar.filter(a => a.semanaViernes > hoy.viernes).sort(porSemana);

    const grupo = (titulo) => `<tr><td colspan="7" style="background:#f7f4ee;font-weight:700;font-size:0.78rem;color:#6b5f4d;text-transform:uppercase;">${titulo}</td></tr>`;
    let html = "";
    if (rezagadas.length) {
      html += grupo("Rezagadas — saldrán en el próximo correo");
      html += rezagadas.map(a => filaHtml(a, `<span class="badge badge-pendiente">Próximo correo (de la sem. ${a.numeroSemana})</span>`, true)).join("");
    }
    if (estaSemana.length) {
      html += grupo(`Esta semana (${hoy.numero}) — saldrán el jueves`);
      html += estaSemana.map(a => filaHtml(a, `<span class="badge badge-pendiente">Saldrá el ${fechaCorta(hoy.jueves)}</span>`, true)).join("");
    }
    if (proximas.length) {
      html += grupo("Próximas semanas");
      html += proximas.map(a => filaHtml(a, `<span class="badge badge-inactivo">Programada · sale el ${fechaCorta(sumarDias(a.semanaViernes, 6))}</span>`, true)).join("");
    }
    if (enviadas.length) {
      html += grupo("Ya enviadas");
      html += enviadas.map(a => filaHtml(a, `<span class="badge badge-aprobada">Enviada · ${fechaCorta(a.enviadoEn.slice(0, 10))}</span>`, false)).join("");
    }
    tbody.innerHTML = html;

    tbody.querySelectorAll("tr[data-id]").forEach(fila => {
      const a = lista.find(x => x.id === fila.dataset.id);
      fila.querySelector(".btn-editar")?.addEventListener("click", () => entrarModoEdicion(a));
      fila.querySelector(".btn-eliminar")?.addEventListener("click", async () => {
        if (!confirm(`¿Eliminar la autorización de ${a.empleadoNombre} (${a.concepto})? No se puede deshacer.`)) return;
        try {
          await deleteDoc(doc(db, "autorizacionesExtra", a.id));
          if (editandoId === a.id) salirModoEdicion();
        } catch (err) {
          errorDiv.textContent = "No se pudo eliminar: " + err.message;
        }
      });
    });
  }
}