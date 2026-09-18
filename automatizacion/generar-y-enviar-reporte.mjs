// Correo automático de los jueves: genera el mismo PDF de 2 páginas
// (REPORTE RH + REPORTE NOMINAS) que ya arma js/reportes.js en el
// navegador — usando exactamente el mismo módulo (js/reportesHtml.js), para
// que el formato nunca se desincronice entre el botón "VISTA PREVIA /
// IMPRIMIR" y este envío automático — y lo manda por correo sin que nadie
// abra la app. Corre en GitHub Actions (ver
// .github/workflows/reporte-semanal.yml), NO en Firebase — el plan Spark no
// tiene Cloud Functions con disparador programado (cron), así que GitHub
// Actions hace ese papel gratis.
//
// --- Piezas que usa ---
// 1. Firebase Admin SDK: lee Firestore con una cuenta de servicio (no pasa
//    por firestore.rules — tiene acceso total de administrador, como
//    corresponde a un reporte de nómina). Ver más abajo "Cómo dejarlo
//    funcionando" para cómo generar y guardar esa cuenta de servicio.
// 2. Playwright + Chromium headless: renderiza el HTML del reporte a PDF
//    exactamente igual que cuando alguien usa "Imprimir / Guardar como PDF"
//    en el navegador (misma librería de render, mismo @page CSS con la
//    página de nóminas en horizontal).
// 3. Brevo (https://www.brevo.com): manda el correo con el PDF adjunto.
//    Se eligió sobre EmailJS porque el plan gratis de EmailJS NO permite
//    adjuntos (solo a partir de su plan de pago) — Brevo sí, gratis, hasta
//    300 correos/día, y solo pide verificar un correo (sin DNS ni acceso de
//    administrador de dominio).
//
// --- Por qué corre varias veces y no una sola, y cómo decide cuándo mandar ---
// GitHub Actions solo programa cron en UTC, pero Nuevo Laredo cambia de
// UTC-6 a UTC-5 con el horario de verano (igual que Texas) — un cron fijo
// en UTC se desfasaría 1 hora dos veces al año. Por eso el workflow dispara
// varias veces alrededor de las 6pm (ver el workflow) en vez de una sola.
//
// Al principio este script decidía "hago algo" solo si la hora coincidía
// EXACTAMENTE con las 6pm — cualquier otro disparo salía sin hacer nada.
// Eso resultó frágil: GitHub Actions no garantiza puntualidad en `schedule`,
// y se observó (17-18 sep 2026) que puede atrasar TODOS los disparos de la
// semana varias horas, incluso hasta después de la medianoche — si ninguno
// cae justo en la hora exacta, no se manda nada esa semana.
//
// Ahora la pregunta ya no es "¿son exactamente las 6pm?" sino "¿ya pasaron
// las 6pm del jueves de esta semana, Y esa semana TODAVÍA no se mandó?" —
// ver `yaSeEnvioEstaSemana` y el uso de `reportesSemanaEnviados` en
// Firestore más abajo. Así el primer disparo que llegue dentro de esa
// ventana (puntual o con horas de retraso) manda el reporte, y cualquier
// disparo posterior lo encuentra ya enviado y no hace nada — sin depender de
// que GitHub sea puntual, y sin arriesgar mandarlo dos veces.
//
// --- Cómo dejarlo funcionando (una sola vez) ---
// Necesitas crear 4 "Secrets" en GitHub: Settings → Secrets and variables →
// Actions → New repository secret. Nunca pongas estos valores directo en el
// código ni los subas al repo.
//
//   FIREBASE_SERVICE_ACCOUNT
//     Firebase Console → engranaje (Configuración del proyecto) →
//     Cuentas de servicio → "Generar nueva clave privada". Descarga el
//     archivo .json y pega TODO su contenido (tal cual, con llaves y todo)
//     como el valor de este secret.
//
//   BREVO_API_KEY
//     Crea una cuenta gratis en https://www.brevo.com (no pide tarjeta).
//     Settings → SMTP & API → API Keys → Generate a new API key.
//
//   BREVO_SENDER_EMAIL
//     En Brevo: Settings → Senders, Domains & Dedicated IPs → Senders →
//     Add a sender, con el correo que va a aparecer como remitente (puede
//     ser tu propio correo @alanis.com.mx). Te llega un correo de
//     confirmación a esa bandeja — dale clic al link y ya queda verificado
//     (no pide DNS). Pon ese mismo correo como valor de este secret.
//
//   DESTINATARIOS_REPORTE  (opcional — ver nota abajo)
//   DESTINATARIOS_CC        (opcional)
//     Estos dos secrets son ahora solo un RESPALDO. Los destinatarios reales se
//     editan desde la app: Configuración → "Reporte semanal de nómina (correo
//     automático)" (se guardan en Firestore, en configuracion/reporteSemanal).
//     Si ese documento no existe o está vacío, el script usa estos secrets en su
//     lugar — por eso conviene dejarlos configurados la primera vez, igual con
//     correos separados por coma, ej: nominas@alanis.com.mx,rh@alanis.com.mx
//
// Con los secrets guardados, el workflow ya puede correr — tanto en su
// horario (jueves) como a mano desde la pestaña "Actions" del repo (botón
// "Run workflow", con la casilla "Forzar envío" si quieres probarlo sin
// esperar al jueves — el forzado ignora tanto la ventana de horario como el
// chequeo de "ya se envió", así siempre puedes reenviar a propósito).
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { chromium } from "playwright";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import {
  calcularSemanaLaboral, sumarDias, numeroSemanaISO, formatearFechaLargaCap,
  construirPaginaRH, construirPaginaNomina, construirHtmlReporteCompleto,
  idsIncluidosEnReporte
} from "../public/js/reportesHtml.js";

const ZONA_HORARIA = "America/Matamoros"; // Nuevo Laredo, Tamps. — frontera con horario de verano tipo EU.
const HORA_OBJETIVO = 18; // 6:00 pm hora de Nuevo Laredo.
// Hasta qué hora de la madrugada siguiente un disparo tardío todavía cuenta
// como "el de esta semana" (ver el porqué completo arriba). Después de esta
// hora, un disparo sin `forzar` espera a la semana siguiente — nada se
// pierde de todas formas, porque lo no enviado aparece como "Pendientes de
// semanas anteriores" en el próximo reporte (ver js/reportesHtml.js).
const HORA_LIMITE_MADRUGADA = 6;

const __dirname = dirname(fileURLToPath(import.meta.url));

function variableRequerida(nombre) {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(`Falta configurar el secret "${nombre}" en GitHub (Settings → Secrets and variables → Actions).`);
  }
  return valor;
}

// "Ahora" convertido a la hora de Nuevo Laredo, como { fechaStr: "yyyy-mm-dd", hora, minuto } —
// usando Intl en vez de matemática manual de UTC±offset para que el cambio
// de horario de verano lo resuelva el propio sistema de zonas horarias
// (IANA), no un número fijo que haya que acordarse de cambiar.
function ahoraEnNuevoLaredo() {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA_HORARIA,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(new Date());
  const obtener = (tipo) => partes.find(p => p.type === tipo).value;
  return {
    fechaStr: `${obtener("year")}-${obtener("month")}-${obtener("day")}`,
    hora: Number(obtener("hour")),
    minuto: Number(obtener("minute"))
  };
}

// ¿Ya se mandó el reporte de esta semana laboral (identificada por su
// viernes) en un disparo anterior? Independiente de `enviadoANominaEn` en
// cada solicitud/falta/vacación individual — esas se quedan sin tocar en una
// semana sin NADA aprobado, así que por sí solas no bastan para saber si el
// reporte (aunque sea uno vacío) ya salió. `reportesSemanaEnviados/{viernes}`
// es la fuente de verdad de "esta semana ya se mandó", se escriba lo que se
// escriba (o no se escriba nada) en las colecciones de solicitudes.
async function yaSeEnvioEstaSemana({ db, viernes }) {
  const snap = await db.collection("reportesSemanaEnviados").doc(viernes).get();
  return snap.exists;
}

async function main() {
  const forzar = process.env.FORZAR_ENVIO === "true";
  const ahora = ahoraEnNuevoLaredo();

  // --- 1. Firestore vía Admin SDK (se necesita desde ya para el chequeo de "¿ya se envió?") ---
  const credencial = JSON.parse(variableRequerida("FIREBASE_SERVICE_ACCOUNT"));
  const appFirebase = initializeApp({ credential: cert(credencial) });
  const db = getFirestore(appFirebase);

  // --- 2. ¿A qué semana laboral corresponde este disparo, y ya toca mandarla? ---
  //
  // "fechaEfectiva" corrige el disparo que cruza la medianoche: si son las
  // 00:30 del viernes, en la práctica sigue siendo "anoche jueves" para
  // efectos de qué semana se está reportando — sin este ajuste,
  // calcularSemanaLaboral vería el viernes como el inicio de la semana
  // SIGUIENTE, y este disparo se pondría a evaluar (y hasta podría marcar
  // como enviada) la semana equivocada, la que apenas está empezando.
  const fechaEfectiva = ahora.hora < HORA_LIMITE_MADRUGADA ? sumarDias(ahora.fechaStr, -1) : ahora.fechaStr;
  const viernes = calcularSemanaLaboral(fechaEfectiva);
  const jueves = sumarDias(viernes, 6);
  const numeroSemana = numeroSemanaISO(jueves);

  if (!forzar) {
    const esJuevesEfectivo = new Date(fechaEfectiva + "T00:00:00Z").getUTCDay() === 4; // 4 = jueves
    const dentroDeVentana = ahora.hora >= HORA_OBJETIVO || ahora.hora < HORA_LIMITE_MADRUGADA;
    if (!esJuevesEfectivo || !dentroDeVentana) {
      console.log(`Son las ${String(ahora.hora).padStart(2, "0")}:${String(ahora.minuto).padStart(2, "0")} del ${ahora.fechaStr} en Nuevo Laredo — todavía no toca enviar (la ventana arranca el jueves a las ${HORA_OBJETIVO}:00 y sigue abierta hasta las ${String(HORA_LIMITE_MADRUGADA).padStart(2, "0")}:00 del día siguiente). No se manda nada en este disparo.`);
      return;
    }
    if (await yaSeEnvioEstaSemana({ db, viernes })) {
      console.log(`El reporte de la semana ${numeroSemana} (viernes ${viernes}) ya se había mandado en un disparo anterior de esta misma ventana — no se manda de nuevo.`);
      return;
    }
    console.log(`Son las ${String(ahora.hora).padStart(2, "0")}:${String(ahora.minuto).padStart(2, "0")} del ${ahora.fechaStr} en Nuevo Laredo, semana ${numeroSemana} todavía sin enviar — generando y mandando el reporte.`);
  } else {
    console.log("Envío forzado manualmente (workflow_dispatch) — se ignora la ventana de horario y el chequeo de \"ya se envió\".");
  }

  // --- 3. Leer el resto de Firestore ---
  const [snapHoras, snapVacaciones, snapFaltas, snapUsuarios] = await Promise.all([
    db.collection("solicitudes").get(),
    db.collection("solicitudesVacaciones").get(),
    db.collection("faltas").get(),
    db.collection("usuarios").get()
  ]);
  const listaHoras = snapHoras.docs.map(d => ({ id: d.id, ...d.data() }));
  const listaVacaciones = snapVacaciones.docs.map(d => ({ id: d.id, ...d.data() }));
  const listaFaltas = snapFaltas.docs.map(d => ({ id: d.id, ...d.data() }));
  const mapUsuarios = new Map(snapUsuarios.docs.map(d => [d.id, d.data()]));
  console.log(`Leído de Firestore: ${listaHoras.length} solicitudes de horas extra, ${listaVacaciones.length} de vacaciones, ${listaFaltas.length} faltas, ${mapUsuarios.size} usuarios.`);
  console.log(`Semana laboral ${numeroSemana}: del ${viernes} al ${jueves}.`);

  // --- 4. Armar el HTML del reporte (mismo módulo que usa el navegador) ---
  const logoBuffer = readFileSync(join(__dirname, "..", "public", "img", "logo-alanis.png"));
  const logoSrc = `data:image/png;base64,${logoBuffer.toString("base64")}`;

  const paginaRH = construirPaginaRH({ listaHoras, mapUsuarios, viernes, jueves, numeroSemana, logoSrc });
  const paginaNomina = construirPaginaNomina({ listaHoras, listaVacaciones, listaFaltas, mapUsuarios, viernes, jueves, numeroSemana, logoSrc });
  const html = construirHtmlReporteCompleto({ paginaRH, paginaNomina, numeroSemana, mostrarBarraImprimir: false });

  // --- 5. HTML -> PDF con Chromium headless (mismo resultado que "Imprimir / Guardar como PDF") ---
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle" });
  const pdfBuffer = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  await browser.close();
  console.log(`PDF generado: ${(pdfBuffer.length / 1024).toFixed(0)} KB.`);

  // --- 6. Enviar por correo (Brevo, con el PDF adjunto) ---
  // Los destinatarios se leen primero de Firestore (configuracion/reporteSemanal), que es lo
  // que edita el admin desde Configuración en la app — así nadie tiene que tocar GitHub para
  // cambiar a quién llega el reporte. Si ese documento no existe todavía o viene vacío, se usa
  // como respaldo el secret de GitHub (compatibilidad con la configuración anterior).
  const snapConfigCorreo = await db.collection("configuracion").doc("reporteSemanal").get();
  const configCorreo = snapConfigCorreo.exists ? snapConfigCorreo.data() : null;

  let destinatarios = Array.isArray(configCorreo?.destinatarios) ? configCorreo.destinatarios.filter(Boolean) : [];
  let copiaEn = Array.isArray(configCorreo?.cc) ? configCorreo.cc.filter(Boolean) : [];

  if (destinatarios.length > 0) {
    console.log(`Destinatarios leídos de Firestore (configuracion/reporteSemanal): ${destinatarios.join(", ")}${copiaEn.length > 0 ? ` (CC: ${copiaEn.join(", ")})` : ""}`);
  } else {
    console.log('No hay destinatarios configurados en Firestore (configuracion/reporteSemanal) — usando el secret "DESTINATARIOS_REPORTE" de GitHub como respaldo.');
    destinatarios = variableRequerida("DESTINATARIOS_REPORTE")
      .split(",")
      .map(correo => correo.trim())
      .filter(Boolean);
    copiaEn = (process.env.DESTINATARIOS_CC || "")
      .split(",")
      .map(correo => correo.trim())
      .filter(Boolean);
  }

  if (destinatarios.length === 0) {
    throw new Error('No hay destinatarios configurados ni en Firestore (configuracion/reporteSemanal) ni en el secret "DESTINATARIOS_REPORTE" — debe haber al menos un correo en alguno de los dos.');
  }

  const asunto = `Reporte semanal de nómina — Semana ${numeroSemana} (${formatearFechaLargaCap(viernes)} a ${formatearFechaLargaCap(jueves)})`;
  const cuerpo = `
    <p>Se adjunta el reporte semanal de horas extra, faltas y vacaciones aprobadas — semana ${numeroSemana}, del ${formatearFechaLargaCap(viernes)} al ${formatearFechaLargaCap(jueves)}.</p>
    <p>Este correo se generó y envió automáticamente el día de corte (jueves) desde Adrematasa Interno — no requiere ninguna acción, solo incluye lo que ya estaba <strong>aprobado</strong> a esta hora.</p>
  `;

  const respuesta = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": variableRequerida("BREVO_API_KEY"),
      "Content-Type": "application/json",
      "accept": "application/json"
    },
    body: JSON.stringify({
      sender: { email: variableRequerida("BREVO_SENDER_EMAIL"), name: "Ivan Landa" },
      to: destinatarios.map(email => ({ email })),
      ...(copiaEn.length > 0 ? { cc: copiaEn.map(email => ({ email })) } : {}),
      subject: asunto,
      htmlContent: cuerpo,
      attachment: [{
        name: `reporte_semana_${numeroSemana}.pdf`,
        content: pdfBuffer.toString("base64")
      }]
    })
  });

  if (!respuesta.ok) {
    const detalle = await respuesta.text().catch(() => "");
    throw new Error(`Brevo respondió ${respuesta.status}: ${detalle}`);
  }
  const resultado = await respuesta.json().catch(() => ({}));
  const detalleCc = copiaEn.length > 0 ? ` (con copia a ${copiaEn.join(", ")})` : "";
  console.log(`Correo enviado a ${destinatarios.join(", ")}${detalleCc}. messageId: ${resultado.messageId || "(sin messageId en la respuesta)"}`);

  // --- 7. Marcar como enviado a nóminas lo que de verdad se acaba de mandar ---
  // Solo se llega aquí si Brevo ya confirmó el envío arriba — si algo de lo
  // anterior falla, el proceso truena antes y nada se marca (así una corrida
  // fallida no le "come" el reporte a la siguiente semana: ver
  // js/reportesHtml.js, sección "Pendientes de semanas anteriores", para el
  // porqué completo de esta bandera).
  await marcarComoEnviado({ db, listaHoras, listaVacaciones, listaFaltas, viernes, jueves });

  // --- 8. Marcar la SEMANA completa como enviada ---
  // Aparte de las solicitudes individuales del paso anterior: esto es lo que
  // permite que `yaSeEnvioEstaSemana` detecte "ya se mandó" incluso en una
  // semana sin ninguna hora extra/falta/vacación aprobada (donde el paso 7
  // no marca nada, porque no hay nada que marcar) — sin este registro
  // aparte, una semana vacía se reenviaría (vacía) en cada disparo tardío
  // que llegara después, el mismo jueves.
  await db.collection("reportesSemanaEnviados").doc(viernes).set({
    numeroSemana,
    jueves,
    enviadoEn: new Date().toISOString()
  });
}

async function marcarComoEnviado({ db, listaHoras, listaVacaciones, listaFaltas, viernes, jueves }) {
  const ids = idsIncluidosEnReporte({ listaHoras, listaVacaciones, listaFaltas, viernes, jueves });
  const ahoraIso = new Date().toISOString();
  const escrituras = [
    ...ids.horas.map(id => ({ coleccion: "solicitudes", id })),
    ...ids.faltas.map(id => ({ coleccion: "faltas", id })),
    ...ids.vacaciones.map(id => ({ coleccion: "solicitudesVacaciones", id }))
  ];
  if (escrituras.length === 0) {
    console.log("Nada que marcar como enviado en las solicitudes individuales (no había ninguna en este reporte).");
    return;
  }
  // Firestore permite máximo 500 operaciones por batch — de sobra para el
  // volumen de esta empresa, pero se trocea por si algún día no alcanza.
  for (let i = 0; i < escrituras.length; i += 450) {
    const lote = db.batch();
    escrituras.slice(i, i + 450).forEach(({ coleccion, id }) => {
      lote.update(db.collection(coleccion).doc(id), { enviadoANominaEn: ahoraIso });
    });
    await lote.commit();
  }
  console.log(`Marcados como enviados: ${ids.horas.length} horas extra, ${ids.faltas.length} faltas, ${ids.vacaciones.length} vacaciones.`);
}

main().catch(err => {
  console.error("Falló el envío del reporte semanal:", err);
  process.exit(1);
});