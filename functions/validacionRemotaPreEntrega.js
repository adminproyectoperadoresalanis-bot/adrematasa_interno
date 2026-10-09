// ============================================================================
// validacionRemotaPreEntrega — Checkpoint 2 (Pre-entrega) validado por
// OPERACIONES en nombre de un operador que no puede escanear.
//
// Flujo: el operador le manda a Operaciones por WhatsApp la foto de la factura
// que lleva; Operaciones lee el QR de esa foto (o teclea el folio fiscal y el
// RFC impresos) en ADREMATASA Interno y registra la validación. Esto escribe en
// `repositorio_mccain` (proyecto alanis-operadores) lo MISMO que escribe la app
// del operador al escanear, y deja una bitácora de quién lo hizo.
//
// Este módulo NO conoce la autenticación de Interno: recibe `actor` ya
// verificado por la función que lo llama (rol Operaciones, comprobado en
// `usuarios/{uid}` de Interno, nunca con datos del cliente). No importa nada:
// recibe `db` (Firestore del proyecto alanis-operadores, Admin SDK) y
// `FieldValue` — así se puede probar sin red y pegar en cualquier proyecto.
//
// ENVOLTORIO SUGERIDO (en el proyecto Interno, estilo v2):
//
//   const { ejecutarValidacionRemota, ErrorValidacion } = require("./validacionRemotaPreEntrega");
//   exports.validarPreEntregaRemota = onCall({ region: "us-central1" }, async (request) => {
//     if (!request.auth) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
//     const actor = await leerActorOperaciones(request.auth.uid); // lanza permission-denied si el rol no es Operaciones
//     try {
//       return await ejecutarValidacionRemota({
//         db: dbAlanis, FieldValue: admin.firestore.FieldValue, actor, entrada: request.data || {},
//       });
//     } catch (e) {
//       if (e instanceof ErrorValidacion) throw new HttpsError(e.codigoHttps, e.message, { motivo: e.motivo });
//       throw e;
//     }
//   });
//
// PRINCIPIO: los campos que ya existían conservan su significado (el uid dentro
// de `escaneadoPor` y `validadoPor` siguen siendo el del OPERADOR, como cuando
// escanea en la app) para que ningún consumidor actual se rompa. La persona real
// de Operaciones queda en los campos NUEVOS: destinoEscaneo.metodo,
// destinoEscaneo.validacionRemota y la bitácora.
// ============================================================================

const COL_REPO = "repositorio_mccain";
const COL_BITACORA = "bitacora_validaciones_remotas";

const MOTIVOS_OPERADOR = ["camara_no_funciona", "qr_ilegible", "app_no_funciona", "otro"];
const TIPOS_EVIDENCIA = ["foto_whatsapp", "otro"];
const UUID_RE = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
const RFC_RE = /^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$/;

class ErrorValidacion extends Error {
  constructor(codigoHttps, motivo, mensaje) {
    super(mensaje);
    this.name = "ErrorValidacion";
    this.codigoHttps = codigoHttps; // 'invalid-argument' | 'not-found' | 'failed-precondition'
    this.motivo = motivo;
  }
}

function norm(s) {
  return typeof s === "string" ? s.trim().toUpperCase() : "";
}

function textoOpcional(s, max) {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
}

function validarEntrada(entrada) {
  const e = entrada || {};
  const embarqueId = e.embarqueId;
  if (typeof embarqueId !== "string" || !embarqueId || embarqueId.indexOf("/") !== -1) {
    throw new ErrorValidacion("invalid-argument", "embarque_invalido", "Falta el embarque o no es válido.");
  }
  const uuidLeido = norm(e.uuidLeido);
  if (!UUID_RE.test(uuidLeido)) {
    throw new ErrorValidacion("invalid-argument", "uuid_invalido", "El folio fiscal (UUID) no tiene el formato correcto.");
  }
  const rfcLeido = norm(e.rfcLeido);
  if (!RFC_RE.test(rfcLeido)) {
    throw new ErrorValidacion("invalid-argument", "rfc_invalido", "El RFC del receptor no tiene el formato correcto.");
  }
  if (typeof e.lecturaManual !== "boolean") {
    throw new ErrorValidacion("invalid-argument", "falta_lectura_manual", "Indica si los datos se leyeron del QR o se capturaron a mano.");
  }
  if (MOTIVOS_OPERADOR.indexOf(e.motivoOperador) === -1) {
    throw new ErrorValidacion("invalid-argument", "motivo_operador_invalido", "Indica por qué el operador no pudo escanear.");
  }
  const notaMotivo = textoOpcional(e.notaMotivo, 300);
  if (e.motivoOperador === "otro" && !notaMotivo) {
    throw new ErrorValidacion("invalid-argument", "falta_nota_motivo", "Si el motivo es \"otro\", describe cuál fue.");
  }
  if (TIPOS_EVIDENCIA.indexOf(e.evidenciaTipo) === -1) {
    throw new ErrorValidacion("invalid-argument", "evidencia_invalida", "Indica qué evidencia recibiste del operador.");
  }
  return {
    embarqueId, uuidLeido, rfcLeido,
    lecturaManual: e.lecturaManual,
    motivoOperador: e.motivoOperador,
    notaMotivo,
    evidenciaTipo: e.evidenciaTipo,
    evidenciaNota: textoOpcional(e.evidenciaNota, 300),
  };
}

function actorPublico(actor) {
  if (!actor || !actor.uid) {
    throw new Error("validacionRemota: falta el actor verificado");
  }
  return {
    uid: actor.uid,
    nombre: actor.nombre || null,
    correo: actor.correo || null,
    rol: actor.rol || null,
    puesto: actor.puesto || null,
    area: actor.area || null,
    proyecto: actor.proyecto || "appadrematasainterno",
  };
}

async function ejecutarValidacionRemota({ db, FieldValue, actor, entrada }) {
  const quien = actorPublico(actor);
  const v = validarEntrada(entrada);
  const embarqueRef = db.collection(COL_REPO).doc(v.embarqueId);
  const bitacoraRef = db.collection(COL_BITACORA).doc();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(embarqueRef);
    if (!snap.exists) {
      throw new ErrorValidacion("not-found", "embarque_no_existe", "El embarque no existe.");
    }
    const emb = snap.data();

    const op = emb.operadorAsignado;
    if (!op || !op.uid) {
      throw new ErrorValidacion("failed-precondition", "sin_operador", "El embarque no tiene operador asignado.");
    }
    if (!emb.recepcionOperador || emb.recepcionOperador.resultado !== "COINCIDE") {
      throw new ErrorValidacion("failed-precondition", "checkpoint1_pendiente",
        "El operador todavía no completa el Checkpoint 1 (recepción) de este embarque.");
    }
    if (emb.destinoEscaneo || emb.estatusValidacion === "VALIDADO" || emb.estatusValidacion === "DISCREPANCIA") {
      throw new ErrorValidacion("failed-precondition", "ya_validado", "Este embarque ya tiene su Checkpoint 2 registrado.");
    }
    const uuidEsperado = norm(emb.uuidEsperado);
    const rfcEsperado = norm(emb.receptorRFCEsperado);
    if (!uuidEsperado || !rfcEsperado) {
      throw new ErrorValidacion("failed-precondition", "sin_factura_esperada", "El embarque no tiene su factura esperada.");
    }

    const uuidOk = uuidEsperado === v.uuidLeido;
    const rfcOk = rfcEsperado === v.rfcLeido;
    const coincide = uuidOk && rfcOk;
    const estatus = coincide ? "VALIDADO" : "DISCREPANCIA";
    const detalle = coincide ? null : (!uuidOk
      ? "UUID de CFDI no coincide con el esperado"
      : "RFC receptor no coincide con el esperado");

    const enNombreDe = { uid: op.uid, nombre: op.nombre || null, numero: op.numero || null };
    const evidencia = { tipo: v.evidenciaTipo, nota: v.evidenciaNota };

    // 1) Embarque: misma forma que escribe la app + campos nuevos de auditoría.
    tx.update(embarqueRef, {
      destinoEscaneo: {
        uuidCfdi: v.uuidLeido,
        rfcReceptor: v.rfcLeido,
        escaneadoPor: { uid: op.uid },
        timestamp: FieldValue.serverTimestamp(),
        metodo: "remoto_operaciones",
        validacionRemota: {
          por: quien,
          enNombreDe,
          motivoOperador: v.motivoOperador,
          notaMotivo: v.notaMotivo,
          lecturaManual: v.lecturaManual,
          evidencia,
          bitacoraId: bitacoraRef.id,
        },
      },
      estatusValidacion: estatus,
      validadoPor: op.uid,
      discrepanciaDetalle: detalle,
    });

    // 2) Bitácora (solo se agrega, nunca se edita). Misma transacción: no
    //    puede existir la validación sin su registro, ni al revés.
    tx.set(bitacoraRef, {
      embarqueId: snap.id,
      shipment: emb.shipment || null,
      ocCliente: emb.ocCliente || null,
      caja: emb.caja || null,
      checkpoint: "pre_entrega",
      metodo: "remoto_operaciones",
      creadoEn: FieldValue.serverTimestamp(),
      realizadoPor: quien,
      enNombreDe,
      resultado: estatus,
      discrepanciaDetalle: detalle,
      esperado: { uuid: uuidEsperado, rfc: rfcEsperado },
      leido: { uuid: v.uuidLeido, rfc: v.rfcLeido },
      lecturaManual: v.lecturaManual,
      motivoOperador: v.motivoOperador,
      notaMotivo: v.notaMotivo,
      evidencia,
      estatusAnterior: emb.estatusValidacion || null,
    });

    return { ok: true, estatusValidacion: estatus, discrepanciaDetalle: detalle, bitacoraId: bitacoraRef.id };
  });
}

module.exports = {
  ejecutarValidacionRemota, ErrorValidacion,
  MOTIVOS_OPERADOR, TIPOS_EVIDENCIA, COL_REPO, COL_BITACORA,
};
