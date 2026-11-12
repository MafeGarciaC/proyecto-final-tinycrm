# Arquitectura oficial del profe (leída del `.drawio`)

Archivo original: [`arquitectura-profe.drawio`](arquitectura-profe.drawio) (se abre en app.diagrams.net).

```
        MÁQUINA #2                    │                         MÁQUINA #1
   Red Externa (con Internet)         │   Red DMZ (con Internet)  192.168.1.x        │  Red Interna  192.168.2.x
                                      │                                               │
 Actor ── "www.tiny.com Cliente A" ─► DNS 192.168.0.1  (responde: 192.168.0.1)        │
 Actor ── "www.tiny.com Cliente B" ─► Firewall 192.168.0.1 / 192.168.1.1              │
                                      │      │                                        │
                                      │      ▼                                        │
                                      │  Middleware 192.168.1.5 ──► BD "Usuarios"     │
                                      │      │                         ▲              │
                                      │      │                     Consumer ◄── Broker de mensajería ◄─┐
                                      │      ├─► LB Cliente A 192.168.1.6 ─► App A (2 Docker) 1.3/2.3 ─┐  │
                                      │      └─► LB Cliente B 192.168.1.7 ─► App B (2 Docker) 1.4/2.4 ─┤  │
                                      │                                               │  LB BD 192.168.2.1
                                      │                                               │      ▼
                                      │                                               │  Cluster DB 192.168.2.X ┘
```

## Qué dice el diagrama, pieza por pieza

| Componente | IP en el diagrama | Red | Rúbrica |
|---|---|---|---|
| Actores (usuarios de A y de B) | — | Externa (Máquina #2) | — |
| **DNS**: `www.tiny.com` → 192.168.0.1 (el firewall) | 192.168.0.1 | Externa | — |
| **Firewall** (dos patas: externa y DMZ) | 192.168.0.1 / 192.168.1.1 | Externa + DMZ | — |
| **Middleware** | 192.168.1.5 | DMZ | Middleware y enrutamiento (15) |
| **BD "Usuarios"** (la consulta el middleware) | — | DMZ | = el **componente central** |
| **Consumer** (escribe en BD Usuarios) | — | DMZ | Sincronización (10) |
| **Broker de mensajería** (entre DMZ e interna) | — | DMZ/Interna | Broker (10) |
| **Load Balancer Cliente A** | 192.168.1.6 | DMZ | LB por cliente (10) |
| **Load Balancer Cliente B** | 192.168.1.7 | DMZ | LB por cliente |
| **Cluster App Cliente A** (2 contenedores) | 192.168.1.3 / 192.168.2.3 | DMZ + Interna | Clúster app (15) |
| **Cluster App Cliente B** (2 contenedores) | 192.168.1.4 / 192.168.2.4 | DMZ + Interna | Clúster app |
| **Load Balancer BD** (uno solo, lo usan A y B) | 192.168.2.1 | Interna | Clúster BD (15) |
| **Cluster DB** (uno solo) | 192.168.2.X | Interna | Clúster BD |

Notas:
- Los cuadros de las apps dicen "SuiteCRM": es un diagrama reutilizado de otro semestre. En nuestro caso es **TinyCRM**.
- La flecha del broker sale del **Cluster DB**: el evento "usuario creado" nace en la base de datos y va al broker → Consumer → BD Usuarios.

## Lo que cambia respecto a nuestro plan anterior

1. **Un solo clúster de BD (3 nodos) y un solo LB BD** para los dos clientes, no uno por cliente. El aislamiento se hace con **una base de datos por cliente** dentro del clúster (`tinycrm_a`, `tinycrm_b`), cada una con su propio usuario MySQL que solo tiene permisos sobre la suya.
2. **El componente central es la BD "Usuarios" + el Consumer**: guarda `usuario → cliente`. El middleware la consulta para saber a qué LB mandar a cada usuario.
3. **Las 2 máquinas no son "un cliente por PC"**: la Máquina #1 tiene **todos los servidores**, y la Máquina #2 es el lado de los **usuarios** (navegadores, red externa). Ver "Hardware" abajo.
4. **Mismo dominio para los dos clientes** (`www.tiny.com`). El middleware distingue al cliente por el **usuario que inicia sesión**, no por la URL.

## Cómo funciona el enrutamiento (nuestra propuesta)

1. El usuario abre `www.tiny.com` → DNS responde la IP del firewall → firewall deja pasar 80/443 al middleware.
2. La pantalla de login de TinyCRM es igual para todos (es el mismo frontend).
3. Al hacer `POST /api/auth/login`, el middleware lee el `username`, busca en la BD Usuarios a qué cliente pertenece y reenvía la petición al **LB de ese cliente**. Si el usuario no existe, responde error.
4. El middleware guarda una cookie `cliente=A` (firmada) y todas las peticiones siguientes van al LB de A. El LB A además mantiene la sticky session hacia una de las 2 instancias de A.
5. Un usuario de A nunca llega al LB de B ni a la BD `tinycrm_b` → **aislamiento**.

## Cómo funciona la sincronización (opciones)

El diagrama pone la flecha **Cluster DB → Broker**. Formas de lograrlo:

| Opción | Cómo | Pros | Contras |
|---|---|---|---|
| **A. Outbox + trigger** (recomendada) | Trigger `AFTER INSERT ON users` escribe en una tabla `outbox_usuarios`; un pequeño publicador lee esa tabla y publica en RabbitMQ | Coincide con la flecha del diagrama, no toca el código de TinyCRM, ligero | Hay que programar el publicador |
| B. CDC con Debezium | Debezium lee el binlog de MariaDB y publica cada cambio | Es "la forma de la industria" | Pesado en RAM, más complejo |
| C. TinyCRM publica | Modificar el backend Java para publicar al crear usuario | Simple de entender | No coincide con la flecha; hay que tocar 2 sitios del código |

## Hardware según el diagrama

| | Máquina #1 = **PC Mafe** | Máquina #2 = **PC María Isabel** |
|---|---|---|
| Qué corre | VM Ubuntu con **todo**: DNS, firewall, middleware, BD Usuarios, consumer, broker, LB A, LB B, 2 apps A, 2 apps B, LB BD, Galera 3 nodos | Los **usuarios**: navegador (o una VM cliente liviana) con el DNS apuntando a la Máquina #1 |
| VM | 10 GB RAM, 6 vCPU, 60 GB disco | Opcional: VM cliente 2 GB RAM, 15 GB disco |
| RAM estimada | ~6–7 GB (un solo clúster de BD en vez de dos) | — |

PC Mafe porque tiene 259 GB libres y 8 núcleos. **María Isabel ya no necesita liberar 20 GB**: con los 32 GB que tiene alcanza para una VM cliente.

## ⚠️ Choque de IPs

El diagrama usa `192.168.1.x` para la DMZ, pero **la red de la casa de Mafe también es `192.168.1.x`** (su PC tiene 192.168.1.2). Si las redes Docker usan esa subred, la VM no podrá hablar con el resto de la casa. Propuesta: mantener **el mismo último número** del diagrama y cambiar el prefijo (ej. DMZ `10.1.1.0/24`, interna `10.1.2.0/24`), explicándolo en la sustentación. Confirmar con el profe.
