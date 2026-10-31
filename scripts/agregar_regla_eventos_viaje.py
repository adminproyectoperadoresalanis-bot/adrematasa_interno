# ##########################################################################
# PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
# RUTA:     /workspaces/adrematasa_interno/scripts/agregar_regla_eventos_viaje.py
# ##########################################################################
# Tráfico → Actualizaciones (2026-10-31). Agrega a firestore.rules el espejo
# espejo_op_eventos_viaje con EXACTAMENTE la misma regla que ya tiene
# espejo_op_asignaciones (lo leen los mismos que ven Asignación; nadie escribe
# desde el navegador, lo escribe la función de alanis-operadores).
# Si algo no cuadra, no cambia nada.
# Se corre desde la RAÍZ del repo: python3 scripts/agregar_regla_eventos_viaje.py

import sys

RUTA = "firestore.rules"
MARCA = "match /espejo_op_eventos_viaje/{id}"
INICIO = "    match /espejo_op_asignaciones/{id} {"

texto = open(RUTA, encoding="utf-8").read()
if MARCA in texto:
    print("Ya estaba aplicado. No se cambió nada.")
    sys.exit(0)
if texto.count(INICIO) != 1:
    print("ERROR: no encontré la regla de espejo_op_asignaciones. No se cambió nada.")
    print("Pégale a Claude la salida de: grep -n -A4 'espejo_op_' firestore.rules")
    sys.exit(1)

ini = texto.index(INICIO)
# Fin del bloque: la llave que cierra, contando desde la llave que ABRE el bloque
# (la de "{id}" se abre y cierra sola, por eso se empieza después de ella).
abre = ini + len(INICIO) - 1
nivel, fin = 0, None
for i in range(abre, len(texto)):
    if texto[i] == "{":
        nivel += 1
    elif texto[i] == "}":
        nivel -= 1
        if nivel == 0:
            fin = i + 1
            break
if fin is None:
    print("ERROR: no encontré dónde termina la regla de espejo_op_asignaciones. No se cambió nada.")
    sys.exit(1)

bloque = texto[ini:fin]
if "allow write" in bloque.replace("allow write: if false", "") or "allow create" in bloque:
    print("ERROR: la regla de espejo_op_asignaciones permite escribir; no la copio así. No se cambió nada.")
    print("Pégale a Claude la salida de: grep -n -A4 'espejo_op_asignaciones' firestore.rules")
    sys.exit(1)

nuevo = bloque.replace("match /espejo_op_asignaciones/{id}", MARCA)
comentario = "\n    // Tráfico → Actualizaciones (2026-10-31): reportes de viaje de los operadores.\n"
texto = texto[:fin] + comentario + nuevo + texto[fin:]
open(RUTA, "w", encoding="utf-8").write(texto)
print("Listo: regla de espejo_op_eventos_viaje agregada (igual que espejo_op_asignaciones):")
print(nuevo)
