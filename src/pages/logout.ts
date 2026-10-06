import type { APIRoute } from 'astro';
import { db } from '../lib/db';

export const POST: APIRoute = ({ cookies, redirect }) => {
  db.prepare('DELETE FROM sesiones WHERE token = ?').run(cookies.get('s')?.value ?? '');
  cookies.delete('s', { path: '/' });
  return redirect('/login', 303);
};
