#!/bin/bash
# Se ejecuta UNA sola vez, en el primer arranque del nodo 1 (los otros nodos lo reciben por replicación).
# Crea una base y un usuario por cliente: app_a solo puede tocar tinycrm_a y app_b solo tinycrm_b.
set -e

mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_A_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS \`$DB_B_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS '$DB_A_USER'@'%' IDENTIFIED BY '$DB_A_PASSWORD';
GRANT ALL PRIVILEGES ON \`$DB_A_NAME\`.* TO '$DB_A_USER'@'%';

CREATE USER IF NOT EXISTS '$DB_B_USER'@'%' IDENTIFIED BY '$DB_B_PASSWORD';
GRANT ALL PRIVILEGES ON \`$DB_B_NAME\`.* TO '$DB_B_USER'@'%';

-- Usuario sin contraseña ni permisos: solo lo usa HAProxy para comprobar que el nodo responde
CREATE USER IF NOT EXISTS 'haproxy_check'@'%';

FLUSH PRIVILEGES;
SQL

echo "[init] Bases $DB_A_NAME y $DB_B_NAME creadas con sus usuarios"
