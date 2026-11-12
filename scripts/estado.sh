#!/usr/bin/env bash
# Resumen del estado de toda la arquitectura (útil al empezar la sustentación).
set -uo pipefail
cd "$(dirname "$0")/.."
source .env

echo
echo "=== Contenedores"
docker ps -a --filter "name=tiny-" --filter "name=galera-" --filter "name=lb-bd" \
  --format 'table {{.Names}}\t{{.Status}}' | sort

echo
echo "=== Clúster Galera"
for n in 1 2 3; do
  printf '  galera-%s: ' "$n"
  docker exec "galera-$n" mariadb -uroot -p"$DB_ROOT_PASSWORD" -Nse \
    "SELECT CONCAT(MAX(IF(VARIABLE_NAME='wsrep_local_state_comment',VARIABLE_VALUE,NULL)), ', tamaño del clúster = ', MAX(IF(VARIABLE_NAME='wsrep_cluster_size',VARIABLE_VALUE,NULL))) FROM information_schema.GLOBAL_STATUS WHERE VARIABLE_NAME IN ('wsrep_local_state_comment','wsrep_cluster_size')" 2>/dev/null \
    || echo "apagado"
done

echo
echo "=== Middleware (BD Usuarios y Load Balancers)"
echo "  $(curl -s --max-time 5 "http://localhost:${MIDDLEWARE_PORT:-80}/middleware/estado" || echo 'no responde')"

echo
echo "=== Broker"
docker exec tiny-rabbitmq rabbitmqctl -q list_queues name messages consumers 2>/dev/null | sed 's/^/  /' || echo "  apagado"

echo
echo "=== Accesos"
echo "  TinyCRM (los dos clientes):  http://localhost:${MIDDLEWARE_PORT:-80}   admin_a / admin123  ·  admin_b / admin123"
echo "  Adminer (BD):                http://localhost:${ADMINER_PORT:-8090}   servidor 10.1.2.11 / .12 / .13, usuario root"
echo "  RabbitMQ:                    http://localhost:${RABBIT_ADMIN_PORT:-15672}  ${RABBIT_USER} / ${RABBIT_PASSWORD}"
echo "  DNS:                         nslookup -port=${DNS_PORT:-53} www.tiny.com ${IP_MAQUINA1:-<IP>}"
