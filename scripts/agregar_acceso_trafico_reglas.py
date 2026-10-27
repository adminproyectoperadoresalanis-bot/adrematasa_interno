# ##########################################################################
# PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
# RUTA:     /workspaces/adrematasa_interno/scripts/agregar_acceso_trafico_reglas.py
# ##########################################################################
# Tarjeta nueva "Tráfico" (2026-10-27): Turnos se mudó de Operadores a Tráfico.
# En firestore.rules, dentro de los bloques de turnos_patio y de los espejos
# espejo_op_*, cambia
#     tieneAccesoUtilidad('operadores')
# por
#     (tieneAccesoUtilidad('operadores') || tieneAccesoUtilidad('trafico'))
# para que quien tenga Tráfico (sin Operadores) también lea/pegue Turnos.
# No toca ningún otro bloque. Si algo no cuadra, no cambia nada.
# Se corre desde la RAÍZ del repo: python3 scripts/agregar_acceso_trafico_reglas.py

import re
import sys

RUTA = "firestore.rules"
NUEVO = "(tieneAccesoUtilidad('operadores') || tieneAccesoUtilidad('trafico'))"
PATRON = re.compile(r"""tieneAccesoUtilidad\((['"])operadores\1\)""")

texto = open(RUTA, encoding="utf-8").read()

if "tieneAccesoUtilidad('trafico')" in texto:
    print("Ya estaba aplicado. No se cambió nada.")
    sys.exit(0)

inicios = [m.start() for m in re.finditer(r"match /(turnos_patio|espejo_op_[A-Za-z_]+)/", texto)]
if not inicios:
    print("ERROR: no encontré bloques de turnos_patio ni espejo_op_*. No se cambió nada.")
    sys.exit(1)

resultado = []
ultimo = 0
reporte = []
for ini in inicios:
    sig = texto.find("\n    match /", ini + 1)
    fin = sig if sig != -1 else len(texto)
    bloque = texto[ini:fin]
    nombre = bloque.split("\n", 1)[0].strip()
    nuevo_bloque, n = PATRON.subn(NUEVO, bloque)
    reporte.append((nombre, n))
    resultado.append(texto[ultimo:ini])
    resultado.append(nuevo_bloque)
    ultimo = fin
resultado.append(texto[ultimo:])

sin_cambio = [r for r in reporte if r[1] == 0]
tiene_turnos = any("turnos_patio" in r[0] for r in reporte)
espejos = [r for r in reporte if "espejo_op_" in r[0]]

if sin_cambio or not tiene_turnos or len(espejos) < 5:
    print("ERROR: no todos los bloques tienen la condición esperada. No se cambió nada.")
    for nombre, n in reporte:
        print(f"  {n} cambio(s) en: {nombre}")
    print("Pégale a Claude esta salida y la de:")
    print("  grep -n -A6 'match /turnos_patio\\|match /espejo_op_' firestore.rules")
    sys.exit(1)

open(RUTA, "w", encoding="utf-8").write("".join(resultado))
print("Listo:")
for nombre, n in reporte:
    print(f"  {n} cambio(s) en: {nombre}")
