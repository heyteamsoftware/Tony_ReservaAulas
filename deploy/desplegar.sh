#!/usr/bin/env bash
# Despliega la app en el servidor indicado en deploy/servidor.env
# Uso (Git Bash, desde la carpeta del proyecto): bash deploy/desplegar.sh
# La base de datos del servidor (data/reservas.sqlite) NO se toca.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f deploy/servidor.env ]; then
  echo "Falta deploy/servidor.env. Cópialo desde deploy/servidor.ejemplo.env y rellénalo." >&2
  exit 1
fi
# shellcheck disable=SC1091
source deploy/servidor.env
: "${SERVIDOR:?Falta SERVIDOR en deploy/servidor.env}"
: "${CLAVE:?Falta CLAVE en deploy/servidor.env}"
: "${DESTINO:?Falta DESTINO en deploy/servidor.env}"

PAQUETE="$(mktemp -u)-reservadeaulas.tgz"
tar czf "$PAQUETE" --exclude='data/*.sqlite*' .htaccess .gitignore index.html admin.html api css js img data
scp -i "$CLAVE" -q "$PAQUETE" "$SERVIDOR:/tmp/reservadeaulas.tgz"
rm -f "$PAQUETE"

ssh -i "$CLAVE" "$SERVIDOR" "set -e
  sudo mkdir -p '$DESTINO/data'
  sudo tar xzf /tmp/reservadeaulas.tgz -C '$DESTINO' --no-same-owner
  rm -f /tmp/reservadeaulas.tgz
  sudo chown -R www-data:www-data '$DESTINO'
  sudo find '$DESTINO' -type d -exec chmod 755 {} +
  sudo find '$DESTINO' -type f -exec chmod 644 {} +
  sudo chmod 770 '$DESTINO/data'
  sudo find '$DESTINO/data' -name '*.sqlite*' -exec chmod 660 {} +
  sudo php -l '$DESTINO/api/api.php' && sudo php -l '$DESTINO/api/config.php'"

echo "Desplegado en https://myappsserver.duckdns.org/reservadeaulas/"
