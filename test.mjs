// Prueba rápida: npm run build && npm test  (usa una carpeta de datos temporal)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vet-'));
const srv = spawn(process.execPath, [path.resolve(import.meta.dirname, 'dist/server/entry.mjs')],
  { env: { ...process.env, PORT: '3999', HOST: 'localhost', DATA_DIR: dir, ADMIN_PIN: 'clave123' } });
await new Promise(r => srv.stdout.once('data', r));
const B = 'http://localhost:3999';

const login = async pin => {
  const r = await fetch(B + '/login', { method: 'POST', headers: { origin: B }, body: new URLSearchParams({ pin }), redirect: 'manual' });
  return r.headers.get('set-cookie')?.split(';')[0];
};
const post = (cookie, p, body) => fetch(B + p, { method: 'POST', headers: { cookie: cookie ?? '', origin: B }, body, redirect: 'manual' })
  .then(r => decodeURIComponent(r.headers.get('location')));

try {
  assert.equal(await login('mal'), undefined);
  assert.equal((await fetch(B + '/admin', { redirect: 'manual' })).status, 302); // admin pide PIN
  const admin = await login('clave123');
  await post(admin, '/admin', new URLSearchParams({ accion: 'animal', tipo: 'Perro', cantidad: '3', precio: '50000' }));
  await post(admin, '/admin', new URLSearchParams({ accion: 'empleado', nombre: 'Ana' }));

  // Vista de ventas: sin login
  assert.equal((await fetch(B + '/')).status, 200);
  const venta = (cantidad, extra = {}) => {
    const f = new FormData();
    Object.entries({ empleado: '1', animal: '1', cantidad, metodo: 'sinpe', ...extra }).forEach(([k, v]) => f.append(k, v));
    return post(null, '/', f);
  };
  assert.match(await venta('1', { empleado: '' }), /Elija quién/);
  assert.match(await venta('2', { factura: new Blob(['x'], { type: 'image/png' }) }), /Venta registrada/);
  assert.match(await venta('2'), /No hay suficientes/); // solo queda 1
  assert.match(await venta('0'), /Cantidad inválida/);
  assert.match(await venta('1', { factura: new Blob(['<svg>'], { type: 'image/svg+xml' }) }), /debe ser una imagen/);
  assert.match(await venta('1', { metodo: 'tarjeta' }), /Venta registrada/);

  await post(admin, '/admin', new URLSearchParams({ accion: 'quitar', id: '1' }));
  assert.match(await venta('1'), /Elija quién/); // empleado quitado ya no aparece

  const html = await fetch(B + '/admin', { headers: { cookie: admin } }).then(r => r.text());
  assert.match(html, /total-por-cerrar[^>]*>₡150[.,\s\u00a0\u202f]000/);
  assert.match(html, /<td[^>]*>Ana<\/td>/); // el historial se conserva
  assert.match(html, /name="cantidad"[^>]*value="0"/); // inventario en 0
  const factura = /href="(\/factura\/[^"]+)"/.exec(html)[1];
  assert.equal((await fetch(B + factura, { redirect: 'manual' })).status, 302); // facturas solo para el dueño
  assert.equal((await fetch(B + factura, { headers: { cookie: admin } })).status, 200);

  // Cierre: una venta que entra después de abrir el panel no se cierra con las demás
  const hasta = /name="hasta" value="(\d+)"/.exec(html)[1];
  await post(admin, '/admin', new URLSearchParams({ accion: 'animal', id: '1', tipo: 'Perro', cantidad: '5', precio: '50000' }));
  await post(admin, '/admin', new URLSearchParams({ accion: 'empleado', nombre: 'Ana' })); // reactivar
  assert.match(await venta('1'), /Venta registrada/);
  assert.match(await post(admin, '/admin', new URLSearchParams({ accion: 'cierre', hasta })), /Cierre hecho: 2 venta\(s\), total ₡150/);
  const panel = await fetch(B + '/admin', { headers: { cookie: admin } }).then(r => r.text());
  assert.equal([...panel.matchAll(/<td[^>]*>Ana<\/td>/g)].length, 1); // solo queda la venta nueva
  assert.match(await post(admin, '/admin', new URLSearchParams({ accion: 'cierre', hasta: '999' })), /Cierre hecho: 1 venta/);
  assert.match(await post(admin, '/admin', new URLSearchParams({ accion: 'cierre', hasta: '999' })), /No hay ventas pendientes/);
  assert.match(await fetch(B + '/admin', { headers: { cookie: admin } }).then(r => r.text()), /No hay ventas pendientes/);

  const hist = await fetch(B + '/admin/historial', { headers: { cookie: admin } }).then(r => r.text());
  assert.equal([...hist.matchAll(/<td[^>]*>Ana<\/td>/g)].length, 3); // las 3 ventas de hoy
  assert.match(hist, /Cierre a las \d\d:\d\d/);
  assert.match(hist, /3 ventas<\/b> por <b[^>]*>₡200[.,\s  ]000/);
  const ayer = await fetch(B + '/admin/historial?dia=2020-01-01', { headers: { cookie: admin } }).then(r => r.text());
  assert.match(ayer, /No hubo ventas este día/);

  // Eliminar animal: desaparece de panel y ventas, el historial se conserva, y se puede volver a crear
  assert.match(await post(admin, '/admin', new URLSearchParams({ accion: 'animal', id: '1', eliminar: '1' })), /Animal eliminado: Perro/);
  const sinPerro = await fetch(B + '/admin', { headers: { cookie: admin } }).then(r => r.text());
  assert.doesNotMatch(sinPerro, /name="tipo" value="Perro"/);
  assert.match(await venta('1'), /No hay suficientes/); // ya no se puede vender
  const hist2 = await fetch(B + '/admin/historial', { headers: { cookie: admin } }).then(r => r.text());
  assert.equal([...hist2.matchAll(/<td[^>]*>Perro<\/td>/g)].length, 3); // el historial sigue mostrándolo
  assert.match(await post(admin, '/admin', new URLSearchParams({ accion: 'animal', tipo: 'perro', cantidad: '4', precio: '60000' })), /Guardado: perro/);
  assert.match(await fetch(B + '/admin', { headers: { cookie: admin } }).then(r => r.text()), /value="60000"/);
  assert.match(await post(admin, '/admin', new URLSearchParams({ accion: 'animal', tipo: 'Perro', cantidad: '1', precio: '1' })), /Ya existe/);

  // El mismo formulario enviado dos veces (respuesta perdida / reintento) solo descuenta una vez
  const stock = () => fetch(B + '/admin', { headers: { cookie: admin } }).then(r => r.text()).then(h => /name="cantidad"[^>]*value="(\d+)"/.exec(h)[1]);
  await post(admin, '/admin', new URLSearchParams({ accion: 'empleado', nombre: 'Ana' }));
  const antes = Number(await stock());
  const unica = () => { const f = new FormData(); Object.entries({ token: 'abc123', empleado: '1', animal: '1', cantidad: '1', metodo: 'sinpe' }).forEach(([k, v]) => f.append(k, v)); return post(null, '/', f); };
  assert.match(await unica(), /Venta registrada/);
  assert.match(await unica(), /ya estaba registrada/);
  assert.equal(Number(await stock()), antes - 1);
  console.log('OK');
} finally {
  srv.kill();
}
