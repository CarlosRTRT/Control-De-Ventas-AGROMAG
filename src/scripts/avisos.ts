// Los avisos (?msg=...) se ocultan solos y se borran de la URL para que no vuelvan al recargar.
document.addEventListener('astro:page-load', () => {
  const aviso = document.querySelector<HTMLElement>('.aviso');
  if (!aviso) return;

  const url = new URL(location.href);
  if (url.searchParams.has('msg')) {
    url.searchParams.delete('msg');
    url.searchParams.delete('ok');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  }

  const ok = aviso.classList.contains('aviso-ok');
  setTimeout(() => {
    aviso.style.maxHeight = aviso.offsetHeight + 'px';
    void aviso.offsetHeight; // fija la altura antes de animar el cierre
    aviso.classList.add('saliendo');
    setTimeout(() => aviso.remove(), 450);
  }, ok ? 3500 : 7000); // los errores se quedan más tiempo para poder leerlos
});
