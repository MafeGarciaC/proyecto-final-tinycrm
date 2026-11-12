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

**PC María Isabel:** debe tener **50 GB libres en total** antes de crear la VM. Hoy tiene ~32 GB libres, así que hay que desocupar **unos 20 GB más**. (40 GB para la VM + ~10 GB de margen para que Windows no se quede sin espacio.)

### La VM Ubuntu (una en cada PC)
| | PC Mafe | PC María Isabel |
|---|---|---|
| Nombre | `acme-central` | `acme-clienteb` |
| RAM | 9 GB | 7 GB |
| CPU | 6 | 4 |
| Disco | 60 GB | 40 GB |
| Red | **Adaptador puente** + IP fija | **Adaptador puente** + IP fija |

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
