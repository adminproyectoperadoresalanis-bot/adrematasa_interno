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
// --- Por qué corre varias veces y no una sola ---
// GitHub Actions solo programa cron en UTC, pero Nuevo Laredo cambia de
// UTC-6 a UTC-5 con el horario de verano (igual que Texas) — un cron fijo
// en UTC se desfasaría 1 hora dos veces al año. En vez de acordarnos de
// ajustar el workflow cada cambio de horario, el cron dispara varias veces
// alrededor de las 6pm (ver el workflow), y este script solo hace algo si
// al convertir "ahora" a la hora de Nuevo Laredo da exactamente las 6pm —
// las demás veces sale sin hacer nada. Así funciona correcto todo el año
// sin mantenimiento.
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
// esperar al jueves).
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { chromium } from "playwright";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import {
  calcularSemanaLaboral, sumarDias, numeroSemanaISO, formatearFechaLargaCap,
  construirPaginaRH, construirPaginaNomina, construirHtmlReporteCompleto
} from "../public/js/reportesHtml.js";

const ZONA_HORARIA = "America/Matamoros"; // Nuevo Laredo, Tamps. — frontera con horario de verano tipo EU.
const HORA_OBJETIVO = 18; // 6:00 pm hora de Nuevo Laredo.

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

async function main() {
  const forzar = process.env.FORZAR_ENVIO === "true";
  const ahora = ahoraEnNuevoLaredo();

  if (!forzar && ahora.hora !== HORA_OBJETIVO) {
    console.log(`Son las ${String(ahora.hora).padStart(2, "0")}:${String(ahora.minuto).padStart(2, "0")} en Nuevo Laredo — no son las ${HORA_OBJETIVO}:00, no se manda nada en este disparo. (Normal: el workflow dispara varias veces alrededor de la hora objetivo para cubrir el cambio de horario, ver el comentario al inicio de este archivo.)`);
    return;
  }
  console.log(forzar ? "Envío forzado manualmente (workflow_dispatch)." : `Son las ${HORA_OBJETIVO}:00 en Nuevo Laredo — generando y enviando el reporte.`);

  // --- 1. Firestore vía Admin SDK ---
  const credencial = JSON.parse(variableRequerida("FIREBASE_SERVICE_ACCOUNT"));
  const appFirebase = initializeApp({ credential: cert(credencial) });
  const db = getFirestore(appFirebase);

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

  // --- 2. Semana laboral (viernes a jueves) que corresponde a "hoy" en Nuevo Laredo ---
  const viernes = calcularSemanaLaboral(ahora.fechaStr);
  const jueves = sumarDias(viernes, 6);
  const numeroSemana = numeroSemanaISO(jueves);
  console.log(`Semana laboral ${numeroSemana}: del ${viernes} al ${jueves}.`);

  // --- 3. Armar el HTML del reporte (mismo módulo que usa el navegador) ---
  const logoBuffer = readFileSync(join(__dirname, "..", "public", "img", "logo-alanis.png"));
  const logoSrc = `data:image/png;base64,${logoBuffer.toString("base64")}`;

  const paginaRH = construirPaginaRH({ listaHoras, mapUsuarios, viernes, jueves, numeroSemana, logoSrc });
  const paginaNomina = construirPaginaNomina({ listaHoras, listaVacaciones, listaFaltas, mapUsuarios, viernes, jueves, numeroSemana, logoSrc });
  const html = construirHtmlReporteCompleto({ paginaRH, paginaNomina, numeroSemana, mostrarBarraImprimir: false });

  // --- 4. HTML -> PDF con Chromium headless (mismo resultado que "Imprimir / Guardar como PDF") ---
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle" });
  const pdfBuffer = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  await browser.close();
  console.log(`PDF generado: ${(pdfBuffer.length / 1024).toFixed(0)} KB.`);

  // --- 5. Enviar por correo (Brevo, con el PDF adjunto) ---
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
}

main().catch(err => {
  console.error("Falló el envío del reporte semanal:", err);
  process.exit(1);
});