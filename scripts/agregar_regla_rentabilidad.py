# ##########################################################################
# PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
# RUTA:     /workspaces/adrematasa_interno/scripts/agregar_regla_rentabilidad.py
# ##########################################################################
# Rentabilidad (2026-10-28): agrega a firestore.rules la colección
# rentabilidad_facturas, que SOLO puede leer y escribir la cuenta de Ivan
# (admin con correo ilanda@alanis.com.mx). Ningún otro usuario, ni otros admin.
# No cambia ninguna regla existente: inserta un bloque antes de
# bitacora_acciones_operadores.
# Se corre desde la RAÍZ del repo: python3 scripts/agregar_regla_rentabilidad.py

import sys

RUTA = "firestore.rules"
MARCA = "match /rentabilidad_facturas/{id}"
ANCLA = "    match /bitacora_acciones_operadores/{id} {"
BLOQUE = """    // Rentabilidad (2026-10-28): solo la cuenta de Ivan.
    function esDuenoRentabilidad() {
      return esAdmin() && request.auth.token.email == 'ilanda@alanis.com.mx';
    }
    match /rentabilidad_facturas/{id} {
      allow read, write: if esDuenoRentabilidad();
    }

"""

texto = open(RUTA, encoding="utf-8").read()
if MARCA in texto:
    print("Ya estaba aplicado. No se cambió nada.")
    sys.exit(0)
if "function esAdmin()" not in texto:
    print("ERROR: no encontré la función esAdmin() en firestore.rules. No se cambió nada.")
    sys.exit(1)
if texto.count(ANCLA) != 1:
    print("ERROR: no encontré el punto de inserción (bitacora_acciones_operadores). No se cambió nada.")
    sys.exit(1)
open(RUTA, "w", encoding="utf-8").write(texto.replace(ANCLA, BLOQUE + ANCLA))
print("Listo: regla de rentabilidad_facturas agregada.")
