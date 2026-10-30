# ##########################################################################
# PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
# RUTA:     /workspaces/adrematasa_interno/scripts/regla_comercial_borrador.py
# ##########################################################################
# Comercial (2026-10-30): una cotización en BORRADOR se puede editar completa
# (cliente, moneda, vigencia…). Desde ENVIADA siguen fijos folio, cliente,
# moneda, fechas y quién la hizo. En cualquier estado nunca cambian folio,
# consecutivo, año, quién la hizo ni la fecha de emisión.
# Cambia solo la regla "allow update" de com_cotizaciones.
# Si algo no cuadra, no cambia nada.
# Se corre desde la RAÍZ del repo: python3 scripts/regla_comercial_borrador.py

import sys

RUTA = "firestore.rules"
VIEJA = """      allow update: if puedeComercial() && esDuenoCotizacion(resource.data)
                    && request.resource.data.diff(resource.data).unchangedKeys()
                         .hasAll(['folio', 'consecutivo', 'anio', 'clienteId', 'creadoPorUid', 'creadoPor', 'creadoMs', 'emisionMs', 'vencimientoMs', 'moneda']);
"""
NUEVA = """      allow update: if puedeComercial() && esDuenoCotizacion(resource.data)
                    && (request.resource.data.diff(resource.data).unchangedKeys()
                          .hasAll(['folio', 'consecutivo', 'anio', 'clienteId', 'creadoPorUid', 'creadoPor', 'creadoMs', 'emisionMs', 'vencimientoMs', 'moneda'])
                        || (resource.data.estado == 'borrador'
                            && request.resource.data.diff(resource.data).unchangedKeys()
                                 .hasAll(['folio', 'consecutivo', 'anio', 'creadoPorUid', 'creadoPor', 'creadoMs', 'emisionMs'])));
"""

texto = open(RUTA, encoding="utf-8").read()
if NUEVA in texto:
    print("Ya estaba aplicado. No se cambió nada.")
    sys.exit(0)
if texto.count(VIEJA) != 1:
    print("ERROR: no encontré la regla de actualización de com_cotizaciones como se esperaba. No se cambió nada.")
    print("Pégale a Claude la salida de: grep -n -A6 'match /com_cotizaciones' firestore.rules")
    sys.exit(1)
open(RUTA, "w", encoding="utf-8").write(texto.replace(VIEJA, NUEVA))
print("Listo: las cotizaciones en borrador ya se pueden editar completas.")
