// Mantiene al día las cantidades en pantalla (cada 2 s, solo con la pestaña a la vista), sin recargar ni borrar lo escrito.
const CADA = 2000;
let temporizador: number | undefined;

async function actualizar() {
  let filas: { id: number; cantidad: number }[];
  try {
    const r = await fetch('/stock', { headers: { accept: 'application/json' } });
    if (!r.ok) return; // sesión vencida o sin red: se reintenta en el próximo ciclo
    filas = await r.json();
  } catch { return; }
  const cant = new Map(filas.map(f => [String(f.id), f.cantidad]));

  // Pantalla de ventas: "(quedan N)", tope por línea y animales agotados (también en la línea en blanco de "Agregar otro")
  const lineas = document.querySelector('#lineas');
  if (lineas) {
    const moldes = (window as any).__moldeVenta as HTMLElement | undefined;
    for (const o of [...lineas.querySelectorAll<HTMLOptionElement>('option[value]'), ...(moldes?.querySelectorAll<HTMLOptionElement>('option[value]') ?? [])]) {
      const n = cant.get(o.value);
      if (!o.value || n === undefined) continue;
      o.dataset.stock = String(n);
      o.textContent = (o.textContent ?? '').replace(/\(quedan \d+\)|\(agotado\)/, n > 0 ? `(quedan ${n})` : '(agotado)');
      o.hidden = n <= 0 && !o.selected; // agotado: se oculta de la lista (la opción elegida en una línea se queda)
    }
    lineas.querySelectorAll<HTMLInputElement>('input[name=cantidad]').forEach(i => i.dispatchEvent(new Event('input', { bubbles: true })));
  }

  // Panel del dueño: solo si el campo no se está editando
  document.querySelectorAll<HTMLFormElement>('form.animal-row-existing').forEach(f => {
    const n = cant.get(f.querySelector<HTMLInputElement>('input[name=id]')?.value ?? '');
    const campo = f.querySelector<HTMLInputElement>('input[name=cantidad]');
    if (n === undefined || !campo || document.activeElement === campo || campo.value !== campo.defaultValue) return;
    campo.value = campo.defaultValue = String(n);
  });
}

document.addEventListener('astro:page-load', () => {
  clearInterval(temporizador);
  if (!document.querySelector('#lineas, form.animal-row-existing')) return;
  temporizador = window.setInterval(() => { if (!document.hidden) actualizar(); }, CADA);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && temporizador) actualizar(); });
