// "Horas extra", "Vacaciones" y "Faltas" comparten un solo botón del menú
// inferior ("Gestión") en los roles que ya tienen muchas pestañas (admin y
// supervisor) — en el celular no cabían todas. Un tab con "subtabs" no
// dibuja una pantalla directamente: dentro de él aparecen 3 toggles y cada
// uno dibuja la pantalla de siempre (los ids de los subtabs son justo los
// mismos ids que ya existían como tabs sueltos, así que el objeto
// `pantallas` que arma auth.js no cambia nada).
const SUBTABS_GESTION = [
  { id: "solicitudes", etiqueta: "Horas extra" },
  { id: "vacaciones", etiqueta: "Vacaciones" },
  { id: "faltas", etiqueta: "Faltas" }
];

// Un ícono representativo por pestaña del menú inferior (SVG en línea, sin
// depender de ninguna fuente de íconos ni de emoji — así se ve igual en
// cualquier celular). "equipo" y "catalogo" comparten el mismo ícono de
// personas porque nunca aparecen juntos (uno es de supervisor, el otro de
// admin).
const ICONOS_NAV = {
  panel: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/></svg>`,
  gestion: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="3" width="12" height="18" rx="2"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>`,
  equipo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  catalogo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  calendarioVacaciones: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg>`,
  reportes: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
  organigrama: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="5" rx="1"/><rect x="2" y="16" width="6" height="5" rx="1"/><rect x="16" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M12 12H5v4M12 12h7v4"/></svg>`,
  configuracion: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  horasExtra: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>`,
  vacaciones: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.2" y1="4.2" x2="5.6" y2="5.6"/><line x1="18.4" y1="18.4" x2="19.8" y2="19.8"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.2" y1="19.8" x2="5.6" y2="18.4"/><line x1="18.4" y1="5.6" x2="19.8" y2="4.2"/></svg>`,
  faltas: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="17" y1="8" x2="22" y2="13"/><line x1="22" y1="8" x2="17" y2="13"/></svg>`
};

const TABS_POR_ROL = {
  // Empleado ya tenía solo 3 pestañas — le entran bien al celular tal cual,
  // así que aquí no se agrupan en "Gestión" (agruparlas dejaría un menú de
  // una sola opción, sin ganar nada).
  empleado: [
    { id: "horasExtra", etiqueta: "Horas extra" },
    { id: "vacaciones", etiqueta: "Vacaciones" },
    { id: "faltas", etiqueta: "Faltas" }
  ],
  supervisor: [
    { id: "panel", etiqueta: "Panel" },
    { id: "gestion", etiqueta: "Gestión", subtabs: SUBTABS_GESTION },
    { id: "equipo", etiqueta: "Mi equipo" },
    { id: "calendarioVacaciones", etiqueta: "Calendario" },
    { id: "reportes", etiqueta: "Reportes" }
  ],
  admin: [
    { id: "panel", etiqueta: "Panel" },
    { id: "calendarioVacaciones", etiqueta: "Calendario" },
    { id: "gestion", etiqueta: "Gestión", subtabs: SUBTABS_GESTION },
    { id: "catalogo", etiqueta: "Catálogo de empleados" },
    { id: "organigrama", etiqueta: "Organigrama" },
    { id: "reportes", etiqueta: "Reportes" },
    { id: "configuracion", etiqueta: "Configuración" }
  ]
};

// pantallas: objeto { idTab: (contenedor) => void } con la función que dibuja cada pestaña.
// pantallaInicial: id de la pestaña que se muestra al entrar.
export function iniciarNavegacion(rol, pantallas, pantallaInicial) {
  const nav = document.getElementById("nav-inferior");
  const contenidoApp = document.getElementById("contenido-app");
  const tabs = TABS_POR_ROL[rol] || [];

  if (tabs.length === 0) {
    nav.classList.add("oculto");
    nav.innerHTML = "";
    document.body.classList.remove("tiene-nav");
    return;
  }

  nav.innerHTML = tabs.map(t => `
    <button type="button" class="nav-boton" data-tab="${t.id}">${ICONOS_NAV[t.id] || ""}<span>${t.etiqueta}</span></button>
  `).join("");
  nav.classList.remove("oculto");
  document.body.classList.add("tiene-nav");

  // Dibuja el submenú de "Gestión": una fila de toggles (Horas extra /
  // Vacaciones / Faltas) arriba, y abajo la pantalla de lo que esté
  // seleccionado — la fila de toggles se queda fija mientras se cambia
  // entre las 3, para no tener que volver a tocar "Gestión" cada vez.
  function mostrarGrupo(tab, idSubtabInicial) {
    contenidoApp.innerHTML = `
      <div class="subnav-gestion">
        ${tab.subtabs.map(st => `<button type="button" class="subnav-boton" data-subtab="${st.id}">${st.etiqueta}</button>`).join("")}
      </div>
      <div class="subnav-contenido"></div>
    `;
    const subContenido = contenidoApp.querySelector(".subnav-contenido");
    const botonesSubtab = contenidoApp.querySelectorAll(".subnav-boton");

    function mostrarSubtab(idSubtab) {
      botonesSubtab.forEach(btn => btn.classList.toggle("activo", btn.dataset.subtab === idSubtab));
      const dibujar = pantallas[idSubtab];
      if (dibujar) {
        dibujar(subContenido);
      } else {
        subContenido.innerHTML = `<div class="panel"><p>Próximamente.</p></div>`;
      }
    }

    botonesSubtab.forEach(btn => {
      btn.addEventListener("click", () => mostrarSubtab(btn.dataset.subtab));
    });

    mostrarSubtab(idSubtabInicial || tab.subtabs[0].id);
  }

  function mostrar(idTab) {
    nav.querySelectorAll(".nav-boton").forEach(btn => {
      btn.classList.toggle("activo", btn.dataset.tab === idTab);
    });
    const tab = tabs.find(t => t.id === idTab);
    if (tab && tab.subtabs) {
      mostrarGrupo(tab);
      return;
    }
    const dibujar = pantallas[idTab];
    if (dibujar) {
      dibujar(contenidoApp);
    } else {
      contenidoApp.innerHTML = `<div class="panel"><p>Próximamente.</p></div>`;
    }
  }

  nav.querySelectorAll(".nav-boton").forEach(btn => {
    btn.addEventListener("click", () => mostrar(btn.dataset.tab));
  });

  mostrar(pantallaInicial || tabs[0].id);
}

export function ocultarNavegacion() {
  const nav = document.getElementById("nav-inferior");
  nav.classList.add("oculto");
  nav.innerHTML = "";
  document.body.classList.remove("tiene-nav");
}