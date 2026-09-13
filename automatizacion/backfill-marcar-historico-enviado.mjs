#!/usr/bin/env node
// Se corre UNA SOLA VEZ, a mano, justo después de desplegar el cambio de
// "Pendientes de semanas anteriores" (ver la sección con ese nombre en
// js/reportesHtml.js) y ANTES de que corra el siguiente reporte (automático
// del jueves, o manual desde "Vista previa/Imprimir").
//
// Por qué hace falta: el campo `enviadoANominaEn` es nuevo — ningún
// documento existente lo tiene todavía. Sin este backfill, la primera vez
// que se arme un reporte después de este cambio, TODO el historial de
// solicitudes/faltas/vacaciones aprobadas de meses atrás (que ya se había
// entregado a nóminas de la forma anterior, antes de que existiera esta
// bandera) aparecería de golpe en "Pendientes de semanas anteriores" — no
// porque de verdad esté atrasado, sino porque el sistema no tiene forma de
// saber que ya se entregó en su momento.
//
// Este script marca como ya enviado (con la fecha de HOY como valor del
// campo — no la fecha real en que se entregó esa semana vieja, que no
// sabemos con precisión; no importa, el campo solo se usa para decidir "ya
// se cuenta o no", nunca para auditar cuándo se mandó cada semana pasada)
// todo lo aprobado de una semana YA PASADA respecto a la semana actual. Lo
// de la semana actual se deja intacto a propósito, para que el próximo
// reporte lo siga tomando en cuenta normal, como siempre.
//
// Uso: igual que crear-usuarios-demo.mjs — coloca en esta misma carpeta tu
// "service-account-local.json" (ver ese script si no te acuerdas de dónde
// sacarlo) y corre:
//   node backfill-marcar-historico-enviado.mjs
// Es seguro correrlo más de una vez: solo toca lo que todavía NO tenga la
// bandera, así que si por algo se corta a medias, con volver a correrlo
// termina donde se quedó.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUTA_CREDENCIAL = join(__dirname, "service-account-local.json");

let credencial;
try {
  credencial = JSON.parse(readFileSync(RUTA_CREDENCIAL, "utf8"));
} catch {
  console.error(
    `No pude leer ${RUTA_CREDENCIAL}.\n` +
    `Coloca ahí tu JSON de cuenta de servicio (ver el comentario al inicio de crear-usuarios-demo.mjs) y vuelve a correr el script.`
  );
  process.exit(1);
}

const app = initializeApp({ credential: cert(credencial) });
const db = getFirestore(app);

// Misma lógica de semana laboral Alanis (viernes a jueves) que usa el resto
// del sistema (ver js/solicitudes.js, js/panel.js, etc.).
function calcularSemanaLaboral(fechaStr) {
  const d = new Date(fechaStr + "T00:00:00");
  const dow = d.getDay();
  const diffDias = (dow - 5 + 7) % 7;
  d.setDate(d.getDate() - diffDias);
  return d.toISOString().slice(0, 10);
}

const hoyStr = new Date().toISOString().slice(0, 10);
const viernesActual = calcularSemanaLaboral(hoyStr);
console.log(`Semana actual: empieza el ${viernesActual}. Se marcará como "ya enviado" todo lo aprobado de ANTES de esa fecha que aún no tenga la bandera.`);

async function marcarColeccion(nombreColeccion, campoFecha) {
  const snap = await db.collection(nombreColeccion).where("estatus", "==", "aprobada").get();
  const porMarcar = snap.docs.filter(d => {
    const data = d.data();
    if (data.enviadoANominaEn) return false; // ya la tiene — no se toca, es lo que hace esto idempotente.
    const fecha = data[campoFecha];
    return !!fecha && fecha < viernesActual;
  });
  if (porMarcar.length === 0) {
    console.log(`${nombreColeccion}: nada que marcar (ya estaba al día, o no había nada de semanas anteriores).`);
    return;
  }
  const ahoraIso = new Date().toISOString();
  for (let i = 0; i < porMarcar.length; i += 450) {
    const lote = db.batch();
    porMarcar.slice(i, i + 450).forEach(d => lote.update(d.ref, { enviadoANominaEn: ahoraIso }));
    await lote.commit();
  }
  console.log(`${nombreColeccion}: marcados ${porMarcar.length} documento(s) como ya enviados (historial previo a este cambio).`);
}

async function main() {
  await marcarColeccion("solicitudes", "fecha");
  await marcarColeccion("faltas", "fecha");
  await marcarColeccion("solicitudesVacaciones", "fechaFin");
  console.log("\nListo. De aquí en adelante, \"Pendientes de semanas anteriores\" solo va a mostrar lo que de verdad quede atrasado desde hoy — no tu historial viejo.");
}

main().catch(err => {
  console.error("Falló el backfill:", err);
  process.exit(1);
});