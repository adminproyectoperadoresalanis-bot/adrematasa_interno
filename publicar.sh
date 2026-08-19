#!/bin/bash
# Guarda todos los cambios en git y publica en Firebase Hosting, en un solo paso.
# Uso: ./publicar.sh
set -e

echo "Guardando cambios..."
git add .

if git diff --cached --quiet; then
  echo "No hay cambios nuevos que guardar (se publicará lo que ya estaba guardado)."
else
  git commit -m "Actualización $(date '+%Y-%m-%d %H:%M')"
fi

echo "Publicando en Firebase..."
firebase deploy --only hosting

echo "Listo. Cambios guardados y publicados."