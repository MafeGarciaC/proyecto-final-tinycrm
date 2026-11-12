// Consumer (diagrama: Consumer -> BD "Usuarios").
//
// Escucha la cola `central.usuarios`, que recibe los eventos "usuario creado" de los dos clientes,
// y registra cada usuario en la BD Usuarios con el cliente al que pertenece.
// El middleware usa esa tabla para enrutar el login.
//
// Confirma (ack) el mensaje solo después de guardarlo: si la BD Usuarios está caída, el mensaje
// vuelve a la cola y se procesa cuando vuelva. Procesar dos veces el mismo evento no hace daño.

const amqp = require('amqplib');
const mysql = require('mysql2/promise');

const EXCHANGE = 'tiny.usuarios';
const COLA = 'central.usuarios';

const bd = mysql.createPool({
  host: process.env.USUARIOS_DB_HOST,
  user: process.env.USUARIOS_DB_USER,
  password: process.env.USUARIOS_DB_PASSWORD,
  database: 'usuarios',
  connectionLimit: 3,
  enableKeepAlive: true,
});

function log(...partes) {
  console.log(new Date().toISOString(), ...partes);
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function registrar(ev) {
  // Un username pertenece a un solo cliente: si ya está registrado en el otro, no se cambia
  // (si no, un admin del cliente B podría "robarse" el login de un usuario del cliente A).
  const [existente] = await bd.query('SELECT cliente FROM usuarios WHERE username = ?', [ev.username]);
  if (existente.length && existente[0].cliente !== ev.cliente) {
    log(`CONFLICTO "${ev.username}" ya pertenece al cliente ${existente[0].cliente}; evento del cliente ${ev.cliente} ignorado`);
    return;
  }
  await bd.query(
    `INSERT INTO usuarios (username, email, cliente, id_en_cliente) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE email = VALUES(email), id_en_cliente = VALUES(id_en_cliente)`,
    [ev.username, ev.email, ev.cliente, ev.idEnCliente]
  );
  log(`REGISTRADO "${ev.username}" -> cliente ${ev.cliente}`);
}

async function main() {
  const conexion = await amqp.connect(process.env.RABBIT_URL);
  conexion.on('close', () => {
    log('Conexión con el broker cerrada, reiniciando...');
    process.exit(1);
  });
  conexion.on('error', (err) => log(`Error del broker: ${err.message}`));

  const canal = await conexion.createChannel();
  await canal.assertExchange(EXCHANGE, 'topic', { durable: true });
  await canal.assertQueue(COLA, { durable: true });
  // Eventos de cualquier cliente: usuario.creado.a, usuario.creado.b
  await canal.bindQueue(COLA, EXCHANGE, 'usuario.creado.*');
  await canal.prefetch(10);
  log(`Escuchando la cola ${COLA} (${EXCHANGE} usuario.creado.*)`);

  await canal.consume(COLA, async (msg) => {
    if (!msg) return;
    let ev;
    try {
      ev = JSON.parse(msg.content.toString('utf8'));
      if (!['A', 'B'].includes(ev.cliente) || !ev.username || !ev.email) throw new Error('faltan datos');
    } catch (err) {
      log(`Mensaje inválido descartado (${err.message}): ${msg.content.toString('utf8').slice(0, 200)}`);
      return canal.ack(msg);
    }

    try {
      await registrar(ev);
      canal.ack(msg);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        // El email ya lo usa otro usuario registrado: no se puede guardar, no tiene sentido reintentar
        log(`CONFLICTO email "${ev.email}" de "${ev.username}" (cliente ${ev.cliente}) ya registrado; ignorado`);
        return canal.ack(msg);
      }
      log(`Error guardando "${ev.username}" (${err.message}); vuelve a la cola en 3 s`);
      await esperar(3000);
      canal.nack(msg, false, true);
    }
  });
}

main().catch((err) => {
  log(`Error fatal: ${err.message}`);
  process.exit(1);
});
