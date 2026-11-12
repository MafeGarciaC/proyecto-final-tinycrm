#!/usr/bin/env bash
# Firewall de la Máquina #1 (VM Ubuntu). Diagrama: Firewall entre la Red Externa y la DMZ.
#
# Desde la red externa (Máquina #2) solo se puede entrar a:
#   80/tcp  -> middleware (TinyCRM de los dos clientes)
#   53      -> DNS (www.tiny.com)
#   22/tcp  -> SSH, para administrar la VM
# Los paneles de administración (Adminer 8090, RabbitMQ 15672, LB A 8101, LB B 8102) quedan
# bloqueados desde fuera: solo se abren desde la propia Máquina #1 (http://localhost:...).
#
# IMPORTANTE (lo mostró el profe en clase): Docker publica los puertos con reglas de FORWARD (DNAT),
# no de INPUT. UFW solo filtra INPUT, así que con UFW solo los contenedores quedarían abiertos.
# Por eso las reglas para los contenedores van en la cadena DOCKER-USER, que Docker revisa primero.
#
# Uso (en la VM, después de levantar Docker):
#   sudo bash scripts/firewall.sh            # aplica las reglas
#   sudo bash scripts/firewall.sh estado     # muestra las reglas activas
#   sudo bash scripts/firewall.sh quitar     # deja todo abierto otra vez
# Las reglas de DOCKER-USER no sobreviven a un reinicio de la VM: volver a ejecutar el script.
set -euo pipefail

[ "$(id -u)" = "0" ] || { echo "Ejecutar con sudo"; exit 1; }

# Interfaz de la red externa (la que tiene la ruta por defecto, ej. enp0s3)
EXT_IF=${EXT_IF:-$(ip route show default | awk '{print $5; exit}')}
ACCION=${1:-aplicar}

estado() {
  echo "Interfaz externa: $EXT_IF"
  echo; echo "=== UFW (servicios de la VM)"; ufw status verbose
  echo; echo "=== DOCKER-USER (contenedores)"; iptables -L DOCKER-USER -n -v --line-numbers
}

case "$ACCION" in
  estado)
    estado
    ;;

  quitar)
    iptables -F DOCKER-USER
    iptables -A DOCKER-USER -j RETURN
    ufw --force disable
    echo "Firewall quitado: todo abierto"
    ;;

  aplicar)
    iptables -L DOCKER-USER -n >/dev/null 2>&1 || { echo "No existe DOCKER-USER: ¿Docker está corriendo?"; exit 1; }

    # 1. UFW: tráfico dirigido a la propia VM (INPUT)
    ufw --force reset >/dev/null
    ufw default deny incoming
    ufw default allow outgoing
    ufw allow 22/tcp comment 'SSH administración'
    ufw allow 80/tcp comment 'TinyCRM (middleware)'
    ufw allow 53 comment 'DNS'
    ufw --force enable

    # 2. DOCKER-USER: tráfico hacia los contenedores (FORWARD)
    #    --ctorigdstport = puerto al que se conectó el usuario (antes de que Docker lo traduzca)
    iptables -F DOCKER-USER
    # Respuestas de conexiones ya abiertas (ej. los contenedores de la DMZ saliendo a Internet)
    iptables -A DOCKER-USER -i "$EXT_IF" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
    iptables -A DOCKER-USER -i "$EXT_IF" -p tcp -m conntrack --ctorigdstport 80 -j RETURN
    iptables -A DOCKER-USER -i "$EXT_IF" -p udp -m conntrack --ctorigdstport 53 -j RETURN
    iptables -A DOCKER-USER -i "$EXT_IF" -p tcp -m conntrack --ctorigdstport 53 -j RETURN
    # Todo lo demás que venga de fuera se registra (ver con: sudo dmesg | grep FW-TINY) y se descarta
    iptables -A DOCKER-USER -i "$EXT_IF" -m limit --limit 5/min -j LOG --log-prefix "FW-TINY-BLOQUEADO: "
    iptables -A DOCKER-USER -i "$EXT_IF" -j DROP
    # Tráfico entre contenedores o desde la propia VM: sigue normal
    iptables -A DOCKER-USER -j RETURN

    echo "Firewall aplicado en $EXT_IF: entrada solo por 80 (TinyCRM), 53 (DNS) y 22 (SSH)"
    estado
    ;;

  *)
    echo "Uso: sudo bash scripts/firewall.sh [aplicar|estado|quitar]"
    exit 1
    ;;
esac
