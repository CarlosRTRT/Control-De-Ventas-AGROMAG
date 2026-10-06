// Solo el dueño llega aquí (ver middleware).
import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { FACTURAS, TIPOS_FACTURA } from '../../lib/db';

export const GET: APIRoute = ({ params }) => {
  const m = /^[a-f0-9]{24}\.(jpg|png|webp|heic|pdf)$/.exec(params.file ?? '');
  const file = m && path.join(FACTURAS, m[0]);
  if (!file || !fs.existsSync(file)) return new Response('No encontrada', { status: 404 });
  const tipo = Object.keys(TIPOS_FACTURA).find(k => TIPOS_FACTURA[k] === m[1])!;
  return new Response(fs.readFileSync(file), { headers: { 'content-type': tipo, 'x-content-type-options': 'nosniff' } });
};
