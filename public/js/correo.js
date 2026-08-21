// Envío de correos de aviso (aprobación/rechazo de solicitudes) sin
// backend, usando EmailJS (https://www.emailjs.com). En el plan Spark de
// Firebase no hay Cloud Functions, así que un correo transaccional normal
// (Nodemailer, SendGrid, etc.) no se puede mandar desde el navegador sin
// exponer una contraseña o una API key secreta. EmailJS está pensado justo
// para esto: usa una "Public Key" que SÍ es segura de dejar en el código
// del cliente (se puede restringir por dominio desde su dashboard y trae
// límite de envíos incluido).
//
// El SDK se carga en index.html como <script> clásico (variable global
// window.emailjs), NO como módulo ES: el paquete @emailjs/browser no trae
// un build "todo en un solo archivo" apto para import() nativo del
// navegador (sus imports internos no llevan extensión .js, que es
// obligatoria fuera de un bundler), así que su forma soportada para un
// sitio sin bundler como este es su build UMD, ya agregado en index.html
// justo antes de js/auth.js:
//   <script src="https://cdn.jsdelivr.net/npm/@emailjs/browser@4.4.1/dist/email.min.js"></script>
//
// --- Cómo dejarlo funcionando (una sola vez) ---
// 1. Crea una cuenta gratis en https://www.emailjs.com — el plan gratuito
//    permite ~200 correos al mes, de sobra para avisos internos de Alanis.
// 2. Email Services → Add New Service → conecta la cuenta de correo que va
//    a aparecer como remitente (puede ser un Gmail/Outlook de Alanis, o un
//    SMTP propio). Copia el "Service ID" que te da.
// 3. Email Templates → Create New Template. Dentro del cuerpo del template
//    usa estas variables (con dobles llaves, tal cual):
//      {{to_name}}   -> nombre del empleado, para el saludo.
//      {{mensaje}}   -> el cuerpo con la leyenda de aprobación/rechazo.
//    Y en la configuración del template (arriba del editor, "Settings"):
//      To Email  -> {{to_email}}   (si no lo pones aquí, EmailJS no sabe
//                                    a quién mandar el correo aunque el
//                                    HTML lo muestre).
//      Subject   -> {{asunto}}
//    Copia el "Template ID".
// 4. Account → General → copia la "Public Key".
// 5. Pega los tres valores aquí abajo, en EMAILJS_CONFIG.
//
// Mientras EMAILJS_CONFIG no esté lleno, enviarCorreoResultado() regresa un
// error claro en vez de intentar mandar nada (no truena la app).
const EMAILJS_CONFIG = {
  serviceId: "service_416kx4m",
  templateId: "template_iwc9g4q",
  publicKey: "dcIzVrYyNvf886rC7"
};

function configurado() {
  return Object.values(EMAILJS_CONFIG).every(v => v && !v.startsWith("PON_AQUI"));
}

// destinatarioEmail / destinatarioNombre: a quién se le avisa.
// asunto / mensaje: texto ya armado (la leyenda de aprobación o rechazo).
// Regresa { ok: true } o { ok: false, error } — nunca lanza, para que se
// pueda llamar "en automático" sin arriesgar el flujo principal (aprobar o
// rechazar la solicitud) si el correo falla.
export async function enviarCorreoResultado({ destinatarioEmail, destinatarioNombre, asunto, mensaje }) {
  if (!destinatarioEmail) {
    return { ok: false, error: "Este empleado no tiene correo registrado." };
  }
  if (!configurado()) {
    return { ok: false, error: "El envío de correos todavía no está configurado (faltan las llaves de EmailJS en js/correo.js)." };
  }
  if (typeof window.emailjs === "undefined") {
    return { ok: false, error: "No se pudo cargar el servicio de correo — revisa tu conexión a internet (o que index.html tenga el <script> de EmailJS)." };
  }
  try {
    await window.emailjs.send(
      EMAILJS_CONFIG.serviceId,
      EMAILJS_CONFIG.templateId,
      {
        to_email: destinatarioEmail,
        to_name: destinatarioNombre || "",
        asunto,
        mensaje
      },
      { publicKey: EMAILJS_CONFIG.publicKey }
    );
    return { ok: true };
  } catch (err) {
    console.error("No se pudo enviar el correo:", err);
    const detalle = (err && err.text) || (err && err.message) || "Error desconocido.";
    return { ok: false, error: detalle };
  }
}