import type { APIRoute } from 'astro';
import { db } from '../lib/db';

// Cantidades al día para las pantallas abiertas (ventas y panel). Ver src/scripts/stock.ts.
export const GET: APIRoute = () => {
  const filas = db.prepare('SELECT id, cantidad FROM animales WHERE activo = 1').all();
  return new Response(JSON.stringify(filas), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
};
