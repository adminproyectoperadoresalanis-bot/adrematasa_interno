# ##########################################################################
# PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
# RUTA:     /workspaces/adrematasa_interno/scripts/agregar_regla_rentabilidad_config.py
# ##########################################################################
# Rentabilidad (2026-10-28): agrega a firestore.rules la colección
# rentabilidad_config (zonas de destino y equivalencias de clientes), con la
# misma regla que las demás de Rentabilidad: solo la cuenta de Ivan.
# Inserta el bloque justo después del de rentabilidad_salidas. No cambia nada más.
# Se corre desde la RAÍZ del repo: python3 scripts/agregar_regla_rentabilidad_config.py

import sys

RUTA = "firestore.rules"
MARCA = "match /rentabilidad_config/{id}"
ANCLA = """    match /rentabilidad_salidas/{id} {
      allow read, write: if esDuenoRentabilidad();
    }
"""
BLOQUE = """    match /rentabilidad_config/{id} {
      allow read, write: if esDuenoRentabilidad();
    }
"""

texto = open(RUTA, encoding="utf-8").read()
if MARCA in texto:
    print("Ya estaba aplicado. No se cambió nada.")
    sys.exit(0)
if texto.count(ANCLA) != 1:
    print("ERROR: no encontré el bloque de rentabilidad_salidas. No se cambió nada.")
    print("Pégale a Claude la salida de: grep -n -A3 'rentabilidad_' firestore.rules")
    sys.exit(1)
open(RUTA, "w", encoding="utf-8").write(texto.replace(ANCLA, ANCLA + BLOQUE))
print("Listo: regla de rentabilidad_config agregada.")
