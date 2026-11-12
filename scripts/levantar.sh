#!/usr/bin/env bash
# Levanta TODA la arquitectura en orden, esperando a que cada capa esté sana antes de seguir:
#   redes -> clúster de BD -> cliente A -> cliente B -> sincronización (broker) -> entrada (middleware + DNS)
#
# Uso (desde cualquier carpeta):
#   bash scripts/levantar.sh            # usa las imágenes que ya existen (las construye si faltan)
#   bash scripts/levantar.sh --build    # vuelve a construir las imágenes (después de cambiar código)
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { cp .env.example .env; echo "Se creó .env a partir de .env.example"; }

BUILD=""
[ "${1:-}" = "--build" ] && BUILD="--build"

paso() { echo; echo "=== $1"; }
dc()   { docker compose --env-file .env "$@"; }

inicio=$(date +%s)

paso "1/6 Redes (DMZ e interna)"
bash scripts/redes.sh

paso "2/6 Clúster de BD: Galera 3 nodos + Load Balancer BD + Adminer"
dc -f bd/docker-compose.yml up -d $BUILD --wait --wait-timeout 600

paso "3/6 Cliente A: 2 instancias de TinyCRM + Load Balancer A"
dc --env-file apps/cliente-a.env -f apps/docker-compose.yml -p tiny-a up -d $BUILD --wait --wait-timeout 600

paso "4/6 Cliente B: 2 instancias de TinyCRM + Load Balancer B"
# Usa las mismas imágenes que el cliente A
dc --env-file apps/cliente-b.env -f apps/docker-compose.yml -p tiny-b up -d --wait --wait-timeout 600

paso "5/6 Sincronización de usuarios: BD Usuarios + RabbitMQ + publicadores + consumer"
dc -f eventos/docker-compose.yml up -d $BUILD --wait --wait-timeout 300

paso "6/6 Entrada: middleware + DNS"
dc -f entrada/docker-compose.yml up -d $BUILD --wait --wait-timeout 120

echo
echo "Todo arriba en $(( $(date +%s) - inicio )) s"
bash scripts/estado.sh
