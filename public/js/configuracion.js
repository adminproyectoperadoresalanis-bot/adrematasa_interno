// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/public/js/configuracion.js
// ##########################################################################
import { db } from "./firebase-config.js";
import {
  doc, setDoc, onSnapshot, getDoc
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { UMBRALES_DEFAULT, FESTIVOS_DEFAULT } from "./vacacionesCalculo.js";
import { AREAS_DEFAULT } from "./estructuraOrganizacional.js";
import { OPCIONES_UTILIDADES } from "./navegacion.js";

export function iniciarConfiguracion(contenedor) {
  // Configuración en 2 secciones (2026-10-13, pedido de Ivan): "1 · RH" y
  // "2 · Utilidades", cada bloque como acordeón con un resumen de una línea.
  // Los ids internos de cada bloque son los mismos de antes — la lógica de
  // carga/guardado de abajo no cambió.
  inyectarEstilosConfiguracion();
  contenedor.innerHTML = `
    <div class="subnav-gestion cfg-secciones">
      <button type="button" class="subnav-boton activo" data-seccion="rh">1 · RH</button>
      <button type="button" class="subnav-boton" data-seccion="utilidades">2 · Utilidades</button>
    </div>

    <div class="cfg-seccion" data-seccion="rh">
      <details class="cfg-acordeon">
        <summary>
          <svg class="cfg-icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="4"/></svg>
          <span class="cfg-titulos"><span class="cfg-titulo">Días de vacaciones por antigüedad</span><span class="cfg-resumen" id="resumen-vacaciones"></span></span>
          <span class="cfg-chevron" aria-hidden="true">›</span>
        </summary>
        <div class="cfg-cuerpo">
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
        </div>
      </details>
      <details class="cfg-acordeon">
        <summary>
          <svg class="cfg-icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/><circle cx="12" cy="15" r="2"/></svg>
          <span class="cfg-titulos"><span class="cfg-titulo">Días festivos oficiales</span><span class="cfg-resumen" id="resumen-festivos"></span></span>
          <span class="cfg-chevron" aria-hidden="true">›</span>
        </summary>
        <div class="cfg-cuerpo">
      <p class="nota">
        Catálogo de días festivos conforme al artículo 74 de la Ley Federal del Trabajo. Un
        festivo que cae dentro de una vacación aprobada no se cobra del saldo (igual que el día
        de descanso semanal de cada empleado), y si el "Retorno a labores" del formato ATAF050
        cae justo en un festivo, se recorre automáticamente al siguiente día hábil. Varias de
        estas fechas son móviles (el "lunes conmemorativo" de febrero, marzo y noviembre) o
        pueden surgir festivos irregulares (jornadas electorales, etc.), así que este catálogo
        debe revisarse y actualizarse cada año.
      </p>
      <div id="festivos-error" class="error"></div>
      <p id="festivos-exito" class="nota oculto" style="color:#1c7a41;"></p>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-festivos">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Nombre</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="tbody-festivos"></tbody>
        </table>
      </div>
      <div class="acciones-form" style="margin-top:14px;">
        <button type="button" id="btn-agregar-festivo" class="secundario">+ Agregar festivo</button>
        <button type="button" id="btn-guardar-festivos">Guardar cambios</button>
      </div>
        </div>
      </details>
      <details class="cfg-acordeon">
        <summary>
          <svg class="cfg-icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="5" rx="1"/><rect x="2" y="16" width="6" height="5" rx="1"/><rect x="16" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M12 12H5v4M12 12h7v4"/></svg>
          <span class="cfg-titulos"><span class="cfg-titulo">Áreas y puestos</span><span class="cfg-resumen" id="resumen-areas"></span></span>
          <span class="cfg-chevron" aria-hidden="true">›</span>
        </summary>
        <div class="cfg-cuerpo">
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
        </div>
      </details>
      <details class="cfg-acordeon">
        <summary>
          <svg class="cfg-icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>
          <span class="cfg-titulos"><span class="cfg-titulo">Reporte semanal de nómina (correo automático)</span><span class="cfg-resumen" id="resumen-reporte"></span></span>
          <span class="cfg-chevron" aria-hidden="true">›</span>
        </summary>
        <div class="cfg-cuerpo">
      <p class="nota">
        Cada jueves a las 6:00 pm (hora de Nuevo Laredo) se manda automáticamente por correo el
        mismo PDF que genera el botón "Vista previa / Imprimir" en Reportes, con las horas extra,
        faltas y vacaciones que estén <strong>aprobadas</strong> a esa hora — sin que nadie tenga
        que abrir la app. Aquí defines a quién llega. Separa varios correos con comas.
      </p>
      <div id="reporte-correo-error" class="error"></div>
      <p id="reporte-correo-exito" class="nota oculto" style="color:#1c7a41;"></p>
      <div>
        <label for="input-reporte-para" style="display:block; font-weight:600; margin-bottom:4px;">Destinatarios (Para)</label>
        <input type="text" id="input-reporte-para" style="width:100%;" placeholder="nominas@alanis.com.mx, rh@alanis.com.mx">
      </div>
      <div style="margin-top:12px;">
        <label for="input-reporte-cc" style="display:block; font-weight:600; margin-bottom:4px;">Con copia (CC) — opcional</label>
        <input type="text" id="input-reporte-cc" style="width:100%;" placeholder="ilanda@alanis.com.mx">
      </div>
      <div class="acciones-form" style="margin-top:14px;">
        <button type="button" id="btn-guardar-reporte-correo">Guardar cambios</button>
      </div>
        </div>
      </details>
    </div>

    <div class="cfg-seccion oculto" data-seccion="utilidades">
      <details class="cfg-acordeon">
        <summary>
          <svg class="cfg-icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
          <span class="cfg-titulos"><span class="cfg-titulo">Acceso a Utilidades por área</span><span class="cfg-resumen" id="resumen-accesos"></span></span>
          <span class="cfg-chevron" aria-hidden="true">›</span>
        </summary>
        <div class="cfg-cuerpo">
      <p class="nota">
        Marca qué opciones de Utilidades ve cada área. El área decide qué opciones aparecen; el rol
        sigue decidiendo qué puede hacer cada quien dentro (por ejemplo, en RH un supervisor aprueba
        a su equipo y un empleado solo solicita). El administrador siempre ve todo. Un empleado sin
        área asignada no ve ninguna opción. Los cambios se aplican la próxima vez que cada usuario
        entre o recargue la app. Si renombras un área arriba, vuelve a marcar aquí sus accesos.
      </p>
      <p id="accesos-aviso" class="nota oculto" style="color:#8a5a00;"></p>
      <div id="accesos-error" class="error"></div>
      <p id="accesos-exito" class="nota oculto" style="color:#1c7a41;"></p>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-accesos">
          <thead><tr id="thead-accesos"></tr></thead>
          <tbody id="tbody-accesos"></tbody>
        </table>
      </div>
      <div class="acciones-form" style="margin-top:14px;">
        <button type="button" id="btn-guardar-accesos">Guardar accesos</button>
      </div>
        </div>
      </details>
      <div class="cfg-acordeon cfg-reservado">
        <div class="cfg-fila">
          <svg class="cfg-icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V4a1 1 0 0 1 1-1h3"/><path d="M17 3h3a1 1 0 0 1 1 1v3"/><path d="M21 17v3a1 1 0 0 1-1 1h-3"/><path d="M7 21H4a1 1 0 0 1-1-1v-3"/><rect x="7" y="7" width="10" height="10" rx="1"/></svg>
          <span class="cfg-titulos"><span class="cfg-titulo">Validación de QR</span><span class="cfg-resumen">Espacio para sus ajustes futuros (hoy no tiene).</span></span>
        </div>
      </div>
      <details class="cfg-acordeon">
        <summary>
          <svg class="cfg-icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="6" width="14" height="10" rx="1"/><path d="M15 9h4l3 3v4h-7"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg>
          <span class="cfg-titulos"><span class="cfg-titulo">Operadores</span><span class="cfg-resumen" id="resumen-operadores">Asistencia ruta corta · datos en vivo de Alanis Operadores</span></span>
          <span class="cfg-chevron" aria-hidden="true">›</span>
        </summary>
        <div class="cfg-cuerpo">
      <h3 style="font-size:15px;margin:0 0 6px;">Asistencia · ruta corta</h3>
      <p class="nota">
        Pago semanal a operadores de ruta Corta y Circuito (Operadores → Asistencia), semana de
        viernes a jueves. Se paga proporcional: pago semanal ÷ 7 × días pagados. Un día se paga si
        tuvo entrada a patio y además estuvo Disponible sin dejarlo vencer hasta la hora de corte,
        aceptó un viaje o estuvo en taller.
      </p>
      <div id="asist-error" class="error"></div>
      <p id="asist-exito" class="nota oculto" style="color:#1c7a41;"></p>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <div style="flex:1;min-width:160px;"><label for="asist-corta">Pago semanal · Corta ($)</label><input type="number" id="asist-corta" min="0" step="0.01" placeholder="Ej: 3500"></div>
        <div style="flex:1;min-width:160px;"><label for="asist-circuito">Pago semanal · Circuito ($)</label><input type="number" id="asist-circuito" min="0" step="0.01" placeholder="Ej: 1500"></div>
        <div style="flex:1;min-width:160px;"><label for="asist-corte">Hora de corte del día</label><input type="time" id="asist-corte" value="18:00"></div>
      </div>
      <label for="asist-para" style="margin-top:12px;display:block;">Correo al autorizar la semana · Para (separa con coma)</label>
      <input type="text" id="asist-para" placeholder="nomina@alanis.com.mx, ...">
      <label for="asist-cc" style="margin-top:8px;display:block;">CC</label>
      <input type="text" id="asist-cc" placeholder="opcional">
      <label style="margin-top:12px;display:block;">Pueden reabrir una semana ya autorizada (además del admin)</label>
      <div id="asist-puestos" class="nota" style="display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:6px;">Cargando puestos…</div>
      <div class="acciones-form" style="margin-top:14px;">
        <button type="button" id="btn-guardar-asistencia">Guardar asistencia</button>
      </div>
      <hr style="border:none;border-top:1px solid #efebe5;margin:18px 0;">
      <p class="nota">
        Las pantallas de Operadores leen una copia en vivo de Alanis Operadores que se
        actualiza sola en 1–2 segundos con cada cambio. Usa este botón solo la primera
        vez, o si notas que algo no cuadra: vuelve a copiar todo (solicitudes pendientes,
        operadores, órdenes de trabajo de 120 días, viajes de 60 días y el último estatus
        de patio). Solo administradores.
      </p>
      <div id="espejos-error" class="error"></div>
      <p id="espejos-exito" class="nota oculto" style="color:#1c7a41;"></p>
      <div class="acciones-form" style="margin-top:14px;">
        <button type="button" id="btn-resincronizar-espejos">Resincronizar datos de Alanis Operadores</button>
      </div>
        </div>
      </details>
    </div>
  `;

  // Asistencia ruta corta (2026-10-20): configuracion/asistencia
  // { montoSemanaCorta, montoSemanaCircuito, horaCorte, reabrenPuestos[],
  // destinatarios[], cc[] }. Lo leen las funciones de
  // operadoresAlanis.js (calcularAsistenciaSemana, reabrirAsistenciaSemana).
  const refAsistencia = doc(db, "configuracion", "asistencia");
  const cajaPuestos = contenedor.querySelector("#asist-puestos");
  let reabrenGuardados = [];
  function pintarPuestos(lista) {
    if (!lista.length) { cajaPuestos.textContent = "No hay puestos en Áreas y puestos."; return; }
    cajaPuestos.innerHTML = lista.map(p => `<label style="display:inline-flex;gap:5px;align-items:center;margin:0;color:#2c1e0f;"><input type="checkbox" class="asist-puesto" value="${escapeHtml(p)}" style="width:auto;"${reabrenGuardados.includes(p) ? " checked" : ""}> ${escapeHtml(p)}</label>`).join("");
  }
  let puestosCatalogo = [];
  getDoc(doc(db, "configuracion", "estructura")).then(s => {
    const areas = (s.exists() && Array.isArray(s.data().areas)) ? s.data().areas : AREAS_DEFAULT;
    puestosCatalogo = [...new Set(areas.flatMap(a => (a && Array.isArray(a.puestos)) ? a.puestos : []).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    pintarPuestos(puestosCatalogo);
  }).catch(() => { cajaPuestos.textContent = "No se pudieron cargar los puestos."; });
  onSnapshot(refAsistencia, (s) => {
    const c = s.exists() ? s.data() : {};
    contenedor.querySelector("#asist-corta").value = typeof c.montoSemanaCorta === "number" ? c.montoSemanaCorta : "";
    contenedor.querySelector("#asist-circuito").value = typeof c.montoSemanaCircuito === "number" ? c.montoSemanaCircuito : "";
    contenedor.querySelector("#asist-corte").value = c.horaCorte || "18:00";
    contenedor.querySelector("#asist-para").value = Array.isArray(c.destinatarios) ? c.destinatarios.join(", ") : "";
    contenedor.querySelector("#asist-cc").value = Array.isArray(c.cc) ? c.cc.join(", ") : "";
    reabrenGuardados = Array.isArray(c.reabrenPuestos) ? c.reabrenPuestos : [];
    if (puestosCatalogo.length) pintarPuestos(puestosCatalogo);
    const r = contenedor.querySelector("#resumen-operadores");
    if (r) r.textContent = typeof c.montoSemanaCorta === "number" && typeof c.montoSemanaCircuito === "number"
      ? `Asistencia: Corta $${c.montoSemanaCorta.toLocaleString("es-MX")} · Circuito $${c.montoSemanaCircuito.toLocaleString("es-MX")} por semana · corte ${c.horaCorte || "18:00"}`
      : "Asistencia: falta capturar el pago semanal de Corta y Circuito";
  });
  contenedor.querySelector("#btn-guardar-asistencia").addEventListener("click", async () => {
    const err = contenedor.querySelector("#asist-error");
    const ok = contenedor.querySelector("#asist-exito");
    err.textContent = ""; ok.classList.add("oculto");
    const leerMonto = (id) => { const v = contenedor.querySelector(id).value; const n = Number(v); return v === "" || !isFinite(n) || n < 0 ? null : Math.round(n * 100) / 100; };
    const corta = leerMonto("#asist-corta"), circuito = leerMonto("#asist-circuito");
    const corte = contenedor.querySelector("#asist-corte").value || "18:00";
    if (corta === null || circuito === null) { err.textContent = "Captura el pago semanal de Corta y de Circuito."; return; }
    const reabren = [...cajaPuestos.querySelectorAll(".asist-puesto:checked")].map(x => x.value);
    const correos = (id) => contenedor.querySelector(id).value.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
    const para = correos("#asist-para"), cc = correos("#asist-cc");
    const malo = [...para, ...cc].find(x => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
    if (malo) { err.textContent = `Correo no válido: ${malo}`; return; }
    try {
      await setDoc(refAsistencia, { montoSemanaCorta: corta, montoSemanaCircuito: circuito, horaCorte: corte, reabrenPuestos: reabren, destinatarios: para, cc, actualizadoEn: new Date().toISOString() }, { merge: true });
      ok.textContent = "Guardado. Aplica a las semanas que todavía no estén autorizadas.";
      ok.classList.remove("oculto");
    } catch (e) {
      err.textContent = "No se pudo guardar: " + e.message;
    }
  });

  // Resincronizar espejos de Alanis Operadores (2026-10-16): llama a
  // poblarEspejosOperadores (functions/operadoresAlanis.js, solo admin).
  const btnEspejos = contenedor.querySelector("#btn-resincronizar-espejos");
  btnEspejos.addEventListener("click", async () => {
    const errorEspejos = contenedor.querySelector("#espejos-error");
    const exitoEspejos = contenedor.querySelector("#espejos-exito");
    errorEspejos.textContent = "";
    exitoEspejos.classList.add("oculto");
    btnEspejos.disabled = true;
    const textoOriginal = btnEspejos.textContent;
    btnEspejos.textContent = "Copiando… (puede tardar un minuto)";
    try {
      const { getFunctions, httpsCallable } = await import("https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js");
      const fn = httpsCallable(getFunctions(undefined, "us-central1"), "poblarEspejosOperadores", { timeout: 300000 });
      const { data } = await fn();
      const c = (data && data.conteo) || {};
      const nombres = { solicitudes: "solicitudes pendientes", operadores: "operadores", ordenes: "órdenes de trabajo", asignaciones: "viajes", estatus: "estatus de patio" };
      const partes = Object.keys(c).map(k => `${c[k]} ${nombres[k] || k}`);
      exitoEspejos.textContent = "Listo. " + (partes.length ? partes.join(" · ") : "Copia terminada.");
      exitoEspejos.classList.remove("oculto");
    } catch (err) {
      errorEspejos.textContent = "No se pudo resincronizar: " + (err.message || err);
    } finally {
      btnEspejos.disabled = false;
      btnEspejos.textContent = textoOriginal;
    }
  });

  contenedor.querySelectorAll(".cfg-secciones .subnav-boton").forEach(btn => {
    btn.addEventListener("click", () => {
      contenedor.querySelectorAll(".cfg-secciones .subnav-boton")
        .forEach(b => b.classList.toggle("activo", b === btn));
      contenedor.querySelectorAll(".cfg-seccion")
        .forEach(s => s.classList.toggle("oculto", s.dataset.seccion !== btn.dataset.seccion));
    });
  });
  const ponerResumen = (id, texto) => {
    const el = contenedor.querySelector("#" + id);
    if (el) el.textContent = texto;
  };

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
    ponerResumen("resumen-vacaciones", umbrales.length === 1 ? "1 rango" : `${umbrales.length} rangos`);
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

  // --- Días festivos oficiales (1 oct 2026) ---

  const tbodyFestivos = contenedor.querySelector("#tbody-festivos");
  const errorFestivosDiv = contenedor.querySelector("#festivos-error");
  const exitoFestivosP = contenedor.querySelector("#festivos-exito");
  const btnAgregarFestivo = contenedor.querySelector("#btn-agregar-festivo");
  const btnGuardarFestivos = contenedor.querySelector("#btn-guardar-festivos");

  const refFestivos = doc(db, "configuracion", "diasFestivos");
  let festivos = [];

  onSnapshot(refFestivos, (snap) => {
    const datos = snap.exists() ? snap.data().festivos : null;
    festivos = Array.isArray(datos) && datos.length > 0
      ? [...datos].sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""))
      : FESTIVOS_DEFAULT.map(f => ({ ...f }));
    renderFestivos();
  }, (err) => {
    errorFestivosDiv.textContent = "No se pudo cargar la configuración: " + err.message;
  });

  function renderFestivos() {
    const hoyISO = new Date().toISOString().slice(0, 10);
    const proximo = festivos.map(f => f.fecha).filter(f => f && f >= hoyISO).sort()[0];
    const proximoTxt = proximo
      ? " · próximo: " + new Date(proximo + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" })
      : "";
    ponerResumen("resumen-festivos", `${festivos.length} festivos${proximoTxt}`);
    if (festivos.length === 0) {
      tbodyFestivos.innerHTML = `<tr><td colspan="3">No hay festivos definidos. Agrega al menos uno.</td></tr>`;
      return;
    }

    tbodyFestivos.innerHTML = festivos.map((f, i) => `
      <tr data-i="${i}">
        <td><input type="date" class="input-festivo-fecha" value="${f.fecha || ""}"></td>
        <td><input type="text" class="input-festivo-nombre" value="${escapeHtml(f.nombre || "")}" placeholder="Nombre del festivo"></td>
        <td class="acciones"><button type="button" class="btn-rechazar btn-quitar-festivo">Quitar</button></td>
      </tr>
    `).join("");

    tbodyFestivos.querySelectorAll("tr[data-i]").forEach(fila => {
      const i = Number(fila.dataset.i);
      fila.querySelector(".input-festivo-fecha").addEventListener("input", (e) => {
        festivos[i].fecha = e.target.value;
      });
      fila.querySelector(".input-festivo-nombre").addEventListener("input", (e) => {
        festivos[i].nombre = e.target.value;
      });
      fila.querySelector(".btn-quitar-festivo").addEventListener("click", () => {
        festivos.splice(i, 1);
        renderFestivos();
      });
    });
  }

  btnAgregarFestivo.addEventListener("click", () => {
    festivos.push({ fecha: "", nombre: "" });
    renderFestivos();
  });

  btnGuardarFestivos.addEventListener("click", async () => {
    errorFestivosDiv.textContent = "";
    exitoFestivosP.classList.add("oculto");

    const limpios = festivos
      .map(f => ({ fecha: (f.fecha || "").trim(), nombre: (f.nombre || "").trim() }))
      .filter(f => f.fecha !== "")
      .sort((a, b) => a.fecha.localeCompare(b.fecha));

    const fechasUnicas = new Set(limpios.map(f => f.fecha));
    if (fechasUnicas.size !== limpios.length) {
      errorFestivosDiv.textContent = "Hay fechas repetidas en el catálogo de festivos.";
      return;
    }

    try {
      await setDoc(refFestivos, { festivos: limpios, actualizadoEn: new Date().toISOString() });
      festivos = limpios;
      renderFestivos();
      exitoFestivosP.textContent = "Cambios guardados. Se aplicarán en el próximo cálculo de vacaciones (no afecta solicitudes ya hechas).";
      exitoFestivosP.classList.remove("oculto");
    } catch (err) {
      errorFestivosDiv.textContent = "No se pudo guardar: " + err.message;
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

  // --- Acceso a Utilidades por área (paso 2, 12 oct 2026) ---
  // Documento configuracion/accesosUtilidades:
  //   { porArea: { "<nombre de área>": ["rh", "validacionQR", ...] }, actualizadoEn }
  // Lo lee auth.js al entrar cada usuario (ver opcionesUtilidadesPermitidas).
  // Mientras el documento no exista, todos ven todas las opciones; por eso la
  // tabla arranca con todo marcado, para reflejar cómo está hoy.

  const theadAccesos = contenedor.querySelector("#thead-accesos");
  const tbodyAccesos = contenedor.querySelector("#tbody-accesos");
  const avisoAccesosP = contenedor.querySelector("#accesos-aviso");
  const errorAccesosDiv = contenedor.querySelector("#accesos-error");
  const exitoAccesosP = contenedor.querySelector("#accesos-exito");
  const btnGuardarAccesos = contenedor.querySelector("#btn-guardar-accesos");
  const refAccesos = doc(db, "configuracion", "accesosUtilidades");

  let areasGuardadas = [];
  let porArea = null;          // null = todavía no existe configuración guardada
  let accesosCargados = false;

  onSnapshot(refAccesos, (snap) => {
    porArea = snap.exists() ? (snap.data().porArea || {}) : null;
    accesosCargados = true;
    renderAccesos();
  }, (err) => {
    errorAccesosDiv.textContent = "No se pudo cargar la configuración de accesos: " + err.message;
  });

  function tieneAcceso(area, idOpcion) {
    if (porArea === null) return true;
    return Array.isArray(porArea[area]) && porArea[area].includes(idOpcion);
  }

  function renderAccesos() {
    if (!accesosCargados) return;
    ponerResumen("resumen-accesos", porArea === null
      ? "Sin guardar todavía: por ahora todas las áreas ven todo"
      : "Qué opciones ve cada área · el admin siempre ve todo");

    theadAccesos.innerHTML = `<th>Área</th>` +
      OPCIONES_UTILIDADES.map(op => `<th style="text-align:center;">${escapeHtml(op.etiqueta)}</th>`).join("");

    if (porArea === null) {
      avisoAccesosP.textContent = "Todavía no se ha guardado esta configuración: por ahora todas las áreas ven todas las opciones. En cuanto la guardes, cada área verá solo lo que esté marcado.";
      avisoAccesosP.classList.remove("oculto");
    } else {
      avisoAccesosP.classList.add("oculto");
    }

    if (areasGuardadas.length === 0) {
      tbodyAccesos.innerHTML = `<tr><td colspan="${OPCIONES_UTILIDADES.length + 1}">No hay áreas guardadas. Captúralas en "Áreas y puestos".</td></tr>`;
      return;
    }

    tbodyAccesos.innerHTML = areasGuardadas.map(area => `
      <tr data-area="${escapeHtml(area)}">
        <td>${escapeHtml(area)}</td>
        ${OPCIONES_UTILIDADES.map(op => `
          <td style="text-align:center;">
            <input type="checkbox" class="check-acceso" data-opcion="${op.id}"
              ${tieneAcceso(area, op.id) ? "checked" : ""}
              aria-label="${escapeHtml(area)}: ${escapeHtml(op.etiqueta)}">
          </td>
        `).join("")}
      </tr>
    `).join("");
  }

  btnGuardarAccesos.addEventListener("click", async () => {
    errorAccesosDiv.textContent = "";
    exitoAccesosP.classList.add("oculto");

    // Se lee el estado directo de las casillas, fila por fila.
    const nuevo = {};
    tbodyAccesos.querySelectorAll("tr[data-area]").forEach((fila, idx) => {
      const area = areasGuardadas[idx];
      nuevo[area] = [...fila.querySelectorAll(".check-acceso")]
        .filter(c => c.checked)
        .map(c => c.dataset.opcion);
    });

    try {
      await setDoc(refAccesos, { porArea: nuevo, actualizadoEn: new Date().toISOString() });
      exitoAccesosP.textContent = "Accesos guardados. Cada usuario los verá la próxima vez que entre o recargue la app.";
      exitoAccesosP.classList.remove("oculto");
    } catch (err) {
      errorAccesosDiv.textContent = "No se pudieron guardar los accesos: " + err.message;
    }
  });

  onSnapshot(refEstructura, (snap) => {
    const datos = snap.exists() ? snap.data().areas : null;
    areas = Array.isArray(datos) && datos.length > 0
      ? datos.map(a => ({ nombre: a.nombre, puestos: [...(a.puestos || [])] }))
      : AREAS_DEFAULT.map(a => ({ nombre: a.nombre, puestos: [...a.puestos] }));
    // La tabla de accesos usa las áreas YA GUARDADAS (no lo que se esté
    // editando arriba sin guardar).
    areasGuardadas = areas.map(a => a.nombre).filter(Boolean);
    renderAccesos();
    renderAreas();
  }, (err) => {
    errorAreasDiv.textContent = "No se pudo cargar la configuración: " + err.message;
  });

  function renderAreas() {
    ponerResumen("resumen-areas", `${areas.length} áreas · también definen las filas de Acceso a Utilidades`);
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

  // --- Reporte semanal de nómina (correo automático) ---

  const inputReportePara = contenedor.querySelector("#input-reporte-para");
  const inputReporteCc = contenedor.querySelector("#input-reporte-cc");
  const errorReporteDiv = contenedor.querySelector("#reporte-correo-error");
  const exitoReporteP = contenedor.querySelector("#reporte-correo-exito");
  const btnGuardarReporteCorreo = contenedor.querySelector("#btn-guardar-reporte-correo");

  const refReporteCorreo = doc(db, "configuracion", "reporteSemanal");

  onSnapshot(refReporteCorreo, (snap) => {
    const datos = snap.exists() ? snap.data() : null;
    inputReportePara.value = Array.isArray(datos?.destinatarios) ? datos.destinatarios.join(", ") : "";
    inputReporteCc.value = Array.isArray(datos?.cc) ? datos.cc.join(", ") : "";
    const nPara = Array.isArray(datos?.destinatarios) ? datos.destinatarios.length : 0;
    const nCc = Array.isArray(datos?.cc) ? datos.cc.length : 0;
    ponerResumen("resumen-reporte", `Jueves 6:00 pm · ${nPara} destinatario${nPara === 1 ? "" : "s"}` + (nCc ? ` + ${nCc} CC` : ""));
  }, (err) => {
    errorReporteDiv.textContent = "No se pudo cargar la configuración: " + err.message;
  });

  function separarCorreos(texto) {
    return (texto || "")
      .split(",")
      .map(c => c.trim())
      .filter(Boolean);
  }

  btnGuardarReporteCorreo.addEventListener("click", async () => {
    errorReporteDiv.textContent = "";
    exitoReporteP.classList.add("oculto");

    const destinatarios = separarCorreos(inputReportePara.value);
    const cc = separarCorreos(inputReporteCc.value);

    if (destinatarios.length === 0) {
      errorReporteDiv.textContent = 'Agrega al menos un correo en "Destinatarios (Para)".';
      return;
    }

    try {
      await setDoc(refReporteCorreo, { destinatarios, cc, actualizadoEn: new Date().toISOString() });
      exitoReporteP.textContent = "Cambios guardados. Se aplicarán en el próximo envío automático del jueves (o al correr el workflow manualmente desde GitHub Actions).";
      exitoReporteP.classList.remove("oculto");
    } catch (err) {
      errorReporteDiv.textContent = "No se pudo guardar: " + err.message;
    }
  });
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto || "";
  return div.innerHTML;
}

// Estilos de la pantalla de Configuración en secciones/acordeón. Se inyectan
// una sola vez (mismo criterio que navegacion.js) para no tocar estilos.css.
function inyectarEstilosConfiguracion() {
  if (document.getElementById("estilos-configuracion")) return;
  const estilo = document.createElement("style");
  estilo.id = "estilos-configuracion";
  estilo.textContent = `
    .cfg-secciones { margin-bottom: 14px; }
    .cfg-acordeon { background: #fff; border: 1px solid #e2ddd5; border-radius: 12px; margin-bottom: 10px; }
    .cfg-acordeon[open] { border-color: #2c1e0f; }
    .cfg-acordeon > summary, .cfg-fila { display: flex; align-items: center; gap: 12px; padding: 14px 16px;
      list-style: none; cursor: pointer; color: #2c1e0f; }
    .cfg-acordeon > summary::-webkit-details-marker { display: none; }
    .cfg-icono { width: 22px; height: 22px; flex-shrink: 0; }
    .cfg-titulos { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .cfg-titulo { font-size: 15px; font-weight: 600; }
    .cfg-resumen { font-size: 12px; color: #6b5f52; }
    .cfg-chevron { margin-left: auto; font-size: 20px; color: #6b5f52; transition: transform .15s; }
    .cfg-acordeon[open] .cfg-chevron { transform: rotate(90deg); }
    .cfg-cuerpo { border-top: 1px solid #efebe5; padding: 14px 16px 16px; }
    .cfg-reservado { border-style: dashed; background: transparent; }
    .cfg-reservado .cfg-fila { cursor: default; }
    .cfg-reservado .cfg-titulo { color: #6b5f52; }
  `;
  document.head.appendChild(estilo);
}