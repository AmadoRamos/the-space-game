# The Space Game

Reimplementación de *The Space Game* (Casual Collective, v83) a partir del SWF
decompilado. El juego original es Flash/AS2; esto es un port al navegador.

Lo que falta está en [`TODO.md`](TODO.md). La especificación es [`GDD.md`](GDD.md).

## Reglas duras

1. **Solo JavaScript.** Backend incluido. Sin dependencias, sin `node_modules`,
   sin paso de compilación. Módulos ES que el navegador carga tal cual.
2. **Ningún número se inventa.** Todo valor de balance sale del bytecode y se
   cita con `archivo:línea` (`frame_2/DoAction.as:1393`). Si no está verificado,
   se marca como no verificado — nunca se presenta como si se supiera.
3. **La fuente de la verdad es `DATA/SWF/scripts/`**, el AS2 decompilado. El GDD
   lo resume; ante una discrepancia, gana el AS2.
4. **Fidelidad sobre intuición.** Cuando el original hace algo raro, se reproduce
   y se comenta por qué. Ejemplos ya en el código: el campo de asteroides pasa
   grados donde espera radianes, se drena la fuente de energía más lejana
   primero, y se puede colocar un edificio aislado que nunca llegará a
   construirse. Ninguno es un bug del port.

## Comandos

```bash
npm start      # servidor estático en http://localhost:8123
npm run check  # 61 aserciones del modelo de red
```

`npm run check` corre también dentro de la página: el resultado se pinta abajo a
la izquierda, verde o rojo. **Cualquier cambio en `sim.js` o `balance.js` se
verifica con él antes de darlo por bueno.**

## Estructura

| | |
|---|---|
| `web/balance.js` | Tablas de datos, `PM_PRNG`, generador del campo, niveles |
| `web/sim.js` | El modelo: grafo de energía, colocación, minado. Sin DOM. |
| `web/main.js` | Render SVG, entrada, HUD. Solo dibuja lo que el modelo dice. |
| `web/index.html` | Solo estructura: el `<svg>` del mundo y los paneles |
| `web/estilos.css` | Todo el CSS |
| `web/sprites.svg` | Los `<symbol>` y degradados; `main.js` los inyecta al arrancar |
| `web/sonido.js` | `sfx()` y la mezcla de las tres pistas; `main.js` decide cuándo suena |
| `web/sonidos/` | Los MP3 del SWF, copiados de `DATA/sounds/` |
| `web/serve.js` | Servidor estático (`node:http`) |
| `web/comprobaciones.js` | Las 61 aserciones que comparan el modelo con el oráculo |
| `web/check.js` | Las corre desde la CLI |
| `GDD.md` | Especificación completa con los valores reales |
| `TODO.md` | Lo que falta |
| `design/` | Canvas de diseño (`.dc.html`): sprites, pantallas, efectos |
| `DATA/SWF/scripts/` | AS2 decompilado — la fuente de la verdad |
| `DATA/Python/` | Oráculo de referencia con el que se verificó `sim.js`. **No es runtime y no se toca**: ni se porta ni se borra. |

`sim.js` no toca el DOM y `main.js` no toma decisiones de juego. Mantener esa
separación: es lo que permite que las mismas aserciones corran en Node y en el
navegador.

Los `<symbol>` de `web/sprites.svg` están copiados **literalmente** del canvas
de diseño. Si cambia un sprite, cambia en `design/` primero.

`sprites.svg` se inyecta en el documento con `fetch` + `DOMParser`, no se
referencia como `<use href="sprites.svg#id">`: los degradados
(`fill="url(#roca)"`) solo resuelven contra el documento propio, y así ningún
`href` del código cambia. Por eso `main.js` arranca con un `await`.

## Convenciones

- **Todo en español**: identificadores, comentarios, textos de interfaz y
  respuestas al usuario. El código ya lo está (`pintarMundo`, `bajoElCursor`,
  `construyendo`); seguir el mismo estilo.
- Los comentarios explican **por qué**, no qué. Los que citan el AS2 valen su
  peso en oro; los que narran la línea de abajo, no.
- Nada de abstracciones anticipadas. El proyecto no tiene capas.

## Trampas ya pisadas

- **Nada dentro de `#world` recibe eventos** (`#world * { pointer-events: none }`).
  Las capas se repintan enteras cada fotograma; si el `mousedown` cae sobre un
  elemento que desaparece antes del `mouseup`, Chrome no dispara el `click`. El
  acierto es geométrico, en `bajoElCursor()`. No añadir manejadores a los hijos.
- **Los clics sintéticos e instantáneos no prueban la interacción.** Se cuelan
  entre dos fotogramas; un clic humano dura ~100 ms. Probar con pulsación
  sostenida antes de dar por bueno cualquier arreglo de entrada.
- **En una pestaña oculta `requestAnimationFrame` se estrangula** y la simulación
  parece ir lenta. Es correcto: el clamp `Math.min(250, dt)` hace que el juego se
  pause al perder el foco. No es un bug que arreglar.
- **`_size` del original es el ancho del sprite**, no un radio, y las reglas de
  colocación lo usan crudo (`dist < n._size`). El dibujo es mayor que el `_size`
  a propósito (ver `TAM` en `main.js`): el solape visual entre edificios
  permitidos no es un bug.
- **`Math.round` de AS2 redondea la mitad hacia +∞.** El de JS coincide; el de
  Python no (redondea al par) y necesita `floor(x + 0.5)`.
