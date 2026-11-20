# ##########################################################################
# PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
# RUTA:     /workspaces/adrematasa_interno/scripts/agregar_reporte_mantenimiento.py
# ##########################################################################
# Mantenimiento › pestaña "📊 Reporte" (2026-11-19). Conecta
# public/js/mantenimientoReporte.js con public/js/mantenimiento.js:
#   1) el import
#   2) la pestaña junto a "Nueva solicitud" y "Solicitudes"
#   3) que al elegirla dibuje el reporte
# Si ya estaba o no encuentra algún punto, NO cambia nada.
# Se corre desde la RAÍZ del repo:  python3 scripts/agregar_reporte_mantenimiento.py

import sys

RUTA = "public/js/mantenimiento.js"
MARCA = "iniciarReporteMantenimiento"

CAMBIOS = [
    ('import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";',
     'import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";\n'
     '// 2026-11-19: pestaña "📊 Reporte" (resumen por rango de fechas, PDF y Excel).\n'
     'import { iniciarReporteMantenimiento } from "./mantenimientoReporte.js";'),
    ('if (tab === "nueva") renderNueva(); else renderLista();',
     'if (tab === "nueva") renderNueva(); else if (tab === "reporte") iniciarReporteMantenimiento($("#mt-cuerpo")); else renderLista();'),
]

try:
    t = open(RUTA, encoding="utf-8").read()
except FileNotFoundError:
    print(f"ERROR: no encontré {RUTA}. ¿Estás en la raíz del repo? No se cambió nada.")
    sys.exit(1)
if MARCA in t:
    print("Ya estaba aplicado. No se cambió nada.")
    sys.exit(0)

# La pestaña: el texto real termina en `...` : ""}`]] — se busca sin depender de los backticks exactos.
ANCLA_TABS = '"s"})` : ""}`]]\n      .map(([k, t])'
NUEVO_TABS = '"s"})` : ""}`], ["reporte", "📊 Reporte"]]\n      .map(([k, t])'
cambios = [CAMBIOS[0], (ANCLA_TABS, NUEVO_TABS), CAMBIOS[1]]

for viejo, nuevo in cambios:
    if t.count(viejo) != 1:
        print("ERROR: no encontré este punto en mantenimiento.js. No se cambió nada.")
        print("   " + viejo.splitlines()[0][:90])
        print("Pégale a Claude la salida de: grep -n 'renderNueva(); else\\|data-t=\\|firebase-functions' public/js/mantenimiento.js")
        sys.exit(1)
for viejo, nuevo in cambios:
    t = t.replace(viejo, nuevo)
open(RUTA, "w", encoding="utf-8").write(t)
print("Listo: pestaña Reporte agregada a Mantenimiento.")
