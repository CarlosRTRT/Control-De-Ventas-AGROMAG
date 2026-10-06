import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// En la VPS se compila con SITE_DOMAIN=ventas.midominio.com para que Astro confíe en el HTTPS que termina nginx.
const dominio = process.env.SITE_DOMAIN;

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  security: dominio ? { allowedDomains: [{ hostname: dominio, protocol: 'https' }] } : {},
});
