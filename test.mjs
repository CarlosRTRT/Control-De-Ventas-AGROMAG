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
  for (const [nombre, precio] of [['Grooming', '8000'], ['Baño', '5000'], ['Corte', '3000']]) await post(admin, '/admin', new URLSearchParams({ accion: 'servicio', nombre, precio }));

  // Acceso del equipo: la página de ventas pide el código del local
  const sinCodigo = await fetch(B + '/', { redirect: 'manual' });
  assert.equal(sinCodigo.status, 302);
  assert.match(sinCodigo.headers.get('location'), /\/acceso/);
  assert.equal((await fetch(B + '/acceso')).status, 200);
  const codigo = /data-codigo="([A-Z0-9]+)"/.exec(await fetch(B + '/admin', { headers: { cookie: admin } }).then(r => r.text()))[1];
  assert.match(codigo, /^[A-HJ-NP-Z2-9]{6}$/);
  const acceso = codigoDado => fetch(B + '/acceso', { method: 'POST', headers: { origin: B }, body: new URLSearchParams({ codigo: codigoDado }), redirect: 'manual' });
  const equivocado = await acceso('ZZZZZZ');
  assert.match(decodeURIComponent(equivocado.headers.get('location')), /Código incorrecto/);
  assert.equal(equivocado.headers.get('set-cookie'), null);
  const bueno = await acceso(' ' + codigo.toLowerCase() + ' '); // acepta minúsculas y espacios
  let emp = bueno.headers.get('set-cookie')?.split(';')[0];
  assert.ok(emp?.startsWith('e='));
  assert.equal(bueno.headers.get('location'), '/');
  // Sin el código no se puede registrar, ver el historial ni abrir un comprobante
  const sinF = new FormData(); Object.entries({ empleado: '1', animal: '1', cantidad: '1', metodo: 'sinpe' }).forEach(([k, v]) => sinF.append(k, v));
  const intento = await fetch(B + '/', { method: 'POST', headers: { origin: B }, body: sinF, redirect: 'manual' });
  assert.match(intento.headers.get('location'), /\/acceso/);
  assert.match((await fetch(B + '/?ver=historial', { redirect: 'manual' })).headers.get('location'), /\/acceso/);
  assert.equal((await fetch(B + '/', { headers: { cookie: emp } })).status, 200);
  assert.equal((await fetch(B + '/acceso', { headers: { cookie: emp }, redirect: 'manual' })).status, 302); // ya autorizado: va a ventas
  const venta = (cantidad, extra = {}) => {
    const f = new FormData();
    Object.entries({ empleado: '1', animal: '1', cantidad, metodo: 'sinpe', ...extra }).forEach(([k, v]) => f.append(k, v));
    return post(emp, '/', f);
  };
  assert.match(await venta('1', { empleado: '' }), /Elija quién/);
  assert.match(await venta('2'), /Venta registrada/);
  assert.match(await venta('2'), /No hay suficientes/); // solo queda 1
  assert.match(await venta('0'), /Cantidad inválida/);
  assert.match(await venta('1', { metodo: 'tarjeta' }), /Venta registrada/);

  await post(admin, '/admin', new URLSearchParams({ accion: 'quitar', id: '1' }));
  assert.match(await venta('1'), /Elija quién/); // empleado quitado ya no aparece

  const html = await fetch(B + '/admin', { headers: { cookie: admin } }).then(r => r.text());
  assert.match(html, /total-por-cerrar[^>]*>₡150[.,\s\u00a0\u202f]000/);
  assert.match(html, /<td[^>]*>Ana<\/td>/); // el historial se conserva
  assert.match(html, /name="cantidad"[^>]*value="0"/); // inventario en 0
  // Facturas ya guardadas (de antes de quitar la subida): solo las ve el dueño
  const nombreFactura = 'a'.repeat(24) + '.png';
  fs.writeFileSync(path.join(dir, 'facturas', nombreFactura), 'x');
  const factura = '/factura/' + nombreFactura;
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
  const unica = () => { const f = new FormData(); Object.entries({ token: 'abc123', empleado: '1', animal: '1', cantidad: '1', metodo: 'sinpe' }).forEach(([k, v]) => f.append(k, v)); return post(emp, '/', f); };
  assert.match(await unica(), /Venta registrada/);
  assert.match(await unica(), /ya estaba registrada/);
  assert.equal(Number(await stock()), antes - 1);

  // Servicios del catálogo: solos, junto con un animal, validaciones, sin duplicados y dentro del cierre
  {
    const { DatabaseSync: Db } = await import('node:sqlite');
    const bd = new Db(path.join(dir, 'ventas.db'));
    const servicios = () => bd.prepare('select count(*) n from servicios').get().n;
    const g = campos => { const f = new FormData(); Object.entries({ empleado: '1', metodo: 'tarjeta', ...campos }).forEach(([k, v]) => f.append(k, v)); return post(emp, '/', f); };

    assert.match(await g({ animal: '', servicio: '1' }), /Venta registrada: Grooming ₡8/);
    assert.equal(servicios(), 1);

    const inventario = Number(await stock());
    assert.match(await g({ animal: '1', cantidad: '1', servicio: '2' }), /Venta registrada: 1 .* \+ Baño ₡5/);
    assert.equal(Number(await stock()), inventario - 1);
    assert.equal(servicios(), 2);

    assert.match(await g({ animal: '' }), /Elija un animal, un producto o un servicio/);
    assert.match(await g({ animal: '', servicio: '999' }), /ya no está disponible/); // servicio que no existe
    assert.match(await g({ animal: '1', cantidad: '0' }), /Cantidad inválida/);
    assert.equal(servicios(), 2);

    // Si no alcanza el animal, el grooming de esa misma venta tampoco se guarda
    assert.match(await g({ animal: '1', cantidad: '9999', servicio: '2' }), /No hay suficientes/);
    assert.equal(servicios(), 2);

    // El mismo formulario enviado dos veces (solo grooming) se registra una sola vez
    assert.match(await g({ token: 'solo-grooming-1', animal: '', servicio: '3' }), /Venta registrada/);
    assert.match(await g({ token: 'solo-grooming-1', animal: '', servicio: '3' }), /ya estaba registrada/);
    assert.equal(servicios(), 3);

    // Se ve en el panel, suma en los totales y entra al cierre
    const panelG = await fetch(B + '/admin', { headers: { cookie: admin } }).then(r => r.text());
    for (const nombre of ['Grooming', 'Baño', 'Corte']) assert.match(panelG, new RegExp('<td[^>]*>' + nombre + '</td>'));
    const hV = /name="hasta" value="(\d+)"/.exec(panelG)[1], hS = /name="hasta_s" value="(\d+)"/.exec(panelG)[1];
    assert.match(await post(admin, '/admin', new URLSearchParams({ accion: 'cierre', hasta: hV, hasta_s: hS })), /Cierre hecho: \d+ venta/);
    assert.equal(bd.prepare('select count(*) n from servicios where cierre is null').get().n, 0);
    assert.match(await fetch(B + '/admin', { headers: { cookie: admin } }).then(r => r.text()), /No hay ventas pendientes/);
    const histG = await fetch(B + '/admin/historial', { headers: { cookie: admin } }).then(r => r.text());
    assert.equal([...histG.matchAll(/<td[^>]*>(Grooming|Baño|Corte)<\/td>/g)].length, 3);
    bd.close();
  }

  // Después de registrar, la pantalla cambia a la vista previa del comprobante (con Imprimir y Volver)
  {
    const hex = 'b'.repeat(31);
    const venta2 = campos => { const f = new FormData(); Object.entries({ empleado: '1', metodo: 'sinpe', ...campos }).forEach(([k, v]) => f.append(k, v)); return post(emp, '/', f); };
    const ver = (extra = '') => fetch(B + '/' + extra, { headers: { cookie: emp } }).then(r => r.text());

    // Animal + servicio: la respuesta lleva al comprobante, que se ve sin sesión
    const tokenA = hex + '1';
    assert.match(await venta2({ token: tokenA, animal: '1', cantidad: '1', servicio: '2' }), new RegExp('recibo=' + tokenA));
    const prev = await ver('?recibo=' + tokenA);
    assert.match(prev, /COMPROBANTE DE VENTA/);
    assert.match(prev, /1 x /);
    assert.match(prev, /Baño/);
    assert.match(prev, /TOTAL<\/span><span[^>]*>₡65[.,\s  ]000/); // 60 000 del animal + 5 000 del servicio
    assert.match(prev, /SINPE/);
    assert.match(prev, /Imprimir factura/);
    assert.match(prev, /<a class="volver"[^>]*href="\/"/);
    assert.doesNotMatch(prev, /id="venta"/); // el formulario se reemplaza por la vista previa

    // Solo un servicio: sin líneas de animal; ancho de rollo elegido
    const tokenG = hex + '2';
    assert.match(await venta2({ token: tokenG, animal: '', servicio: '1', metodo: 'tarjeta' }), new RegExp('recibo=' + tokenG));
    const soloG = await ver('?recibo=' + tokenG + '&ancho=58');
    assert.match(soloG, /Grooming/);
    assert.doesNotMatch(soloG, /\d x /);
    assert.match(soloG, /TOTAL<\/span><span[^>]*>₡8[.,\s  ]000/);
    assert.match(soloG, /Tarjeta/);
    assert.match(soloG, /size: 58mm auto/);

    // Códigos desconocidos o inválidos: se muestra el formulario normal
    for (const mal of ['c'.repeat(32), 'abc', '..%2Fetc']) {
      const h = await ver('?recibo=' + mal);
      assert.match(h, /id="venta"/);
      assert.doesNotMatch(h, /COMPROBANTE DE VENTA/);
    }
    assert.equal((await fetch(B + '/recibo/' + tokenA, { headers: { cookie: emp } })).status, 404); // ya no hay página aparte
    assert.match(await ver(), /id="venta"/); // sin código: formulario

    // Historial de ventas para los empleados: ventas sin cerrar, con "Ver factura" e "Imprimir"
    const hist = await ver('?ver=historial');
    assert.match(hist, /Ventas desde el último cierre/);
    assert.match(hist, new RegExp('href="/\\?recibo=' + tokenA + '&amp;desde=historial"'));
    assert.match(hist, new RegExp('href="/\\?recibo=' + tokenA + '&amp;desde=historial&amp;imprimir=1"'));
    assert.match(hist, new RegExp('href="/\\?recibo=' + tokenG + '&amp;desde=historial"'));
    assert.match(hist, /Ver factura/);
    assert.match(hist, /Imprimir/);
    assert.equal([...hist.matchAll(/class="entrada"/g)].length >= 2, true);
    // Animal + servicio de la misma venta salen en UNA sola entrada
    assert.match(hist, /1 x [^<]* \+ Baño/);
    assert.doesNotMatch(hist, /id="venta"/);

    // Desde el historial, "Volver" regresa al historial
    const desde = await ver('?recibo=' + tokenA + '&desde=historial');
    assert.match(desde, /<a class="volver"[^>]*href="\/\?ver=historial"/);
    assert.match(desde, /Historial de ventas/); // sin aviso de "Venta registrada"

    // El cierre del dueño limpia el historial
    const panelH = await fetch(B + '/admin', { headers: { cookie: admin } }).then(r => r.text());
    const cierreH = new URLSearchParams({ accion: 'cierre', hasta: /name="hasta" value="(\d+)"/.exec(panelH)[1], hasta_s: /name="hasta_s" value="(\d+)"/.exec(panelH)[1] });
    assert.match(await post(admin, '/admin', cierreH), /Cierre hecho/);
    const despues = await ver('?ver=historial');
    assert.match(despues, /No hay ventas desde el último cierre/);
    assert.doesNotMatch(despues, new RegExp(tokenA));
  }

  // Varios animales distintos en una sola venta
  {
    const { DatabaseSync: BdMulti } = await import('node:sqlite');
    const bd = new BdMulti(path.join(dir, 'ventas.db'));
    await post(admin, '/admin', new URLSearchParams({ accion: 'animal', tipo: 'Conejo', cantidad: '6', precio: '20000' }));
    await post(admin, '/admin', new URLSearchParams({ accion: 'animal', tipo: 'Hamster', cantidad: '5', precio: '3000' }));
    const idDe = tipo => bd.prepare('select id from animales where tipo = ?').get(tipo).id;
    const quedan = tipo => bd.prepare('select cantidad from animales where tipo = ?').get(tipo).cantidad;
    const conejo = idDe('Conejo'), hamster = idDe('Hamster');
    const multi = (pares, extra = {}) => {
      const f = new FormData(); f.append('empleado', '1'); f.append('metodo', 'sinpe');
      for (const [a, c] of pares) { f.append('animal', String(a)); f.append('cantidad', String(c)); }
      Object.entries(extra).forEach(([k, v]) => f.append(k, v));
      return post(emp, '/', f);
    };
    const comprobante = token => fetch(B + '/?recibo=' + token, { headers: { cookie: emp } }).then(x => x.text());
    const hex = 'd'.repeat(31);

    // Dos animales distintos: un solo comprobante con las dos líneas
    const t1 = hex + '1';
    assert.match(await multi([[conejo, 2], [hamster, 3]], { token: t1 }), /Venta registrada: 2 Conejo — ₡40.* \+ 3 Hamster/);
    assert.equal(quedan('Conejo'), 4);
    assert.equal(quedan('Hamster'), 2);
    assert.equal(bd.prepare('select count(*) n from ventas where token = ?').get(t1).n, 2);
    const rc = await comprobante(t1);
    assert.match(rc, /2 x Conejo/);
    assert.match(rc, /3 x Hamster/);
    assert.match(rc, /TOTAL<\/span><span[^>]*>₡49[.,\s  ]000/); // 40 000 + 9 000

    // En el historial de empleados es una sola entrada
    const hist = await fetch(B + '/?ver=historial', { headers: { cookie: emp } }).then(x => x.text());
    assert.equal([...hist.matchAll(new RegExp('recibo=' + t1 + '&amp;desde=historial"', 'g'))].length, 1);
    assert.match(hist, /2 x Conejo/);
    assert.match(hist, /3 x Hamster/);

    // El mismo animal en dos líneas se suma
    const antes = quedan('Conejo');
    assert.match(await multi([[conejo, 1], [conejo, 1]]), /Venta registrada: 2 Conejo/);
    assert.equal(quedan('Conejo'), antes - 2);

    // Una línea sin animal se ignora aunque traiga cantidad
    assert.match(await multi([['', 7], [hamster, 1]]), /Venta registrada: 1 Hamster/);

    // Si falta uno de los animales, no se descuenta ninguno
    const c0 = quedan('Conejo'), h0 = quedan('Hamster');
    assert.match(await multi([[conejo, 1], [hamster, 999]]), /No hay suficientes Hamster/);
    assert.equal(quedan('Conejo'), c0);
    assert.equal(quedan('Hamster'), h0);
    assert.match(await multi([[conejo, 1], [hamster, 0]]), /Cantidad inválida/);
    assert.equal(quedan('Conejo'), c0);

    // Reintentar el mismo formulario no duplica nada
    assert.match(await multi([[conejo, 1], [hamster, 1]], { token: t1 }), /ya estaba registrada/);
    assert.equal(bd.prepare('select count(*) n from ventas where token = ?').get(t1).n, 2);
    assert.equal(quedan('Conejo'), c0);

    // Dos animales y un servicio, todo en un comprobante
    const t3 = hex + '3';
    assert.match(await multi([[conejo, 1], [hamster, 1]], { token: t3, servicio: '2' }), /Venta registrada: 1 Conejo.* \+ 1 Hamster.* \+ Baño/);
    const rc3 = await comprobante(t3);
    assert.match(rc3, /1 x Conejo/);
    assert.match(rc3, /1 x Hamster/);
    assert.match(rc3, /Baño/);
    assert.match(rc3, /TOTAL<\/span><span[^>]*>₡28[.,\s  ]000/); // 20 000 + 3 000 + 5 000
    bd.close();
  }

  // Servicios (catálogo del dueño) y productos (aserrín, borucha...)
  {
    const { DatabaseSync: BdCat } = await import('node:sqlite');
    const bd = new BdCat(path.join(dir, 'ventas.db'));
    const adm = campos => post(admin, '/admin', new URLSearchParams(campos));
    const paginaEmpleado = () => fetch(B + '/', { headers: { cookie: emp } }).then(x => x.text());
    const venderForm = pares => { const f = new FormData(); for (const [k, v] of pares) f.append(k, String(v)); return post(emp, '/', f); };

    // El dueño crea servicios; validaciones y duplicados
    assert.match(await adm({ accion: 'servicio', nombre: ' Peluquería ', precio: '12000' }), /Servicio guardado: Peluquería/);
    assert.match(await adm({ accion: 'servicio', nombre: 'peluquería', precio: '1000' }), /Ya existe el servicio/);
    assert.match(await adm({ accion: 'servicio', nombre: 'Gratis', precio: '0' }), /mayor que 0/);
    assert.match(await adm({ accion: 'servicio', nombre: '', precio: '500' }), /Escriba el nombre/);
    assert.match(await adm({ accion: 'servicio', nombre: 'Raro', precio: '12.5' }), /mayor que 0/);

    // El empleado lo ve en la lista, con su precio, y solo lo marca
    const idPelu = bd.prepare("select id from catalogo_servicios where nombre = 'Peluquería'").get().id;
    let pagina = await paginaEmpleado();
    assert.match(pagina, new RegExp('name="servicio" value="' + idPelu + '"'));
    assert.match(pagina, /Peluquería/);
    assert.match(pagina, /₡12[.,\s  ]000/);
    assert.doesNotMatch(pagina, /name="grooming_monto"/); // ya no se escribe el monto a mano

    // Dos servicios en una sola venta: una fila por servicio, un solo comprobante, precio del catálogo
    const tS = 'e'.repeat(31) + '1';
    assert.match(await venderForm([['empleado', 1], ['metodo', 'sinpe'], ['token', tS], ['servicio', idPelu], ['servicio', 2]]), /Venta registrada: Peluquería ₡12.* \+ Baño ₡5/);
    assert.equal(bd.prepare('select count(*) n from servicios where token = ?').get(tS).n, 2);
    const rcS = await fetch(B + '/?recibo=' + tS, { headers: { cookie: emp } }).then(x => x.text());
    assert.match(rcS, /Peluquería/);
    assert.match(rcS, /Baño/);
    assert.match(rcS, /TOTAL<\/span><span[^>]*>₡17[.,\s  ]000/);

    // El mismo servicio repetido en el formulario se cobra una sola vez
    assert.match(await venderForm([['empleado', 1], ['metodo', 'sinpe'], ['servicio', 3], ['servicio', 3]]), /Venta registrada: Corte ₡3[.,\s  ]000$|Venta registrada: Corte ₡3[^+]*&ok/);

    // Cambiar el precio no altera lo ya vendido; sí aplica a las ventas nuevas
    assert.match(await adm({ accion: 'servicio', id: String(idPelu), nombre: 'Peluquería', precio: '15000' }), /Servicio guardado/);
    assert.match(await paginaEmpleado(), /₡15[.,\s  ]000/);
    assert.equal(bd.prepare('select monto from servicios where token = ? and nombre = ?').get(tS, 'Peluquería').monto, 12000);

    // Eliminar: desaparece de la lista y ya no se puede vender, pero el historial lo conserva
    assert.match(await adm({ accion: 'servicio', id: String(idPelu), eliminar: '1' }), /Servicio eliminado: Peluquería/);
    assert.doesNotMatch(await paginaEmpleado(), /Peluquería/);
    assert.match(await venderForm([['empleado', 1], ['metodo', 'sinpe'], ['servicio', idPelu]]), /ya no está disponible/);
    assert.equal(bd.prepare('select count(*) n from servicios where token = ?').get(tS).n, 2);
    assert.match(await adm({ accion: 'servicio', nombre: 'peluquería', precio: '9000' }), /Servicio guardado/); // se reactiva
    assert.match(await paginaEmpleado(), /peluquería/i);

    // Productos: nombre, cantidad y precio; se venden como un animal, en su propio grupo
    assert.match(await adm({ accion: 'animal', clase: 'producto', tipo: 'Aserrín', cantidad: '20', precio: '2500' }), /Producto guardado: Aserrín/);
    assert.match(await adm({ accion: 'animal', clase: 'producto', tipo: 'Borucha', cantidad: '10', precio: '3000' }), /Producto guardado: Borucha/);
    assert.match(await adm({ accion: 'animal', clase: 'producto', tipo: 'Perro', cantidad: '1', precio: '1' }), /Ya existe un animal o producto/);
    assert.equal(bd.prepare("select clase from animales where tipo = 'Aserrín'").get().clase, 'producto');
    assert.equal(bd.prepare("select clase from animales where tipo = 'Conejo'").get().clase, 'animal');
    pagina = await paginaEmpleado();
    const grupoProductos = /<optgroup label="Productos">([\s\S]*?)<\/optgroup>/.exec(pagina)[1];
    const grupoAnimales = /<optgroup label="Animales">([\s\S]*?)<\/optgroup>/.exec(pagina)[1];
    assert.match(grupoProductos, /Aserrín/);
    assert.match(grupoProductos, /Borucha/);
    assert.doesNotMatch(grupoAnimales, /Aserrín/);
    assert.match(grupoAnimales, /Conejo/);
    const panelP = await fetch(B + '/admin', { headers: { cookie: admin } }).then(x => x.text());
    assert.match(panelP, /id="titulo-producto"/);
    assert.match(panelP, /name="clase" value="producto"/);

    const aserrin = bd.prepare("select id from animales where tipo = 'Aserrín'").get().id;
    const conejoId = bd.prepare("select id from animales where tipo = 'Conejo'").get().id;
    const conejosAntes = bd.prepare("select cantidad from animales where id = ?").get(conejoId).cantidad;
    const tP = 'f'.repeat(31) + '1';
    assert.match(await venderForm([['empleado', 1], ['metodo', 'tarjeta'], ['token', tP], ['animal', aserrin], ['cantidad', 4], ['animal', conejoId], ['cantidad', 1], ['servicio', 2]]), /Venta registrada: 4 Aserrín — ₡10[.,\s  ]000 \+ 1 Conejo.* \+ Baño/);
    assert.equal(bd.prepare('select cantidad from animales where id = ?').get(aserrin).cantidad, 16);
    assert.equal(bd.prepare('select cantidad from animales where id = ?').get(conejoId).cantidad, conejosAntes - 1);
    const rcP = await fetch(B + '/?recibo=' + tP, { headers: { cookie: emp } }).then(x => x.text());
    assert.match(rcP, /4 x Aserrín/);
    assert.match(rcP, /1 x Conejo/);
    assert.match(rcP, /Baño/);
    assert.match(rcP, /TOTAL<\/span><span[^>]*>₡35[.,\s  ]000/); // 10 000 + 20 000 + 5 000
    assert.match(await venderForm([['empleado', 1], ['metodo', 'sinpe'], ['animal', aserrin], ['cantidad', 999]]), /No hay suficientes Aserrín/);
    assert.match(await adm({ accion: 'animal', id: String(aserrin), eliminar: '1' }), /Producto eliminado: Aserrín/);
    assert.doesNotMatch(await paginaEmpleado(), /Aserrín/);
    bd.close();
  }

  // El dueño ve las facturas y su número aparece en las tablas
  {
    const tok = '9'.repeat(26) + 'ab12cd';
    const f = new FormData(); for (const [k, v] of [['empleado', 1], ['metodo', 'sinpe'], ['token', tok], ['servicio', 1]]) f.append(k, String(v));
    assert.match(await post(emp, '/', f), /Venta registrada/);
    const comoAdmin = ruta => fetch(B + ruta, { headers: { cookie: admin }, redirect: 'manual' });

    // Vista de la factura dentro del panel
    const vista = await comoAdmin('/admin/recibo/' + tok);
    assert.equal(vista.status, 200);
    const htmlV = await vista.text();
    assert.match(htmlV, /COMPROBANTE DE VENTA/);
    assert.match(htmlV, /AB12CD/);
    assert.match(htmlV, /Grooming/);
    assert.match(htmlV, /Imprimir factura/);
    assert.equal((await comoAdmin('/admin')).status, 200); // abrirla no le cierra la sesión al dueño

    // Solo el dueño: sin sesión o con el acceso de empleado va a la pantalla del PIN
    assert.match((await fetch(B + '/admin/recibo/' + tok, { redirect: 'manual' })).headers.get('location'), /\/login/);
    assert.match((await fetch(B + '/admin/recibo/' + tok, { headers: { cookie: emp }, redirect: 'manual' })).headers.get('location'), /\/login/);
    // Código inexistente o inválido
    for (const malo of ['abc', 'f'.repeat(32)]) {
      const r = await comoAdmin('/admin/recibo/' + malo);
      assert.match(decodeURIComponent(r.headers.get('location')), /No se encontró esa factura/);
    }

    // El número aparece en el panel y en el historial del dueño, con enlace a la factura
    for (const ruta of ['/admin', '/admin/historial']) {
      const h = await comoAdmin(ruta).then(r => r.text());
      assert.match(h, new RegExp('href="/admin/recibo/' + tok + '"'));
      assert.match(h, />AB12CD</);
      assert.match(h, /N° factura/);
    }
    // ...y en el historial de los empleados
    assert.match(await fetch(B + '/?ver=historial', { headers: { cookie: emp } }).then(r => r.text()), /N° AB12CD/);

    // Buscador por número (cualquier día; mayúsculas o minúsculas)
    for (const n of ['AB12CD', 'ab12cd', ' ab12cd ']) assert.equal((await comoAdmin('/admin/historial?n=' + encodeURIComponent(n))).headers.get('location'), '/admin/recibo/' + tok);
    assert.match(decodeURIComponent((await comoAdmin('/admin/historial?n=zzzzzz')).headers.get('location')), /No se encontró la factura N° ZZZZZZ/);
    assert.match(decodeURIComponent((await comoAdmin('/admin/historial?n=ab')).headers.get('location')), /No se encontró la factura/);
    assert.equal((await comoAdmin('/admin/historial?n=')).status, 200); // buscador vacío: muestra el día normal
  }

  // Sesión del dueño: caduca por inactividad (20 min) y se cierra al abrir la página de ventas
  const { DatabaseSync } = await import('node:sqlite');
  const sesiones = new DatabaseSync(path.join(dir, 'ventas.db'));
  const minutos = () => (Date.parse(sesiones.prepare('select expira from sesiones order by rowid desc limit 1').get().expira.replace(' ', 'T') + 'Z') - Date.now()) / 60000;
  assert.ok(minutos() > 18 && minutos() <= 20.5, 'la sesión debe durar ~20 min');
  sesiones.prepare("update sesiones set expira = datetime('now','-1 minute')").run(); // simula 20 min sin usar
  assert.equal((await fetch(B + '/admin', { headers: { cookie: admin }, redirect: 'manual' })).status, 302);
  const admin2 = await login('clave123');
  assert.equal((await fetch(B + '/admin', { headers: { cookie: admin2 } })).status, 200);
  assert.equal((await fetch(B + '/', { headers: { cookie: admin2 } })).status, 200); // el dueño abre la página de ventas
  assert.equal((await fetch(B + '/admin', { headers: { cookie: admin2 }, redirect: 'manual' })).status, 302); // ya no entra al panel
  assert.equal((await fetch(B + '/factura/' + factura.split('/').pop(), { headers: { cookie: admin2 }, redirect: 'manual' })).status, 302);
  // El dueño cambia el código: los aparatos autorizados deben escribir el nuevo
  {
    const adminX = await login('clave123');
    const cambio = await post(adminX, '/admin', new URLSearchParams({ accion: 'codigo', codigo: ' miLocal7 ' }));
    assert.match(cambio, /Código del local: MILOCAL7/);
    assert.equal((await fetch(B + '/', { headers: { cookie: emp }, redirect: 'manual' })).status, 302); // el aparato anterior ya no entra
    assert.match(decodeURIComponent((await acceso(codigo)).headers.get('location')), /Código incorrecto/); // el código viejo ya no sirve
    emp = (await acceso('milocal7')).headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(B + '/', { headers: { cookie: emp } })).status, 200);
    assert.match(await post(adminX, '/admin', new URLSearchParams({ accion: 'codigo', codigo: 'ab' })), /de 4 a 12 letras o números/);
    assert.match(await post(adminX, '/admin', new URLSearchParams({ accion: 'codigo', codigo: 'con espacio' })), /de 4 a 12 letras o números/);
    const generado = /Código del local: ([A-Z0-9]+)\./.exec(await post(adminX, '/admin', new URLSearchParams({ accion: 'codigo', generar: '1' })))[1];
    assert.match(generado, /^[A-HJ-NP-Z2-9]{6}$/);
    assert.notEqual(generado, 'MILOCAL7');

    // El dueño que abre la página de ventas queda autorizado en ese aparato, sin pedirle el código
    const admin3 = await login('clave123');
    const abre = await fetch(B + '/', { headers: { cookie: admin3 }, redirect: 'manual' });
    assert.equal(abre.status, 200);
    assert.match(abre.headers.get('set-cookie') ?? '', /(^|, )e=/);

    // Demasiados intentos fallidos: se bloquea esa dirección un rato (aunque acierte después)
    const desde = ip => fetch(B + '/acceso', { method: 'POST', headers: { origin: B, 'x-forwarded-for': ip }, body: new URLSearchParams({ codigo: 'NOES00' }), redirect: 'manual' });
    await Promise.all(Array.from({ length: 10 }, () => desde('9.9.9.9')));
    assert.match(decodeURIComponent((await desde('9.9.9.9')).headers.get('location')), /Demasiados intentos/);
    const otraIp = await fetch(B + '/acceso', { method: 'POST', headers: { origin: B, 'x-forwarded-for': '8.8.8.8' }, body: new URLSearchParams({ codigo: generado }), redirect: 'manual' });
    assert.equal(otraIp.headers.get('location'), '/'); // otra dirección no se ve afectada
  }

  console.log('OK');
} finally {
  srv.kill();
}
