import { db } from "./firebase-config.js";
import {
  collection, doc, setDoc, getDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// Solo admin/supervisor pueden corregir un escaneo de origen ya registrado
// (así lo exige también firestore.rules — esto solo evita mostrar un botón
// que igual sería rechazado).
const ROLES_QUE_CORRIGEN = ["admin", "supervisor"];

const ETIQUETAS_SYNC = {
  pendiente: "Sincronizando…",
  sincronizado: "Sincronizado",
  error: "Error de sync"
};
const CLASES_SYNC = {
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
// (se usa .nombre y .rol). uid: el auth.uid de quien tiene la sesión abierta.
export function iniciarEscaneoOrigen(contenedor, datosUsuario, uid) {
  const puedeCorregir = ROLES_QUE_CORRIGEN.includes(datosUsuario.rol);

  contenedor.innerHTML = `
    <section class="panel">
      <h2>Embarques pendientes de escanear en origen</h2>
      <p class="nota">Embarques de McCain sin CFDI escaneado todavía. Esta lista se sincroniza con Alanis Operadores cada pocos minutos, así que un escaneo reciente puede tardar un momento en desaparecer de aquí.</p>
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

    <section class="panel" style="margin-top:20px;">
      <h2>Historial de escaneos de origen</h2>
      <div id="historial-origen-error" class="error"></div>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-historial-origen">
          <thead>
            <tr>
              <th>Embarque</th><th>UUID CFDI</th><th>RFC receptor</th><th>Caja</th><th>Escaneó</th><th>Sincronización</th>${puedeCorregir ? "<th>Acción</th>" : ""}
            </tr>
          </thead>
          <tbody id="tbody-historial-origen"><tr><td colspan="${puedeCorregir ? 7 : 6}">Cargando...</td></tr></tbody>
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
          <p id="modal-confirmar-aviso-caja" class="nota nota-alerta oculto"></p>
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
        <p id="resultado-escaneo-registro" class="resultado-escaneo-registro"></p>
        <button type="button" id="resultado-escaneo-continuar">Continuar</button>
      </div>
    </div>
  `;

  let listaPendientes = [];
  let listaHistorial = [];

  const errorPendientesDiv = contenedor.querySelector("#pendientes-origen-error");
  const errorHistorialDiv = contenedor.querySelector("#historial-origen-error");
  const tbodyPendientes = contenedor.querySelector("#tbody-pendientes-origen");
  const tbodyHistorial = contenedor.querySelector("#tbody-historial-origen");

  onSnapshot(collection(db, "embarques_pendientes_origen"), (snap) => {
    listaPendientes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPendientes();
  }, (err) => {
    errorPendientesDiv.textContent = "No se pudieron cargar los embarques pendientes: " + err.message;
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
  }, (err) => {
    errorHistorialDiv.textContent = "No se pudo cargar el historial: " + err.message;
  });

  function renderPendientes() {
    if (listaPendientes.length === 0) {
      tbodyPendientes.innerHTML = `<tr><td colspan="6">No hay embarques pendientes de escanear.</td></tr>`;
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
            ? `<span class="nota" style="margin:0;">Ya escaneado, sincronizando…</span>`
            : `<button type="button" class="btn-escanear-origen">Escanear</button>`}
        </td>
      </tr>
    `).join("");

    tbodyPendientes.querySelectorAll(".btn-escanear-origen").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.closest("tr").dataset.id;
        const p = listaPendientes.find(x => x.id === id);
        abrirModalEscaneo({
          embarqueId: id,
          modoCorreccion: false,
          infoTexto: `Embarque ${(p && p.shipment) || id} — ${(p && p.clienteNombre) || "McCain"}`,
          cajaEsperada: p ? p.caja : null,
          cajaPrevia: ""
        });
      });
    });
  }

  function renderHistorial() {
    if (listaHistorial.length === 0) {
      tbodyHistorial.innerHTML = `<tr><td colspan="${puedeCorregir ? 7 : 6}">Todavía no hay escaneos de origen.</td></tr>`;
      return;
    }
    tbodyHistorial.innerHTML = listaHistorial.map(f => {
      const cajaTexto = escapeHtml((f.origenEscaneo && f.origenEscaneo.caja) || "—");
      const cajaBadge = typeof (f.origenEscaneo && f.origenEscaneo.cajaCoincide) === "boolean"
        ? `<span class="badge ${f.origenEscaneo.cajaCoincide ? "badge-aprobada" : "badge-rechazada"}" style="margin-left:6px;">${f.origenEscaneo.cajaCoincide ? "OK" : "No coincide"}</span>`
        : "";
      return `
      <tr data-id="${f.id}">
        <td>${escapeHtml(f.embarqueId || f.id)}</td>
        <td style="word-break:break-all;">${escapeHtml(f.uuidEsperado || "—")}</td>
        <td>${escapeHtml(f.receptorRFCEsperado || "—")}</td>
        <td>${cajaTexto}${cajaBadge}</td>
        <td>${escapeHtml((f.origenEscaneo && f.origenEscaneo.escaneadoPor && f.origenEscaneo.escaneadoPor.nombre) || "—")} · ${formatoFecha(f.origenEscaneo && f.origenEscaneo.timestamp)}</td>
        <td><span class="badge ${CLASES_SYNC[f.estadoSync] || "badge-pendiente"}">${ETIQUETAS_SYNC[f.estadoSync] || f.estadoSync}</span></td>
        ${puedeCorregir ? `<td class="acciones"><button type="button" class="secundario btn-corregir-origen">Corregir</button></td>` : ""}
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
            modoCorreccion: true,
            infoTexto: `Corrigiendo embarque ${(f && f.embarqueId) || id} — valor actual: ${(f && f.uuidEsperado) || "—"} / ${(f && f.receptorRFCEsperado) || "—"}`,
            cajaEsperada: f ? f.cajaEsperada : null,
            cajaPrevia: (f && f.origenEscaneo && f.origenEscaneo.caja) || ""
          });
        });
      });
    }
  }

  // ---- Modal de escaneo (compartido entre "Escanear" y "Corregir") ----

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
  const overlayRegistro = contenedor.querySelector("#resultado-escaneo-registro");
  contenedor.querySelector("#resultado-escaneo-continuar").addEventListener("click", () => {
    overlayResultado.classList.add("oculto");
  });

  let embarqueActual = null;
  let modoCorreccionActual = false;
  let datosLeidos = null;
  let lectorQR = null;
  let cajaEsperadaActual = null;
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

  // En cuanto se toca la caja, cualquier advertencia de "no coincide" ya
  // mostrada queda obsoleta — hay que re-evaluar en el siguiente click.
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
      : true; // si no hay caja registrada de origen (correo), no hay contra qué comparar — se guarda sin marcar discrepancia.

    if (hayCajaEsperada && !cajaCoincide && !advertenciaCajaAceptada) {
      avisoCaja.textContent = `La caja "${cajaCapturada}" no coincide con la registrada ("${cajaEsperadaActual}"). Revisa que sea la caja correcta. Si estás seguro de que es correcta, toca "Confirmar de todas formas" para continuar.`;
      avisoCaja.classList.remove("oculto");
      advertenciaCajaAceptada = true;
      botonGuardar.textContent = "Confirmar de todas formas";
      return;
    }

    botonGuardar.disabled = true;
    try {
      if (modoCorreccionActual) {
        await corregirEscaneo(embarqueActual, { ...datosLeidos, caja: cajaCapturada, cajaCoincide });
      } else {
        await registrarEscaneo(embarqueActual, { ...datosLeidos, caja: cajaCapturada, cajaCoincide, cajaEsperada: cajaEsperadaActual || null });
      }
      cerrarModal();
      mostrarResultado({ cajaCoincide, caja: cajaCapturada });
    } catch (err) {
      confirmarErrorDiv.textContent = "No se pudo registrar: " + err.message;
    } finally {
      botonGuardar.disabled = false;
    }
  }

  function mostrarResultado({ cajaCoincide, caja }) {
    const tipo = cajaCoincide ? "exito" : "discrepancia";
    overlayResultado.classList.remove("oculto", "exito", "discrepancia");
    overlayResultado.classList.add(tipo);
    overlayIcono.innerHTML = cajaCoincide ? ICONO_EXITO : ICONO_ALERTA;
    overlayTitulo.textContent = cajaCoincide ? "Escaneo registrado" : "Escaneo registrado con discrepancia";
    overlayDetalle.textContent = cajaCoincide
      ? `Caja/remolque ${caja} coincide con lo registrado.`
      : `Caja/remolque ${caja} NO coincide con lo registrado — queda marcado para revisión.`;
    overlayRegistro.textContent = `Registrado por ${datosUsuario.nombre || "—"} · ${new Date().toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}`;
    reproducirSonido(tipo);
    vibrar(tipo);
  }

  function abrirModalEscaneo({ embarqueId, modoCorreccion, infoTexto, cajaEsperada, cajaPrevia }) {
    embarqueActual = embarqueId;
    modoCorreccionActual = modoCorreccion;
    datosLeidos = null;
    cajaEsperadaActual = cajaEsperada || null;
    advertenciaCajaAceptada = false;
    modalTitulo.textContent = modoCorreccion ? "Corregir CFDI de origen" : "Escanear CFDI de origen";
    modalInfo.textContent = infoTexto || "";
    modalErrorDiv.textContent = "";
    confirmarErrorDiv.textContent = "";
    avisoCaja.classList.add("oculto");
    inputManualUuid.value = "";
    inputManualRfc.value = "";
    inputConfirmarCaja.value = cajaPrevia || "";
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
      estadoSync: "pendiente",
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
      estadoSync: "pendiente",
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
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto || "";
  return div.innerHTML;
}
