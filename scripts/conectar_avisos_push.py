# ##########################################################################
# PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
# RUTA:     /workspaces/adrematasa_interno/scripts/conectar_avisos_push.py
# ##########################################################################
# Avisos push (2026-11-13). Conecta las piezas nuevas sin tocar nada más:
#   1) public/index.html: carga js/avisosPush.js (antes de </body>).
#   2) functions/index.js: exporta las funciones de functions/avisosPushAdrematasa.js.
# Si ya estaba conectado, no lo repite. Se corre desde la RAÍZ del repo:
#   python3 scripts/conectar_avisos_push.py

import sys

def conectar(ruta, marca, ancla, nuevo, al_final=False):
    try:
        t = open(ruta, encoding="utf-8").read()
    except FileNotFoundError:
        print(f"ERROR: no encontré {ruta}. No se cambió nada.")
        sys.exit(1)
    if marca in t:
        print(f"{ruta}: ya estaba conectado.")
        return
    if al_final:
        t = t.rstrip("\n") + "\n" + nuevo
    else:
        if t.count(ancla) != 1:
            print(f"ERROR: en {ruta} no encontré '{ancla}' una sola vez. No se cambió nada.")
            sys.exit(1)
        t = t.replace(ancla, nuevo + ancla)
    open(ruta, "w", encoding="utf-8").write(t)
    print(f"{ruta}: listo.")

conectar("public/index.html", "js/avisosPush.js", "</body>",
         '  <script type="module" src="js/avisosPush.js"></script>\n')
conectar("functions/index.js", "./avisosPushAdrematasa", None,
         '\n// Avisos push en el celular: campanita + McCain (2026-11-13)\nObject.assign(exports, require("./avisosPushAdrematasa"));\n',
         al_final=True)
