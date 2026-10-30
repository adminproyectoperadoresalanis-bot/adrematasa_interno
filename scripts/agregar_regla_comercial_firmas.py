# ##########################################################################
# PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
# RUTA:     /workspaces/adrematasa_interno/scripts/agregar_regla_comercial_firmas.py
# ##########################################################################
# Comercial · Mi firma (2026-10-30). Agrega a firestore.rules la colección
# com_firmas/{uid}: la leen quienes tienen Comercial (el PDF usa la firma de
# quien hizo la cotización) y cada quien escribe SOLO la suya.
# Requiere que ya esté aplicado scripts/agregar_regla_comercial.py.
# Si algo no cuadra, no cambia nada.
# Se corre desde la RAÍZ del repo: python3 scripts/agregar_regla_comercial_firmas.py

import sys

RUTA = "firestore.rules"
MARCA = "match /com_firmas/{uid}"
ANCLA = "    match /com_contadores/{id} {"
BLOQUE = """    match /com_firmas/{uid} {
      allow read: if puedeComercial();
      allow write: if puedeComercial() && request.auth.uid == uid;
    }
"""

texto = open(RUTA, encoding="utf-8").read()
if MARCA in texto:
    print("Ya estaba aplicado. No se cambió nada.")
    sys.exit(0)
if texto.count(ANCLA) != 1 or "function puedeComercial()" not in texto:
    print("ERROR: no encontré las reglas de Comercial (corre antes agregar_regla_comercial.py). No se cambió nada.")
    sys.exit(1)
texto = texto.replace(ANCLA, BLOQUE + ANCLA)
open(RUTA, "w", encoding="utf-8").write(texto)
print("Listo: regla de Mi firma (com_firmas) agregada.")
