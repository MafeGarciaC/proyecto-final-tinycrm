# Imagen de nodo Galera = MariaDB oficial + nuestra configuración.
# Se copia en vez de montar porque MariaDB ignora los .cnf con permisos de escritura para todos
# (así llegan los archivos montados desde Windows).
FROM mariadb:11.4

COPY galera.cnf /etc/mysql/conf.d/galera.cnf
COPY galera-entrypoint.sh /usr/local/bin/galera-entrypoint.sh
COPY initdb/ /docker-entrypoint-initdb.d/

# Quita retornos de carro de Windows por si git los agregó, y fija permisos
RUN sed -i 's/\r$//' /etc/mysql/conf.d/galera.cnf /usr/local/bin/galera-entrypoint.sh /docker-entrypoint-initdb.d/*.sh \
 && chmod 644 /etc/mysql/conf.d/galera.cnf \
 && chmod 755 /usr/local/bin/galera-entrypoint.sh

ENTRYPOINT ["galera-entrypoint.sh"]
