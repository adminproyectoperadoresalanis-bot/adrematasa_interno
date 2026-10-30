# ##########################################################################
# PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
# RUTA:     /workspaces/adrematasa_interno/scripts/agregar_regla_comercial.py
# ##########################################################################
# Comercial (2026-10-30). Agrega a firestore.rules:
#   - com_clientes y com_rutas: leen, crean y editan quienes tienen la opción
#     Comercial (Configuración → Utilidades); borrar, solo admin.
#   - com_cotizaciones: cada quien ve y edita SOLO las suyas; el admin, todas.
#     Al crear, el folio debe ser el siguiente del contador (misma
#     transacción). No se pueden cambiar folio, cliente ni quién la hizo.
#   - com_contadores: el consecutivo solo puede subir de uno en uno.
#   - com_config: leen quienes tienen Comercial; escribe solo el admin.
# Si algo no cuadra, no cambia nada.
# Se corre desde la RAÍZ del repo: python3 scripts/agregar_regla_comercial.py

import sys

RUTA = "firestore.rules"
MARCA = "match /com_cotizaciones/{id}"
ANCLA = "    match /bitacora_acciones_operadores/{id} {"
BLOQUE = """    // Comercial (2026-10-30): clientes, cotizaciones, rutas, ajustes y folio.
    function puedeComercial() {
      return usuarioActivoValido() && tieneAccesoUtilidad('comercial');
    }
    function esDuenoCotizacion(datos) {
      return esAdmin() || datos.creadoPorUid == request.auth.uid;
    }
    match /com_clientes/{id} {
      allow read, create, update: if puedeComercial();
      allow delete: if esAdmin();
    }
    match /com_rutas/{id} {
      allow read, create, update: if puedeComercial();
      allow delete: if esAdmin();
    }
    match /com_config/{id} {
      allow read: if puedeComercial();
      allow write: if esAdmin();
    }
    match /com_contadores/{id} {
      allow read: if puedeComercial();
      allow create: if puedeComercial() && request.resource.data.ultimo == 1;
      allow update: if puedeComercial() && request.resource.data.ultimo == resource.data.ultimo + 1;
      allow delete: if false;
    }
    match /com_cotizaciones/{id} {
      allow read: if puedeComercial() && esDuenoCotizacion(resource.data);
      allow create: if puedeComercial()
                    && request.resource.data.creadoPorUid == request.auth.uid
                    && request.resource.data.folio == id
                    && request.resource.data.consecutivo is int
                    && request.resource.data.anio is string
                    && getAfter(/databases/$(database)/documents/com_contadores/$('cotizaciones_' + request.resource.data.anio)).data.ultimo
                         == request.resource.data.consecutivo;
      allow update: if puedeComercial() && esDuenoCotizacion(resource.data)
                    && request.resource.data.diff(resource.data).unchangedKeys()
                         .hasAll(['folio', 'consecutivo', 'anio', 'clienteId', 'creadoPorUid', 'creadoPor', 'creadoMs', 'emisionMs', 'vencimientoMs', 'moneda']);
      allow delete: if esAdmin();
    }

"""

texto = open(RUTA, encoding="utf-8").read()
if MARCA in texto:
    print("Ya estaba aplicado. No se cambió nada.")
    sys.exit(0)
if texto.count(ANCLA) != 1:
    print("ERROR: no encontré el punto de inserción (bitacora_acciones_operadores). No se cambió nada.")
    print("Pégale a Claude la salida de: grep -n 'match /' firestore.rules")
    sys.exit(1)
for f in ["function usuarioActivoValido()", "function tieneAccesoUtilidad(", "function esAdmin()"]:
    if f not in texto:
        print(f"ERROR: no encontré {f} en firestore.rules. No se cambió nada.")
        sys.exit(1)
texto = texto.replace(ANCLA, BLOQUE + ANCLA)
open(RUTA, "w", encoding="utf-8").write(texto)
print("Listo: reglas de Comercial agregadas.")
