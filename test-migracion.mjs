// Prueba de la migración al pago en efectivo: una base con el formato ANTERIOR (y ventas reales) debe actualizarse sin perder nada.
// Uso: npm run build && node test-migracion.mjs   (también corre dentro de npm test)
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vet-mig-'));
const archivo = path.join(dir, 'ventas.db');

// Base tal como la dejaba la versión anterior: el CHECK solo admite sinpe y tarjeta.
{
  const d = new DatabaseSync(archivo);
  d.exec(`
    PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;
    CREATE TABLE animales (id INTEGER PRIMARY KEY, tipo TEXT NOT NULL UNIQUE COLLATE NOCASE, cantidad INTEGER NOT NULL CHECK (cantidad >= 0), precio INTEGER NOT NULL CHECK (precio >= 0), activo INTEGER NOT NULL DEFAULT 1, clase TEXT NOT NULL DEFAULT 'animal');
    CREATE TABLE empleados (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL UNIQUE COLLATE NOCASE, activo INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE ventas (id INTEGER PRIMARY KEY, fecha TEXT NOT NULL DEFAULT (datetime('now','localtime')), empleado_id INTEGER NOT NULL REFERENCES empleados, animal_id INTEGER NOT NULL REFERENCES animales, cantidad INTEGER NOT NULL CHECK (cantidad > 0), precio_unit INTEGER NOT NULL, metodo TEXT NOT NULL CHECK (metodo IN ('sinpe','tarjeta')), factura TEXT, cierre TEXT, token TEXT);
    CREATE INDEX ventas_fecha ON ventas (fecha);
    CREATE INDEX ventas_token_idx ON ventas (token);
    CREATE TABLE catalogo_servicios (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL UNIQUE COLLATE NOCASE, precio INTEGER NOT NULL CHECK (precio > 0), activo INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE servicios (id INTEGER PRIMARY KEY, fecha TEXT NOT NULL DEFAULT (datetime('now','localtime')), empleado_id INTEGER NOT NULL REFERENCES empleados, monto INTEGER NOT NULL CHECK (monto > 0), metodo TEXT NOT NULL CHECK (metodo IN ('sinpe','tarjeta')), cierre TEXT, token TEXT, nombre TEXT);
    CREATE INDEX servicios_token_idx ON servicios (token);
    CREATE TABLE ajustes (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
    CREATE TABLE accesos (token TEXT PRIMARY KEY, expira TEXT NOT NULL);
    CREATE TABLE sesiones (token TEXT PRIMARY KEY, expira TEXT NOT NULL DEFAULT (datetime('now','+12 hours')));
    INSERT INTO empleados (nombre) VALUES ('Lucia'), ('Carlos');
    INSERT INTO animales (tipo, cantidad, precio, clase) VALUES ('Conejo', 7, 15000, 'animal'), ('Aserrin', 20, 1000, 'producto');
    INSERT INTO catalogo_servicios (nombre, precio) VALUES ('Baño', 8000);
    INSERT INTO ventas (fecha, empleado_id, animal_id, cantidad, precio_unit, metodo, cierre, token) VALUES
      ('2026-11-01 09:00:00', 1, 1, 2, 15000, 'sinpe', '2026-11-01 20:00:00', '${'a'.repeat(32)}'),
      ('2026-11-01 09:00:00', 1, 2, 3, 1000, 'sinpe', '2026-11-01 20:00:00', '${'a'.repeat(32)}'),
      ('2026-11-02 10:30:00', 2, 1, 1, 15000, 'tarjeta', NULL, '${'b'.repeat(32)}');
    INSERT INTO servicios (fecha, empleado_id, monto, metodo, cierre, token, nombre) VALUES
      ('2026-11-02 11:00:00', 2, 8000, 'tarjeta', NULL, '${'c'.repeat(32)}', 'Baño');
    INSERT INTO ajustes VALUES ('codigo_local', 'ABC234');
  `);
  d.close();
}

const volcar = d => ({
  ventas: d.prepare('SELECT * FROM ventas ORDER BY id').all(),
  servicios: d.prepare('SELECT * FROM servicios ORDER BY id').all(),
});
const antes = (() => { const d = new DatabaseSync(archivo, { readOnly: true }); const v = volcar(d); d.close(); return v; })();
assert.equal(antes.ventas.length, 3);

let puerto = 3997;
const arrancar = async () => {
  const srv = spawn(process.execPath, [path.resolve(import.meta.dirname, 'dist/server/entry.mjs')],
    { env: { ...process.env, PORT: String(puerto), HOST: 'localhost', DATA_DIR: dir, ADMIN_PIN: 'clave123' } });
  let err = ''; srv.stderr.on('data', d => (err += d));
  await Promise.race([new Promise(r => srv.stdout.once('data', r)), new Promise((_, no) => srv.once('exit', () => no(new Error('el servidor no arrancó: ' + err))))]);
  await fetch(`http://localhost:${puerto}/login`); // fuerza a cargar la base
  return srv;
};
const parar = srv => new Promise(r => { srv.once('exit', r); srv.kill(); });

try {
  let srv = await arrancar();
  await parar(srv);

  const d = new DatabaseSync(archivo);
  const sql = t => d.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(t).sql;
  assert.match(sql('ventas'), /'efectivo'/); assert.match(sql('servicios'), /'efectivo'/);
  assert.deepEqual(volcar(d), antes, 'las ventas y servicios deben quedar idénticos');
  assert.equal(d.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(d.prepare('PRAGMA foreign_key_check').all().length, 0);
  const indices = d.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('ventas_fecha','ventas_token_idx','servicios_token_idx')").all().map(r => r.name).sort();
  assert.deepEqual(indices, ['servicios_token_idx', 'ventas_fecha', 'ventas_token_idx']);
  assert.equal(d.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE '%_nueva'").get().n, 0);

  // Ahora sí acepta efectivo, y sigue rechazando lo demás
  d.prepare("INSERT INTO ventas (empleado_id, animal_id, cantidad, precio_unit, metodo) VALUES (1, 1, 1, 15000, 'efectivo')").run();
  d.prepare("INSERT INTO servicios (empleado_id, monto, metodo) VALUES (1, 8000, 'efectivo')").run();
  assert.throws(() => d.prepare("INSERT INTO ventas (empleado_id, animal_id, cantidad, precio_unit, metodo) VALUES (1, 1, 1, 15000, 'bitcoin')").run(), /CHECK/);
  assert.throws(() => d.prepare("INSERT INTO servicios (empleado_id, monto, metodo) VALUES (1, 8000, 'bitcoin')").run(), /CHECK/);
  // Las reglas de siempre siguen vigentes (llaves foráneas y cantidades)
  d.exec('PRAGMA foreign_keys = ON');
  assert.throws(() => d.prepare("INSERT INTO ventas (empleado_id, animal_id, cantidad, precio_unit, metodo) VALUES (99, 1, 1, 15000, 'sinpe')").run(), /FOREIGN KEY/);
  assert.throws(() => d.prepare("INSERT INTO ventas (empleado_id, animal_id, cantidad, precio_unit, metodo) VALUES (1, 1, 0, 15000, 'sinpe')").run(), /CHECK/);
  d.close();

  // Copia de seguridad previa: contiene la base ANTIGUA
  const copia = new DatabaseSync(path.join(dir, 'ventas.db.antes-efectivo'), { readOnly: true });
  assert.deepEqual(volcar(copia), antes);
  assert.doesNotMatch(copia.prepare("SELECT sql FROM sqlite_master WHERE name = 'ventas'").get().sql, /efectivo/);
  copia.close();

  // Segundo arranque: no hace nada (no reconstruye ni pisa la copia) y conserva lo nuevo
  const fechaCopia = fs.statSync(path.join(dir, 'ventas.db.antes-efectivo')).mtimeMs;
  puerto = 3996;
  srv = await arrancar(); await parar(srv);
  const d2 = new DatabaseSync(archivo, { readOnly: true });
  assert.equal(d2.prepare('SELECT count(*) n FROM ventas').get().n, 4);
  assert.equal(d2.prepare("SELECT count(*) n FROM ventas WHERE metodo = 'efectivo'").get().n, 1);
  d2.close();
  assert.equal(fs.statSync(path.join(dir, 'ventas.db.antes-efectivo')).mtimeMs, fechaCopia);

  console.log('OK migración');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
