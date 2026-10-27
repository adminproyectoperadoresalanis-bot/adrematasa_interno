# ##########################################################################
# PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
# RUTA:     /workspaces/adrematasa_interno/scripts/agregar_regla_rentabilidad_salidas.py
# ##########################################################################
# Rentabilidad (2026-10-28): agrega a firestore.rules la colección
# rentabilidad_salidas (salidas del Adrematasa oficial: seca / refrigerada),
# con la misma regla que rentabilidad_facturas: solo la cuenta de Ivan.
# Inserta el bloque justo después del de rentabilidad_facturas. No cambia nada más.
# Se corre desde la RAÍZ del repo: python3 scripts/agregar_regla_rentabilidad_salidas.py

import sys

RUTA = "firestore.rules"
MARCA = "match /rentabilidad_salidas/{id}"
ANCLA = """    match /rentabilidad_facturas/{id} {
      allow read, write: if esDuenoRentabilidad();
    }
"""
BLOQUE = """    match /rentabilidad_salidas/{id} {
      allow read, write: if esDuenoRentabilidad();
    }
"""

texto = open(RUTA, encoding="utf-8").read()
if MARCA in texto:
    print("Ya estaba aplicado. No se cambió nada.")
    sys.exit(0)
if texto.count(ANCLA) != 1:
    print("ERROR: no encontré el bloque de rentabilidad_facturas. No se cambió nada.")
    print("Pégale a Claude la salida de: grep -n -A3 'rentabilidad_facturas' firestore.rules")
    sys.exit(1)
open(RUTA, "w", encoding="utf-8").write(texto.replace(ANCLA, ANCLA + BLOQUE))
print("Listo: regla de rentabilidad_salidas agregada.")
