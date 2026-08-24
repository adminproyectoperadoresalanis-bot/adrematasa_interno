// Aviso por correo cuando se CREA una solicitud nueva (horas extra o
// vacaciones), a diferencia de correo.js que avisa el RESULTADO (aprobada/
// rechazada). Usa el mismo mecanismo sin backend (EmailJS) — ver correo.js
// para el porqué.
//
// A quién se le avisa ("según el nivel de jerarquía"): el mismo criterio
// que ya usan las reglas de Firestore para decidir quién puede resolver la
// solicitud —
//   - si el empleado tiene supervisor asignado (`supervisorId`), se le
//     avisa a ese supervisor;
//   - si no tiene supervisor asignado (o el que tenía ya no existe o no
//     tiene correo capturado), se les avisa a todos los admin activos —
//     son quienes de todas formas pueden resolver cualquier solicitud sin
//     supervisor, así que hacen de respaldo.
//
// Es "mejor esfuerzo" a propósito: si el correo falla (EmailJS sin
// configurar, sin internet, permisos, etc.) NUNCA truena — la solicitud ya
// quedó guardada en Firestore antes de llamar esto, que es lo que importa.
import { db } from "./firebase-config.js";
import {
  collection, doc, getDoc, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { enviarCorreoAvisoNuevaSolicitud } from "./correo.js";

async function destinatariosParaAviso(datosUsuario) {
  if (datosUsuario.supervisorId) {
    try {
      const snap = await getDoc(doc(db, "usuarios", datosUsuario.supervisorId));
      if (snap.exists() && snap.data().email) {
        return [{ email: snap.data().email, nombre: snap.data().nombre || "" }];
      }
    } catch (err) {
      console.error("No se pudo leer al supervisor asignado, se avisa al admin en su lugar:", err);
    }
    // Si no existe, no tiene correo, o no se pudo leer: cae a admin como respaldo.
  }
  const snapAdmins = await getDocs(
    query(collection(db, "usuarios"), where("rol", "==", "admin"), where("estatus", "==", "activo"))
  );
  return snapAdmins.docs
    .map(d => d.data())
    .filter(u => u.email)
    .map(u => ({ email: u.email, nombre: u.nombre || "" }));
}

// datosUsuario: doc de usuarios de quien crea la solicitud (necesita supervisorId).
// asunto / mensaje: ya armados por quien llama (ver solicitudes.js / vacaciones.js).
export async function avisarNuevaSolicitud({ datosUsuario, asunto, mensaje }) {
  try {
    const destinatarios = await destinatariosParaAviso(datosUsuario);
    if (destinatarios.length === 0) {
      console.warn("No se encontró a quién avisar de la nueva solicitud (sin supervisor y sin admin con correo).");
      return;
    }
    await Promise.all(destinatarios.map(d =>
      enviarCorreoAvisoNuevaSolicitud({ destinatarioEmail: d.email, destinatarioNombre: d.nombre, asunto, mensaje })
        .then(resultado => {
          if (!resultado.ok) console.error("No se pudo avisar a " + d.email + ":", resultado.error);
        })
    ));
  } catch (err) {
    console.error("No se pudo avisar de la nueva solicitud:", err);
  }
}