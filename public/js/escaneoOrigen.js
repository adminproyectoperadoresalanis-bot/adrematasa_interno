import { db } from "./firebase-config.js";
import {
  collection, doc, setDoc, getDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// ----------------------------------------------------------------------
// Cadena de 3 validaciones (decidida por Ivan, 2026-09-02):
//   1) Atención al Cliente escanea el CFDI real (origenEscaneo).
//   2) Alguien de Operaciones MEX (Coordinador/Supervisor/Auxiliar/
//      Despachador) vuelve a escanear el MISMO CFDI de forma
//      independiente y lo compara contra lo que registró Atención al
//      Cliente (validacion2).
//   3) Solo hasta que las dos existen, el Apps Script sincroniza
//      uuidEsperado/receptorRFCEsperado hacia alanis-operadores — el
//      operador (checkpoints de recepción/pre-entrega) no encuentra nada
//      contra qué comparar hasta que las dos validaciones ya pasaron.
//
// Área/puesto son los mismos valores EXACTOS que usan Organigrama y
// Catálogo de empleados (usuarios/{uid}.area, usuarios/{uid}.puesto) —
// no el "rol" de permisos del sistema. Un admin siempre puede hacer
// cualquiera de las dos validaciones, como respaldo.
// ----------------------------------------------------------------------
const AREA_ATENCION_CLIENTE = "Atención al cliente";
const AREA_OPERACIONES = "Operaciones MEX";
const PUESTOS_VALIDADOR2 = ["Coordinador", "Supervisor", "Auxiliar", "Despachador"];

// Solo admin/supervisor pueden corregir un escaneo de origen ya registrado
// (así lo exige también firestore.rules — esto solo evita mostrar un botón
// que igual sería rechazado). La corrección de la validación 2 todavía no
// existe (no se pidió) — si algo sale mal ahí, hay que corregirlo a mano
// en la consola de Firebase por ahora.
const ROLES_QUE_CORRIGEN = ["admin", "supervisor"];

const ETIQUETAS_SYNC = {
  esperando_validacion2: "Esperando 2da validación",
  pendiente: "Sincronizando…",
  sincronizado: "Sincronizado",
  error: "Error de sync"
};
const CLASES_SYNC = {
  esperando_validacion2: "badge-pendiente",
  pendiente: "badge-pendiente",
  sincronizado: "badge-aprobada",
  error: "badge-rechazada"
};

function formatoFecha(valor) {
  if (!valor) return "—";
  const fecha = typeof valor.toDate === "function" ? valor.toDate() : new Date(valor);
  if (isNaN(fecha.getTime())) return "—";
  return fecha.toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
}

// Normaliza para comparar caja/remolque sin que espacios o mayúsculas
// hagan que algo idéntico se vea como "no coincide".
function normalizarCaja(valor) {
  return (valor || "").toString().trim().toUpperCase();
}

// Extrae { uuid, rfc } del QR de verificación del CFDI del SAT
// (https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id=...&rr=...).
// Devuelve null si el texto leído no es una URL de ese tipo o le falta el
// UUID o el RFC receptor — el total (tt) se ignora a propósito, por privacidad.
function parsearQR(texto) {
  let url;
  try {
    url = new URL(texto);
  } catch {
    return null;
  }
  const uuid = (url.searchParams.get("id") || "").trim();
  const rfc = (url.searchParams.get("rr") || "").trim();
  if (!uuid || !rfc) return null;
  if (!/^[0-9a-fA-F-]{30,40}$/.test(uuid)) return null;
  return { uuid: uuid.toUpperCase(), rfc: rfc.toUpperCase() };
}

// Beep corto vía WebAudio — sin archivos de audio, funciona sin conexión.
// Si el navegador no soporta AudioContext (o el usuario aún no interactuó
// con la página, algunos navegadores lo exigen), simplemente no suena.
function reproducirSonido(tipo) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    if (tipo === "exito") {
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } else {
      osc.frequency.value = 220;
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    }
    osc.onended = () => ctx.close().catch(() => {});
  } catch {
    /* sin soporte de audio en este navegador — se ignora */
  }
}

function vibrar(tipo) {
  if (!navigator.vibrate) return;
  navigator.vibrate(tipo === "exito" ? [80] : [120, 80, 120]);
}

const ICONO_EXITO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12.5l2.5 2.5L16 9"/></svg>`;
const ICONO_ALERTA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L14.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 17h.01"/></svg>`;

// contenedor: elemento donde dibujar. datosUsuario: doc de usuarios/{uid}
// (se usa .nombre, .rol, .area y .puesto). uid: el auth.uid de quien tiene
// la sesión abierta.
export function iniciarEscaneoOrigen(contenedor, datosUsuario, uid) {
  const esAdmin = datosUsuario.rol === "admin";
  const puedeCorregir = ROLES_QUE_CORRIGEN.includes(datosUsuario.rol);
  const puedeValidar1 = esAdmin || datosUsuario.area === AREA_ATENCION_CLIENTE;
  const puedeValidar2 = esAdmin || (
    datosUsuario.area === AREA_OPERACIONES && PUESTOS_VALIDADOR2.includes(datosUsuario.puesto)
  );

  // Cada quien ve solo el paso que le toca hacer (Atención al Cliente ve
  // pendientes de origen, Operaciones ve pendientes de 2da validación);
  // un admin ve las dos secciones. El historial, en cambio, es visible
  // para todos por igual — así cualquiera ve el trabajo del resto del
  // equipo, no solo el suyo (decisión de Ivan, 2026-09-02).
  const seccionPendientesOrigen = !puedeValidar1 ? "" : `
    <section class="panel">
      <h2>Embarques pendientes de primera validación (Atención al Cliente)</h2>
      <p class="nota">Embarques de McCain sin CFDI escaneado todavía por Atención al Cliente. Esta lista se sincroniza con Alanis Operadores cada pocos minutos, así que un escaneo reciente puede tardar un momento en desaparecer de aquí.</p>
      <div id="pendientes-origen-error" class="error"></div>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-pendientes-origen">
          <thead>
            <tr><th>Shipment</th><th>OC Cliente</th><th>Cliente</th><th>Caja</th><th>Entrega</th><th>Acción</th></tr>
          </thead>
          <tbody id="tbody-pendientes-origen"><tr><td colspan="6">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>
  `;

  const seccionPendientesValidacion2 = !puedeValidar2 ? "" : `
    <section class="panel" style="margin-top:20px;">
      <h2>Embarques pendientes de segunda validación (Operaciones)</h2>
      <p class="nota">Embarques que Atención al Cliente ya escaneó, esperando que Operaciones (Coordinador, Supervisor, Auxiliar o Despachador) los vuelva a escanear de forma independiente. Hasta que esto pase, el operador no puede ver el embarque en Alanis Operadores.</p>
      <div id="pendientes-validacion2-error" class="error"></div>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-pendientes-validacion2">
          <thead>
            <tr><th>Embarque</th><th>Cliente</th><th>Caja</th><th>Escaneado por</th><th>Acción</th></tr>
          </thead>
          <tbody id="tbody-pendientes-validacion2"><tr><td colspan="5">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>
  `;

  // Tercera validación (el operador, en Alanis Operadores) no se hace desde
  // esta app — es informativa nada más, así que se muestra a cualquiera,
  // igual que el historial.
  const seccionPendientesValidacion3 = `
    <section class="panel" style="margin-top:20px;">
      <h2>Embarques pendientes de tercera validación (Operador)</h2>
      <p class="nota">Embarques que ya pasaron las dos validaciones de aquí y ya se sincronizaron con Alanis Operadores, esperando que el operador haga su propio escaneo en el checkpoint. Esta sección es solo informativa — esa validación se hace desde Alanis Operadores, no desde aquí.</p>
      <div id="pendientes-validacion3-error" class="error"></div>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-pendientes-validacion3">
          <thead>
            <tr><th>Embarque</th><th>Cliente</th><th>Caja</th><th>2da validación por</th><th>Estado</th></tr>
          </thead>
          <tbody id="tbody-pendientes-validacion3"><tr><td colspan="5">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>
  `;

  const avisoSinPasoAsignado = (puedeValidar1 || puedeValidar2) ? "" : `
    <section class="panel">
      <p class="nota">Con tu área/puesto actual no tienes ningún paso de escaneo asignado en este módulo — puedes ver el historial abajo.</p>
    </section>
  `;

  contenedor.innerHTML = `
    <style>
      .aviso-discrepancia {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        background: #a32424;
        color: #fff;
        padding: 14px 16px;
        border-radius: 8px;
        margin: 10px 0;
        font-weight: 600;
        font-size: 0.95rem;
      }
      .aviso-discrepancia svg { width: 28px; height: 28px; flex: none; }
    </style>
    ${seccionPendientesOrigen}
    ${seccionPendientesValidacion2}
    ${seccionPendientesValidacion3}
    ${avisoSinPasoAsignado}

    <section class="panel" style="margin-top:20px;">
      <h2>Historial de escaneos</h2>
      <div id="historial-origen-error" class="error"></div>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-historial-origen">
          <thead>
            <tr>
              <th>Embarque</th><th>UUID CFDI</th><th>RFC receptor</th><th>Caja origen</th><th>Atención al Cliente</th><th>2da validación (Operaciones)</th><th>Sincronización</th>${puedeCorregir ? "<th>Acción</th>" : ""}
            </tr>
          </thead>
          <tbody id="tbody-historial-origen"><tr><td colspan="${puedeCorregir ? 8 : 7}">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>

    <div id="modal-escaneo-origen" class="modal-overlay oculto">
      <div class="modal-tarjeta">
        <h2 id="modal-escaneo-titulo">Escanear CFDI de origen</h2>
        <p class="nota" id="modal-escaneo-info"></p>
        <div id="modal-escaneo-error" class="error"></div>

        <div id="modal-escaneo-captura">
          <div class="subnav-gestion">
            <button type="button" class="subnav-boton activo" data-modo="camara">Cámara</button>
            <button type="button" class="subnav-boton" data-modo="manual">Captura manual</button>
          </div>

          <div id="modal-modo-camara">
            <div id="qr-reader"></div>
            <p class="nota" id="modal-camara-estado">Apunta la cámara al código QR del CFDI.</p>
          </div>

          <div id="modal-modo-manual" class="oculto">
            <div class="modal-fila">
              <label>UUID del CFDI
                <input type="text" id="modal-manual-uuid" placeholder="00000000-0000-0000-0000-000000000000">
              </label>
              <label>RFC receptor
                <input type="text" id="modal-manual-rfc" placeholder="XAXX010101000">
              </label>
            </div>
            <div class="modal-acciones">
              <button type="button" id="modal-manual-usar">Usar estos datos</button>
            </div>
          </div>
        </div>

        <div id="modal-escaneo-confirmar" class="oculto">
          <div class="modal-fila">
            <label>UUID leído
              <input type="text" id="modal-confirmar-uuid" disabled>
            </label>
            <label>RFC receptor leído
              <input type="text" id="modal-confirmar-rfc" disabled>
            </label>
          </div>
          <div class="modal-fila">
            <label>Caja / remolque (obligatorio)
              <input type="text" id="modal-confirmar-caja" placeholder="Número de caja o remolque" required>
            </label>
          </div>
          <div id="modal-confirmar-aviso-caja" class="aviso-discrepancia oculto"></div>
          <div id="modal-confirmar-error" class="error"></div>
          <div class="modal-acciones">
            <button type="button" class="secundario" id="modal-volver-escanear">Volver a escanear</button>
            <button type="button" id="modal-confirmar-guardar">Confirmar y registrar</button>
          </div>
        </div>

        <div class="modal-acciones">
          <button type="button" class="secundario" id="modal-escaneo-cancelar">Cancelar</button>
        </div>
      </div>
    </div>

    <div id="resultado-escaneo-origen" class="resultado-escaneo-overlay oculto">
      <div class="resultado-escaneo-contenido">
        <div id="resultado-escaneo-icono"></div>
        <h2 id="resultado-escaneo-titulo"></h2>
        <p id="resultado-escaneo-detalle"></p>
        <p id="resultado-escaneo-detalle2" class="oculto"></p>
        <p id="resultado-escaneo-registro" class="resultado-escaneo-registro"></p>
        <button type="button" id="resultado-escaneo-continuar">Continuar</button>
      </div>
    </div>
  `;

  let listaPendientes = [];
  let listaHistorial = [];
  let listaResultados = [];

  const errorPendientesDiv = contenedor.querySelector("#pendientes-origen-error");
  const errorValidacion2Div = contenedor.querySelector("#pendientes-validacion2-error");
  const errorValidacion3Div = contenedor.querySelector("#pendientes-validacion3-error");
  const errorHistorialDiv = contenedor.querySelector("#historial-origen-error");
  const tbodyPendientes = contenedor.querySelector("#tbody-pendientes-origen");
  const tbodyValidacion2 = contenedor.querySelector("#tbody-pendientes-validacion2");
  const tbodyValidacion3 = contenedor.querySelector("#tbody-pendientes-validacion3");
  const tbodyHistorial = contenedor.querySelector("#tbody-historial-origen");

  onSnapshot(collection(db, "embarques_pendientes_origen"), (snap) => {
    listaPendientes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPendientes();
  }, (err) => {
    if (errorPendientesDiv) errorPendientesDiv.textContent = "No se pudieron cargar los embarques pendientes: " + err.message;
  });

  onSnapshot(collection(db, "verificaciones_cfdi_local"), (snap) => {
    listaHistorial = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    listaHistorial.sort((a, b) => {
      const ta = a.origenEscaneo && a.origenEscaneo.timestamp && a.origenEscaneo.timestamp.toMillis ? a.origenEscaneo.timestamp.toMillis() : 0;
      const tb = b.origenEscaneo && b.origenEscaneo.timestamp && b.origenEscaneo.timestamp.toMillis ? b.origenEscaneo.timestamp.toMillis() : 0;
      return tb - ta;
    });
    renderHistorial();
    renderPendientes();
    renderPendientesValidacion2();
    renderPendientesValidacion3();
  }, (err) => {
    errorHistorialDiv.textContent = "No se pudo cargar el historial: " + err.message;
  });

  onSnapshot(collection(db, "verificaciones_cfdi_resultado"), (snap) => {
    listaResultados = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPendientesValidacion3();
  }, (err) => {
    if (errorValidacion3Div) errorValidacion3Div.textContent = "No se pudo cargar el estado del operador: " + err.message;
  });

  function renderPendientes() {
    if (!tbodyPendientes) return; // esta sección no se dibujó para este usuario
    if (listaPendientes.length === 0) {
      tbodyPendientes.innerHTML = `<tr><td colspan="6">No hay embarques pendientes.</td></tr>`;
      return;
    }
    const idsEscaneados = new Set(listaHistorial.map(f => f.id));
    tbodyPendientes.innerHTML = listaPendientes.map(p => `
      <tr data-id="${p.id}">
        <td>${escapeHtml(p.shipment || "—")}</td>
        <td>${escapeHtml(p.ocCliente || "—")}</td>
        <td>${escapeHtml(p.clienteNombre || "—")}</td>
        <td>${escapeHtml(p.caja || "—")}</td>
        <td>${escapeHtml(p.fechaEntrega || "—")}</td>
        <td class="acciones">
          ${idsEscaneados.has(p.id)
            ? `<span class="nota" style="margin:0;">Ya escaneado</span>`
            : (puedeValidar1
                ? `<button type="button" class="btn-escanear-origen">Escanear</button>`
                : `<span class="nota" style="margin:0;">Requiere Atención al Cliente</span>`)}
        </td>
      </tr>
    `).join("");

    tbodyPendientes.querySelectorAll(".btn-escanear-origen").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.closest("tr").dataset.id;
        const p = listaPendientes.find(x => x.id === id);
        abrirModalEscaneo({
          embarqueId: id,
          modo: "origen",
          infoTexto: `Embarque ${(p && p.shipment) || id} — ${(p && p.clienteNombre) || "McCain"}`,
          cajaEsperada: p ? p.caja : null,
          cajaPrevia: ""
        });
      });
    });
  }

  function renderPendientesValidacion2() {
    if (!tbodyValidacion2) return; // esta sección no se dibujó para este usuario
    const pendientes = listaHistorial.filter(f => f.origenEscaneo && !f.validacion2);
    if (pendientes.length === 0) {
      tbodyValidacion2.innerHTML = `<tr><td colspan="5">No hay embarques esperando segunda validación.</td></tr>`;
      return;
    }
    tbodyValidacion2.innerHTML = pendientes.map(f => `
      <tr data-id="${f.id}">
        <td>${escapeHtml(f.embarqueId || f.id)}</td>
        <td>${escapeHtml(f.clienteNombre || "McCain")}</td>
        <td>${escapeHtml((f.origenEscaneo && f.origenEscaneo.caja) || "—")}</td>
        <td>${escapeHtml((f.origenEscaneo && f.origenEscaneo.escaneadoPor && f.origenEscaneo.escaneadoPor.nombre) || "—")} · ${formatoFecha(f.origenEscaneo && f.origenEscaneo.timestamp)}</td>
        <td class="acciones">
          ${puedeValidar2
            ? `<button type="button" class="btn-validar2">Validar</button>`
            : `<span class="nota" style="margin:0;">Requiere Operaciones</span>`}
        </td>
      </tr>
    `).join("");

    tbodyValidacion2.querySelectorAll(".btn-validar2").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.closest("tr").dataset.id;
        const f = listaHistorial.find(x => x.id === id);
        abrirModalEscaneo({
          embarqueId: id,
          modo: "validacion2",
          infoTexto: `Segunda validación — embarque ${(f && f.embarqueId) || id} — ${(f && f.clienteNombre) || "McCain"}. Escanea el MISMO CFDI que ya validó Atención al Cliente.`,
          cajaEsperada: f ? f.cajaEsperada : null,
          cajaPrevia: (f && f.origenEscaneo && f.origenEscaneo.caja) || "",
          uuidEsperado: f ? f.uuidEsperado : null,
          rfcEsperado: f ? f.receptorRFCEsperado : null
        });
      });
    });
  }

  // Solo informativa (nadie hace clic aquí) — el operador valida desde
  // Alanis Operadores, no desde esta app. "Pendiente" = ya se sincronizó
  // hacia allá (estadoSync === "sincronizado") pero todavía no llega un
  // resultado (verificaciones_cfdi_resultado) de vuelta.
  function renderPendientesValidacion3() {
    if (!tbodyValidacion3) return;
    const idsConResultado = new Set(listaResultados.map(r => r.id));
    const pendientes = listaHistorial.filter(f => f.estadoSync === "sincronizado" && !idsConResultado.has(f.id));
    if (pendientes.length === 0) {
      tbodyValidacion3.innerHTML = `<tr><td colspan="5">No hay embarques esperando el escaneo del operador.</td></tr>`;
      return;
    }
    tbodyValidacion3.innerHTML = pendientes.map(f => `
      <tr data-id="${f.id}">
        <td>${escapeHtml(f.embarqueId || f.id)}</td>
        <td>${escapeHtml(f.clienteNombre || "McCain")}</td>
        <td>${escapeHtml((f.origenEscaneo && f.origenEscaneo.caja) || "—")}</td>
        <td>${escapeHtml((f.validacion2 && f.validacion2.escaneadoPor && f.validacion2.escaneadoPor.nombre) || "—")} · ${formatoFecha(f.validacion2 && f.validacion2.timestamp)}</td>
        <td><span class="nota" style="margin:0;">Esperando escaneo del operador</span></td>
      </tr>
    `).join("");
  }

  function badgeSiNo(valor, etiquetaSi, etiquetaNo) {
    if (typeof valor !== "boolean") return "";
    return `<span class="badge ${valor ? "badge-aprobada" : "badge-rechazada"}" style="margin-left:6px;">${valor ? etiquetaSi : etiquetaNo}</span>`;
  }

  function renderHistorial() {
    if (listaHistorial.length === 0) {
      tbodyHistorial.innerHTML = `<tr><td colspan="${puedeCorregir ? 8 : 7}">Todavía no hay escaneos de origen.</td></tr>`;
      return;
    }
    tbodyHistorial.innerHTML = listaHistorial.map(f => {
      const cajaTexto = escapeHtml((f.origenEscaneo && f.origenEscaneo.caja) || "—");
      const cajaBadge = badgeSiNo(f.origenEscaneo && f.origenEscaneo.cajaCoincide, "OK", "No coincide");

      const celdaAtencion = `${escapeHtml((f.origenEscaneo && f.origenEscaneo.escaneadoPor && f.origenEscaneo.escaneadoPor.nombre) || "—")} · ${formatoFecha(f.origenEscaneo && f.origenEscaneo.timestamp)}`;

      let celdaValidacion2 = `<span class="nota" style="margin:0;">Pendiente</span>`;
      if (f.validacion2) {
        const v2 = f.validacion2;
        celdaValidacion2 = `
          ${escapeHtml((v2.escaneadoPor && v2.escaneadoPor.nombre) || "—")} · ${formatoFecha(v2.timestamp)}
          ${badgeSiNo(v2.uuidCoincide, "UUID OK", "UUID no coincide")}
          ${badgeSiNo(v2.rfcCoincide, "RFC OK", "RFC no coincide")}
          ${badgeSiNo(v2.cajaCoincide, "Caja OK", "Caja no coincide")}
        `;
      }

      return `
      <tr data-id="${f.id}">
        <td>${escapeHtml(f.embarqueId || f.id)}</td>
        <td style="word-break:break-all;">${escapeHtml(f.uuidEsperado || "—")}</td>
        <td>${escapeHtml(f.receptorRFCEsperado || "—")}</td>
        <td>${cajaTexto}${cajaBadge}</td>
        <td>${celdaAtencion}</td>
        <td>${celdaValidacion2}</td>
        <td><span class="badge ${CLASES_SYNC[f.estadoSync] || "badge-pendiente"}">${ETIQUETAS_SYNC[f.estadoSync] || f.estadoSync}</span></td>
        ${puedeCorregir ? `<td class="acciones"><button type="button" class="secundario btn-corregir-origen">Corregir origen</button></td>` : ""}
      </tr>
    `;
    }).join("");

    if (puedeCorregir) {
      tbodyHistorial.querySelectorAll(".btn-corregir-origen").forEach(btn => {
        btn.addEventListener("click", () => {
          const id = btn.closest("tr").dataset.id;
          const f = listaHistorial.find(x => x.id === id);
          abrirModalEscaneo({
            embarqueId: id,
            modo: "correccion",
            infoTexto: `Corrigiendo embarque ${(f && f.embarqueId) || id} — valor actual: ${(f && f.uuidEsperado) || "—"} / ${(f && f.receptorRFCEsperado) || "—"}`,
            cajaEsperada: f ? f.cajaEsperada : null,
            cajaPrevia: (f && f.origenEscaneo && f.origenEscaneo.caja) || ""
          });
        });
      });
    }
  }

  // ---- Modal de escaneo (compartido entre origen / corrección / validación 2) ----

  const modal = contenedor.querySelector("#modal-escaneo-origen");
  const modalTitulo = contenedor.querySelector("#modal-escaneo-titulo");
  const modalInfo = contenedor.querySelector("#modal-escaneo-info");
  const modalErrorDiv = contenedor.querySelector("#modal-escaneo-error");
  const seccionCaptura = contenedor.querySelector("#modal-escaneo-captura");
  const seccionConfirmar = contenedor.querySelector("#modal-escaneo-confirmar");
  const modoCamaraDiv = contenedor.querySelector("#modal-modo-camara");
  const modoManualDiv = contenedor.querySelector("#modal-modo-manual");
  const camaraEstado = contenedor.querySelector("#modal-camara-estado");
  const inputManualUuid = contenedor.querySelector("#modal-manual-uuid");
  const inputManualRfc = contenedor.querySelector("#modal-manual-rfc");
  const inputConfirmarUuid = contenedor.querySelector("#modal-confirmar-uuid");
  const inputConfirmarRfc = contenedor.querySelector("#modal-confirmar-rfc");
  const inputConfirmarCaja = contenedor.querySelector("#modal-confirmar-caja");
  const avisoCaja = contenedor.querySelector("#modal-confirmar-aviso-caja");
  const confirmarErrorDiv = contenedor.querySelector("#modal-confirmar-error");
  const botonesModo = contenedor.querySelectorAll(".subnav-boton[data-modo]");
  const botonGuardar = contenedor.querySelector("#modal-confirmar-guardar");

  const overlayResultado = contenedor.querySelector("#resultado-escaneo-origen");
  const overlayIcono = contenedor.querySelector("#resultado-escaneo-icono");
  const overlayTitulo = contenedor.querySelector("#resultado-escaneo-titulo");
  const overlayDetalle = contenedor.querySelector("#resultado-escaneo-detalle");
  const overlayDetalle2 = contenedor.querySelector("#resultado-escaneo-detalle2");
  const overlayRegistro = contenedor.querySelector("#resultado-escaneo-registro");
  contenedor.querySelector("#resultado-escaneo-continuar").addEventListener("click", () => {
    overlayResultado.classList.add("oculto");
  });

  let embarqueActual = null;
  let modoActual = "origen"; // "origen" | "correccion" | "validacion2"
  let datosLeidos = null;
  let lectorQR = null;
  let cajaEsperadaActual = null;
  let uuidEsperadoActual = null;
  let rfcEsperadoActual = null;
  let advertenciaCajaAceptada = false;

  botonesModo.forEach(btn => {
    btn.addEventListener("click", () => cambiarModo(btn.dataset.modo));
  });
  contenedor.querySelector("#modal-manual-usar").addEventListener("click", () => {
    const uuid = inputManualUuid.value.trim();
    const rfc = inputManualRfc.value.trim();
    if (!uuid || !rfc) {
      modalErrorDiv.textContent = "Captura el UUID y el RFC receptor.";
      return;
    }
    modalErrorDiv.textContent = "";
    mostrarConfirmacion({ uuid: uuid.toUpperCase(), rfc: rfc.toUpperCase() });
  });
  contenedor.querySelector("#modal-volver-escanear").addEventListener("click", () => {
    seccionConfirmar.classList.add("oculto");
    seccionCaptura.classList.remove("oculto");
    confirmarErrorDiv.textContent = "";
    const modoCamaraActivo = contenedor.querySelector('.subnav-boton[data-modo="camara"]').classList.contains("activo");
    if (modoCamaraActivo) iniciarCamara();
  });
  botonGuardar.addEventListener("click", guardarEscaneo);
  contenedor.querySelector("#modal-escaneo-cancelar").addEventListener("click", cerrarModal);

  // En cuanto se toca la caja, cualquier advertencia ya mostrada queda
  // obsoleta — hay que re-evaluar en el siguiente click.
  inputConfirmarCaja.addEventListener("input", () => {
    if (advertenciaCajaAceptada) {
      advertenciaCajaAceptada = false;
      avisoCaja.classList.add("oculto");
      botonGuardar.textContent = "Confirmar y registrar";
    }
  });

  function cambiarModo(modo) {
    botonesModo.forEach(b => b.classList.toggle("activo", b.dataset.modo === modo));
    if (modo === "camara") {
      modoCamaraDiv.classList.remove("oculto");
      modoManualDiv.classList.add("oculto");
      iniciarCamara();
    } else {
      modoManualDiv.classList.remove("oculto");
      modoCamaraDiv.classList.add("oculto");
      detenerCamara();
    }
  }

  function iniciarCamara() {
    if (typeof window.Html5Qrcode === "undefined") {
      camaraEstado.textContent = "No se pudo cargar la cámara. Usa Captura manual.";
      return;
    }
    detenerCamara();
    lectorQR = new window.Html5Qrcode("qr-reader");
    camaraEstado.textContent = "Apunta la cámara al código QR del CFDI.";
    lectorQR.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 250 },
      (textoLeido) => {
        const datos = parsearQR(textoLeido);
        if (!datos) {
          camaraEstado.textContent = "Ese código no parece ser un QR de CFDI del SAT. Sigue intentando o usa Captura manual.";
          return;
        }
        mostrarConfirmacion(datos);
      },
      () => { /* no se detectó QR en este cuadro — normal mientras se acomoda la cámara, se ignora */ }
    ).catch(() => {
      camaraEstado.textContent = "No se pudo acceder a la cámara (revisa permisos del navegador). Usa Captura manual.";
    });
  }

  function detenerCamara() {
    if (lectorQR) {
      const lector = lectorQR;
      lectorQR = null;
      lector.stop().catch(() => {});
    }
  }

  function mostrarConfirmacion(datos) {
    datosLeidos = datos;
    detenerCamara();
    inputConfirmarUuid.value = datos.uuid;
    inputConfirmarRfc.value = datos.rfc;
    advertenciaCajaAceptada = false;
    avisoCaja.classList.add("oculto");
    botonGuardar.textContent = "Confirmar y registrar";
    confirmarErrorDiv.textContent = "";
    seccionCaptura.classList.add("oculto");
    seccionConfirmar.classList.remove("oculto");
    inputConfirmarCaja.focus();
  }

  async function guardarEscaneo() {
    if (!datosLeidos || !embarqueActual) return;
    confirmarErrorDiv.textContent = "";

    const cajaCapturada = inputConfirmarCaja.value.trim();
    if (!cajaCapturada) {
      confirmarErrorDiv.textContent = "Captura el número de caja o remolque.";
      return;
    }

    const hayCajaEsperada = !!(cajaEsperadaActual && cajaEsperadaActual.trim());
    const cajaCoincide = hayCajaEsperada
      ? normalizarCaja(cajaCapturada) === normalizarCaja(cajaEsperadaActual)
      : true; // si no hay caja de referencia (correo), no hay contra qué comparar.

    let uuidCoincide = true;
    let rfcCoincide = true;
    if (modoActual === "validacion2") {
      uuidCoincide = datosLeidos.uuid === uuidEsperadoActual;
      rfcCoincide = datosLeidos.rfc === rfcEsperadoActual;
    }

    const hayDiscrepancia = (hayCajaEsperada && !cajaCoincide) || !uuidCoincide || !rfcCoincide;

    if (hayDiscrepancia && !advertenciaCajaAceptada) {
      const partes = [];
      if (!uuidCoincide) partes.push("el UUID del CFDI no coincide con el registrado por Atención al Cliente");
      if (!rfcCoincide) partes.push("el RFC receptor no coincide con el registrado por Atención al Cliente");
      if (hayCajaEsperada && !cajaCoincide) partes.push(`la caja "${escapeHtml(cajaCapturada)}" no coincide con la registrada ("${escapeHtml(cajaEsperadaActual)}")`);
      avisoCaja.innerHTML = `${ICONO_ALERTA}<span>Ojo: ${partes.join("; ")}. Revisa que sea el documento correcto. Si estás seguro de que es correcto, toca "Confirmar de todas formas" para continuar (queda marcado para revisión).</span>`;
      avisoCaja.classList.remove("oculto");
      reproducirSonido("discrepancia");
      vibrar("discrepancia");
      advertenciaCajaAceptada = true;
      botonGuardar.textContent = "Confirmar de todas formas";
      return;
    }

    botonGuardar.disabled = true;
    try {
      if (modoActual === "correccion") {
        await corregirEscaneo(embarqueActual, { ...datosLeidos, caja: cajaCapturada, cajaCoincide });
      } else if (modoActual === "validacion2") {
        await registrarValidacion2(embarqueActual, { ...datosLeidos, caja: cajaCapturada, cajaCoincide, uuidCoincide, rfcCoincide });
      } else {
        await registrarEscaneo(embarqueActual, { ...datosLeidos, caja: cajaCapturada, cajaCoincide, cajaEsperada: cajaEsperadaActual || null });
      }
      cerrarModal();
      mostrarResultado({ modo: modoActual, cajaCoincide, uuidCoincide, rfcCoincide, caja: cajaCapturada });
    } catch (err) {
      confirmarErrorDiv.textContent = "No se pudo registrar: " + err.message;
    } finally {
      botonGuardar.disabled = false;
    }
  }

  function mostrarResultado({ modo, cajaCoincide, uuidCoincide, rfcCoincide, caja }) {
    const todoBien = cajaCoincide && uuidCoincide && rfcCoincide;
    const tipo = todoBien ? "exito" : "discrepancia";
    overlayResultado.classList.remove("oculto", "exito", "discrepancia");
    overlayResultado.classList.add(tipo);
    overlayIcono.innerHTML = todoBien ? ICONO_EXITO : ICONO_ALERTA;

    if (modo === "validacion2") {
      overlayTitulo.textContent = todoBien ? "Segunda validación registrada" : "Segunda validación con discrepancia";
      overlayDetalle.textContent = todoBien
        ? "El CFDI y la caja coinciden con lo registrado por Atención al Cliente."
        : "Hay diferencias contra lo registrado por Atención al Cliente — revisa el historial.";
      overlayDetalle2.classList.remove("oculto");
      overlayDetalle2.textContent = [
        !uuidCoincide ? "UUID no coincide" : null,
        !rfcCoincide ? "RFC no coincide" : null,
        !cajaCoincide ? `Caja "${caja}" no coincide` : null
      ].filter(Boolean).join(" · ") || "";
    } else {
      overlayTitulo.textContent = todoBien ? "Escaneo registrado" : "Escaneo registrado con discrepancia";
      overlayDetalle.textContent = todoBien
        ? `Caja/remolque ${caja} coincide con lo registrado.`
        : `Caja/remolque ${caja} NO coincide con lo registrado — queda marcado para revisión.`;
      overlayDetalle2.classList.add("oculto");
    }

    overlayRegistro.textContent = `Registrado por ${datosUsuario.nombre || "—"} · ${new Date().toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}`;
    reproducirSonido(tipo);
    vibrar(tipo);
  }

  function abrirModalEscaneo({ embarqueId, modo, infoTexto, cajaEsperada, cajaPrevia, uuidEsperado, rfcEsperado }) {
    embarqueActual = embarqueId;
    modoActual = modo;
    datosLeidos = null;
    cajaEsperadaActual = cajaEsperada || null;
    uuidEsperadoActual = uuidEsperado || null;
    rfcEsperadoActual = rfcEsperado || null;
    advertenciaCajaAceptada = false;
    modalTitulo.textContent = modo === "correccion"
      ? "Corregir CFDI de origen"
      : (modo === "validacion2" ? "Segunda validación (Operaciones)" : "Escanear CFDI de origen");
    modalInfo.textContent = infoTexto || "";
    modalErrorDiv.textContent = "";
    confirmarErrorDiv.textContent = "";
    avisoCaja.classList.add("oculto");
    inputManualUuid.value = "";
    inputManualRfc.value = "";
    // Solo se prellena en modo "correccion" (ahí sí mostramos el valor
    // anterior para poder corregirlo). En "origen" y "validacion2" la caja
    // SIEMPRE debe capturarse a mano — si llega ya escrita, deja de servir
    // como punto de comparación independiente (así fue como se detectó:
    // Daniel la vio precargada al hacer la 2da validación).
    inputConfirmarCaja.value = (modo === "correccion") ? (cajaPrevia || "") : "";
    seccionConfirmar.classList.add("oculto");
    seccionCaptura.classList.remove("oculto");
    botonesModo.forEach(b => b.classList.toggle("activo", b.dataset.modo === "camara"));
    modoCamaraDiv.classList.remove("oculto");
    modoManualDiv.classList.add("oculto");
    modal.classList.remove("oculto");
    iniciarCamara();
  }

  function cerrarModal() {
    detenerCamara();
    modal.classList.add("oculto");
    embarqueActual = null;
    datosLeidos = null;
  }

  async function registrarEscaneo(embarqueId, { uuid, rfc, caja, cajaCoincide, cajaEsperada }) {
    await setDoc(doc(db, "verificaciones_cfdi_local", embarqueId), {
      embarqueId,
      uuidEsperado: uuid,
      receptorRFCEsperado: rfc,
      estadoSync: "esperando_validacion2",
      cajaEsperada: cajaEsperada || null,
      origenEscaneo: {
        caja: caja || null,
        cajaCoincide,
        escaneadoPor: { uid, nombre: datosUsuario.nombre || null, rol: datosUsuario.rol },
        timestamp: serverTimestamp(),
        correccion: null
      }
    });
  }

  async function corregirEscaneo(embarqueId, { uuid, rfc, caja, cajaCoincide }) {
    const snap = await getDoc(doc(db, "verificaciones_cfdi_local", embarqueId));
    if (!snap.exists()) throw new Error("No se encontró el escaneo original.");
    const datosPrevios = snap.data();
    await setDoc(doc(db, "verificaciones_cfdi_local", embarqueId), {
      ...datosPrevios,
      uuidEsperado: uuid,
      receptorRFCEsperado: rfc,
      // Si la 2da validación ya existía, hay que re-sincronizar todo con el
      // valor corregido; si no, sigue esperando esa 2da validación primero.
      estadoSync: datosPrevios.validacion2 ? "pendiente" : "esperando_validacion2",
      origenEscaneo: {
        ...datosPrevios.origenEscaneo,
        caja: caja || null,
        cajaCoincide,
        correccion: {
          por: { uid, rol: datosUsuario.rol },
          timestamp: serverTimestamp(),
          valorAnterior: {
            uuidCfdi: datosPrevios.uuidEsperado,
            rfcReceptor: datosPrevios.receptorRFCEsperado
          }
        }
      }
    });
  }

  async function registrarValidacion2(embarqueId, { uuid, rfc, caja, cajaCoincide, uuidCoincide, rfcCoincide }) {
    const snap = await getDoc(doc(db, "verificaciones_cfdi_local", embarqueId));
    if (!snap.exists()) throw new Error("No se encontró el embarque.");
    const datosPrevios = snap.data();
    await setDoc(doc(db, "verificaciones_cfdi_local", embarqueId), {
      ...datosPrevios,
      estadoSync: "pendiente",
      validacion2: {
        uuidLeido: uuid,
        rfcLeido: rfc,
        uuidCoincide,
        rfcCoincide,
        caja: caja || null,
        cajaCoincide,
        escaneadoPor: { uid, nombre: datosUsuario.nombre || null, rol: datosUsuario.rol, area: datosUsuario.area || null, puesto: datosUsuario.puesto || null },
        timestamp: serverTimestamp()
      }
    });
  }
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto || "";
  return div.innerHTML;
}