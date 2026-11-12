# Guía de sustentación — comandos listos para copiar y pegar

El profe dijo: *"Ten listos los comandos, no vayas a la sustentación a adivinar el comando"*.
Todos se corren desde la carpeta raíz del proyecto en la Máquina #1.

Contraseña root de laboratorio (`.env`): `root_tiny_2026`. Para no repetirla:
```bash
R="-uroot -proot_tiny_2026"
```

---

## Levantar / apagar

```bash
bash scripts/redes.sh
docker compose --env-file .env -f bd/docker-compose.yml up -d --build --wait --wait-timeout 600
```
`--wait` espera a que los 3 nodos estén **sincronizados** (no solo encendidos), con un máximo de 10 minutos para no quedarse bloqueado.

Apps de los dos clientes (mismo archivo, distinto `.env`):
```bash
docker compose --env-file .env --env-file apps/cliente-a.env -f apps/docker-compose.yml -p tiny-a up -d --build --wait --wait-timeout 600
docker compose --env-file .env --env-file apps/cliente-b.env -f apps/docker-compose.yml -p tiny-b up -d --wait --wait-timeout 600
```

Apagar la BD (compose apaga primero los nodos 2 y 3 y de último el 1, así el 1 puede recrear el clúster al volver):
```bash
docker compose --env-file .env -f bd/docker-compose.yml stop
```

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

### Si el clúster no levanta (recuperación manual)
Si todos los nodos se cayeron de golpe (corte de luz), ninguno queda con `safe_to_bootstrap: 1`. Ver cuál tiene el `seqno` más alto y marcarlo:
```bash
for n in 1 2 3; do echo "galera-$n"; docker run --rm -v galera_${n}_datos:/d alpine cat /d/grastate.dat | grep -E "seqno|safe"; done
docker run --rm -v galera_1_datos:/d alpine sed -i 's/safe_to_bootstrap: 0/safe_to_bootstrap: 1/' /d/grastate.dat
docker compose --env-file .env -f bd/docker-compose.yml up -d --wait
```
