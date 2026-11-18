# ##########################################################################
# PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
# RUTA:     /workspaces/adrematasa_interno/scripts/agregar_ataf104_configuracion.py
# ##########################################################################
# ATAF104 día festivo (2026-11-18). Agrega a public/js/configuracion.js, en
# "1 · RH", el acordeón "Formato día festivo ATAF104 (correo por área)",
# justo debajo de "Reporte semanal de nómina". El contenido lo dibuja
# formatoFestivo.js (iniciarConfigFestivo), igual que Comercial dibuja el suyo.
# Tres cambios, nada más:
#   1) import de iniciarConfigFestivo
#   2) el acordeón (HTML)
#   3) la llamada a iniciarConfigFestivo
# Si ya estaba aplicado o no encuentra algún punto, NO cambia nada.
# Se corre desde la RAÍZ del repo:
#   python3 scripts/agregar_ataf104_configuracion.py

import sys

RUTA = "public/js/configuracion.js"
MARCA = "iniciarConfigFestivo"

IMPORT_ANCLA = 'import { iniciarAjustesComercial } from "./comercial.js";'
IMPORT_NUEVO = '\nimport { iniciarConfigFestivo } from "./formatoFestivo.js";'

HTML_NUEVO = '''
      <details class="cfg-acordeon">
        <summary>
          <svg class="cfg-icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/><path d="M8 14h8M8 18h5"/></svg>
          <span class="cfg-titulos"><span class="cfg-titulo">Formato día festivo ATAF104 (correo por área)</span><span class="cfg-resumen" id="resumen-festivo-ataf104">Cargando…</span></span>
          <span class="cfg-chevron" aria-hidden="true">›</span>
        </summary>
        <div class="cfg-cuerpo" id="cfg-festivo-ataf104"><p class="nota">Cargando…</p></div>
      </details>'''

LLAMADA_ANCLA = 'iniciarAjustesComercial(contenedor.querySelector("#cfg-comercial")'
LLAMADA_NUEVA = '''
  // ATAF104 día festivo (2026-11-18): destinatarios por área en configuracion/ataf104.
  iniciarConfigFestivo(contenedor.querySelector("#cfg-festivo-ataf104"), contenedor.querySelector("#resumen-festivo-ataf104"));'''

def falla(msg):
    print("ERROR: " + msg + " No se cambió nada.")
    print("Pégale a Claude la salida de: grep -n 'iniciarAjustesComercial\\|btn-guardar-reporte-correo' public/js/configuracion.js")
    sys.exit(1)

try:
    t = open(RUTA, encoding="utf-8").read()
except FileNotFoundError:
    print(f"ERROR: no encontré {RUTA}. ¿Estás en la raíz del repo? No se cambió nada.")
    sys.exit(1)

if MARCA in t:
    print("Ya estaba aplicado. No se cambió nada.")
    sys.exit(0)

# 1) import
if t.count(IMPORT_ANCLA) != 1:
    falla("no encontré el import de iniciarAjustesComercial.")
t = t.replace(IMPORT_ANCLA, IMPORT_ANCLA + IMPORT_NUEVO)

# 2) acordeón: después del </details> que cierra "Reporte semanal de nómina"
i = t.find('id="btn-guardar-reporte-correo"')
if i < 0 or t.count('id="btn-guardar-reporte-correo"') != 1:
    falla("no encontré el acordeón de Reporte semanal de nómina.")
j = t.find("</details>", i)
if j < 0:
    falla("no encontré el cierre del acordeón de Reporte semanal de nómina.")
j += len("</details>")
t = t[:j] + HTML_NUEVO + t[j:]

# 3) llamada: al final de la línea de iniciarAjustesComercial(...)
if t.count(LLAMADA_ANCLA) != 1:
    falla("no encontré la llamada a iniciarAjustesComercial.")
k = t.find(LLAMADA_ANCLA)
fin = t.find("\n", k)
if fin < 0:
    falla("la llamada a iniciarAjustesComercial no termina en salto de línea.")
t = t[:fin] + LLAMADA_NUEVA + t[fin:]

open(RUTA, "w", encoding="utf-8").write(t)
print("Listo: acordeón ATAF104 agregado en Configuración › 1 · RH.")
