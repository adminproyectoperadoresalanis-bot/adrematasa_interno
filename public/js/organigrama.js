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
            puesto: "Coordinador",
            area: "Operaciones MEX",
            etiqueta: "Coordinador de operaciones MEX",
            hijos: [
              { puesto: "Supervisor", area: "Operaciones MEX", hijos: [] },
              { puesto: "Auxiliar", area: "Operaciones MEX", hijos: [] },
              { puesto: "Despachador", area: "Operaciones MEX", hijos: [] }
            ]
          },
          { puesto: "Coordinador", area: "Operaciones EUA", etiqueta: "Coordinador de operaciones EUA", hijos: [] },
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
      <h2>Organigrama</h2>
      <p class="nota">
        Línea de mando real de Alanis. Los nombres se toman de Catálogo de empleados
        (Área + Puesto de cada usuario activo); si un puesto no tiene a nadie asignado
        todavía, se muestra como "Vacante". Desliza a los lados para ver todo el árbol.
      </p>
      <div id="organigrama-error" class="error"></div>
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
          ${coordinador ? `<span class="insignia-coordinador">Coordinador</span>` : ""}
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

  function renderNodo(nodo) {
    let cajaHtml;
    let hijosNodos;

    if (nodo.esArea) {
      const { puestos, conteo } = datosArea(nodo.area);
      cajaHtml = `<div class="caja-area">${escapeHtml(nodo.area)}<span class="conteo">${conteo}</span></div>`;
      hijosNodos = puestos.map(p => ({ puesto: p, area: nodo.area, hijos: [] }));
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

  function renderOtros() {
    // Áreas o puestos del catálogo que todavía no están ubicados en el
    // árbol (por ejemplo, un área nueva agregada en Configuración). Se
    // listan aparte para que no se pierdan de vista.
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
              ${grupo.puestos.map(p => `<div style="width:240px;">${renderCajaPuesto(grupo.area, p)}</div>`).join("")}
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }
}

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto || "";
  return div.innerHTML;
}