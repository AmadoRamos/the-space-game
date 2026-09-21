# The Space Game

Port al navegador de *The Space Game* (Casual Collective, 2009), un RTS de
gestión de red energética y defensa de torres. El original es Flash/AS2
(`thespacegame.v83.swf`); esta es una reimplementación en JavaScript puro
hecha a partir del bytecode decompilado.

## Jugar

```bash
npm start
```

Abre <http://localhost:8123>. Requiere Node ≥ 18; no hay dependencias ni paso
de compilación.

## Verificar

```bash
npm run check
```

Corre 61 aserciones que comparan el modelo de la red (`web/sim.js`) con el
oráculo de referencia. Las mismas aserciones corren dentro de la página y
pintan el resultado abajo a la izquierda.

## Principios

- **Ningún número se inventa.** Todo valor de balance sale del AS2 decompilado
  (`DATA/SWF/scripts/`) y se cita con `archivo:línea`. Lo no verificado se marca
  como tal.
- **Fidelidad sobre intuición.** Las rarezas del original se reproducen y se
  comentan: el campo de asteroides pasa grados donde espera radianes, se drena
  primero la fuente de energía más lejana, la mejora de la reparadora deja su
  valor en `NaN`. No son bugs del port.
- **Solo JavaScript**, módulos ES cargados tal cual por el navegador. El
  servidor es `node:http`.
- **Todo en español**: código, comentarios, interfaz y documentación.

## Estructura

| | |
|---|---|
| `web/sim.js` | El modelo: red de energía, edificios, naves, proyectiles. Sin DOM. |
| `web/balance.js` | Tablas de datos, `PM_PRNG`, generador del campo, niveles y oleadas |
| `web/main.js` | Render SVG, entrada, HUD. Solo dibuja lo que dice el modelo. |
| `web/sonido.js` | Efectos y las tres pistas de música del SWF |
| `web/comprobaciones.js` | Las 61 aserciones; `check.js` las lanza desde la CLI |
| `GDD.md` | Especificación completa con los valores reales y sus citas |
| `TODO.md` | Estado del port y lo que falta |
| `CLAUDE.md` | Reglas de trabajo y trampas ya pisadas |
| `design/` | Canvas de diseño de sprites y pantallas; `web/sprites.svg` se copia de aquí |
| `DATA/SWF/scripts/` | AS2 decompilado — la fuente de la verdad |
| `DATA/Python/` | Oráculo de referencia con el que se verificó el modelo. No es runtime. |

## Diseño

Los sprites y pantallas están dibujados como SVG en canvas de diseño
(`design/*.dc.html`, se abren en el navegador). `web/sprites.svg` copia sus
`<symbol>` literalmente: si cambia un sprite, cambia aquí primero.

**Assets**

| | |
|---|---|
| [Edificios](design/Edificios.dc.html) | Relay, minero, planta, almacén, reparadora y su bot |
| [Armas](design/Armas.dc.html) | Torreta láser, Pulse, THEL y lanzamisiles |
| [Enemigos](design/Enemigos.dc.html) | Las siete naves (`e1`–`e7`) |
| [Asteroides](design/Asteroides.dc.html) | Rocas, roca agotada y los degradados |
| [Efectos](design/Efectos.dc.html) | Láser, minado, misil, salpicadura y destrucción, tick a tick |
| [Estados](design/Estados.dc.html) | Colocación (válido, bloqueado) y paneles de edificio y asteroide seleccionados |
| [Avisos](design/Avisos.dc.html) | Iconos de alerta, info y ok |
| [Escala](design/Escala.dc.html) | Prueba de resolución y cómo se exportan los sprites |

**Pantallas**

| | |
|---|---|
| [Main](design/Main.dc.html) | El mundo en juego con HUD |
| [Menu](design/Menu.dc.html) | Menú principal y tarjetas de dificultad |
| [FinVictoria](design/FinVictoria.dc.html) / [FinDerrota](design/FinDerrota.dc.html) | Pantallas de fin con las gráficas |

## Estado

Jugable de principio a fin: red de energía, los siete edificios, los siete
tipos de nave, los modos y misiones del original, menú y pantallas de fin,
audio. El detalle está en [`TODO.md`](TODO.md) y lo que **no** se va a portar
(anti-trampas `SecNum`, integración con el portal `CCAPI`) al final del mismo.

## Créditos

Juego original de Casual Collective. Este repositorio no incluye el SWF ni lo
modifica; contiene una reimplementación independiente y los recursos
extraídos para verificarla.
