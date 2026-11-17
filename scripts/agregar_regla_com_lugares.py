# ##########################################################################
# PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
# RUTA:     /workspaces/adrematasa_interno/scripts/agregar_regla_com_lugares.py
# ##########################################################################
# Calculadora con factura (2026-11-17). Diccionario de lugares com_lugares:
# guarda cómo se empató un lugar de la factura (municipio, estado, país) con un
# lugar de ORS (nombre + coordenadas), para que la próxima vez empate solo.
# Lo leen y escriben quienes tienen Comercial; borrar, solo el admin.
# Se agrega justo después de la regla de com_rutas. Si ya estaba o no encuentra
# el lugar, no cambia nada.
# Se corre desde la RAÍZ del repo: python3 scripts/agregar_regla_com_lugares.py

import sys

RUTA = "firestore.rules"
MARCA = "match /com_lugares/{id}"
ANCLA = """    match /com_rutas/{id} {
      allow read, create, update: if puedeComercial();
      allow delete: if esAdmin();
    }
"""
NUEVO = """    // Calculadora con factura (2026-11-17): lugar de la factura → lugar de ORS.
    match /com_lugares/{id} {
      allow read: if puedeComercial();
      allow create, update: if puedeComercial()
        && request.resource.data.label is string
        && request.resource.data.lat is number
        && request.resource.data.lng is number;
      allow delete: if esAdmin();
    }
"""

t = open(RUTA, encoding="utf-8").read()
if MARCA in t:
    print("Ya estaba aplicado. No se cambió nada.")
    sys.exit(0)
if t.count(ANCLA) != 1:
    print("ERROR: no encontré la regla de com_rutas como la esperaba. No se cambió nada.")
    print("Pégale a Claude la salida de: grep -n -A3 'com_rutas' firestore.rules")
    sys.exit(1)
open(RUTA, "w", encoding="utf-8").write(t.replace(ANCLA, ANCLA + NUEVO))
print("Listo: regla de com_lugares agregada.")
