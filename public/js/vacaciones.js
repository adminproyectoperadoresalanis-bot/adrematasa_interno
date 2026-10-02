import { db } from "./firebase-config.js";
import {
  collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, where, getDoc
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { abrirFormatoVacacionesImprimir } from "./formatoVacaciones.js";
import { avisarNuevaSolicitud } from "./avisoNuevaSolicitud.js";
import { suscribirFestivos, FESTIVOS_DEFAULT, esFestivo } from "./vacacionesCalculo.js";

// Catálogo de festivos en vivo (1 oct 2026) — se usa para que un día festivo
// oficial no cuente como hábil, igual que ya pasa con el día de descanso
// semanal del empleado. Antes de que llegue el primer snapshot usa el
// catálogo oficial por default, para no bloquear el primer cálculo.
let festivosActuales = FESTIVOS_DEFAULT;
suscribirFestivos((festivos) => { festivosActuales = festivos; });

const ETIQUETAS_ESTATUS = {
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  rechazada: "Rechazada"
};

const NOMBRES_DIA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// diaDescanso: 0=domingo ... 6=sabado — el único día de la semana que no cuenta como hábil para este empleado.
// festivos: catálogo de días festivos oficiales (ver vacacionesCalculo.js) —
// tampoco cuentan como hábiles, igual que ya no se cobra el día de descanso
// semanal (1 oct 2026).
// Exportada (18 sep 2026) para que el modal de "recorte de vacaciones" use
// exactamente el mismo cálculo al mostrar cuántos días se liberarían, sin
// duplicar la lógica.
export function calcularDiasHabiles(fechaInicioStr, fechaFinStr, diaDescanso, festivos) {
  const inicio = new Date(fechaInicioStr + "T00:00:00");
  const fin = new Date(fechaFinStr + "T00:00:00");
  if (fin < inicio) return 0;
  let dias = 0;
  const cursor = new Date(inicio);
  while (cursor <= fin) {
    const fechaStr = cursor.toISOString().slice(0, 10);
    if (cursor.getDay() !== diaDescanso && !esFestivo(fechaStr, festivos)) dias++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return dias;
}

// "yyyy-mm-dd" de hoy, en hora local — para saber si una vacación ya
// aprobada todavía no ha iniciado (solo entonces se puede pedir un recorte).
function hoyStr() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function iniciarVistaVacacionesEmpleado(contenedor, datosUsuario, uid) {
  contenedor.innerHTML = `
    <section class="panel">
      <h2 id="titulo-form-vacaciones">Nueva solicitud de vacaciones</h2>
      <div class="tarjeta-saldo">Saldo disponible: <strong id="saldo-dias">—</strong> día(s) · Tu día de descanso: <strong id="dia-descanso-texto">—</strong></div>
      <div id="vacaciones-error" class="error"></div>
      <form id="form-vacaciones">
        <div class="fila-captura">
          <label>Fecha de inicio
            <input type="date" id="vac-fecha-inicio" required>
          </label>
          <label>Fecha de fin
            <input type="date" id="vac-fecha-fin" required>
          </label>
          <div class="resultado-horas">
            <span class="etiqueta-horas">Días hábiles</span>
            <span id="dias-calculados" class="valor-horas">—</span>
          </div>
        </div>
        <label>Motivo (opcional)
          <textarea id="vac-motivo" rows="2"></textarea>
        </label>
        <div class="acciones-form">
          <button type="submit" id="btn-guardar-vacaciones">Enviar solicitud</button>
          <button type="button" id="btn-cancelar-edicion-vac" class="secundario oculto">Cancelar edición</button>
        </div>
      </form>
    </section>

    <section class="panel" style="margin-top:20px;">
      <h2>Mis solicitudes de vacaciones</h2>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-mis-vacaciones">
          <thead>
            <tr><th>Inicio</th><th>Fin</th><th>Días</th><th>Motivo</th><th>Estatus</th><th>Comentario</th><th>Autorizó</th><th>Acción</th></tr>
          </thead>
          <tbody id="tbody-mis-vacaciones"><tr><td colspan="8">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>
  `;

  const form = contenedor.querySelector("#form-vacaciones");
  const errorDiv = contenedor.querySelector("#vacaciones-error");
  const tbody = contenedor.querySelector("#tbody-mis-vacaciones");
  const inputInicio = contenedor.querySelector("#vac-fecha-inicio");
  const inputFin = contenedor.querySelector("#vac-fecha-fin");
  const inputMotivo = contenedor.querySelector("#vac-motivo");
  const diasCalculados = contenedor.querySelector("#dias-calculados");
  const saldoSpan = contenedor.querySelector("#saldo-dias");
  const diaDescansoSpan = contenedor.querySelector("#dia-descanso-texto");
  const tituloForm = contenedor.querySelector("#titulo-form-vacaciones");
  const btnGuardar = contenedor.querySelector("#btn-guardar-vacaciones");
  const btnCancelar = contenedor.querySelector("#btn-cancelar-edicion-vac");

  let editandoId = null;
  let saldoActual = 0;
  let diaDescansoActual = datosUsuario.diaDescanso ?? 0;
  // Copia siempre fresca del usuario (número de empleado, área, puesto, fecha
  // de ingreso...) para que el formato ATAF050 imprima datos al día aunque el
  // admin los haya editado después de que esta pantalla se abrió.
  let datosUsuarioActuales = datosUsuario;

  // Saldo y día de descanso en vivo: si el admin los cambia mientras el empleado tiene la app abierta, se actualizan solos.
  onSnapshot(doc(db, "usuarios", uid), (snap) => {
    const datos = snap.data() || {};
    datosUsuarioActuales = datos;
    saldoActual = datos.diasVacacionesDisponibles || 0;
    saldoSpan.textContent = saldoActual;
    diaDescansoActual = datos.diaDescanso ?? 0;
    diaDescansoSpan.textContent = NOMBRES_DIA[diaDescansoActual];
    actualizarDiasPreview();
  });

  function actualizarDiasPreview() {
    if (inputInicio.value && inputFin.value) {
      const dias = calcularDiasHabiles(inputInicio.value, inputFin.value, diaDescansoActual, festivosActuales);
      diasCalculados.textContent = dias;
    } else {
      diasCalculados.textContent = "—";
    }
  }
  inputInicio.addEventListener("input", actualizarDiasPreview);
  inputFin.addEventListener("input", actualizarDiasPreview);

  function entrarModoEdicion(s) {
    editandoId = s.id;
    inputInicio.value = s.fechaInicio;
    inputFin.value = s.fechaFin;
    inputMotivo.value = s.motivo || "";
    actualizarDiasPreview();
    tituloForm.textContent = "Editar solicitud de vacaciones";
    btnGuardar.textContent = "Guardar cambios";
    btnCancelar.classList.remove("oculto");
    form.scrollIntoView({ behavior: "smooth" });
  }

  function salirModoEdicion() {
    editandoId = null;
    form.reset();
    diasCalculados.textContent = "—";
    tituloForm.textContent = "Nueva solicitud de vacaciones";
    btnGuardar.textContent = "Enviar solicitud";
    btnCancelar.classList.add("oculto");
  }

  btnCancelar.addEventListener("click", salirModoEdicion);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorDiv.textContent = "";

    const fechaInicio = inputInicio.value;
    const fechaFin = inputFin.value;
    const motivo = inputMotivo.value.trim();

    if (!fechaInicio || !fechaFin) {
      errorDiv.textContent = "Completa la fecha de inicio y de fin.";
      return;
    }

    const diasHabiles = calcularDiasHabiles(fechaInicio, fechaFin, diaDescansoActual, festivosActuales);
    if (diasHabiles <= 0) {
      errorDiv.textContent = "La fecha de fin debe ser igual o posterior a la de inicio (y cubrir al menos un día hábil).";
      return;
    }
    if (diasHabiles > saldoActual) {
      errorDiv.textContent = `No tienes suficiente saldo: solicitas ${diasHabiles} día(s) y tienes ${saldoActual} disponible(s).`;
      return;
    }

    try {
      if (editandoId) {
        await updateDoc(doc(db, "solicitudesVacaciones", editandoId), {
          fechaInicio,
          fechaFin,
          diasHabiles,
          motivo: motivo || null
        });
        salirModoEdicion();
      } else {
        await addDoc(collection(db, "solicitudesVacaciones"), {
          empleadoId: uid,
          empleadoNombre: datosUsuario.nombre,
          supervisorId: datosUsuario.supervisorId || null,
          fechaInicio,
          fechaFin,
          diasHabiles,
          motivo: motivo || null,
          estatus: "pendiente",
          comentarioRevisor: null,
          revisadoPor: null,
          revisadoPorNombre: null,
          creadoEn: new Date().toISOString(),
          resueltoEn: null
        });
        form.reset();
        diasCalculados.textContent = "—";

        // Aviso por correo a quien le toca aprobar (mejor esfuerzo — no
        // bloquea ni afecta el guardado de arriba, que ya quedó hecho).
        avisarNuevaSolicitud({
          datosUsuario,
          asunto: `Nueva solicitud de vacaciones de ${datosUsuario.nombre}`,
          mensaje: `<p style="margin:0 0 12px;">${escapeHtml(datosUsuario.nombre)} envió una nueva solicitud de vacaciones:</p>
<p style="margin:0 0 4px;"><strong>Del:</strong> ${fechaInicio} <strong>al:</strong> ${fechaFin} (${diasHabiles} día${diasHabiles === 1 ? "" : "s"} hábil${diasHabiles === 1 ? "" : "es"})</p>
${motivo ? `<p style="margin:0 0 12px;"><strong>Motivo:</strong> ${escapeHtml(motivo)}</p>` : ""}
<p style="margin:0;color:#555;font-size:0.9em;">Entra a Adrematasa Interno para aprobarla o rechazarla.</p>`,
          tituloBell: "Nueva solicitud de vacaciones",
          mensajeBell: `${datosUsuario.nombre} envió una solicitud para tu revisión`,
          fechaEventoBell: formatearRangoFechas(fechaInicio, fechaFin)
        });
      }
    } catch (err) {
      errorDiv.textContent = "No se pudo guardar la solicitud: " + err.message;
    }
  });

  const q = query(collection(db, "solicitudesVacaciones"), where("empleadoId", "==", uid));

  let ultimaLista = [];

  onSnapshot(q, (snap) => {
    ultimaLista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    ultimaLista.sort((a, b) => (b.fechaInicio || "").localeCompare(a.fechaInicio || ""));
    renderTabla(ultimaLista);
  }, (err) => {
    errorDiv.textContent = "No se pudieron cargar tus solicitudes: " + err.message;
  });

  // Botones/badge extra que van junto a "Imprimir formato" en una vacación ya
  // aprobada (28 sep 2026: unificado en "ajuste", que reemplaza al botón
  // "Solicitar recorte" de antes — ver abrirModalAjuste). Revisa primero el
  // campo NUEVO (ajusteSolicitud); si no hay nada ahí, revisa el campo VIEJO
  // (recorteSolicitud) por compatibilidad con solicitudes que ya estaban en
  // vuelo antes de este cambio — nunca los dos botones a la vez. Si ya se
  // mandó a nómina (enviadoANominaEn), ya no se puede ajustar.
  function accionesAjuste(s) {
    if (s.enviadoANominaEn) return "";
    const a = s.ajusteSolicitud;
    if (a && a.estatus === "pendiente") {
      return ` <span class="badge badge-pendiente">Ajuste en revisión</span> <button type="button" class="secundario btn-cancelar-ajuste">Cancelar ajuste</button>`;
    }
    if (a && a.estatus === "rechazada") {
      return ` <span class="badge badge-rechazada" title="${a.comentarioRevisor ? escapeHtml(a.comentarioRevisor) : "Sin comentario"}">Ajuste rechazado</span> <button type="button" class="secundario btn-solicitar-ajuste">Solicitar de nuevo</button>`;
    }
    // Campo viejo (recorteSolicitud) — solo por compatibilidad, para
    // solicitudes que ya tenían un recorte en vuelo antes de unificar.
    const r = s.recorteSolicitud;
    if (r && r.estatus === "pendiente") {
      return ` <span class="badge badge-pendiente">Recorte en revisión</span> <button type="button" class="secundario btn-cancelar-recorte">Cancelar recorte</button>`;
    }
    if (r && r.estatus === "rechazada") {
      return ` <span class="badge badge-rechazada" title="${r.comentarioRevisor ? escapeHtml(r.comentarioRevisor) : "Sin comentario"}">Recorte rechazado</span> <button type="button" class="secundario btn-solicitar-ajuste">Solicitar de nuevo</button>`;
    }
    return ` <button type="button" class="secundario btn-solicitar-ajuste">Solicitar ajuste</button>`;
  }

  // Historial combinado para mostrarle al empleado (28 sep 2026, decisión de
  // Ivan: visibilidad completa, igual de detallada que lo que ya ve el
  // admin, incluyendo quién lo autorizó — consistente con cómo ya se muestra
  // "Autorizó" en el resto de la app). Junta el campo nuevo (historialAjustes)
  // con el viejo (historialRecortes, que no traía "tipo" porque solo existía
  // el recorte) y ordena todo del más reciente al más antiguo.
  function historialCombinado(s) {
    const nuevos = Array.isArray(s.historialAjustes) ? s.historialAjustes : [];
    const viejos = (Array.isArray(s.historialRecortes) ? s.historialRecortes : [])
      .map(h => ({ ...h, tipo: "recorte", aprobadoPorNombre: h.aprobadoPorNombre }));
    return [...nuevos, ...viejos].sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
  }

  function renderTabla(filas) {
    if (filas.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8">Aún no has enviado ninguna solicitud de vacaciones.</td></tr>`;
      return;
    }
    tbody.innerHTML = filas.map(s => `
      <tr data-id="${s.id}">
        <td>${s.fechaInicio}</td>
        <td>${s.fechaFin}</td>
        <td>${s.diasHabiles}</td>
        <td>${s.motivo ? escapeHtml(s.motivo) : "—"}</td>
        <td><span class="badge badge-${s.estatus}">${ETIQUETAS_ESTATUS[s.estatus] || s.estatus}</span></td>
        <td>${s.comentarioRevisor ? escapeHtml(s.comentarioRevisor) : "—"}</td>
        <td>${s.revisadoPorNombre ? escapeHtml(s.revisadoPorNombre) : "—"}</td>
        <td class="acciones">
          ${s.estatus === "pendiente" ? `
            <button type="button" class="btn-editar">Editar</button>
            <button type="button" class="btn-eliminar btn-rechazar">Eliminar</button>
          ` : s.estatus === "aprobada" ? `
            <button type="button" class="secundario btn-imprimir-formato">Imprimir formato</button>${accionesAjuste(s)}${historialCombinado(s).length > 0 ? ` <button type="button" class="secundario btn-ver-historial-ajustes">Ver historial</button>` : ""}
          ` : "—"}
        </td>
      </tr>
    `).join("");

    tbody.querySelectorAll("tr[data-id]").forEach(fila => {
      const id = fila.dataset.id;
      const solicitud = ultimaLista.find(s => s.id === id);
      fila.querySelector(".btn-editar")?.addEventListener("click", () => entrarModoEdicion(solicitud));
      fila.querySelector(".btn-imprimir-formato")?.addEventListener("click", () => {
        abrirFormatoVacacionesImprimir(solicitud, datosUsuarioActuales, saldoActual, diaDescansoActual);
      });
      fila.querySelector(".btn-eliminar")?.addEventListener("click", async () => {
        if (!confirm("¿Eliminar esta solicitud de vacaciones? No se puede deshacer.")) return;
        try {
          await deleteDoc(doc(db, "solicitudesVacaciones", id));
          if (editandoId === id) salirModoEdicion();
        } catch (err) {
          errorDiv.textContent = "No se pudo eliminar la solicitud: " + err.message;
        }
      });
      fila.querySelector(".btn-solicitar-ajuste")?.addEventListener("click", () => {
        if (solicitud.fechaInicio <= hoyStr()) {
          errorDiv.textContent = "Esta vacación ya inició; ya no se puede ajustar desde aquí.";
          return;
        }
        abrirModalAjuste(solicitud);
      });
      fila.querySelector(".btn-cancelar-ajuste")?.addEventListener("click", async () => {
        if (!confirm("¿Cancelar tu solicitud de ajuste? La vacación se queda como está.")) return;
        try {
          await updateDoc(doc(db, "solicitudesVacaciones", id), { ajusteSolicitud: null });
        } catch (err) {
          errorDiv.textContent = "No se pudo cancelar la solicitud de ajuste: " + err.message;
        }
      });
      // Cancelar del campo viejo (recorteSolicitud) — solo aparece en
      // solicitudes que ya tenían un recorte pendiente en vuelo antes de
      // unificar (ver accionesAjuste), se deja funcionando tal cual estaba.
      fila.querySelector(".btn-cancelar-recorte")?.addEventListener("click", async () => {
        if (!confirm("¿Cancelar tu solicitud de recorte? La vacación se queda como está.")) return;
        try {
          await updateDoc(doc(db, "solicitudesVacaciones", id), { recorteSolicitud: null });
        } catch (err) {
          errorDiv.textContent = "No se pudo cancelar la solicitud de recorte: " + err.message;
        }
      });
      fila.querySelector(".btn-ver-historial-ajustes")?.addEventListener("click", () => {
        abrirModalHistorialAjustes(solicitud);
      });
    });
  }

  // Modal unificada (28 sep 2026) para pedir un ajuste sobre una vacación ya
  // aprobada — reemplaza al modal de "recorte" de antes, ofreciendo dos
  // tipos:
  //  - "recorte": igual que antes — solo mover UNA fecha hacia adentro
  //    (conservando la otra igual al original), nunca ampliar ni mover
  //    ambas a la vez.
  //  - "cambioFechas": fechas completamente nuevas y libres, para el caso de
  //    "ya no quiero estos días, quiero otros" (puede pedir más o menos días
  //    hábiles que el rango actual, con tope en el saldo disponible).
  // Ninguno de los dos descuenta ni regresa saldo aquí: eso solo ocurre
  // cuando el admin aprueba el ajuste (ver resolverAjuste() en
  // aprobacionesVacaciones.js).
  function abrirModalAjuste(solicitud) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-tarjeta">
        <h2>Solicitar ajuste de vacaciones</h2>
        <p class="nota">Vacación aprobada actual: <strong>${solicitud.fechaInicio} al ${solicitud.fechaFin}</strong> (${solicitud.diasHabiles} día(s) hábil(es)).</p>
        <div class="modal-fila" style="margin-bottom:12px;">
          <label><input type="radio" name="ajuste-tipo" value="recorte" checked> Recortar (acortar el rango actual)</label>
          <label><input type="radio" name="ajuste-tipo" value="cambioFechas"> Cambiar fechas (pedir fechas distintas)</label>
        </div>
        <div id="ajuste-error" class="error"></div>
        <div class="modal-fila">
          <label>Nueva fecha de inicio
            <input type="date" id="ajuste-fecha-inicio" value="${solicitud.fechaInicio}">
          </label>
          <label>Nueva fecha de fin
            <input type="date" id="ajuste-fecha-fin" value="${solicitud.fechaFin}">
          </label>
          <div class="resultado-horas">
            <span class="etiqueta-horas" id="ajuste-dias-etiqueta">Días liberados</span>
            <span id="ajuste-dias-preview" class="valor-horas">0</span>
          </div>
        </div>
        <label>Motivo (opcional)
          <textarea id="ajuste-motivo" rows="2"></textarea>
        </label>
        <div class="modal-acciones">
          <button type="button" class="secundario" id="btn-cancelar-ajuste-modal">Cancelar</button>
          <button type="button" id="btn-enviar-ajuste">Enviar solicitud</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const radiosTipo = overlay.querySelectorAll('input[name="ajuste-tipo"]');
    const inputInicioA = overlay.querySelector("#ajuste-fecha-inicio");
    const inputFinA = overlay.querySelector("#ajuste-fecha-fin");
    const etiquetaDias = overlay.querySelector("#ajuste-dias-etiqueta");
    const diasPreview = overlay.querySelector("#ajuste-dias-preview");
    const motivoA = overlay.querySelector("#ajuste-motivo");
    const errorA = overlay.querySelector("#ajuste-error");

    function tipoActual() {
      return overlay.querySelector('input[name="ajuste-tipo"]:checked').value;
    }

    function aplicarModoTipo() {
      if (tipoActual() === "recorte") {
        inputInicioA.min = solicitud.fechaInicio;
        inputInicioA.max = solicitud.fechaFin;
        inputFinA.min = solicitud.fechaInicio;
        inputFinA.max = solicitud.fechaFin;
        inputInicioA.value = solicitud.fechaInicio;
        inputFinA.value = solicitud.fechaFin;
        etiquetaDias.textContent = "Días liberados";
      } else {
        inputInicioA.removeAttribute("min");
        inputInicioA.removeAttribute("max");
        inputFinA.removeAttribute("min");
        inputFinA.removeAttribute("max");
        inputInicioA.value = "";
        inputFinA.value = "";
        etiquetaDias.textContent = "Días hábiles";
      }
      actualizarPreview();
    }
    radiosTipo.forEach(r => r.addEventListener("change", aplicarModoTipo));

    function actualizarPreview() {
      const nuevaInicio = inputInicioA.value;
      const nuevaFin = inputFinA.value;
      if (!nuevaInicio || !nuevaFin) { diasPreview.textContent = "0"; return; }
      const diasNuevos = calcularDiasHabiles(nuevaInicio, nuevaFin, diaDescansoActual, festivosActuales);
      if (tipoActual() === "recorte") {
        diasPreview.textContent = Math.max(0, solicitud.diasHabiles - diasNuevos);
      } else {
        diasPreview.textContent = diasNuevos;
      }
    }
    inputInicioA.addEventListener("input", actualizarPreview);
    inputFinA.addEventListener("input", actualizarPreview);
    actualizarPreview();

    function cerrar() { overlay.remove(); }
    overlay.querySelector("#btn-cancelar-ajuste-modal").addEventListener("click", cerrar);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) cerrar(); });

    overlay.querySelector("#btn-enviar-ajuste").addEventListener("click", async () => {
      errorA.textContent = "";
      const tipo = tipoActual();
      const nuevaInicio = inputInicioA.value;
      const nuevaFin = inputFinA.value;

      if (!nuevaInicio || !nuevaFin) {
        errorA.textContent = "Completa ambas fechas.";
        return;
      }
      if (nuevaInicio > nuevaFin) {
        errorA.textContent = "La fecha de fin debe ser igual o posterior a la de inicio.";
        return;
      }

      const diasHabilesNuevos = calcularDiasHabiles(nuevaInicio, nuevaFin, diaDescansoActual, festivosActuales);
      if (diasHabilesNuevos <= 0) {
        errorA.textContent = "El rango debe cubrir al menos un día hábil.";
        return;
      }

      if (tipo === "recorte") {
        if (nuevaInicio < solicitud.fechaInicio || nuevaFin > solicitud.fechaFin) {
          errorA.textContent = "El nuevo rango debe caer dentro del rango ya aprobado.";
          return;
        }
        if (nuevaInicio !== solicitud.fechaInicio && nuevaFin !== solicitud.fechaFin) {
          errorA.textContent = "Solo puedes recortar desde el inicio o desde el fin, no mover ambas fechas a la vez.";
          return;
        }
        if (diasHabilesNuevos >= solicitud.diasHabiles) {
          errorA.textContent = "El nuevo rango debe ser más corto que el original.";
          return;
        }
      } else {
        const tope = saldoActual + solicitud.diasHabiles;
        if (diasHabilesNuevos > tope) {
          errorA.textContent = `No te alcanza el saldo: pides ${diasHabilesNuevos} día(s) y como máximo tienes ${tope} disponible(s) (tu saldo actual más los ${solicitud.diasHabiles} día(s) que liberaría esta vacación).`;
          return;
        }
      }

      const motivoTexto = motivoA.value.trim();

      try {
        await updateDoc(doc(db, "solicitudesVacaciones", solicitud.id), {
          ajusteSolicitud: {
            tipo,
            fechaInicioNueva: nuevaInicio,
            fechaFinNueva: nuevaFin,
            diasHabilesNuevos,
            motivo: motivoTexto || null,
            estatus: "pendiente",
            creadoEn: new Date().toISOString(),
            comentarioRevisor: null,
            revisadoPor: null,
            revisadoPorNombre: null,
            resueltoEn: null
          }
        });
        cerrar();

        // Aviso por correo + campanita a quien le toca resolver el ajuste
        // (29 sep 2026, pedido de Ivan) — mismo mecanismo que ya usa una
        // solicitud nueva (avisarNuevaSolicitud calcula el destinatario:
        // el supervisor del empleado, o un admin si no tiene). Mejor
        // esfuerzo: si falla, no afecta el guardado de arriba, que ya
        // quedó hecho.
        const ETIQUETAS_TIPO_AJUSTE = { recorte: "recorte", cambioFechas: "cambio de fechas" };
        avisarNuevaSolicitud({
          datosUsuario: datosUsuarioActuales,
          asunto: `Solicitud de ajuste de vacaciones de ${datosUsuarioActuales.nombre}`,
          mensaje: `<p style="margin:0 0 12px;">${escapeHtml(datosUsuarioActuales.nombre)} solicitó un ${ETIQUETAS_TIPO_AJUSTE[tipo] || tipo} sobre una vacación ya aprobada:</p>
<p style="margin:0 0 4px;"><strong>Vacación actual:</strong> ${solicitud.fechaInicio} al ${solicitud.fechaFin} (${solicitud.diasHabiles} día(s))</p>
<p style="margin:0 0 4px;"><strong>Nuevo rango solicitado:</strong> ${nuevaInicio} al ${nuevaFin} (${diasHabilesNuevos} día(s))</p>
${motivoTexto ? `<p style="margin:0 0 12px;"><strong>Motivo:</strong> ${escapeHtml(motivoTexto)}</p>` : ""}
<p style="margin:0;color:#555;font-size:0.9em;">Entra a Adrematasa Interno para aprobarlo o rechazarlo.</p>`,
          tituloBell: "Solicitud de ajuste de vacaciones",
          mensajeBell: `${datosUsuarioActuales.nombre} solicitó un ajuste para tu revisión`,
          fechaEventoBell: formatearRangoFechas(nuevaInicio, nuevaFin)
        });
      } catch (err) {
        errorA.textContent = "No se pudo enviar la solicitud: " + err.message;
      }
    });
  }

  // Historial de ajustes visible para el propio empleado (28 sep 2026,
  // decisión de Ivan: mismo nivel de detalle que ve el admin, incluyendo
  // quién lo autorizó). Junta el historial nuevo con el viejo (ver
  // historialCombinado arriba) y lo muestra de más reciente a más antiguo.
  function abrirModalHistorialAjustes(solicitud) {
    const ETIQUETAS_TIPO = { recorte: "Recorte", cambioFechas: "Cambio de fechas", revertir: "Revertir" };
    const entradas = historialCombinado(solicitud);
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-tarjeta">
        <h2>Historial de ajustes</h2>
        <p class="nota">Vacación: <strong>${solicitud.fechaInicio} al ${solicitud.fechaFin}</strong> (${solicitud.diasHabiles} día(s) hábil(es) actual(es)).</p>
        <div class="tabla-wrap">
          <table class="tabla">
            <thead>
              <tr><th>Tipo</th><th>Antes</th><th>Después</th><th>Motivo</th><th>Autorizó</th><th>Fecha</th></tr>
            </thead>
            <tbody>
              ${entradas.length === 0 ? `<tr><td colspan="6">Sin movimientos.</td></tr>` : entradas.map(h => `
                <tr>
                  <td>${ETIQUETAS_TIPO[h.tipo] || h.tipo || "—"}</td>
                  <td>${h.fechaInicioAnterior || "—"} al ${h.fechaFinAnterior || "—"} (${h.diasHabilesAnterior ?? "—"} día(s))</td>
                  <td>${h.fechaInicioNueva || "—"} al ${h.fechaFinNueva || "—"} (${h.diasHabilesNuevos ?? "—"} día(s))</td>
                  <td>${h.motivo ? escapeHtml(h.motivo) : "—"}</td>
                  <td>${h.aprobadoPorNombre || h.resueltoPorNombre ? escapeHtml(h.aprobadoPorNombre || h.resueltoPorNombre) : "—"}</td>
                  <td>${h.timestamp ? new Date(h.timestamp).toLocaleString("es-MX") : "—"}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
        <div class="modal-acciones">
          <button type="button" class="secundario" id="btn-cerrar-historial-ajustes">Cerrar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    function cerrar() { overlay.remove(); }
    overlay.querySelector("#btn-cerrar-historial-ajustes").addEventListener("click", cerrar);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) cerrar(); });
  }
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto || "";
  return div.innerHTML;
}

// "yyyy-mm-dd" -> "24 de agosto" — para la "fecha del evento" de la campanita
// (ver avisoNuevaSolicitud.js / notificaciones.js).
function formatearFechaLarga(fechaStr) {
  const d = new Date(fechaStr + "T00:00:00");
  if (isNaN(d.getTime())) return fechaStr;
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long" });
}

// Rango de dos "yyyy-mm-dd": mismo día -> "12 de noviembre"; mismo mes ->
// "12 al 15 de noviembre"; meses distintos -> "26 sep al 3 oct".
function formatearRangoFechas(inicioStr, finStr) {
  if (inicioStr === finStr) return formatearFechaLarga(inicioStr);
  const inicio = new Date(inicioStr + "T00:00:00");
  const fin = new Date(finStr + "T00:00:00");
  if (isNaN(inicio.getTime()) || isNaN(fin.getTime())) return `${inicioStr} al ${finStr}`;
  const mismoMes = inicio.getMonth() === fin.getMonth() && inicio.getFullYear() === fin.getFullYear();
  if (mismoMes) {
    const mesLargo = fin.toLocaleDateString("es-MX", { month: "long" });
    return `${inicio.getDate()} al ${fin.getDate()} de ${mesLargo}`;
  }
  const corto = (d) => d.toLocaleDateString("es-MX", { day: "numeric", month: "short" }).replace(".", "");
  return `${corto(inicio)} al ${corto(fin)}`;
}