// Enlaces de WhatsApp "click to chat" para avisar a un empleado desde
// Aprobaciones / Aprobaciones de vacaciones. No hay forma de detectar desde
// JS del navegador si la persona que da clic tiene WhatsApp Web o la app de
// Escritorio abierta (ver conversación con Iván) — por eso se ofrecen los
// dos enlaces y quien avisa elige el que le funcione.
const LADA_POR_PAIS = { MX: "52", US: "1", CA: "1" };

// Arma el número completo (lada + 10 dígitos) que WhatsApp espera, o null si
// el empleado todavía no tiene móvil capturado / está incompleto.
export function numeroWhatsApp(movilPais, movilNumero) {
  if (!movilNumero || movilNumero.length !== 10) return null;
  const lada = LADA_POR_PAIS[movilPais] || LADA_POR_PAIS.MX;
  return `${lada}${movilNumero}`;
}

export function linksWhatsApp(movilPais, movilNumero, mensaje) {
  const numero = numeroWhatsApp(movilPais, movilNumero);
  if (!numero) return null;
  const texto = encodeURIComponent(mensaje || "");
  return {
    // Fuerza WhatsApp Web específicamente.
    web: `https://web.whatsapp.com/send?phone=${numero}&text=${texto}`,
    // Enlace "universal": el navegador/SO decide si abre la app de Escritorio, la de celular o Web.
    app: `https://wa.me/${numero}?text=${texto}`
  };
}

// HTML listo para insertar en una celda de tabla: dos botones (Web / App) o
// un aviso si el empleado no tiene móvil capturado todavía.
export function botonesWhatsApp(movilPais, movilNumero, mensaje) {
  const links = linksWhatsApp(movilPais, movilNumero, mensaje);
  if (!links) {
    return `<span class="nota-whatsapp">Sin móvil capturado</span>`;
  }
  return `
    <span class="grupo-whatsapp">
      <a href="${links.web}" target="_blank" rel="noopener" class="btn-whatsapp" title="Abrir WhatsApp Web">WhatsApp Web</a>
      <a href="${links.app}" target="_blank" rel="noopener" class="btn-whatsapp" title="Abrir WhatsApp (Escritorio o celular)">WhatsApp App</a>
    </span>
  `;
}