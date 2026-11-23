// ##########################################################################
// PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
// RUTA:     /workspaces/adrematasa_interno/public/js/analisisGrafica.js
// ##########################################################################
// Utilidades › Análisis de gráfica (2026-11-21, pedido de Ivan).
// Marcador de eventos sobre lecturas Thermo King/TracKing:
//   - Carga un PDF de TracKing (página 1, con pdf.js 3.11.174 de cdnjs, solo
//     cuando se sube un PDF) o una imagen (también arrastrar o pegar).
//   - Del PDF toma la unidad y el periodo del título y recorta la gráfica.
//   - Calibración automática: líneas punteadas verticales de la cuadrícula con
//     separación de 12, 24, 6, 48 o 3 h que cuadre con el periodo. Si no
//     cuadra, calibración manual con dos puntos (A y B).
//   - 6 eventos con fecha y hora; cada uno pinta una banda amarilla
//     (marcatextos) con su etiqueta. Fuera del periodo: avisa y no pinta.
//   - Exporta PNG (copiar o descargar).
//   - Imagen: lee el título con OCR (tesseract.js 5.1.1 de jsdelivr, solo
//     cuando se sube una imagen) para sacar unidad y periodo (2026-11-21).
//   - "Pegar de Adrematasa": pega el renglón del Adrematasa oficial (con
//     encabezados) y llena Entrada/Salida patio, Arribo y Descarga importación,
//     y la unidad (Remolque) (2026-11-21).
// Horas "naive": la hora capturada es la hora de la gráfica (sin zonas).
// No lee ni guarda nada en Firestore. Quién la ve: tabla de accesos por área
// (Configuración › Acceso a Utilidades). Estilo de la app (café/crema).
// Sustituye al HTML suelto que se armó en otro chat (marcadorThermoKing.html).

const EVENTOS = [
  { etiqueta: "Carga en planta", marca: "CARGA EN PLANTA" },
  { etiqueta: "Entrega AA/Transbordo", marca: "ENTREGA AA/TRANSBORDO" },
  { etiqueta: "Entrada patio", marca: "ENTRADA PATIO" },
  { etiqueta: "Salida patio", marca: "SALIDA PATIO" },
  { etiqueta: "Arribo importación", marca: "ARRIBO IMPORTACION" },
  { etiqueta: "Descarga importación", marca: "DESCARGA IMPORTACION" }
];
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
const TESSERACT = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const TESS_IDIOMA = "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int";
// Columnas del Adrematasa oficial → evento (índice en EVENTOS).
const COLUMNAS_ADREMATASA = { "entrada": 2, "salida": 3, "arribo impo": 4, "descarga": 5 };
const normal = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// Periodo y unidad del título de TracKing: "...vehicle 24040 for period 11/13/2026 7:00 AM to 11/21/2026 9:06 AM".
function datosDelTitulo(txt) {
  const veh = /vehicle\s+([A-Za-z0-9-]+)/i.exec(txt || "");
  const re = /(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})\s+(\d{1,2})\s*[:.]\s*(\d{2})\s*([AP])\.?\s*M/gi, m = []; let q;
  while ((q = re.exec(txt || "")) && m.length < 2) m.push(q);
  const mk = (x) => { const a = +x[1], bb = +x[2]; const dmy = a > 12; const mo = dmy ? bb : a, da = dmy ? a : bb; let h = +x[4] % 12; if (/P/i.test(x[6])) h += 12; return Date.UTC(+x[3], mo - 1, da, h, +x[5]); };
  const ini = m.length === 2 ? mk(m[0]) : null, fin = m.length === 2 ? mk(m[1]) : null;
  return { unidad: veh ? veh[1] : "", ini, fin: fin != null && ini != null && fin > ini ? fin : null };
}
// Fecha del Adrematasa oficial: "18/11/2026 07:26 p. m." (día/mes/año; también 24 h).
function fechaAdrematasa(v) {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(?:([ap])\.?\s*m\.?)?/i.exec(String(v || ""));
  if (!m) return null;
  let h = +m[4];
  if (m[6]) { h = h % 12; if (/p/i.test(m[6])) h += 12; }
  return Date.UTC(+m[3], +m[2] - 1, +m[1], h, +m[5]);
}
// Pegado con encabezados (separado por tabuladores). Regresa [{ remolque, cliente, destino, operador, carro, fechas: {i: ms} }].
function leerPegadoAdrematasa(texto) {
  const lineas = String(texto || "").split(/\r?\n/).filter((l) => l.trim());
  const iEnc = lineas.findIndex((l) => /remolque/i.test(l) && /entrada/i.test(l));
  if (iEnc < 0) return { error: "No encontré los encabezados (Remolque, Entrada, Salida…). Copia también el renglón de títulos." };
  const enc = lineas[iEnc].split("\t").map(normal);
  const col = (nombre) => enc.indexOf(nombre);
  const filas = lineas.slice(iEnc + 1).map((l) => l.split("\t")).filter((c) => c.some((x) => x.trim()));
  if (!filas.length) return { error: "Faltan los datos: copia los títulos y al menos un renglón." };
  const dato = (c, n) => { const i = col(n); return i >= 0 ? String(c[i] || "").trim() : ""; };
  return {
    filas: filas.map((c) => {
      const fechas = {};
      Object.entries(COLUMNAS_ADREMATASA).forEach(([n, i]) => { const ms = fechaAdrematasa(dato(c, n)); if (ms != null) fechas[i] = ms; });
      return { remolque: dato(c, "remolque"), cliente: dato(c, "cliente"), destino: dato(c, "destino"), operador: dato(c, "operador 1"), carro: dato(c, "carro1"), despacho: dato(c, "fecha despacho"), fechas };
    })
  };
}
const FUENTE = "-apple-system,'Segoe UI',Roboto,Arial,sans-serif";
const HORA = 3600000, DIA = 86400000;
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const pad = (n) => String(n).padStart(2, "0");
const aMs = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || ""); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null; };
const aValor = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const fmt = (ms) => { const d = new Date(ms); return `${DIAS[d.getUTCDay()]} ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const fmtLargo = (ms) => { const d = new Date(ms); return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ICONO_MIRA = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="3.2"/><path d="M8 1v3M8 12v3M1 8h3M12 8h3"/></svg>`;
const ICONO_BORRAR = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>`;
const ICONO_SUBIR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;

const ESTILOS = `
.ag [hidden]{display:none !important;}
.ag{--ag-cafe:#2c1e0f;--ag-crema:#f5f3f0;--ag-gris:#6b5f52;--ag-linea:#e2ddd5;--ag-ok:#3B7A1E;--ag-okf:#EAF3DE;--ag-av:#7a3e06;--ag-avf:#FBE3A8;--ag-hl:#ffe600;--ag-hlb:#b89b00;}
.ag-top{display:flex;gap:12px;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;margin-bottom:14px;}
.ag-top h2{margin:0;}
.ag-meta{margin:4px 0 0;color:var(--ag-gris);font-size:13px;}
.ag-acciones{display:flex;gap:8px;flex-wrap:wrap;}
.ag-rejilla{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:16px;align-items:start;}
@media (max-width:980px){.ag-rejilla{grid-template-columns:minmax(0,1fr);}}
.ag-zona{border:1px solid var(--ag-linea);border-radius:12px;padding:10px;background:#fff;min-width:0;}
.ag-zona.arrastrando{outline:2px dashed var(--ag-cafe);outline-offset:-6px;}
.ag-escena{position:relative;line-height:0;border-radius:8px;overflow:hidden;background:#fff;}
.ag-escena canvas{display:block;width:100%;height:auto;touch-action:manipulation;}
.ag-escena canvas.eligiendo{cursor:crosshair;}
.ag-vacio{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:340px;border:2px dashed var(--ag-linea);border-radius:10px;color:var(--ag-gris);text-align:center;padding:24px;line-height:1.45;cursor:pointer;}
.ag-vacio svg{width:38px;height:38px;color:var(--ag-cafe);}
.ag-vacio b{color:var(--ag-cafe);font-size:15px;}
.ag-guia{position:absolute;top:0;bottom:0;width:0;border-left:1px solid rgba(44,30,15,.55);pointer-events:none;display:none;}
.ag-tip{position:absolute;top:6px;pointer-events:none;display:none;background:var(--ag-cafe);color:#fff;font:600 12px ${FUENTE};padding:3px 8px;border-radius:6px;white-space:nowrap;line-height:1.3;}
.ag-aviso{position:absolute;left:8px;top:8px;right:8px;background:var(--ag-hl);color:#2b2400;border:1px solid var(--ag-hlb);border-radius:8px;padding:7px 10px;font:600 13px ${FUENTE};line-height:1.35;display:none;}
.ag-barra{display:flex;flex-wrap:wrap;gap:6px 16px;justify-content:space-between;margin-top:8px;color:var(--ag-gris);font-size:12.5px;line-height:1.4;}
.ag-lado{display:flex;flex-direction:column;gap:14px;min-width:0;}
.ag-caja{border:1px solid var(--ag-linea);border-radius:12px;padding:14px;background:#fff;}
.ag-caja h3{margin:0 0 4px;font-size:15px;color:var(--ag-cafe);}
.ag-caja .nota{margin:0 0 10px;}
.ag-dos{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;}
.ag-uno{display:flex;flex-direction:column;gap:8px;}
.ag-dos > label, .ag-campo{display:block;margin:0;font-size:12.5px;font-weight:600;color:var(--ag-gris);min-width:0;}
.ag input[type=datetime-local], .ag input[type=text], .ag input[type=number], .ag select{width:100%;box-sizing:border-box;margin-top:3px;font-size:13px;}
.ag-estado{font-size:12.5px;color:var(--ag-gris);margin-top:8px;line-height:1.45;}
.ag-estado.ok{color:var(--ag-ok);} .ag-estado.av{color:var(--ag-av);}
.ag-ev{padding:9px 0;border-top:1px solid #f1ece5;}
.ag-ev:first-of-type{border-top:none;padding-top:2px;}
.ag-ev-tit{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13.5px;font-weight:600;color:var(--ag-cafe);margin-bottom:5px;}
.ag-ev-tit span.sw{display:inline-block;width:11px;height:11px;border-radius:3px;background:var(--ag-hl);border:1px solid var(--ag-hlb);margin-right:7px;vertical-align:-1px;}
.ag-chip{font-size:11px;font-weight:700;padding:2px 8px;border-radius:9px;white-space:nowrap;background:#ECE9E4;color:#4a3e33;}
.ag-chip.ok{background:var(--ag-okf);color:var(--ag-ok);} .ag-chip.av{background:var(--ag-avf);color:var(--ag-av);}
.ag-ev-fila{display:flex;gap:6px;min-width:0;}
.ag-ev-fila input{flex:1;min-width:0;margin-top:0 !important;}
.ag-ico{appearance:none;width:36px;flex:none;border:1px solid var(--ag-linea);background:#fff;border-radius:8px;cursor:pointer;display:grid;place-items:center;color:var(--ag-cafe);padding:0;margin:0;}
.ag-ico:hover{border-color:var(--ag-cafe);}
.ag-ico[aria-pressed=true]{background:var(--ag-hl);border-color:var(--ag-hlb);}
.ag-ico svg{width:16px;height:16px;}
.ag button[aria-pressed=true]:not(.ag-ico){background:var(--ag-hl);border-color:var(--ag-hlb);color:#2b2400;}
.ag details summary{cursor:pointer;font-weight:600;font-size:14px;color:var(--ag-cafe);}
.ag-cal{display:flex;flex-direction:column;gap:10px;margin-top:10px;}
.ag-pt{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 8px;align-items:center;}
.ag-pt button{margin:0;}
.ag-px{grid-column:1/-1;font-size:12px;color:var(--ag-gris);}
.ag-fila-btn{display:flex;gap:8px;flex-wrap:wrap;}
.ag-fila-btn button{margin:0;}
.ag-export img{max-width:100%;height:auto;border:1px solid var(--ag-linea);border-radius:8px;background:#fff;}
.ag-toast{position:fixed;left:50%;bottom:calc(84px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:var(--ag-cafe);color:#fff;padding:8px 14px;border-radius:10px;font-size:13px;z-index:1000;display:none;max-width:90vw;text-align:center;}
`;

// tesseract.js se carga solo la primera vez que se sube una imagen; el worker
// se reutiliza (el idioma queda en caché del navegador).
let promesaOcr = null;
function obtenerOcr() {
  if (!promesaOcr) promesaOcr = new Promise((res, rej) => {
    const listo = () => window.Tesseract.createWorker("eng", 1, { langPath: TESS_IDIOMA }).then(res, rej);
    if (window.Tesseract) return listo();
    const s = document.createElement("script"); s.src = TESSERACT;
    s.onload = listo;
    s.onerror = () => rej(new Error("no se pudo cargar el lector de texto"));
    document.head.appendChild(s);
  }).catch((e) => { promesaOcr = null; throw e; });
  return promesaOcr;
}

function estilosUnaVez() {
  if (document.getElementById("ag-estilos")) return;
  const s = document.createElement("style");
  s.id = "ag-estilos";
  s.textContent = ESTILOS;
  document.head.appendChild(s);
}

export function iniciarAnalisisGrafica(contenedor) {
  estilosUnaVez();
  contenedor.innerHTML = `
    <section class="panel ag">
      <div class="ag-top">
        <div>
          <h2>Análisis de gráfica</h2>
          <p class="ag-meta" data-r="meta">Lectura Thermo King / TracKing · marca los eventos del viaje sobre la gráfica de temperatura.</p>
        </div>
        <div class="ag-acciones">
          <button type="button" data-r="btnCargar">Cargar PDF o imagen</button>
          <button type="button" class="secundario" data-r="btnExportar" disabled>Exportar imagen</button>
          <input type="file" data-r="archivo" accept="application/pdf,.pdf,image/*" hidden>
        </div>
      </div>
      <div class="ag-rejilla">
        <div class="ag-zona" data-r="zona">
          <div class="ag-vacio" data-r="vacio">
            ${ICONO_SUBIR}
            <b>Carga la lectura</b>
            <span>PDF de TracKing o imagen de la gráfica (captura, foto de WhatsApp).<br>Arrástrala aquí, pégala con Ctrl+V o usa “Cargar PDF o imagen”.</span>
          </div>
          <div class="ag-escena" data-r="escena" hidden>
            <canvas data-r="cv" aria-label="Gráfica Thermo King con eventos marcados"></canvas>
            <div class="ag-guia" data-r="guia"></div><div class="ag-tip" data-r="tip"></div><div class="ag-aviso" data-r="aviso"></div>
          </div>
          <div class="ag-barra"><span data-r="barraIzq"></span><span data-r="barraDer"></span></div>
        </div>

        <div class="ag-lado">
          <div class="ag-caja">
            <h3>Periodo de la lectura</h3>
            <p class="nota">Se lee solo del título de la gráfica (PDF o imagen) y la gráfica se calibra sola. Revísalo; si no lo lee, escríbelo.</p>
            <div class="ag-uno">
              <label class="ag-campo">Inicio<input type="datetime-local" step="60" data-r="perIni"></label>
              <label class="ag-campo">Fin<input type="datetime-local" step="60" data-r="perFin"></label>
            </div>
            <div class="ag-dos" style="margin-top:8px;">
              <label>Unidad<input type="text" data-r="unidad" placeholder="Ej. 24040" maxlength="30"></label>
              <label>Líneas verticales
                <select data-r="paso"><option value="auto">Automático</option><option value="12">Cada 12 h</option><option value="24">Cada 24 h</option><option value="6">Cada 6 h</option></select>
              </label>
            </div>
            <div class="ag-estado" data-r="calEstado"></div>
          </div>

          <div class="ag-caja">
            <h3>Eventos del viaje</h3>
            <p class="nota">Cada fecha pinta una marca amarilla. Con la mira ⌖ tomas la hora con un clic en la gráfica. Los vacíos no se dibujan. Entrada, salida, arribo y descarga se llenan con “Pegar de Adrematasa”.</p>
            <div class="ag-fila-btn" style="margin-bottom:8px;"><button type="button" data-r="pegarAdr">📋 Pegar de Adrematasa</button></div>
            <div data-r="eventos"></div>
            <div class="ag-fila-btn" style="margin-top:8px;"><button type="button" class="secundario" data-r="limpiar">Limpiar fechas</button></div>
          </div>

          <div class="ag-caja">
            <details data-r="calDet">
              <summary>Calibración manual</summary>
              <div class="ag-cal">
                <p class="nota" style="margin:0;">Solo si no se calibra sola: marca dos puntos conocidos de la línea de tiempo (por ejemplo dos medianoches) y escribe su fecha y hora.</p>
                <div class="ag-pt"><button type="button" class="secundario" data-r="pickA" aria-pressed="false">Punto A</button><input type="datetime-local" step="60" data-r="calA" aria-label="Fecha y hora del punto A"><div class="ag-px" data-r="pxA">sin marcar</div></div>
                <div class="ag-pt"><button type="button" class="secundario" data-r="pickB" aria-pressed="false">Punto B</button><input type="datetime-local" step="60" data-r="calB" aria-label="Fecha y hora del punto B"><div class="ag-px" data-r="pxB">sin marcar</div></div>
                <div class="ag-fila-btn"><button type="button" class="secundario" data-r="pickTop" aria-pressed="false">Borde superior</button><button type="button" class="secundario" data-r="pickBot" aria-pressed="false">Borde inferior</button></div>
                <div class="ag-px" data-r="pxV"></div>
                <label class="ag-campo" data-r="filaPagina" hidden>Página del PDF<input type="number" min="1" value="1" data-r="pagina"></label>
              </div>
            </details>
          </div>
        </div>
      </div>
      <div class="ag-toast" data-r="toast" role="status"></div>
    </section>`;

  const raiz = contenedor.querySelector(".ag");
  const $ = (k) => raiz.querySelector(`[data-r="${k}"]`);
  const cv = $("cv"), ctx = cv.getContext("2d");
  const S = { base: null, unidad: "", viaje: null, ocrTurno: 0, pick: null, pdf: null, cal: { a: null, b: null, left: 0, right: 0, top: 0, bottom: 0, modo: "", A: null, B: null, haveV: false } };

  // ---- Eventos ----
  const cajaEv = $("eventos");
  cajaEv.innerHTML = EVENTOS.map((e, i) => `
    <div class="ag-ev">
      <div class="ag-ev-tit"><span><span class="sw"></span>${esc(e.etiqueta)}</span><span class="ag-chip" data-r="st${i}">Pendiente</span></div>
      <div class="ag-ev-fila">
        <input type="datetime-local" step="60" data-r="ev${i}" aria-label="${esc(e.etiqueta)}">
        <button type="button" class="ag-ico" data-r="pk${i}" aria-pressed="false" title="Tomar la hora con un clic en la gráfica">${ICONO_MIRA}</button>
        <button type="button" class="ag-ico" data-r="cl${i}" title="Borrar">${ICONO_BORRAR}</button>
      </div>
    </div>`).join("");
  EVENTOS.forEach((_, i) => {
    $("ev" + i).addEventListener("input", refrescar);
    $("pk" + i).addEventListener("click", () => empezarPick("ev" + i));
    $("cl" + i).addEventListener("click", () => { $("ev" + i).value = ""; refrescar(); });
  });
  $("limpiar").addEventListener("click", () => { EVENTOS.forEach((_, i) => { $("ev" + i).value = ""; }); refrescar(); });
  const evMs = (i) => aMs($("ev" + i).value);

  // ---- Calibración ----
  const lista = () => S.cal.b != null && isFinite(S.cal.b) && S.cal.b !== 0;
  const t2x = (t) => S.cal.a + S.cal.b * t, x2t = (x) => (x - S.cal.a) / S.cal.b;
  const dentro = (x) => x >= S.cal.left - 3 && x <= S.cal.right + 3;

  function detectarCuadricula() {
    const W = S.base.width, H = S.base.height;
    const d = S.base.getContext("2d").getImageData(0, 0, W, H).data;
    const esGris = (i) => { const r = d[i], g = d[i + 1], b = d[i + 2]; return r > 150 && r < 238 && Math.abs(r - g) < 9 && Math.abs(g - b) < 9; };
    const col = new Uint32Array(W);
    for (let y = 0; y < H; y++) { let i = y * W * 4; for (let x = 0; x < W; x++, i += 4) if (esGris(i)) col[x]++; }
    const delgadas = (arr, k) => arr.map((v, i) => { const a = arr[i - k] || 0, b = arr[i + k] || 0; return Math.max(a, b) < 0.6 * v ? v : 0; });
    const ct = delgadas(col, 3); let M = 0; for (const v of ct) if (v > M) M = v;
    let xs = agrupar(ct, Math.max(0.12 * H, 0.45 * M));
    if (xs.length > 2) { // la tira más larga con separación pareja
      const df = xs.slice(1).map((v, i) => v - xs[i]).sort((p, q) => p - q), dm = df[Math.floor(df.length / 2)];
      let mejor = [], cur = [xs[0]];
      for (let i = 1; i < xs.length; i++) {
        if (Math.abs(xs[i] - xs[i - 1] - dm) <= 0.15 * dm) cur.push(xs[i]); else { if (cur.length > mejor.length) mejor = cur; cur = [xs[i]]; }
      }
      if (cur.length > mejor.length) mejor = cur; xs = mejor;
    }
    if (xs.length < 2) return { xs, rows: [], bottom: null };
    const x0 = Math.floor(xs[0]), x1 = Math.ceil(xs[xs.length - 1]);
    const fila = new Uint32Array(H), oscuro = new Uint32Array(H);
    for (let y = 0; y < H; y++) { let c = 0, k = 0, i = (y * W + x0) * 4; for (let x = x0; x <= x1; x++, i += 4) { if (esGris(i)) c++; if (d[i] < 246 || d[i + 1] < 246 || d[i + 2] < 246) k++; } fila[y] = c; oscuro[y] = k; }
    const rt = delgadas(fila, 3); let Mr = 0; for (const v of rt) if (v > Mr) Mr = v;
    const rows = agrupar(rt, 0.35 * Mr);
    let bottom = null;
    if (rows.length >= 2) {
      const dd = (rows[rows.length - 1] - rows[0]) / (rows.length - 1);
      const y0 = Math.round(rows[rows.length - 1] + 10), y1 = Math.min(H - 1, Math.round(rows[rows.length - 1] + 1.25 * dd));
      let by = -1, bv = 0; for (let y = y0; y <= y1; y++) if (oscuro[y] > bv) { bv = oscuro[y]; by = y; }
      if (by > 0 && bv >= 0.85 * (x1 - x0)) bottom = by;
    }
    return { xs, rows, bottom };
  }
  function agrupar(arr, umbral) {
    const out = []; let i = 0;
    while (i < arr.length) {
      if (arr[i] > umbral) {
        let s = 0, w = 0, ult = i, j = i;
        while (j < arr.length && j - ult <= 3) { if (arr[j] > umbral) { s += j * arr[j]; w += arr[j]; ult = j; } j++; }
        out.push(s / w); i = ult + 1;
      } else i++;
    }
    return out;
  }
  function ajustarCuadricula(xs, s, e, paso) {
    const primera = Math.ceil(s / paso) * paso; let m = 0; for (let t = primera; t <= e; t += paso) m++;
    const n = xs.length, extra = n - m;
    if (n < 2 || extra < 0 || extra > 2) return null;
    const mids = xs.map((_, i) => primera + i * paso);
    const mt = mids.reduce((p, c) => p + c, 0) / n, mx = xs.reduce((p, c) => p + c, 0) / n;
    let num = 0, den = 0; mids.forEach((t, i) => { num += (t - mt) * (xs[i] - mx); den += (t - mt) ** 2; });
    const b = num / den, a = mx - b * mt, err = Math.max(...mids.map((t, i) => Math.abs(a + b * t - xs[i])));
    return err > 4 ? null : { a, b, err, mids, n };
  }
  function autoCalibrar() {
    const s = aMs($("perIni").value), e = aMs($("perFin").value);
    if (!S.base || s == null || e == null || e <= s) { mensajeCal("Escribe el inicio y el fin del periodo (vienen en el título de la gráfica) y se calibra sola.", "av"); return false; }
    const g = detectarCuadricula(), sel = $("paso").value;
    const pasos = sel === "auto" ? [12, 24, 6, 48, 3] : [+sel];
    let f = null, paso = 0;
    for (const h of pasos) { f = ajustarCuadricula(g.xs, s, e, h * HORA); if (f) { paso = h; break; } }
    if (!f) { mensajeCal(`No se pudo calibrar sola: encontré ${g.xs.length} líneas verticales y no coinciden con el periodo. Revisa las fechas, cambia “Líneas verticales” o usa la calibración manual.`, "av"); return false; }
    const { a, b, err, mids, n } = f;
    Object.assign(S.cal, { a, b, modo: "auto", left: a + b * s, right: a + b * e });
    if (g.rows.length >= 2) {
      const dif = g.rows.slice(1).map((v, i) => v - g.rows[i]).sort((p, q) => p - q), med = dif[Math.floor(dif.length / 2)];
      S.cal.top = g.rows[0] - 4; S.cal.bottom = g.bottom != null ? g.bottom : Math.min(S.base.height - 2, g.rows[g.rows.length - 1] + med * 0.5);
    } else { S.cal.top = S.base.height * 0.1; S.cal.bottom = S.base.height * 0.88; }
    S.cal.haveV = true;
    mensajeCal(`✓ Calibrada sola con ${n} líneas verticales (una cada ${paso} h, de ${fmt(mids[0])} a ${fmt(mids[n - 1])}). Error máximo ${err.toFixed(1)} px.`, "ok");
    $("pxA").textContent = "sin marcar"; $("pxB").textContent = "sin marcar"; S.cal.A = S.cal.B = null;
    lecturaV(); return true;
  }
  function calibrarManual() {
    const A = S.cal.A, B = S.cal.B, ta = aMs($("calA").value), tb = aMs($("calB").value);
    if (A == null || B == null || ta == null || tb == null || ta === tb || A === B) return;
    const b = (B - A) / (tb - ta);
    Object.assign(S.cal, { b, a: A - b * ta, modo: "manual", left: 0, right: S.base.width });
    if (!S.cal.haveV) { S.cal.top = S.base.height * 0.1; S.cal.bottom = S.base.height * 0.88; }
    mensajeCal(`✓ Calibración manual: 1 día = ${Math.abs(b * DIA).toFixed(0)} px.`, "ok");
  }
  function mensajeCal(t, c) { const el = $("calEstado"); el.textContent = t; el.className = "ag-estado " + (c || ""); }
  function lecturaV() { $("pxV").textContent = S.cal.haveV ? `Alto de las marcas: y ${S.cal.top.toFixed(0)} a ${S.cal.bottom.toFixed(0)} px` : "Alto de las marcas: automático (10% a 88%)"; }

  // ---- Dibujo ----
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  // Dibujo (2026-11-23): banda amarilla por evento y etiqueta tipo marcatextos
  // (amarillo translúcido, sin recuadro, letra chica) DEBAJO de las horas del
  // eje. Para no taparlas ni encimarse con "Time"/leyenda, se abre una franja
  // blanca justo debajo de las horas y lo de abajo se recorre.
  function finDeHorasDelEje() {
    // Primer renglón sin tinta después de los números del eje (dentro del área de la gráfica).
    const W = S.base.width, H = S.base.height;
    const x0 = Math.max(0, Math.round(S.cal.left)), x1 = Math.min(W - 1, Math.round(S.cal.right));
    if (x1 <= x0) return Math.min(H, Math.round(S.cal.bottom + H * 0.05));
    const d = S.base.getContext("2d").getImageData(x0, 0, x1 - x0 + 1, H).data, ancho = x1 - x0 + 1;
    const tinta = (y) => { let k = 0; for (let x = 0, i = y * ancho * 4; x < ancho; x++, i += 4) if (d[i] < 230 && d[i + 1] < 230 && d[i + 2] < 230) k++; return k; };
    // Bloques de tinta debajo del eje: marcas de las rayitas, números de las horas, "Time"…
    // Las horas son el bloque con más tinta; se corta justo al terminar ese bloque.
    const limite = Math.min(H - 1, Math.round(S.cal.bottom + H * 0.1));
    const bloques = []; let actual = null;
    for (let y = Math.round(S.cal.bottom) + 2; y <= limite; y++) {
      const k = tinta(y);
      if (k > 2) { if (!actual) actual = { ini: y, fin: y, total: 0 }; actual.fin = y; actual.total += k; }
      else if (actual) { bloques.push(actual); actual = null; }
    }
    if (actual) bloques.push(actual);
    const horas = bloques.sort((a, b) => b.total - a.total)[0];
    if (horas) {
      // Avanza hasta un renglón limpio (sin el halo gris que deja el JPEG bajo los números).
      const sucio = (y) => { for (let x = 0, i = y * ancho * 4; x < ancho; x++, i += 4) if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) return true; return false; };
      let y = horas.fin + 2;
      while (y < Math.min(H - 1, horas.fin + 20) && sucio(y)) y++;
      return Math.min(H, y + 1);
    }
    return Math.min(H, Math.round(S.cal.bottom + H * 0.05));
  }
  function dibujar() {
    if (!S.base) return;
    const W = S.base.width, H = S.base.height;
    const items = [];
    if (lista()) EVENTOS.forEach((e, i) => { const t = evMs(i); if (t == null) return; const x = t2x(t); if (dentro(x)) items.push({ n: e.marca, t, x }); });
    items.sort((p, q) => p.x - q.x);

    // Acomodo de etiquetas en renglones (sin encimarse).
    const fs = Math.max(11, Math.round(W / 110)), padx = fs * 0.35, lh = fs * 1.15, sep = fs * 0.5;
    ctx.font = `700 ${fs}px ${FUENTE}`;
    const renglones = [];
    items.forEach((o) => {
      ctx.font = `700 ${fs}px ${FUENTE}`; const w1 = ctx.measureText(o.n).width;
      ctx.font = `500 ${fs * 0.9}px ${FUENTE}`; const w2 = ctx.measureText(fmt(o.t)).width;
      o.w = Math.max(w1, w2) + padx * 2; o.h = lh * 2;
      o.lx = Math.min(Math.max(2, o.x - o.w / 2), W - o.w - 2); // centrada en su línea
      let r = 0;
      while (renglones[r] && renglones[r].some((p) => o.lx < p.lx + p.w + sep && o.lx + o.w + sep > p.lx)) r++;
      (renglones[r] = renglones[r] || []).push(o); o.r = r;
    });
    const corte = items.length ? finDeHorasDelEje() : H;
    const franja = items.length ? Math.round(renglones.length * (lh * 2 + fs * 0.5) + fs * 0.6) : 0;
    if (cv.width !== W || cv.height !== H + franja) { cv.width = W; cv.height = H + franja; }
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H + franja);
    ctx.drawImage(S.base, 0, 0, W, corte, 0, 0, W, corte);
    if (franja) ctx.drawImage(S.base, 0, corte, W, H - corte, 0, corte + franja, W, H - corte);
    if (!items.length) return;

    const top = S.cal.top, bot = S.cal.bottom, bw = Math.max(10, W * 0.0075);
    ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = "rgba(255,230,0,.62)";
    items.forEach((o) => ctx.fillRect(o.x - bw / 2, top, bw, bot - top)); ctx.restore();
    ctx.save(); ctx.strokeStyle = "rgba(196,150,0,.95)"; ctx.lineWidth = Math.max(1.5, W / 900);
    items.forEach((o) => { ctx.beginPath(); ctx.moveTo(o.x, top); ctx.lineTo(o.x, bot); ctx.stroke(); }); ctx.restore();

    // Etiquetas en la franja: guía punteada desde el eje y texto con marcatextos.
    items.forEach((o) => {
      const y = corte + fs * 0.4 + o.r * (lh * 2 + fs * 0.5);
      ctx.save(); ctx.strokeStyle = "rgba(196,150,0,.8)"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(o.x, bot); ctx.lineTo(o.x, y); ctx.stroke(); ctx.restore();
      ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = "rgba(255,230,0,.55)";
      rr(ctx, o.lx, y, o.w, o.h, 2); ctx.fill(); ctx.restore();
      ctx.fillStyle = "#2b2400"; ctx.textBaseline = "top";
      ctx.font = `700 ${fs}px ${FUENTE}`; ctx.fillText(o.n, o.lx + padx, y + fs * 0.1);
      ctx.font = `500 ${fs * 0.9}px ${FUENTE}`; ctx.fillText(fmt(o.t), o.lx + padx, y + lh + fs * 0.05);
    });
  }
  function refrescar() {
    EVENTOS.forEach((_, i) => {
      const p = $("st" + i), t = evMs(i);
      if (t == null) { p.textContent = "Pendiente"; p.className = "ag-chip"; return; }
      if (!lista()) { p.textContent = "Sin calibrar"; p.className = "ag-chip av"; return; }
      if (dentro(t2x(t))) { p.textContent = "En la gráfica"; p.className = "ag-chip ok"; }
      else { p.textContent = "Fuera del periodo"; p.className = "ag-chip av"; }
    });
    const hay = lista();
    $("barraIzq").textContent = S.base ? (hay ? `Calibración ${S.cal.modo === "auto" ? "automática" : "manual"} · 1 día = ${Math.abs(S.cal.b * DIA).toFixed(0)} px` : "Sin calibrar") : "";
    const av = $("aviso");
    if (S.pick) { av.style.display = "block"; av.textContent = textoPick(); }
    else if (!hay && S.base) { av.style.display = "block"; av.textContent = "Escribe el inicio y el fin del periodo para calibrar la gráfica y ver las marcas."; }
    else av.style.display = "none";
    $("btnExportar").disabled = !S.base;
    dibujar();
  }
  function textoPick() {
    const k = S.pick;
    if (k === "A" || k === "B") return `Haz clic en la gráfica sobre el punto ${k} (una medianoche o una hora del eje). Esc cancela.`;
    if (k === "top") return "Haz clic en el borde superior de la gráfica. Esc cancela.";
    if (k === "bot") return "Haz clic en el borde inferior de la gráfica (sobre el eje del tiempo). Esc cancela.";
    return `Haz clic en la gráfica en el momento de: ${EVENTOS[+k.slice(2)].etiqueta}. Esc cancela.`;
  }

  // ---- Tomar con clic ----
  const botonesPick = { A: "pickA", B: "pickB", top: "pickTop", bot: "pickBot" };
  function empezarPick(k) {
    if (S.pick === k) { pararPick(); return; }
    if (!S.base) { aviso("Primero carga la lectura."); return; }
    if (k.startsWith("ev") && !lista()) { aviso("Primero escribe el periodo para calibrar la gráfica."); return; }
    S.pick = k; sincronizarPick(); refrescar();
  }
  function pararPick() { S.pick = null; sincronizarPick(); refrescar(); }
  function sincronizarPick() {
    cv.classList.toggle("eligiendo", !!S.pick);
    Object.entries(botonesPick).forEach(([k, r]) => $(r).setAttribute("aria-pressed", String(S.pick === k)));
    EVENTOS.forEach((_, i) => $("pk" + i).setAttribute("aria-pressed", String(S.pick === "ev" + i)));
  }
  const posicion = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height, cx: e.clientX - r.left, r }; };
  cv.addEventListener("click", (e) => {
    if (!S.pick) return; const p = posicion(e), k = S.pick;
    if (k === "A" || k === "B") { S.cal[k] = p.x; $("px" + k).textContent = `x = ${p.x.toFixed(0)} px`; calibrarManual(); }
    else if (k === "top") { S.cal.top = p.y; S.cal.haveV = true; if (S.cal.bottom <= S.cal.top) S.cal.bottom = S.base.height * 0.9; lecturaV(); }
    else if (k === "bot") { S.cal.bottom = p.y; S.cal.haveV = true; if (S.cal.top >= S.cal.bottom) S.cal.top = S.base.height * 0.1; lecturaV(); }
    else { const i = +k.slice(2); $("ev" + i).value = aValor(Math.round(x2t(p.x) / 60000) * 60000); }
    S.pick = null; sincronizarPick(); refrescar();
  });
  cv.addEventListener("pointermove", (e) => {
    if (!S.base) return; const p = posicion(e), g = $("guia"), t = $("tip");
    if (!lista()) { g.style.display = t.style.display = "none"; return; }
    g.style.display = "block"; g.style.left = p.cx + "px";
    t.style.display = "block"; t.textContent = fmt(Math.round(x2t(p.x) / 60000) * 60000);
    const tw = t.offsetWidth; t.style.left = (p.cx + 10 + tw > p.r.width ? p.cx - 10 - tw : p.cx + 10) + "px";
  });
  cv.addEventListener("pointerleave", () => { $("guia").style.display = $("tip").style.display = "none"; });
  Object.entries(botonesPick).forEach(([k, r]) => $(r).addEventListener("click", () => empezarPick(k)));
  ["calA", "calB"].forEach((r) => $(r).addEventListener("input", () => { calibrarManual(); refrescar(); }));
  ["perIni", "perFin", "paso"].forEach((r) => $(r).addEventListener("input", () => {
    if (aMs($("perIni").value) != null && aMs($("perFin").value) != null) { autoCalibrar(); refrescar(); pintarMeta(); }
  }));
  $("unidad").addEventListener("input", () => { S.unidad = $("unidad").value.trim(); pintarMeta(); });
  function pintarMeta() {
    const s = aMs($("perIni").value), e = aMs($("perFin").value);
    const v = S.viaje;
    const partes = [S.unidad ? `Unidad ${S.unidad}` : "", s != null && e != null ? `${fmtLargo(s)} → ${fmtLargo(e)}` : "",
      v ? [v.cliente, v.destino].filter(Boolean).join(" → ") : "", v && v.operador ? v.operador : ""].filter(Boolean);
    $("meta").textContent = partes.length ? partes.join(" · ") : "Lectura Thermo King / TracKing · marca los eventos del viaje sobre la gráfica de temperatura.";
  }

  // ---- Carga de archivos ----
  function ponerBase(src, w, h) {
    const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d");
    x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.drawImage(src, 0, 0); S.base = c; mostrarEscena();
  }
  function mostrarEscena() { $("vacio").hidden = true; $("escena").hidden = false; }
  function reiniciarCal() {
    Object.assign(S.cal, { a: null, b: null, modo: "", A: null, B: null, haveV: false, left: 0, right: S.base.width, top: S.base.height * 0.1, bottom: S.base.height * 0.88 });
    $("pxA").textContent = $("pxB").textContent = "sin marcar"; $("calA").value = $("calB").value = ""; lecturaV();
  }
  const cargarImg = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("No se pudo leer la imagen.")); im.src = src; });
  async function cargarImagen(f) {
    const url = URL.createObjectURL(f);
    try {
      const im = await cargarImg(url);
      ponerBase(im, im.naturalWidth, im.naturalHeight); reiniciarCal(); S.pdf = null; $("filaPagina").hidden = true;
      $("perIni").value = $("perFin").value = ""; S.unidad = ""; $("unidad").value = "";
      $("calDet").open = false;
      $("barraDer").textContent = `Imagen ${f.name || "pegada"} · ${im.naturalWidth} × ${im.naturalHeight} px`;
      pintarMeta(); refrescar();
      leerTituloImagen();
    } finally { URL.revokeObjectURL(url); }
  }

  // OCR del título (solo imágenes). Si no lo lee, se escribe a mano como antes.
  async function leerTituloImagen() {
    const turno = ++S.ocrTurno, base = S.base;
    mensajeCal("Leyendo el título de la gráfica (unidad y periodo)…", "");
    try {
      const worker = await obtenerOcr();
      let datos = { unidad: "", ini: null, fin: null };
      for (const fraccion of [0.16, 0.32]) {
        const recorte = recortarTitulo(base, fraccion);
        const { data } = await worker.recognize(recorte);
        if (turno !== S.ocrTurno) return; // ya cargaron otro archivo
        const d = datosDelTitulo(data.text);
        if (d.unidad && !datos.unidad) datos.unidad = d.unidad;
        if (d.ini != null) { datos = { ...d, unidad: d.unidad || datos.unidad }; break; }
      }
      if (datos.unidad && !$("unidad").value) { S.unidad = datos.unidad; $("unidad").value = datos.unidad; }
      if (datos.ini != null && !$("perIni").value && !$("perFin").value) {
        $("perIni").value = aValor(datos.ini); $("perFin").value = aValor(datos.fin);
        if (autoCalibrar()) mensajeCal($("calEstado").textContent + " Periodo leído del título; revísalo.", "ok");
      } else if (datos.ini == null && !lista()) {
        mensajeCal("No pude leer el periodo del título. Escribe el inicio y el fin (vienen en el título de la gráfica).", "av");
      }
    } catch (err) {
      if (turno === S.ocrTurno && !lista()) mensajeCal("No pude leer el título (" + (err.message || "sin conexión") + "). Escribe el inicio y el fin del periodo.", "av");
    }
    pintarMeta(); refrescar();
  }
  function recortarTitulo(base, fraccion) {
    const H = Math.max(40, Math.round(base.height * fraccion)), E = Math.max(1, Math.min(4, Math.round(2400 / base.width)));
    const k = document.createElement("canvas"); k.width = base.width * E; k.height = H * E;
    const x = k.getContext("2d"); x.imageSmoothingQuality = "high";
    x.drawImage(base, 0, 0, base.width, H, 0, 0, k.width, k.height);
    const d = x.getImageData(0, 0, k.width, k.height);
    for (let i = 0; i < d.data.length; i += 4) { const g = 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2]; d.data[i] = d.data[i + 1] = d.data[i + 2] = g < 160 ? 0 : 255; }
    x.putImageData(d, 0, 0);
    return k;
  }
  let promesaPdfjs = null;
  function cargarPdfjs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!promesaPdfjs) promesaPdfjs = new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = PDFJS + "pdf.min.js";
      s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js"; res(window.pdfjsLib); };
      s.onerror = () => { promesaPdfjs = null; rej(new Error("No se pudo cargar el lector de PDF. Revisa tu conexión.")); };
      document.head.appendChild(s);
    });
    return promesaPdfjs;
  }
  async function cargarPdf(f) {
    const lib = await cargarPdfjs();
    const doc = await lib.getDocument({ data: await f.arrayBuffer() }).promise;
    S.pdf = { doc, nombre: f.name };
    $("pagina").max = doc.numPages; $("pagina").value = 1; $("filaPagina").hidden = doc.numPages < 2;
    await mostrarPaginaPdf(1);
  }
  async function mostrarPaginaPdf(n) {
    const lib = window.pdfjsLib, page = await S.pdf.doc.getPage(n), vp = page.getViewport({ scale: 2 });
    const c = document.createElement("canvas"); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    const tc = await page.getTextContent();
    const txt = tc.items.map((i) => i.str).join(" ");
    let alto = Math.round(c.height * 0.62);
    const dt = tc.items.find((i) => i.str.trim() === "Date & Time");
    if (dt) { const tr = lib.Util.transform(vp.transform, dt.transform); alto = Math.round(tr[5] - dt.height * vp.scale - 38 * vp.scale); }
    alto = Math.max(200, Math.min(c.height, alto));
    const b = document.createElement("canvas"); b.width = c.width; b.height = alto;
    b.getContext("2d").drawImage(c, 0, 0, c.width, alto, 0, 0, c.width, alto);
    S.base = b; mostrarEscena(); reiniciarCal();
    S.ocrTurno++;
    const tit = datosDelTitulo(txt); S.unidad = tit.unidad; $("unidad").value = S.unidad;
    if (tit.ini != null) {
      $("perIni").value = aValor(tit.ini); $("perFin").value = aValor(tit.fin);
      autoCalibrar();
    } else { $("perIni").value = $("perFin").value = ""; mensajeCal("No encontré el periodo en el título del PDF. Escríbelo arriba.", "av"); }
    $("calDet").open = false;
    $("barraDer").textContent = `PDF ${S.pdf.nombre} · página ${n} de ${S.pdf.doc.numPages}`;
    pintarMeta(); refrescar();
  }
  $("pagina").addEventListener("change", async (e) => {
    if (!S.pdf) return; const n = Math.min(S.pdf.doc.numPages, Math.max(1, +e.target.value || 1)); e.target.value = n;
    try { await mostrarPaginaPdf(n); } catch (err) { aviso(err.message); }
  });
  async function abrirArchivo(f) {
    if (!f) return;
    try {
      aviso("Leyendo " + (f.name || "imagen") + "…", true);
      if (f.type === "application/pdf" || /\.pdf$/i.test(f.name || "")) await cargarPdf(f); else await cargarImagen(f);
      aviso("");
    } catch (err) { aviso(err.message || "No se pudo abrir el archivo."); }
  }
  $("btnCargar").addEventListener("click", () => $("archivo").click());
  $("vacio").addEventListener("click", () => $("archivo").click());
  $("archivo").addEventListener("change", (e) => { abrirArchivo(e.target.files[0]); e.target.value = ""; });
  const zona = $("zona");
  ["dragenter", "dragover"].forEach((t) => zona.addEventListener(t, (e) => { e.preventDefault(); zona.classList.add("arrastrando"); }));
  ["dragleave", "drop"].forEach((t) => zona.addEventListener(t, (e) => { e.preventDefault(); zona.classList.remove("arrastrando"); }));
  zona.addEventListener("drop", (e) => abrirArchivo(e.dataTransfer.files[0]));

  // Pegar (Ctrl+V) y Esc: escuchan en todo el documento mientras esta
  // pantalla esté abierta; al cambiar de pantalla se quitan solos.
  const alPegar = (e) => {
    if (!raiz.isConnected) return quitarGlobales();
    const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/"));
    if (f) abrirArchivo(f);
  };
  const alTecla = (e) => {
    if (!raiz.isConnected) return quitarGlobales();
    if (e.key === "Escape" && S.pick) pararPick();
  };
  function quitarGlobales() { document.removeEventListener("paste", alPegar); document.removeEventListener("keydown", alTecla); }
  document.addEventListener("paste", alPegar);
  document.addEventListener("keydown", alTecla);

  // ---- Exportar (ventana igual a las demás de la app) ----
  $("btnExportar").addEventListener("click", () => {
    if (!S.base) return;
    dibujar();
    const url = cv.toDataURL("image/png");
    const nombre = `lectura-${(S.unidad || "thermoking").replace(/[^A-Za-z0-9_-]/g, "_")}-eventos.png`;
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML = `<div class="modal-tarjeta ag-export" style="max-width:1100px;width:100%;max-height:92vh;overflow:auto;">
      <h2 style="margin:0 0 8px;">Imagen con eventos</h2>
      <img alt="Gráfica con eventos marcados" src="${url}">
      <p class="nota" style="margin:8px 0 0;">Cópiala para pegarla en un correo o WhatsApp, o descárgala.</p>
      <div class="modal-acciones">
        <button type="button" class="secundario" data-x="cerrar">Cerrar</button>
        <button type="button" class="secundario" data-x="copiar">Copiar imagen</button>
        <button type="button" data-x="bajar">Descargar PNG</button>
      </div></div>`;
    document.body.appendChild(ov);
    const cerrar = () => { ov.remove(); document.removeEventListener("keydown", escCerrar); };
    const escCerrar = (e) => { if (e.key === "Escape") cerrar(); };
    document.addEventListener("keydown", escCerrar);
    ov.addEventListener("click", (e) => { if (e.target === ov) cerrar(); });
    ov.querySelector('[data-x="cerrar"]').addEventListener("click", cerrar);
    ov.querySelector('[data-x="bajar"]').addEventListener("click", () => {
      const a = document.createElement("a"); a.href = url; a.download = nombre;
      document.body.appendChild(a); a.click(); a.remove();
    });
    ov.querySelector('[data-x="copiar"]').addEventListener("click", () => {
      cv.toBlob(async (b) => {
        try { await navigator.clipboard.write([new ClipboardItem({ "image/png": b })]); aviso("Imagen copiada."); }
        catch (e) { aviso("Este navegador no deja copiar la imagen. Usa “Descargar PNG”."); }
      }, "image/png");
    });
  });

  // ---- Pegar de Adrematasa ----
  $("pegarAdr").addEventListener("click", abrirPegadoAdrematasa);
  function abrirPegadoAdrematasa() {
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML = `<div class="modal-tarjeta ag" style="max-width:760px;width:100%;max-height:92vh;overflow:auto;">
      <h2 style="margin:0 0 4px;">Pegar de Adrematasa</h2>
      <p class="nota" style="margin:0 0 10px;">En el Adrematasa oficial selecciona el renglón del viaje <b>con los títulos</b>, cópialo (Ctrl+C) y pégalo aquí. Se llenan Entrada patio, Salida patio, Arribo y Descarga importación, y la unidad.</p>
      <textarea data-x="texto" rows="5" style="width:100%;box-sizing:border-box;font-family:monospace;font-size:12px;white-space:pre;" placeholder="Pega aquí (Ctrl+V)"></textarea>
      <div data-x="vista" style="margin-top:10px;"></div>
      <div class="modal-acciones">
        <button type="button" class="secundario" data-x="cerrar">Cancelar</button>
        <button type="button" data-x="aplicar" disabled>Llenar fechas</button>
      </div></div>`;
    document.body.appendChild(ov);
    const q = (k) => ov.querySelector(`[data-x="${k}"]`);
    const cerrar = () => ov.remove();
    ov.addEventListener("click", (e) => { if (e.target === ov) cerrar(); });
    q("cerrar").addEventListener("click", cerrar);
    let filas = [];
    const celda = (ms) => ms != null ? esc(fmt(ms)) : `<span style="color:#A32D2D;">—</span>`;
    q("texto").addEventListener("input", () => {
      const r = leerPegadoAdrematasa(q("texto").value);
      if (r.error) { filas = []; q("vista").innerHTML = q("texto").value.trim() ? `<div class="error">${esc(r.error)}</div>` : ""; q("aplicar").disabled = true; return; }
      filas = r.filas;
      const unidad = normal(S.unidad);
      let elegida = Math.max(0, filas.findIndex((f) => unidad && normal(f.remolque) === unidad));
      q("vista").innerHTML = `<div style="overflow-x:auto;"><table class="tabla" style="font-size:12.5px;">
        <thead><tr>${filas.length > 1 ? "<th></th>" : ""}<th>Remolque</th><th>Cliente → Destino</th><th>Entrada</th><th>Salida</th><th>Arribo impo</th><th>Descarga</th></tr></thead>
        <tbody>${filas.map((f, i) => `<tr>${filas.length > 1 ? `<td><input type="radio" name="ag-fila" value="${i}" ${i === elegida ? "checked" : ""}></td>` : ""}
          <td><b>${esc(f.remolque || "—")}</b></td><td>${esc([f.cliente, f.destino].filter(Boolean).join(" → ") || "—")}</td>
          <td>${celda(f.fechas[2])}</td><td>${celda(f.fechas[3])}</td><td>${celda(f.fechas[4])}</td><td>${celda(f.fechas[5])}</td></tr>`).join("")}</tbody></table></div>
        <div data-x="avisoUnidad" class="nota" style="margin-top:6px;"></div>`;
      const revisar = () => {
        const f = filas[elegida];
        const a = ov.querySelector('[data-x="avisoUnidad"]');
        a.style.color = "";
        if (!f) { a.textContent = ""; return; }
        if (S.unidad && f.remolque && normal(f.remolque) !== unidad) { a.style.color = "#7a3e06"; a.textContent = `⚠️ El remolque ${f.remolque} no coincide con la unidad de la lectura (${S.unidad}). Revisa que sea el viaje correcto.`; }
        else if (!Object.keys(f.fechas).length) { a.style.color = "#7a3e06"; a.textContent = "Ese renglón no trae fechas de entrada, salida, arribo ni descarga."; }
        else a.textContent = "Las fechas vacías en Adrematasa no cambian lo que ya tengas capturado.";
      };
      ov.querySelectorAll('input[name="ag-fila"]').forEach((r) => r.addEventListener("change", () => { elegida = +r.value; revisar(); }));
      revisar();
      q("aplicar").disabled = false;
      q("aplicar").onclick = () => {
        const f = filas[elegida]; if (!f) return;
        Object.entries(f.fechas).forEach(([i, ms]) => { $("ev" + i).value = aValor(ms); });
        if (f.remolque && !S.unidad) { S.unidad = f.remolque; $("unidad").value = f.remolque; }
        S.viaje = f;
        cerrar(); pintarMeta(); refrescar();
        const fuera = Object.keys(f.fechas).filter((i) => lista() && !dentro(t2x(f.fechas[i]))).map((i) => EVENTOS[i].etiqueta);
        aviso(fuera.length ? `Fechas llenadas. Fuera del periodo de la lectura: ${fuera.join(", ")}.` : "Fechas llenadas desde Adrematasa.");
      };
    });
    setTimeout(() => q("texto").focus(), 50);
  }

  let tAviso;
  function aviso(t, fijo) {
    const el = $("toast"); clearTimeout(tAviso);
    if (!t) { el.style.display = "none"; return; }
    el.textContent = t; el.style.display = "block";
    if (!fijo) tAviso = setTimeout(() => { el.style.display = "none"; }, 3500);
  }

  lecturaV();
  refrescar();
}