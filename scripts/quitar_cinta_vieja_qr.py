# ##########################################################################
# PROYECTO: ADREMATASA INTERNO  (Codespace: adrematasa_interno)
# RUTA:     /workspaces/adrematasa_interno/scripts/quitar_cinta_vieja_qr.py
# ##########################################################################
# 2026-11-03: en Validación de QR salía siempre la cinta vieja "Hay una versión
# nueva de la app disponible · Recargar" (escaneoOrigen.js, 14 sep). Comparaba
# una versión escrita a mano (APP_VERSION) contra public/version.json, que
# desde el 28 oct publicar.sh llena con la fecha de cada publicación: ya nunca
# coinciden y "Recargar" no la quita. La cinta buena es la de actualizacion.js.
# Este script cambia SOLO la función verificarActualizacionYReportarVersion:
#   - ya no muestra la cinta vieja;
#   - guarda en usuarios/{uid}.appVersion la versión publicada (version.json).
# No toca nada más del archivo. Si la función no es la esperada, no cambia nada.
# Se corre desde la RAÍZ del repo: python3 scripts/quitar_cinta_vieja_qr.py

import re, sys

RUTA = "public/js/escaneoOrigen.js"
INICIO = "async function verificarActualizacionYReportarVersion(uid) {"
FIN = "\nfunction mostrarBannerActualizacion() {"
MARCA = "2026-11-03: la cinta de versión"

t = open(RUTA, encoding="utf-8").read()
if MARCA in t:
    print("Ya estaba aplicado. No se cambió nada.")
    sys.exit(0)
if t.count(INICIO) != 1 or t.count(FIN) != 1 or t.index(INICIO) > t.index(FIN):
    print("ERROR: no encontré la función esperada. No se cambió nada.")
    print("Pégale a Claude la salida de: grep -n 'BannerActualizacion\\|verificarActualizacion' " + RUTA)
    sys.exit(1)
i, j = t.index(INICIO), t.index(FIN)
vieja = t[i:j]
if "mostrarBannerActualizacion()" not in vieja or "version.json" not in vieja:
    print("ERROR: la función no es la que esperaba. No se cambió nada.")
    sys.exit(1)

nueva = '''async function verificarActualizacionYReportarVersion(uid) {
  // 2026-11-03: la cinta de versión ahora es solo la de actualizacion.js (toda
  // la app). Aquí ya no se muestra la vieja; solo se reporta la versión
  // publicada (version.json, la escribe publicar.sh) — no crítico si falla.
  let version = APP_VERSION;
  try {
    const resp = await fetch("./version.json?t=" + Date.now(), { cache: "no-store" });
    if (resp.ok) {
      const datos = await resp.json();
      if (datos && datos.version) version = String(datos.version);
    }
  } catch (e) {
    // Sin conexión o archivo no publicado todavía.
  }
  setDoc(doc(db, "usuarios", uid), {
    appVersion: version,
    appVersionFecha: serverTimestamp()
  }, { merge: true }).catch(() => {});
}
'''
t = t[:i] + nueva + t[j:]
open(RUTA, "w", encoding="utf-8").write(t)
print("Listo: se quitó la cinta vieja de Validación de QR.")
print("Verifica: grep -c 'mostrarBannerActualizacion();' " + RUTA + "   (debe salir 0)")
