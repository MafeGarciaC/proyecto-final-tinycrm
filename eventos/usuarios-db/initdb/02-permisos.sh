#!/bin/bash
# Usuarios de la BD Usuarios con el mínimo permiso necesario:
#   middleware -> solo puede LEER (consulta a qué cliente pertenece un usuario)
#   consumer   -> puede INSERTAR y ACTUALIZAR (registra los usuarios que llegan del broker)
set -e

mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" <<SQL
CREATE USER IF NOT EXISTS 'middleware'@'%' IDENTIFIED BY '$USUARIOS_MIDDLEWARE_PASSWORD';
GRANT SELECT ON usuarios.* TO 'middleware'@'%';

CREATE USER IF NOT EXISTS 'consumer'@'%' IDENTIFIED BY '$USUARIOS_CONSUMER_PASSWORD';
GRANT SELECT, INSERT, UPDATE ON usuarios.* TO 'consumer'@'%';

FLUSH PRIVILEGES;
SQL

echo "[init] Usuarios middleware (lectura) y consumer (escritura) creados"
