# ##########################################################################
# PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
# RUTA:     /workspaces/adrematasa_interno/scripts/conectar_funcion_comercial.py
# ##########################################################################
# Comercial (2026-10-30): conecta functions/comercialCorreo.js en
# functions/index.js (exporta enviarCotizacionComercial), copiando la misma
# forma en que ya está conectado functions/mantenimiento.js.
# Si algo no cuadra, no cambia nada.
# Se corre desde la RAÍZ del repo: python3 scripts/conectar_funcion_comercial.py

import re
import sys

RUTA = "functions/index.js"
texto = open(RUTA, encoding="utf-8").read()

if "./comercialCorreo" in texto:
    print("Ya estaba conectada. No se cambió nada.")
    sys.exit(0)

lineas = texto.split("\n")
idx = [i for i, l in enumerate(lineas) if re.search(r"""require\(\s*["']\./mantenimiento(\.js)?["']\s*\)""", l)]
if len(idx) != 1:
    print("ERROR: no encontré cómo está conectado mantenimiento.js en functions/index.js. No se cambió nada.")
    print("Pégale a Claude la salida de: grep -n \"require(\\\"./\" functions/index.js")
    sys.exit(1)

linea = lineas[idx[0]]
if "Object.assign" in linea or re.search(r"\.\.\.\s*require", linea):
    nueva = re.sub(r"""\./mantenimiento(\.js)?""", "./comercialCorreo", linea)
elif "crearSolicitudMantenimiento" in linea:
    nueva = linea.replace("crearSolicitudMantenimiento", "enviarCotizacionComercial")
    nueva = re.sub(r"""\./mantenimiento(\.js)?""", "./comercialCorreo", nueva)
else:
    print("ERROR: la línea de mantenimiento tiene una forma que no reconozco:")
    print("   " + linea.strip())
    print("No se cambió nada. Pégale esa línea a Claude.")
    sys.exit(1)

if "comercialCorreo" not in nueva or nueva == linea:
    print("ERROR: no pude armar la línea nueva. No se cambió nada.")
    sys.exit(1)
lineas.insert(idx[0] + 1, nueva)
open(RUTA, "w", encoding="utf-8").write("\n".join(lineas))
print("Listo: enviarCotizacionComercial conectada en functions/index.js:")
print("   " + nueva.strip())
