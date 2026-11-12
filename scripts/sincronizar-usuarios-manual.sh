#!/usr/bin/env bash
# TEMPORAL — mientras no existan el Broker y el Consumer.
# Copia a la BD Usuarios (componente central) los usuarios que existen en tinycrm_a y tinycrm_b,
# para que el middleware sepa a qué cliente enviar a cada uno.
# Cuando esté la sincronización automática este script deja de hacer falta.
set -euo pipefail
cd "$(dirname "$0")/.."
source .env

valores=""
for c in a b; do
  C=$(echo "$c" | tr a-z A-Z)
  filas=$(docker exec galera-1 mariadb -uroot -p"$DB_ROOT_PASSWORD" -Nse \
    "SELECT CONCAT('(', QUOTE(username), ',', QUOTE(email), ',''$C'',', id, ')') FROM tinycrm_$c.users")
  [ -n "$filas" ] && valores="${valores:+$valores,}$(echo "$filas" | paste -sd,)"
done

if [ -z "$valores" ]; then
  echo "No hay usuarios en los clientes todavía (¿ya arrancaron las apps?)"
  exit 1
fi

docker exec -i tiny-usuarios-db mariadb -uroot -p"$USUARIOS_DB_ROOT_PASSWORD" usuarios <<SQL
INSERT INTO usuarios (username, email, cliente, id_en_cliente) VALUES $valores
ON DUPLICATE KEY UPDATE email = VALUES(email), cliente = VALUES(cliente), id_en_cliente = VALUES(id_en_cliente);
SELECT username, cliente FROM usuarios ORDER BY cliente, username;
SQL
