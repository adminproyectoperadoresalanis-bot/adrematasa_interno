# ##########################################################################
# PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
# RUTA:     /workspaces/adrematasa_interno/scripts/configurar_actualizaciones.py
# ##########################################################################
# Para que la app instalada en el celular vea lo más nuevo (2026-10-28):
#  1. firebase.json: los .js, .css, .html y .json (y la raíz "/") se sirven con
#     Cache-Control: no-cache. El navegador pregunta cada vez si cambió; si no
#     cambió, el servidor contesta "igual" sin volver a mandar el archivo.
#  2. publicar.sh: antes de guardar los cambios escribe public/version.json con
#     la fecha y hora de la publicación. actualizacion.js lo compara y muestra
#     la cinta "Hay una versión nueva".
# No toca nada más. Si algo no cuadra, no cambia ningún archivo.
# Se corre desde la RAÍZ del repo: python3 scripts/configurar_actualizaciones.py

import json
import sys

REGLAS = [
    {"source": "**/*.@(js|css|html|json)", "headers": [{"key": "Cache-Control", "value": "no-cache"}]},
    {"source": "/", "headers": [{"key": "Cache-Control", "value": "no-cache"}]},
]
LINEA_VERSION = 'printf \'{"version":"%s"}\\n\' "$(date +%Y%m%d%H%M%S)" > public/version.json'

def falla(msg):
    print("ERROR: " + msg + " No se cambió ningún archivo.")
    sys.exit(1)

# ---- firebase.json ----
datos = json.load(open("firebase.json", encoding="utf-8"))
hosting = datos.get("hosting")
if not isinstance(hosting, dict):
    falla("firebase.json no tiene un bloque 'hosting' simple (pégale a Claude: cat firebase.json).")
headers = hosting.setdefault("headers", [])
fuentes = {h.get("source") for h in headers}
nuevas = [r for r in REGLAS if r["source"] not in fuentes]
headers.extend(nuevas)

# ---- publicar.sh ----
sh = open("publicar.sh", encoding="utf-8").read()
cambia_sh = "public/version.json" not in sh
if cambia_sh:
    lineas = sh.split("\n")
    i = next((k for k, l in enumerate(lineas) if "Guardando cambios" in l), None)
    if i is None:
        falla("no encontré la línea 'Guardando cambios' en publicar.sh (pégale a Claude: cat publicar.sh).")
    lineas.insert(i, "# Versión de esta publicación (la usa public/js/actualizacion.js)\n" + LINEA_VERSION)
    sh = "\n".join(lineas)

if not nuevas and not cambia_sh:
    print("Ya estaba aplicado. No se cambió nada.")
    sys.exit(0)

with open("firebase.json", "w", encoding="utf-8") as f:
    json.dump(datos, f, indent=2, ensure_ascii=False)
    f.write("\n")
open("publicar.sh", "w", encoding="utf-8").write(sh)
print(f"Listo: firebase.json (+{len(nuevas)} regla(s) de caché){' y publicar.sh (version.json)' if cambia_sh else ''}.")
