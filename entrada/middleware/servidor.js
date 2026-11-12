// Middleware de enrutamiento por cliente (diagrama: Middleware 192.168.1.5 -> aquí 10.1.1.5).
//
// Los dos clientes entran por la misma dirección (www.tiny.com). El middleware decide a qué
// Load Balancer enviar cada petición:
//   1. Login (POST /api/auth/login): lee el usuario, lo busca en la BD "Usuarios" y lo envía al
//      LB de su cliente. Si el login sale bien, guarda en el navegador una cookie firmada con el cliente.
//   2. Resto de /api/*: usa la cookie para enviar al LB del cliente. Sin cookie -> 401 (a iniciar sesión).
//   3. Archivos del frontend (no /api): son iguales para A y B; se sirven desde el LB del cliente
//      de la cookie, o desde cualquiera que esté vivo si todavía no ha iniciado sesión.
//   4. Registro público (POST /api/auth/register): bloqueado. Los usuarios los crea el admin de cada cliente.

const http = require('http');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const PUERTO = 8080;
const SECRETO = process.env.MIDDLEWARE_SECRETO;
const COOKIE = 'tiny_cliente';

// Load Balancer de cada cliente
const CLIENTES = {
  A: { host: process.env.LB_A_HOST, port: Number(process.env.LB_A_PORT || 80) },
  B: { host: process.env.LB_B_HOST, port: Number(process.env.LB_B_PORT || 80) },
};

const bd = mysql.createPool({
  host: process.env.USUARIOS_DB_HOST,
  user: process.env.USUARIOS_DB_USER,
  password: process.env.USUARIOS_DB_PASSWORD,
  database: 'usuarios',
  connectionLimit: 5,
  enableKeepAlive: true,
});

function log(...partes) {
  console.log(new Date().toISOString(), ...partes);
}

// ---------- Cookie firmada: "A.<firma>" ----------
// La firma (HMAC) impide que alguien cambie la cookie a mano de A a B.
function firmar(cliente) {
  return crypto.createHmac('sha256', SECRETO).update(cliente).digest('hex').slice(0, 32);
}

function clienteDeCookie(req) {
  const cookies = req.headers.cookie || '';
  const m = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([AB])\\.([0-9a-f]{32})`));
  if (!m) return null;
  const [, cliente, firma] = m;
  const esperada = firmar(cliente);
  return crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada)) ? cliente : null;
}

function cookieCliente(cliente) {
  return `${COOKIE}=${cliente}.${firmar(cliente)}; Path=/; HttpOnly; SameSite=Lax`;
}

const COOKIE_BORRAR = `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

// ---------- Utilidades HTTP ----------
function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    req.on('data', (p) => partes.push(p));
    req.on('end', () => resolve(Buffer.concat(partes)));
    req.on('error', reject);
  });
}

function responderJson(res, estado, datos, extraCabeceras = {}) {
  const cuerpo = JSON.stringify(datos);
  res.writeHead(estado, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(cuerpo),
    'X-Middleware': 'tiny',
    ...extraCabeceras,
  });
  res.end(cuerpo);
}

// Reenvía la petición al LB del cliente. `alResponder` permite agregar cookies según la respuesta.
function reenviar(req, res, cliente, cuerpo, alResponder) {
  const destino = CLIENTES[cliente];
  return new Promise((resolve) => {
    const ipUsuario = req.socket.remoteAddress;
    const peticion = http.request(
      {
        host: destino.host,
        port: destino.port,
        method: req.method,
        path: req.url,
        headers: {
          ...req.headers,
          'x-forwarded-for': req.headers['x-forwarded-for']
            ? `${req.headers['x-forwarded-for']}, ${ipUsuario}`
            : ipUsuario,
          'x-forwarded-host': req.headers.host || '',
        },
        timeout: 60000,
      },
      (respuesta) => {
        const cabeceras = { ...respuesta.headers, 'x-middleware-cliente': cliente };
        const extra = alResponder ? alResponder(respuesta.statusCode) : null;
        if (extra) {
          cabeceras['set-cookie'] = [...(respuesta.headers['set-cookie'] || []), extra];
        }
        res.writeHead(respuesta.statusCode, cabeceras);
        respuesta.pipe(res);
        respuesta.on('end', () => resolve(true));
      }
    );
    peticion.on('timeout', () => peticion.destroy(new Error('timeout')));
    peticion.on('error', (err) => {
      log(`ERROR LB cliente ${cliente} (${destino.host}): ${err.message}`);
      if (!res.headersSent) resolve(false);
      else res.destroy();
    });
    if (cuerpo) peticion.end(cuerpo);
    else req.pipe(peticion);
  });
}

// ---------- Reglas de enrutamiento ----------
async function buscarCliente(usuarioOEmail) {
  const [filas] = await bd.query(
    'SELECT cliente FROM usuarios WHERE username = ? OR email = ? LIMIT 1',
    [usuarioOEmail, usuarioOEmail]
  );
  return filas.length ? filas[0].cliente : null;
}

async function login(req, res) {
  const cuerpo = await leerCuerpo(req);
  let usuario = '';
  try {
    usuario = String(JSON.parse(cuerpo.toString('utf8')).username || '').trim();
  } catch (e) {
    return responderJson(res, 400, { success: false, message: 'Petición inválida' });
  }

  let cliente;
  try {
    cliente = await buscarCliente(usuario);
  } catch (err) {
    log(`ERROR BD Usuarios: ${err.message}`);
    return responderJson(res, 503, { success: false, message: 'Servicio de usuarios no disponible, intente de nuevo' });
  }

  if (!cliente) {
    log(`LOGIN "${usuario}" -> no está en la BD Usuarios: rechazado`);
    // Mismo mensaje que TinyCRM para no revelar qué usuarios existen
    return responderJson(res, 400, { success: false, message: 'Invalid username or password' });
  }

  log(`LOGIN "${usuario}" -> cliente ${cliente} (${CLIENTES[cliente].host})`);
  const ok = await reenviar(req, res, cliente, cuerpo, (estado) =>
    estado === 200 ? cookieCliente(cliente) : null
  );
  if (!ok) responderJson(res, 503, { success: false, message: `El cliente ${cliente} no está disponible` });
}

async function logout(req, res, cliente) {
  const cuerpo = await leerCuerpo(req);
  const ok = await reenviar(req, res, cliente, cuerpo, () => COOKIE_BORRAR);
  if (!ok) responderJson(res, 200, { success: true, message: 'Logged out' }, { 'Set-Cookie': COOKIE_BORRAR });
}

async function archivosFrontend(req, res, cliente) {
  // El frontend es el mismo para A y B. Si el usuario ya tiene cliente, se usa ese;
  // si no, se prueba A y, si está caído, B (así la pantalla de login carga aunque un cliente esté caído).
  const orden = cliente ? [cliente] : ['A', 'B'];
  for (const c of orden) {
    if (await reenviar(req, res, c, Buffer.alloc(0))) return;
  }
  responderJson(res, 503, { success: false, message: 'Servicio no disponible' });
}

async function estado(res) {
  const resultado = { middleware: 'ok' };
  try {
    const [[fila]] = await bd.query('SELECT COUNT(*) AS n FROM usuarios');
    resultado.bdUsuarios = `ok (${fila.n} usuarios)`;
  } catch (err) {
    resultado.bdUsuarios = `error: ${err.message}`;
  }
  for (const [c, destino] of Object.entries(CLIENTES)) {
    resultado[`lbCliente${c}`] = await new Promise((resolve) => {
      const p = http.get({ host: destino.host, port: destino.port, path: '/health', timeout: 3000 }, (r) => {
        r.resume();
        resolve(r.statusCode === 200 ? 'ok' : `HTTP ${r.statusCode}`);
      });
      p.on('timeout', () => p.destroy(new Error('timeout')));
      p.on('error', (e) => resolve(`caído (${e.message})`));
    });
  }
  responderJson(res, 200, resultado);
}

const servidor = http.createServer(async (req, res) => {
  try {
    const ruta = req.url.split('?')[0];
    const cliente = clienteDeCookie(req);

    if (ruta === '/middleware/estado') return await estado(res);

    if (ruta === '/api/auth/register') {
      log('REGISTRO público bloqueado');
      return responderJson(res, 403, {
        success: false,
        message: 'El registro público está deshabilitado. Pida al administrador de su empresa que cree su usuario.',
      });
    }

    if (ruta === '/api/auth/login' && req.method === 'POST') return await login(req, res);

    if (ruta.startsWith('/api/')) {
      if (!cliente) {
        return responderJson(res, 401, { success: false, message: 'No active session' }, { 'Set-Cookie': COOKIE_BORRAR });
      }
      if (ruta === '/api/auth/logout' || ruta === '/api/auth/logout-all') return await logout(req, res, cliente);
      const ok = await reenviar(req, res, cliente, null);
      if (!ok) responderJson(res, 503, { success: false, message: `El cliente ${cliente} no está disponible` });
      return;
    }

    return await archivosFrontend(req, res, cliente);
  } catch (err) {
    log(`ERROR inesperado: ${err.stack}`);
    if (!res.headersSent) responderJson(res, 500, { success: false, message: 'Error interno del middleware' });
  }
});

if (!SECRETO) {
  console.error('Falta la variable MIDDLEWARE_SECRETO');
  process.exit(1);
}

servidor.listen(PUERTO, () => {
  log(`Middleware escuchando en ${PUERTO}. Cliente A -> ${CLIENTES.A.host}, Cliente B -> ${CLIENTES.B.host}`);
});
