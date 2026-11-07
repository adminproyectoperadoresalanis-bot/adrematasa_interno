# ##########################################################################
# PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
# RUTA:     /workspaces/adrematasa_interno/scripts/agregar_regla_analisis_operaciones.py
# ##########################################################################
# Análisis de operaciones (2026-11-06). En firestore.rules:
#   1) rentabilidad_salidas (las salidas del Adrematasa, sin dinero) pasa de
#      "solo Ivan" a: la LEEN también quienes tengan "Análisis de operaciones"
#      en la tabla de accesos; la ESCRIBEN también el admin y el puesto
#      "Gerente … impo…". Las facturas (rentabilidad_facturas) siguen solo de Ivan.
#   2) op_viajes (reporte Vista general): mismas reglas que las salidas.
# Si el bloque de rentabilidad_salidas no es exactamente el esperado, no cambia nada.
# Se corre desde la RAÍZ del repo: python3 scripts/agregar_regla_analisis_operaciones.py

import sys

RUTA = "firestore.rules"
MARCA = "match /op_viajes/{id}"
VIEJO = """    match /rentabilidad_salidas/{id} {
      allow read, write: if esDuenoRentabilidad();
    }
"""
NUEVO = """    // Análisis de operaciones (2026-11-06): salidas y viajes del Adrematasa (sin dinero).
    function puedeVerAnalisis() {
      return usuarioActivoValido() && tieneAccesoUtilidad('analisisOperaciones');
    }
    function puedeCargarAnalisis() {
      return usuarioActivoValido()
        && (usuarioActual().rol == 'admin' || usuarioActual().get('puesto', '').lower().matches('.*gerente.*impo.*'));
    }
    match /rentabilidad_salidas/{id} {
      allow read: if esDuenoRentabilidad() || puedeVerAnalisis();
      allow create, update: if esDuenoRentabilidad() || puedeCargarAnalisis();
      allow delete: if esDuenoRentabilidad();
    }
    match /op_viajes/{id} {
      allow read: if esDuenoRentabilidad() || puedeVerAnalisis();
      allow create, update: if esDuenoRentabilidad() || puedeCargarAnalisis();
      allow delete: if false;
    }
"""

t = open(RUTA, encoding="utf-8").read()
if MARCA in t:
    print("Ya estaba aplicado. No se cambió nada.")
    sys.exit(0)
if t.count(VIEJO) != 1:
    print("ERROR: no encontré la regla de rentabilidad_salidas como la esperaba. No se cambió nada.")
    print("Pégale a Claude la salida de: grep -n -A3 'rentabilidad_salidas' firestore.rules")
    sys.exit(1)
open(RUTA, "w", encoding="utf-8").write(t.replace(VIEJO, NUEVO))
print("Listo: reglas de rentabilidad_salidas y op_viajes actualizadas.")
