#!/usr/bin/env bash
# Crea las redes Docker de la arquitectura (Máquina #1).
#   tiny_dmz     -> "Red DMZ (con salida a Internet)"  del diagrama: 192.168.1.x
#   tiny_interna -> "Red Interna"                      del diagrama: 192.168.2.x
# Usamos 10.1.x en vez de 192.168.x porque la red de la casa es 192.168.1.x y chocaría.
# El último número de cada IP es el mismo del diagrama. El gateway va en .254 para dejar libre el .1.
set -euo pipefail

crear_red() {
  local nombre=$1 subred=$2 gateway=$3; shift 3
  if docker network inspect "$nombre" >/dev/null 2>&1; then
    echo "Red $nombre ya existe"
  else
    docker network create --driver bridge --subnet "$subred" --gateway "$gateway" "$@" "$nombre" >/dev/null
    echo "Red $nombre creada ($subred)"
  fi
}

crear_red tiny_dmz     10.1.1.0/24 10.1.1.254
# --internal: la red interna no tiene salida a Internet, solo se habla entre contenedores
crear_red tiny_interna 10.1.2.0/24 10.1.2.254 --internal
