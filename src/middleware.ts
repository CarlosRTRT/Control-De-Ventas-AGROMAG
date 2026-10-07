import { defineMiddleware } from 'astro:middleware';
import { db, MAX_SUBIDA } from './lib/db';

// La página de ventas (/) es pública; solo /admin y /factura piden el PIN del dueño.
export const onRequest = defineMiddleware((ctx, next) => {
  if (Number(ctx.request.headers.get('content-length')) > MAX_SUBIDA)
    return new Response('Archivo muy grande (máximo 15 MB).', { status: 413 });

  const p = ctx.url.pathname;
  const token = ctx.cookies.get('s')?.value;
  let admin = !!(token && db.prepare(`SELECT 1 FROM sesiones WHERE token = ? AND expira > datetime('now')`).get(token));

  if (admin && p === '/') {
    // Quien llega a la página de ventas deja de ser dueño: así un empleado no entra a /admin en un aparato con la sesión abierta.
    db.prepare('DELETE FROM sesiones WHERE token = ?').run(token);
    ctx.cookies.delete('s', { path: '/' });
    admin = false;
  } else if (admin) {
    // Sesión por inactividad: se renueva con cada uso y caduca a los 20 minutos sin actividad.
    db.prepare(`UPDATE sesiones SET expira = datetime('now','+20 minutes') WHERE token = ?`).run(token);
  }
  ctx.locals.admin = admin;

  if ((p.startsWith('/admin') || p.startsWith('/factura')) && !admin) return ctx.redirect('/login');
  return next();
});
