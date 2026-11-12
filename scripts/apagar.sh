#!/usr/bin/env bash
# Apaga toda la arquitectura en orden inverso (primero la entrada, de último la BD).
# Los datos NO se borran: quedan en los volúmenes de Docker y vuelven con scripts/levantar.sh.
#
# En el clúster Galera, compose apaga primero los nodos 2 y 3 y de último el nodo 1
# (depende de él), así el nodo 1 queda con safe_to_bootstrap: 1 y puede recrear el clúster al volver.
set -euo pipefail
cd "$(dirname "$0")/.."

paso() { echo; echo "=== $1"; }
dc()   { docker compose --env-file .env "$@"; }

paso "Entrada (middleware + DNS)"
dc -f entrada/docker-compose.yml down

paso "Sincronización de usuarios"
dc -f eventos/docker-compose.yml down

paso "Cliente B"
dc --env-file apps/cliente-b.env -f apps/docker-compose.yml -p tiny-b down

paso "Cliente A"
dc --env-file apps/cliente-a.env -f apps/docker-compose.yml -p tiny-a down

paso "Clúster de BD"
dc -f bd/docker-compose.yml down

echo
echo "Todo apagado. Los datos siguen en los volúmenes:"
docker volume ls --format '  {{.Name}}' | grep -E '^  (galera_[123]_datos|usuarios_datos|rabbitmq_datos)$' || true
