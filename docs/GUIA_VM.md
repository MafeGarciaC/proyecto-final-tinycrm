# Guía: montar la Máquina #1 (VM Ubuntu) paso a paso

Tiempo total: ~1 hora (la mitad es esperar descargas e instalación).
PC: el de Mafe (Ryzen 7 5700U, 16 GB RAM, VirtualBox 7.2 ya instalado).

---

## Paso 0 — Liberar memoria en Windows

La VM y Docker Desktop **no deben estar prendidos a la vez** (Docker Desktop se reserva ~8 GB).

1. Si el proyecto está corriendo en Docker Desktop, apagarlo (los datos no importan, la VM empieza de cero):
   ```bash
   bash scripts/apagar.sh
   ```
2. Cerrar Docker Desktop: clic derecho en la ballena (junto al reloj) → **Quit Docker Desktop**.
3. En PowerShell, apagar el subsistema Linux que usa Docker Desktop:
   ```powershell
   wsl --shutdown
   ```
4. Comprobar en el Administrador de tareas → Rendimiento → Memoria: deben quedar **~10 GB libres**.

---

## Paso 1 — Descargar Ubuntu Server

https://ubuntu.com/download/server → **Ubuntu Server 24.04 LTS** → *Download* (~3 GB, archivo `ubuntu-24.04.x-live-server-amd64.iso`).

---

## Paso 2 — Crear la VM en VirtualBox

**Máquina → Nueva:**

| Campo | Valor |
|---|---|
| Nombre | `acme-maquina1` |
| Imagen ISO | la ISO descargada |
| **Omitir instalación desatendida** | ✅ marcar (*Skip Unattended Installation*) |
| Memoria base | **8192 MB** |
| Procesadores | **6** |
| Disco duro | crear nuevo, **60 GB**, reservado dinámicamente (ocupa solo lo que usa) |

Antes de arrancarla: **Configuración → Red → Adaptador 1**:
- Conectado a: **Adaptador puente**
- Nombre: la tarjeta **Wi-Fi** (o Ethernet si está por cable)

> Adaptador puente = la VM aparece en la red de la casa como un equipo más, con su propia IP. Así la Máquina #2 la puede ver.

---

## Paso 3 — Instalar Ubuntu Server

Iniciar la VM y seguir el instalador (se maneja con flechas, Tab y Enter):

| Pantalla | Qué elegir |
|---|---|
| Language | English (o Español) |
| Keyboard | Spanish — *Latin American* (o el que tenga el PC) |
| Type of install | **Ubuntu Server** (no la "minimized") |
| Network | dejar DHCP; **anotar la IP** que aparece (ej. `192.168.101.57`) |
| Proxy / Mirror | dejar como está, Done |
| Storage | **Use an entire disk** → Done → Continue |
| Profile | nombre: el de cada una · server name: `acme-maquina1` · usuario: `mafe` (o el que quieran) · contraseña |
| Ubuntu Pro | **Skip for now** |
| SSH | ✅ **Install OpenSSH server** |
| Featured snaps | **no marcar nada** (en especial NO el docker de snap) |

Al terminar: **Reboot now**. Si pide quitar el medio de instalación, Enter.

---

## Paso 4 — Conectarse a la VM desde Windows

En la consola de la VM iniciar sesión y ver la IP:
```bash
ip -4 addr show | grep inet
```
Desde **Windows** (PowerShell o la terminal de VS Code) es más cómodo trabajar por SSH, porque se puede copiar y pegar:
```powershell
ssh mafe@192.168.101.57
```
(con la IP de la VM). También se puede usar **VS Code → Remote-SSH → Connect to Host**.

---

## Paso 5 — Instalar Docker y herramientas (dentro de la VM)

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl net-tools dnsutils mariadb-client gh
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit
```
Volver a entrar por SSH (para que tome el grupo `docker`) y comprobar:
```bash
docker run --rm hello-world
docker compose version
```

---

## Paso 6 — Liberar el puerto 53 para nuestro DNS

Ubuntu trae `systemd-resolved` escuchando en el puerto 53 (el mismo problema que tuvo el profe en clase).
Se le apaga solo esa parte y la VM sigue resolviendo nombres normal:
```bash
sudo sed -i 's/^#\?DNSStubListener=.*/DNSStubListener=no/' /etc/systemd/resolved.conf
sudo ln -sf /run/systemd/resolve/resolv.conf /etc/resolv.conf
sudo systemctl restart systemd-resolved
sudo ss -tulpn | grep ':53 '      # no debe salir nada
ping -c 2 google.com              # la VM sigue teniendo Internet
```

---

## Paso 7 — Bajar el proyecto (repositorio privado)

```bash
gh auth login
```
Responder: **GitHub.com** → **HTTPS** → **Yes** (autenticar git) → **Login with a web browser**.
Muestra un código de 8 letras: abrir https://github.com/login/device **en Windows**, iniciar sesión con la cuenta de GitHub y escribir el código.

```bash
gh repo clone MafeGarciaC/proyecto-final-tinycrm
cd proyecto-final-tinycrm
git config user.name "Maria Fernanda Garcia"
git config user.email "mariagarciaconde55@gmail.com"
```

---

## Paso 8 — Configurar y levantar

```bash
cp .env.example .env
nano .env
```
Cambiar solo estas dos líneas (guardar con Ctrl+O, Enter, salir con Ctrl+X):
```
IP_MAQUINA1=192.168.101.57    <- la IP de la VM (paso 4)
DNS_PORT=53
```
Levantar todo (la primera vez compila TinyCRM y descarga imágenes: **10–20 min**):
```bash
bash scripts/levantar.sh
```
Al final debe mostrar los 22 contenedores sanos, el clúster con tamaño 3 y el middleware `ok`.

---

## Paso 9 — Probar desde Windows (hace de Máquina #2)

- Navegador: `http://192.168.101.57` → login con `admin_a` / `admin123` y luego `admin_b` / `admin123`.
- DNS (PowerShell):
  ```powershell
  nslookup www.tiny.com 192.168.101.57
  ```
  Debe responder con la IP de la VM.

---

## Paso 10 — Firewall

```bash
sudo bash scripts/firewall.sh
```
Probar desde Windows:
| Prueba | Esperado |
|---|---|
| `http://192.168.101.57` | ✅ abre TinyCRM |
| `nslookup www.tiny.com 192.168.101.57` | ✅ responde |
| `ssh mafe@192.168.101.57` | ✅ conecta |
| `http://192.168.101.57:15672` (RabbitMQ) | ❌ no carga |
| `http://192.168.101.57:8090` (Adminer) | ❌ no carga |

Desde la propia VM los paneles siguen abiertos: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:15672` → 200.

> Las reglas de `DOCKER-USER` se borran al reiniciar la VM: después de cada reinicio, `bash scripts/levantar.sh` y luego `sudo bash scripts/firewall.sh`.

---

## Paso 11 — Guardar una instantánea

Con todo funcionando, en VirtualBox: **Máquina → Tomar instantánea** → nombre `todo-funcionando`.
Si algo se daña antes de la sustentación, se vuelve a ese punto en un minuto.

---

## Paso 12 — Máquina #2 (PC de María Isabel)

1. Conectarse a la **misma red** (Wi-Fi) que el PC de Mafe.
2. Comprobar que ve la VM: `ping 192.168.101.57`.
3. Configuración de red → Wi-Fi → Propiedades → Asignación de servidor DNS → **Manual** → IPv4 → DNS preferido: `192.168.101.57`.
4. Abrir http://www.tiny.com → entrar con `admin_a` o `admin_b`.
5. Al terminar, volver el DNS a **Automático (DHCP)** (si no, sin la VM prendida no tendrá Internet).

---

## Problemas comunes

| Problema | Solución |
|---|---|
| La VM no arranca: "VT-x/AMD-V not available" | Activar **SVM** en la BIOS del PC |
| VirtualBox muestra una tortuga verde y va lento | Windows tiene Hyper-V activo (lo usa Docker Desktop/WSL). Funciona igual, solo más lento. Para quitarlo: PowerShell como admin `bcdedit /set hypervisorlaunchtype off` y reiniciar (Docker Desktop dejará de funcionar hasta revertirlo con `auto`) |
| La VM no recibe IP con adaptador puente por Wi-Fi | Probar con cable, o con el hotspot del celular |
| Cambió la IP de la VM | Editar `IP_MAQUINA1` en `.env` y `docker compose --env-file .env -f entrada/docker-compose.yml up -d dns` |
| Un contenedor no levanta | `bash scripts/estado.sh` y `docker logs <nombre>` |
