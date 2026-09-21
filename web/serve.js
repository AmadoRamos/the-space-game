// Servidor estático del prototipo. Sin dependencias: solo node:http.
//
//   node web/serve.js [puerto]
//
// Hace dos cosas que importan en desarrollo:
//   1. Sirve los .js como application/javascript. Sin eso el navegador rechaza
//      <script type="module"> sin más explicación que un error de MIME.
//   2. No cachea ni responde 304, así que al editar un archivo basta recargar.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('.', import.meta.url));
// el argumento manda; PORT lo pone la vista previa del editor cuando el 8123 está ocupado
const PUERTO = Number(process.argv[2]) || Number(process.env.PORT) || 8123;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';

  // normalize + comprobación de prefijo: nada fuera de web/
  const ruta = join(RAIZ, normalize(rel));
  if (!ruta.startsWith(RAIZ.endsWith(sep) ? RAIZ : RAIZ + sep)) {
    res.writeHead(403).end('403');
    return;
  }

  try {
    const info = await stat(ruta);
    if (info.isDirectory()) throw new Error('es un directorio');
    const cuerpo = await readFile(ruta);
    res.writeHead(200, {
      'Content-Type': MIME[extname(ruta).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': cuerpo.length,
      'Cache-Control': 'no-store, max-age=0',
    });
    res.end(cuerpo);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
  }
}).on('error', (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.error(`El puerto ${PUERTO} ya está en uso. Prueba otro: node web/serve.js 8124`);
  process.exit(1);
}).listen(PUERTO, '127.0.0.1', () => {
  console.log(`sirviendo ${RAIZ} en http://localhost:${PUERTO}`);
});
