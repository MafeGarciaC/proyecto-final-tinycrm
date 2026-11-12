# Proyecto Final — TinyCRM multi-cliente (Sistemas Distribuidos 2026-2, CECAR)

Pepito Plus despliega TinyCRM para la empresa ACME como plataforma distribuida que atiende a **dos clientes aislados**.
Arquitectura: [docs/arquitectura/ARQUITECTURA.md](docs/arquitectura/ARQUITECTURA.md).

## Estructura

| Carpeta | Contenido | Estado |
|---|---|---|
| `tinycrm/` | Código de TinyCRM ([spkdroid/TinyCRM](https://github.com/spkdroid/TinyCRM), Apache-2.0) con nuestras correcciones | ✅ funciona |
| `bd/` | Red interna: clúster MariaDB Galera (3 nodos), Load Balancer BD (HAProxy) y Adminer | ✅ funciona |
| `apps/` | Por cliente: 2 instancias de TinyCRM (backend + frontend) + Load Balancer del cliente con sticky session | ✅ funciona |
| `entrada/` | Middleware de enrutamiento por cliente y DNS (bind9, `www.tiny.com`) | ✅ funciona |
| `eventos/` | Sincronización de usuarios: trigger + outbox en la BD de cada cliente → publicadores → RabbitMQ → consumer → BD Usuarios | ✅ funciona |
| `scripts/` | Levantar, apagar y ver el estado de todo; redes; firewall de la VM | ✅ (firewall: probar en la VM) |
| `docs/` | Plan, arquitectura, preguntas al profe, instalación, guía de sustentación | — |

## Levantar todo

```bash
cp .env.example .env          # solo la primera vez; revisar IP_MAQUINA1 y DNS_PORT
bash scripts/levantar.sh      # ~2-3 min; con --build si cambió el código
# Abrir http://localhost  (admin_a / admin123  o  admin_b / admin123)
```

| Script | Para qué |
|---|---|
| `bash scripts/levantar.sh [--build]` | Levanta todo en orden: redes → BD → cliente A → cliente B → broker → middleware + DNS |
| `bash scripts/apagar.sh` | Apaga todo en orden inverso. **No borra datos** |
| `bash scripts/estado.sh` | Resumen: contenedores, clúster Galera, middleware, broker y direcciones |
| `sudo bash scripts/firewall.sh` | Solo en la VM Ubuntu: deja entrar únicamente 80 (TinyCRM), 53 (DNS) y 22 (SSH) |

## Documentos

- [Plan de trabajo](docs/PLAN.md)
- [Arquitectura](docs/arquitectura/ARQUITECTURA.md)
- [Preguntas para el profe](docs/PREGUNTAS_PROFE.md)
- [Qué instalar en cada PC](docs/INSTALACION.md)
- [Guía de sustentación (comandos)](docs/SUSTENTACION.md)
