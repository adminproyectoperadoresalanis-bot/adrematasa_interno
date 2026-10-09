// Bloque de "Autorizaciones adicionales" que se agrega al cuerpo del correo
// semanal de nómina (bonos, gratificaciones por desempeño o por volumen de
// trabajo, etc. — ver js/autorizacionesExtra.js, la pantalla donde el admin
// las captura).
//
// Vive en su propio módulo, importado tanto por la pantalla (para la "vista
// previa del correo") como por automatizacion/generar-y-enviar-reporte.mjs
// (el envío real) — mismo criterio que js/reportesHtml.js: así lo que el
// admin ve en la vista previa nunca se desincroniza de lo que de verdad sale
// en el correo.
import { escapeHtml, numeroSemanaISO, sumarDias } from "./reportesHtml.js";

// 1500 -> "$1,500.00 MXN". Sin monto (null/""/undefined) -> null.
export function formatearMontoMXN(monto) {
  if (monto === null || monto === undefined || monto === "") return null;
  const n = Number(monto);
  if (!isFinite(n)) return null;
  return `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`;
}

// autorizaciones: arreglo de documentos de autorizacionesExtra
//   ({ empleadoNombre, concepto, monto, nota, semanaViernes }).
// viernesActual: el viernes (yyyy-mm-dd) de la semana que se está reportando.
//   Una autorización cuyo semanaViernes es ANTERIOR a ese viernes es una
//   "rezagada" (se capturó/quedó sin enviar de una semana pasada): sale igual,
//   pero marcada con el número de semana en que se autorizó, para que nóminas
//   no la confunda con una de esta semana.
// Devuelve "" si no hay nada que agregar (el correo queda exactamente igual
// que siempre).
export function construirBloqueCorreo({ autorizaciones, viernesActual }) {
  if (!Array.isArray(autorizaciones) || autorizaciones.length === 0) return "";

  const ordenadas = [...autorizaciones].sort((a, b) =>
    (a.semanaViernes || "").localeCompare(b.semanaViernes || "")
    || (a.empleadoNombre || "").localeCompare(b.empleadoNombre || "", "es")
  );

  const items = ordenadas.map((a) => {
    const monto = formatearMontoMXN(a.monto);
    const partes = [`<strong>${escapeHtml(a.empleadoNombre)}</strong>`, escapeHtml(a.concepto)];
    if (monto) partes.push(monto);
    let linea = partes.join(" — ") + ".";
    if (a.semanaViernes && viernesActual && a.semanaViernes < viernesActual) {
      const numero = numeroSemanaISO(sumarDias(a.semanaViernes, 6));
      linea += ` <em>(Autorizada en la semana ${numero}.)</em>`;
    }
    if (a.nota) {
      linea += `<br>${escapeHtml(a.nota).replace(/\r?\n/g, "<br>")}`;
    }
    return `<li style="margin-bottom:8px;">${linea}</li>`;
  }).join("");

  const intro = ordenadas.length > 1
    ? "Adicionalmente, se informa que fueron autorizados los siguientes conceptos extraordinarios:"
    : "Adicionalmente, se informa que fue autorizado el siguiente concepto extraordinario:";

  return `
    <p style="margin:16px 0 4px;"><strong>Autorizaciones adicionales</strong></p>
    <p style="margin:0 0 8px;">${intro}</p>
    <ol style="margin:0 0 12px 20px;padding:0;">${items}</ol>
  `;
}