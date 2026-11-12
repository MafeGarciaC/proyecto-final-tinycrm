# Guía de sustentación — comandos listos para copiar y pegar

El profe dijo: *"Ten listos los comandos, no vayas a la sustentación a adivinar el comando"*.
Todos se corren desde la carpeta raíz del proyecto en la Máquina #1.

Contraseña root de laboratorio (`.env`): `root_tiny_2026`. Para no repetirla:
```bash
R="-uroot -proot_tiny_2026"
```

---

## Orquestación (10 pts): levantar / apagar / estado

```bash
bash scripts/levantar.sh     # todo, en orden, esperando que cada capa esté sana (~2-3 min)
bash scripts/estado.sh       # resumen para empezar la sustentación
bash scripts/apagar.sh       # todo, en orden inverso; los datos quedan en los volúmenes
```

**Orden de `levantar.sh` y por qué:**
1. Redes (`tiny_dmz`, `tiny_interna`): todos los demás se conectan a ellas.
2. Clúster de BD + LB BD: las apps no arrancan sin base de datos.
3. Cliente A y 4. Cliente B: crean sus tablas en su base al arrancar.
5. Broker + publicadores + consumer: el publicador necesita que exista la tabla `users` para crear el trigger.
6. Middleware + DNS: la entrada se abre de último, cuando todo lo de atrás ya responde.

Cada paso usa `docker compose up --wait --wait-timeout N`: espera a que los contenedores estén **sanos** (healthcheck), no solo encendidos, con un tiempo máximo para no quedarse bloqueado (lo explicó el profe con el clúster).

En el clúster Galera, `apagar.sh` apaga primero los nodos 2 y 3 y de último el 1 (depende de él): así el nodo 1 queda con `safe_to_bootstrap: 1` y recrea el clúster al volver.

---

## "Muéstreme las redes y en qué red está cada contenedor"

```bash
docker network ls --filter name=tiny_
docker network inspect tiny_interna -f '{{range .Containers}}{{.Name}} {{.IPv4Address}}{{"\n"}}{{end}}'
docker network inspect tiny_dmz     -f '{{range .Containers}}{{.Name}} {{.IPv4Address}}{{"\n"}}{{end}}'
```
- `tiny_dmz` = Red DMZ del diagrama (10.1.1.x ≈ 192.168.1.x)
- `tiny_interna` = Red Interna (10.1.2.x ≈ 192.168.2.x), creada con `--internal`: **sin salida a Internet**.
- Usamos 10.1.x porque la red de la casa es 192.168.1.x y chocaba. El último número es el del diagrama (LB BD = .1).

---

## Clúster de BD (15 pts)

**Que hay 3 nodos en el clúster:**
```bash
for n in 1 2 3; do docker exec galera-$n mariadb $R -Nse "SHOW STATUS LIKE 'wsrep_cluster_size'"; done
```

**Replicación** — crear un usuario desde TinyCRM y mostrar que está en los 3 nodos:
```bash
for n in 1 2 3; do echo "galera-$n:"; docker exec galera-$n mariadb $R -Nse "SELECT id, username FROM tinycrm_a.users"; done
```
También con Adminer: http://localhost:8090 → Servidor `10.1.2.11` (o `.12`, `.13`), usuario `root`.

> Los `id` saltan de 3 en 3 (1, 4, 7…): Galera reparte los autoincrementos entre los nodos para que dos nodos nunca generen el mismo id al mismo tiempo (`wsrep_auto_increment_control`).

**Balanceo del LB BD (roundrobin):**
```bash
for i in 1 2 3 4 5 6; do docker exec galera-1 mariadb -h 10.1.2.1 -uapp_a -pclave_a_2026 -Nse "SELECT @@hostname"; done
```
Debe salir galera-1, galera-3, galera-2, galera-1… Configuración en `bd/haproxy/haproxy.cfg`:
- `balance roundrobin` — algoritmo de balanceo.
- `option mysql-check` — HAProxy se conecta como `haproxy_check` para saber si el nodo responde.
- `inter 1s fall 2 rise 2` — revisa cada segundo; 2 fallos = fuera; 2 éxitos = vuelve.
- `timeout connect 5s` — espera para abrir conexión con un nodo antes de dar error.
- `timeout server 1m` — si una consulta tarda más de 1 minuto, error (no significa que algo se cayó).
- `retries 3` + `option redispatch` — si falla la conexión con un nodo, lo intenta en otro.

**Página de estado del HAProxy BD:**
```bash
docker exec tiny-adminer wget -qO- http://10.1.2.1:8404/\;csv | cut -d, -f1,2,18 | grep galera
```

**Caída de un nodo:**
```bash
docker stop galera-2
docker exec galera-1 mariadb $R -Nse "SHOW STATUS LIKE 'wsrep_cluster_size'"   # 2
# ... el sistema sigue funcionando ...
docker start galera-2                                                         # vuelve y se sincroniza solo
```

**Aislamiento entre clientes en la BD (10 pts):**
```bash
docker exec galera-1 mariadb -h 10.1.2.1 -uapp_a -pclave_a_2026 -e "SHOW TABLES FROM tinycrm_b"
# ERROR 1044: Access denied for user 'app_a'@'%' to database 'tinycrm_b'
```

**¿Por qué el clúster no se daña al reiniciar?** (problema del ejemplo del profe)
`bd/galera/galera-entrypoint.sh`: el nodo 1 solo ejecuta `--wsrep-new-cluster` la primera vez, o si fue el último en apagarse (`safe_to_bootstrap: 1`) y no hay otro nodo vivo. Si los otros están vivos, se une a ellos.
```bash
docker restart galera-1 && sleep 20 && docker logs galera-1 2>&1 | grep "\[galera\]" | tail -1
# [galera] Uniéndose al clúster existente
```

---

## Clúster de aplicación y balanceador por cliente (15 + 10 pts)

Usuarios de prueba: `admin_a` / `admin123` (cliente A) y `admin_b` / `admin123` (cliente B).
Mientras no esté el middleware, cada cliente se abre por su LB: A → http://localhost:8101, B → http://localhost:8102.

**Que hay 2 instancias por cliente:**
```bash
docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "tiny-(a|b)-"
```

**Balanceo** — cada visitante nuevo cae en una instancia distinta (cabecera `X-Instancia`):
```bash
for i in 1 2 3 4; do curl -s -D - -o /dev/null http://localhost:8101/api/auth/me | grep -i x-instancia; done
```
En el navegador: F12 → Red → cualquier petición `/api/...` → cabeceras de respuesta `x-cliente` y `x-instancia`.

**Sticky session** — `apps/haproxy/haproxy.cfg`:
- `cookie SERVERID insert indirect nocache` → en el primer acceso el LB guarda en el navegador la cookie `SERVERID=app1` (o `app2`) y desde ahí lo manda siempre a la misma instancia.
- ¿Por qué? TinyCRM guarda la sesión en la memoria de cada instancia; sin sticky, la segunda petición podría caer en la otra instancia y pedir login otra vez.
- La cookie es por navegador: dos navegadores distintos en el mismo PC pueden caer en instancias distintas.

**Página de estado del LB del cliente:**
```bash
docker exec tiny-adminer wget -qO- "http://10.1.1.6:8404/;csv" | cut -d, -f1,2,18 | grep -E "api|web"
```

---

## Tolerancia a fallos (15 pts)

1. Entrar con `admin_a` en http://localhost:8101 y ver en F12 qué `x-instancia` responde (ej. `app1`).
2. Apagar esa instancia:
```bash
docker stop tiny-a-app-1
```
3. Seguir usando TinyCRM (abrir "All Tickets"): responde `app2` **y el usuario no tiene que volver a iniciar sesión**.
4. Apagar también la otra → el cliente A deja de responder (503), el cliente B sigue normal:
```bash
docker stop tiny-a-app-2
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8101/api/auth/me   # 503
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8102/api/auth/me   # 401 = B vivo (sin sesión)
docker start tiny-a-app-1 tiny-a-app-2
```

**¿Cómo no pierde la sesión?** El token de sesión está en la tabla `user_sessions` (replicada por Galera) y el frontend lo envía en cada petición (`Authorization: Bearer ...`). Agregamos `SessionRestoreFilter.java`: si la instancia no tiene la sesión en memoria pero el token es válido en la BD, la reconstruye. El sticky evita hacer eso en cada petición; el filtro cubre el caso de caída.

**Aislamiento entre clientes:** el usuario de A no existe en la BD de B:
```bash
curl -s -H 'Content-Type: application/json' -d '{"username":"admin_a","password":"admin123"}' http://localhost:8102/api/auth/login
# "Invalid username or password"
```

---

## Middleware y enrutamiento por cliente (15 pts)

Entrada única para los dos clientes: http://localhost (luego `www.tiny.com`). Código: `entrada/middleware/servidor.js`.

**Cómo decide a dónde enviar a cada usuario:**
1. En el login (`POST /api/auth/login`) lee el usuario, lo busca en la **BD Usuarios** y reenvía al **LB de su cliente** (A = 10.1.1.6, B = 10.1.1.7).
2. Si el login sale bien guarda la cookie `tiny_cliente=A.<firma>` (HttpOnly, firmada con HMAC para que no se pueda cambiar a mano).
3. Todas las demás peticiones `/api/...` van al LB que dice la cookie. Sin cookie → 401 (pantalla de login).
4. El registro público está bloqueado: los usuarios los crea el admin de cada cliente.

**Demostración en el navegador:** entrar con "Cliente A" → F12 → Red → `/api/auth/me` → cabeceras `x-middleware-cliente: A`, `x-cliente: A`, `x-instancia: app1|app2`. Cerrar sesión, entrar con "Cliente B" → mismas cabeceras con `B`.

**Ver las decisiones del middleware en vivo:**
```bash
docker logs -f tiny-middleware
# LOGIN "admin_a" -> cliente A (10.1.1.6)
# LOGIN "admin_b" -> cliente B (10.1.1.7)
# LOGIN "fantasma" -> no está en la BD Usuarios: rechazado
```

**Estado del middleware, la BD Usuarios y los dos LB:**
```bash
curl -s http://localhost/middleware/estado
```

**Contenido del componente central (BD Usuarios):**
```bash
docker exec tiny-usuarios-db mariadb -uroot -proot_usuarios_2026 -e "SELECT username, email, cliente, id_en_cliente FROM usuarios.usuarios"
```

**Aislamiento por la entrada:**
```bash
# Cookie de cliente inventada -> 401
curl -s -o /dev/null -w "%{http_code}\n" -H "Cookie: tiny_cliente=B.00000000000000000000000000000000" http://localhost/api/tickets
# Registro público -> bloqueado
curl -s -H 'Content-Type: application/json' -d '{"username":"x"}' http://localhost/api/auth/register
```

---

## Sincronización de usuarios + Broker (10 + 10 pts)

```
BD del cliente ── trigger ──► outbox_usuarios ──► publicador-X ──► RabbitMQ ──► consumer ──► BD Usuarios ──► middleware
   (interna)                     (interna)          (interna)     (interna+DMZ)    (DMZ)        (DMZ)
```
- **Trigger** `trg_usuario_creado` en la tabla `users` de cada cliente: todo usuario nuevo queda en `outbox_usuarios`, sin importar cómo se creó y sin tocar el código de TinyCRM. Es la flecha **Cluster DB → Broker** del diagrama.
- **Publicador** (uno por cliente): cada 2 s envía los pendientes del outbox a RabbitMQ (exchange `tiny.usuarios`, clave `usuario.creado.a|b`) y los marca publicados cuando el broker confirma.
- **Consumer**: lee la cola `central.usuarios` y registra `usuario → cliente` en la BD Usuarios. Confirma (ack) solo después de guardar.

**Demostración completa** (≈ 1 minuto):
1. Entrar con `admin_a` en http://localhost → Settings / usuarios → crear `nuevo_a` (contraseña `clave123`).
2. Ver el evento pasar por cada pieza:
```bash
docker logs --since 1m tiny-publicador-a | grep PUBLICADO     # PUBLICADO usuario "nuevo_a"
docker logs --since 1m tiny-consumer     | grep REGISTRADO    # REGISTRADO "nuevo_a" -> cliente A
docker exec tiny-usuarios-db mariadb -uroot -proot_usuarios_2026 -e "SELECT username, cliente FROM usuarios.usuarios"
```
3. Cerrar sesión y entrar con `nuevo_a` / `clave123` → el middleware lo manda al cliente A.

**Panel del broker:** http://localhost:15672 (usuario `tiny`, clave `clave_rabbit_2026`) → Queues → `central.usuarios` (mensajes, consumidores, gráficas).

**Outbox de un cliente:**
```bash
docker exec galera-1 mariadb -uroot -proot_tiny_2026 -e "SELECT id, username, publicado_en FROM tinycrm_a.outbox_usuarios"
```

**¿Qué pasa si se cae el consumer?** El mensaje espera en la cola (es durable) y se procesa al volver:
```bash
docker stop tiny-consumer
# crear un usuario...
docker exec tiny-rabbitmq rabbitmqctl -q list_queues name messages    # central.usuarios 1
docker start tiny-consumer                                            # lo registra solo
```

**¿Qué pasa si se cae el broker?** TinyCRM sigue funcionando y creando usuarios; los eventos quedan en el outbox con `publicado_en = NULL` y se envían cuando el broker vuelve:
```bash
docker stop tiny-rabbitmq
# crear un usuario... (TinyCRM responde normal)
docker start tiny-rabbitmq
docker logs --since 2m tiny-publicador-b | grep -E "cerrada|Conectado|PUBLICADO"
```

**¿Y si el admin de B crea un usuario con un username que ya es de A?** El consumer lo ignora (`CONFLICTO ... ya pertenece al cliente A`) para que nadie de B pueda quedarse con el login de un usuario de A.

---

## DNS

bind9 en `entrada/dns`. `www.tiny.com` → IP de la Máquina #1 (`IP_MAQUINA1` en `.env`). Para cualquier otro dominio pregunta a 8.8.8.8 (recursivo), así la Máquina #2 puede usarlo como único DNS y seguir navegando.

**Antes de la sustentación** (el profe contó el caso del estudiante al que el DHCP le cambió la IP):
```bash
ip -4 addr show                  # ¿sigue siendo la misma IP?
grep IP_MAQUINA1 .env            # si cambió, actualizarla aquí y:
docker compose --env-file .env -f entrada/docker-compose.yml up -d dns
```

**Certificar que el DNS funciona** (desde la Máquina #2, Windows):
```
nslookup www.tiny.com              (con el DNS de la casa: NO es nuestra IP)
nslookup www.tiny.com <IP_MAQUINA1> (con nuestro DNS: devuelve la IP de la Máquina #1)
```
Desde Linux: `dig @<IP_MAQUINA1> www.tiny.com` → en la respuesta aparece la bandera `aa` (autoritativa: el dominio es nuestro).

**Usarlo de verdad en la Máquina #2:** configuración de red → IPv4 → DNS manual = `<IP_MAQUINA1>` → abrir http://www.tiny.com.

**Zona:** `entrada/dns/db.tiny.com.plantilla` (TTL 300 s: si la IP cambia, los clientes se enteran en 5 min). **Configuración:** `entrada/dns/named.conf`.

---

## Firewall (VM Ubuntu)

```bash
sudo bash scripts/firewall.sh            # aplicar
sudo bash scripts/firewall.sh estado     # ver reglas
sudo dmesg | grep FW-TINY                # intentos bloqueados
```
- Desde fuera solo se puede entrar a **80** (TinyCRM por el middleware), **53** (DNS) y **22** (SSH).
- Adminer (8090), RabbitMQ (15672) y los LB de cada cliente (8101/8102) **no** son accesibles desde la Máquina #2: solo desde la propia Máquina #1.
- **Pregunta del profe en clase:** "¿por qué UFW está activo pero el puerto del contenedor sigue abierto?" → Docker publica los puertos con reglas **FORWARD** (DNAT), no INPUT; UFW solo filtra INPUT. Por eso las reglas de los contenedores van en la cadena **`DOCKER-USER`**.

**Prueba desde la Máquina #2:**
```
curl http://<IP_MAQUINA1>/            -> responde (80 abierto)
curl http://<IP_MAQUINA1>:15672/      -> no responde (bloqueado)
```

---

### Si el clúster no levanta (recuperación manual)
Si todos los nodos se cayeron de golpe (corte de luz), ninguno queda con `safe_to_bootstrap: 1`. Ver cuál tiene el `seqno` más alto y marcarlo:
```bash
for n in 1 2 3; do echo "galera-$n"; docker run --rm -v galera_${n}_datos:/d alpine cat /d/grastate.dat | grep -E "seqno|safe"; done
docker run --rm -v galera_1_datos:/d alpine sed -i 's/safe_to_bootstrap: 0/safe_to_bootstrap: 1/' /d/grastate.dat
docker compose --env-file .env -f bd/docker-compose.yml up -d --wait
```
