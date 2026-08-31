// Aviso cuando se CREA una solicitud nueva (horas extra o vacaciones), a
// diferencia de correo.js/notificaciones.js que avisan el RESULTADO
// (aprobada/rechazada). Dos canales, los dos "mejor esfuerzo" (si fallan,
// nunca truenan — la solicitud ya quedó guardada en Firestore antes de
// llamar esto, que es lo que importa):
//   - correo (EmailJS, sin backend — ver correo.js para el porqué);
//   - campanita in-app (Firestore, igual que aprobaciones.js/admin.js/etc.
//     usan crearNotificacion — ver notificaciones.js).
//
// A quién se le avisa (en ambos canales, "según el nivel de jerarquía"): el
// mismo criterio que ya usan las reglas de Firestore para decidir quién
// puede resolver la solicitud —
//   - si el empleado tiene supervisor asignado (`supervisorId`), se le
//     avisa a ese supervisor;
//   - si no tiene supervisor asignado (o el que tenía ya no existe o no
//     tiene correo capturado), se les avisa a todos los admin activos —
//     son quienes de todas formas pueden resolver cualquier solicitud sin
//     supervisor, así que hacen de respaldo.
import { db } from "./firebase-config.js";
import {
  collection, doc, getDoc, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { enviarCorreoAvisoNuevaSolicitud } from "./correo.js";
import { crearNotificacion } from "./notificaciones.js";

async function destinatariosParaAviso(datosUsuario) {
  if (datosUsuario.supervisorId) {
    try {
      const snap = await getDoc(doc(db, "usuarios", datosUsuario.supervisorId));
      if (snap.exists() && snap.data().email) {
        return [{ id: snap.id, email: snap.data().email, nombre: snap.data().nombre || "" }];
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
    .filter(d => d.data().email)
    .map(d => ({ id: d.id, email: d.data().email, nombre: d.data().nombre || "" }));
}

// datosUsuario: doc de usuarios de quien crea la solicitud (necesita supervisorId).
// asunto / mensaje: cuerpo del correo (HTML), ya armado por quien llama.
// tituloBell / mensajeBell: versión corta en texto plano para la campanita
// (opcional — si no se manda, solo se avisa por correo, como antes).
export async function avisarNuevaSolicitud({ datosUsuario, asunto, mensaje, tituloBell, mensajeBell }) {
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
    if (tituloBell) {
      destinatarios.forEach(d => {
        crearNotificacion(d.id, { titulo: tituloBell, mensaje: mensajeBell || "", tipo: "solicitudNueva" });
      });
    }
  } catch (err) {
    console.error("No se pudo avisar de la nueva solicitud:", err);
  }
}