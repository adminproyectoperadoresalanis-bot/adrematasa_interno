// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/functions/espejosOperadoresComun.js
// ##########################################################################
// ============================================================================
// Espejos en vivo Alanis Operadores → ADREMATASA (2026-10-16).
//
// ESTE ARCHIVO ES IDÉNTICO EN LOS DOS PROYECTOS (verificar con md5sum):
//   - alanis-operadores/alanis-app-v2/functions/espejosOperadoresComun.js
//     (lo usan los triggers de espejosAdrematasa.js: copian cada cambio)
//   - adrematasa_interno/functions/espejosOperadoresComun.js
//     (lo usa poblarEspejosOperadores: la copia inicial / resincronizar)
// Si se cambia, se cambia en los dos y se despliegan ambos lados.
//
// Cada función recibe los datos del documento original y regresa lo que se
// guarda en el espejo, o null si ese documento NO debe tener espejo (en cuyo
// caso el espejo se borra). Solo se copian los campos que usan las pantallas
// de ADREMATASA (nada de GPS, fotos ni datos que no se muestran).
// ============================================================================

const COL = {
  solicitudes: "espejo_op_solicitudes",   // {uid}  solicitudes de ingreso PENDIENTES
  operadores: "espejo_op_operadores",     // {uid}  usuarios con rol operador (activos e inactivos)
  ordenes: "espejo_op_ordenes",           // {id}   ordenes_trabajo
  asignaciones: "espejo_op_asignaciones", // {id}   asignaciones de viaje
  estatus: "espejo_op_estatus",           // {uid}  ÚLTIMO estatus de patio de cada operador
  eventosViaje: "espejo_op_eventos_viaje", // {id}  cada reporte de VIAJE (2026-10-31, Tráfico → Actualizaciones)
};

// Estatus de viaje que reporta el operador (2026-10-31): van a Tráfico → Actualizaciones.
const ESTATUS_VIAJE = ["incidencia_viaje", "arribo_destino", "fin_descarga"];
// "liberado_taller" (2026-10-19): lo escribe el servidor al terminar la última OT abierta.
const ESTATUS_PATIO = ["disponible", "taller", "enfermo", "permiso", "vacaciones", "incapacitado", "liberado_taller"];
const TIPOS_RUTA = ["larga", "corta", "local", "circuito"]; // circuito: 2026-10-22

function ms(ts) {
  if (!ts) return null;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (ts instanceof Date) return ts.getTime();
  return null;
}
const txt = (v) => (v == null ? "" : String(v));

function solicitud(d) {
  if (!d || d.estado !== "pendiente") return null;
  return {
    nombre: txt(d.nombre),
    correo: txt(d.correo),
    unidad: txt(d.unidad),
    lada: d.lada === "1" ? "1" : "52",
    telefono: txt(d.telefono),
    timestampMs: ms(d.timestamp),
  };
}

function operador(d) {
  if (!d || d.rol !== "operador") return null;
  return {
    nombre: txt(d.nombre),
    nombreOficial: txt(d.nombreOficial),
    correo: txt(d.correo),
    numero: txt(d.numero),
    tipoRuta: TIPOS_RUTA.includes(d.tipoRuta) ? d.tipoRuta : null,
    lada: d.lada === "1" ? "1" : "52",
    telefono: txt(d.telefono),
    activo: d.activo === true,
  };
}

function orden(d) {
  if (!d) return null;
  return {
    folio: txt(d.folio),
    uid: txt(d.uid),
    operador: txt(d.operador),
    unidad: txt(d.unidad || d.numero),
    fecha: txt(d.fecha),
    hora: txt(d.hora),
    fallas: (Array.isArray(d.fallas) ? d.fallas : []).filter(Boolean).map((f) => ({
      id: typeof f.id === "number" ? f.id : null,
      cat: txt(f.cat),
      name: txt(f.name),
      sev: txt(f.sev),
      custom: !!f.custom,
    })),
    creadaDesde: d.creadaDesde || null,
    creadoPorNombre: (d.creadoPorAdrematasa && d.creadoPorAdrematasa.nombre) || null,
    timestampMs: ms(d.timestamp),
    // Control de taller (2026-10-19): 'abierta' | 'terminada' | null (OTs viejas).
    estado: d.estado === "abierta" || d.estado === "terminada" ? d.estado : null,
    terminadaMs: ms(d.terminadaEn),
    terminadaPorNombre: (d.terminadaPor && d.terminadaPor.nombre) || null,
    comentarioCierre: txt(d.comentarioCierre),
  };
}

function asignacion(d) {
  if (!d) return null;
  return {
    uidOperador: txt(d.uid_operador),
    operadorNombre: txt(d.operador_nombre),
    unidad: txt(d.unidad),
    remolque: txt(d.remolque),
    linea: txt(d.linea),
    cliente: txt(d.cliente),
    destino: txt(d.destino),
    cita: txt(d.cita),
    estado: txt(d.estado) || "pendiente",
    motivoRechazo: txt(d.motivo_rechazo),
    creadaDesde: d.creadaDesde || null,
    timestampMs: ms(d.timestamp),
    // Tráfico → Asignación (2026-10-27)
    respuestaMs: ms(d.fecha_respuesta),
    asignadoPorNombre: (d.asignadoPor && d.asignadoPor.nombre) || null,
    canceladaMs: ms(d.canceladaEn),
    canceladaPorNombre: (d.canceladaPor && d.canceladaPor.nombre) || null,
    motivoCancelacion: txt(d.motivo_cancelacion),
  };
}

// De un documento de eventos: solo los estatus de PATIO cuentan para Turnos.
function estatus(ev) {
  if (!ev || !ev.uid) return null;
  const id = ev.estatus || (Array.isArray(ev.estatus_ids) ? ev.estatus_ids[0] : "");
  if (!ESTATUS_PATIO.includes(id)) return null;
  return {
    id,
    ms: ms(ev.timestamp),
    fecha: txt(ev.fecha),
    hora: txt(ev.hora),
    fechaRegreso: txt(ev.fecha_regreso || ev.vac_fin),
    autorizo: txt(ev.autorizo),
    dias: txt(ev.dias_incapacidad),
    fallas: (Array.isArray(ev.fallas) ? ev.fallas : []).map((f) => f && f.name).filter(Boolean).slice(0, 5),
  };
}

// De un documento de eventos: los reportes de VIAJE (incidencia, arribo, fin
// de descarga; pueden venir combinados). Aquí sí va la ubicación GPS, porque
// Tráfico la usa para ubicar el viaje.
function eventoViaje(ev) {
  if (!ev || !ev.uid) return null;
  const ids = (Array.isArray(ev.estatus_ids) && ev.estatus_ids.length ? ev.estatus_ids : [ev.estatus]).filter((x) => ESTATUS_VIAJE.includes(x));
  if (!ids.length) return null;
  const g = ev.gps || {};
  const lat = Number(g.lat != null ? g.lat : g.latitude);
  const lng = Number(g.lng != null ? g.lng : (g.lon != null ? g.lon : g.longitude));
  const hayGps = isFinite(lat) && isFinite(lng) && !(lat === 0 && lng === 0);
  return {
    uid: txt(ev.uid),
    operador: txt(ev.operador),
    numero: txt(ev.numero),
    ids,
    etiqueta: txt(ev.estatus_label),
    ms: ms(ev.timestamp),
    fecha: txt(ev.fecha),
    hora: txt(ev.hora),
    comentario: txt(ev.incidencia_desc || ev.observaciones).slice(0, 500),
    lat: hayGps ? lat : null,
    lng: hayGps ? lng : null,
    viajeId: txt(ev.viaje_id),
  };
}

module.exports = { COL, ESTATUS_PATIO, ESTATUS_VIAJE, solicitud, operador, orden, asignacion, estatus, eventoViaje };