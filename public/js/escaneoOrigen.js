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

// ----------------------------------------------------------------------
// QR interno para embarques SIN factura (pedido de Ivan, 2026-09-10).
// Contexto: McCain confirmó en junta que cuando un correo no trae factura
// es un movimiento interno de su inventario (sin riesgo fiscal, porque no
// hay factura que mostrar). Sin un QR real que escanear, la cadena de 3
// validaciones se rompía por completo. Diseño acordado: en vez de crear un
// camino especial paralelo, Atención al Cliente GENERA un QR propio (tras
// confirmar explícitamente que es un caso sin factura) que se imprime, se
// integra al mismo set de documentos de siempre, y se escanea en cada
// checkpoint EXACTAMENTE igual que un CFDI real — nadie más en la cadena
// necesita enterarse de que es "interno".
//
// Truco clave: el QR generado usa el MISMO formato que ya sabe leer
// parsearQR() (una URL con ?id=<uuid>&rr=<rfc>) — solo con un dominio
// propio (no resuelve a nada real, no es necesario que resuelva) y un RFC
// marcador fijo en vez de un RFC real. Así, evaluarCoincidenciaCfdi(),
// registrarEscaneo(), la 2da validación y los checkpoints del operador
// funcionan sin NINGÚN cambio — comparan cadenas de texto, no verifican
// contra el SAT.
const RFC_MARCADOR_SIN_FACTURA = "SIN-FACTURA";
const QR_INTERNO_BASE = "https://control-interno.alanis-operadores.mx/sin-factura";

// ----------------------------------------------------------------------
// Control de versión (agregado 2026-09-12): permite a Ivan saber, sin
// preguntarle a nadie, qué versión de la app tiene abierta cada usuario
// (se reporta a usuarios/{uid} en Firestore) y avisa en pantalla cuando
// hay una versión más nueva publicada que la que está cargada. Sube
// APP_VERSION en cada deploy que quieras poder detectar, y actualiza
// version.json al mismo valor.
// ----------------------------------------------------------------------
// Exportado (2026-09-14, pedido de Ivan) para poder mostrarlo también en
// el menú de cuenta (ver auth.js) — antes solo se usaba internamente aquí
// para comparar contra version.json y decidir si mostrar el banner de
// "hay una versión nueva".
export const APP_VERSION = "2026.09.14-11";

async function verificarActualizacionYReportarVersion(uid) {
  // Reporta la versión actual — no bloqueante, no crítico si falla.
  setDoc(doc(db, "usuarios", uid), {
    appVersion: APP_VERSION,
    appVersionFecha: serverTimestamp()
  }, { merge: true }).catch(() => {});

  // Compara contra version.json (sin caché) para avisar si hay algo más
  // nuevo publicado que lo que el navegador tiene cargado ahora mismo.
  try {
    const resp = await fetch("./version.json?t=" + Date.now(), { cache: "no-store" });
    if (!resp.ok) return;
    const datos = await resp.json();
    if (datos.version && datos.version !== APP_VERSION) mostrarBannerActualizacion();
  } catch (e) {
    // Sin conexión o archivo no publicado todavía — no es crítico.
  }
}

function mostrarBannerActualizacion() {
  if (document.getElementById("banner-actualizacion-app")) return;
  const banner = document.createElement("div");
  banner.id = "banner-actualizacion-app";
  banner.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:9999;background:#92400e;color:#fff;padding:10px 16px;font-size:13px;display:flex;align-items:center;justify-content:center;gap:12px;font-family:system-ui,-apple-system,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,0.25);";
  banner.innerHTML = `<span>Hay una versión nueva de la app disponible.</span><button id="banner-actualizacion-btn" style="background:#fff;color:#92400e;border:none;border-radius:6px;padding:6px 12px;font-weight:700;cursor:pointer;">Recargar</button>`;
  document.body.prepend(banner);
  document.getElementById("banner-actualizacion-btn").addEventListener("click", () => location.reload());
}

function generarDatosQrInterno() {
  const uuid = (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : uuidFallback_()).toUpperCase();
  const rfc = RFC_MARCADOR_SIN_FACTURA;
  const texto = `${QR_INTERNO_BASE}?id=${uuid}&rr=${rfc}&motivo=movimiento_interno`;
  return { uuid, rfc, texto };
}

// Respaldo por si algún navegador viejo no trae crypto.randomUUID() — no
// necesita ser criptográficamente perfecto, solo único para no chocar entre
// dos embarques.
function uuidFallback_() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

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

// Convierte un texto (ej. un shipment/OC) en algo seguro para usar como
// nombre de archivo sugerido al imprimir/guardar como PDF (2026-09-10) —
// quita caracteres que Windows/macOS no permiten en nombres de archivo y
// cambia espacios por guiones.
function sanitizarNombreArchivo(texto) {
  return (texto || "").toString().trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-");
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

// Beep vía WebAudio — sin archivos de audio, funciona sin conexión. OJO: en
// iPhone (Safari/PWA) esto SIGUE sin sonar si el switch de silencio físico
// está activado, o si el volumen del celular está en 0 — eso lo controla el
// sistema operativo y ningún sitio web lo puede saltar (ver nota junto a
// mostrarAdvertenciaDiscrepancia). Aquí solo se sube el volumen al máximo
// que permite la Web Audio API y, para discrepancias, se hacen 3 tonos
// (no 1) para que sea más difícil no notarlo cuando SÍ hay algo de volumen.
// Si el navegador no soporta AudioContext (o el usuario aún no interactuó
// con la página, algunos navegadores lo exigen), simplemente no suena.
function reproducirSonido(tipo) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    if (tipo === "exito") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
      osc.onended = () => ctx.close().catch(() => {});
    } else {
      // Alarma de discrepancia: 3 tonos graves cortos en vez de 1, a
      // volumen máximo (gain 1.0) — más insistente que el beep de éxito.
      const tiemposInicio = [0, 0.22, 0.44];
      tiemposInicio.forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "square";
        osc.frequency.value = 220;
        gain.gain.setValueAtTime(1.0, ctx.currentTime + offset);
        osc.start(ctx.currentTime + offset);
        osc.stop(ctx.currentTime + offset + 0.16);
      });
      setTimeout(() => ctx.close().catch(() => {}), 800);
    }
  } catch {
    /* sin soporte de audio en este navegador — se ignora */
  }
}

// OJO (importante para iPhone): la Vibration API (navigator.vibrate) NO
// está implementada en Safari/iOS — ni en el navegador ni en la app
// instalada a la pantalla de inicio (limitación de Apple/WebKit, no de este
// código). En esos celulares esta función simplemente no hace nada, sin
// error. En Android sí funciona, y normalmente es independiente del
// volumen de medios (no se apaga solo porque el volumen esté en 0),
// aunque puede desactivarse a nivel de sistema.
function vibrar(tipo) {
  if (!navigator.vibrate) return;
  navigator.vibrate(tipo === "exito" ? [80] : [200, 100, 200, 100, 200]);
}

const ICONO_EXITO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12.5l2.5 2.5L16 9"/></svg>`;
// Triángulo simétrico a mano (centrado en x=12) — el ícono anterior venía
// de una librería y se veía un poco chueco/descentrado en pantalla.
const ICONO_ALERTA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3L22.5 20.5H1.5L12 3Z"/><path d="M12 9.5v5"/><path d="M12 18h.01"/></svg>`;

// contenedor: elemento donde dibujar. datosUsuario: doc de usuarios/{uid}
// (se usa .nombre, .rol, .area y .puesto). uid: el auth.uid de quien tiene
// la sesión abierta.
export function iniciarEscaneoOrigen(contenedor, datosUsuario, uid) {
  verificarActualizacionYReportarVersion(uid);

  const esAdmin = datosUsuario.rol === "admin";
  const puedeCorregir = ROLES_QUE_CORRIGEN.includes(datosUsuario.rol);
  const puedeValidar1 = esAdmin || datosUsuario.area === AREA_ATENCION_CLIENTE;
  const puedeValidar2 = esAdmin || (
    datosUsuario.area === AREA_OPERACIONES && PUESTOS_VALIDADOR2.includes(datosUsuario.puesto)
  );

  // Historial de escaneos (2026-09-14, rediseño pedido por Ivan): la
  // columna de acciones (⋮) solo se dibuja si hay algo que mostrar ahí —
  // se calcula una sola vez aquí para que la cabecera de la tabla y las
  // filas usen exactamente el mismo criterio (antes la cabecera solo
  // miraba puedeCorregir, y el cuerpo miraba puedeCorregir||puedeValidar2 —
  // sin diferencia práctica hoy porque admin implica los dos, pero es
  // confuso tener dos criterios para la misma columna).
  const mostrarColumnaAcciones = puedeCorregir || puedeValidar2;

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
      .resultado-escaneo-botonera { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }

      /* Seguimiento de embarques (semáforo) — pedido de Ivan, 2026-09-08:
         una fila por embarque, una píldora de color por etapa, columnas
         angostas con encabezado a 2 líneas para verse bien de un vistazo
         (pensado incluso para una pantalla en el área de Operaciones). */
      #tabla-semaforo th, #tabla-semaforo td { padding: 6px 8px; text-align: center; white-space: nowrap; }
      #tabla-semaforo th:first-child, #tabla-semaforo td:first-child { text-align: left; }
      #tabla-semaforo th { font-size: 11.5px; line-height: 1.25; font-weight: 600; }
      #tabla-semaforo td { font-size: 13px; }
      #tabla-semaforo .semaforo-meta { display: block; font-size: 10.5px; color: #6b7280; margin-top: 2px; white-space: normal; }
      .semaforo-pill {
        display: inline-flex; align-items: center; gap: 5px;
        padding: 3px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 600; white-space: nowrap;
      }
      .semaforo-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
      .semaforo-ok { background: #dcfce7; color: #166534; } .semaforo-ok .semaforo-dot { background: #16a34a; }
      .semaforo-warn { background: #fef3c7; color: #92400e; } .semaforo-warn .semaforo-dot { background: #d97706; }
      .semaforo-bad { background: #fee2e2; color: #991b1b; } .semaforo-bad .semaforo-dot { background: #dc2626; }
      .semaforo-pend { background: #f1f2f4; color: #4b5563; } .semaforo-pend .semaforo-dot { background: #9ca3af; }

      /* Color del texto del embarque según su estado de sincronización
         (ajuste 2026-09-08: antes era un punto aparte, ahora es el propio
         nombre del embarque el que cambia de color — menos elementos,
         mismo significado). */
      .semaforo-embarque-verde { color: #16a34a; }
      .semaforo-embarque-gris { color: #9ca3af; }
      .semaforo-embarque-rojo { color: #dc2626; }

      .semaforo-titulo-fila { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
      .semaforo-titulo-fila h2 { margin: 0; }
      .semaforo-chip-espera {
        display: inline-flex; align-items: center; gap: 6px;
        background: #eef2ff; color: #3730a3; font-size: 12.5px; font-weight: 600;
        padding: 4px 11px; border-radius: 999px;
      }
      .semaforo-chip-espera .semaforo-chip-dot { width: 6px; height: 6px; border-radius: 50%; background: #6366f1; }

      /* --------------------------------------------------------------
         Corrección de McCain (nuevo, 2026-09-09, pedido de Ivan):
         "no puede ser nada más que cambie de color, debe ser algo más
         contundente". Dos tratamientos:
         1) Banner en la fila de pendientes cuando NADIE ha validado
            todavía — bloquea el botón de escanear hasta que alguien
            reconoce explícitamente la corrección.
         2) Fila con chip rojo + overlay de pantalla completa que
            INTERRUMPE, cuando la corrección llegó DESPUÉS de que ya
            había una validación — no se cierra solo, solo con el botón.
         -------------------------------------------------------------- */
      .correccion-banner {
        background: #fdeceb;
        border: 1px solid #f3c9c5;
        border-radius: 10px;
        padding: 12px 14px;
        margin: 6px 0;
      }
      .correccion-banner-titulo {
        display: flex; align-items: center; gap: 8px;
        font-size: 12.5px; font-weight: 700; color: #c8362a; letter-spacing: 0.02em;
        margin-bottom: 8px;
      }
      .correccion-banner-titulo svg { width: 16px; height: 16px; flex: none; }
      .correccion-banner-datos {
        display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;
        font-size: 13px; color: #1c1a17; margin-bottom: 8px;
      }
      .correccion-caja-cambio { display: inline-flex; align-items: center; gap: 8px; }
      .correccion-caja-anterior { text-decoration: line-through; color: #9c9c9c; }
      .correccion-caja-nueva { color: #c8362a; font-weight: 700; }
      .correccion-banner-correo {
        background: #fff; border: 1px solid #f3c9c5; border-radius: 8px;
        padding: 8px 10px; font-size: 11.5px; color: #6b6558; margin-bottom: 10px; line-height: 1.5;
      }
      .correccion-banner-acciones { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .correccion-banner-acciones button[disabled] { opacity: 0.5; cursor: not-allowed; }
      .fila-correccion-post td { background: #fff8f7; }
      .correccion-chip-post {
        display: inline-block; margin-top: 3px; background: #fdeceb; color: #c8362a;
        font-size: 10.5px; font-weight: 700; padding: 2px 7px; border-radius: 999px; letter-spacing: 0.02em;
      }

      .correccion-critica-overlay {
        position: fixed; inset: 0; z-index: 9999;
        display: flex; align-items: center; justify-content: center; padding: 20px;
      }
      .correccion-critica-fondo { position: absolute; inset: 0; background: rgba(20,16,12,0.6); }
      .correccion-critica-tarjeta {
        position: relative; background: #fff; border-radius: 16px; max-width: 480px; width: 100%;
        box-shadow: 0 20px 60px rgba(0,0,0,0.35); overflow: hidden;
      }
      .correccion-critica-header {
        background: #c8362a; padding: 24px 28px 18px; display: flex; flex-direction: column;
        align-items: center; text-align: center; gap: 10px; color: #fff;
      }
      .correccion-critica-header svg { width: 26px; height: 26px; }
      .correccion-critica-header-icono {
        width: 48px; height: 48px; border-radius: 50%; background: rgba(255,255,255,0.16);
        display: flex; align-items: center; justify-content: center;
      }
      .correccion-critica-header-titulo { font-size: 17px; font-weight: 800; letter-spacing: 0.01em; line-height: 1.3; }
      .correccion-critica-cuerpo { padding: 22px 28px 26px; }
      .correccion-critica-texto { font-size: 13.5px; color: #3a362f; line-height: 1.7; margin-bottom: 16px; }
      .correccion-critica-cambio {
        background: #fdeceb; border: 1px solid #f3c9c5; border-radius: 10px;
        padding: 12px 14px; margin-bottom: 16px; display: flex; align-items: center;
        justify-content: center; gap: 12px; font-size: 13px;
      }
      .correccion-critica-cambio .correccion-caja-nueva { font-size: 15px; }
      .correccion-critica-nota { font-size: 12.5px; color: #6b6558; line-height: 1.6; margin-bottom: 18px; }
      .correccion-critica-boton {
        background: #1c1a17; color: #fff; text-align: center; padding: 13px; border-radius: 10px;
        font-size: 13.5px; font-weight: 700; letter-spacing: 0.01em; border: none; width: 100%; cursor: pointer;
      }
      .correccion-critica-boton:hover { background: #000; }
      .correccion-critica-pie { text-align: center; font-size: 11px; color: #9c9895; margin-top: 10px; line-height: 1.5; }

      /* ----------------------------------------------------------------
         QR interno para embarques sin factura (2026-09-10). */
      .badge-sin-factura {
        display: inline-block; background: #fef3c7; color: #92400e;
        font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: 999px;
        letter-spacing: 0.02em; margin-right: 6px;
      }
      .qr-interno-overlay {
        position: fixed; inset: 0; z-index: 9999;
        display: flex; align-items: center; justify-content: center; padding: 20px;
      }
      .qr-interno-fondo { position: absolute; inset: 0; background: rgba(20,16,12,0.6); }
      .qr-interno-tarjeta {
        position: relative; background: #fff; border-radius: 16px; max-width: 420px; width: 100%;
        box-shadow: 0 20px 60px rgba(0,0,0,0.35); padding: 26px 28px; text-align: center;
      }
      .qr-interno-tarjeta h2 { margin: 0 0 12px; font-size: 16px; }
      .qr-interno-tarjeta p { font-size: 13px; color: #3a362f; line-height: 1.6; text-align: left; }
      .qr-interno-aviso {
        background: #fef3c7; border: 1px solid #f3d99c; border-radius: 8px;
        padding: 10px 12px; font-size: 12px; color: #92400e; text-align: left; margin: 12px 0;
      }
      .qr-interno-imagen-wrap { margin: 16px 0; display: flex; justify-content: center; }
      .qr-interno-etiqueta-impresa { font-size: 11px; color: #6b6558; margin-top: -6px; margin-bottom: 12px; }
      /* Nombre del operador asignado (2026-09-12) — solo texto visible en
         pantalla/impreso, NUNCA dentro de los datos que codifica el QR. */
      .qr-interno-operador { font-size: 13px; font-weight: 700; color: #1c1a17; text-align: center; margin: -6px 0 12px; }
      .qr-interno-operador-impreso { font-size: 13px; font-weight: 700; color: #1c1a17; text-align: center; margin-top: 10px; }
      .qr-interno-acciones { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-top: 6px; }

      /* Impresión aislada del QR interno — corregido 2026-09-10 (Ivan
         reportó que, al "Guardar como PDF", salían muchas hojas en blanco
         antes de la etiqueta). La primera versión ocultaba todo con
         visibility: hidden, que NO le quita el espacio en el documento —
         el resto de la app (tablas, menús) seguía reservando toda su
         altura, y el navegador paginaba esas hojas vacías igual. Ahora se
         arma una tarjeta de impresión aparte, colgada directo de <body>
         (ver #impresion-qr-interno-root en el JS, creado una sola vez y
         reutilizado) y se oculta con display: none a TODO lo demás que
         cuelgue de <body> — eso sí quita el espacio de verdad, sin
         importar cuántos elementos tenga la página alrededor ni qué tan
         anidado esté el overlay original dentro de la app. */
      #impresion-qr-interno-root { display: none; }
      @media print {
        body.imprimiendo-qr-interno > *:not(#impresion-qr-interno-root) { display: none !important; }
        body.imprimiendo-qr-interno #impresion-qr-interno-root {
          display: flex !important; justify-content: center; padding: 24px;
        }
        body.imprimiendo-qr-interno #impresion-qr-interno-root .qr-interno-tarjeta-impresion {
          box-shadow: none; max-width: 380px; width: 100%;
        }
      }

      /* ----------------------------------------------------------------
         Buscador de operador (combobox) en 2da validación (2026-09-10,
         pedido de Ivan): el <select> nativo con todo el catálogo se hacía
         interminable para buscar uno a mano. Es un input de texto + lista
         filtrada tipo "LIKE" (sin distinguir mayúsculas/acentos) + un
         input oculto que guarda el uid elegido — guardarEscaneo() sigue
         leyendo #modal-confirmar-operador exactamente igual que antes. */
      .combo-operador { position: relative; }
      .combo-operador-lista {
        position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; right: 0;
        max-height: 220px; overflow-y: auto; margin: 0; padding: 4px;
        list-style: none; background: #fff; border: 1px solid #ded9d1;
        border-radius: 10px; box-shadow: 0 10px 30px rgba(20,16,12,0.15);
      }
      .combo-operador-lista li {
        padding: 8px 10px; border-radius: 7px; font-size: 13.5px; color: #1c1a17;
        cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .combo-operador-lista li:hover,
      .combo-operador-lista li.combo-operador-activa { background: #eef2ff; color: #3730a3; }
      .combo-operador-lista li.combo-operador-vacia { color: #9c9895; cursor: default; font-style: italic; }
      .combo-operador-lista li.combo-operador-vacia:hover { background: none; }

      /* ----------------------------------------------------------------
         Historial de escaneos: celda embarque+caja, UUID truncado con
         copia, y acciones agrupadas en un menú (2026-09-14, mockup
         revisado con Ivan). No cambia ninguna regla de negocio — Corregir
         origen / Reasignar operador / Borrar (prueba) siguen siendo
         EXACTAMENTE los mismos botones de antes (misma clase, mismo
         listener), solo agrupados detrás de un menú para que la fila no
         compita con la información. El UUID completo sigue disponible en
         el tooltip nativo (title) y se puede copiar con un clic — antes
         se veía cortado donde le cabía al navegador, sin respetar los
         grupos con guion, y eso desbordaba la fila entera. */
      /* Texto principal del historial a la misma fuente/tamaño que el UUID
         (2026-09-14, pedido de Ivan, "a ver si haciendolo más chico se
         reduce más") — nombre de embarque, RFC receptor, y el nombre+fecha
         de cada validación. Lo que YA era más chico que esto (la línea de
         "Caja ..." bajo el embarque, en .celda-embarque-meta, a 11px) se
         deja tal cual, para que la jerarquía siga notándose — no todo el
         texto se vuelve del mismo tamaño, solo el que antes era "grande". */
      .historial-texto { font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
      .celda-embarque-meta { display: block; font-size: 11px; color: #6b6558; font-weight: 400; margin-top: 2px; }
      .celda-embarque-meta .badge { margin-left: 4px; }

      .uuid-chip {
        display: inline-flex; align-items: center; gap: 6px; font-family: ui-monospace, Menlo, monospace;
        font-size: 12px; white-space: nowrap;
      }
      .uuid-chip-copiar {
        border: 1px solid #ded9d1; background: #fff; color: #6b6558; font-size: 10.5px; font-weight: 600;
        padding: 2px 7px; border-radius: 6px; cursor: pointer; line-height: 1.4;
      }
      .uuid-chip-copiar:hover { background: #f7f6f4; color: #1c1a17; }

      /* Celda de acciones del historial con su PROPIA clase (2026-09-14,
         pedido de Ivan: la línea seguía "rota" junto al ⋮ aun sin el
         borde fijo del botón). La causa real era la regla .tabla
         .acciones en estilos.css, que le pone display flex a la celda —
         esa regla es correcta para Pendientes/Validación (varios botones
         en fila) pero en el historial saca a ESTA celda del layout
         normal de tabla y desalinea su borde inferior con el resto de la
         fila. Se deja .tabla .acciones intacta (no tocar estilos.css) y
         esta celda usa su propio nombre para comportarse como celda
         normal. */
      .historial-td-acciones { text-align: right; white-space: nowrap; vertical-align: middle; }
      .historial-menu-wrap { position: relative; display: inline-block; }
      /* Botón "⋮" sin caja fija (2026-09-14, pedido de Ivan): antes tenía
         borde+fondo blanco SIEMPRE visibles, y esa cajita propia rompía la
         línea divisoria entre filas justo en la columna de acciones — se
         notaba sobre todo en el celular, donde podía confundirse a qué
         registro pertenecía el menú. Ahora es transparente en reposo (solo
         los tres puntos) y solo muestra su borde/fondo al pasar el mouse o
         tener el foco (que es también el estado "menú abierto", ya que el
         botón conserva el foco mientras el menú está desplegado) — así la
         línea de la fila queda continua de punta a punta en el estado
         normal. Mismo tamaño/click-target que antes, nada más cambia el
         estilo en reposo. */
      .historial-menu-btn {
        width: 28px; height: 28px; border-radius: 7px; border: 1px solid transparent; background: transparent;
        font-size: 15px; line-height: 1; cursor: pointer; color: #6b6558;
        display: inline-flex; align-items: center; justify-content: center;
      }
      .historial-menu-btn:hover,
      .historial-menu-btn:focus-visible {
        border-color: #ded9d1; background: #f7f6f4; color: #1c1a17;
      }
      .historial-menu {
        display: none; position: absolute; top: calc(100% + 4px); right: 0; z-index: 15; min-width: 190px;
        background: #fff; border: 1px solid #ded9d1; border-radius: 10px; box-shadow: 0 10px 30px rgba(20,16,12,0.15);
        overflow: hidden; padding: 4px;
      }
      .historial-menu.abierto { display: block; }
      .historial-menu button.secundario,
      .historial-menu button.peligro {
        display: flex; align-items: center; gap: 9px; width: 100%; text-align: left; margin: 2px 0; white-space: nowrap;
      }
      .historial-menu button svg { width: 15px; height: 15px; flex: none; opacity: .75; }
      .historial-menu-admin-label {
        font-size: 9.5px; letter-spacing: .05em; text-transform: uppercase; color: #a8a29a;
        padding: 8px 10px 2px; font-weight: 700;
      }
      .historial-menu-hr { border: none; border-top: 1px solid #e7e3dc; margin: 4px 0; }

      /* Historial de escaneos — tabla condensada + modal de detalle
         (2026-09-14, rediseño pedido por Ivan). La tabla ahora solo
         muestra Embarque / Progreso / Sincronización / Acciones; el resto
         vive en el modal que abre el clic sobre el embarque. Mismos tonos
         y clases (semaforo-pill, badge-*) que ya usaba el resto de la
         página — nada nuevo que mantener aparte. */
      .historial-emb-btn {
        background: none; border: none; padding: 0; margin: 0; text-align: left;
        cursor: pointer; display: block; width: 100%; font: inherit; color: inherit;
      }
      .historial-emb-btn:hover .historial-texto { text-decoration: underline; }

      .progreso-franja { display: flex; gap: 3px; width: 120px; height: 7px; }
      .progreso-seg { flex: 1; border-radius: 3px; background: #e2ddd3; }
      .progreso-seg.seg-ok { background: #22c55e; }
      .progreso-seg.seg-bad { background: #ef4444; }
      .progreso-seg.seg-warn { background: #f59e0b; }
      .progreso-texto { font-size: 11.5px; color: #6b6558; margin-top: 6px; }
      .progreso-texto strong { color: #1c1a17; font-weight: 600; }
      .progreso-texto.es-bad strong { color: #c8362a; }
      .progreso-texto.es-warn strong { color: #92400e; }
      /* Nombre del operador asignado bajo el texto de estado (2026-09-14,
         pedido de Ivan) — mismo tratamiento visual que celda-embarque-meta
         (más chico, gris), para que se lea como dato secundario y no
         compita con el estado. Se usa operadorAsignado (no el nombre
         congelado de recepción/pre-entrega) porque es el mismo valor que
         ya se muestra en el modal de detalle y en Reasignar operador — es
         la fuente única de "quién es el operador de este embarque". */
      .progreso-operador { font-size: 11px; color: #6b6558; margin-top: 1px; }

      .detalle-historial-tarjeta { max-width: 580px; }
      .detalle-card { background: #fff; border: 1px solid #ded9d1; border-radius: 10px; margin: 0 0 12px; overflow: hidden; }
      .detalle-card-titulo {
        font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
        color: #a8a29a; padding: 10px 14px 4px;
      }
      .detalle-fila-campos { display: flex; flex-wrap: wrap; }
      .detalle-campo { flex: 1 1 0; min-width: 140px; padding: 6px 14px 12px; border-right: 1px solid #efece6; }
      .detalle-campo:last-child { border-right: none; }
      .detalle-campo-label { font-size: 10.5px; color: #a8a29a; margin-bottom: 4px; font-weight: 600; letter-spacing: 0.02em; }
      .detalle-campo-valor { font-size: 13px; }
      .detalle-campo-sub { font-size: 11px; color: #6b6558; margin-top: 4px; }
      .detalle-val-doble { display: flex; flex-direction: column; gap: 8px; }
      .detalle-sub-etiqueta { font-size: 10px; color: #a8a29a; font-weight: 600; margin-bottom: 2px; }

      /* Modal "Reiniciar flujo" (2026-09-14) */
      .reiniciar-flujo-checklist { margin: 0 0 14px; padding: 0; list-style: none; }
      .reiniciar-flujo-checklist li {
        padding: 7px 0; border-bottom: 1px solid #eee; font-size: 0.85rem; color: #444;
      }
      .reiniciar-flujo-checklist li:last-child { border-bottom: none; }
      .reiniciar-flujo-confirmar {
        display: flex; gap: 9px; align-items: flex-start; font-size: 0.85rem; color: #2c1e0f;
        background: #faf8f5; border: 1px solid #eee; border-radius: 8px; padding: 10px 12px; margin: 0 0 14px;
      }
      .reiniciar-flujo-confirmar input { margin-top: 2px; }
    </style>
    <section class="panel">
      <div class="semaforo-titulo-fila">
        <h2>Seguimiento de embarques</h2>
        <span class="semaforo-chip-espera oculto" id="semaforo-chip-espera"><span class="semaforo-chip-dot"></span><span id="semaforo-chip-espera-texto"></span></span>
      </div>
      <p class="nota">Vista rápida del avance de cada embarque por las 4 etapas del proceso — de un vistazo, sin tener que abrir cada tabla de abajo. El color del número de embarque indica si ya sincronizó con Alanis Operadores (verde = sí, gris = en camino o esperando su turno, rojo = error).</p>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-semaforo">
          <thead>
            <tr>
              <th>Embarque</th><th>Progreso</th>
            </tr>
          </thead>
          <tbody id="tbody-semaforo"><tr><td colspan="2">Cargando...</td></tr></tbody>
        </table>
      </div>
    </section>

    ${seccionPendientesOrigen}
    ${seccionPendientesValidacion2}
    ${seccionPendientesValidacion3}
    ${avisoSinPasoAsignado}

    <section class="panel" style="margin-top:20px;">
      <h2>Historial de escaneos</h2>
      <p class="nota">Da clic en un embarque para ver el detalle completo (UUID, RFC, las 4 validaciones). El color del nombre del embarque indica si ya sincronizó con Alanis Operadores (verde = sí, gris = en camino, rojo = error).</p>
      <div id="historial-origen-error" class="error"></div>
      <div class="tabla-wrap">
        <table class="tabla" id="tabla-historial-origen">
          <thead>
            <tr>
              <th>Embarque</th><th>Progreso</th>${mostrarColumnaAcciones ? "<th></th>" : ""}
            </tr>
          </thead>
          <tbody id="tbody-historial-origen"><tr><td colspan="${mostrarColumnaAcciones ? 3 : 2}">Cargando...</td></tr></tbody>
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
          <div class="modal-fila" id="modal-lectura-cfdi-wrap">
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
          <div class="modal-fila oculto" id="modal-operador-wrap">
            <label for="modal-confirmar-operador-buscar">Operador asignado a este embarque (obligatorio)</label>
            <div class="combo-operador" id="combo-operador">
              <input type="text" id="modal-confirmar-operador-buscar" autocomplete="off" placeholder="Escribe nombre o número de operador…">
              <input type="hidden" id="modal-confirmar-operador">
              <ul class="combo-operador-lista oculto" id="combo-operador-lista"></ul>
            </div>
          </div>
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
        <div class="resultado-escaneo-botonera">
          <button type="button" id="resultado-escaneo-continuar">Continuar</button>
          <button type="button" id="resultado-escaneo-volver" class="oculto">Volver a escanear</button>
        </div>
      </div>
    </div>

    <div id="overlay-correccion-critica" class="correccion-critica-overlay oculto" data-abierto="0">
      <div class="correccion-critica-fondo"></div>
      <div class="correccion-critica-tarjeta">
        <div class="correccion-critica-header">
          <div class="correccion-critica-header-icono">${ICONO_ALERTA}</div>
          <div class="correccion-critica-header-titulo">CORRECCIÓN DE MCCAIN<br>REQUIERE ATENCIÓN</div>
        </div>
        <div class="correccion-critica-cuerpo">
          <div class="correccion-critica-texto" id="correccion-critica-texto"></div>
          <div class="correccion-critica-cambio">
            <span class="correccion-caja-anterior" id="correccion-critica-caja-anterior"></span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c8362a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            <span class="correccion-caja-nueva" id="correccion-critica-caja-nueva"></span>
          </div>
          <div class="correccion-critica-nota">La validación anterior de Atención al Cliente ya no es válida. El embarque regresó a "pendientes de origen" — hay que volver a escanear el CFDI contra la caja correcta antes de continuar.</div>
          <button type="button" class="correccion-critica-boton" id="correccion-critica-entendido">Entendido — ir a re-validar</button>
          <div class="correccion-critica-pie">Este aviso vuelve a aparecer si recargas la página mientras el embarque siga sin re-validarse.</div>
        </div>
      </div>
    </div>

    <div id="modal-confirmar-sin-factura" class="modal-overlay oculto">
      <div class="modal-tarjeta">
        <h2>Este embarque no trae factura</h2>
        <p class="nota" id="confirmar-sin-factura-info"></p>
        <div class="qr-interno-aviso">
          Confirma que esto es un movimiento interno de inventario de McCain (sin factura porque no hay riesgo fiscal que mostrar) — no un correo con la factura extraviada o ilegible. Si no estás seguro, verifica con McCain antes de continuar.
        </div>
        <p class="nota">Al confirmar, este embarque pasa directamente a la cola de Operaciones (segunda validación) — ahí se asigna al operador y en ese mismo momento se genera e imprime el QR de control interno (marcado "SIN FACTURA").</p>
        <div id="confirmar-sin-factura-error" class="error"></div>
        <div class="modal-acciones">
          <button type="button" class="secundario" id="confirmar-sin-factura-cancelar">Cancelar</button>
          <button type="button" id="confirmar-sin-factura-generar">Confirmar sin factura</button>
        </div>
      </div>
    </div>

    <!-- Reiniciar flujo (2026-09-14, pedido de Ivan) — SOLO ADMIN. La acción
         más delicada del menú: borra el escaneo, la 2da validación y el
         operador asignado, en los dos proyectos (ver
         procesarSolicitudReinicioFlujo). El navegador solo crea la
         solicitud; por eso no hay nada que "deshacer" desde aquí una vez
         confirmado — de ahí el checklist + la casilla obligatoria antes de
         dejar hacer clic en el botón rojo. -->
    <div id="modal-reiniciar-flujo" class="modal-overlay oculto">
      <div class="modal-tarjeta">
        <h2>¿Reiniciar el flujo de <span id="reiniciar-flujo-embarque"></span>?</h2>
        <p class="nota">Esto borra el avance ya registrado y regresa el embarque a "Sin escanear", como si nadie lo hubiera tocado — Atención al Cliente tendría que capturarlo de cero. No se puede deshacer.</p>
        <ul class="reiniciar-flujo-checklist" id="reiniciar-flujo-checklist"></ul>
        <label class="reiniciar-flujo-confirmar">
          <input type="checkbox" id="reiniciar-flujo-entendido">
          Entiendo que esto no se puede deshacer y quiero reiniciar este embarque desde cero.
        </label>
        <div id="reiniciar-flujo-error" class="error"></div>
        <div class="modal-acciones">
          <button type="button" class="secundario" id="reiniciar-flujo-cancelar">Cancelar</button>
          <button type="button" class="peligro" id="reiniciar-flujo-confirmar" disabled>Reiniciar flujo</button>
        </div>
      </div>
    </div>

    <!-- Detalle de historial (2026-09-14, rediseño pedido por Ivan: la tabla
         se veía desbordada con 6+ columnas). Solo lectura — todo lo que
         antes eran columnas propias (UUID, RFC, Atención al Cliente, 2da
         validación) ahora vive aquí, organizado en 3 grupos. Las acciones
         (corregir / reasignar / reiniciar / borrar) se quedan en el menú ⋮
         de la tabla, no se duplican aquí. -->
    <div id="modal-detalle-historial" class="modal-overlay oculto">
      <div class="modal-tarjeta detalle-historial-tarjeta">
        <h2>Detalle de <span id="detalle-historial-embarque"></span></h2>
        <div id="detalle-historial-cuerpo"></div>
        <div class="modal-acciones">
          <button type="button" class="secundario" id="detalle-historial-cerrar">Cerrar</button>
        </div>
      </div>
    </div>

    <div id="overlay-qr-interno" class="qr-interno-overlay oculto">
      <div class="qr-interno-fondo"></div>
      <div class="qr-interno-tarjeta">
        <h2>SIN FACTURA — CONTROL INTERNO</h2>
        <p id="qr-interno-info"></p>
        <div class="qr-interno-imagen-wrap"><div id="qr-interno-canvas"></div></div>
        <div class="qr-interno-etiqueta-impresa" id="qr-interno-etiqueta"></div>
        <p class="qr-interno-operador oculto" id="qr-interno-operador"></p>
        <p class="nota" style="text-align:center;">Imprime esta etiqueta e intégrala al set de documentos de este embarque. No es una factura — es un control interno de Alanis para poder seguir el proceso de escaneo en cada checkpoint.</p>
        <div class="qr-interno-acciones">
          <button type="button" class="secundario" id="qr-interno-cerrar">Cerrar</button>
          <button type="button" id="qr-interno-imprimir">Imprimir</button>
        </div>
      </div>
    </div>
  `;

  let listaPendientes = [];
  let listaHistorial = [];
  let listaResultados = [];
  let listaOperadores = [];

  // Corrección de McCain (2026-09-09):
  // - correccionesReconocidas: ids de embarques cuyo banner de corrección
  //   (caso "nadie ha validado todavía") ya fue revisado en esta sesión —
  //   desbloquea el botón de Escanear para ese embarque.
  // - correccionesCriticasVistas / colaCorreccionesCriticas: manejo del
  //   overlay de pantalla completa (caso "ya había validación") — se
  //   muestra una vez por embarque por carga de página (no en cada
  //   re-render, sería insoportable), y en cola si llegan varias a la vez.
  let correccionesReconocidas = new Set();
  let correccionesCriticasVistas = new Set();
  let colaCorreccionesCriticas = [];

  // QR interno para embarques sin factura (2026-09-10) — vive en su propia
  // colección qr_internos_generados (requiere el firestore.rules nuevo, ver
  // el doc de diseño). CORREGIDO 2026-09-10: la primera versión de esto lo
  // guardaba solo en memoria del navegador para no chocar con las reglas de
  // verificaciones_cfdi_local (que exigen uuidEsperado/origenEscaneo
  // completos desde el primer "create") — pero eso se rompe en cuanto
  // generar e imprimir pasa en un dispositivo/pestaña distinto de donde se
  // escanea (justo lo que le pasó a Ivan probándolo: generó/imprimió en un
  // navegador y escaneó desde el celular, que no tenía nada en su memoria).
  // Un QR impreso tiene que sobrevivir a cambiar de dispositivo, así que
  // ahora se persiste de verdad, en una colección aparte con su propia
  // regla create-only (nunca se corrige — si un embarque necesita otro
  // código, es un caso nuevo, no se reescribe el mismo doc).
  let listaQrInternos = []; // [{ id: embarqueId, uuid, rfc, texto, generadoPor, timestamp }, ...]

  const errorPendientesDiv = contenedor.querySelector("#pendientes-origen-error");
  const errorValidacion2Div = contenedor.querySelector("#pendientes-validacion2-error");
  const errorValidacion3Div = contenedor.querySelector("#pendientes-validacion3-error");
  const errorHistorialDiv = contenedor.querySelector("#historial-origen-error");
  const tbodyPendientes = contenedor.querySelector("#tbody-pendientes-origen");
  const tbodyValidacion2 = contenedor.querySelector("#tbody-pendientes-validacion2");
  const tbodyValidacion3 = contenedor.querySelector("#tbody-pendientes-validacion3");
  const tbodyHistorial = contenedor.querySelector("#tbody-historial-origen");
  const tbodySemaforo = contenedor.querySelector("#tbody-semaforo");
  const chipEsperaSpan = contenedor.querySelector("#semaforo-chip-espera");
  const chipEsperaTexto = contenedor.querySelector("#semaforo-chip-espera-texto");

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
    renderSemaforo();
  }, (err) => {
    errorHistorialDiv.textContent = "No se pudo cargar el historial: " + err.message;
  });

  onSnapshot(collection(db, "verificaciones_cfdi_resultado"), (snap) => {
    listaResultados = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPendientesValidacion3();
    renderSemaforo();
    // Bug real encontrado por Ivan (2026-09-14): la franja de Progreso del
    // historial (celdaProgreso) también depende de listaResultados —
    // Recepción/Pre-entrega del operador — pero este listener nunca
    // volvía a dibujar la tabla de historial, solo el semáforo. El modal
    // de detalle sí quedaba correcto porque lee listaResultados en vivo al
    // momento del clic, pero la franja de la fila se quedaba pegada con lo
    // que había cuando se dibujó por última vez (normalmente vacío, porque
    // el resultado del operador casi siempre llega DESPUÉS de que el
    // historial ya se dibujó) — por eso se veían embarques ya validados
    // por completo en el modal, pero "Esperando operador" en la fila.
    renderHistorial();
  }, (err) => {
    if (errorValidacion3Div) errorValidacion3Div.textContent = "No se pudo cargar el estado del operador: " + err.message;
  });

  // QR interno para embarques sin factura (2026-09-10) — sincronizado como
  // el resto, así que un QR generado desde otro dispositivo/sesión (por
  // ejemplo, Atención al Cliente lo genera en la computadora y lo escanea
  // desde el celular) SÍ aparece aquí. Sin manejador de error propio: si
  // falla, simplemente no se ofrece "Generar QR interno" con normalidad —
  // no es crítico bloquear toda la pantalla por esto.
  onSnapshot(collection(db, "qr_internos_generados"), (snap) => {
    listaQrInternos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPendientes();
  }, () => { /* ver nota arriba */ });

  // Catálogo de operadores de Alanis Operadores (uid, nombre, numero de
  // unidad), reflejado aquí de solo lectura por el Apps Script cada pocos
  // minutos — se usa para el selector obligatorio de "operador asignado" en
  // la segunda validación (decisión de Ivan, 2026-09-07): la asignación de
  // viajes de Alanis Operadores todavía está en pruebas, así que esto vive
  // aquí en vez de depender de ese sistema.
  onSnapshot(collection(db, "operadores_alanis"), (snap) => {
    listaOperadores = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSelectorOperador();
    // renderSemaforo() (2026-09-14) — el semáforo de "Seguimiento de
    // embarques" pinta el nombre del operador (Checkpoint 1) directo en la
    // celda vía nombreOperador_(uid, ...), que depende de listaOperadores.
    // Sin este render, cuando se corrige un nombreOficial en el admin de
    // Alanis Operadores el catálogo se actualiza aquí en memoria pero la
    // tabla se queda pintada con lo último que tenía — el modal de detalle
    // sí se veía bien porque se arma fresco en cada clic, pero el semáforo
    // no. Mismo patrón de bug que el de renderHistorial() de más arriba.
    renderSemaforo();
  }, (err) => {
    if (modalErrorDiv) modalErrorDiv.textContent = "No se pudo cargar el catálogo de operadores: " + err.message;
  });

  // Chip "N esperando iniciar" junto al título del semáforo (pedido de
  // Ivan, 2026-09-08): da el número de un vistazo sin meter esos embarques
  // como filas grises dentro del semáforo mismo — eso ya lo cubre la tabla
  // de "Pendientes de primera validación" de abajo, a la que apunta.
  // Se actualiza aquí (no en renderSemaforo) porque depende de
  // listaPendientes, no de listaHistorial/listaResultados.
  function renderChipEsperaInicio(n) {
    if (!chipEsperaSpan || !chipEsperaTexto) return;
    if (n === 0) {
      chipEsperaSpan.classList.add("oculto");
      return;
    }
    chipEsperaTexto.textContent = n === 1 ? "1 esperando iniciar" : `${n} esperando iniciar`;
    chipEsperaSpan.classList.remove("oculto");
  }

  // Fila de "Escanear (prueba)" (borrar) reutilizable en las 3 variantes de
  // fila de abajo.
  function accionesPendiente(p, escanearHtml) {
    return `
      <td class="acciones">
        ${escanearHtml}
        ${esAdmin ? `<button type="button" class="peligro btn-borrar-prueba" title="Borra este embarque por completo en ADREMATASA y en Alanis Operadores. No es reversible.">Borrar</button>` : ""}
      </td>
    `;
  }

  function botonEscanearHtml() {
    return puedeValidar1
      ? `<button type="button" class="btn-escanear-origen">Escanear</button>`
      : `<span class="nota" style="margin:0;">Requiere Atención al Cliente</span>`;
  }

  function filaPendienteNormal(p) {
    return `
      <tr data-id="${p.id}">
        <td>${escapeHtml(p.shipment || "—")}</td>
        <td>${escapeHtml(p.ocCliente || "—")}</td>
        <td>${escapeHtml(p.clienteNombre || "—")}</td>
        <td>${escapeHtml(p.caja || "—")}</td>
        <td>${escapeHtml(p.fechaEntrega || "—")}</td>
        ${accionesPendiente(p, botonEscanearHtml())}
      </tr>
    `;
  }

  // Embarque sin Cadena Original del SAT capturada por el VBA (McCain no
  // adjuntó factura, o el PDF no era legible). Rediseñado 2026-09-12: ya no
  // se genera QR aquí — Atención al Cliente solo confirma con un clic que
  // el embarque no trae factura y lo pasa automáticamente a la cola de
  // Operaciones, quien crea el QR al asignar operador (ver
  // abrirModalAsignarOperadorSinFactura más abajo).
  function filaSinFactura(p) {
    const accionesHtml = !puedeValidar1
      ? `<span class="nota" style="margin:0;">Requiere Atención al Cliente</span>`
      : `<button type="button" class="btn-confirmar-sin-factura">Confirmar sin factura</button>`;
    return `
      <tr data-id="${p.id}">
        <td>${escapeHtml(p.shipment || "—")}</td>
        <td>${escapeHtml(p.ocCliente || "—")}</td>
        <td>${escapeHtml(p.clienteNombre || "—")}<br><span class="badge-sin-factura" title="McCain no adjuntó una factura legible en el correo original — verificado con McCain como movimiento interno de inventario">SIN FACTURA</span></td>
        <td>${escapeHtml(p.caja || "—")}</td>
        <td>${escapeHtml(p.fechaEntrega || "—")}</td>
        <td class="acciones">
          ${accionesHtml}
          ${esAdmin ? `<button type="button" class="peligro btn-borrar-prueba" title="Borra este embarque por completo en ADREMATASA y en Alanis Operadores. No es reversible.">Borrar</button>` : ""}
        </td>
      </tr>
    `;
  }

  // Caso 1 (pedido de Ivan, 2026-09-09): McCain corrigió la caja/remolque y
  // TODAVÍA NADIE había validado este embarque. No basta con cambiar de
  // color — el botón de Escanear queda bloqueado hasta que alguien haga
  // clic en "Revisar corrección" (correccionesReconocidas), forzando a que
  // se detengan a ver cuál es el dato correcto antes de poder avanzar.
  function filaCorreccionPreValidacion(p) {
    const reconocida = correccionesReconocidas.has(p.id);
    const correo = p.correccionAsuntoCorreo ? escapeHtml(p.correccionAsuntoCorreo) : "";
    const escanearHtml = puedeValidar1
      ? `<button type="button" class="btn-escanear-origen" ${reconocida ? "" : "disabled"}>Escanear</button>`
      : `<span class="nota" style="margin:0;">Requiere Atención al Cliente</span>`;
    return `
      <tr data-id="${p.id}">
        <td colspan="6" style="padding:0;">
          <div class="correccion-banner">
            <div class="correccion-banner-titulo">${ICONO_ALERTA} MCCAIN CORRIGIÓ ESTE EMBARQUE — VERIFICA ANTES DE CONTINUAR</div>
            <div class="correccion-banner-datos">
              <span>${escapeHtml(p.shipment || p.ocCliente || p.id)} · ${escapeHtml(p.clienteNombre || "McCain")}</span>
              <span class="correccion-caja-cambio">
                <span class="correccion-caja-anterior">${escapeHtml(p.correccionCajaAnterior || "—")}</span>
                →
                <span class="correccion-caja-nueva">${escapeHtml(p.correccionCajaNueva || p.caja || "—")}</span>
              </span>
            </div>
            ${correo ? `<div class="correccion-banner-correo">Corrección recibida${p.correccionDetectadaEn ? " · " + formatoFecha(p.correccionDetectadaEn) : ""}: "${correo}"</div>` : ""}
            <div class="correccion-banner-acciones">
              ${escanearHtml}
              ${puedeValidar1
                ? (reconocida
                    ? `<span class="nota" style="margin:0;">Corrección revisada — ya puedes escanear</span>`
                    : `<button type="button" class="peligro btn-revisar-correccion">Revisar corrección</button>`)
                : ""}
              ${esAdmin ? `<button type="button" class="peligro btn-borrar-prueba" title="Borra este embarque por completo en ADREMATASA y en Alanis Operadores. No es reversible.">Borrar</button>` : ""}
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  // Caso 2: McCain corrigió DESPUÉS de que ya había al menos una
  // validación hecha — el Apps Script/VBA ya forzó que este embarque
  // regresara a pendientes (ver Codigo.gs, correccionPostValidacion). Aquí
  // ya no hace falta bloquear el botón (el overlay de pantalla completa,
  // más abajo, ya se encargó de interrumpir al usuario) — pero la fila
  // sigue marcada en rojo con un chip para que quede claro que es un
  // RE-escaneo por corrección, no un embarque nuevo.
  function filaCorreccionPostValidacion(p) {
    const cajaHtml = p.correccionCajaAnterior
      ? `<span class="correccion-caja-anterior">${escapeHtml(p.correccionCajaAnterior)}</span> <span class="correccion-caja-nueva">→ ${escapeHtml(p.caja || p.correccionCajaNueva || "—")}</span>`
      : escapeHtml(p.caja || "—");
    return `
      <tr data-id="${p.id}" class="fila-correccion-post">
        <td>${escapeHtml(p.shipment || "—")}</td>
        <td>${escapeHtml(p.ocCliente || "—")}</td>
        <td>${escapeHtml(p.clienteNombre || "—")}<br><span class="correccion-chip-post">CORRECCIÓN — RE-VALIDAR</span></td>
        <td>${cajaHtml}</td>
        <td>${escapeHtml(p.fechaEntrega || "—")}</td>
        ${accionesPendiente(p, botonEscanearHtml())}
      </tr>
    `;
  }

  // Revisa si hay correcciones "fuertes" (post-validación) nuevas que
  // todavía no se le muestren al usuario esta sesión, y encola el overlay
  // de pantalla completa para cada una. Se llama en cada render de
  // pendientes — pero solo agrega a la cola una vez por id (no reabre el
  // overlay si el usuario ya lo cerró en esta sesión), y solo mientras el
  // embarque SIGA necesitando corrección (si ya se re-validó y desapareció
  // de pendientesVisibles, se saca de la cola sin mostrarlo).
  function verificarCorreccionesPostValidacion(pendientesVisibles) {
    if (!overlayCorreccionCritica) return;
    const criticos = pendientesVisibles.filter(p => p.correccionPostValidacion);
    const idsActivos = new Set(criticos.map(p => p.id));
    colaCorreccionesCriticas = colaCorreccionesCriticas.filter(id => idsActivos.has(id));
    criticos.forEach(p => {
      if (!correccionesCriticasVistas.has(p.id) && !colaCorreccionesCriticas.includes(p.id)) {
        colaCorreccionesCriticas.push(p.id);
      }
    });
    mostrarSiguienteCorreccionCritica();
  }

  function mostrarSiguienteCorreccionCritica() {
    if (!overlayCorreccionCritica) return;
    if (overlayCorreccionCritica.dataset.abierto === "1") return; // ya hay uno mostrándose, no interrumpir
    if (colaCorreccionesCriticas.length === 0) {
      overlayCorreccionCritica.classList.add("oculto");
      return;
    }
    const id = colaCorreccionesCriticas[0];
    const p = listaPendientes.find(x => x.id === id);
    if (!p) {
      // ya no está en pendientes (se resolvió entre medio) — lo quitamos y probamos con el siguiente
      colaCorreccionesCriticas.shift();
      mostrarSiguienteCorreccionCritica();
      return;
    }
    overlayCorreccionCritica.dataset.abierto = "1";
    overlayCorreccionCritica.dataset.idActual = id;
    const nombreEmbarque = p.shipment || p.ocCliente || id;
    textoCorreccionCritica.textContent = `El embarque ${nombreEmbarque} ya fue validado con la caja ${p.correccionCajaAnterior || "anterior"}. McCain corrigió esa información — la caja correcta ahora es ${p.correccionCajaNueva || p.caja || "—"}.`;
    cajaAnteriorCorreccionCritica.textContent = p.correccionCajaAnterior || "—";
    cajaNuevaCorreccionCritica.textContent = p.correccionCajaNueva || p.caja || "—";
    overlayCorreccionCritica.classList.remove("oculto");
  }

  function renderPendientes() {
    // Un embarque desaparece de esta tabla en cuanto ya tiene un registro
    // en el historial (igual que en segunda y tercera validación) — SALVO
    // que McCain lo haya corregido DESPUÉS de esa validación
    // (correccionPostValidacion), en cuyo caso Codigo.gs/el VBA ya lo
    // regresaron aquí a propósito y no debe desaparecer hasta re-validarse
    // (pedido de Ivan, 2026-09-09: "mejor que desaparezcan como lo hacen
    // los registros en las secciones de la segunda y tercera validación").
    // Un embarque cuenta como "ya escaneado" solo si su doc trae
    // origenEscaneo (no solo por existir en la colección) — el doc de
    // verificaciones_cfdi_local no se toca hasta el escaneo real, así que
    // esto es solo defensivo.
    const idsEscaneados = new Set(listaHistorial.filter(f => f.origenEscaneo).map(f => f.id));
    const pendientesVisibles = listaPendientes.filter(p => !idsEscaneados.has(p.id) || p.correccionPostValidacion);

    renderChipEsperaInicio(pendientesVisibles.filter(p => !p.correccionPostValidacion).length);
    if (puedeValidar1) verificarCorreccionesPostValidacion(pendientesVisibles);

    if (!tbodyPendientes) return; // esta sección no se dibujó para este usuario
    if (pendientesVisibles.length === 0) {
      tbodyPendientes.innerHTML = `<tr><td colspan="6">No hay embarques pendientes.</td></tr>`;
      return;
    }

    tbodyPendientes.innerHTML = pendientesVisibles.map(p => {
      if (p.correccionPostValidacion) return filaCorreccionPostValidacion(p);
      if (p.correccionCajaAnterior || p.correccionCajaNueva) return filaCorreccionPreValidacion(p);
      if (!p.uuidFactura) return filaSinFactura(p);
      return filaPendienteNormal(p);
    }).join("");

    tbodyPendientes.querySelectorAll(".btn-escanear-origen").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.closest("tr").dataset.id;
        const p = listaPendientes.find(x => x.id === id);
        abrirModalEscaneo({
          embarqueId: id,
          modo: "origen",
          infoTexto: `Embarque ${(p && p.shipment) || id} — ${(p && p.clienteNombre) || "McCain"}`,
          cajaEsperada: p ? p.caja : null,
          cajaPrevia: "",
          // Cadena Original del SAT capturada por el VBA desde el PDF real
          // del correo (repositorio_mccain.uuidFactura, vía Apps Script). Si
          // el correo no traía un PDF legible, llega vacío y simplemente no
          // hay nada contra qué comparar todavía — no bloquea nada en ese
          // caso (decisión de Ivan, 2026-09-03).
          uuidEsperado: p ? p.uuidFactura : null
        });
      });
    });

    tbodyPendientes.querySelectorAll(".btn-revisar-correccion").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.closest("tr").dataset.id;
        correccionesReconocidas.add(id);
        renderPendientes();
      });
    });

    tbodyPendientes.querySelectorAll(".btn-confirmar-sin-factura").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.closest("tr").dataset.id;
        const p = listaPendientes.find(x => x.id === id);
        abrirConfirmacionSinFactura(p, id);
      });
    });

    // Borrado de prueba — TEMPORAL (ver nota completa en renderHistorial).
    // Aquí también aplica porque un embarque puede estar sin escanear
    // todavía (sin Historial) y aun así ser puro dato de prueba a limpiar.
    if (esAdmin) wireBorrarPrueba(tbodyPendientes, () => pendientesVisibles);
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
        <td>${escapeHtml(f.clienteNombre || "McCain")}${f.esQrInterno ? '<br><span class="badge-sin-factura" title="Movimiento interno de McCain, sin factura">SIN FACTURA</span>' : ""}</td>
        <td>${escapeHtml((f.origenEscaneo && f.origenEscaneo.caja) || "—")}</td>
        <td>${escapeHtml((f.origenEscaneo && f.origenEscaneo.escaneadoPor && f.origenEscaneo.escaneadoPor.nombre) || "—")} · ${formatoFecha(f.origenEscaneo && f.origenEscaneo.timestamp)}</td>
        <td class="acciones">
          ${!puedeValidar2
            ? `<span class="nota" style="margin:0;">Requiere Operaciones</span>`
            : (f.esQrInterno
                ? `<button type="button" class="btn-asignar-operador-sin-factura">Asignar operador y generar QR</button>`
                : `<button type="button" class="btn-validar2">Validar</button>`)}
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

    // Sin factura (2026-09-12): en vez de escanear/comparar un CFDI que no
    // existe, Operaciones asigna aquí al operador y en ese mismo momento se
    // genera el QR de control interno (ver abrirModalAsignarOperadorSinFactura).
    tbodyValidacion2.querySelectorAll(".btn-asignar-operador-sin-factura").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.closest("tr").dataset.id;
        const f = listaHistorial.find(x => x.id === id);
        if (f) abrirModalAsignarOperadorSinFactura(id, f);
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

  // Píldora de color para una celda del semáforo. estado: 'ok' (verde),
  // 'warn' (ámbar, requiere revisión pero no es necesariamente un error),
  // 'bad' (rojo, discrepancia real) o 'pend' (gris, no ha llegado a esta
  // etapa todavía o sigue esperando).
  function pillEtapa(estado, texto, meta) {
    return `<span class="semaforo-pill semaforo-${estado}"><span class="semaforo-dot"></span>${escapeHtml(texto)}</span>` +
      (meta ? `<span class="semaforo-meta">${escapeHtml(meta)}</span>` : "");
  }

  // Color del texto del embarque según su estado de sincronización (ajuste
  // 2026-09-08, reemplaza el punto de color que se probó antes) — reemplaza
  // lo que antes era una columna completa de "Sincronización". Verde = ya
  // sincronizó, rojo = error real (esto es lo que no se quería perder al
  // simplificar), gris = cualquier otro caso normal de "todavía no le toca"
  // (esperando 2da validación o en camino hacia Alanis).
  function claseYTituloSync(estadoSync) {
    if (estadoSync === "sincronizado") return { clase: "semaforo-embarque-verde", titulo: "Sincronizado con Alanis Operadores" };
    if (estadoSync === "error") return { clase: "semaforo-embarque-rojo", titulo: "Error de sincronización — revisar Apps Script" };
    return { clase: "semaforo-embarque-gris", titulo: ETIQUETAS_SYNC[estadoSync] || "Esperando su turno para sincronizar" };
  }

  // Cuenta cuántas de las 4 etapas ya están cumplidas para un embarque —
  // usado solo para ORDENAR el semáforo (ver renderSemaforo), no se
  // muestra como columna ni badge. DISCREPANCIA en cualquiera de los 2
  // checkpoints del operador NO suma (es un error, no un avance).
  function etapasCumplidas_(f, r) {
    let n = 0;
    if (f.origenEscaneo) n++;
    if (f.validacion2) n++;
    if (r && r.recepcionResultado === "COINCIDE") n++;
    if (r && r.estatusValidacion === "VALIDADO") n++;
    return n;
  }

  // Nombre del operador resuelto por uid (2026-09-14, pedido de Ivan) — los
  // operadores auto-capturan su nombre al validar en Alanis Operadores, y a
  // veces lo escriben con mayúsculas/minúsculas inconsistentes ("JOSE
  // RODOLFO MARTINEZ" vs "Moises Garcia"). En vez de confiar en ese texto
  // congelado al momento del escaneo (recepcionOperadorNombre), se resuelve
  // en vivo contra operadores_alanis (listaOperadores, que ya refleja
  // usuarios/{uid}.nombre) — así, si se corrige el nombre desde la pantalla
  // de admin de Alanis Operadores, aquí se ve corregido de inmediato sin
  // tener que re-escanear nada. Si el uid todavía no llegó (embarques
  // anteriores a este cambio) o no se encuentra en el catálogo, se usa el
  // nombre congelado como respaldo.
  function nombreOperador_(uid, nombreRespaldo) {
    if (uid) {
      const op = listaOperadores.find(o => o.id === uid);
      if (op && op.nombre) return op.nombre;
    }
    return nombreRespaldo || "—";
  }

  // "Seguimiento de embarques" — vista de un vistazo, pedida por Ivan
  // (2026-09-08), de las 4 etapas del proceso por embarque (más el punto de
  // sincronización junto al nombre). Se arma combinando listaHistorial
  // (etapas 1/2/sync, aquí en ADREMATASA) con listaResultados (etapas de
  // checkpoint 1 y 2, que vienen reflejadas desde Alanis Operadores por
  // sincronizarResultados_/sincronizarResultadoRecepcion_ en Codigo.gs). Es
  // solo informativa, no tiene botones — para actuar se usan las tablas de
  // abajo.
  // (2026-09-14, pedido de Ivan) — reemplaza las 4 columnas de pastillas
  // (Atención al Cliente / Despacho y Asignación / Operador Despacho /
  // Operador Pre Entrega) por la misma franja de progreso de 4 segmentos +
  // texto de estado que ya usa "Historial de escaneos" (celdaProgreso),
  // para que ambas tablas se vean y se lean igual de un vistazo. El detalle
  // completo por etapa sigue disponible más abajo, en la tabla de Historial
  // (clic en el embarque abre el modal) — este semáforo sigue siendo solo
  // informativo, sin botones.
  function renderSemaforo() {
    if (!tbodySemaforo) return;
    if (listaHistorial.length === 0) {
      tbodySemaforo.innerHTML = `<tr><td colspan="2">Todavía no hay embarques en proceso.</td></tr>`;
      return;
    }
    const resultadosPorId = new Map(listaResultados.map(r => [r.id, r]));

    // Pedido de Ivan (2026-09-09): arriba los embarques con MENOS etapas
    // cumplidas, abajo los que ya llevan más avanzado — así el enfoque cae
    // naturalmente en lo pendiente. "Cumplida" cuenta las 4 etapas por
    // separado (no solo la última): Atención al Cliente (origenEscaneo),
    // Despacho y Asignación (validacion2), Operador Despacho (COINCIDE) y
    // Operador Pre Entrega (VALIDADO). DISCREPANCIA en cualquiera de los 2
    // checkpoints del operador NO cuenta como cumplida — es un error, no un
    // avance (confirmado por Ivan). En empate se conserva el orden que ya
    // traía listaHistorial (más reciente primero) — Array.prototype.sort es
    // estable en los navegadores modernos.
    const historialOrdenado = listaHistorial.slice().sort((a, b) => {
      return etapasCumplidas_(a, resultadosPorId.get(a.id)) - etapasCumplidas_(b, resultadosPorId.get(b.id));
    });

    tbodySemaforo.innerHTML = historialOrdenado.map(f => {
      const r = resultadosPorId.get(f.id);
      const syncInfo = claseYTituloSync(f.estadoSync);

      return `
        <tr data-id="${f.id}">
          <td><strong class="${syncInfo.clase}" title="${escapeHtml(syncInfo.titulo)}">${escapeHtml(f.embarqueId || f.id)}</strong><span class="semaforo-meta">${escapeHtml(f.clienteNombre || "McCain")}${f.origenEscaneo && f.origenEscaneo.caja ? " · Caja " + escapeHtml(f.origenEscaneo.caja) : ""}</span></td>
          <td>${celdaProgreso(f, r)}</td>
        </tr>
      `;
    }).join("");
  }

  // tituloSi/tituloNo (2026-09-14, opcionales): tooltip del badge — para
  // casos donde el badge por sí solo se presta a confusión (ej. el "OK" de
  // coincidencia de caja, que Ivan confundió con el estado de
  // sincronización por estar tan cerca de esa otra pastilla).
  function badgeSiNo(valor, etiquetaSi, etiquetaNo, tituloSi, tituloNo) {
    if (typeof valor !== "boolean") return "";
    const titulo = valor ? tituloSi : tituloNo;
    return `<span class="badge ${valor ? "badge-aprobada" : "badge-rechazada"}" style="margin-left:6px;"${titulo ? ` title="${escapeHtml(titulo)}"` : ""}>${valor ? etiquetaSi : etiquetaNo}</span>`;
  }

  // Historial: UUID truncado + copiable (2026-09-14) — el navegador cortaba
  // las 36 posiciones del UUID donde le cabía en la celda, sin respetar los
  // grupos con guion, y eso desbordaba la fila entera. Se ve completo en el
  // tooltip nativo (title, al pasar el mouse) y se copia completo con un
  // clic. Si el valor no es un UUID largo (p.ej. "SIN-FACTURA" o "—") se
  // muestra tal cual, sin truncar ni agregar el botón de copiar.
  function celdaUuid(valor) {
    const texto = valor || "";
    if (!texto || texto === "—" || texto.length <= 20) return `<span class="historial-texto">${escapeHtml(texto || "—")}</span>`;
    const truncado = `${texto.slice(0, 8)}…${texto.slice(-6)}`;
    return `<span class="uuid-chip" title="${escapeHtml(texto)}">${escapeHtml(truncado)}<button type="button" class="uuid-chip-copiar" data-uuid="${escapeHtml(texto)}">Copiar</button></span>`;
  }

  // Iconos del menú de acciones del historial (2026-09-14) — mismo trazo
  // que el mockup que Ivan aprobó, solo para que el menú se vea igual.
  const ICONO_LAPIZ = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>`;
  const ICONO_SWAP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>`;
  const ICONO_BASURA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2"/><path d="M19 6l-1 14a1 1 0 01-1 1H7a1 1 0 01-1-1L5 6"/></svg>`;
  const ICONO_REINICIAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 109-9"/><path d="M3 4v5h5"/></svg>`;

  // Reasignación de operador (2026-09-12, decisión de Ivan): disponible
  // para CUALQUIER puesto de Operaciones o admin (mismo criterio que
  // puedeValidar2), para embarques con o sin factura, sin pedir motivo —
  // mientras la pre-entrega (Checkpoint 2) todavía no se haya completado.
  // Una vez que verificaciones_cfdi_resultado ya trae VALIDADO/DISCREPANCIA
  // (listaResultados, sincronizado en vivo), ya no se puede reasignar.
  function puedeReasignar(f) {
    if (!puedeValidar2) return false;
    if (!f.operadorAsignado) return false;
    const r = listaResultados.find(x => x.id === f.id);
    const preEntregaCompletada = !!(r && (r.estatusValidacion === "VALIDADO" || r.estatusValidacion === "DISCREPANCIA"));
    return !preEntregaCompletada;
  }

  // Franja de progreso de 4 segmentos (Atención al Cliente / Operaciones /
  // Operador recepción / Operador pre-entrega) + texto de estado actual —
  // mismo mockup que Ivan aprobó (2026-09-14) para reemplazar las columnas
  // de Atención al Cliente y 2da validación en la tabla. El detalle
  // completo de cada etapa (quién, cuándo, badges de coincidencia) se
  // quedó en el modal — aquí solo el resumen de un vistazo.
  function celdaProgreso(f, r) {
    const seg1 = f.origenEscaneo ? "seg-ok" : "";
    const seg2 = f.validacion2 ? "seg-ok" : "";
    let seg3 = "";
    if (r && r.recepcionResultado === "COINCIDE") seg3 = "seg-ok";
    else if (r && r.recepcionResultado === "NO_COINCIDE_DOCUMENTO") seg3 = "seg-bad";
    else if (r && r.recepcionResultado === "NO_COINCIDE_OPERADOR") seg3 = "seg-warn";
    let seg4 = "";
    if (r && r.estatusValidacion === "VALIDADO") seg4 = "seg-ok";
    else if (r && r.estatusValidacion === "DISCREPANCIA") seg4 = "seg-bad";

    let texto, clase = "";
    if (r && r.estatusValidacion === "VALIDADO") { texto = "<strong>Validado</strong> · completo"; }
    else if (r && r.estatusValidacion === "DISCREPANCIA") { texto = "<strong>Discrepancia</strong> · pre-entrega"; clase = "es-bad"; }
    else if (r && r.recepcionResultado === "NO_COINCIDE_DOCUMENTO") { texto = "<strong>Discrepancia</strong> · recepción"; clase = "es-bad"; }
    else if (r && r.recepcionResultado === "NO_COINCIDE_OPERADOR") { texto = "<strong>Alerta</strong> · operador (recepción)"; clase = "es-warn"; }
    else if (r && r.recepcionResultado === "COINCIDE") { texto = "Operador <strong>en tránsito</strong>"; }
    else if (f.validacion2) { texto = "Esperando <strong>operador</strong>"; }
    else if (f.origenEscaneo) { texto = "Esperando <strong>2da validación</strong>"; }
    else { texto = "<strong>Sin escanear</strong>"; }

    // Nombre del operador asignado (2026-09-14, pedido de Ivan): se pone
    // en el mismo lugar donde antes solo se leía "Operador en tránsito" /
    // "Validado · completo" sin decir quién. Solo aparece si ya hay
    // operador asignado (existe desde que Operaciones completa la 2da
    // validación — ver registrarValidacion2) — antes de eso no hay nadie
    // a quién nombrar.
    const nombreOperadorAsignado = f.operadorAsignado && f.operadorAsignado.nombre;

    return `
      <div class="progreso-franja">
        <div class="progreso-seg ${seg1}"></div>
        <div class="progreso-seg ${seg2}"></div>
        <div class="progreso-seg ${seg3}"></div>
        <div class="progreso-seg ${seg4}"></div>
      </div>
      <div class="progreso-texto ${clase}">${texto}</div>
      ${nombreOperadorAsignado ? `<div class="progreso-operador">${escapeHtml(nombreOperadorAsignado)}</div>` : ""}
    `;
  }

  // Contenido del modal de detalle (2026-09-14) — los 3 grupos exactos que
  // pidió Ivan: (1) Embarque/UUID/RFC receptor, (2) Remolque + las 4
  // validaciones (Atención al Cliente, Operaciones, Operador recepción y
  // pre-entrega), (3) Sincronización. Reutiliza los mismos helpers/clases
  // que ya usaba la tabla (celdaUuid, badgeSiNo, pillEtapa, semaforo-pill)
  // para no inventar un estilo aparte.
  function contenidoDetalleHistorial(f, r) {
    const caja = escapeHtml((f.origenEscaneo && f.origenEscaneo.caja) || f.cajaEsperada || "—");

    let valAtencion;
    if (f.origenEscaneo) {
      valAtencion = pillEtapa("ok", "Escaneado") +
        badgeSiNo(f.origenEscaneo.facturaUuidCoincide, "Factura OK", "Factura no coincide") +
        `<div class="detalle-campo-sub">${escapeHtml((f.origenEscaneo.escaneadoPor && f.origenEscaneo.escaneadoPor.nombre) || "—")} · ${formatoFecha(f.origenEscaneo.timestamp)}</div>`;
    } else {
      valAtencion = pillEtapa("pend", "Pendiente");
    }

    let valOperaciones;
    if (f.validacion2) {
      const v2 = f.validacion2;
      valOperaciones = pillEtapa("ok", "Validado") +
        badgeSiNo(v2.uuidCoincide, "UUID OK", "UUID no coincide") +
        badgeSiNo(v2.rfcCoincide, "RFC OK", "RFC no coincide") +
        badgeSiNo(v2.cajaCoincide, "Caja OK", "Caja no coincide") +
        `<div class="detalle-campo-sub">${escapeHtml((v2.escaneadoPor && v2.escaneadoPor.nombre) || "—")} · ${formatoFecha(v2.timestamp)}</div>`;
    } else {
      valOperaciones = pillEtapa("pend", "Pendiente");
    }

    const nombreRecepcion = nombreOperador_(r && r.recepcionOperadorUid, r && r.recepcionOperadorNombre);
    let recepcionHtml;
    if (r && r.recepcionResultado === "COINCIDE") {
      recepcionHtml = pillEtapa("ok", "Coincide") + `<div class="detalle-campo-sub">${escapeHtml(nombreRecepcion)}${r.recepcionTimestamp ? " · " + formatoFecha(r.recepcionTimestamp) : ""}</div>`;
    } else if (r && r.recepcionResultado === "NO_COINCIDE_DOCUMENTO") {
      recepcionHtml = pillEtapa("bad", "Documento no coincide") + `<div class="detalle-campo-sub">${escapeHtml(nombreRecepcion)}</div>`;
    } else if (r && r.recepcionResultado === "NO_COINCIDE_OPERADOR") {
      recepcionHtml = pillEtapa("warn", "Operador no coincide") + `<div class="detalle-campo-sub">${escapeHtml(nombreRecepcion)}</div>`;
    } else {
      recepcionHtml = pillEtapa("pend", "—");
    }

    // Nombre de quien validó pre-entrega (2026-09-14) — antes no se
    // mostraba porque el uid no llegaba reflejado desde Alanis Operadores;
    // ahora que validadoPor sí llega, se resuelve igual que en recepción.
    // Sin respaldo de texto congelado (nunca existió para esta etapa): si
    // el uid no se encuentra en el catálogo, simplemente no se muestra
    // nombre en vez de mostrar un "—" confuso junto al pillEtapa.
    const opPreEntrega = r && r.validadoPor ? listaOperadores.find(o => o.id === r.validadoPor) : null;
    const nombrePreEntrega = opPreEntrega && opPreEntrega.nombre ? opPreEntrega.nombre : null;
    let preEntregaHtml;
    if (r && r.estatusValidacion === "VALIDADO") {
      preEntregaHtml = pillEtapa("ok", "Validado") + (nombrePreEntrega ? `<div class="detalle-campo-sub">${escapeHtml(nombrePreEntrega)}</div>` : "");
    } else if (r && r.estatusValidacion === "DISCREPANCIA") {
      preEntregaHtml = pillEtapa("bad", "Discrepancia") +
        (nombrePreEntrega ? `<div class="detalle-campo-sub">${escapeHtml(nombrePreEntrega)}</div>` : "") +
        (r.discrepanciaDetalle ? `<div class="detalle-campo-sub">${escapeHtml(r.discrepanciaDetalle)}</div>` : "");
    } else if (r && r.recepcionResultado) {
      preEntregaHtml = pillEtapa("pend", "En tránsito");
    } else {
      preEntregaHtml = pillEtapa("pend", "—");
    }

    const valOperador = `
      <div class="detalle-val-doble">
        <div><div class="detalle-sub-etiqueta">Recepción</div>${recepcionHtml}</div>
        <div><div class="detalle-sub-etiqueta">Pre-entrega</div>${preEntregaHtml}</div>
      </div>
    `;

    const valSync = `<span class="badge ${CLASES_SYNC[f.estadoSync] || "badge-pendiente"}">${ETIQUETAS_SYNC[f.estadoSync] || f.estadoSync}</span>`;

    return `
      <div class="detalle-card">
        <div class="detalle-card-titulo">Embarque</div>
        <div class="detalle-fila-campos">
          <div class="detalle-campo">
            <div class="detalle-campo-label">Embarque</div>
            <div class="detalle-campo-valor historial-texto">${escapeHtml(f.embarqueId || f.id)}</div>
          </div>
          <div class="detalle-campo">
            <div class="detalle-campo-label">UUID</div>
            <div class="detalle-campo-valor">${celdaUuid(f.uuidEsperado)}</div>
          </div>
          <div class="detalle-campo">
            <div class="detalle-campo-label">RFC receptor</div>
            <div class="detalle-campo-valor historial-texto">${escapeHtml(f.receptorRFCEsperado || "—")}</div>
          </div>
        </div>
      </div>

      <div class="detalle-card">
        <div class="detalle-card-titulo">Validaciones</div>
        <div class="detalle-fila-campos">
          <div class="detalle-campo">
            <div class="detalle-campo-label">Remolque</div>
            <div class="detalle-campo-valor">Caja ${caja}</div>
          </div>
          <div class="detalle-campo">
            <div class="detalle-campo-label">Atención al cliente</div>
            <div class="detalle-campo-valor">${valAtencion}</div>
          </div>
          <div class="detalle-campo">
            <div class="detalle-campo-label">Operaciones</div>
            <div class="detalle-campo-valor">${valOperaciones}</div>
          </div>
          <div class="detalle-campo">
            <div class="detalle-campo-label">Operador 1 y 2</div>
            <div class="detalle-campo-valor">${valOperador}</div>
          </div>
        </div>
      </div>

      <div class="detalle-card">
        <div class="detalle-card-titulo">Sincronización</div>
        <div class="detalle-fila-campos">
          <div class="detalle-campo">
            <div class="detalle-campo-label">Estado</div>
            <div class="detalle-campo-valor">${valSync}</div>
          </div>
        </div>
      </div>
    `;
  }

  function renderHistorial() {
    if (listaHistorial.length === 0) {
      tbodyHistorial.innerHTML = `<tr><td colspan="${mostrarColumnaAcciones ? 3 : 2}">Todavía no hay escaneos de origen.</td></tr>`;
      return;
    }
    const resultadosPorIdHistorial = new Map(listaResultados.map(r => [r.id, r]));
    tbodyHistorial.innerHTML = listaHistorial.map(f => {
      const cajaTexto = escapeHtml((f.origenEscaneo && f.origenEscaneo.caja) || "—");
      // "OK"/"No coincide" aquí es si la CAJA escaneada coincidió con la
      // esperada — nada que ver con sincronización (2026-09-14, aclarado a
      // pedido de Ivan porque se prestaba a confusión con el badge de
      // Sincronización que había al lado). El title deja claro de qué se
      // trata sin tener que adivinar ni abrir el detalle.
      const cajaBadge = badgeSiNo(
        f.origenEscaneo && f.origenEscaneo.cajaCoincide,
        "OK", "No coincide",
        "La caja escaneada coincide con la esperada — no es el estado de sincronización",
        "La caja escaneada NO coincide con la esperada"
      );
      const r = resultadosPorIdHistorial.get(f.id);

      const hayAccionesNormales = puedeCorregir || puedeReasignar(f);
      const tieneAcciones = hayAccionesNormales || esAdmin;

      // Sincronización (2026-09-14, pedido de Ivan: ya no columna propia,
      // "robaba espacio") — mismo tratamiento que ya usaba "Seguimiento de
      // embarques": el nombre del embarque cambia de color según
      // claseYTituloSync (verde = sincronizado, rojo = error, gris =
      // cualquier otro caso normal). El detalle completo sigue disponible
      // en el modal (tarjeta "Sincronización").
      const syncInfo = claseYTituloSync(f.estadoSync);

      return `
      <tr data-id="${f.id}">
        <td>
          <button type="button" class="historial-emb-btn" title="Ver detalle completo">
            <span class="historial-texto ${syncInfo.clase}" title="${escapeHtml(syncInfo.titulo)}">${escapeHtml(f.embarqueId || f.id)}</span>
            <span class="celda-embarque-meta">Caja ${cajaTexto}${cajaBadge}</span>
          </button>
        </td>
        <td>${celdaProgreso(f, r)}</td>
        ${mostrarColumnaAcciones ? `<td class="historial-td-acciones">
              ${tieneAcciones ? `
              <div class="historial-menu-wrap">
                <button type="button" class="historial-menu-btn" title="Más acciones">⋮</button>
                <div class="historial-menu">
                  ${puedeCorregir ? `<button type="button" class="secundario btn-corregir-origen">${ICONO_LAPIZ}Corregir origen</button>` : ""}
                  ${puedeReasignar(f) ? `<button type="button" class="secundario btn-reasignar-operador" title="Cambia quién es el operador asignado a este embarque">${ICONO_SWAP}Reasignar operador</button>` : ""}
                  ${esAdmin ? `${hayAccionesNormales ? `<hr class="historial-menu-hr"><div class="historial-menu-admin-label">Solo admin</div>` : ""}<button type="button" class="peligro btn-reiniciar-flujo" title="Borra el escaneo, la 2da validación y el operador asignado — el embarque vuelve a pendiente para Atención al Cliente.">${ICONO_REINICIAR}Reiniciar flujo…</button><button type="button" class="peligro btn-borrar-prueba" title="Borra este embarque por completo en ADREMATASA y en Alanis Operadores. No es reversible.">${ICONO_BASURA}Borrar embarque</button>` : ""}
                </div>
              </div>` : ""}
            </td>` : ""}
      </tr>
    `;
    }).join("");

    // Detalle (2026-09-14) — clic en el nombre del embarque abre el modal
    // de solo lectura con todo el registro organizado en 3 grupos.
    tbodyHistorial.querySelectorAll(".historial-emb-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.closest("tr").dataset.id;
        const f = listaHistorial.find(x => x.id === id);
        if (f) abrirModalDetalleHistorial(id, f);
      });
    });

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

    if (puedeValidar2) {
      tbodyHistorial.querySelectorAll(".btn-reasignar-operador").forEach(btn => {
        btn.addEventListener("click", () => {
          const id = btn.closest("tr").dataset.id;
          const f = listaHistorial.find(x => x.id === id);
          if (f) abrirModalReasignarOperador(id, f);
        });
      });
    }

    // Copiar UUID completo (2026-09-14) — ver celdaUuid().
    tbodyHistorial.querySelectorAll(".uuid-chip-copiar").forEach(btn => {
      btn.addEventListener("click", async () => {
        const valor = btn.dataset.uuid || "";
        if (!valor || !navigator.clipboard) return;
        try {
          await navigator.clipboard.writeText(valor);
          const original = btn.textContent;
          btn.textContent = "Copiado";
          btn.disabled = true;
          setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1200);
        } catch (err) {
          // Sin permiso de portapapeles (o contexto no seguro) — no rompemos
          // el flujo, el UUID completo sigue visible en el tooltip (title).
        }
      });
    });

    // Menú de acciones agrupadas (2026-09-14): mismo truco que ya usa el
    // combobox de operador (mousedown con preventDefault dentro del menú)
    // para no necesitar un listener global de "clic afuera" — el botón
    // pierde el foco (blur) al hacer clic en cualquier otro lado y el menú
    // se cierra solo.
    tbodyHistorial.querySelectorAll(".historial-menu-btn").forEach(btn => {
      const menu = btn.nextElementSibling;
      if (!menu) return;
      btn.addEventListener("click", () => {
        const yaAbierto = menu.classList.contains("abierto");
        tbodyHistorial.querySelectorAll(".historial-menu.abierto").forEach(m => m.classList.remove("abierto"));
        menu.classList.toggle("abierto", !yaAbierto);
      });
      btn.addEventListener("blur", () => {
        setTimeout(() => menu.classList.remove("abierto"), 120);
      });
      menu.addEventListener("mousedown", (e) => e.preventDefault());
    });

    // ------------------------------------------------------------------
    // Borrado de prueba — TEMPORAL, solo mientras dure esta fase de
    // pruebas con McCain en pausa (2026-09-08). Solo admin lo ve. Este
    // botón NO borra nada directamente (las reglas de Firestore siguen sin
    // permitir el delete a ningún navegador, en ninguno de los dos
    // proyectos) — solo escribe una solicitud en solicitudes_borrado_prueba
    // que el Apps Script procesa en su siguiente ciclo (o de inmediato si
    // alguien corre sync() a mano), borrando el embarque completo tanto
    // aquí (verificaciones_cfdi_local / embarques_pendientes_origen) como
    // en repositorio_mccain (Alanis Operadores).
    //
    // QUITAR este bloque cuando termine la fase de pruebas: wireBorrarPrueba(),
    // sus llamadas en renderHistorial/renderPendientesOrigen, los botones
    // correspondientes, la función procesarSolicitudesBorradoPrueba_() en
    // Codigo.gs y el match /solicitudes_borrado_prueba/ de firestore.rules.
    // ------------------------------------------------------------------
    if (esAdmin) wireBorrarPrueba(tbodyHistorial, () => listaHistorial);

    // Reiniciar flujo (2026-09-14) — abre el modal de confirmación con el
    // checklist de lo que se va a borrar para ESE embarque en particular.
    tbodyHistorial.querySelectorAll(".btn-reiniciar-flujo").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.closest("tr").dataset.id;
        const f = listaHistorial.find(x => x.id === id);
        if (f) abrirModalReiniciarFlujo(id, f);
      });
    });
  }

  // Engancha el botón "Borrar" dentro de un <tbody> ya dibujado.
  // listaFn() debe devolver el arreglo de embarques de esa tabla en ESE
  // momento (no una copia vieja), para poder mostrar el embarqueId en la
  // confirmación aunque la tabla se haya vuelto a dibujar entre medio.
  function wireBorrarPrueba(tbody, listaFn) {
    tbody.querySelectorAll(".btn-borrar-prueba").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.closest("tr").dataset.id;
        const item = listaFn().find(x => x.id === id);
        const etiqueta = (item && (item.embarqueId || item.shipment)) || id;
        const confirmado = window.confirm(
          `¿Borrar por completo el embarque ${etiqueta}?\n\n` +
          `Esto lo elimina de ADREMATASA y de Alanis Operadores (repositorio_mccain). ` +
          `No es reversible, y no es instantáneo: se ejecuta en el siguiente ciclo de ` +
          `sincronización (o de inmediato si alguien corre sync() a mano).\n\n` +
          `Esta acción es definitiva y no se puede deshacer — verifica que sea el embarque correcto antes de continuar.`
        );
        if (!confirmado) return;
        btn.disabled = true;
        try {
          await setDoc(doc(db, "solicitudes_borrado_prueba", id), {
            embarqueId: id,
            solicitadoPor: uid,
            timestamp: serverTimestamp()
          });
          btn.textContent = "Solicitado ✓";
        } catch (e) {
          btn.disabled = false;
          window.alert("No se pudo solicitar el borrado: " + e.message);
        }
      });
    });
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
  // Fila "UUID leído / RFC receptor leído" — no aplica en el flujo de
  // asignar operador + generar QR sin factura (2026-09-12, ver
  // abrirModalAsignarOperadorSinFactura), así que se puede ocultar.
  const modalLecturaCfdiWrap = contenedor.querySelector("#modal-lectura-cfdi-wrap");
  const inputConfirmarCaja = contenedor.querySelector("#modal-confirmar-caja");
  const operadorWrapDiv = contenedor.querySelector("#modal-operador-wrap");
  // #modal-confirmar-operador conserva el mismo id de siempre, ahora en un
  // <input type="hidden"> — así guardarEscaneo() (más abajo) sigue leyendo
  // selectOperador.value sin ningún cambio. El buscador tipo LIKE vive en
  // los dos elementos de al lado (ver bloque "Buscador de operador" más
  // abajo, junto al de QR interno).
  const selectOperador = contenedor.querySelector("#modal-confirmar-operador");
  const inputBuscarOperador = contenedor.querySelector("#modal-confirmar-operador-buscar");
  const listaOperadorEl = contenedor.querySelector("#combo-operador-lista");
  const confirmarErrorDiv = contenedor.querySelector("#modal-confirmar-error");
  const botonesModo = contenedor.querySelectorAll(".subnav-boton[data-modo]");
  const botonGuardar = contenedor.querySelector("#modal-confirmar-guardar");
  const botonVolverEscanear = contenedor.querySelector("#modal-volver-escanear");

  const overlayResultado = contenedor.querySelector("#resultado-escaneo-origen");
  const overlayIcono = contenedor.querySelector("#resultado-escaneo-icono");
  const overlayTitulo = contenedor.querySelector("#resultado-escaneo-titulo");
  const overlayDetalle = contenedor.querySelector("#resultado-escaneo-detalle");
  const overlayDetalle2 = contenedor.querySelector("#resultado-escaneo-detalle2");
  const overlayRegistro = contenedor.querySelector("#resultado-escaneo-registro");
  const botonOverlayContinuar = contenedor.querySelector("#resultado-escaneo-continuar");
  const botonOverlayVolver = contenedor.querySelector("#resultado-escaneo-volver");

  const overlayCorreccionCritica = contenedor.querySelector("#overlay-correccion-critica");
  const textoCorreccionCritica = contenedor.querySelector("#correccion-critica-texto");
  const cajaAnteriorCorreccionCritica = contenedor.querySelector("#correccion-critica-caja-anterior");
  const cajaNuevaCorreccionCritica = contenedor.querySelector("#correccion-critica-caja-nueva");
  const botonCorreccionCriticaEntendido = contenedor.querySelector("#correccion-critica-entendido");

  botonOverlayContinuar.addEventListener("click", () => {
    detenerAlarmaDiscrepancia();
    overlayResultado.classList.add("oculto");
  });
  botonOverlayVolver.addEventListener("click", () => {
    detenerAlarmaDiscrepancia();
    overlayResultado.classList.add("oculto");
    volverAEscanear();
  });

  // "Entendido — ir a re-validar": única forma de cerrar este aviso (no hay
  // clic-afuera ni ESC) — pedido explícito de Ivan ("debe intervenirse el
  // proceso"). Al cerrarlo, marca ese embarque como ya visto en esta
  // sesión, pasa al siguiente de la cola si hay más, y lleva la vista hasta
  // su fila en la tabla de pendientes para que sea obvio qué re-escanear.
  if (botonCorreccionCriticaEntendido) {
    botonCorreccionCriticaEntendido.addEventListener("click", () => {
      const id = overlayCorreccionCritica.dataset.idActual;
      if (id) correccionesCriticasVistas.add(id);
      overlayCorreccionCritica.dataset.abierto = "0";
      colaCorreccionesCriticas.shift();
      overlayCorreccionCritica.classList.add("oculto");
      if (id && tbodyPendientes) {
        const fila = tbodyPendientes.querySelector('tr[data-id="' + id + '"]');
        if (fila && fila.scrollIntoView) fila.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      mostrarSiguienteCorreccionCritica();
    });
  }

  // ---- QR interno para embarques sin factura (2026-09-10) ----
  const modalSinFactura = contenedor.querySelector("#modal-confirmar-sin-factura");
  const infoSinFactura = contenedor.querySelector("#confirmar-sin-factura-info");
  const errorSinFactura = contenedor.querySelector("#confirmar-sin-factura-error");
  const botonCancelarSinFactura = contenedor.querySelector("#confirmar-sin-factura-cancelar");
  const botonGenerarSinFactura = contenedor.querySelector("#confirmar-sin-factura-generar");

  const modalReiniciarFlujo = contenedor.querySelector("#modal-reiniciar-flujo");
  const embarqueReiniciarFlujoSpan = contenedor.querySelector("#reiniciar-flujo-embarque");
  const checklistReiniciarFlujo = contenedor.querySelector("#reiniciar-flujo-checklist");
  const checkboxReiniciarFlujo = contenedor.querySelector("#reiniciar-flujo-entendido");
  const errorReiniciarFlujo = contenedor.querySelector("#reiniciar-flujo-error");
  const botonCancelarReiniciarFlujo = contenedor.querySelector("#reiniciar-flujo-cancelar");
  const botonConfirmarReiniciarFlujo = contenedor.querySelector("#reiniciar-flujo-confirmar");

  const modalDetalleHistorial = contenedor.querySelector("#modal-detalle-historial");
  const embarqueDetalleHistorialSpan = contenedor.querySelector("#detalle-historial-embarque");
  const cuerpoDetalleHistorial = contenedor.querySelector("#detalle-historial-cuerpo");
  const botonCerrarDetalleHistorial = contenedor.querySelector("#detalle-historial-cerrar");

  const overlayQrInterno = contenedor.querySelector("#overlay-qr-interno");
  const infoQrInterno = contenedor.querySelector("#qr-interno-info");
  // Contenedor (no un <canvas>) — la librería qrcodejs dibuja DENTRO de un
  // div que se le pasa, no sobre un canvas que uno ya tenga (ver
  // dibujarQrInterno más abajo).
  const contenedorQrInterno = contenedor.querySelector("#qr-interno-canvas");
  const etiquetaQrInterno = contenedor.querySelector("#qr-interno-etiqueta");
  const operadorQrInterno = contenedor.querySelector("#qr-interno-operador");
  const botonCerrarQrInterno = contenedor.querySelector("#qr-interno-cerrar");
  const botonImprimirQrInterno = contenedor.querySelector("#qr-interno-imprimir");

  // ---- Impresión aislada del QR interno (2026-09-10) ----
  // Se cuelga directo de <body> (no de donde viva #overlay-qr-interno
  // dentro del resto de la app) para poder ocultar TODO lo demás con
  // display:none al imprimir sin quedar adentro de lo que se oculta — ver
  // el bloque @media print de arriba para el detalle del bug que esto
  // corrige (hojas en blanco). Se crea una sola vez y se reutiliza.
  let elImpresionQrInterno = document.getElementById("impresion-qr-interno-root");
  if (!elImpresionQrInterno) {
    elImpresionQrInterno = document.createElement("div");
    elImpresionQrInterno.id = "impresion-qr-interno-root";
    document.body.appendChild(elImpresionQrInterno);
  }
  let qrInternoImpresionActual = null; // { etiqueta } — para el título del documento al imprimir
  let tituloOriginalDocumento = null;

  // ---- Buscador de operador (combobox tipo "LIKE") (2026-09-10) ----
  // Pedido de Ivan: el <select> nativo con todo el catálogo de operadores
  // se hacía interminable para buscar uno a mano. Este combobox filtra en
  // vivo por nombre o número, sin distinguir mayúsculas/acentos.
  let operadoresOrdenadosCache = [];
  let indiceActivoOperador = -1; // fila resaltada con teclado, -1 = ninguna

  function normalizarBusquedaOperador(texto) {
    return (texto || "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  }

  function etiquetaOperador(op) {
    return (op.numero ? op.numero + " — " : "") + (op.nombre || op.id);
  }

  function filtrarOperadores(consulta) {
    const q = normalizarBusquedaOperador(consulta);
    if (!q) return operadoresOrdenadosCache;
    return operadoresOrdenadosCache.filter(op =>
      normalizarBusquedaOperador(op.nombre).includes(q) || normalizarBusquedaOperador(op.numero).includes(q)
    );
  }

  function pintarListaOperador(resultados) {
    if (!listaOperadorEl) return;
    indiceActivoOperador = -1;
    listaOperadorEl.innerHTML = resultados.length
      ? resultados.map(op => `<li data-uid="${op.id}">${escapeHtml(etiquetaOperador(op))}</li>`).join("")
      : '<li class="combo-operador-vacia">Sin coincidencias</li>';
    listaOperadorEl.classList.remove("oculto");
  }

  function abrirListaOperador() {
    if (!inputBuscarOperador) return;
    pintarListaOperador(filtrarOperadores(inputBuscarOperador.value));
  }

  function cerrarListaOperador() {
    if (!listaOperadorEl) return;
    listaOperadorEl.classList.add("oculto");
    indiceActivoOperador = -1;
  }

  function seleccionarOperador(op) {
    selectOperador.value = op.id;
    inputBuscarOperador.value = etiquetaOperador(op);
    confirmarErrorDiv.textContent = "";
    cerrarListaOperador();
  }

  function resaltarOperadorActivo() {
    const items = listaOperadorEl.querySelectorAll("li[data-uid]");
    items.forEach((li, i) => li.classList.toggle("combo-operador-activa", i === indiceActivoOperador));
    const activo = items[indiceActivoOperador];
    if (activo && activo.scrollIntoView) activo.scrollIntoView({ block: "nearest" });
  }

  if (inputBuscarOperador) {
    inputBuscarOperador.addEventListener("focus", abrirListaOperador);
    inputBuscarOperador.addEventListener("input", () => {
      // Cualquier cambio en el texto invalida la selección anterior — hay
      // que elegir de la lista de nuevo (mismo criterio "obligatorio" de
      // guardarEscaneo, que exige selectOperador.value con un operador
      // real del catálogo).
      selectOperador.value = "";
      abrirListaOperador();
    });
    inputBuscarOperador.addEventListener("keydown", (e) => {
      if (!listaOperadorEl) return;
      const items = listaOperadorEl.querySelectorAll("li[data-uid]");
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (listaOperadorEl.classList.contains("oculto")) { abrirListaOperador(); return; }
        indiceActivoOperador = Math.min(indiceActivoOperador + 1, items.length - 1);
        resaltarOperadorActivo();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        indiceActivoOperador = Math.max(indiceActivoOperador - 1, 0);
        resaltarOperadorActivo();
      } else if (e.key === "Enter") {
        e.preventDefault();
        const uidElegido = items[indiceActivoOperador] ? items[indiceActivoOperador].dataset.uid
          : (items.length === 1 ? items[0].dataset.uid : null);
        const op = uidElegido ? listaOperadores.find(o => o.id === uidElegido) : null;
        if (op) seleccionarOperador(op);
      } else if (e.key === "Escape") {
        cerrarListaOperador();
        inputBuscarOperador.blur();
      }
    });
    inputBuscarOperador.addEventListener("blur", () => {
      // Si al salir no quedó una selección válida del catálogo, se limpia
      // el texto — un nombre a medio escribir no cuenta como elegido.
      setTimeout(() => {
        if (!selectOperador.value) inputBuscarOperador.value = "";
        cerrarListaOperador();
      }, 120);
    });
  }
  if (listaOperadorEl) {
    // mousedown (no click) + preventDefault: evita que el input pierda el
    // foco (y dispare su "blur") antes de que el click en la fila llegue a
    // registrarse — así no hace falta un listener global de "clic afuera".
    listaOperadorEl.addEventListener("mousedown", (e) => e.preventDefault());
    listaOperadorEl.addEventListener("click", (e) => {
      const li = e.target.closest("li[data-uid]");
      if (!li) return;
      const op = listaOperadores.find(o => o.id === li.dataset.uid);
      if (op) seleccionarOperador(op);
    });
  }

  let embarqueSinFacturaActual = null; // { id, p } — mientras el modal de confirmación está abierto

  function abrirConfirmacionSinFactura(p, id) {
    embarqueSinFacturaActual = { id, p };
    errorSinFactura.textContent = "";
    infoSinFactura.textContent = `Embarque ${(p && (p.shipment || p.ocCliente)) || id} — ${(p && p.clienteNombre) || "McCain"}, caja ${(p && p.caja) || "—"}.`;
    modalSinFactura.classList.remove("oculto");
  }

  botonCancelarSinFactura.addEventListener("click", () => {
    embarqueSinFacturaActual = null;
    modalSinFactura.classList.add("oculto");
  });

  // Rediseñado 2026-09-12: Atención al Cliente ya NO genera el QR aquí —
  // solo confirma que el embarque no trae factura y lo pasa directo a la
  // cola de segunda validación (Operaciones), quien crea el QR al asignar
  // operador (ver crearQrInternoYAsignarOperador más abajo).
  botonGenerarSinFactura.addEventListener("click", async () => {
    if (!embarqueSinFacturaActual) return;
    const { id, p } = embarqueSinFacturaActual;
    errorSinFactura.textContent = "";
    botonGenerarSinFactura.disabled = true;
    try {
      await setDoc(doc(db, "verificaciones_cfdi_local", id), {
        embarqueId: id,
        estadoSync: "esperando_validacion2",
        esQrInterno: true,
        cajaEsperada: (p && p.caja) || null,
        origenEscaneo: {
          caja: (p && p.caja) || null,
          cajaCoincide: true,
          facturaUuidEsperado: null,
          facturaUuidCoincide: null,
          escaneadoPor: { uid, nombre: datosUsuario.nombre || null, rol: datosUsuario.rol },
          timestamp: serverTimestamp(),
          correccion: null
        }
      });
      modalSinFactura.classList.add("oculto");
      embarqueSinFacturaActual = null;
    } catch (err) {
      errorSinFactura.textContent = "No se pudo confirmar: " + err.message;
    } finally {
      botonGenerarSinFactura.disabled = false;
    }
  });

  // ------------------------------------------------------------------
  // Reiniciar flujo (2026-09-14, pedido de Ivan) — SOLO ADMIN. Este botón
  // no borra nada directamente: solo crea una solicitud en
  // solicitudes_reinicio_flujo (mismo patrón que "Borrar embarque" más
  // abajo) que procesa la Cloud Function procesarSolicitudReinicioFlujo,
  // la única con permiso real de borrar en los dos proyectos. El checklist
  // se arma con lo que este embarque en concreto tiene registrado — para
  // que el admin vea exactamente qué se pierde, no un texto genérico.
  // ------------------------------------------------------------------
  let embarqueReiniciarFlujoActual = null; // { id, f } — mientras el modal está abierto

  function construirChecklistReiniciarFlujo(f) {
    const items = [];
    if (f.origenEscaneo) {
      items.push(`Atención al cliente — ${(f.origenEscaneo.escaneadoPor && f.origenEscaneo.escaneadoPor.nombre) || "escaneo registrado"}`);
    }
    if (f.validacion2) {
      items.push(`2da validación (Operaciones) — ${(f.validacion2.escaneadoPor && f.validacion2.escaneadoPor.nombre) || "validación registrada"}`);
    }
    if (f.operadorAsignado) {
      items.push(`Operador asignado — ${f.operadorAsignado.nombre || "—"}`);
    }
    if (f.estadoSync && f.estadoSync !== "esperando_validacion2") {
      items.push("Sincronización con Alanis Operadores");
    }
    return items;
  }

  function abrirModalReiniciarFlujo(id, f) {
    embarqueReiniciarFlujoActual = { id, f };
    errorReiniciarFlujo.textContent = "";
    embarqueReiniciarFlujoSpan.textContent = f.embarqueId || id;
    const items = construirChecklistReiniciarFlujo(f);
    checklistReiniciarFlujo.innerHTML = items.length
      ? items.map(t => `<li>${escapeHtml(t)}</li>`).join("")
      : `<li>Este embarque todavía no tiene nada registrado.</li>`;
    checkboxReiniciarFlujo.checked = false;
    botonConfirmarReiniciarFlujo.disabled = true;
    modalReiniciarFlujo.classList.remove("oculto");
  }

  checkboxReiniciarFlujo.addEventListener("change", () => {
    botonConfirmarReiniciarFlujo.disabled = !checkboxReiniciarFlujo.checked;
  });

  botonCancelarReiniciarFlujo.addEventListener("click", () => {
    embarqueReiniciarFlujoActual = null;
    modalReiniciarFlujo.classList.add("oculto");
  });

  botonConfirmarReiniciarFlujo.addEventListener("click", async () => {
    if (!embarqueReiniciarFlujoActual || !checkboxReiniciarFlujo.checked) return;
    const { id } = embarqueReiniciarFlujoActual;
    errorReiniciarFlujo.textContent = "";
    botonConfirmarReiniciarFlujo.disabled = true;
    try {
      await setDoc(doc(db, "solicitudes_reinicio_flujo", id), {
        embarqueId: id,
        solicitadoPor: uid,
        timestamp: serverTimestamp()
      });
      modalReiniciarFlujo.classList.add("oculto");
      embarqueReiniciarFlujoActual = null;
    } catch (err) {
      errorReiniciarFlujo.textContent = "No se pudo solicitar el reinicio: " + err.message;
      botonConfirmarReiniciarFlujo.disabled = false;
    }
  });

  // ------------------------------------------------------------------
  // Detalle de historial (2026-09-14, rediseño pedido por Ivan). Modal de
  // solo lectura — no crea ni borra nada, solo arma el HTML de
  // contenidoDetalleHistorial() con el embarque y su resultado (si ya
  // existe) al momento del clic.
  // ------------------------------------------------------------------
  function abrirModalDetalleHistorial(id, f) {
    const r = listaResultados.find(x => x.id === id);
    embarqueDetalleHistorialSpan.textContent = f.embarqueId || id;
    cuerpoDetalleHistorial.innerHTML = contenidoDetalleHistorial(f, r);
    modalDetalleHistorial.classList.remove("oculto");
  }

  botonCerrarDetalleHistorial.addEventListener("click", () => {
    modalDetalleHistorial.classList.add("oculto");
  });

  // operadorNombre (2026-09-12, opcional): se muestra como texto visible en
  // pantalla y en el documento impreso — NUNCA se codifica dentro del QR
  // (parsearQR() sigue leyendo solo id/rr, sin cambios; el candado de
  // identidad del operador se valida contra operadorAsignado en Firestore,
  // no contra lo impreso en el papel).
  function mostrarQrInterno(datosQr, id, p, operadorNombre) {
    const etiqueta = (p && (p.shipment || p.ocCliente)) || id;
    infoQrInterno.textContent = `Embarque ${etiqueta} — ${(p && p.clienteNombre) || "McCain"}, caja ${(p && p.caja) || "—"}. Este código reemplaza el QR de la factura (que no existe para este embarque).`;
    etiquetaQrInterno.textContent = `SIN-FACTURA · ${etiqueta}`;
    if (operadorQrInterno) {
      operadorQrInterno.textContent = operadorNombre ? `Operador asignado: ${operadorNombre}` : "";
      operadorQrInterno.classList.toggle("oculto", !operadorNombre);
    }
    qrInternoImpresionActual = { etiqueta, operadorNombre: operadorNombre || null };
    dibujarQrInterno(datosQr.texto);
    overlayQrInterno.classList.remove("oculto");
  }

  // Instancia de qrcodejs reutilizada entre generaciones (evita que se
  // vayan acumulando QR viejos dentro del mismo contenedor cada vez que se
  // abre este overlay) — se crea la primera vez, después solo se llama
  // .makeCode() para cambiar el texto.
  let instanciaQrInterno = null;

  function dibujarQrInterno(texto) {
    contenedorQrInterno.innerHTML = "";
    if (typeof window.QRCode === "undefined") {
      // Librería de generación de QR no cargada — ver nota de despliegue
      // (falta agregar el <script> de la librería qrcodejs en el HTML,
      // igual que ya está agregado el de Html5Qrcode para leer — son dos
      // librerías distintas, una lee QR y la otra los genera). Sin ella no
      // hay forma de dibujar el código, pero al menos se deja el texto
      // visible para poder copiarlo/depurar mientras tanto.
      instanciaQrInterno = null;
      const aviso = document.createElement("p");
      aviso.style.cssText = "color:#c8362a;font-size:12px;text-align:left;line-height:1.5;";
      aviso.textContent = "No se pudo cargar el generador de QR. Revisa que la librería 'qrcodejs' esté agregada en el HTML. Texto del código: " + texto;
      contenedorQrInterno.appendChild(aviso);
      return;
    }
    // qrcodejs (davidshimjs) dibuja DENTRO del contenedor que se le pasa —
    // no existe un método para "redibujar sobre un canvas ya existente"
    // como en otras librerías, así que si ya había una instancia (de un QR
    // anterior) simplemente se descarta y se crea una nueva sobre el
    // contenedor recién vaciado arriba.
    instanciaQrInterno = new window.QRCode(contenedorQrInterno, {
      text: texto,
      width: 220,
      height: 220,
      colorDark: "#1c1a17",
      colorLight: "#ffffff",
      correctLevel: window.QRCode.CorrectLevel.M
    });
  }

  botonCerrarQrInterno.addEventListener("click", () => {
    overlayQrInterno.classList.add("oculto");
  });

  // Arma la tarjeta que de verdad se imprime, aparte del overlay que se ve
  // en pantalla (ver #impresion-qr-interno-root arriba). Reutiliza la
  // imagen ya dibujada por qrcodejs (clonando el contenedor — la librería
  // deja un <img> con el QR ya convertido a data URL adentro, así que
  // clonarlo alcanza, no hace falta volver a generar el código).
  function prepararImpresionQrInterno() {
    elImpresionQrInterno.innerHTML = "";
    const tarjeta = document.createElement("div");
    tarjeta.className = "qr-interno-tarjeta qr-interno-tarjeta-impresion";
    const h2 = document.createElement("h2");
    h2.textContent = "SIN FACTURA — CONTROL INTERNO";
    const info = document.createElement("p");
    info.textContent = infoQrInterno.textContent;
    const imagenWrap = document.createElement("div");
    imagenWrap.className = "qr-interno-imagen-wrap";
    // Clona el contenedor ya dibujado por qrcodejs (deja un <img> con el QR
    // como data URL adentro, así que clonarlo alcanza — no hace falta
    // volver a generar el código). Se le quita el id para no dejar dos
    // elementos con el mismo #qr-interno-canvas en el documento a la vez.
    const clonImagenQr = contenedorQrInterno.cloneNode(true);
    clonImagenQr.removeAttribute("id");
    imagenWrap.appendChild(clonImagenQr);
    const etiquetaImpresa = document.createElement("div");
    etiquetaImpresa.className = "qr-interno-etiqueta-impresa";
    etiquetaImpresa.textContent = etiquetaQrInterno.textContent;
    tarjeta.appendChild(h2);
    tarjeta.appendChild(info);
    tarjeta.appendChild(imagenWrap);
    tarjeta.appendChild(etiquetaImpresa);
    // Nombre del operador asignado (2026-09-12) — solo texto en el
    // documento impreso, no forma parte de los datos del QR.
    if (qrInternoImpresionActual && qrInternoImpresionActual.operadorNombre) {
      const operadorImpreso = document.createElement("div");
      operadorImpreso.className = "qr-interno-operador-impreso";
      operadorImpreso.textContent = `Operador asignado: ${qrInternoImpresionActual.operadorNombre}`;
      tarjeta.appendChild(operadorImpreso);
    }
    elImpresionQrInterno.appendChild(tarjeta);
  }

  botonImprimirQrInterno.addEventListener("click", () => {
    prepararImpresionQrInterno();
    // Nombre de archivo sugerido al "Guardar como PDF" (2026-09-10, pedido
    // de Ivan: no proponía ningún nombre) — los navegadores usan el
    // <title> del documento como nombre por default en ese diálogo. Antes
    // se quedaba con el título genérico de toda la app (nada relacionado
    // con este embarque); se cambia solo mientras dura la impresión y se
    // restaura después para no afectar la pestaña del navegador.
    tituloOriginalDocumento = document.title;
    const etiqueta = (qrInternoImpresionActual && qrInternoImpresionActual.etiqueta) || "embarque";
    document.title = "QR-interno-" + sanitizarNombreArchivo(etiqueta);
    document.body.classList.add("imprimiendo-qr-interno");
    window.print();
  });
  window.addEventListener("afterprint", () => {
    document.body.classList.remove("imprimiendo-qr-interno");
    if (tituloOriginalDocumento !== null) {
      document.title = tituloOriginalDocumento;
      tituloOriginalDocumento = null;
    }
  });

  let embarqueActual = null;
  let modoActual = "origen"; // "origen" | "correccion" | "validacion2"
  let datosLeidos = null;
  let lectorQR = null;
  let cajaEsperadaActual = null;
  let uuidEsperadoActual = null;
  let rfcEsperadoActual = null;
  let intervaloAlarmaDiscrepancia = null;
  let wakeLockCentinela = null;

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
  botonVolverEscanear.addEventListener("click", volverAEscanear);
  botonGuardar.addEventListener("click", guardarEscaneo);
  contenedor.querySelector("#modal-escaneo-cancelar").addEventListener("click", cerrarModal);

  // Dibuja las opciones del selector de operador a partir del catálogo
  // sincronizado (operadores_alanis) — se llama tanto cuando llega/cambia el
  // catálogo como al abrir el modal, para que siempre esté al día. Conserva
  // la selección previa si el operador elegido sigue en la lista (por
  // ejemplo, si el catálogo se actualiza mientras el modal ya está abierto).
  function renderSelectorOperador() {
    if (!selectOperador) return;
    operadoresOrdenadosCache = listaOperadores.slice().sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));
    const valorPrevio = selectOperador.value;
    if (valorPrevio && !operadoresOrdenadosCache.some(o => o.id === valorPrevio)) {
      // El operador elegido ya no está en el catálogo (se desactivó, por
      // ejemplo) — se limpia para obligar a elegir de nuevo, en vez de
      // dejar guardado un uid que guardarEscaneo() ya no podría resolver.
      selectOperador.value = "";
      if (inputBuscarOperador) inputBuscarOperador.value = "";
    }
    if (listaOperadorEl && !listaOperadorEl.classList.contains("oculto")) {
      pintarListaOperador(filtrarOperadores(inputBuscarOperador ? inputBuscarOperador.value : ""));
    }
  }

  function volverAEscanear() {
    seccionConfirmar.classList.add("oculto");
    seccionCaptura.classList.remove("oculto");
    confirmarErrorDiv.textContent = "";
    const modoCamaraActivo = contenedor.querySelector('.subnav-boton[data-modo="camara"]').classList.contains("activo");
    if (modoCamaraActivo) iniciarCamara();
  }

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

  // Compara el UUID (y, en 2da validación, el RFC receptor) del CFDI recién
  // leído contra lo que ya se conocía ANTES de escanear — uuidEsperado del
  // registro de Atención al Cliente en modo "validacion2", o la Cadena
  // Original del SAT capturada por el VBA (uuidFactura) en modo "origen".
  // Si uuidEsperadoActual llega vacío (sin referencia todavía) no se
  // bloquea nada — no hay contra qué comparar.
  function evaluarCoincidenciaCfdi(datos) {
    let uuidCoincide = true;
    let rfcCoincide = true;
    if (modoActual === "validacion2") {
      uuidCoincide = datos.uuid === uuidEsperadoActual;
      rfcCoincide = datos.rfc === rfcEsperadoActual;
    } else if (modoActual === "origen" && uuidEsperadoActual) {
      uuidCoincide = datos.uuid === uuidEsperadoActual;
    }
    return { uuidCoincide, rfcCoincide };
  }

  function mensajesCoincidenciaCfdi({ uuidCoincide, rfcCoincide }) {
    const partes = [];
    if (!uuidCoincide) {
      partes.push(
        modoActual === "origen"
          ? "El UUID del CFDI escaneado no coincide con el de la factura de este embarque (según el correo original). Es posible que haya escaneado o adjuntado la factura de otro embarque. Revise e informe a un supervisor."
          : "El UUID del CFDI escaneado no coincide con el que registró Atención al Cliente. Revise que sea la factura correcta e informe a un supervisor."
      );
    }
    if (!rfcCoincide) partes.push("El RFC receptor del CFDI escaneado no coincide con el que registró Atención al Cliente. Revise que sea la factura correcta e informe a un supervisor.");
    return partes;
  }

  async function mostrarConfirmacion(datos) {
    datosLeidos = datos;
    detenerCamara();
    modalErrorDiv.textContent = "";

    // Caso real detectado el 2026-09-03: en modo "origen" el valor de
    // referencia (uuidEsperadoActual) se cachea al ABRIR el modal, pero
    // llega desde Alanis Operadores vía Apps Script (hasta 5 minutos en
    // teoría — en ese caso real, casi 5 horas). Si solo confiáramos en el
    // valor cacheado, el candado se queda CALLADO justo cuando más se
    // necesita: un embarque recién sincronizado, con su factura de
    // referencia todavía en camino, deja pasar cualquier CFDI sin avisar
    // (fue exactamente como se coló un intercambio real de documentos
    // entre dos embarques en una prueba). Por eso aquí se relee fresco
    // directo de Firestore antes de comparar — y si sigue sin haber nada
    // contra qué comparar, se bloquea el guardado (con opción de
    // reintentar) en vez de dejarlo pasar en silencio.
    if (modoActual === "origen") {
      let lectura;
      try {
        const snap = await getDoc(doc(db, "embarques_pendientes_origen", embarqueActual));
        lectura = { ok: true, uuid: snap.exists() ? (snap.data().uuidFactura || null) : null };
      } catch (err) {
        lectura = { ok: false };
      }

      if (!lectura.ok) {
        modalErrorDiv.textContent = "No se pudo verificar la factura de referencia (error de conexión). Vuelve a intentar.";
        iniciarCamara();
        return;
      }

      // Sin factura real (2026-09-10): si no hay Cadena Original del SAT
      // pero SÍ se generó un QR interno para este embarque (ver botón
      // "Generar QR interno" / colección qr_internos_generados), se usa ese
      // UUID sintético como referencia en su lugar. El resto de la
      // comparación (evaluarCoincidenciaCfdi) no distingue entre uno y
      // otro — ambos son solo cadenas de texto.
      //
      // BUG REAL encontrado 2026-09-10 (Ivan lo reprodujo él mismo, incluso
      // forzando refresh de caché, y el "¡Alto! No coincide" seguía
      // saliendo): aquí se estaba leyendo de `listaQrInternos`, el arreglo
      // sincronizado en memoria vía onSnapshot — el MISMO tipo de fuente
      // "posiblemente atrasada" que ya se había identificado como problema
      // el 2026-09-03 para `uuidFactura` (ver el comentario de arriba, que
      // por eso relee fresco con getDoc). Si el listener de
      // qr_internos_generados en el dispositivo que escanea todavía no
      // había recibido el documento (señal débil, o generar e imprimir
      // e ir a escanear en cuestión de segundos), `listaQrInternos` seguía
      // vacío para ese embarque y el flujo caía directo al bloqueo de
      // "Todavía no está disponible..." — pero si justo en ese momento
      // ARRIBA `lectura.uuid` sí tenía algo residual de una lectura previa
      // de otro embarque, o el snapshot estaba a medias, el efecto real
      // observado fue un `uuidEsperadoActual` desalineado → "no coincide".
      // Fix: releer también esta colección directo de Firestore (igual que
      // ya se hace arriba con `embarques_pendientes_origen`), en vez de
      // confiar en el caché del listener — así funciona sin importar qué
      // tan rápido se pase de generar/imprimir a escanear, ni la calidad
      // de la señal del dispositivo que escanea.
      if (!lectura.uuid) {
        try {
          const snapQrInterno = await getDoc(doc(db, "qr_internos_generados", embarqueActual));
          if (snapQrInterno.exists() && snapQrInterno.data().uuid) {
            lectura.uuid = snapQrInterno.data().uuid;
          }
        } catch (err) {
          // Si falla la lectura fresca, se sigue de todas formas con lo que
          // haya en el caché local (mejor que bloquear por un error de red
          // pasajero) — el candado real sigue siendo el bloqueo de abajo.
          const qrInternoCache = listaQrInternos.find(q => q.id === embarqueActual);
          if (qrInternoCache && qrInternoCache.uuid) lectura.uuid = qrInternoCache.uuid;
        }
      }

      if (!lectura.uuid) {
        modalErrorDiv.textContent = "Todavía no está disponible la factura de referencia para este embarque — puede tardar unos minutos en sincronizar desde el correo. Espera un momento e intenta de nuevo; si el correo no trae factura porque es un movimiento interno de McCain, usa el botón \"Generar QR interno\" en la tabla de pendientes en vez de escanear aquí.";
        iniciarCamara();
        return;
      }

      uuidEsperadoActual = lectura.uuid;
    }

    // Rechazo inmediato (propuesta de Ivan, 2026-09-03): si el UUID (y RFC,
    // en 2da validación) ya no coinciden con lo que se esperaba, no tiene
    // caso pedir la caja y hacer avanzar un paso más — ya se sabe, desde el
    // momento mismo del escaneo, que esto no va a pasar. Se bloquea aquí,
    // antes de mostrar la pantalla de captura de caja.
    const coincidenciaAdelantada = evaluarCoincidenciaCfdi(datos);
    if (!coincidenciaAdelantada.uuidCoincide || !coincidenciaAdelantada.rfcCoincide) {
      mostrarAdvertenciaDiscrepancia(mensajesCoincidenciaCfdi(coincidenciaAdelantada));
      return;
    }

    inputConfirmarUuid.value = datos.uuid;
    inputConfirmarRfc.value = datos.rfc;
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

    // Operador asignado (obligatorio solo en 2da validación — decisión de
    // Ivan, 2026-09-07): quien hace la segunda validación ya sabe en ese
    // momento qué operador va a recoger el embarque, así que se captura en
    // el mismo movimiento. No se puede dejar pendiente — sin esto, no se
    // guarda nada (mismo criterio de "bloqueo real" que la caja y el CFDI).
    let operadorAsignado = null;
    if (modoActual === "validacion2" || modoActual === "asignar_operador_sin_factura" || modoActual === "reasignar_operador") {
      const uidOperador = selectOperador ? selectOperador.value : "";
      if (!uidOperador) {
        confirmarErrorDiv.textContent = "Selecciona el operador asignado a este embarque — es obligatorio para poder continuar.";
        return;
      }
      const op = listaOperadores.find(o => o.id === uidOperador);
      if (!op) {
        confirmarErrorDiv.textContent = "Ese operador ya no aparece en el catálogo (¿se desactivó?). Actualiza la lista e intenta de nuevo.";
        return;
      }
      operadorAsignado = { uid: op.id, nombre: op.nombre || null, numero: op.numero || null };
    }

    // El UUID/RFC ya se revisó (y, si fallaba, ya se bloqueó) en cuanto se
    // leyó el QR — ver mostrarConfirmacion(). Esto de aquí es un respaldo,
    // no el chequeo principal: en circunstancias normales ya llega true.
    const { uuidCoincide, rfcCoincide } = evaluarCoincidenciaCfdi(datosLeidos);

    const hayDiscrepancia = (hayCajaEsperada && !cajaCoincide) || !uuidCoincide || !rfcCoincide;

    // Bloqueo real (decisión de Ivan, 2026-09-02): si hay discrepancia, NO
    // se guarda — no existe "confirmar de todas formas". Hay que corregir
    // el escaneo o avisar a un supervisor antes de poder continuar.
    if (hayDiscrepancia) {
      const partes = [];
      if (hayCajaEsperada && !cajaCoincide) partes.push("El remolque capturado no coincide con el asignado para la factura. Revise si capturó un número de caja incorrecto e informe a un supervisor.");
      partes.push(...mensajesCoincidenciaCfdi({ uuidCoincide, rfcCoincide }));
      mostrarAdvertenciaDiscrepancia(partes);
      return;
    }

    botonGuardar.disabled = true;
    try {
      if (modoActual === "correccion") {
        await corregirEscaneo(embarqueActual, { ...datosLeidos, caja: cajaCapturada, cajaCoincide });
      } else if (modoActual === "validacion2") {
        await registrarValidacion2(embarqueActual, { ...datosLeidos, caja: cajaCapturada, cajaCoincide, uuidCoincide, rfcCoincide, operadorAsignado });
      } else if (modoActual === "asignar_operador_sin_factura") {
        // Este modo no "registra un resultado" — CREA el QR interno y de
        // una vez lo muestra para imprimir, en vez de la pantalla genérica
        // de éxito/discrepancia. Se captura embarqueActual ANTES de
        // cerrarModal() porque cerrarModal() lo pone en null.
        const idEmbarqueQr = embarqueActual;
        const pInfo = listaPendientes.find(x => x.id === idEmbarqueQr) || listaHistorial.find(x => x.id === idEmbarqueQr);
        const datosQr = await crearQrInternoYAsignarOperador(idEmbarqueQr, operadorAsignado);
        cerrarModal();
        mostrarQrInterno(datosQr, idEmbarqueQr, pInfo, operadorAsignado.nombre);
        return;
      } else if (modoActual === "reasignar_operador") {
        // Igual que arriba: se captura embarqueActual ANTES de cerrarModal().
        const idEmbarqueReasignado = embarqueActual;
        const resultado = await reasignarOperador(idEmbarqueReasignado, operadorAsignado);
        cerrarModal();
        if (resultado.reimprimir) {
          // Sin factura + Checkpoint 1 todavía no hecho: se reimprime el
          // MISMO QR (mismo uuid/rfc) con el nombre del operador nuevo — no
          // se genera un QR distinto (ver crearQrInternoYAsignarOperador).
          const pInfo = listaPendientes.find(x => x.id === idEmbarqueReasignado) || listaHistorial.find(x => x.id === idEmbarqueReasignado);
          mostrarQrInterno(resultado.datosQr, idEmbarqueReasignado, pInfo, operadorAsignado.nombre);
        } else {
          overlayResultado.classList.remove("oculto", "exito", "discrepancia");
          overlayResultado.classList.add("exito");
          overlayIcono.innerHTML = ICONO_EXITO;
          overlayRegistro.classList.remove("oculto");
          botonOverlayContinuar.classList.remove("oculto");
          botonOverlayVolver.classList.add("oculto");
          overlayTitulo.textContent = "Operador reasignado";
          overlayDetalle.textContent = `Ahora el embarque está asignado a ${operadorAsignado.nombre}.`;
          overlayDetalle2.classList.add("oculto");
          overlayRegistro.textContent = `Reasignado por ${datosUsuario.nombre || "—"} · ${new Date().toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}`;
          reproducirSonido("exito");
          vibrar("exito");
        }
        return;
      } else {
        await registrarEscaneo(embarqueActual, {
          ...datosLeidos, caja: cajaCapturada, cajaCoincide, cajaEsperada: cajaEsperadaActual || null,
          facturaUuidEsperado: uuidEsperadoActual || null,
          facturaUuidCoincide: uuidEsperadoActual ? uuidCoincide : null
        });
      }
      cerrarModal();
      mostrarResultado({ modo: modoActual, cajaCoincide, uuidCoincide, rfcCoincide, caja: cajaCapturada });
    } catch (err) {
      confirmarErrorDiv.textContent = "No se pudo registrar: " + err.message;
    } finally {
      botonGuardar.disabled = false;
    }
  }

  // Advertencia de discrepancia ANTES de guardar — usa la MISMA pantalla
  // completa (roja, con ícono, sonido y vibración) que el resultado final,
  // no un simple textito adentro del modal, para que sea igual de evidente
  // (o más) que la pantalla verde de éxito. Bloquea de verdad (decisión de
  // Ivan, 2026-09-02): no existe "confirmar de todas formas" — si hay
  // discrepancia, no se guarda nada; solo queda "Volver a escanear" para
  // corregir o para ir a avisarle a un supervisor.
  //
  // Límite real de plataforma (no es un bug de este código): ningún sitio
  // web puede saltarse el switch de silencio físico de iPhone ni forzar
  // sonido cuando el volumen del celular está en 0 — eso lo controla el
  // sistema operativo. Y en iPhone (Safari o la app agregada a pantalla de
  // inicio) la vibración del navegador simplemente no existe (no la
  // implementa Apple). Por eso esta pantalla se apoya sobre todo en lo
  // visual — rojo, parpadeo de ícono, texto grande — que es el único canal
  // garantizado en cualquier celular pase lo que pase con el volumen.
  function mostrarAdvertenciaDiscrepancia(partes) {
    overlayResultado.classList.remove("oculto", "exito", "discrepancia");
    overlayResultado.classList.add("discrepancia");
    overlayIcono.innerHTML = ICONO_ALERTA;
    overlayTitulo.textContent = "¡Alto! No coincide";
    overlayDetalle.textContent = partes[0] || "";
    overlayDetalle2.classList.toggle("oculto", partes.length < 2);
    overlayDetalle2.textContent = partes.slice(1).join(" ");
    overlayRegistro.classList.add("oculto");
    overlayRegistro.textContent = "";
    botonOverlayContinuar.classList.add("oculto");
    botonOverlayVolver.classList.remove("oculto");

    detenerAlarmaDiscrepancia();
    reproducirSonido("discrepancia");
    vibrar("discrepancia");
    // Repite el sonido/vibración cada 1.4s mientras la pantalla siga
    // abierta — para que, si el volumen está bajo (no en 0), sea más
    // difícil no notarlo. Se detiene en cuanto tocan cualquiera de los dos
    // botones (ver arriba).
    intervaloAlarmaDiscrepancia = setInterval(() => {
      reproducirSonido("discrepancia");
      vibrar("discrepancia");
    }, 1400);
  }

  function detenerAlarmaDiscrepancia() {
    if (intervaloAlarmaDiscrepancia) {
      clearInterval(intervaloAlarmaDiscrepancia);
      intervaloAlarmaDiscrepancia = null;
    }
  }

  async function pedirWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        wakeLockCentinela = await navigator.wakeLock.request("screen");
      }
    } catch {
      /* si no se puede (batería baja, navegador sin soporte, pestaña no
         visible, etc.) no es crítico — se ignora */
    }
  }

  function soltarWakeLock() {
    if (wakeLockCentinela) {
      wakeLockCentinela.release().catch(() => {});
      wakeLockCentinela = null;
    }
  }

  function mostrarResultado({ modo, cajaCoincide, uuidCoincide, rfcCoincide, caja }) {
    detenerAlarmaDiscrepancia();
    const todoBien = cajaCoincide && uuidCoincide && rfcCoincide;
    const tipo = todoBien ? "exito" : "discrepancia";
    overlayResultado.classList.remove("oculto", "exito", "discrepancia");
    overlayResultado.classList.add(tipo);
    overlayIcono.innerHTML = todoBien ? ICONO_EXITO : ICONO_ALERTA;
    overlayRegistro.classList.remove("oculto");
    botonOverlayContinuar.classList.remove("oculto");
    botonOverlayVolver.classList.add("oculto");

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
    pedirWakeLock(); // evita que la pantalla se apague sola mientras escanean — best-effort
    modalTitulo.textContent = modo === "correccion"
      ? "Corregir CFDI de origen"
      : (modo === "validacion2" ? "Segunda validación (Operaciones)" : "Escanear CFDI de origen");
    modalInfo.textContent = infoTexto || "";
    modalErrorDiv.textContent = "";
    confirmarErrorDiv.textContent = "";
    inputManualUuid.value = "";
    inputManualRfc.value = "";
    // Solo se prellena en modo "correccion" (ahí sí mostramos el valor
    // anterior para poder corregirlo). En "origen" y "validacion2" la caja
    // SIEMPRE debe capturarse a mano — si llega ya escrita, deja de servir
    // como punto de comparación independiente (así fue como se detectó:
    // Daniel la vio precargada al hacer la 2da validación).
    inputConfirmarCaja.value = (modo === "correccion") ? (cajaPrevia || "") : "";
    inputConfirmarCaja.disabled = false;
    // Reset defensivo de lo que solo cambia abrirModalAsignarOperadorSinFactura.
    if (modalLecturaCfdiWrap) modalLecturaCfdiWrap.classList.remove("oculto");
    botonVolverEscanear.classList.remove("oculto");
    botonGuardar.textContent = "Confirmar y registrar";
    if (operadorWrapDiv) operadorWrapDiv.classList.toggle("oculto", modo !== "validacion2");
    if (selectOperador) selectOperador.value = "";
    if (inputBuscarOperador) inputBuscarOperador.value = "";
    cerrarListaOperador();
    if (modo === "validacion2") renderSelectorOperador();
    seccionConfirmar.classList.add("oculto");
    seccionCaptura.classList.remove("oculto");
    botonesModo.forEach(b => b.classList.toggle("activo", b.dataset.modo === "camara"));
    modoCamaraDiv.classList.remove("oculto");
    modoManualDiv.classList.add("oculto");
    modal.classList.remove("oculto");
    iniciarCamara();
  }

  // Sin factura (2026-09-12): Operaciones asigna aquí al operador y, al
  // confirmar, se genera de una vez el QR de control interno — reutiliza el
  // mismo modal de escaneo (mismo combobox de operador ya construido), pero
  // saltando directo a la sección de "confirmar" (no hay nada que escanear:
  // no existe un CFDI real que leer, así que tampoco tiene caso mostrar
  // Cámara/Captura manual ni los campos de UUID/RFC leído).
  function abrirModalAsignarOperadorSinFactura(embarqueId, f) {
    embarqueActual = embarqueId;
    modoActual = "asignar_operador_sin_factura";
    // Valor de relleno para no bloquear el candado inicial de guardarEscaneo()
    // (if (!datosLeidos || !embarqueActual) return;) — este modo no escanea
    // nada, así que uuid/rfc quedan null a propósito.
    datosLeidos = { uuid: null, rfc: null };
    cajaEsperadaActual = null;
    uuidEsperadoActual = null;
    rfcEsperadoActual = null;
    modalTitulo.textContent = "Asignar operador y generar QR (sin factura)";
    modalInfo.textContent = `Embarque ${(f && f.embarqueId) || embarqueId} — ${(f && f.clienteNombre) || "McCain"}. Selecciona el operador asignado — al confirmar se genera el QR de control interno y se abre para imprimir.`;
    modalErrorDiv.textContent = "";
    confirmarErrorDiv.textContent = "";
    inputConfirmarUuid.value = "";
    inputConfirmarRfc.value = "";
    if (modalLecturaCfdiWrap) modalLecturaCfdiWrap.classList.add("oculto");
    // La caja ya se confirmó en la primera validación (Atención al Cliente)
    // — se muestra de referencia, pero ya no se vuelve a capturar a mano.
    inputConfirmarCaja.value = (f && f.origenEscaneo && f.origenEscaneo.caja) || "";
    inputConfirmarCaja.disabled = true;
    botonVolverEscanear.classList.add("oculto");
    botonGuardar.textContent = "Generar QR y confirmar";
    if (operadorWrapDiv) operadorWrapDiv.classList.remove("oculto");
    if (selectOperador) selectOperador.value = "";
    if (inputBuscarOperador) inputBuscarOperador.value = "";
    cerrarListaOperador();
    renderSelectorOperador();
    // Salta directo a la sección de confirmar — no hay captura/escaneo en
    // este flujo.
    seccionCaptura.classList.add("oculto");
    seccionConfirmar.classList.remove("oculto");
    modal.classList.remove("oculto");
  }

  // Reasignación de operador (2026-09-12, decisión de Ivan): disponible
  // para cualquier embarque que ya tenga operadorAsignado, con o sin
  // factura, sin pedir motivo, mientras la pre-entrega no se haya
  // completado (ver puedeReasignar()). Reutiliza el mismo combobox de
  // operador, sin captura/escaneo — salta directo a "confirmar", igual
  // que abrirModalAsignarOperadorSinFactura.
  function abrirModalReasignarOperador(embarqueId, f) {
    embarqueActual = embarqueId;
    modoActual = "reasignar_operador";
    // Valor de relleno para no bloquear el candado inicial de guardarEscaneo()
    // — este modo no escanea nada.
    datosLeidos = { uuid: null, rfc: null };
    cajaEsperadaActual = null;
    uuidEsperadoActual = null;
    rfcEsperadoActual = null;
    const operadorActualNombre = (f.operadorAsignado && f.operadorAsignado.nombre) || "—";
    modalTitulo.textContent = "Reasignar operador";
    modalInfo.textContent = `Embarque ${f.embarqueId || embarqueId} — ${f.clienteNombre || "McCain"}. Operador actual: ${operadorActualNombre}. Selecciona el nuevo operador asignado.`;
    modalErrorDiv.textContent = "";
    confirmarErrorDiv.textContent = "";
    inputConfirmarUuid.value = "";
    inputConfirmarRfc.value = "";
    if (modalLecturaCfdiWrap) modalLecturaCfdiWrap.classList.add("oculto");
    // Solo de referencia — no se vuelve a capturar a mano en este modo.
    inputConfirmarCaja.value = (f.origenEscaneo && f.origenEscaneo.caja) || "";
    inputConfirmarCaja.disabled = true;
    botonVolverEscanear.classList.add("oculto");
    botonGuardar.textContent = "Confirmar reasignación";
    if (operadorWrapDiv) operadorWrapDiv.classList.remove("oculto");
    if (selectOperador) selectOperador.value = "";
    if (inputBuscarOperador) inputBuscarOperador.value = "";
    cerrarListaOperador();
    renderSelectorOperador();
    // Salta directo a la sección de confirmar — no hay captura/escaneo en
    // este flujo.
    seccionCaptura.classList.add("oculto");
    seccionConfirmar.classList.remove("oculto");
    modal.classList.remove("oculto");
  }

  function cerrarModal() {
    detenerCamara();
    detenerAlarmaDiscrepancia();
    soltarWakeLock();
    modal.classList.add("oculto");
    embarqueActual = null;
    datosLeidos = null;
  }

  async function registrarEscaneo(embarqueId, { uuid, rfc, caja, cajaCoincide, cajaEsperada, facturaUuidEsperado, facturaUuidCoincide }) {
    // Si este embarque venía de un QR interno (sin factura, ver arriba), se
    // guarda quién y cuándo lo generó para auditoría — el "create" en
    // firestore.rules solo exige uuidEsperado/receptorRFCEsperado/
    // origenEscaneo; campos extra como estos dos no están restringidos.
    const qrInternoInfo = listaQrInternos.find(q => q.id === embarqueId) || null;

    await setDoc(doc(db, "verificaciones_cfdi_local", embarqueId), {
      embarqueId,
      uuidEsperado: uuid,
      receptorRFCEsperado: rfc,
      estadoSync: "esperando_validacion2",
      cajaEsperada: cajaEsperada || null,
      qrInterno: qrInternoInfo ? { uuid: qrInternoInfo.uuid, rfc: qrInternoInfo.rfc, generadoPor: qrInternoInfo.generadoPor } : null,
      esQrInterno: rfc === RFC_MARCADOR_SIN_FACTURA,
      origenEscaneo: {
        caja: caja || null,
        cajaCoincide,
        // facturaUuidCoincide queda en null cuando no había Cadena Original
        // del SAT capturada todavía (correo sin PDF legible, o embarque de
        // antes del 2026-09-03) — no significa que se haya comparado y
        // fallado, significa que no había nada contra qué comparar.
        facturaUuidEsperado: facturaUuidEsperado || null,
        facturaUuidCoincide: facturaUuidCoincide === undefined ? null : facturaUuidCoincide,
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

  async function registrarValidacion2(embarqueId, { uuid, rfc, caja, cajaCoincide, uuidCoincide, rfcCoincide, operadorAsignado }) {
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
      },
      // Operador que va a recoger este embarque (nuevo, 2026-09-07) — viaja
      // junto con validacion2/estadoSync hacia repositorio_mccain, y es lo
      // que Checkpoint 1 en Alanis Operadores compara contra quien escanea.
      operadorAsignado: {
        uid: operadorAsignado.uid,
        nombre: operadorAsignado.nombre,
        numero: operadorAsignado.numero,
        asignadoPor: uid,
        timestamp: serverTimestamp()
      }
    });
  }

  // Sin factura (2026-09-12): reemplaza a registrarValidacion2 para estos
  // casos — en vez de comparar un escaneo contra un CFDI que no existe,
  // AQUÍ SE CREA el QR interno (mismo formato id/rr de siempre) en el mismo
  // momento en que Operaciones asigna al operador. Devuelve los datos del
  // QR generado para que quien llama pueda mostrarlo/imprimirlo enseguida.
  async function crearQrInternoYAsignarOperador(embarqueId, operadorAsignado) {
    const snap = await getDoc(doc(db, "verificaciones_cfdi_local", embarqueId));
    if (!snap.exists()) throw new Error("No se encontró el embarque.");
    const datosPrevios = snap.data();
    const datosQr = generarDatosQrInterno();

    // Persistido en su propia colección (create-only, ver firestore.rules)
    // — igual que antes, ahora además con el nombre del operador para poder
    // imprimirlo en el documento. OJO: el nombre NUNCA se mete en `texto`
    // (el contenido real del QR) — decisión de diseño 2026-09-12, para que
    // no quede un dato obsoleto grabado en el QR si el operador se
    // reasigna después de imprimir. La identidad se valida siempre contra
    // operadorAsignado en Firestore, nunca contra el documento impreso.
    await setDoc(doc(db, "qr_internos_generados", embarqueId), {
      uuid: datosQr.uuid,
      rfc: datosQr.rfc,
      texto: datosQr.texto,
      motivo: "movimiento_interno_sin_factura",
      generadoPor: { uid, nombre: datosUsuario.nombre || null },
      operadorNombre: operadorAsignado.nombre || null,
      timestamp: serverTimestamp()
    });

    const cajaPrevia = (datosPrevios.origenEscaneo && datosPrevios.origenEscaneo.caja) || null;
    await setDoc(doc(db, "verificaciones_cfdi_local", embarqueId), {
      ...datosPrevios,
      uuidEsperado: datosQr.uuid,
      receptorRFCEsperado: datosQr.rfc,
      estadoSync: "pendiente",
      validacion2: {
        uuidLeido: datosQr.uuid,
        rfcLeido: datosQr.rfc,
        uuidCoincide: true,
        rfcCoincide: true,
        caja: cajaPrevia,
        cajaCoincide: true,
        escaneadoPor: { uid, nombre: datosUsuario.nombre || null, rol: datosUsuario.rol, area: datosUsuario.area || null, puesto: datosUsuario.puesto || null },
        timestamp: serverTimestamp()
      },
      operadorAsignado: {
        uid: operadorAsignado.uid,
        nombre: operadorAsignado.nombre,
        numero: operadorAsignado.numero,
        asignadoPor: uid,
        timestamp: serverTimestamp()
      }
    });

    return datosQr;
  }

  // Reasignación de operador (2026-09-12, decisión de Ivan): disponible para
  // CUALQUIER embarque que ya tenga operadorAsignado, con o sin factura, sin
  // pedir motivo, mientras la pre-entrega (Checkpoint 2) no se haya
  // completado (ver puedeReasignar() — mismo chequeo, ya evaluado antes de
  // mostrar el botón; la regla de Firestore lo vuelve a exigir del lado del
  // servidor). El operador anterior nunca se pierde: queda en
  // historialReasignaciones. Si el embarque es SIN FACTURA y el operador
  // ANTERIOR todavía no había hecho Checkpoint 1 (recepción — verificado
  // contra listaResultados.recepcionResultado, sincronizado desde Alanis
  // Operadores), además se reimprime el MISMO QR ya generado (mismo
  // uuid/rfc — nunca uno nuevo, ver la nota en crearQrInternoYAsignarOperador
  // sobre por qué el nombre del operador no vive dentro del QR) con el
  // nombre del operador nuevo. Si Checkpoint 1 ya se hizo, el papel se queda
  // como está — decisión explícita de Ivan (2026-09-12).
  async function reasignarOperador(embarqueId, nuevoOperador) {
    const snap = await getDoc(doc(db, "verificaciones_cfdi_local", embarqueId));
    if (!snap.exists()) throw new Error("No se encontró el embarque.");
    const datosPrevios = snap.data();
    const operadorAnterior = datosPrevios.operadorAsignado || null;

    const historialPrevio = Array.isArray(datosPrevios.historialReasignaciones) ? datosPrevios.historialReasignaciones : [];
    const nuevaEntrada = {
      operadorAnterior: operadorAnterior ? { uid: operadorAnterior.uid, nombre: operadorAnterior.nombre } : null,
      operadorNuevo: { uid: nuevoOperador.uid, nombre: nuevoOperador.nombre },
      reasignadoPor: uid,
      // OJO: Firestore no permite serverTimestamp() dentro de un arreglo —
      // se usa la hora del navegador solo para esta entrada de historial. El
      // timestamp "oficial" de la reasignación vive en
      // operadorAsignado.timestamp (fuera del arreglo) y sí es serverTimestamp().
      timestamp: new Date()
    };

    await setDoc(doc(db, "verificaciones_cfdi_local", embarqueId), {
      ...datosPrevios,
      operadorAsignado: {
        uid: nuevoOperador.uid,
        nombre: nuevoOperador.nombre,
        numero: nuevoOperador.numero,
        asignadoPor: uid,
        timestamp: serverTimestamp()
      },
      historialReasignaciones: [...historialPrevio, nuevaEntrada],
      // NUEVO (2026-09-13): sin esto, ni Codigo.gs ni la Cloud Function
      // sincronizarOrigenNuevos detectan el cambio — las dos solo reaccionan
      // cuando el documento, tras el escrito, queda con estadoSync ==
      // 'pendiente'. Sin este campo, el operadorAsignado nuevo nunca
      // llegaba a repositorio_mccain en Alanis Operadores.
      estadoSync: "pendiente"
    });

    const r = listaResultados.find(x => x.id === embarqueId);
    const checkpoint1YaHecho = !!(r && r.recepcionResultado);
    const esSinFactura = datosPrevios.esQrInterno === true;

    if (esSinFactura && !checkpoint1YaHecho) {
      const qrSnap = await getDoc(doc(db, "qr_internos_generados", embarqueId));
      if (qrSnap.exists()) {
        const datosQrExistente = qrSnap.data();
        await setDoc(doc(db, "qr_internos_generados", embarqueId), {
          operadorNombre: nuevoOperador.nombre || null
        }, { merge: true });
        return { reimprimir: true, datosQr: datosQrExistente };
      }
    }
    return { reimprimir: false };
  }
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto || "";
  return div.innerHTML;
}