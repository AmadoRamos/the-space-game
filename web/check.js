// Comprobación del modelo desde la línea de órdenes: `npm run check`.
// Las mismas aserciones corren en el navegador (main.js las pinta abajo a la
// izquierda), así que una desviación se ve en los dos sitios.

import { selfCheck } from './comprobaciones.js';

try {
  const lineas = selfCheck();
  for (const l of lineas) console.log('  ' + l);
  console.log(`OK - ${lineas.length} comprobaciones del modelo de red`);
} catch (err) {
  console.error('FALLO: ' + err.message);
  process.exit(1);
}
