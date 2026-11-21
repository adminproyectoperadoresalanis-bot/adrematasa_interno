# ##########################################################################
# PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
# RUTA:     /workspaces/adrematasa_interno/scripts/agregar_analisis_grafica.py
# ##########################################################################
# Utilidades › "Análisis de gráfica" (2026-11-21). Conecta analisisGrafica.js:
#   1) public/js/navegacion.js: opción en OPCIONES_UTILIDADES (tabla de accesos
#      por área), ícono, tarjeta OPCION_GRAFICA y la agrega a Utilidades de
#      empleado, supervisor y admin (junto a "Análisis de operaciones").
#   2) public/js/auth.js: import y la pantalla analisisGrafica en los 3 roles.
# Revisa todo ANTES de escribir: si algún punto no se encuentra, no cambia nada.
# Si ya estaba, lo avisa y no duplica.
# Se corre desde la RAÍZ del repo:  python3 scripts/agregar_analisis_grafica.py

import re
import sys

NAV = "public/js/navegacion.js"
AUTH = "public/js/auth.js"

try:
    nav = open(NAV, encoding="utf-8").read()
    auth = open(AUTH, encoding="utf-8").read()
except FileNotFoundError as e:
    print(f"ERROR: no encontré {e.filename}. ¿Estás en la raíz del repo?")
    sys.exit(1)

if "analisisGrafica" in nav and "analisisGrafica" in auth:
    print("Ya estaba conectado. No se cambió nada.")
    sys.exit(0)

errores = []

# ---- navegacion.js ----
# 1) Catálogo de opciones (tabla de accesos).
anc1 = '  { id: "analisisOperaciones", etiqueta: "Análisis de operaciones" }'
if nav.count(anc1) != 1:
    errores.append(f"{NAV}: no encontré la opción analisisOperaciones en OPCIONES_UTILIDADES.")
else:
    resto = nav.split(anc1, 1)[1]
    sigue_coma = resto.startswith(",")
    nueva = anc1 + ',\n  { id: "analisisGrafica", etiqueta: "Análisis de gráfica" }'
    nav = nav.replace(anc1 + ("," if sigue_coma else ""), nueva + ("," if sigue_coma else ""), 1)

# 2) Ícono (gráfica con marca vertical).
anc2 = re.search(r'\n  analisisOperaciones: SVG\(`[^`]*`\),', nav)
if not anc2:
    errores.append(f"{NAV}: no encontré el ícono de analisisOperaciones.")
else:
    icono = '\n  analisisGrafica: SVG(`<path d="M3 3v18h18"/><polyline points="6 15 10 11 13 13 20 6"/><line x1="15" y1="4" x2="15" y2="18" stroke-dasharray="2 2"/>`),'
    nav = nav[:anc2.end()] + icono + nav[anc2.end():]

# 3) Tarjeta OPCION_GRAFICA después de OPCION_ANALISIS.
anc3 = re.search(r'const OPCION_ANALISIS = \{.*?\n\};\n', nav, re.S)
if not anc3:
    errores.append(f"{NAV}: no encontré la definición de OPCION_ANALISIS.")
else:
    tarjeta = '''
// Análisis de gráfica (2026-11-21): marcador de eventos en lecturas Thermo King (analisisGrafica.js).
const OPCION_GRAFICA = {
  id: "analisisGrafica",
  etiqueta: "Análisis de gráfica",
  descripcion: "Thermo King · Marcar eventos",
  pantalla: "analisisGrafica"
};
'''
    nav = nav[:anc3.end()] + tarjeta + nav[anc3.end():]

# 4) En las listas de Utilidades, justo después de OPCION_ANALISIS.
n_listas = len(re.findall(r'OPCION_ANALISIS(?=[,\]])', nav))
if n_listas < 1:
    errores.append(f"{NAV}: OPCION_ANALISIS no aparece en ninguna lista de Utilidades.")
else:
    nav = re.sub(r'OPCION_ANALISIS(?=[,\]])', 'OPCION_ANALISIS, OPCION_GRAFICA', nav)

# ---- auth.js ----
anc5 = re.search(r'import \{ iniciarAnalisisOperaciones \} from "\./analisisOperaciones\.js";[^\n]*\n', auth)
if not anc5:
    errores.append(f"{AUTH}: no encontré el import de analisisOperaciones.js.")
else:
    auth = auth[:anc5.end()] + 'import { iniciarAnalisisGrafica } from "./analisisGrafica.js"; // 2026-11-21\n' + auth[anc5.end():]

patron6 = re.compile(r'(\n([ \t]*)analisisOperaciones: \(c\) => iniciarAnalisisOperaciones\([^\n]*\),)')
n_pant = len(patron6.findall(auth))
if n_pant < 1:
    errores.append(f"{AUTH}: no encontré la pantalla analisisOperaciones.")
else:
    auth = patron6.sub(lambda m: m.group(1) + "\n" + m.group(2) + "analisisGrafica: (c) => iniciarAnalisisGrafica(c),", auth)

if errores:
    print("No se cambió nada:")
    for e in errores:
        print("  - " + e)
    print("Pégale a Claude esta salida.")
    sys.exit(1)

open(NAV, "w", encoding="utf-8").write(nav)
open(AUTH, "w", encoding="utf-8").write(auth)
print(f"{NAV}: listo (opción, ícono, tarjeta y {n_listas} lista(s) de Utilidades).")
print(f"{AUTH}: listo (import y {n_pant} pantalla(s)).")
