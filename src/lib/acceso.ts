// Código del local: los empleados lo escriben una vez por aparato; el dueño lo ve y lo cambia en el panel.
import type { AstroCookies } from 'astro';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { db } from './db';

const LETRAS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I para que no se confundan
export const nuevoCodigo = () => Array.from({ length: 6 }, () => LETRAS[randomInt(LETRAS.length)]).join('');

export const codigoLocal = (): string => {
  const r = db.prepare("SELECT valor FROM ajustes WHERE clave = 'codigo_local'").get() as any;
  if (r) return r.valor;
  const c = nuevoCodigo();
  db.prepare("INSERT INTO ajustes (clave, valor) VALUES ('codigo_local', ?)").run(c);
  return c;
};

export const cambiarCodigo = (c: string) => {
  db.prepare("INSERT INTO ajustes (clave, valor) VALUES ('codigo_local', ?) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor").run(c);
  db.prepare('DELETE FROM accesos').run(); // todos los aparatos deben escribir el código nuevo
};

export const codigoCorrecto = (dado: string) => {
  const a = Buffer.from(dado.trim().toUpperCase()), b = Buffer.from(codigoLocal().toUpperCase());
  return a.length === b.length && timingSafeEqual(a, b);
};

const DIAS = 90;
export const tieneAcceso = (token?: string) =>
  !!token && !!db.prepare(`SELECT 1 FROM accesos WHERE token = ? AND expira > datetime('now')`).get(token);

export const entregarAcceso = (cookies: AstroCookies, url: URL) => {
  const token = randomBytes(24).toString('hex');
  db.prepare(`DELETE FROM accesos WHERE expira <= datetime('now')`).run();
  db.prepare(`INSERT INTO accesos (token, expira) VALUES (?, datetime('now','+${DIAS} days'))`).run(token);
  // Lax: el empleado puede abrir el enlace desde WhatsApp y seguir autorizado.
  cookies.set('e', token, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: DIAS * 86400,
    secure: url.protocol === 'https:' || process.env.COOKIE_SECURE === '1',
  });
};

// Límite de intentos fallidos por dirección (en memoria): 10 cada 10 minutos, para el código y para el PIN del dueño.
const fallos = new Map<string, number[]>();
const VENTANA = 10 * 60_000, MAXIMO = 10;
const recientes = (ip: string) => {
  const ahora = Date.now();
  const l = (fallos.get(ip) ?? []).filter(t => ahora - t < VENTANA);
  l.length ? fallos.set(ip, l) : fallos.delete(ip);
  return l;
};
export const bloqueado = (ip: string) => recientes(ip).length >= MAXIMO;
export const registrarFallo = (ip: string) => fallos.set(ip, [...recientes(ip), Date.now()]);

// Detrás de nginx la conexión siempre llega de 127.0.0.1: la dirección real es la última de X-Forwarded-For (la agrega nginx).
export const ipDe = (request: Request, directa: string | undefined) =>
  request.headers.get('x-forwarded-for')?.split(',').pop()?.trim() || directa || 'desconocida';
