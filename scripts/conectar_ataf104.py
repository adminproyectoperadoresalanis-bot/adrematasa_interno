# ##########################################################################
# PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
# RUTA:     /workspaces/adrematasa_interno/scripts/conectar_ataf104.py
# ##########################################################################
# ATAF104 día festivo (2026-11-18). Conecta la función nueva enviarAtaf104:
# agrega al final de functions/index.js la línea que exporta
# functions/ataf104Correo.js. Si ya estaba, no la repite.
# Se corre desde la RAÍZ del repo:  python3 scripts/conectar_ataf104.py

import sys

RUTA = "functions/index.js"
MARCA = "./ataf104Correo"
NUEVO = '\n// ATAF104: formato de personal en día festivo por correo (2026-11-18)\nObject.assign(exports, require("./ataf104Correo"));\n'

try:
    t = open(RUTA, encoding="utf-8").read()
except FileNotFoundError:
    print(f"ERROR: no encontré {RUTA}. ¿Estás en la raíz del repo? No se cambió nada.")
    sys.exit(1)
if MARCA in t:
    print(f"{RUTA}: ya estaba conectado.")
    sys.exit(0)
open(RUTA, "w", encoding="utf-8").write(t.rstrip("\n") + "\n" + NUEVO)
print(f"{RUTA}: listo.")
