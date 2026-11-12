#!/bin/bash
# ##########################################################################
# SCRIPT DE ESTADO — sirve en flowseguridad Y en adrematasa_interno
# RUTA:   raiz del repo  (/workspaces/flowseguridad/estado.sh
#                         /workspaces/adrematasa_interno/estado.sh)
# USO:    bash estado.sh      y pegarme TODO lo que imprima
# SEGURO: solo lee. No publica, no guarda, no cambia nada, no imprime claves.
# ##########################################################################

NOMBRE_OK="[OK]    "
NOMBRE_NO="[FALTA] "
SIGUIENTE=""

# chk "descripcion" "mensaje de siguiente paso si falla" comando...
chk() {
  local desc="$1" sig="$2"; shift 2
  if "$@" >/dev/null 2>&1; then
    echo "$NOMBRE_OK$desc"
  else
    echo "$NOMBRE_NO$desc"
    [ -z "$SIGUIENTE" ] && SIGUIENTE="$sig"
  fi
}

PROY=$(grep -o '"default": *"[^"]*"' .firebaserc 2>/dev/null | sed 's/.*: *"\(.*\)"/\1/')

echo "=============================================================="
echo " ESTADO  $(date '+%Y-%m-%d %H:%M')"
echo "=============================================================="
echo "Carpeta : $(pwd)"
echo "Proyecto: ${PROY:-NO DETECTADO (¿estas en la raiz del repo?)}"
echo

echo "--- GIT ---"
echo "Rama          : $(git branch --show-current 2>/dev/null)"
echo "Ultimo commit : $(git log -1 --format='%h  %s  (%cr)' 2>/dev/null)"
echo "Sin guardar   : $(git status --short 2>/dev/null | wc -l) archivo(s) con cambios sin commit"
SIN_SUBIR=$(git rev-list --count '@{u}..HEAD' 2>/dev/null)
echo "Sin subir     : ${SIN_SUBIR:-?} commit(s) sin push"
echo

URL=""
if [ "$PROY" = "flowseguridad" ]; then
  URL="https://flowseguridad.web.app"
  echo "--- FLOWSEGURIDAD (presentacion publica) ---"
  chk "public/index.html (pantalla de acceso)"              "Falta public/index.html: Paso 13 (pantalla de acceso)" test -f public/index.html
  chk "3 logos en public/img"                               "Faltan logos en public/img: Paso 13A" bash -c 'test -f public/img/alanis_logo_transparente.png && test -f public/img/samsara_new.png && test -f public/img/webfleet.png'
  chk "functions/index.js define canjear y contenido"       "Falta functions/index.js del Paso 17A" bash -c 'grep -q "exports.canjear" functions/index.js && grep -q "exports.contenido" functions/index.js'
  chk "firebase.json con rutas /api y encabezados"          "Falta firebase.json del Paso 17B" bash -c 'grep -q "api/canjear" firebase.json && grep -q "X-Robots-Tag" firebase.json'
  chk "publicar.sh incluye functions"                       "Falta publicar.sh del Paso 17C" bash -c 'grep -q "only functions,hosting" publicar.sh'
  chk "funciones canjear y contenido PUBLICADAS"            "Publicar con ./publicar.sh (Paso 17D)" bash -c "firebase functions:list --project $PROY 2>/dev/null | grep -q canjear && firebase functions:list --project $PROY 2>/dev/null | grep -q contenido"
  chk "sitio responde (HTTP 200)"                           "El sitio no responde: ./publicar.sh" bash -c "test \"\$(curl -s -o /dev/null -w '%{http_code}' $URL/?v=\$RANDOM)\" = 200"
  chk "encabezados de seguridad activos"                    "Hosting con configuracion vieja: ./publicar.sh" bash -c "curl -s -I '$URL/?v=\$RANDOM' | grep -qi x-robots-tag"
  chk "/api/canjear rechaza llave invalida (ok:false)"      "Las rutas /api no funcionan: revisar Paso 17" bash -c "curl -s -X POST $URL/api/canjear -H 'Content-Type: application/json' -d '{\"llave\":\"x\"}' | grep -q '\"ok\":false'"
  chk "pagina conectada al lector de QR (llama a /api/canjear)" "SIGUIENTE: Paso 18 = lector de QR en la pagina publica" bash -c 'grep -q "/api/canjear" public/index.html'

elif [ "$PROY" = "appadrematasainterno" ]; then
  URL="https://adrematasainterno.web.app"
  echo "--- ADREMATASA INTERNO (generador de llaves, Paso 16) ---"
  chk "16A functions/llavesSeguridad.js"                    "Crear functions/llavesSeguridad.js (Paso 16A)" test -f functions/llavesSeguridad.js
  chk "16A public/llave-seguridad.html"                     "Crear public/llave-seguridad.html (Paso 16A)" test -f public/llave-seguridad.html
  chk "16A public/js/qrcode.js"                             "Crear public/js/qrcode.js (Paso 16A)" test -f public/js/qrcode.js
  chk "16B functions/index.js enlaza generarLlaveSeguridad" "Agregar la linea a functions/index.js (Paso 16B)" bash -c 'grep -q "generarLlaveSeguridad" functions/index.js'
  chk "16C firestore.rules sin regla comodin"               "REVISAR firestore.rules: hay un match comodin (pegame las lineas)" bash -c '! grep -q "document=\*\*" firestore.rules'
  chk "secreto FLOW_LLAVE_PRIVADA guardado (activo)"        "Falta el secreto: repetir Paso 15" bash -c "firebase functions:secrets:get FLOW_LLAVE_PRIVADA --project $PROY 2>/dev/null | grep -q ENABLED"
  chk "16D funcion generarLlaveSeguridad PUBLICADA"         "Publicar la funcion (Paso 16D): firebase deploy --only functions:generarLlaveSeguridad --project appadrematasainterno" bash -c "firebase functions:list --project $PROY 2>/dev/null | grep -q generarLlaveSeguridad"
  chk "16E pantalla publicada (HTTP 200)"                   "Publicar la pantalla con ./publicar.sh (Paso 16E)" bash -c "test \"\$(curl -s -o /dev/null -w '%{http_code}' $URL/llave-seguridad.html?v=\$RANDOM)\" = 200"
  if [ -z "$SIGUIENTE" ]; then
    SIGUIENTE="Paso 16F: abrir $URL/llave-seguridad.html como admin, generar llave y probar el canje con curl"
  fi
else
  echo "No reconozco este proyecto. Ejecuta el script en la RAIZ de flowseguridad o de adrematasa_interno."
  SIGUIENTE="Abrir el repo correcto y repetir"
fi

echo
echo "--- PRIMER PASO PENDIENTE ---"
echo "${SIGUIENTE:-Todo lo revisado esta completo.}"
echo "=============================================================="
