// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/automatizacion/generar-y-enviar-ataf104.mjs
// ##########################################################################
// ATAF104 automático (2026-11-18, pedido de Ivan): "Formato de planeación de
// personal a laborar — día festivo". Nóminas lo usa para avisar a seguridad
// quién entra ese día, así que sale SOLO, 2 días hábiles antes del festivo a
// las 9:00 am (hora de Nuevo Laredo), con las solicitudes de horas extra
// APROBADAS a esa hora. El pago va aparte, en el reporte semanal (columna
// "H Fest"), por eso este formato no viaja en el correo de los jueves.
//
// Corre en GitHub Actions (.github/workflows/ataf104-festivos.yml) igual que
// el reporte de los jueves y con los mismos secrets (FIREBASE_SERVICE_ACCOUNT,
// BREVO_API_KEY, BREVO_SENDER_EMAIL). Mismo módulo para armar la hoja que la
// vista previa de la app (public/js/reportesHtml.js), y mismo HTML → PDF con
// Chromium.
//
// --- Cuándo actúa (aprendido del reporte de los jueves) ---
// GitHub no es puntual con `schedule` (llegó a atrasar horas). Por eso no se
// pregunta "¿son exactamente las 9?", sino "¿ya se abrió la ventana y TODAVÍA
// no se manda?":
//   - ENVÍO: desde el día de envío a las 9:00 hasta el día del festivo
//     (inclusive). El primer disparo dentro de esa ventana lo manda; los
//     demás ven configuracion/ataf104Estado[<fecha>].enviadoEn y no repiten.
//   - RECORDATORIO a Ivan (campanita + push): desde 1 día hábil antes del
//     envío a las 9:00 hasta que sale el envío. Una sola vez.
//   - Si a la hora del envío no hay nadie aprobado, no se manda; se avisa a
//     Ivan una vez y se sigue revisando en cada disparo (si alguien queda
//     aprobado antes del festivo, sale en ese momento).
//
// --- Reenviar o mandar antes ---
// GitHub › Actions › "ATAF104 · personal en día festivo" › Run workflow, con
// "forzar" marcado y la fecha del festivo (yyyy-mm-dd). Sin fecha, toma el
// próximo festivo. El forzado ignora ventanas y "ya se envió".
//
// --- Destinatarios ---
// Configuración › 1 · RH › "Formato día festivo ATAF104 (correo)"
// (configuracion/ataf104.destinatarios = { para: [], cc: [] }).
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { chromium } from "playwright";
import { readFileSync, appendFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import {
  sumarDias, fechaEnvioAtaf104, fechaRecordatorioAtaf104, fechaLargaConDia,
  personasAtaf104, responsableAtaf104, construirPaginaAtaf104, construirHtmlAtaf104,
  HORA_ENVIO_ATAF104, CORREO_AUTORIZA_ATAF104, escapeHtml
} from "../public/js/reportesHtml.js";

const ZONA_HORARIA = "America/Matamoros"; // Nuevo Laredo, Tamps.
const __dirname = dirname(fileURLToPath(import.meta.url));

function variableRequerida(nombre) {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta configurar el secret "${nombre}" en GitHub (Settings → Secrets and variables → Actions).`);
  return valor;
}

function ahoraEnNuevoLaredo() {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA_HORARIA, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(new Date());
  const obtener = (tipo) => partes.find(p => p.type === tipo).value;
  return { fechaStr: `${obtener("year")}-${obtener("month")}-${obtener("day")}`, hora: Number(obtener("hour")) % 24, minuto: Number(obtener("minute")) };
}

// ¿"ahora" ya pasó de fecha a las HORA_ENVIO?
const yaLlego = (ahora, fecha) => ahora.fechaStr > fecha || (ahora.fechaStr === fecha && ahora.hora >= HORA_ENVIO_ATAF104);

async function uidDeIvan(db) {
  const snap = await db.collection("usuarios").where("email", "==", CORREO_AUTORIZA_ATAF104).limit(1).get();
  return snap.empty ? null : snap.docs[0].id;
}

// Aviso en la campanita (y push al celular: pushDesdeCampanita en functions/).
async function avisarAIvan(db, titulo, mensaje) {
  const uid = await uidDeIvan(db);
  if (!uid) { console.log(`No encontré el usuario ${CORREO_AUTORIZA_ATAF104} para avisarle.`); return; }
  await db.collection("notificaciones").add({
    destinatarioId: uid, titulo, mensaje, tipo: "ataf104", leida: false,
    creadoEn: new Date().toISOString(), timestamp: FieldValue.serverTimestamp()
  });
  console.log(`Aviso a Ivan: ${titulo} — ${mensaje}`);
}

function fechaCortaConDia(fechaStr) {
  const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const d = new Date(fechaStr + "T00:00:00");
  return `${DIAS[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()]}`;
}

async function enviarAtaf104({ db, festivo, festivos, listaHoras, mapUsuarios, cfg, hoy, forzado }) {
  const { personas, pendientes } = personasAtaf104({ listaHoras, mapUsuarios, fecha: festivo.fecha });
  const refEstado = db.collection("configuracion").doc("ataf104Estado");
  if (personas.length === 0) {
    console.log(`ATAF104 ${festivo.fecha}: no hay solicitudes aprobadas — no se manda.`);
    const estado = ((await refEstado.get()).data() || {})[festivo.fecha] || {};
    if (!estado.avisoSinPersonalEn) {
      await avisarAIvan(db, "ATAF104 sin personal aprobado",
        `El ATAF104 de ${festivo.nombre || festivo.fecha} no salió: no hay solicitudes aprobadas${pendientes.length ? ` (${pendientes.length} pendiente${pendientes.length === 1 ? "" : "s"})` : ""}. Si apruebas alguna antes del festivo, sale sola.`);
      await refEstado.set({ [festivo.fecha]: { avisoSinPersonalEn: new Date().toISOString() } }, { merge: true });
    }
    return;
  }

  const dest = (cfg && cfg.destinatarios) || {};
  const para = (Array.isArray(dest.para) ? dest.para : []).filter(Boolean);
  const cc = (Array.isArray(dest.cc) ? dest.cc : []).filter(Boolean).filter(c => !para.includes(c));
  if (para.length === 0) {
    await avisarAIvan(db, "ATAF104 sin destinatarios", `No pude mandar el ATAF104 de ${festivo.nombre || festivo.fecha}: faltan los destinatarios en Configuración › RH › Formato día festivo ATAF104.`);
    throw new Error("No hay destinatarios en configuracion/ataf104.destinatarios.para.");
  }

  const logoBuffer = readFileSync(join(__dirname, "..", "public", "img", "logo-alanis.png"));
  const logoSrc = `data:image/png;base64,${logoBuffer.toString("base64")}`;
  const observaciones = ((cfg && cfg.observaciones) || {})[festivo.fecha] || "";
  const pagina = construirPaginaAtaf104({
    fecha: festivo.fecha, festivoNombre: festivo.nombre || "", personas,
    responsable: responsableAtaf104(mapUsuarios), fechaSolicitud: hoy, observaciones, logoSrc
  });
  const html = construirHtmlAtaf104({ paginaAtaf104: pagina, titulo: `ATAF104 ${festivo.fecha}` });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle" });
  const pdfBuffer = await page.pdf({ format: "Letter", margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" }, printBackground: true });
  await browser.close();
  console.log(`PDF generado: ${(pdfBuffer.length / 1024).toFixed(0)} KB, ${personas.length} personas.`);

  const nombreFestivo = festivo.nombre ? ` (${festivo.nombre})` : "";
  const asunto = `ATAF104 · Personal a laborar día festivo ${festivo.fecha.split("-").reverse().join("/")}${festivo.nombre ? " · " + festivo.nombre : ""}`;
  // Cuerpo corto (2026-11-18, pedido de Ivan): el detalle va en el PDF.
  const cuerpo = `
    <p>Se adjunta el formato ATAF104 con el personal autorizado por la gerencia de importaciones para laborar el día festivo
      ${escapeHtml(fechaLargaConDia(festivo.fecha))}${escapeHtml(nombreFestivo)}.</p>
    <p>Este correo se generó y envió automáticamente desde Adrematasa Interno con las solicitudes aprobadas a esta hora${forzado ? " (envío manual)" : ""}.</p>
  `;

  const respuesta = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": variableRequerida("BREVO_API_KEY"), "Content-Type": "application/json", "accept": "application/json" },
    body: JSON.stringify({
      sender: { email: variableRequerida("BREVO_SENDER_EMAIL"), name: "Ivan Landa" },
      to: para.map(email => ({ email })),
      ...(cc.length ? { cc: cc.map(email => ({ email })) } : {}),
      subject: asunto,
      htmlContent: cuerpo,
      attachment: [{ name: `ATAF104_${festivo.fecha}.pdf`, content: pdfBuffer.toString("base64") }]
    })
  });
  if (!respuesta.ok) {
    const detalle = await respuesta.text().catch(() => "");
    throw new Error(`Brevo respondió ${respuesta.status}: ${detalle}`);
  }
  const resultado = await respuesta.json().catch(() => ({}));
  console.log(`ATAF104 ${festivo.fecha} enviado a ${para.join(", ")}${cc.length ? ` (CC: ${cc.join(", ")})` : ""}. messageId: ${resultado.messageId || "—"}`);

  await refEstado.set({
    [festivo.fecha]: {
      enviadoEn: new Date().toISOString(), para, cc, personas: personas.length,
      pendientesAlEnviar: pendientes.length, forzado: !!forzado
    }
  }, { merge: true });
  await avisarAIvan(db, "ATAF104 enviado",
    `Salió el ATAF104 de ${festivo.nombre || festivo.fecha} con ${personas.length} persona${personas.length === 1 ? "" : "s"}${pendientes.length ? `; ${pendientes.length} pendiente${pendientes.length === 1 ? "" : "s"} no entr${pendientes.length === 1 ? "ó" : "aron"}` : ""}.`);
}

async function main() {
  const forzar = process.env.FORZAR_ENVIO === "true";
  const fechaForzada = (process.env.FECHA_FESTIVO || "").trim();
  const ahora = ahoraEnNuevoLaredo();
  console.log(`Ahora en Nuevo Laredo: ${ahora.fechaStr} ${String(ahora.hora).padStart(2, "0")}:${String(ahora.minuto).padStart(2, "0")}.`);

  const credencial = JSON.parse(variableRequerida("FIREBASE_SERVICE_ACCOUNT"));
  const db = getFirestore(initializeApp({ credential: cert(credencial) }));

  const [snapFestivos, snapCfg, snapEstado] = await Promise.all([
    db.collection("configuracion").doc("diasFestivos").get(),
    db.collection("configuracion").doc("ataf104").get(),
    db.collection("configuracion").doc("ataf104Estado").get()
  ]);
  const festivos = (snapFestivos.exists && Array.isArray(snapFestivos.data().festivos) ? snapFestivos.data().festivos : [])
    .filter(f => f && f.fecha).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const cfg = snapCfg.exists ? snapCfg.data() : {};
  const estado = snapEstado.exists ? snapEstado.data() : {};

  // ¿Qué festivos tienen algo que hacer hoy?
  let porEnviar = [], porRecordar = [];
  if (forzar) {
    const f = fechaForzada ? festivos.find(x => x.fecha === fechaForzada) : festivos.find(x => x.fecha >= ahora.fechaStr);
    if (!f) throw new Error(fechaForzada ? `La fecha ${fechaForzada} no está en el catálogo de festivos.` : "No hay festivos próximos en el catálogo.");
    console.log(`Envío forzado del ATAF104 de ${f.fecha} (se ignoran ventanas y "ya se envió").`);
    porEnviar = [f];
  } else {
    festivos.filter(f => f.fecha >= ahora.fechaStr && f.fecha <= sumarDias(ahora.fechaStr, 30)).forEach(f => {
      const envio = fechaEnvioAtaf104(f.fecha, festivos);
      const recordatorio = fechaRecordatorioAtaf104(f.fecha, festivos);
      const est = estado[f.fecha] || {};
      console.log(`Festivo ${f.fecha} (${f.nombre || ""}): recordatorio ${recordatorio} 9:00, envío ${envio} 9:00${est.enviadoEn ? `, ya enviado ${est.enviadoEn}` : ""}.`);
      if (est.enviadoEn) return;
      if (yaLlego(ahora, envio)) porEnviar.push(f);
      else if (yaLlego(ahora, recordatorio) && !est.recordatorioEn) porRecordar.push(f);
    });
  }
  // Paso "revisar" del workflow: solo dice si hay algo que hacer, para no
  // instalar Chromium (1–2 min) en los disparos de todos los días sin festivo.
  if (process.env.SOLO_REVISAR === "true") {
    const hay = porEnviar.length > 0 || porRecordar.length > 0;
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `accion=${hay ? "si" : "no"}\n`);
    console.log(hay ? "Hay algo que hacer en este disparo." : "Nada que hacer en este disparo.");
    return;
  }
  if (!porEnviar.length && !porRecordar.length) { console.log("Nada que hacer en este disparo."); return; }

  const [snapHoras, snapUsuarios] = await Promise.all([db.collection("solicitudes").get(), db.collection("usuarios").get()]);
  const listaHoras = snapHoras.docs.map(d => ({ id: d.id, ...d.data() }));
  const mapUsuarios = new Map(snapUsuarios.docs.map(d => [d.id, d.data()]));

  for (const f of porRecordar) {
    const { personas, pendientes } = personasAtaf104({ listaHoras, mapUsuarios, fecha: f.fecha });
    const envio = fechaEnvioAtaf104(f.fecha, festivos);
    await avisarAIvan(db, "ATAF104 · mañana sale",
      `${fechaCortaConDia(envio)} 9:00 am sale el ATAF104 de ${f.nombre || f.fecha} · ${personas.length} aprobada${personas.length === 1 ? "" : "s"}${pendientes.length ? ` · ${pendientes.length} pendiente${pendientes.length === 1 ? "" : "s"}` : ""}. Revisa antes de que salga.`);
    await db.collection("configuracion").doc("ataf104Estado").set({ [f.fecha]: { recordatorioEn: new Date().toISOString() } }, { merge: true });
  }
  for (const f of porEnviar) {
    await enviarAtaf104({ db, festivo: f, festivos, listaHoras, mapUsuarios, cfg, hoy: ahora.fechaStr, forzado: forzar });
  }
}

main().catch(err => {
  console.error("Falló el ATAF104 automático:", err);
  process.exit(1);
});