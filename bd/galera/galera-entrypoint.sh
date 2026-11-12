#!/bin/bash
# Arranque de un nodo Galera.
#
# Problema que mostró el profe en clase: el nodo 1 intentaba crear el clúster
# (--wsrep-new-cluster) cada vez que reiniciaba y quedaba en crash.
# Aquí el nodo 1 solo crea el clúster cuando es seguro:
#   1. Primera vez (no existe grastate.dat), o
#   2. Fue el último nodo en apagarse (safe_to_bootstrap: 1) y ningún otro nodo está vivo.
# En cualquier otro caso se une al clúster existente como los nodos 2 y 3.
set -e

GRASTATE=/var/lib/mysql/grastate.dat
ARGS=()

otro_nodo_vivo() {
  local ip
  for ip in ${GALERA_PEERS:-}; do
    # Puerto 4567 = comunicación del grupo Galera
    if timeout 2 bash -c "</dev/tcp/$ip/4567" 2>/dev/null; then
      return 0
    fi
  done
  return 1
}

if [ "${GALERA_BOOTSTRAP:-0}" = "1" ]; then
  if [ ! -f "$GRASTATE" ]; then
    echo "[galera] Primer arranque: creando el clúster"
    ARGS+=(--wsrep-new-cluster)
  elif grep -q '^safe_to_bootstrap: 1' "$GRASTATE" && ! otro_nodo_vivo; then
    echo "[galera] Último nodo en apagarse y no hay otros vivos: recreando el clúster"
    ARGS+=(--wsrep-new-cluster)
  else
    echo "[galera] Uniéndose al clúster existente"
  fi
fi

exec docker-entrypoint.sh mariadbd "${ARGS[@]}" "$@"
