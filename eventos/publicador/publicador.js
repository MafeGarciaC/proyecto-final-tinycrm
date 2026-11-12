// Publicador de eventos "usuario creado" de UN cliente (flecha Cluster DB -> Broker del diagrama).
//
// Patrón outbox:
//   1. Un trigger en la tabla `users` de la BD del cliente escribe cada usuario nuevo en `outbox_usuarios`.
//      Así el evento nace en la base de datos, sin importar cómo se creó el usuario
//      (registro, panel de admin o usuarios iniciales), y sin tocar el código de TinyCRM.
//   2. Este programa revisa el outbox cada 2 segundos, publica cada evento en RabbitMQ y,
//      cuando el broker confirma que lo recibió, lo marca como publicado.
//   Si el broker o la BD se caen, los eventos esperan en el outbox y se envían al volver: no se pierden.

const amqp = require('amqplib');
const mysql = require('mysql2/promise');

const CLIENTE = process.env.CLIENTE; // 'A' o 'B'
const EXCHANGE = 'tiny.usuarios';
const COLA = 'central.usuarios';
const CLAVE = `usuario.creado.${CLIENTE.toLowerCase()}`;
const INTERVALO_MS = 2000;

const bd = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 2,
  enableKeepAlive: true,
});

function log(...partes) {
  console.log(new Date().toISOString(), `[cliente ${CLIENTE}]`, ...partes);
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Crea la tabla outbox y el trigger. TinyCRM crea la tabla `users` al arrancar,
// así que primero se espera a que exista.
async function prepararBD() {
  for (;;) {
    try {
      const [tablas] = await bd.query("SHOW TABLES LIKE 'users'");
      if (tablas.length) break;
      log('Esperando a que TinyCRM cree la tabla users...');
    } catch (err) {
      log(`BD no disponible (${err.message}), reintentando...`);
    }
    await esperar(5000);
  }

  // En Galera todo cambio de estructura (CREATE TABLE/TRIGGER) bloquea la tabla en los 3 nodos
  // y cancela las escrituras que caigan en ese instante. Por eso solo se crean si no existen,
  // consultando primero: un CREATE ... IF NOT EXISTS igual pasaría por ese bloqueo.
  const [[{ tabla, trigger }]] = await bd.query(`
    SELECT
      (SELECT COUNT(*) FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbox_usuarios') AS tabla,
      (SELECT COUNT(*) FROM information_schema.TRIGGERS
        WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = 'trg_usuario_creado') AS \`trigger\``);

  if (!tabla) {
    await bd.query(`
      CREATE TABLE outbox_usuarios (
        id           BIGINT AUTO_INCREMENT PRIMARY KEY,
        id_usuario   BIGINT       NOT NULL,
        username     VARCHAR(255) NOT NULL,
        email        VARCHAR(255) NOT NULL,
        creado_en    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        publicado_en DATETIME     NULL,
        KEY idx_pendientes (publicado_en)
      )`);
    log('Tabla outbox_usuarios creada');
  }

  if (!trigger) {
    await bd.query(`
      CREATE TRIGGER trg_usuario_creado
      AFTER INSERT ON users FOR EACH ROW
        INSERT INTO outbox_usuarios (id_usuario, username, email)
        VALUES (NEW.id, NEW.username, NEW.email)`);
    log('Trigger trg_usuario_creado creado');

    // Usuarios creados antes de que existiera el trigger (ej. admin y support iniciales)
    const [r] = await bd.query(`
      INSERT INTO outbox_usuarios (id_usuario, username, email)
      SELECT u.id, u.username, u.email FROM users u
      WHERE NOT EXISTS (SELECT 1 FROM outbox_usuarios o WHERE o.id_usuario = u.id)`);
    log(`${r.affectedRows} usuarios existentes agregados al outbox`);
  }
  log('Outbox y trigger listos');
}

// Se conecta al broker; si no está, reintenta cada 5 s sin reiniciar el proceso
// (reiniciar volvería a revisar la BD en cada intento).
async function conectarBroker() {
  for (;;) {
    try {
      const conexion = await amqp.connect(process.env.RABBIT_URL);
      const canal = await conexion.createConfirmChannel();
      await canal.assertExchange(EXCHANGE, 'topic', { durable: true });
      // También declara la cola: si el consumer todavía no ha arrancado, los eventos esperan en ella
      // (un exchange sin cola enlazada descarta los mensajes).
      await canal.assertQueue(COLA, { durable: true });
      await canal.bindQueue(COLA, EXCHANGE, 'usuario.creado.*');
      const estado = { abierta: true };
      conexion.on('close', () => {
        estado.abierta = false;
        log('Conexión con el broker cerrada; los eventos esperan en el outbox');
      });
      conexion.on('error', (err) => log(`Error del broker: ${err.message}`));
      log(`Conectado al broker. Publicando en ${EXCHANGE} con clave ${CLAVE}`);
      return { canal, estado };
    } catch (err) {
      log(`Broker no disponible (${err.message}), reintentando en 5 s...`);
      await esperar(5000);
    }
  }
}

async function publicarPendientes(canal) {
  const [pendientes] = await bd.query(
    'SELECT id, id_usuario, username, email, creado_en FROM outbox_usuarios WHERE publicado_en IS NULL ORDER BY id LIMIT 50'
  );
  for (const ev of pendientes) {
    const mensaje = {
      evento: 'usuario.creado',
      cliente: CLIENTE,
      username: ev.username,
      email: ev.email,
      idEnCliente: ev.id_usuario,
      fecha: ev.creado_en,
    };
    canal.publish(EXCHANGE, CLAVE, Buffer.from(JSON.stringify(mensaje)), {
      persistent: true, // RabbitMQ lo guarda en disco
      contentType: 'application/json',
      messageId: `${CLIENTE}-${ev.id}`,
    });
    await canal.waitForConfirms(); // el broker confirmó que lo tiene
    await bd.query('UPDATE outbox_usuarios SET publicado_en = NOW() WHERE id = ?', [ev.id]);
    log(`PUBLICADO usuario "${ev.username}" -> ${EXCHANGE} (${CLAVE})`);
  }
}

async function main() {
  await prepararBD();

  let broker = await conectarBroker();
  for (;;) {
    if (!broker.estado.abierta) broker = await conectarBroker();
    try {
      await publicarPendientes(broker.canal);
    } catch (err) {
      log(`Error publicando (se reintentará): ${err.message}`);
    }
    await esperar(INTERVALO_MS);
  }
}

main().catch((err) => {
  log(`Error fatal: ${err.message}`);
  process.exit(1);
});
