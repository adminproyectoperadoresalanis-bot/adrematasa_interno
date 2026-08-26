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
    <button type="button" class="nav-boton" data-tab="${t.id}">${t.etiqueta}</button>
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