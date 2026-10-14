// Menú inferior + sección "Utilidades".
//
// 2026-10-12 (paso 1, pedido de Ivan): "Escaneo QR" y "Gestión" (Horas extra /
// Vacaciones / Faltas) dejaron de ser pestañas sueltas y entraron por UNA
// sola pestaña, "Utilidades", que muestra tarjetas de opciones.
//
// 2026-10-12 (paso 1b, pedido de Ivan): todo lo de RH se unificó dentro de la
// opción RH — también Calendario, Reportes, Mi equipo, Catálogo de empleados y
// Organigrama, que antes eran pestañas del menú inferior. Para admin y
// supervisor, RH abre una lista en dos grupos:
//   - Solicitudes: al abrir una, arriba aparece la fila de toggles de siempre
//     para brincar entre ellas sin regresar a la lista.
//   - Consulta y administración: cada una abre sola.
// El empleado solo tiene 3 pantallas de RH, así que RH le abre directo los
// toggles (sin lista intermedia).
//
// Quién ve qué DENTRO de RH lo sigue decidiendo el rol (cada rol tiene su
// propia lista aquí abajo). Los ids son los mismos de siempre, así que el
// objeto `pantallas` que arma auth.js no cambia.
//
// Paso 2 (2026-10-12): qué opciones de Utilidades ve cada quien depende de su
// área (`usuarios.area`), configurable desde Configuración → "Acceso a
// Utilidades por área" (documento `configuracion/accesosUtilidades`). auth.js
// calcula la lista permitida y la pasa como 4º parámetro de
// iniciarNavegacion; el admin siempre ve todo (no se le pasa lista).
// Paso 3 (2026-10-13): opción Operadores — Aceptación de ingreso y Órdenes de
// trabajo de Alanis Operadores (ver js/operadores.js y
// functions/operadoresAlanis.js). Mismas pantallas para los 3 roles; quién la
// ve lo decide solo el área (tabla de accesos).

// Catálogo de opciones de Utilidades — lo usa configuracion.js para armar las
// columnas de la tabla de accesos. Al agregar una opción nueva basta con
// sumarla aquí para que aparezca su columna.
export const OPCIONES_UTILIDADES = [
  { id: "rh", etiqueta: "RH" },
  { id: "validacionQR", etiqueta: "Validación de QR" },
  { id: "operadores", etiqueta: "Operadores" }
];

const SVG = (contenido) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${contenido}</svg>`;

const ICONO_PERSONAS = SVG(`<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`);

const ICONOS = {
  // Menú inferior
  panel: SVG(`<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>`),
  utilidades: SVG(`<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>`),
  configuracion: SVG(`<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`),
  // Tarjetas de Utilidades
  rh: ICONO_PERSONAS,
  operadores: SVG(`<rect x="1" y="6" width="14" height="10" rx="1"/><path d="M15 9h4l3 3v4h-7"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>`),
  validacionQR: SVG(`<path d="M3 7V4a1 1 0 0 1 1-1h3"/><path d="M17 3h3a1 1 0 0 1 1 1v3"/><path d="M21 17v3a1 1 0 0 1-1 1h-3"/><path d="M7 21H4a1 1 0 0 1-1-1v-3"/><rect x="7" y="7" width="10" height="10" rx="1"/>`),
  // Renglones de la lista de RH
  solicitudes: SVG(`<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>`),
  vacaciones: SVG(`<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.2" y1="4.2" x2="5.6" y2="5.6"/><line x1="18.4" y1="18.4" x2="19.8" y2="19.8"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.2" y1="19.8" x2="5.6" y2="18.4"/><line x1="18.4" y1="5.6" x2="19.8" y2="4.2"/>`),
  faltas: SVG(`<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="17" y1="8" x2="22" y2="13"/><line x1="22" y1="8" x2="17" y2="13"/>`),
  autorizacionesExtra: SVG(`<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>`),
  calendarioVacaciones: SVG(`<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/>`),
  reportes: SVG(`<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>`),
  equipo: ICONO_PERSONAS,
  catalogo: ICONO_PERSONAS,
  organigrama: SVG(`<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="2" y="16" width="6" height="5" rx="1"/><rect x="16" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M12 12H5v4M12 12h7v4"/>`)
};

// ---- Puntos de alerta (2026-10-14) ----
// alertasRH.js llama marcarAlerta(idItem, true/false) cuando cambian los
// pendientes. Aquí solo se guarda el estado y se pinta: cualquier elemento
// con data-alerta="<id>" muestra el punto si ese id está activo. "rh" y
// "utilidades" se encienden si cualquier opción de RH tiene alerta.
const alertasActivas = {};
// Si el usuario no tiene RH en sus opciones, el punto de "Utilidades" no se enciende por RH.
let rhDisponible = true;
const IDS_ALERTA_RH = ["solicitudes", "vacaciones", "faltas"];

function alertaEncendida(id) {
  if (id === "utilidades" && !rhDisponible) return false;
  if (id === "rh" || id === "utilidades") return IDS_ALERTA_RH.some(i => alertasActivas[i]);
  return !!alertasActivas[id];
}

function refrescarAlertas() {
  document.querySelectorAll("[data-alerta]").forEach(el => {
    el.classList.toggle("activa", alertaEncendida(el.dataset.alerta));
  });
}

export function marcarAlerta(id, activa) {
  alertasActivas[id] = !!activa;
  refrescarAlertas();
}

const punto = (id) => `<span class="punto-alerta" data-alerta="${id}" aria-label="Hay pendientes"></span>`;

const FLECHA_ACORDEON =`<span class="rh-flecha">${SVG(`<polyline points="6 9 12 15 18 9"/>`)}</span>`;

// ---- Contenido de RH por rol ----

// Grupo "Solicitudes" (antes "Gestión"). `comoToggles`: al abrir uno, se
// dibuja la fila de toggles con todo el grupo.
const SOLICITUDES = [
  { id: "solicitudes", etiqueta: "Horas extra" },
  { id: "vacaciones", etiqueta: "Vacaciones" },
  { id: "faltas", etiqueta: "Faltas" }
];
const SOLICITUDES_ADMIN = [
  ...SOLICITUDES,
  // Autorizaciones extra (bonos/gratificaciones del correo semanal) — solo admin.
  { id: "autorizacionesExtra", etiqueta: "Extras" }
];

const CONSULTA_SUPERVISOR = [
  { id: "calendarioVacaciones", etiqueta: "Calendario" },
  { id: "reportes", etiqueta: "Reportes" },
  { id: "equipo", etiqueta: "Mi equipo" }
];
const CONSULTA_ADMIN = [
  { id: "calendarioVacaciones", etiqueta: "Calendario" },
  { id: "reportes", etiqueta: "Reportes" },
  { id: "catalogo", etiqueta: "Catálogo de empleados" },
  { id: "organigrama", etiqueta: "Organigrama" }
];

// El empleado usa sus propias pantallas de captura (ids distintos en auth.js).
const SUBTABS_RH_EMPLEADO = [
  { id: "horasExtra", etiqueta: "Horas extra" },
  { id: "vacaciones", etiqueta: "Vacaciones" },
  { id: "faltas", etiqueta: "Faltas" }
];

// Una opción de Utilidades puede tener:
//   `grupos`   → lista de renglones agrupados (RH de admin/supervisor)
//   `subtabs`  → fila de toggles directa (RH de empleado)
//   `pantalla` → dibuja directo esa pantalla (Validación de QR)
const rhConGrupos = (solicitudes, consulta) => ({
  id: "rh",
  etiqueta: "RH",
  descripcion: "Solicitudes · Calendario · Reportes",
  grupos: [
    { titulo: "Solicitudes", items: solicitudes, comoToggles: true },
    { titulo: "Consulta y administración", items: consulta }
  ]
});
const RH_EMPLEADO = {
  id: "rh",
  etiqueta: "RH",
  descripcion: "Horas extra · Vacaciones · Faltas",
  subtabs: SUBTABS_RH_EMPLEADO
};
const OPCION_QR = {
  id: "validacionQR",
  etiqueta: "Validación de QR",
  etiquetaCorta: "QR",
  descripcion: "Embarques McCain",
  pantalla: "escaneoOrigen"
};
const OPCION_OPERADORES = {
  id: "operadores",
  etiqueta: "Operadores",
  descripcion: "Aceptación · Órdenes de trabajo · Registrados",
  subtabs: [
    { id: "operadoresSolicitudes", etiqueta: "Aceptación de ingreso" },
    { id: "operadoresOrdenes", etiqueta: "Órdenes de trabajo" },
    { id: "operadoresRegistrados", etiqueta: "Operadores registrados" }
  ]
};

const TABS_POR_ROL = {
  // El empleado solo tiene "Utilidades": con un solo botón el menú inferior
  // no aporta nada, así que se oculta y entra directo a las tarjetas.
  empleado: [
    { id: "utilidades", etiqueta: "Utilidades", opciones: [RH_EMPLEADO, OPCION_QR, OPCION_OPERADORES] }
  ],
  supervisor: [
    { id: "panel", etiqueta: "Panel" },
    { id: "utilidades", etiqueta: "Utilidades", opciones: [rhConGrupos(SOLICITUDES, CONSULTA_SUPERVISOR), OPCION_QR, OPCION_OPERADORES] }
  ],
  admin: [
    { id: "panel", etiqueta: "Panel" },
    { id: "utilidades", etiqueta: "Utilidades", opciones: [rhConGrupos(SOLICITUDES_ADMIN, CONSULTA_ADMIN), OPCION_QR, OPCION_OPERADORES] },
    { id: "configuracion", etiqueta: "Configuración" }
  ]
};

// Estilos de Utilidades. Se inyectan una sola vez desde aquí para no tener
// que tocar estilos.css ni el ?v= de index.html.
function inyectarEstilosUtilidades() {
  if (document.getElementById("estilos-utilidades")) return;
  const estilo = document.createElement("style");
  estilo.id = "estilos-utilidades";
  estilo.textContent = `
    .utilidades-titulo { font-size: 18px; font-weight: 600; color: #2c1e0f; margin: 4px 0 12px; }
    .utilidades-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .utilidad-tarjeta { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; text-align: left;
      background: #fff; border: 1px solid #e2ddd5; border-radius: 12px; padding: 16px; cursor: pointer;
      color: #2c1e0f; font: inherit; }
    .utilidad-tarjeta:hover { border-color: #2c1e0f; }
    .utilidad-tarjeta svg { width: 26px; height: 26px; margin-bottom: 4px; }
    .utilidad-nombre { font-size: 15px; font-weight: 600; }
    .utilidad-desc { font-size: 12px; color: #6b5f52; }
    .utilidades-volver { background: none; border: none; padding: 0; margin: 0 0 4px; cursor: pointer;
      font: inherit; font-size: 13px; color: #6b5f52; }
    .utilidades-volver:hover { color: #2c1e0f; text-decoration: underline; }
    .utilidades-ruta { font-size: 18px; font-weight: 600; color: #2c1e0f; margin: 0 0 12px; }
    .rh-grupo-titulo { font-size: 12px; font-weight: 600; color: #6b5f52; text-transform: uppercase;
      letter-spacing: .03em; margin: 16px 0 6px; }
    .rh-grupo-titulo:first-child { margin-top: 0; }
    .rh-lista { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      background: #fff; border: 1px solid #e2ddd5; border-radius: 12px; overflow: hidden; }
    .rh-item { display: flex; align-items: center; gap: 10px; text-align: left; background: #fff;
      border: none; border-bottom: 1px solid #efebe5; padding: 12px 14px; cursor: pointer;
      color: #2c1e0f; font: inherit; font-size: 14px; }
    .rh-item:hover { background: #f5f3f0; }
    .rh-item svg { width: 20px; height: 20px; flex-shrink: 0; }
    .rh-item .rh-flecha { margin-left: auto; display: flex; transition: transform .15s; color: #6b5f52; }
    .rh-item .rh-flecha svg { width: 18px; height: 18px; }
    .rh-item.activo { background: #2c1e0f; color: #fff; font-weight: 600; }
    .rh-item.activo .rh-flecha { transform: rotate(180deg); color: #fff; }
    .rh-panel { grid-column: 1 / -1; background: #f5f3f0; border-bottom: 1px solid #efebe5;
      border-top: 3px solid #2c1e0f; padding: 12px; min-width: 0; }
    .utilidades-toggle { display: inline-flex; gap: 4px; padding: 4px; margin: 0 0 14px;
      background: #fff; border: 1px solid #e2ddd5; border-radius: 12px; max-width: 100%; }
    .utilidades-toggle-boton { display: flex; align-items: center; justify-content: center; gap: 8px;
      background: none; border: none; border-radius: 9px; padding: 10px 16px; cursor: pointer;
      font: inherit; font-size: 15px; color: #6b5f52; white-space: nowrap; }
    .utilidades-toggle-boton:hover { background: #f5f3f0; color: #2c1e0f; }
    .utilidades-toggle-boton.activo { background: #2c1e0f; color: #fff; font-weight: 600; }
    .utilidades-toggle-boton svg { width: 20px; height: 20px; flex-shrink: 0; }
    .utilidades-toggle-boton .corta { display: none; }
    .utilidades-regresar { display: inline-flex; align-items: center; gap: 8px; margin: 0 0 10px;
      background: #fff; border: 1px solid #e2ddd5; border-radius: 10px; padding: 10px 16px;
      cursor: pointer; font: inherit; font-size: 15px; font-weight: 600; color: #2c1e0f; }
    .utilidades-regresar:hover { border-color: #2c1e0f; }
    .punto-alerta { display: none; width: 9px; height: 9px; border-radius: 50%; background: #c0392b; flex-shrink: 0; }
    .punto-alerta.activa { display: inline-block; }
    .rh-item.activo .punto-alerta, .utilidades-toggle-boton.activo .punto-alerta { background: #fff; }
    .nav-boton { position: relative; }
    .nav-boton .punto-alerta { position: absolute; top: 6px; left: calc(50% + 8px); }
    .utilidad-nombre { display: inline-flex; align-items: center; gap: 8px; }
    @media (max-width: 600px) {
      .utilidades-toggle { display: flex; width: 100%; }
      .utilidades-toggle-boton { flex: 1; padding: 10px 8px; }
      .utilidades-toggle-boton .larga { display: none; }
      .utilidades-toggle-boton .corta { display: inline; }
    }
  `;
  document.head.appendChild(estilo);
}

// pantallas: objeto { idPantalla: (contenedor) => void } con la función que dibuja cada pantalla.
// pantallaInicial: id de la pestaña que se muestra al entrar (si no es una
// pestaña del rol, se usa la primera).
// opcionesPermitidas: arreglo de ids de OPCIONES_UTILIDADES que puede ver este
// usuario, o null para ver todas (admin, o mientras no exista configuración).
export function iniciarNavegacion(rol, pantallas, pantallaInicial, opcionesPermitidas = null) {
  const nav = document.getElementById("nav-inferior");
  const contenidoApp = document.getElementById("contenido-app");
  const tabs = (TABS_POR_ROL[rol] || []).map(t => {
    if (!t.opciones || !Array.isArray(opcionesPermitidas)) return t;
    return { ...t, opciones: t.opciones.filter(op => opcionesPermitidas.includes(op.id)) };
  });

  rhDisponible = tabs.some(t => t.opciones && t.opciones.some(op => op.id === "rh"));

  if (tabs.length === 0) {
    ocultarNavegacion();
    return;
  }

  inyectarEstilosUtilidades();

  // Con una sola pestaña (empleado) el menú inferior se oculta.
  if (tabs.length === 1) {
    ocultarNavegacion();
  } else {
    nav.innerHTML = tabs.map(t => `
      <button type="button" class="nav-boton" data-tab="${t.id}">${ICONOS[t.id] || ""}<span>${t.etiqueta}</span>${t.id === "utilidades" ? punto("utilidades") : ""}</button>
    `).join("");
    nav.classList.remove("oculto");
    document.body.classList.add("tiene-nav");
    refrescarAlertas();
  }

  function dibujarPantalla(idPantalla, contenedor) {
    const dibujar = pantallas[idPantalla];
    if (dibujar) {
      dibujar(contenedor);
    } else {
      contenedor.innerHTML = `<div class="panel"><p>Próximamente.</p></div>`;
    }
  }

  // Liga de regreso + título, y devuelve el contenedor donde va el contenido.
  function encabezado(textoVolver, alVolver, titulo) {
    contenidoApp.innerHTML = `
      <button type="button" class="utilidades-volver">← ${textoVolver}</button>
      <div class="utilidades-ruta">${titulo}</div>
      <div class="utilidades-contenido"></div>
    `;
    contenidoApp.querySelector(".utilidades-volver").addEventListener("click", alVolver);
    return contenidoApp.querySelector(".utilidades-contenido");
  }

  // 2026-10-13 (pedido de Ivan): en vez de la liga chiquita "← Utilidades",
  // arriba va un toggle con las opciones de Utilidades que el usuario tiene
  // permitidas, para brincar entre RH / QR / Operadores con un solo clic.
  // Si solo tiene una opción, no hay a dónde cambiar: se queda el encabezado
  // de antes. `regreso` ({ texto, alVolver }) es para el nivel 3 (dentro de
  // un renglón de RH): agrega un botón grande para volver a la lista.
  function encabezadoOpcion(tab, opcionActiva, titulo, regreso = null) {
    if (tab.opciones.length <= 1) {
      return regreso
        ? encabezado(regreso.texto, regreso.alVolver, titulo)
        : encabezado("Utilidades", () => mostrarUtilidades(tab), titulo);
    }
    contenidoApp.innerHTML = `
      <div class="utilidades-toggle" role="tablist">
        ${tab.opciones.map(op => `
          <button type="button" role="tab" class="utilidades-toggle-boton${op.id === opcionActiva.id ? " activo" : ""}"
            data-opcion="${op.id}" aria-selected="${op.id === opcionActiva.id}">
            ${ICONOS[op.id] || ""}<span class="larga">${op.etiqueta}</span><span class="corta">${op.etiquetaCorta || op.etiqueta}</span>${op.id === "rh" ? punto("rh") : ""}
          </button>
        `).join("")}
      </div>
      ${regreso ? `<button type="button" class="utilidades-regresar">← ${regreso.texto}</button>` : ""}
      ${titulo && regreso ? `<div class="utilidades-ruta">${titulo}</div>` : ""}
      <div class="utilidades-contenido"></div>
    `;
    contenidoApp.querySelectorAll(".utilidades-toggle-boton").forEach(btn => {
      btn.addEventListener("click", () => {
        const opcion = tab.opciones.find(op => op.id === btn.dataset.opcion);
        if (opcion) abrirOpcion(tab, opcion);
      });
    });
    if (regreso) {
      contenidoApp.querySelector(".utilidades-regresar").addEventListener("click", regreso.alVolver);
    }
    refrescarAlertas();
    return contenidoApp.querySelector(".utilidades-contenido");
  }

  // Fila de toggles arriba y, abajo, la pantalla del toggle seleccionado — la
  // fila se queda fija mientras se cambia entre ellos.
  function mostrarGrupo(contenedor, subtabs, idSubtabInicial) {
    contenedor.innerHTML = `
      <div class="subnav-gestion">
        ${subtabs.map(st => `<button type="button" class="subnav-boton" data-subtab="${st.id}">${st.etiqueta}</button>`).join("")}
      </div>
      <div class="subnav-contenido"></div>
    `;
    const subContenido = contenedor.querySelector(".subnav-contenido");
    const botonesSubtab = contenedor.querySelectorAll(".subnav-boton");

    function mostrarSubtab(idSubtab) {
      botonesSubtab.forEach(btn => btn.classList.toggle("activo", btn.dataset.subtab === idSubtab));
      dibujarPantalla(idSubtab, subContenido);
    }

    botonesSubtab.forEach(btn => {
      btn.addEventListener("click", () => mostrarSubtab(btn.dataset.subtab));
    });

    mostrarSubtab(idSubtabInicial || subtabs[0].id);
  }

  // Nivel 1: tarjetas de Utilidades.
  function mostrarUtilidades(tab) {
    if (tab.opciones.length === 0) {
      contenidoApp.innerHTML = `
        <div class="utilidades-titulo">Utilidades</div>
        <div class="panel"><p>Todavía no tienes opciones asignadas.</p>
        <p class="nota">Contacta al administrador para que habilite las opciones de tu área.</p></div>
      `;
      return;
    }
    contenidoApp.innerHTML = `
      <div class="utilidades-titulo">Utilidades</div>
      <div class="utilidades-grid">
        ${tab.opciones.map(op => `
          <button type="button" class="utilidad-tarjeta" data-opcion="${op.id}">
            ${ICONOS[op.id] || ""}
            <span class="utilidad-nombre">${op.etiqueta}${op.id === "rh" ? punto("rh") : ""}</span>
            <span class="utilidad-desc">${op.descripcion}</span>
          </button>
        `).join("")}
      </div>
    `;
    contenidoApp.querySelectorAll(".utilidad-tarjeta").forEach(btn => {
      btn.addEventListener("click", () => {
        const opcion = tab.opciones.find(op => op.id === btn.dataset.opcion);
        if (opcion) abrirOpcion(tab, opcion);
      });
    });
    refrescarAlertas();
  }

  // Nivel 2: una opción abierta (lista agrupada, toggles o pantalla directa).
  function abrirOpcion(tab, opcion) {
    const contenedor = encabezadoOpcion(tab, opcion, opcion.etiqueta);
    if (opcion.grupos) {
      dibujarListaGrupos(contenedor, tab, opcion);
    } else if (opcion.subtabs) {
      mostrarGrupo(contenedor, opcion.subtabs);
    } else {
      dibujarPantalla(opcion.pantalla, contenedor);
    }
  }

  // 2026-10-13 (pedido de Ivan): la lista de RH funciona como acordeón — al
  // tocar un renglón, su pantalla se despliega ahí mismo y se quita el botón
  // de regresar. Solo hay uno abierto a la vez; tocar el mismo lo cierra.
  // En celular (1 columna) se abre justo debajo del renglón; en computadora
  // (varias columnas) se abre debajo de la fila donde está ese renglón.
  function dibujarListaGrupos(contenedor, tab, opcion) {
    contenedor.innerHTML = opcion.grupos.map((grupo, i) => `
      <div class="rh-grupo-titulo">${grupo.titulo}</div>
      <div class="rh-lista">
        ${grupo.items.map(item => `
          <button type="button" class="rh-item" data-grupo="${i}" data-item="${item.id}" aria-expanded="false">
            ${ICONOS[item.id] || ""}<span>${item.etiqueta}</span>${punto(item.id)}${FLECHA_ACORDEON}
          </button>
        `).join("")}
      </div>
    `).join("");
    refrescarAlertas();

    function cerrarAbierto() {
      contenedor.querySelector(".rh-panel")?.remove();
      contenedor.querySelectorAll(".rh-item.activo").forEach(b => {
        b.classList.remove("activo");
        b.setAttribute("aria-expanded", "false");
      });
    }

    contenedor.querySelectorAll(".rh-item").forEach(btn => {
      btn.addEventListener("click", () => {
        const yaAbierto = btn.classList.contains("activo");
        cerrarAbierto();
        if (yaAbierto) return;

        const lista = btn.parentElement;
        const botones = [...lista.querySelectorAll(".rh-item")];
        const columnas = getComputedStyle(lista).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
        const indice = botones.indexOf(btn);
        const ultimoDeLaFila = botones[Math.min(botones.length - 1, Math.floor(indice / columnas) * columnas + columnas - 1)];

        const panel = document.createElement("div");
        panel.className = "rh-panel";
        ultimoDeLaFila.after(panel);
        btn.classList.add("activo");
        btn.setAttribute("aria-expanded", "true");
        dibujarPantalla(btn.dataset.item, panel);
        btn.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    });
  }

  function mostrar(idTab) {
    nav.querySelectorAll(".nav-boton").forEach(btn => {
      btn.classList.toggle("activo", btn.dataset.tab === idTab);
    });
    const tab = tabs.find(t => t.id === idTab);
    if (tab && tab.opciones) {
      mostrarUtilidades(tab);
      return;
    }
    dibujarPantalla(idTab, contenidoApp);
  }

  nav.querySelectorAll(".nav-boton").forEach(btn => {
    btn.addEventListener("click", () => mostrar(btn.dataset.tab));
  });

  const inicial = tabs.some(t => t.id === pantallaInicial) ? pantallaInicial : tabs[0].id;
  mostrar(inicial);
}

export function ocultarNavegacion() {
  const nav = document.getElementById("nav-inferior");
  nav.classList.add("oculto");
  nav.innerHTML = "";
  document.body.classList.remove("tiene-nav");
}