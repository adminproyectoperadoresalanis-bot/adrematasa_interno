# ##########################################################################
# PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
# RUTA:     /workspaces/adrematasa_interno/scripts/agregar_regla_adelanto_vacaciones.py
# ##########################################################################
# Adelanto de vacaciones (2026-11-13). El botón "✈ Adelanto" de admin.js
# (procesarAdelanto) crea en un solo writeBatch:
#   1) el saldo nuevo en usuarios/{empleado}  -> ya permitido (admin actualiza usuarios);
#   2) una vacación YA APROBADA a nombre del empleado en solicitudesVacaciones
#      -> NO estaba permitido: la única regla de "create" exige que la cree el
#      propio empleado y como "pendiente". Por eso salía
#      "Missing or insufficient permissions" aunque seas admin.
# Este script agrega una rama de "create" SOLO para el admin y SOLO para
# adelantos (esAdelanto == true, aprobada, revisada por quien la crea).
# No cambia ninguna otra regla. Si ya estaba aplicado o no encuentra el lugar,
# no cambia nada.
# Se corre desde la RAÍZ del repo: python3 scripts/agregar_regla_adelanto_vacaciones.py

import sys

RUTA = "firestore.rules"
MARCA = "request.resource.data.esAdelanto == true"
ANCLA = """      allow create: if isSignedIn()
        && request.resource.data.empleadoId == request.auth.uid
        && usuarioActual().estatus == 'activo'
        && request.resource.data.estatus == 'pendiente'
        && request.resource.data.diasHabiles is number
"""
NUEVO = """      // Adelanto de vacaciones (2026-11-13): el admin crea la vacación ya
      // aprobada a nombre del empleado (admin.js → procesarAdelanto), en el
      // mismo writeBatch que ajusta su saldo. Solo admin y solo adelantos.
      allow create: if esAdmin()
        && request.resource.data.esAdelanto == true
        && request.resource.data.estatus == 'aprobada'
        && request.resource.data.revisadoPor == request.auth.uid
        && request.resource.data.empleadoId is string
        && exists(/databases/$(database)/documents/usuarios/$(request.resource.data.empleadoId))
        && request.resource.data.diasHabiles is number
        && request.resource.data.diasHabiles > 0
        && request.resource.data.get('enviadoANominaEn', null) == null;
"""

t = open(RUTA, encoding="utf-8").read()
if MARCA in t:
    print("Ya estaba aplicado. No se cambió nada.")
    sys.exit(0)
if t.count(ANCLA) != 1:
    print("ERROR: no encontré la regla de create de solicitudesVacaciones como la esperaba. No se cambió nada.")
    print("Pégale a Claude la salida de: grep -n -A8 'match /solicitudesVacaciones' firestore.rules")
    sys.exit(1)
open(RUTA, "w", encoding="utf-8").write(t.replace(ANCLA, NUEVO + ANCLA))
print("Listo: regla de adelanto de vacaciones agregada.")
