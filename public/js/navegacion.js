// Menú inferior + sección "Utilidades" (2026-10-12, pedido de Ivan).
//
// Antes, "Escaneo QR" era una pestaña suelta en los 3 roles y "Horas extra /
// Vacaciones / Faltas" vivían en "Gestión" (admin/supervisor) o como 3
// pestañas sueltas (empleado). Ahora todo eso entra por UNA sola pestaña,
// "Utilidades", que muestra tarjetas de opciones:
//   - RH: los mismos toggles de siempre (Horas extra / Vacaciones / Faltas,
//     y "Extras" solo para admin).
//   - Validación de QR: la pantalla de escaneoOrigen.js, sin cambios.
//   - (Paso 3, pendiente) Operadores: aceptación de ingreso + órdenes de trabajo.
// Los ids de pantallas (solicitudes, horasExtra, vacaciones, faltas,
// escaneoOrigen...) son los mismos de antes, así que el objeto `pantallas`
// que arma auth.js no cambia.
//
// Paso 2 (pendiente): filtrar qué opciones ve cada quien según su área,
// configurable desde Configuración. Por ahora todos ven las mismas opciones
// que ya veían antes (RH y Validación de QR).

// Toggles de RH para admin y supervisor (antes, "Gestión").
const SUBTABS_RH = [
  { id: "solicitudes", etiqueta: "Horas extra" },
  { id: "vacaciones", etiqueta: "Vacaciones" },
  { id: "faltas", etiqueta: "Faltas" }
];

// Solo el admin ve un cuarto toggle: "Extras" = autorizaciones extra
// (bonos/gratificaciones del correo semanal — ver js/autorizacionesExtra.js).
const SUBTABS_RH_ADMIN = [
  ...SUBTABS_RH,
  { id: "autorizacionesExtra", etiqueta: "Extras" }
];

// El empleado usa sus propias pantallas de captura (ids distintos en auth.js).
const SUBTABS_RH_EMPLEADO = [
  { id: "horasExtra", etiqueta: "Horas extra" },
  { id: "vacaciones", etiqueta: "Vacaciones" },
  { id: "faltas", etiqueta: "Faltas" }
];

// Una opción de Utilidades tiene `subtabs` (dibuja una fila de toggles) o
// `pantalla` (dibuja directo esa pantalla del objeto `pantallas`).
const opcionRH = (subtabs) => ({
  id: "rh",
  etiqueta: "RH",
  descripcion: "Horas extra · Vacaciones · Faltas",
  subtabs
});
const OPCION_QR = {
  id: "validacionQR",
  etiqueta: "Validación de QR",
  descripcion: "Embarques McCain",
  pantalla: "escaneoOrigen"
};

const SVG = (contenido) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${contenido}</svg>`;

const ICONO_PERSONAS = SVG(`<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`);
const ICONO_QR = SVG(`<path d="M3 7V4a1 1 0 0 1 1-1h3"/><path d="M17 3h3a1 1 0 0 1 1 1v3"/><path d="M21 17v3a1 1 0 0 1-1 1h-3"/><path d="M7 21H4a1 1 0 0 1-1-1v-3"/><rect x="7" y="7" width="10" height="10" rx="1"/>`);

// Un ícono por pestaña del menú inferior (SVG en línea, sin fuentes de
// íconos ni emoji — así se ve igual en cualquier celular).
const ICONOS_NAV = {
  panel: SVG(`<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>`),
  utilidades: SVG(`<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>`),
  equipo: ICONO_PERSONAS,
  catalogo: ICONO_PERSONAS,
  calendarioVacaciones: SVG(`<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/>`),
  reportes: SVG(`<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>`),
  organigrama: SVG(`<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="2" y="16" width="6" height="5" rx="1"/><rect x="16" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M12 12H5v4M12 12h7v4"/>`),
  configuracion: SVG(`<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`)
};

const ICONOS_UTILIDADES = {
  rh: ICONO_PERSONAS,
  validacionQR: ICONO_QR
};

const TABS_POR_ROL = {
  // El empleado solo tiene "Utilidades": con un solo botón el menú inferior
  // no aporta nada, así que se oculta y entra directo a las tarjetas.
  empleado: [
    { id: "utilidades", etiqueta: "Utilidades", opciones: [opcionRH(SUBTABS_RH_EMPLEADO), OPCION_QR] }
  ],
  supervisor: [
    { id: "panel", etiqueta: "Panel" },
    { id: "utilidades", etiqueta: "Utilidades", opciones: [opcionRH(SUBTABS_RH), OPCION_QR] },
    { id: "equipo", etiqueta: "Mi equipo" },
    { id: "calendarioVacaciones", etiqueta: "Calendario" },
    { id: "reportes", etiqueta: "Reportes" }
  ],
  admin: [
    { id: "panel", etiqueta: "Panel" },
    { id: "utilidades", etiqueta: "Utilidades", opciones: [opcionRH(SUBTABS_RH_ADMIN), OPCION_QR] },
    { id: "calendarioVacaciones", etiqueta: "Calendario" },
    { id: "catalogo", etiqueta: "Catálogo de empleados" },
    { id: "organigrama", etiqueta: "Organigrama" },
    { id: "reportes", etiqueta: "Reportes" },
    { id: "configuracion", etiqueta: "Configuración" }
  ]
};

// Estilos de las tarjetas de Utilidades. Se inyectan una sola vez desde aquí
// (igual que la versión en el menú de cuenta en auth.js) para que este paso
// no obligue a tocar estilos.css ni el ?v= de index.html.
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
  `;
  document.head.appendChild(estilo);
}

// pantallas: objeto { idPantalla: (contenedor) => void } con la función que dibuja cada pantalla.
// pantallaInicial: id de la pestaña que se muestra al entrar.
export function iniciarNavegacion(rol, pantallas, pantallaInicial) {
  const nav = document.getElementById("nav-inferior");
  const contenidoApp = document.getElementById("contenido-app");
  const tabs = TABS_POR_ROL[rol] || [];

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
      <button type="button" class="nav-boton" data-tab="${t.id}">${ICONOS_NAV[t.id] || ""}<span>${t.etiqueta}</span></button>
    `).join("");
    nav.classList.remove("oculto");
    document.body.classList.add("tiene-nav");
  }

  function dibujarPantalla(idPantalla, contenedor) {
    const dibujar = pantallas[idPantalla];
    if (dibujar) {
      dibujar(contenedor);
    } else {
      contenedor.innerHTML = `<div class="panel"><p>Próximamente.</p></div>`;
    }
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

  // Pantalla de tarjetas de Utilidades.
  function mostrarUtilidades(tab) {
    contenidoApp.innerHTML = `
      <div class="utilidades-titulo">Utilidades</div>
      <div class="utilidades-grid">
        ${tab.opciones.map(op => `
          <button type="button" class="utilidad-tarjeta" data-opcion="${op.id}">
            ${ICONOS_UTILIDADES[op.id] || ""}
            <span class="utilidad-nombre">${op.etiqueta}</span>
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
  }

  // Una opción ya abierta: liga "← Utilidades" para regresar, el nombre de la
  // opción, y abajo sus toggles o su pantalla.
  function abrirOpcion(tab, opcion) {
    contenidoApp.innerHTML = `
      <button type="button" class="utilidades-volver">← Utilidades</button>
      <div class="utilidades-ruta">${opcion.etiqueta}</div>
      <div class="utilidades-contenido"></div>
    `;
    contenidoApp.querySelector(".utilidades-volver")
      .addEventListener("click", () => mostrarUtilidades(tab));
    const contenedor = contenidoApp.querySelector(".utilidades-contenido");
    if (opcion.subtabs) {
      mostrarGrupo(contenedor, opcion.subtabs);
    } else {
      dibujarPantalla(opcion.pantalla, contenedor);
    }
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