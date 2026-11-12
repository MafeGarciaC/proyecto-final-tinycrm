# Plan de trabajo — Proyecto Final Sistemas Distribuidos 2026-2

TinyCRM multi-cliente para ACME (2 clientes) desplegado por Pepito Plus.
Arquitectura oficial: [docs/arquitectura/ARQUITECTURA.md](arquitectura/ARQUITECTURA.md) (leída del `.drawio` del profe).
Montaje: **Máquina #1 = PC Mafe** (VM con todos los servidores) · **Máquina #2 = PC María Isabel** (usuarios / red externa).

> **11-nov:** con el diagrama cambiaron las fases 2–4: un solo clúster de BD con una base por cliente, el componente central es la BD "Usuarios" + Consumer, y el evento sale de la BD hacia el broker. Las fases de abajo ya están actualizadas.

---

## 0. Lo que encontramos al leer el código de TinyCRM

Esto cambia cómo hay que montar la arquitectura:

| # | Hallazgo | Archivo | Consecuencia |
|---|---|---|---|
| 1 | La sesión se guarda en la **HttpSession en memoria** de cada backend (cookie `TINYCRM_SESSIONID`). El token también está en la tabla `user_sessions`, pero el backend solo lo busca dentro de la HttpSession. | `AuthenticationController.java` | ✅ **Resuelto**: sticky session en el LB de cada cliente + `config/SessionRestoreFilter.java`, que reconstruye la sesión desde el token (tabla `user_sessions`, replicada) cuando el usuario cae en la otra instancia. Probado en navegador: se apaga la instancia y el usuario sigue sin volver a loguearse. No hizo falta Spring Session. |
| 2 | El frontend llamaba a `http://localhost:8080` fijo. | `frontend/src/main.js` | ✅ **Corregido**: ruta relativa (`''`), Nginx hace de proxy a `/api`. |
| 3 | Los usuarios se crean por **dos caminos**: registro público (`POST /api/auth/register` → `AuthenticationService.registerUser`) y admin (`POST /api/users` → `UserService.createUser`). Además `DataInitializer` crea `admin` y `support` al arrancar. | servicios de usuario | El evento "usuario creado" para RabbitMQ debe publicarse en ambos caminos. Lo más limpio: un `@PostPersist` en la entidad `User` o publicar desde los dos servicios. |
| 4 | El `docker-compose.yml` original fija la subred `172.20.0.0/16` y los puertos 3306/8080/3000. | `docker-compose.yml` | Choca con otras redes/servicios del PC (pasó en el PC de Mafe). En nuestros compose **no fijamos subredes** y usamos puertos propios. |
| 7 | El backend rechazaba (403) todo origen distinto de `localhost:3000/8080` por CORS fijo en el código. | `config/WebConfig.java` | ✅ **Corregido**: ahora lee `CORS_ALLOWED_ORIGINS` (patrones separados por coma). Habrá que poner ahí el dominio del proyecto. |
| 8 | `GET /api/auth/me` daba error 500 (proxy de Hibernate) y el router del frontend lo usa en cada navegación. | `entity/User.java` | ✅ **Corregido** con `@JsonIgnoreProperties`. |
| 9 | `package-lock.json` descargaba desde un espejo chino (`registry.npmmirror.com`) que corta la conexión. | `frontend/package-lock.json` | ✅ **Corregido**: apunta a `registry.npmjs.org`. |
| 5 | Backend: Spring Boot 2.7 / Java 17, Hibernate `ddl-auto=update` (crea las tablas solo). Frontend: Vue 3 + Nginx con proxy `/api/ → backend:8080`. | | Galera: todas las tablas tienen `PRIMARY KEY` autoincremental ✔ (Galera lo exige). Probar el driver MySQL contra MariaDB. |
| 6 | El usuario **no tiene campo de cliente/empresa** (solo `company`, texto libre). | `User.java` | El "a qué cliente pertenece" lo da la base de datos donde se creó (`tinycrm_a` o `tinycrm_b`) y viaja en el evento. |
| 10 | `DataInitializer` crea `admin` y `support` en **cada** base al arrancar. | `config/DataInitializer.java` | ✅ **Resuelto**: nombres configurables por variable (`TINY_ADMIN_USERNAME`…). Cliente A: `admin_a` / `support_a`; cliente B: `admin_b` / `support_b` (contraseñas `admin123` / `support123`). |
| 12 | `POST /api/users` (crear usuario desde el panel de admin) guardaba la contraseña **en texto plano**: ese usuario nunca podía iniciar sesión. | `controller/UserController.java` | ✅ **Corregido**: usa `AuthenticationService.registerUser`, que cifra la contraseña y valida duplicados. |
| 13 | En Galera, `CREATE TABLE/TRIGGER` bloquea la tabla en los 3 nodos y cancela escrituras en curso (salió un 500 al crear usuario mientras el publicador se reiniciaba). | `eventos/publicador` | ✅ **Corregido**: el publicador solo crea outbox y trigger si no existen y reintenta la conexión al broker sin reiniciarse. |
| 11 | TinyCRM escribe en la BD en **cada** petición (actualiza `lastAccessedAt` de la sesión). Con Galera multi-maestro podría haber conflictos de escritura. | `AuthenticationService.validateSession` | Probado: 40 peticiones en paralelo con la misma sesión → 40 OK, 0 conflictos. Vigilar si aparecen `Deadlock` en los logs. |

---

## 1. Fases (en orden de prioridad)

La rúbrica suma 110 pts. Primero lo que habilita todo lo demás.

### Fase 1 — TinyCRM funcionando (base de todo) · *responsable: App*
- [x] Levantar TinyCRM en Docker: login, `/me`, registro y dashboard funcionan (11-nov, PC Mafe).
- [x] Corregir `baseURL`, CORS, `/me` y `package-lock` (hallazgos 2, 7, 8, 9).
- [x] El backend toma la BD por variables de entorno (`SPRING_DATASOURCE_URL`, ya lo soporta).
- [x] Marcar cada instancia para **demostrar el balanceo**: el LB agrega las cabeceras `X-Cliente` y `X-Instancia` a cada respuesta.

### Fase 2 — Clúster de BD + apps de los 2 clientes · *responsables: BD + App*
- [x] **Un** clúster **MariaDB Galera 3 nodos** con arranque seguro (`bd/galera/galera-entrypoint.sh`). Probado: caída de un nodo, reingreso, reinicio del nodo 1 y apagado/encendido completo (11-nov).
- [x] Dos bases en el clúster: `tinycrm_a` y `tinycrm_b`, cada una con su usuario MySQL (`app_a`, `app_b`) con permisos **solo** sobre la suya. Probado: `app_a` no puede leer `tinycrm_b`.
- [x] **Un HAProxy BD** (`bd/haproxy/haproxy.cfg`: `roundrobin`, `mysql-check`, reintentos). Adminer en http://localhost:8090.
- [x] **2 backends + 2 frontends por cliente** (`apps/docker-compose.yml`, un solo archivo con `cliente-a.env` / `cliente-b.env`).
- [x] **HAProxy App A** (10.1.1.6, puerto 8101) y **HAProxy App B** (10.1.1.7, puerto 8102): `/api` → backends con sticky session (cookie `SERVERID`), resto → frontends; health checks.
- [x] Redes Docker `tiny_dmz` (10.1.1.0/24) y `tiny_interna` (10.1.2.0/24, sin Internet) con `scripts/redes.sh`. Mismo último número del diagrama.
- [x] Pruebas (12-nov): usuarios replicados en los 3 nodos; sticky (5/5 a la misma instancia); balanceo de visitantes nuevos app1/app2; `admin_a` no entra por el LB B; apagar 1 backend de A → A sigue **sin perder la sesión**; apagar los 2 → A da 503 y B sigue.

### Fase 3 — Eventos: broker + componente central · *responsable: Eventos*
- [x] **RabbitMQ** (10.1.1.20 DMZ / 10.1.2.20 interna): exchange `tiny.usuarios` (topic), cola durable `central.usuarios`. Panel http://localhost:15672.
- [x] **Evento desde la BD** (flecha Cluster DB → Broker): trigger `trg_usuario_creado` en `users` → tabla `outbox_usuarios` → **publicador** por cliente (`eventos/publicador`, usuario de BD `outbox_x` que solo ve su base) → RabbitMQ `{evento, cliente, username, email, idEnCliente, fecha}`. No toca el código de TinyCRM.
- [x] **BD Usuarios** (`eventos/`, 10.1.1.10): tabla `usuarios(username, email, cliente, id_en_cliente)`; usuario `middleware` solo lectura y `consumer` lectura/escritura.
- [x] **Consumer** (`eventos/consumer`, 10.1.1.21): consume la cola y guarda `usuario → cliente`. Si el username ya es de otro cliente lo ignora y avisa (CONFLICTO).
- [x] Resolver el choque de `admin`/`support` repetidos entre clientes (hallazgo 10).
- [x] Pruebas (12-nov): usuario creado por el admin de A/B entra por el middleware ~2 s después; username repetido en el otro cliente → conflicto, no roba el login; consumer caído → el evento espera en la cola; broker caído → TinyCRM sigue creando usuarios y los eventos esperan en el outbox hasta que vuelve.
- [x] Corregido en TinyCRM: el panel de admin guardaba la contraseña en texto plano y ese usuario no podía entrar (hallazgo 12).

### Fase 4 — Middleware de enrutamiento · *responsable: Entrada*
- [x] Middleware en Node.js (`entrada/middleware/servidor.js`, 10.1.1.5, puerto 80 de la máquina). Una sola entrada para los dos clientes (falta el dominio `www.tiny.com` → Fase 5).
- [x] En `POST /api/auth/login` lee el usuario (o email), consulta la BD Usuarios y reenvía al LB del cliente correcto.
- [x] Guarda una cookie firmada (HMAC) `tiny_cliente=A|B`, HttpOnly; las peticiones siguientes van al LB de ese cliente.
- [x] Aislamiento probado (12-nov): cookie alterada → 401; cookie de B con sesión de A → 401; usuario inexistente → rechazado sin revelar si existe.
- [x] Registro público bloqueado (403 con mensaje): los usuarios los crea el admin de cada cliente.
- [x] Pantalla de login con botones "Cliente A (admin_a)" y "Cliente B (admin_b)".

### Fase 5 — DNS, firewall y red · *responsable: Entrada*
- [x] bind9 (`entrada/dns`, 10.1.1.53): `www.tiny.com` y `tiny.com` → `IP_MAQUINA1` del `.env` (TTL 5 min); recursión con forwarders 8.8.8.8 solo para redes privadas. Probado con `dig` (respuesta autoritativa) y entrando por el dominio.
- [x] Firewall escrito (`scripts/firewall.sh`): UFW para la VM + cadena `DOCKER-USER` para los contenedores; desde fuera solo 80, 53 y 22.
- [ ] **Probar el firewall en la VM Ubuntu** (en Docker Desktop de Windows no aplica).
- [ ] VM de la Máquina #1 en adaptador puente con IP fija; Máquina #2 con el DNS apuntando a ella. Plan B: Tailscale.

### Fase 6 — Orquestación y sustentación · *todos*
- [x] `scripts/levantar.sh` / `apagar.sh` / `estado.sh`. Probado (12-nov): apagar todo (22 s) y levantar todo (136 s, 22 contenedores sanos); los datos y los logins sobreviven.
- [x] `docs/SUSTENTACION.md` con los comandos listos para copiar y pegar (lo pidió el profe).
- [ ] Diagrama final de la arquitectura implementada.

---

## 2. Reparto (4 integrantes)

| Rol | Fases | Puntos |
|---|---|---|
| **BD** | Galera 3 nodos ×2, HAProxy BD, replicación | 15 |
| **App** | TinyCRM, 2 instancias, HAProxy App, tolerancia a fallos | 10 + 15 + 15 |
| **Eventos** | RabbitMQ, cambio en TinyCRM, componente central | 10 + 10 |
| **Entrada** | Middleware, DNS, firewall, redes, orquestación | 15 + 10 + 10 |

**Eventos** y **Entrada** deben acordar desde el día 1 el formato del evento y del `GET /usuarios/{username}`.

---

## 3. Preguntas para el profe

Ver `docs/PREGUNTAS_PROFE.md`.

## 4. Cosas por investigar

| Tema | Para qué | Quién |
|---|---|---|
| Spring Session JDBC (Spring Boot 2.7) | Que la sesión sobreviva a la caída de un backend sin re-login | App |
| MariaDB Galera en Docker (imagen `mariadb:11`, `wsrep_*`, bootstrap, `safe_to_bootstrap`) | Clúster que reinicie sin romperse | BD |
| HAProxy: `cookie ... insert indirect nocache`, `option httpchk`, `option mysql-check` | Sticky + health checks | App / BD |
| RabbitMQ con Spring AMQP (`spring-boot-starter-amqp`) | Publicar el evento desde TinyCRM | Eventos |
| Qué tecnología para middleware y central (recomendado: Nginx/OpenResty+Lua, o un servicio pequeño en Python/FastAPI o Node) | Middleware y central | Entrada / Eventos |
| bind9 en Docker y conflicto con `systemd-resolved` (puerto 53) | DNS | Entrada |
| UFW + Docker (`DOCKER-USER`) | Firewall que sí bloquee | Entrada |
| Galera entre 2 PCs vs. por PC | Decidir si la BD de un cliente puede tener nodos en ambos PCs | BD |
