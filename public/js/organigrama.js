// Organigrama: árbol de mando real de Adrematasa Interno (solo admin).
//
// A diferencia de "Áreas y puestos" en Configuración (que es solo un
// catálogo plano de etiquetas), aquí sí se define quién depende de quién.
// La FORMA del árbol (ARBOL_ORGANIGRAMA, abajo) está fija en este archivo
// porque la estructura de mando de la empresa cambia muy de vez en cuando —
// si el día de mañana cambia (nuevo puesto, alguien más en la cadena de
// mando, etc.), se ajusta directamente aquí.
//
// Los TITULARES de cada puesto (quién lo ocupa hoy) sí son 100% dinámicos:
// se buscan en tiempo real entre los usuarios activos cuya Área + Puesto
// coincidan exactamente con ese renglón (los mismos valores que usa
// Catálogo de empleados). Si nadie coincide, se muestra "Vacante". Si más
// de una persona coincide, se listan todas.
//
// Cada nodo hace match contra el catálogo por Área + Puesto EXACTOS (mismo
// texto, mayúsculas y acentos incluidos). Un nodo puede traer además una
// "etiqueta" opcional: es solo el texto que se muestra en la caja (por
// ejemplo, para distinguir los tres puestos que en el catálogo se llaman
// igual, "Coordinador", pero están en áreas distintas) — el match contra
// usuarios se sigue haciendo con "puesto", no con "etiqueta".
//
// Cualquier área/puesto del catálogo que no esté contemplado en el árbol
// de abajo (por ejemplo, un área nueva que se agregue en Configuración, o
// un puesto cuyo texto no coincida exactamente) aparece en la sección
// "Puestos sin ubicar en el árbol", para que nada se pierda de vista en
// silencio.
//
// Un nodo también puede traer "esGrupo: true" en vez de puesto/área: es un
// recuadro puramente visual (por ejemplo "Operaciones", que solo agrupa a
// MEX y EUA bajo un mismo tronco) — no corresponde a nada del catálogo, no
// tiene titulares, y su conteo de puestos/personas se suma de lo que
// cuelga de él.

import { db } from "./firebase-config.js";
import {
  collection, doc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { AREAS_DEFAULT, esPuestoDeCoordinacion } from "./estructuraOrganizacional.js";

const ARBOL_ORGANIGRAMA = [
  {
    puesto: "Dirección de operaciones",
    area: "Dirección General",
    hijos: [
      {
        puesto: "Gerente",
        area: "Gerencia de operaciones de importación",
        etiqueta: "Gerencia de operaciones de importación",
        hijos: [
          {
            // Recuadro puramente visual: agrupa Operaciones MEX y EUA bajo
            // una sola etiqueta "Operaciones". No corresponde a ningún área
            // ni puesto real del catálogo — es solo para que se vea que
            // ambas salen de un mismo tronco.
            esGrupo: true,
            etiqueta: "Operaciones",
            hijos: [
              {
                puesto: "Coordinador",
                area: "Operaciones MEX",
                etiqueta: "Coordinador de operaciones MEX",
                hijos: [
                  {
                    puesto: "Supervisor", area: "Operaciones MEX", hijos: [
                      {
                        puesto: "Auxiliar", area: "Operaciones MEX", hijos: [
                          { puesto: "Despachador", area: "Operaciones MEX", hijos: [] }
                        ]
                      }
                    ]
                  }
                ]
              },
              { puesto: "Coordinador", area: "Operaciones EUA", etiqueta: "Coordinador de operaciones EUA", hijos: [] }
            ]
          },
          { puesto: "Coordinador", area: "Coordinador de operadores", etiqueta: "Coordinador de operadores", hijos: [] },
          { esArea: true, area: "Atención al cliente", hijos: [] },
          { esArea: true, area: "Control vehicular", hijos: [] }
        ]
      }
    ]
  }
];

export function iniciarOrganigrama(contenedor) {
  contenedor.innerHTML = `
    <section class="panel">
      <div class="organigrama-encabezado">
        <h2>Organigrama</h2>
        <button type="button" id="btn-descargar-organigrama" class="secundario">⬇ Descargar en Word</button>
      </div>
      <p class="nota">
        Línea de mando real de Alanis. Los nombres se toman de Catálogo de empleados
        (Área + Puesto de cada usuario activo); si un puesto no tiene a nadie asignado
        todavía, se muestra como "Vacante". Desliza a los lados para ver todo el árbol.
      </p>
      <div id="organigrama-error" class="error"></div>
      <div id="organigrama-descarga-estado" class="nota oculto"></div>
      <div class="organigrama-scroll">
        <div id="organigrama-arbol"></div>
      </div>
      <div id="organigrama-otros"></div>
      <div class="leyenda" style="margin-top:24px;">
        <div class="leyenda-item"><span class="insignia-coordinador">Coordinador</span> puesto que sugiere rol de supervisor</div>
        <div class="leyenda-item" style="font-style:italic;color:#a8894f;">Vacante = nadie asignado todavía</div>
      </div>
    </section>
  `;

  const arbolDiv = contenedor.querySelector("#organigrama-arbol");
  const otrosDiv = contenedor.querySelector("#organigrama-otros");
  const errorDiv = contenedor.querySelector("#organigrama-error");
  const descargaEstadoDiv = contenedor.querySelector("#organigrama-descarga-estado");
  const btnDescargar = contenedor.querySelector("#btn-descargar-organigrama");

  let usuarios = [];
  let areas = AREAS_DEFAULT;

  onSnapshot(collection(db, "usuarios"), (snap) => {
    usuarios = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => u.estatus === "activo");
    render();
  }, (err) => {
    errorDiv.textContent = "No se pudo cargar el organigrama: " + err.message;
  });

  onSnapshot(doc(db, "configuracion", "estructura"), (snap) => {
    const datos = snap.exists() ? snap.data().areas : null;
    areas = Array.isArray(datos) && datos.length > 0 ? datos : AREAS_DEFAULT;
    render();
  }, (err) => {
    errorDiv.textContent = "No se pudo cargar el organigrama: " + err.message;
  });

  function titularesDe(area, puesto) {
    return usuarios
      .filter(u => (u.area || "") === area && (u.puesto || "") === puesto)
      .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
  }

  function iniciales(nombre) {
    const partes = (nombre || "").trim().split(/\s+/).filter(Boolean);
    if (partes.length === 0) return "?";
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  }

  function cajaTitulares(lista) {
    if (lista.length === 0) return `<div class="vacante">Vacante — nadie asignado</div>`;
    return `<div class="lista-titulares">
      ${lista.map(u => `
        <div class="chip-titular">
          <span class="avatar-iniciales">${escapeHtml(iniciales(u.nombre))}</span>
          <span>${escapeHtml(u.nombre || "(sin nombre)")}</span>
        </div>
      `).join("")}
    </div>`;
  }

  function renderCajaPuesto(area, puesto, etiqueta) {
    const lista = titularesDe(area, puesto);
    const coordinador = esPuestoDeCoordinacion(puesto);
    return `
      <div class="caja-puesto ${coordinador ? "coordinador" : ""}">
        <div class="puesto-encabezado">
          <span class="puesto-nombre">${escapeHtml(etiqueta || puesto)}</span>
          ${coordinador ? `<span class="insignia-coordinador">Coord.</span>` : ""}
        </div>
        ${cajaTitulares(lista)}
      </div>
    `;
  }

  function datosArea(nombreArea) {
    const areaObj = areas.find(a => a.nombre === nombreArea);
    const puestos = areaObj ? areaObj.puestos : [];
    const totalPersonas = puestos.reduce((s, p) => s + titularesDe(nombreArea, p).length, 0);
    const conteo = puestos.length === 0
      ? "Sin puestos capturados"
      : `${puestos.length} puesto${puestos.length === 1 ? "" : "s"} · ${totalPersonas} persona${totalPersonas === 1 ? "" : "s"}`;
    return { puestos, conteo };
  }

  function contarGrupo(nodo) {
    // Suma recursiva de puestos/personas bajo un nodo puramente visual
    // (esGrupo) — no viene de una sola área del catálogo, así que hay que
    // sumar lo que traiga cada rama que cuelga de él.
    if (nodo.esArea) {
      const areaObj = areas.find(a => a.nombre === nodo.area);
      const puestosArea = areaObj ? areaObj.puestos : [];
      const personas = puestosArea.reduce((s, p) => s + titularesDe(nodo.area, p).length, 0);
      return { puestos: puestosArea.length, personas };
    }
    if (nodo.esGrupo) {
      return (nodo.hijos || []).reduce((acc, h) => {
        const r = contarGrupo(h);
        return { puestos: acc.puestos + r.puestos, personas: acc.personas + r.personas };
      }, { puestos: 0, personas: 0 });
    }
    const propio = { puestos: 1, personas: titularesDe(nodo.area, nodo.puesto).length };
    return (nodo.hijos || []).reduce((acc, h) => {
      const r = contarGrupo(h);
      return { puestos: acc.puestos + r.puestos, personas: acc.personas + r.personas };
    }, propio);
  }

  function renderNodo(nodo) {
    let cajaHtml;
    let hijosNodos;

    if (nodo.esArea) {
      const { puestos, conteo } = datosArea(nodo.area);
      cajaHtml = `<div class="caja-area">${escapeHtml(nodo.area)}<span class="conteo">${conteo}</span></div>`;
      hijosNodos = puestos.map(p => ({ puesto: p, area: nodo.area, hijos: [] }));
    } else if (nodo.esGrupo) {
      // Recuadro puramente visual: agrupa varias ramas bajo una etiqueta,
      // pero no corresponde a un puesto real — nadie sale asignado aquí,
      // así que no busca titulares, solo suma el conteo de sus ramas.
      const { puestos, personas } = contarGrupo(nodo);
      const conteo = `${puestos} puesto${puestos === 1 ? "" : "s"} · ${personas} persona${personas === 1 ? "" : "s"}`;
      cajaHtml = `<div class="caja-area">${escapeHtml(nodo.etiqueta)}<span class="conteo">${conteo}</span></div>`;
      hijosNodos = nodo.hijos || [];
    } else {
      cajaHtml = renderCajaPuesto(nodo.area, nodo.puesto, nodo.etiqueta);
      hijosNodos = nodo.hijos || [];
    }

    let hijosHtml = "";
    if (hijosNodos.length > 0) {
      hijosHtml = `
        <div class="linea-v"></div>
        <div class="fila-hijos">
          ${hijosNodos.map(h => `<div class="rama">${renderNodo(h)}</div>`).join("")}
        </div>
      `;
    } else if (nodo.esArea) {
      hijosHtml = `
        <div class="linea-v"></div>
        <div class="fila-hijos">
          <div class="rama">
            <div class="caja-puesto">
              <div class="vacante" style="padding:2px;">Agrega puestos a esta área en Configuración.</div>
            </div>
          </div>
        </div>
      `;
    }

    return `<div class="nodo-organigrama">${cajaHtml}${hijosHtml}</div>`;
  }

  function render() {
    arbolDiv.innerHTML = ARBOL_ORGANIGRAMA.map(n => renderNodo(n)).join("");
    renderOtros();
  }

  function calcularPendientesPorArea() {
    // Áreas o puestos del catálogo que todavía no están ubicados en el
    // árbol (por ejemplo, un área nueva agregada en Configuración). Se usa
    // tanto para la sección "Puestos sin ubicar" en pantalla como para el
    // Word descargable, para que ambos coincidan siempre.
    const areasCubiertasPorEntero = new Set();
    const paresExplicitos = new Set();

    function recorrer(nodo) {
      if (nodo.esArea) areasCubiertasPorEntero.add(nodo.area);
      else if (nodo.puesto) paresExplicitos.add(nodo.area + "||" + nodo.puesto);
      (nodo.hijos || []).forEach(recorrer);
    }
    ARBOL_ORGANIGRAMA.forEach(recorrer);

    const pendientesPorArea = [];
    areas.forEach(a => {
      if (areasCubiertasPorEntero.has(a.nombre)) return;
      const puestos = (a.puestos || []).filter(p => !paresExplicitos.has(a.nombre + "||" + p));
      if (puestos.length > 0) pendientesPorArea.push({ area: a.nombre, puestos });
    });
    return pendientesPorArea;
  }

  function renderOtros() {
    const pendientesPorArea = calcularPendientesPorArea();

    if (pendientesPorArea.length === 0) {
      otrosDiv.innerHTML = "";
      return;
    }

    otrosDiv.innerHTML = `
      <div class="panel" style="margin-top:20px; background:#faf8f5;">
        <h3 style="margin-top:0; font-size:0.95rem;">Puestos sin ubicar en el árbol</h3>
        <p class="nota" style="margin-bottom:12px;">
          Estos puestos existen en Configuración › Áreas y puestos pero el nombre del Área
          y/o del Puesto no coincide exactamente con lo que espera el árbol del organigrama
          (mayúsculas, acentos o palabras distintas cuentan como distinto). Avísale al
          administrador del sistema para acomodarlos o corregir el texto.
        </p>
        ${pendientesPorArea.map(grupo => `
          <div style="margin-bottom:16px;">
            <p style="font-size:0.8rem; font-weight:600; color:#6b5a44; margin:0 0 8px;">Área: ${escapeHtml(grupo.area)}</p>
            <div class="otros-grid">
              ${grupo.puestos.map(p => `<div style="width:172px;">${renderCajaPuesto(grupo.area, p)}</div>`).join("")}
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  // --- Descarga en Word --------------------------------------------------
  // Genera un .docx (hoja carta, horizontal) con el mismo árbol y los
  // mismos titulares que se ven en pantalla, usando la librería "docx"
  // cargada directo desde un CDN (igual que Firebase en este proyecto: sin
  // paso de build). El árbol se dibuja con <canvas> como un diagrama de
  // cuadros y líneas simple (blanco y negro, sin los colores de la app) y
  // se inserta como imagen — así el resultado es un organigrama de verdad
  // (con líneas de conexión), no una lista con sangría. Todo corre en el
  // navegador de quien da clic — no se sube nada a ningún lado.
  const CDN_DOCX = "https://cdn.jsdelivr.net/npm/docx@9.7.1/dist/index.mjs";
  const COLOR_TEXTO = "222222";
  const COLOR_GRIS = "666666";
  const COLOR_LINEA_CLARA = "CCCCCC";

  // Medidas del diagrama (en "px" lógicos; el canvas se dibuja al doble
  // de resolución para que se vea nítido al imprimir).
  const CAJA_ANCHO = 230;
  const SEP_H = 26;
  const UNIDAD_ANCHO = CAJA_ANCHO + SEP_H;
  const ENCABEZADO_ALTO = 20;
  const LINEA_ALTO = 15;
  const PAD_ARRIBA = 10;
  const PAD_ABAJO = 10;
  const PAD_LADO = 12;
  const SEP_V = 46;
  const MARGEN_LIENZO = 20;

  btnDescargar.addEventListener("click", generarWord);

  function mostrarEstadoDescarga(texto, esError) {
    descargaEstadoDiv.textContent = texto;
    descargaEstadoDiv.classList.toggle("oculto", !texto);
    descargaEstadoDiv.classList.toggle("error", !!esError);
  }

  async function generarWord() {
    btnDescargar.disabled = true;
    mostrarEstadoDescarga("Generando el documento…", false);
    try {
      const docx = await import(CDN_DOCX);

      const { canvas, ancho, alto } = dibujarCanvasArbol();
      const arbolBlob = await new Promise((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error("No se pudo generar la imagen del árbol.")), "image/png");
      });
      const arbolBuffer = await arbolBlob.arrayBuffer();

      // La hoja es carta horizontal (11 x 8.5 in): el árbol casi siempre
      // sale más ancho que alto, y así se aprovecha mucho mejor la página
      // que en vertical. OJO: docx espera el ancho/alto en orientación
      // "normal" (8.5 x 11) y él mismo los intercambia con orientation:
      // LANDSCAPE — pasarlos ya invertidos duplica el intercambio y
      // regresa la hoja a vertical.
      const ANCHO_HOJA_IN = 11;
      const ALTO_HOJA_IN = 8.5;
      const MARGEN_LR_IN = 0.6;
      const MARGEN_TB_IN = 0.55;
      const anchoContenidoIn = ANCHO_HOJA_IN - MARGEN_LR_IN * 2;
      const altoDisponibleArbolIn = ALTO_HOJA_IN - MARGEN_TB_IN * 2 - 0.2; // ya no hay portada arriba, casi toda la hoja es para el árbol

      let anchoArbolIn = Math.min(anchoContenidoIn, ancho / 96);
      let altoArbolIn = anchoArbolIn * (alto / ancho);
      if (altoArbolIn > altoDisponibleArbolIn) {
        altoArbolIn = altoDisponibleArbolIn;
        anchoArbolIn = altoArbolIn * (ancho / alto);
      }

      const hoy = new Date();
      const fechaTexto = hoy.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });

      const partes = [];
      partes.push(new docx.Paragraph({
        alignment: docx.AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        children: [
          new docx.ImageRun({
            data: arbolBuffer,
            transformation: { width: Math.round(anchoArbolIn * 96), height: Math.round(altoArbolIn * 96) },
            type: "png"
          })
        ]
      }));
      construirPendientesDocx(docx, partes);

      const documento = new docx.Document({
        sections: [{
          properties: {
            page: {
              size: {
                width: docx.convertInchesToTwip(ALTO_HOJA_IN),
                height: docx.convertInchesToTwip(ANCHO_HOJA_IN),
                orientation: docx.PageOrientation.LANDSCAPE
              },
              margin: {
                top: docx.convertInchesToTwip(MARGEN_TB_IN),
                bottom: docx.convertInchesToTwip(MARGEN_TB_IN),
                left: docx.convertInchesToTwip(MARGEN_LR_IN),
                right: docx.convertInchesToTwip(MARGEN_LR_IN)
              }
            }
          },
          footers: { default: construirFooterDocx(docx, fechaTexto, ANCHO_HOJA_IN, MARGEN_LR_IN) },
          children: partes
        }]
      });

      const blob = await docx.Packer.toBlob(documento);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const fecha = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `Organigrama-Alanis-${fecha}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      mostrarEstadoDescarga("Listo — revisa tus descargas.", false);
      setTimeout(() => mostrarEstadoDescarga("", false), 4000);
    } catch (err) {
      console.error(err);
      mostrarEstadoDescarga("No se pudo generar el Word: " + err.message + " (revisa tu conexión a internet e intenta de nuevo).", true);
    } finally {
      btnDescargar.disabled = false;
    }
  }

  // --- Diagrama (cuadros y líneas simples, dibujado en <canvas>) --------

  function hijosParaDiagrama(nodo) {
    if (nodo.placeholder) return [];
    if (nodo.esArea) {
      const { puestos } = datosArea(nodo.area);
      if (puestos.length === 0) return [{ placeholder: true }];
      return puestos.map(p => ({ puesto: p, area: nodo.area, hijos: [] }));
    }
    return nodo.hijos || [];
  }

  function medirNodoDiagrama(nodo) {
    if (nodo.placeholder) return { tipo: "placeholder", lineas: 1 };
    if (nodo.esArea) {
      const { puestos, conteo } = datosArea(nodo.area);
      return { tipo: "area", titulo: nodo.area, subtitulo: conteo, lineas: 1 };
    }
    if (nodo.esGrupo) {
      const { puestos, personas } = contarGrupo(nodo);
      const conteo = `${puestos} puesto${puestos === 1 ? "" : "s"} · ${personas} persona${personas === 1 ? "" : "s"}`;
      return { tipo: "grupo", titulo: nodo.etiqueta, subtitulo: conteo, lineas: 1 };
    }
    const lista = titularesDe(nodo.area, nodo.puesto);
    return {
      tipo: "puesto",
      titulo: (nodo.etiqueta || nodo.puesto) + (esPuestoDeCoordinacion(nodo.puesto) ? " (Coordinador)" : ""),
      personas: lista.map(u => u.nombre || "(sin nombre)"),
      lineas: Math.max(1, lista.length)
    };
  }

  function altoCajaDiagrama(medida) {
    return PAD_ARRIBA + ENCABEZADO_ALTO + (medida.lineas * LINEA_ALTO) + PAD_ABAJO;
  }

  function dibujarCanvasArbol() {
    // Pase 1: recorre el árbol asignando a cada nodo una "unidad" de
    // ancho (como columnas) y agrupándolos por nivel/fila.
    const filas = [];
    let cursor = { valor: 0 };
    function asignar(nodo, profundidad) {
      const medida = medirNodoDiagrama(nodo);
      const hijos = hijosParaDiagrama(nodo);
      let centro, anchoUnidades, hijosAsignados = [];
      if (hijos.length === 0) {
        centro = cursor.valor + 0.5;
        cursor.valor += 1;
        anchoUnidades = 1;
      } else {
        hijosAsignados = hijos.map(h => asignar(h, profundidad + 1));
        anchoUnidades = hijosAsignados.reduce((s, e) => s + e.anchoUnidades, 0);
        centro = (hijosAsignados[0].centro + hijosAsignados[hijosAsignados.length - 1].centro) / 2;
      }
      const entrada = { nodo, medida, profundidad, centro, anchoUnidades, hijosAsignados };
      if (!filas[profundidad]) filas[profundidad] = [];
      filas[profundidad].push(entrada);
      return entrada;
    }
    ARBOL_ORGANIGRAMA.forEach(n => asignar(n, 0));

    // Pase 2: alto de cada fila y su posición Y acumulada.
    const altoFila = filas.map(fila => Math.max(...fila.map(e => altoCajaDiagrama(e.medida))));
    const yFila = [];
    let acumY = MARGEN_LIENZO;
    for (let d = 0; d < filas.length; d++) {
      yFila[d] = acumY;
      acumY += altoFila[d] + SEP_V;
    }
    const alto = acumY - SEP_V + MARGEN_LIENZO;
    const ancho = cursor.valor * UNIDAD_ANCHO + MARGEN_LIENZO * 2;
    const xPx = centro => MARGEN_LIENZO + centro * UNIDAD_ANCHO;

    const canvas = document.createElement("canvas");
    const escala = 2;
    canvas.width = ancho * escala;
    canvas.height = alto * escala;
    const ctx = canvas.getContext("2d");
    ctx.scale(escala, escala);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, ancho, alto);
    ctx.textBaseline = "top";

    // Líneas conectoras primero (para que las cajas queden encima).
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1;
    filas.forEach(fila => fila.forEach(entrada => {
      if (entrada.hijosAsignados.length === 0) return;
      const yDesde = yFila[entrada.profundidad] + altoCajaDiagrama(entrada.medida);
      const xDesde = xPx(entrada.centro);
      const yMedio = yFila[entrada.profundidad + 1] - SEP_V / 2;
      const yHasta = yFila[entrada.profundidad + 1];

      ctx.beginPath();
      ctx.moveTo(xDesde + 0.5, yDesde);
      ctx.lineTo(xDesde + 0.5, yMedio);
      ctx.stroke();

      if (entrada.hijosAsignados.length > 1) {
        const xIni = xPx(entrada.hijosAsignados[0].centro);
        const xFin = xPx(entrada.hijosAsignados[entrada.hijosAsignados.length - 1].centro);
        ctx.beginPath();
        ctx.moveTo(xIni + 0.5, yMedio + 0.5);
        ctx.lineTo(xFin + 0.5, yMedio + 0.5);
        ctx.stroke();
      }

      entrada.hijosAsignados.forEach(hijo => {
        const xHijo = xPx(hijo.centro);
        ctx.beginPath();
        ctx.moveTo(xHijo + 0.5, yMedio);
        ctx.lineTo(xHijo + 0.5, yHasta);
        ctx.stroke();
      });
    }));

    // Cajas.
    filas.forEach(fila => fila.forEach(entrada => {
      const { medida, centro, profundidad } = entrada;
      const altoBox = altoCajaDiagrama(medida);
      const y = yFila[profundidad];
      const x = xPx(centro) - CAJA_ANCHO / 2;

      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = (medida.tipo === "area" || medida.tipo === "grupo") ? 1.6 : 1;
      ctx.fillRect(x, y, CAJA_ANCHO, altoBox);
      ctx.strokeRect(x + 0.5, y + 0.5, CAJA_ANCHO - 1, altoBox - 1);

      if (medida.tipo === "placeholder") {
        ctx.fillStyle = "#777777";
        ctx.font = "italic 11px Arial, sans-serif";
        ctx.fillText("Sin puestos capturados", x + PAD_LADO, y + PAD_ARRIBA, CAJA_ANCHO - PAD_LADO * 2);
        return;
      }

      let ty = y + PAD_ARRIBA;
      ctx.fillStyle = "#000000";
      ctx.font = "bold 12px Arial, sans-serif";
      ctx.fillText(medida.titulo, x + PAD_LADO, ty, CAJA_ANCHO - PAD_LADO * 2);
      ty += ENCABEZADO_ALTO;

      if (medida.tipo === "area" || medida.tipo === "grupo") {
        ctx.fillStyle = "#555555";
        ctx.font = "11px Arial, sans-serif";
        ctx.fillText(medida.subtitulo, x + PAD_LADO, ty, CAJA_ANCHO - PAD_LADO * 2);
        return;
      }

      if (medida.personas.length === 0) {
        ctx.fillStyle = "#777777";
        ctx.font = "italic 11px Arial, sans-serif";
        ctx.fillText("Vacante", x + PAD_LADO, ty, CAJA_ANCHO - PAD_LADO * 2);
      } else {
        ctx.font = "11px Arial, sans-serif";
        ctx.fillStyle = "#000000";
        medida.personas.forEach(nombre => {
          ctx.fillText("• " + nombre, x + PAD_LADO, ty, CAJA_ANCHO - PAD_LADO * 2);
          ty += LINEA_ALTO;
        });
      }
    }));

    return { canvas, ancho, alto };
  }

  function construirPendientesDocx(docx, partes) {
    const pendientesPorArea = calcularPendientesPorArea();
    if (pendientesPorArea.length === 0) return;

    partes.push(new docx.Paragraph({
      spacing: { before: 260, after: 80 },
      border: { top: { style: docx.BorderStyle.SINGLE, size: 6, color: COLOR_LINEA_CLARA, space: 8 } },
      children: [new docx.TextRun({ text: "Puestos sin ubicar en el árbol", bold: true, size: 20, color: COLOR_TEXTO })]
    }));
    partes.push(new docx.Paragraph({
      spacing: { after: 120 },
      children: [new docx.TextRun({
        text: "Estos puestos existen en Configuración › Áreas y puestos pero su Área/Puesto no coincide exactamente con lo que espera el árbol.",
        italics: true, size: 16, color: COLOR_GRIS
      })]
    }));
    pendientesPorArea.forEach(grupo => {
      partes.push(new docx.Paragraph({
        spacing: { before: 60, after: 20 },
        children: [new docx.TextRun({ text: "Área: " + grupo.area, bold: true, size: 17, color: COLOR_GRIS })]
      }));
      grupo.puestos.forEach(p => {
        const lista = titularesDe(grupo.area, p);
        const nombres = lista.length ? lista.map(u => u.nombre || "(sin nombre)").join(", ") : "Vacante";
        partes.push(new docx.Paragraph({
          spacing: { after: 10 },
          children: [
            new docx.TextRun({ text: "• " + p + ": ", size: 16, color: COLOR_TEXTO }),
            new docx.TextRun({ text: nombres, size: 16, color: COLOR_GRIS, italics: lista.length === 0 })
          ]
        }));
      });
    });
  }

  function construirFooterDocx(docx, fechaTexto, anchoHojaIn, margenLrIn) {
    // Tres columnas en una sola línea: fecha (izquierda) — empresa + url
    // (centro, con un tab centrado a la mitad del área de contenido) —
    // número de página (derecha). OJO: TabStopPosition.MAX es una
    // constante fija pensada para una hoja carta vertical normal — en
    // esta hoja horizontal personalizada cae ANTES del margen derecho
    // real, así que el tab de la derecha no se movía. Se calcula la
    // posición real del margen derecho a partir del ancho de la hoja.
    const anchoContenidoFooterIn = anchoHojaIn - margenLrIn * 2;
    const centroIn = anchoContenidoFooterIn / 2;
    return new docx.Footer({
      children: [
        new docx.Paragraph({
          tabStops: [
            { type: docx.TabStopType.CENTER, position: docx.convertInchesToTwip(centroIn) },
            { type: docx.TabStopType.RIGHT, position: docx.convertInchesToTwip(anchoContenidoFooterIn) }
          ],
          border: { top: { style: docx.BorderStyle.SINGLE, size: 4, color: COLOR_LINEA_CLARA, space: 6 } },
          children: [
            new docx.TextRun({ text: "Generado el " + fechaTexto, size: 15, color: COLOR_GRIS }),
            new docx.TextRun({ text: "\t" }),
            new docx.TextRun({ text: "AutoTransportes Alanis  ·  alanis.com.mx", size: 15, color: COLOR_GRIS }),
            new docx.TextRun({ text: "\t" }),
            new docx.TextRun({ text: "Página ", size: 15, color: COLOR_GRIS }),
            new docx.TextRun({ children: [docx.PageNumber.CURRENT], size: 15, color: COLOR_GRIS }),
            new docx.TextRun({ text: " de ", size: 15, color: COLOR_GRIS }),
            new docx.TextRun({ children: [docx.PageNumber.TOTAL_PAGES], size: 15, color: COLOR_GRIS })
          ]
        })
      ]
    });
  }
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto || "";
  return div.innerHTML;
}