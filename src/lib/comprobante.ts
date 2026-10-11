// Datos del comprobante de una venta, compartidos por la vista del empleado y la del dueño.
import { db, crc, TOKEN_RE } from './db';

// Número de factura: los últimos 6 caracteres del código de la venta (el mismo que se imprime).
export const numeroDe = (token: string) => token.slice(-6).toUpperCase();

export function cargarComprobante(token: string) {
  if (!TOKEN_RE.test(token)) return null;
  const ventas = db.prepare(`SELECT v.*, a.tipo, e.nombre FROM ventas v JOIN animales a ON a.id = v.animal_id
    JOIN empleados e ON e.id = v.empleado_id WHERE v.token = ?`).all(token) as any[];
  const servicios = db.prepare(`SELECT s.monto, s.fecha, s.metodo, s.nombre AS servicio, e.nombre FROM servicios s
    JOIN empleados e ON e.id = s.empleado_id WHERE s.token = ?`).all(token) as any[];
  const base = ventas[0] ?? servicios[0];
  if (!base) return null;
  const lineas = [
    ...ventas.map(v => ({ texto: `${v.cantidad} x ${v.tipo}`, detalle: v.cantidad > 1 ? `${crc(v.precio_unit)} c/u` : '', importe: v.cantidad * v.precio_unit })),
    ...servicios.map(s => ({ texto: s.servicio ?? 'Grooming', detalle: '', importe: s.monto })),
  ];
  const [dia, hora] = base.fecha.split(' ');
  return {
    nombre: base.nombre as string, metodo: base.metodo as string, lineas,
    total: lineas.reduce((n, l) => n + l.importe, 0),
    fecha: `${dia.split('-').reverse().join('/')} ${hora.slice(0, 5)}`, numero: numeroDe(token),
  };
}

// Busca una venta (de cualquier día) por su número de factura. Devuelve su código o null.
export function tokenPorNumero(numero: string): string | null {
  const n = numero.trim().toLowerCase();
  if (!/^[a-f0-9]{4,6}$/.test(n)) return null;
  const r = db.prepare(`SELECT token FROM (
      SELECT token, fecha FROM ventas WHERE token LIKE ? UNION ALL SELECT token, fecha FROM servicios WHERE token LIKE ?
    ) ORDER BY fecha DESC LIMIT 1`).get('%' + n, '%' + n) as any;
  return r?.token ?? null;
}
