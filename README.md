# Agromag — Control de Ventas

Astro (SSR, adaptador Node) + SQLite integrado de Node (`node:sqlite`). Requiere **Node 22.13+** (en la VPS se instala el 24).

## Probar en su PC (Windows / PowerShell)

```powershell
$env:ADMIN_PIN="su-pin"; npm run dev
```

Abra http://localhost:4321 para registrar ventas (sin clave). El panel del dueño está en `/admin` y pide el PIN.
Pruebas: `npm run build && npm test`.

---

# Despliegue en la VPS (varios proyectos con pm2)

## Cómo queda organizada la VPS

```
/opt/apps/<proyecto>/    código de cada proyecto (git clone), con su .env
/opt/data/<proyecto>/    base de datos y archivos subidos (NO se borra al actualizar)
/opt/backups/<proyecto>/ copias de seguridad
```

Todos los proyectos los administra **pm2** con el usuario `deploy`. nginx recibe el tráfico y lo reparte por dominio.
Cada proyecto necesita **su propio subdominio y su propio puerto interno**. Anote aquí los puertos para no repetirlos:

| Proyecto        | Subdominio                | Puerto | Carpeta                    |
|-----------------|---------------------------|--------|----------------------------|
| agromag-ventas  | `agromag.duckdns.org`     | 4321   | `/opt/apps/agromag-ventas` |
| (siguiente)     |                           | 4322   |                            |

## 1. DuckDNS (una vez por proyecto)

1. Entre a https://www.duckdns.org y cree un subdominio por proyecto (por ejemplo `agromag`).
2. En "current ip" ponga la **IP pública de la VPS** y presione *update ip*. La IP es fija, no hace falta ningún actualizador.
3. Compruebe que ya apunta: `nslookup agromag.duckdns.org` debe mostrar la IP de la VPS.

Cuenta gratis: hasta 5 subdominios. Si necesita más, otra cuenta o un dominio propio.

## 2. Preparar la VPS limpia (una sola vez, como root)

```bash
# desde su PC: copie la carpeta vps/ a la VPS
scp -r vps root@IP_DE_LA_VPS:/root/
ssh root@IP_DE_LA_VPS
bash /root/vps/setup.sh
```

Instala Node 24, pm2, nginx, certbot y el firewall (solo SSH, HTTP y HTTPS), crea el usuario `deploy`
y deja pm2 configurado para arrancar solo si se reinicia la VPS.

## 3. Subir este proyecto (como `deploy`)

El código viaja por git. Cree un repositorio privado (GitHub o similar) y suba el proyecto. El `.env`, `node_modules` y `data/` ya están excluidos.

```bash
ssh deploy@IP_DE_LA_VPS
git clone <url-del-repo> /opt/apps/agromag-ventas
cd /opt/apps/agromag-ventas

cp .env.example .env && chmod 600 .env
nano .env        # ponga su ADMIN_PIN; el resto ya viene listo
mkdir -p /opt/data/agromag-ventas

bash deploy.sh   # instala, compila y arranca con pm2
```

Si el repositorio es privado, la VPS necesita una llave de acceso: `ssh-keygen` como `deploy`, y agregue `~/.ssh/id_ed25519.pub` como *deploy key* en el repositorio.

## 4. Publicar con HTTPS (como root)

```bash
bash /root/vps/nuevo-sitio.sh agromag.duckdns.org 4321 su-correo@ejemplo.com
```

Crea la configuración de nginx para ese dominio y pide el certificado gratis (Let's Encrypt, se renueva solo).
Abra https://agromag.duckdns.org y listo.

## Subir otro proyecto después

1. Cree su subdominio en DuckDNS (paso 1).
2. Clónelo en `/opt/apps/<nombre>` y déle un puerto libre (4322, 4323…) en su `.env`.
3. En su proyecto, copie `ecosystem.config.cjs` y `deploy.sh` y cambie el `name` por uno propio (no se pueden repetir en pm2).
4. `bash deploy.sh` como `deploy`, y `bash nuevo-sitio.sh <dominio> <puerto> <correo>` como root.

El paso 2 de preparar la VPS **no se repite**. Todos los proyectos comparten el mismo nginx y el mismo pm2.

## Día a día

| Qué                              | Comando (como `deploy`)                              |
|----------------------------------|------------------------------------------------------|
| Actualizar este proyecto         | `cd /opt/apps/agromag-ventas && bash deploy.sh`      |
| Ver todos los proyectos          | `pm2 status`                                         |
| Ver el log de uno                | `pm2 logs agromag-ventas`                            |
| Reiniciar uno                    | `pm2 restart agromag-ventas`                         |
| Respaldo manual                  | `bash backup.sh` (guarda 30 días en `/opt/backups`)  |

**Respaldo automático diario** (a las 2 a. m.): `crontab -e` y agregue

```
0 2 * * * cd /opt/apps/agromag-ventas && bash backup.sh >> /opt/backups/agromag-ventas.log 2>&1
```

Descargue copias a su computadora de vez en cuando: una copia en la misma VPS no protege si la VPS se daña.

## Código del local (acceso de los empleados)

La página de registrar venta, el historial y los comprobantes piden un **código del local**. Los empleados lo escriben **una sola vez en cada celular o computador** (queda autorizado 90 días).

- El dueño ve y cambia el código en el panel, en la sección **Empleados → Código del local**. Al cambiarlo, todos los aparatos deben escribir el nuevo (útil si un empleado se va).
- El código se crea solo la primera vez que alguien lo necesita. **Después de actualizar, entre al panel para verlo** y compártalo con el equipo.
- Cuando el dueño abre "Registrar venta" desde el panel, ese aparato queda autorizado sin pedirle el código.
- Tanto el código como el PIN del dueño se bloquean 10 minutos después de 10 intentos fallidos desde la misma dirección.

## Variables (`.env`)

| Variable        | Para qué                                                          |
|-----------------|-------------------------------------------------------------------|
| `ADMIN_PIN`     | PIN del panel del dueño. Obligatoria (mínimo 4 caracteres).       |
| `SITE_DOMAIN`   | Dominio del sitio. Se usa al compilar; **sin él los formularios dan error 403 detrás de nginx**. |
| `DATA_DIR`      | Carpeta con `ventas.db` y `facturas/`.                            |
| `PORT` / `HOST` | Puerto interno y `127.0.0.1` (solo nginx puede entrar).           |
| `COOKIE_SECURE` | `1` porque el sitio usa HTTPS.                                    |
| `TZ`            | Zona horaria de las fechas (por defecto `America/Costa_Rica`).    |

Si cambia el dominio o el PIN, edite `.env` y corra `bash deploy.sh` otra vez.
