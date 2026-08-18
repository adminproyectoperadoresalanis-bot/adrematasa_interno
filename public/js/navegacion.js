const TABS_POR_ROL = {
  empleado: [
    { id: "horasExtra", etiqueta: "Horas extra" },
    { id: "vacaciones", etiqueta: "Vacaciones" },
    { id: "faltas", etiqueta: "Faltas" }
  ],
  supervisor: [
    { id: "panel", etiqueta: "Panel" },
    { id: "solicitudes", etiqueta: "Horas extra" },
    { id: "vacaciones", etiqueta: "Vacaciones" },
    { id: "faltas", etiqueta: "Faltas" },
    { id: "equipo", etiqueta: "Mi equipo" },
    { id: "reportes", etiqueta: "Reportes" }
  ],
  admin: [
    { id: "panel", etiqueta: "Panel" },
    { id: "solicitudes", etiqueta: "Horas extra" },
    { id: "vacaciones", etiqueta: "Vacaciones" },
    { id: "faltas", etiqueta: "Faltas" },
    { id: "catalogo", etiqueta: "Catálogo de empleados" },
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

  function mostrar(idTab) {
    nav.querySelectorAll(".nav-boton").forEach(btn => {
      btn.classList.toggle("activo", btn.dataset.tab === idTab);
    });
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