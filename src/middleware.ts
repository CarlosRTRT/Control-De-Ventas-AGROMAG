import { defineMiddleware } from 'astro:middleware';
import { db, MAX_SUBIDA } from './lib/db';

// La página de ventas (/) es pública; solo /admin y /factura piden el PIN del dueño.
export const onRequest = defineMiddleware((ctx, next) => {
  if (Number(ctx.request.headers.get('content-length')) > MAX_SUBIDA)
    return new Response('Archivo muy grande (máximo 15 MB).', { status: 413 });

  const token = ctx.cookies.get('s')?.value;
  ctx.locals.admin = !!(token && db.prepare(`SELECT 1 FROM sesiones WHERE token = ? AND expira > datetime('now')`).get(token));

  const p = ctx.url.pathname;
  if ((p.startsWith('/admin') || p.startsWith('/factura')) && !ctx.locals.admin) return ctx.redirect('/login');
  return next();
});
