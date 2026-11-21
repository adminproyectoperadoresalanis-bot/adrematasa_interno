# ##########################################################################
# PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
# RUTA:     /workspaces/adrematasa_interno/scripts/conectar_directorio_empleados.py
# ##########################################################################
# Motivos de horas extra (2026-11-20): exporta functions/directorioEmpleados.js
# (función actualizarDirectorioEmpleados) en functions/index.js.
# Si ya estaba, no cambia nada.
# Se corre desde la RAÍZ del repo:  python3 scripts/conectar_directorio_empleados.py

import sys

RUTA = "functions/index.js"
try:
    t = open(RUTA, encoding="utf-8").read()
except FileNotFoundError:
    print(f"ERROR: no encontré {RUTA}. ¿Estás en la raíz del repo?")
    sys.exit(1)
if "./directorioEmpleados" in t:
    print(f"{RUTA}: ya estaba conectado.")
else:
    t = t.rstrip("\n") + "\n\n// Directorio de empleados para \"Cubrir falta de\" (2026-11-20)\nObject.assign(exports, require(\"./directorioEmpleados\"));\n"
    open(RUTA, "w", encoding="utf-8").write(t)
    print(f"{RUTA}: listo.")
