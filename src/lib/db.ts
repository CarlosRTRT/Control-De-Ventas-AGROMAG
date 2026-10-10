// Datos en DATA_DIR (por defecto ./data): ventas.db + facturas/. Respalde esa carpeta.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

process.env.TZ ||= 'America/Costa_Rica'; // la VPS suele estar en UTC; fechas de venta en hora local
const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
export const FACTURAS = path.join(DATA_DIR, 'facturas');
fs.mkdirSync(FACTURAS, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'ventas.db'));
db.exec(`
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS animales (
  id INTEGER PRIMARY KEY, tipo TEXT NOT NULL UNIQUE COLLATE NOCASE,
  cantidad INTEGER NOT NULL CHECK (cantidad >= 0), precio INTEGER NOT NULL CHECK (precio >= 0),
  activo INTEGER NOT NULL DEFAULT 1); -- 0 = eliminado (se conserva para el historial de ventas)
CREATE TABLE IF NOT EXISTS empleados (
  id INTEGER PRIMARY KEY, nombre TEXT NOT NULL UNIQUE COLLATE NOCASE, activo INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS ventas (
  id INTEGER PRIMARY KEY, fecha TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  empleado_id INTEGER NOT NULL REFERENCES empleados, animal_id INTEGER NOT NULL REFERENCES animales,
  cantidad INTEGER NOT NULL CHECK (cantidad > 0), precio_unit INTEGER NOT NULL,
  metodo TEXT NOT NULL CHECK (metodo IN ('sinpe','tarjeta')), factura TEXT,
  cierre TEXT, -- NULL = venta del día aún sin cerrar
  token TEXT); -- código único del formulario: evita registrar dos veces la misma venta
CREATE INDEX IF NOT EXISTS ventas_fecha ON ventas (fecha);
CREATE TABLE IF NOT EXISTS servicios ( -- grooming: lo que el empleado cobró, sin inventario
  id INTEGER PRIMARY KEY, fecha TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  empleado_id INTEGER NOT NULL REFERENCES empleados, monto INTEGER NOT NULL CHECK (monto > 0),
  metodo TEXT NOT NULL CHECK (metodo IN ('sinpe','tarjeta')), cierre TEXT, token TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS servicios_token ON servicios (token);
CREATE TABLE IF NOT EXISTS ajustes (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS accesos ( -- aparatos de empleados autorizados con el código del local
  token TEXT PRIMARY KEY, expira TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sesiones (
  token TEXT PRIMARY KEY, expira TEXT NOT NULL DEFAULT (datetime('now','+12 hours')));
`);
// Bases creadas antes de poder eliminar animales
if (!db.prepare("SELECT 1 FROM pragma_table_info('animales') WHERE name = 'activo'").get())
  db.exec('ALTER TABLE animales ADD COLUMN activo INTEGER NOT NULL DEFAULT 1');
if (!db.prepare("SELECT 1 FROM pragma_table_info('ventas') WHERE name = 'token'").get())
  db.exec('ALTER TABLE ventas ADD COLUMN token TEXT');
// Una venta con varios animales deja una fila por animal con el mismo código: por eso el índice ya no es único.
db.exec('DROP INDEX IF EXISTS ventas_token; CREATE INDEX IF NOT EXISTS ventas_token_idx ON ventas (token)');

// Compara el PIN del dueño en tiempo constante.
export const pinCorrecto = (pin: string) => {
  const salt = randomBytes(16);
  const h = (s: string) => scryptSync(s, salt, 32);
  return (process.env.ADMIN_PIN || '').length >= 4 && timingSafeEqual(h(pin), h(process.env.ADMIN_PIN!));
};

// Ventas de animales y servicios (grooming) en una sola lista, con las mismas columnas.
export const MOVIMIENTOS_SQL = `SELECT * FROM (
  SELECT 'v' AS origen, v.id, v.fecha, v.cantidad, v.precio_unit, v.metodo, v.factura, v.cierre, a.tipo, e.nombre
    FROM ventas v JOIN animales a ON a.id = v.animal_id JOIN empleados e ON e.id = v.empleado_id
  UNION ALL
  SELECT 's', s.id, s.fecha, 1, s.monto, s.metodo, NULL, s.cierre, 'Grooming', e.nombre
    FROM servicios s JOIN empleados e ON e.id = s.empleado_id
)`;

export const crc =(n: number) => '₡' + Number(n).toLocaleString('es-CR');
export const hoy = () => new Date().toLocaleDateString('sv'); // YYYY-MM-DD local
export const TIPOS_FACTURA: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf',
};
export const MAX_SUBIDA = 15e6;
export const TOKEN_RE = /^[a-f0-9]{32}$/; // código de cada formulario de venta (también identifica su comprobante)
