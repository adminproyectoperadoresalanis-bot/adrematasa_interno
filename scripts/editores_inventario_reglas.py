# ##########################################################################
# PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
# RUTA:     /workspaces/adrematasa_interno/scripts/editores_inventario_reglas.py
# ##########################################################################
# Inventario (2026-10-27): además del admin, pueden EDITAR (cambiar estatus y
# actualizar el catálogo) los puestos marcados en Configuración → Inventario
# (configuracion/inventario.editanPuestos). En firestore.rules:
#   - agrega la función puedeEditarInventario();
#   - en los 3 bloques de inventario cambia esAdmin() por puedeEditarInventario()
#     solo en las escrituras y en la lectura de importaciones.
# Si el bloque de inventario no es exactamente el esperado, no cambia nada.
# Se corre desde la RAÍZ del repo: python3 scripts/editores_inventario_reglas.py

import sys

RUTA = "firestore.rules"

VIEJO = """    // Inventario (2026-10-24): catálogo del Adrematasa oficial + estatus propio.
    match /inventario_catalogo/{id} {
      allow read: if usuarioActivoValido() && tieneAccesoUtilidad('inventario');
      allow write: if esAdmin();
    }
    match /inventario_estatus/{id} {
      allow read: if usuarioActivoValido() && tieneAccesoUtilidad('inventario');
      allow write: if esAdmin();
    }
    match /inventario_importaciones/{id} {
      allow read: if esAdmin();
      allow create: if esAdmin();
      allow update, delete: if false;
    }
"""

NUEVO = """    // Inventario (2026-10-24): catálogo del Adrematasa oficial + estatus propio.
    // 2026-10-27: editan el admin y los puestos de configuracion/inventario.editanPuestos.
    function puedeEditarInventario() {
      return esAdmin() || (
        usuarioActivoValido() && tieneAccesoUtilidad('inventario')
        && exists(/databases/$(database)/documents/configuracion/inventario)
        && usuarioActual().get('puesto', '') in
           get(/databases/$(database)/documents/configuracion/inventario).data.get('editanPuestos', [])
      );
    }
    match /inventario_catalogo/{id} {
      allow read: if usuarioActivoValido() && tieneAccesoUtilidad('inventario');
      allow write: if puedeEditarInventario();
    }
    match /inventario_estatus/{id} {
      allow read: if usuarioActivoValido() && tieneAccesoUtilidad('inventario');
      allow write: if puedeEditarInventario();
    }
    match /inventario_importaciones/{id} {
      allow read: if puedeEditarInventario();
      allow create: if puedeEditarInventario();
      allow update, delete: if false;
    }
"""

texto = open(RUTA, encoding="utf-8").read()

if "function puedeEditarInventario()" in texto:
    print("Ya estaba aplicado. No se cambió nada.")
    sys.exit(0)
if "function usuarioActual()" not in texto:
    print("ERROR: no encontré la función usuarioActual() en firestore.rules. No se cambió nada.")
    print("Pégale a Claude la salida de: grep -n 'function ' firestore.rules")
    sys.exit(1)
n = texto.count(VIEJO)
if n != 1:
    print(f"ERROR: el bloque de inventario aparece {n} veces con el texto esperado (se esperaba 1). No se cambió nada.")
    print("Pégale a Claude la salida de: grep -n -A16 'Inventario (2026-10-24)' firestore.rules")
    sys.exit(1)

open(RUTA, "w", encoding="utf-8").write(texto.replace(VIEJO, NUEVO))
print("Listo: puedeEditarInventario() agregada y aplicada a los 3 bloques de inventario.")
