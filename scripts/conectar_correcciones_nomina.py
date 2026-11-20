# ##########################################################################
# PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
# RUTA:     /workspaces/adrematasa_interno/scripts/conectar_correcciones_nomina.py
# ##########################################################################
# Correcciones después de nómina y tipos de falta (2026-11-20). Dos cambios:
#   1) functions/index.js: exporta functions/correccionNomina.js
#      (función enviarCorreccionNomina).
#   2) firestore.rules: al registrar una falta solo se permiten los 3 tipos
#      nuevos: con_goce, sin_goce, incapacidad (las dos reglas de "create").
# Si ya estaba o no encuentra algún punto, NO cambia ese archivo.
# Se corre desde la RAÍZ del repo:  python3 scripts/conectar_correcciones_nomina.py

import sys

# --- 1) functions/index.js ---
RUTA_IDX = "functions/index.js"
try:
    t = open(RUTA_IDX, encoding="utf-8").read()
except FileNotFoundError:
    print(f"ERROR: no encontré {RUTA_IDX}. ¿Estás en la raíz del repo?")
    sys.exit(1)
if "./correccionNomina" in t:
    print(f"{RUTA_IDX}: ya estaba conectado.")
else:
    t = t.rstrip("\n") + "\n\n// Correcciones después de nómina: correo a nóminas (2026-11-20)\nObject.assign(exports, require(\"./correccionNomina\"));\n"
    open(RUTA_IDX, "w", encoding="utf-8").write(t)
    print(f"{RUTA_IDX}: listo.")

# --- 2) firestore.rules ---
RUTA_REGLAS = "firestore.rules"
VIEJO = "request.resource.data.tipo in ['injustificada', 'justificada', 'incapacidad', 'permiso_con_goce', 'permiso_sin_goce']"
NUEVO = "request.resource.data.tipo in ['con_goce', 'sin_goce', 'incapacidad']"
r = open(RUTA_REGLAS, encoding="utf-8").read()
if r.count(NUEVO) == 2:
    print(f"{RUTA_REGLAS}: ya estaba aplicado.")
elif r.count(VIEJO) != 2:
    print(f"ERROR: en {RUTA_REGLAS} no encontré las 2 reglas de tipos de falta como esperaba. No se cambió.")
    print("Pégale a Claude la salida de: grep -n \"tipo in\" firestore.rules")
    sys.exit(1)
else:
    open(RUTA_REGLAS, "w", encoding="utf-8").write(r.replace(VIEJO, NUEVO))
    print(f"{RUTA_REGLAS}: listo (faltas con 3 tipos).")
