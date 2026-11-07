# ##########################################################################
# PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
# RUTA:     /workspaces/adrematasa_interno/scripts/agregar_regla_resumen_analisis.py
# ##########################################################################
# Análisis de operaciones v2 (2026-11-07). En firestore.rules agrega la regla de
# op_resumen_mes/{aaaa-mm} (un resumen compacto por mes) justo después de la de
# op_viajes: la LEEN quienes ven Análisis de operaciones; la ESCRIBEN el admin y
# el puesto "Gerente … impo…" (los mismos que pegan reportes). No se borra.
# Si la regla de op_viajes no está como se esperaba, no cambia nada.
# Se corre desde la RAÍZ del repo: python3 scripts/agregar_regla_resumen_analisis.py

import sys

RUTA = "firestore.rules"
MARCA = "match /op_resumen_mes/{mes}"
ANCLA = """    match /op_viajes/{id} {
      allow read: if esDuenoRentabilidad() || puedeVerAnalisis();
      allow create, update: if esDuenoRentabilidad() || puedeCargarAnalisis();
      allow delete: if false;
    }
"""
NUEVO = """    // Análisis de operaciones v2 (2026-11-07): un resumen compacto por mes.
    match /op_resumen_mes/{mes} {
      allow read: if esDuenoRentabilidad() || puedeVerAnalisis();
      allow create, update: if esDuenoRentabilidad() || puedeCargarAnalisis();
      allow delete: if false;
    }
"""

t = open(RUTA, encoding="utf-8").read()
if MARCA in t:
    print("Ya estaba aplicado. No se cambió nada.")
    sys.exit(0)
if t.count(ANCLA) != 1:
    print("ERROR: no encontré la regla de op_viajes como la esperaba. No se cambió nada.")
    print("Pégale a Claude la salida de: grep -n -A5 'op_viajes' firestore.rules")
    sys.exit(1)
open(RUTA, "w", encoding="utf-8").write(t.replace(ANCLA, ANCLA + NUEVO))
print("Listo: regla de op_resumen_mes agregada.")