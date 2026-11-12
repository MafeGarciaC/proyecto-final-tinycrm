# Qué instalar en cada PC

## Los 2 PCs del montaje (Mafe y María Isabel)

### En Windows
| Programa | Para qué | Nota |
|---|---|---|
| **Virtualización activada en la BIOS** | Poder correr VMs | Mafe (AMD): opción **SVM**. María Isabel (Intel): opción **VT-x / Intel Virtualization Technology**. Se comprueba en Administrador de tareas → Rendimiento → CPU → "Virtualización: Habilitado". |
| **VirtualBox 7.x** | La VM Ubuntu donde corre todo | virtualbox.org |
| **ISO Ubuntu Server 24.04 LTS** | Sistema de la VM | ubuntu.com/download/server (~2.6 GB). Server, sin escritorio, para ahorrar RAM. |
| **Git** | Bajar y subir el código | git-scm.com |
| **VS Code** + extensión **Remote - SSH** | Editar los archivos de la VM desde Windows | code.visualstudio.com |
| **Docker Desktop** *(opcional)* | Probar contenedores en Windows antes de pasarlos a la VM | Ya está en el PC de Mafe. |

### Qué corre en cada PC (según el diagrama del profe)
| | PC Mafe = **Máquina #1** | PC María Isabel = **Máquina #2** |
|---|---|---|
| Qué hace | Todos los servidores (VM Ubuntu) | Hace de usuario: navegador con el DNS apuntando a la Máquina #1 |
| VM | `acme-maquina1`: **8 GB RAM, 6 CPU, 60 GB disco**, adaptador puente | No necesita. Opcional: VM cliente de 2 GB RAM / 15 GB disco |
| Disco | Le sobra (~237 GB libres) | Con los ~32 GB libres alcanza |

Todo el sistema medido usa ~2,5 GB de RAM; 8 GB dejan margen para compilar. **Paso a paso de la VM: [GUIA_VM.md](GUIA_VM.md).**

Dentro de la VM:
```bash
sudo apt update && sudo apt install -y git curl net-tools dnsutils mariadb-client openssh-server
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # cerrar sesión y volver a entrar
docker compose version          # debe responder
```
- `net-tools` → `netstat -tulpn` y `ifconfig` (los usa el profe en clase).
- `dnsutils` → `nslookup` y `dig` para demostrar el DNS.
- `mariadb-client` → consultar cada nodo Galera desde la terminal.
- `openssh-server` → conectarse con VS Code Remote-SSH.
- **Plan B de red:** [Tailscale](https://tailscale.com) en las dos VMs, si los PCs no pueden estar en la misma red el día de la sustentación.

## Los otros 2 integrantes (desarrollo)
| Programa | Para qué |
|---|---|
| **Git** + cuenta de **GitHub** con acceso al repo | Trabajar en su parte y subirla |
| **VS Code** | Editor |
| **Docker Desktop** (si el PC tiene 8 GB de RAM o más) | Probar su componente solo (middleware, central, RabbitMQ) |

No necesitan Java, Node ni Maven/Gradle: TinyCRM se compila dentro de Docker. Solo instalar Python o Node si van a programar el middleware o el componente central en ese lenguaje y quieren correrlo sin Docker.

## Todos
- Cuenta de GitHub y acceso al repositorio del proyecto.
- Los mismos archivos `.env` de cada cliente (se comparten por el repo; no tienen datos reales).
