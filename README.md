# Proyecto Final — TinyCRM multi-cliente (Sistemas Distribuidos 2026-2, CECAR)

Pepito Plus despliega TinyCRM para la empresa ACME como plataforma distribuida que atiende a **dos clientes aislados**.
Arquitectura: [docs/arquitectura/ARQUITECTURA.md](docs/arquitectura/ARQUITECTURA.md).

## Estructura

| Carpeta | Contenido | Estado |
|---|---|---|
| `tinycrm/` | Código de TinyCRM ([spkdroid/TinyCRM](https://github.com/spkdroid/TinyCRM), Apache-2.0) con nuestras correcciones | ✅ funciona |
| `bd/` | Red interna: clúster MariaDB Galera (3 nodos), Load Balancer BD (HAProxy) y Adminer | ✅ funciona |
| `apps/` | Por cliente: 2 instancias de TinyCRM (backend + frontend) + Load Balancer del cliente con sticky session | ✅ funciona |
| `entrada/` | Middleware de enrutamiento por cliente (✅ funciona), DNS y firewall (pendiente) | 🟡 |
| `eventos/` | BD Usuarios (✅ funciona), Broker y Consumer (pendiente) | 🟡 |
| `scripts/` | Crear redes, levantar y apagar todo | en progreso |
| `docs/` | Plan, arquitectura, preguntas al profe, instalación, guía de sustentación | — |

## Levantar lo que hay

```bash
cp .env.example .env          # solo la primera vez
bash scripts/redes.sh
docker compose --env-file .env -f bd/docker-compose.yml up -d --build --wait --wait-timeout 600
docker compose --env-file .env --env-file apps/cliente-a.env -f apps/docker-compose.yml -p tiny-a up -d --build --wait --wait-timeout 600
docker compose --env-file .env --env-file apps/cliente-b.env -f apps/docker-compose.yml -p tiny-b up -d --wait --wait-timeout 600
docker compose --env-file .env -f eventos/docker-compose.yml up -d --wait
docker compose --env-file .env -f entrada/docker-compose.yml up -d --build --wait
bash scripts/sincronizar-usuarios-manual.sh   # temporal, hasta tener Broker + Consumer
# Abrir http://localhost  (admin_a / admin123  o  admin_b / admin123)
```

## Documentos

- [Plan de trabajo](docs/PLAN.md)
- [Arquitectura](docs/arquitectura/ARQUITECTURA.md)
- [Preguntas para el profe](docs/PREGUNTAS_PROFE.md)
- [Qué instalar en cada PC](docs/INSTALACION.md)
- [Guía de sustentación (comandos)](docs/SUSTENTACION.md)
