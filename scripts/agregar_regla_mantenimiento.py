# ##########################################################################
# PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
# RUTA:     /workspaces/adrematasa_interno/scripts/agregar_regla_mantenimiento.py
# ##########################################################################
# Mantenimiento (2026-10-28). En firestore.rules:
#  1. Agrega mantenimiento_solicitudes y mantenimiento_lugares:
#     - solicitudes: leen quienes tienen acceso a Mantenimiento; nadie las crea
#       desde el navegador (las crea la función, por el folio consecutivo);
#       terminar = solo cambiar estado/terminadaMs/terminadaPor/comentarioCierre
#       de una abierta.
#     - lugares: leen y agregan quienes tienen acceso; cambiar o borrar, admin.
#  2. Deja que quien tiene Mantenimiento (sin Inventario) lea el catálogo y los
#     estatus del Inventario, para elegir el remolque.
# Si algo no cuadra, no cambia nada.
# Se corre desde la RAÍZ del repo: python3 scripts/agregar_regla_mantenimiento.py

import sys

RUTA = "firestore.rules"
MARCA = "match /mantenimiento_solicitudes/{id}"
ANCLA = "    match /bitacora_acciones_operadores/{id} {"
LECTURA_INV = "      allow read: if usuarioActivoValido() && tieneAccesoUtilidad('inventario');\n"
LECTURA_INV_NUEVA = "      allow read: if usuarioActivoValido() && (tieneAccesoUtilidad('inventario') || tieneAccesoUtilidad('mantenimiento'));\n"
BLOQUE = """    // Mantenimiento (2026-10-28): solicitudes de remolques y lugares.
    match /mantenimiento_solicitudes/{id} {
      allow read: if usuarioActivoValido() && tieneAccesoUtilidad('mantenimiento');
      allow create, delete: if false;
      allow update: if usuarioActivoValido() && tieneAccesoUtilidad('mantenimiento')
                    && resource.data.estado == 'abierta'
                    && request.resource.data.estado == 'terminada'
                    && request.resource.data.diff(resource.data).affectedKeys()
                         .hasOnly(['estado', 'terminadaMs', 'terminadaPor', 'comentarioCierre']);
    }
    match /mantenimiento_lugares/{id} {
      allow read: if usuarioActivoValido() && tieneAccesoUtilidad('mantenimiento');
      allow create: if usuarioActivoValido() && tieneAccesoUtilidad('mantenimiento')
                    && request.resource.data.nombre is string
                    && request.resource.data.nombre.size() > 0
                    && request.resource.data.nombre.size() <= 120;
      allow update, delete: if esAdmin();
    }

"""

texto = open(RUTA, encoding="utf-8").read()
if MARCA in texto:
    print("Ya estaba aplicado. No se cambió nada.")
    sys.exit(0)
if texto.count(ANCLA) != 1:
    print("ERROR: no encontré el punto de inserción (bitacora_acciones_operadores). No se cambió nada.")
    sys.exit(1)
ini = texto.find("match /inventario_catalogo/{id}")
fin = texto.find("match /inventario_importaciones/{id}")
if ini < 0 or fin < 0 or fin < ini:
    print("ERROR: no encontré los bloques de inventario. No se cambió nada.")
    sys.exit(1)
zona = texto[ini:fin]
n = zona.count(LECTURA_INV)
if n != 2:
    print(f"ERROR: la lectura de inventario aparece {n} veces en catálogo/estatus (se esperaban 2). No se cambió nada.")
    print("Pégale a Claude la salida de: grep -n -A3 'match /inventario_' firestore.rules")
    sys.exit(1)
texto = texto[:ini] + zona.replace(LECTURA_INV, LECTURA_INV_NUEVA) + texto[fin:]
texto = texto.replace(ANCLA, BLOQUE + ANCLA)
open(RUTA, "w", encoding="utf-8").write(texto)
print("Listo: reglas de Mantenimiento agregadas y lectura del Inventario abierta a Mantenimiento.")
