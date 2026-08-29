#!/bin/bash
# Guarda todos los cambios en git, los sube a GitHub y publica en Firebase (Hosting + reglas e
# índices de Firestore), en un solo paso.
# Uso: ./publicar.sh
set -e
echo "Guardando cambios..."
git add .
if git diff --cached --quiet; then
  echo "No hay cambios nuevos que guardar (se publicará lo que ya estaba guardado)."
else
  git commit -m "Actualización $(date '+%Y-%m-%d %H:%M')"
fi
echo "Subiendo a GitHub..."
git push
echo "Publicando en Firebase..."
firebase deploy --only hosting,firestore:rules,firestore:indexes