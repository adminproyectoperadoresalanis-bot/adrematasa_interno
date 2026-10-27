// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/public/js/rentabilidadPdf.js
// ##########################################################################
// Lector de facturas de Autotransportes Alanis (PDF del CFDI 4.0 con Carta
// Porte 3.1, el formato de siempre: FAIM-…/TAIM-…). 2026-10-28.
//
// Módulo puro: no toca Firebase ni el DOM. Recibe las palabras de cada página
// (texto + posición x/y, como las entrega pdf.js) y regresa un objeto con todos
// los datos. Se ubica cada dato por su ETIQUETA ("Cliente:", "IMPORTE",
// "Distancia Recorrida"…) y la posición relativa a ella, no por coordenadas
// fijas, porque las columnas se mueven unos puntos de una factura a otra.
// ============================================================================

const ETIQUETAS_BLOQUE = [
  "Cliente:", "Calle:", "No:", "Colonia:", "Municipio:", "CP:", "RFC:", "Remitente:", "Estado:", "País:",
  "Referencia:", "Se recoge en:", "Valor Declarado:", "Residencia Fiscal:", "Uso CFDI:", "Forma de Pago:",
  "Metodo de pago:", "No. Cuenta", "Regimen Fiscal", "Destinatario:", "Se entrega en:",
];
const CAMPO = {
  "Cliente:": "nombre", "Remitente:": "nombre", "Destinatario:": "nombre",
  "Calle:": "calle", "No:": "numero", "Colonia:": "colonia", "Municipio:": "municipio", "CP:": "cp", "RFC:": "rfc",
  "Estado:": "estado", "País:": "pais", "Referencia:": "referencia",
  "Se recoge en:": "seRecogeEn", "Se entrega en:": "seEntregaEn",
  "Valor Declarado:": "valorDeclarado", "Residencia Fiscal:": "residenciaFiscal", "Uso CFDI:": "usoCfdi",
  "Forma de Pago:": "formaPago", "Metodo de pago:": "metodoPago", "No. Cuenta": "noCuenta", "Regimen Fiscal": "regimenFiscal",
};

const mismaFila = (a, b, tol = 2.5) => Math.abs(a.y - b.y) <= tol;
const unir = (items) => items.sort((a, b) => b.y - a.y || a.x - b.x).map(i => i.s).join(" ").replace(/\s+/g, " ").trim();
export function aNumero(t) {
  const n = Number(String(t || "").replace(/[$,\s]/g, "").replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : null;
}
const r2 = (n) => Math.round(n * 100) / 100;

function buscar(items, texto, opciones = {}) {
  const lista = items.filter(i => opciones.empieza ? i.s.startsWith(texto) : i.s === texto);
  return opciones.todos ? lista : (lista[0] || null);
}
function textoPagina(items) {
  const filas = [];
  [...items].sort((a, b) => b.y - a.y || a.x - b.x).forEach(i => {
    const f = filas.find(f => mismaFila(f[0], i));
    if (f) f.push(i); else filas.push([i]);
  });
  return filas.map(f => f.sort((a, b) => a.x - b.x).map(i => i.s).join(" ")).join("\n");
}

// Valor a la derecha de una etiqueta, en su misma fila, hasta la siguiente etiqueta.
function valorDerecha(items, etiqueta, etiquetasFila) {
  const siguiente = items.filter(i => mismaFila(i, etiqueta) && i.x > etiqueta.x && etiquetasFila.has(i))
    .sort((a, b) => a.x - b.x)[0];
  const limite = siguiente ? siguiente.x : Infinity;
  return unir(items.filter(i => mismaFila(i, etiqueta) && i.x > etiqueta.x && i.x < limite && !etiquetasFila.has(i)));
}

// Columnas por encabezado: cada item va a la columna cuyo inicio (x - margen) es el último <= item.x.
function asignarColumnas(filaItems, encabezados, margen = 26) {
  const cols = encabezados.map(() => []);
  filaItems.forEach(it => {
    let k = -1;
    encabezados.forEach((h, idx) => { if (h.x - margen <= it.x) k = idx; });
    if (k >= 0) cols[k].push(it);
  });
  return cols.map(c => unir(c));
}

// ---------------------------------------------------------------------------
function leerPagina1(items) {
  const res = { errores: [] };
  const todo = textoPagina(items);

  const mFac = todo.match(/Factura:\s*([A-Z]+-\d+)\s*\/\s*([A-Z]+-\d+)/);
  res.factura = mFac ? mFac[1] : "";
  res.cartaPorteFolio = mFac ? mFac[2] : "";
  const mFecha = todo.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (mFecha) {
    const [, mes, dia, anio, hh, mi] = mFecha;
    res.fecha = `${anio}-${mes}-${dia}`;
    res.hora = `${hh}:${mi}`;
  }
  const mViaje = todo.match(/Viaje:\s*(\d+)/);
  res.viaje = mViaje ? mViaje[1] : "";
  const mLugar = todo.match(/Lugar de Expedici[oó]n:\s*(.+)/);
  res.lugarExpedicion = mLugar ? mLugar[1].trim() : "";

  // ---- Cliente / Remitente / Destinatario ----
  const eCliente = buscar(items, "Cliente:");
  const eRemitente = buscar(items, "Remitente:");
  const eVersion = buscar(items, "Versión CFDI:");
  if (!eCliente || !eRemitente || !eVersion) {
    res.errores.push("No encontré los bloques de Cliente / Remitente / Destinatario.");
  } else {
    const zona = items.filter(i => i.y <= eCliente.y + 2 && i.y > eVersion.y + 2);
    const etiquetas = new Set(zona.filter(i => ETIQUETAS_BLOQUE.includes(i.s)));
    const xDerecha = (buscar(zona, "Destinatario:") || { x: 250 }).x - 10;
    res.cliente = {}; res.fiscal = {}; res.remitente = {}; res.destinatario = {};
    etiquetas.forEach(et => {
      const valor = valorDerecha(zona, et, etiquetas);
      const izquierda = et.x < xDerecha;
      const enCliente = et.y > eRemitente.y + 2;
      const destino = enCliente ? (izquierda ? res.cliente : res.fiscal) : (izquierda ? res.remitente : res.destinatario);
      destino[CAMPO[et.s]] = valor;
    });
  }

  // ---- Versión, moneda, tipo de cambio, condiciones ----
  if (eVersion) {
    const fila = items.filter(i => mismaFila(i, eVersion));
    const nombres = ["Versión CFDI:", "Tipo Moneda:", "Tipo Cambio:", "Tipo Exportacion:", "Condiciones de Pago:"];
    const ets = new Set(fila.filter(i => nombres.includes(i.s)));
    const v = (n) => { const e = [...ets].find(i => i.s === n); return e ? valorDerecha(fila, e, ets) : ""; };
    res.versionCfdi = v("Versión CFDI:");
    res.moneda = (v("Tipo Moneda:") || "").toUpperCase();
    res.tipoCambio = aNumero(v("Tipo Cambio:")) || 1;
    res.tipoExportacion = v("Tipo Exportacion:");
    res.condicionesPago = v("Condiciones de Pago:");
  }

  // ---- Conceptos (columna IMPORTE) ----
  const hCant = buscar(items, "CANTIDAD");
  const hImporte = buscar(items, "IMPORTE");
  const eSubtotal = buscar(items, "SUBTOTAL");
  res.conceptos = [];
  if (!hCant || !hImporte || !eSubtotal) {
    res.errores.push("No encontré la tabla de conceptos (CANTIDAD … IMPORTE).");
  } else {
    const filaH = items.filter(i => mismaFila(i, hCant));
    const clas = filaH.filter(i => i.s.startsWith("CLA")).sort((a, b) => a.x - b.x);
    const enc = [
      hCant, clas[0], clas[1], buscar(filaH, "SERVICIO"), buscar(filaH, "Objeto Impuesto"), buscar(filaH, "P.UNITARIO"), hImporte,
    ];
    if (enc.some(e => !e)) {
      res.errores.push("La fila de títulos de los conceptos no viene completa.");
    } else {
      const cuerpo = items.filter(i => i.y < hCant.y - 2 && i.y > eSubtotal.y + 2);
      const filas = [];
      cuerpo.sort((a, b) => b.y - a.y).forEach(i => {
        const f = filas.find(f => mismaFila(f[0], i));
        if (f) f.push(i); else filas.push([i]);
      });
      filas.forEach(f => {
        const [cantidad, claveProdServ, claveUnidad, servicio, objetoImpuesto, pUnitario, importe] = asignarColumnas(f, enc, 6);
        if (!servicio && !importe) return;
        res.conceptos.push({
          cantidad: aNumero(cantidad), claveProdServ, claveUnidad, servicio, objetoImpuesto,
          pUnitario: aNumero(pUnitario), importe: aNumero(importe),
        });
      });
    }
    // ---- Totales ----
    const xValor = hImporte.x - 6;
    const xEtiqueta = buscar(items, "P.UNITARIO") ? buscar(items, "P.UNITARIO").x - 6 : eSubtotal.x - 6;
    const filaTotal = (it) => {
      const f = items.filter(i => mismaFila(i, it) && i.x >= xEtiqueta);
      return { etiqueta: unir(f.filter(i => i.x < xValor)), valor: aNumero(unir(f.filter(i => i.x >= xValor))) };
    };
    const etiquetasTot = items.filter(i => i.x >= xEtiqueta && i.x < xValor && i.y <= eSubtotal.y + 2 && i.y > eSubtotal.y - 70)
      .filter(i => /^(SUBTOTAL|IVA|RETENCION|TOTAL)/.test(i.s));
    res.subtotal = filaTotal(eSubtotal).valor;
    etiquetasTot.forEach(e => {
      const t = filaTotal(e);
      if (/^IVA/.test(t.etiqueta)) res.iva = t;
      else if (/^RETENCION/.test(t.etiqueta)) res.retencion = t;
      else if (/^TOTAL/.test(t.etiqueta)) res.total = t.valor;
    });
  }

  // ---- Cantidad con letra / Observaciones ----
  ["CANTIDAD CON LETRA:", "OBSERVACIONES:"].forEach(n => {
    const e = buscar(items, n);
    if (e) res[n === "OBSERVACIONES:" ? "observaciones" : "totalLetra"] = unir(items.filter(i => mismaFila(i, e) && i.x > e.x));
  });

  // ---- Unidad / Remolque / Sello / Operador / Licencia / RFC / Ingreso ----
  const eUnidad = buscar(items, "Unidad:");
  if (eUnidad) {
    const nombres = ["Unidad:", "Remolque:", "Sello:", "Operador:", "No. Licencia:", "RFC:", "Ingreso:"];
    const enc = nombres.map(n => items.find(i => i.s === n && mismaFila(i, eUnidad))).filter(Boolean).sort((a, b) => a.x - b.x);
    const banda = items.filter(i => i.y < eUnidad.y - 2 && i.y > eUnidad.y - 32);
    const vals = asignarColumnas(banda, enc, 6);
    const campos = { "Unidad:": "unidad", "Remolque:": "remolque", "Sello:": "sello", "Operador:": "operador", "No. Licencia:": "licencia", "RFC:": "rfcOperador", "Ingreso:": "ingreso" };
    enc.forEach((e, k) => { res[campos[e.s]] = vals[k]; });
  }

  // ---- Timbre ----
  const mUuid = todo.match(/Folio Fiscal:\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/);
  res.uuid = mUuid ? mUuid[1].toLowerCase() : "";
  const mCert = todo.match(/Fecha y Hora Certificaci[oó]n:\s*(\S+)/);
  res.fechaCertificacion = mCert ? mCert[1] : "";
  return res;
}

// ---------------------------------------------------------------------------
function leerCartaPorte(items) {
  const cp = {};
  const todo = textoPagina(items);
  const mKm = todo.match(/([\d,]+(?:\.\d+)?)\s*Kms/i);
  cp.distanciaKm = mKm ? aNumero(mKm[1]) : null;

  // Fila: Tipo de transporte / País / Vía / Distancia / Pesos / Total mercancía
  const kms = items.find(i => /\d\s*Kms$/i.test(i.s));
  if (kms) {
    const fila = items.filter(i => mismaFila(i, kms)).sort((a, b) => a.x - b.x);
    if (fila.length >= 8) {
      const v = fila.map(i => i.s);
      Object.assign(cp, {
        transporteInternacional: v[0], paisOrigenDestino: v[1], viaTransporte: v[2],
        pesoBrutoTotal: aNumero(v[4]), pesoBrutoVehicular: v[5], pesoNetoTotal: aNumero(v[6]), totalMercancia: aNumero(v[7]),
      });
    }
  }

  // Fila: ID CCP / Pedimento / Documento aduanero / RFC importador
  const ePed = buscar(items, "Pedimento:");
  if (ePed) {
    const nombres = ["ID CCP:", "Pedimento:", "Documento Aduanero:", "RFC Importador:"];
    const enc = nombres.map(n => items.find(i => i.s === n && mismaFila(i, ePed))).filter(Boolean).sort((a, b) => a.x - b.x);
    const banda = items.filter(i => i.y < ePed.y - 8 && i.y > ePed.y - 30);
    const vals = asignarColumnas(banda, enc, 26).map(v => v.replace(/\s+/g, " "));
    const campos = { "ID CCP:": "idCcp", "Pedimento:": "pedimento", "Documento Aduanero:": "documentoAduanero", "RFC Importador:": "rfcImportador" };
    enc.forEach((e, k) => { cp[campos[e.s]] = vals[k].replace(/- /g, "-"); });
  }

  // Fila: Permiso SCT / Número / Aseguradora / Póliza / Configuración / Placas / Año
  const ePerm = buscar(items, "Permiso SCT:");
  if (ePerm) {
    const nombres = ["Permiso SCT:", "Numero de Permiso SCT:", "Aseguradora:", "Número de Poliza:", "Vehicular/Tipo de", "Placas Unidad/Remolque:", "Año:"];
    const enc = nombres.map(n => items.find(i => i.s === n && mismaFila(i, ePerm))).filter(Boolean).sort((a, b) => a.x - b.x);
    const banda = items.filter(i => i.y < ePerm.y - 12 && i.y > ePerm.y - 34);
    const vals = asignarColumnas(banda, enc, 26);
    const campos = { "Permiso SCT:": "permisoSct", "Numero de Permiso SCT:": "numeroPermisoSct", "Aseguradora:": "aseguradora", "Número de Poliza:": "poliza", "Vehicular/Tipo de": "configuracion", "Placas Unidad/Remolque:": "placas", "Año:": "anio" };
    enc.forEach((e, k) => { cp[campos[e.s]] = vals[k]; });
  }

  // Fechas de salida y llegada (Origen / Destino)
  ["Origen:", "Destino:"].forEach(n => {
    // "Destino:" también aparece en el título "País Origen / Destino:"; el bueno es el de la izquierda.
    const e = buscar(items, n, { todos: true }).sort((a, b) => a.x - b.x)[0];
    if (!e) return;
    const cerca = items.filter(i => Math.abs(i.y - e.y) <= 6);
    const f = cerca.find(i => /^\d{4}-\d{2}-\d{2}$/.test(i.s));
    const h = cerca.find(i => /^\d{2}:\d{2}:\d{2}$/.test(i.s));
    cp[n === "Origen:" ? "fechaSalida" : "fechaLlegada"] = f ? `${f.s}${h ? " " + h.s.slice(0, 5) : ""}` : "";
  });
  return cp;
}

// ---------------------------------------------------------------------------
// Ruta municipio → municipio: "027-Nuevo Laredo" → "Nuevo Laredo".
function municipioLimpio(m) {
  return String(m || "").replace(/^\d+\s*-\s*/, "").trim();
}
const MINUSCULAS = new Set(["de", "del", "la", "las", "los", "y", "el"]);
function tituloCase(t) {
  return String(t || "").toLowerCase().split(" ").map((p, i) =>
    i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}
export function lugar(p) {
  if (!p) return "";
  // En EUA el municipio trae el estado pegado ("LAREDO TX", "JACKSON, MS"): se quita.
  const mun = tituloCase(municipioLimpio(p.municipio).replace(/,?\s+[A-Z]{2}$/, ""));
  const edo = tituloCase(p.estado);
  return [mun, edo].filter(Boolean).join(", ");
}

// Cálculos: flete (principal) y subtotal, en MXN y por km.
export function calcular(f) {
  const tc = f.moneda === "MXN" ? 1 : (f.tipoCambio || 1);
  const flete = r2((f.conceptos || []).filter(c => /^FLETE\b/i.test(c.servicio || "")).reduce((s, c) => s + (c.importe || 0), 0));
  const subtotal = f.subtotal != null ? f.subtotal : r2((f.conceptos || []).reduce((s, c) => s + (c.importe || 0), 0));
  const km = f.cartaPorte && f.cartaPorte.distanciaKm ? f.cartaPorte.distanciaKm : null;
  const fleteMxn = r2(flete * tc), subtotalMxn = r2(subtotal * tc);
  return {
    flete, subtotal, fleteMxn, subtotalMxn,
    totalMxn: f.total != null ? r2(f.total * tc) : null,
    km,
    fletePorKm: km ? r2(fleteMxn / km) : null,
    subtotalPorKm: km ? r2(subtotalMxn / km) : null,
  };
}

// paginas: [[{s, x, y}], …]
export function leerFactura(paginas) {
  const p1 = paginas[0] || [];
  const f = leerPagina1(p1);
  const iCp = paginas.findIndex(p => p.some(i => i.s === "CARTA PORTE"));
  f.cartaPorte = iCp >= 0 ? leerCartaPorte(paginas[iCp]) : {};
  if (!f.uuid) f.errores.push("No encontré el Folio Fiscal (UUID).");
  if (!f.conceptos.length) f.errores.push("No encontré conceptos.");
  if (!f.cartaPorte.distanciaKm) f.errores.push("No encontré la Distancia Recorrida (km) en la Carta Porte.");
  const suma = r2(f.conceptos.reduce((s, c) => s + (c.importe || 0), 0));
  if (f.subtotal != null && Math.abs(suma - f.subtotal) > 0.05) {
    f.errores.push(`La suma de los conceptos ($${suma}) no cuadra con el SUBTOTAL ($${f.subtotal}).`);
  }
  f.origen = lugar(f.remitente);
  f.destino = lugar(f.destinatario);
  f.ruta = f.origen && f.destino ? `${f.origen} → ${f.destino}` : "";
  f.calculos = calcular(f);
  return f;
}

// Con pdf.js (window.pdfjsLib en el navegador): ArrayBuffer → páginas de palabras.
export async function paginasDePdf(pdfjsLib, datos) {
  const doc = await pdfjsLib.getDocument({ data: datos }).promise;
  const paginas = [];
  for (let n = 1; n <= Math.min(doc.numPages, 4); n++) {
    const p = await doc.getPage(n);
    const c = await p.getTextContent();
    paginas.push(c.items.filter(i => i.str && i.str.trim()).map(i => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5] })));
  }
  return paginas;
}