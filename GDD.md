# The Space Game — Documento de diseño (GDD)

Especificación del juego reconstruida desde el bytecode del SWF original.
Todos los valores numéricos citan su archivo de origen en `DATA/SWF/scripts/`.

---

## 1. Identidad y contexto

| | |
|---|---|
| **Título** | The Space Game |
| **Autor** | Casual Collective (portal `casualcollective.com`) |
| **Versión** | `thespacegame.v83.swf` — el menú del wrapper muestra `25th Feb v1.07` |
| **Tecnología** | Flash SWF comprimido (`CWS`), versión 10, **ActionScript 2** |
| **Frame rate** | 40 fps (dos frames: carga + juego) |
| **Género** | RTS/tower-defense de gestión de red energética |
| **Ejecución local** | Flashpoint — `C:\Flashpoint\FPSoftware\Flash\flashplayer_32_sa.exe` |

### Arquitectura del SWF

El juego es AS2 con 22 clases en `__Packages`:

```
buildingEnergy  buildingRelay  buildingMiner  buildingStore
buildingRepair  buildingLaser  buildingRocket
ship1..ship7    rocket         asteroid       asteroidField
levels          cells          PM_PRNG        graph          SecNum
```

Todo el bucle de juego y la lógica de red viven en `frame_2/DoAction.as`
(2115 líneas, 43 funciones). El **menú principal no está en este SWF**: lo aporta
`widget.swf` del portal, que llama a `_root.setupLevel(n, showReminder, sameseed)`.
Por eso el menú del wrapper (Training / Missions / Mining Modes / Survival Modes /
Bonus Modes) mapea sobre los números de nivel de `levels.as`.

El SWF venía ofuscado (dispatcher de control de flujo con nombres `\x01`); la
exportación en `DATA/SWF/scripts/` está desofuscada con `autoDeobfuscate=1`.

---

## 2. Bucle jugable

El jugador aterriza en un campo de asteroides con **una planta solar ya colocada
en el origen** y una bolsa de minerales. No hay base con vida propia: *el jugador
es su red de edificios*.

```
   minerales ──compra──► edificio (fantasma)
                             │
                             │ colocación válida: se enlaza a la red
                             ▼
   energía de la red ──construye──► edificio operativo
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        minero extrae   torreta dispara  relay extiende
        minerales de     (consume         el alcance
        asteroides       energía)         de la red
              │
              └──────► más minerales ──► más edificios ──► ciclo
```

Los enemigos llegan en oleadas programadas desde el borde del mapa (radio 2500)
hacia el centro. Atacan el primer edificio que encuentran en su rango; si no
encuentran nada, siguen rumbo al centro.

### Las dos monedas y su tensión

El diseño central es que **energía y minerales no son intercambiables**:

- Los **minerales** se compran con tiempo de minado y se gastan al colocar y al mejorar.
- La **energía** no se almacena globalmente: es un flujo que viaja por una **topología
  física** de enlaces. Un minero sin camino a una planta solar no mina, aunque
  sobre energía en la otra punta del mapa.

De ahí sale toda la decisión táctica: expandir la red hacia asteroides ricos te
obliga a defender más superficie con menos densidad de torretas.

### Fases de un tick (`tickGame` → `tickGameB`)

`tickGame` corre una vez por frame (40 fps) y llama a `tickGameB` según
`_gameSpeed`: `0` = pausa, `0.5` = lento (un tick cada 2 frames), `1` = normal,
`>1` = rápido (N ticks por frame).

`tickGame` — capa de presentación, `frame_2/DoAction.as:193`:

1. Cada 20 frames: recalcula energía total y almacenada de la red, ingreso de
   minerales (`_mineralIncome`), y limpia las barras de oleada caducadas (20 s).
2. Cada 10 frames: evalúa la condición de victoria del modo y refresca el HUD.
3. Despacha `tickGameB` según velocidad.

`tickGameB` — simulación, `frame_2/DoAction.as:425`:

1. `_timerStep` llega a 40 → `_playTime += 1`. **40 ticks = 1 segundo.**
2. Comprueba la siguiente oleada (por tiempo, o por % minado en las misiones).
3. Vacía una entrada de la cola de spawn (`spawnQue`) por tick.
4. **Ticks alternos**: en ticks pares se mueven naves/misiles/bots; en ticks
   impares se procesan los nodos de la red.
5. En los ticks de red, `_tickRelays` cicla 1..8: los **relays** solo tickean
   cuando vale 1, los **mineros** solo cuando vale 3, y el resto de edificios
   tickean siempre. Esto reparte el coste de CPU y ralentiza mineros y relays
   respecto a las torretas.
6. Cada 40 frames: tick de asteroides (solo repinta su agotamiento).
7. Destruye lo marcado, avanza un paso del recálculo de rutas, recolecta datos
   del gráfico.

> **ponytail:** el orden alterno par/impar y el ciclo de 8 de `_tickRelays` son
> optimización de CPU de 2009, no diseño. Una reimplementación puede tickear todo
> cada tick si ajusta las cadencias en consecuencia.

---

## 3. Recursos

### Minerales

- Moneda global, sin tope. Se muestran en el HUD con color según cantidad
  (`frame_2/DoAction.as:270`): verde >200, lima ≤200, ámbar ≤100, naranja ≤50, rojo ≤10.
- **Fuente única**: mineros extrayendo asteroides.
- **Gastos**: colocar edificios, mejorar edificios, y **5 minerales por cada
  misil lanzado** (`buildingRocket.as`, `_root.charge(5)`).
- `charge(v)` (`frame_2/DoAction.as:1794`) es atómico: si no alcanza, la acción no ocurre.

### Energía

- **No hay stock global.** Cada edificio tiene su propio `_energy` / `_maxEnergy`.
- Solo las plantas solares **generan**; los almacenes **acumulan**; relays,
  plantas y almacenes **propagan** (`_relayEnergy = true`).
- Mineros, torretas y reparadores son **consumidores terminales**: no propagan y
  solo admiten **un** enlace.
- El HUD "N energy (X%)" suma `_energy` y `_maxEnergy` de todos los nodos de
  `_energyQue` (plantas + almacenes) ya construidos.

### Asteroides

`asteroidField.genAsteroids()` (`__Packages/asteroidField.as`):

- Minerales de un asteroide = **`(5 + tamaño) × 52`**, con `tamaño ∈ [1, 21]` por defecto.
- La distribución es una elipse rotada: radio `nextIntRange(50, scale × 2.5)`,
  comprimido a 0.3 en el eje X antes de rotar. Nunca se genera dentro de ±50 del centro.
- Generación **determinista** vía `PM_PRNG` (Park–Miller). `sameseed = 1` reusa
  `_root.lastSeed`, que es lo que permite reintentar exactamente el mismo mapa.
- Un asteroide agotado (`_energy <= 0`) se elimina de la lista `_planets` del minero.
- **Agotamiento visible en saltos del 10 %** (`asteroid.as:32`): el asteroide son dos
  dibujos superpuestos, `mcFull` y `mcEmpty`, y cada tick recalcula
  `mcEmpty._alpha = int((100 − int(100 / maxEnergy × energy)) / 10) × 10`. O sea, la
  capa "seca" se funde por encima de la llena en once escalones discretos, no de
  forma continua. Es un dato de presentación, pero fija el diseño del asset.
- `mcFull` y `mcEmpty` van a `gotoAndStop(tamaño)`: el original dibuja **21
  fotogramas distintos**, uno por tamaño, en lugar de escalar uno solo.
- Cada roca se rota `índice × 10°` al generarse (`asteroidField.as:88`), así que
  ninguna silueta puede tener una orientación "correcta".

---

## 4. La red de energía

### Reglas de colocación (`tempLink`, `frame_2/DoAction.as:1384`)

Un edificio fantasma se valida en cada movimiento del ratón (rejilla de 5 px):

1. **Sin solapamiento**: la distancia a cualquier nodo o asteroide debe ser mayor
   que el `_size` de ambos.
2. **Enlace válido**: distancia menor que el `_energyRange` de *ambos* extremos
   (90 para todos los edificios).
3. Un **relay** admite como máximo **6 enlaces**.
4. Un edificio **no propagador** (minero, torreta, reparador) admite **1 solo enlace**.
5. Los enlaces **no pueden cruzarse** con enlaces existentes (`intersects()`,
   intersección segmento-círculo, `frame_2/DoAction.as:1548`). Un cruce marca el
   enlace en rojo; una colisión de tipo 2 invalida la posición por completo.
6. Un **minero** además exige al menos un asteroide con energía dentro de
   `_mineRange` (35) medido desde el borde del asteroide.

Colores de línea: `colEnergy` (enlace bueno), `colDeadEnd` (a un consumidor
terminal), `colBlocked` (cruce).

### Cálculo de rutas (`path` / `pathB`, `frame_2/DoAction.as:1223`)

Cuando la topología cambia (se construye o destruye una planta, un almacén, o un
nodo con más de un enlace) se dispara `path()`, que invalida las rutas y encola
`_pathStep = número de fuentes`. Luego `pathB()` procesa **una fuente por tick**:

- BFS desde la fuente `m` por los nodos con `_relayEnergy` ya construidos.
- Cada nodo guarda `_mines[m] = { mine: fuente, depth: saltos, path: [...] }`.
- `depth` inicial 1000 = inalcanzable.

En realidad `pathB()` corre en ticks **alternos** (`_pathTick`,
`frame_2/DoAction.as:565-577`): una fuente cada dos ticks. Y como `path()`
empieza vaciando `_mines` de todos los nodos, hasta que `pathB()` llega a una
fuente nadie bebe de ella: cada obra de fuente o de relay con dos cables y cada
derribo (`destroy`, `:715-721`) apagan la red `2 × fuentes` ticks. No es una
optimización sin efecto: es balance, y el port lo reproduce (`Network.path` /
`pathB` / `_pathStepTick` en `sim.js`).

`quickPath(A, B)` (`:1208`), que usa `link()` cuando el nodo nuevo cuelga de un
solo cable a un no-fuente ya construido, copia las rutas de A un salto más
lejos **incluidas las inalcanzables**: la ruta vacía pasa a ser `[A]`, y
`requestEnergy` la da por buena. Hasta el siguiente `path()`, B bebe de fuentes
a las que A no llega, y si A es un minero, a través de él. Se reproduce.

### Consumo (`requestEnergy(node, needs)`, `frame_2/DoAction.as:1309`)

```
1. Ordena las fuentes alcanzables por depth DESCENDENTE  (la más lejana primero)
2. Para cada fuente con ruta:
      take = min(fuente._energy, needs - acumulado)
      fuente._energy -= take
      dibuja el rayo por la ruta
      si acumulado >= needs: corta
3. Devuelve el total conseguido (puede ser menor que lo pedido)
```

Dos consecuencias de diseño:

- **Se drena primero la fuente más lejana**, conservando la energía cercana para
  quien la necesite con más urgencia. No es un reparto proporcional: es
  *first-come, first-served* en el orden de tick de los consumidores.
- Un almacén nunca pide energía a otro almacén (evita bucles de trasvase).

### Construcción pagada con energía

Todo edificio nace con `_construction = 0` y necesita llegar a
`_targetConstruction`. Cada `_constructionTick` ticks pide **1 de energía** a la
red y, si la consigue, `_construction += 1`. Al completarse suena `bBuilt` y el
edificio pasa a `level<N>`.

Esto significa que **un edificio recién comprado no funciona hasta que la red le
haya bombeado su coste en energía**, y que una red saturada retrasa toda la
expansión. Mejorar un edificio lo devuelve al estado "en construcción" con un
`_targetConstruction` mayor.

---

## 5. Edificios

Costes de compra, `build()` en `frame_2/DoAction.as:1657` (verificados en el HUD
del juego en ejecución):

| Edificio | Tecla | Coste | Alcance de red |
|---|---|---|---|
| Relay | `1` | **20** | 90 |
| Miner | `2` | **45** | 90 |
| Energy (planta solar) | `3` | **200** | 90 |
| Store (almacén) | `4` | **300** | 90 |
| Repair (reparadora) | `5` | **300** | 90 |
| Laser (torreta) | `6` | **100** | 90 |
| Rocket (lanzamisiles) | `7` | **400** | 90 |

**Venta** (`sell()`, `frame_2/DoAction.as:1822`): devuelve
`int(_value × vida/vidaMáxima)`. `_value` arranca en el precio de compra y crece
la mitad de cada mejora pagada — o sea, **a vida completa recuperas el 100 % de lo
invertido**. Vender un minero además vende automáticamente **todos los demás
mineros sin asteroide asignado**.

### 5.1 Planta solar — `buildingEnergy`

| Nivel | Coste mejora | Vida | `maxEnergy` | Eficiencia | `targetConstruction` | `constructionTick` |
|---|---|---|---|---|---|---|
| 1 | — | 600 | 4 | 0.30 | 10 | 10 |
| 2 | 200 | 800 | 9 | 0.70 | 20 | 8 |
| 3 | 200 | 1000 | 14 | 1.00 | 30 | 6 |

- **Generación**: cada 10 ticks de edificio produce `3 × eficiencia`, hasta `maxEnergy`
  (`buildingEnergy.as`, bloque `_tickStep`). Nivel 1 → 0.9 por pulso; nivel 3 → 3.0.
- Tamaño 25, propaga energía, `minDepth = 0` (es raíz de la red).
- Mejorarla es **muy** rentable: ×3.33 la eficiencia y ×3.5 el buffer por 400 minerales
  totales, contra 200 por una planta nueva que aporta solo 0.9/pulso.
- A partir del nivel 2 la construcción **no consume energía de la red**
  (`_buildEnergy.SetNum(1)` incondicional): las mejoras de planta son gratis en energía.

### 5.2 Relay — `buildingRelay`

| | |
|---|---|
| Coste | 20 |
| Vida | 100 |
| Alcance | 90 |
| `targetConstruction` | 10, en pasos de **2** |
| Enlaces máximos | **6** |
| Mejoras | ninguna |

Extensor puro de la red. Barato, frágil, y el punto único de fallo típico: si cae
un relay que articula una rama, todos los mineros aguas abajo se quedan sin energía.

Su construcción es la más rápida del juego y no sigue el patrón de los demás:
cada tick propio pide 1 de energía y, si consigue **≥ 0.5**, avanza **2 pasos** de
golpe descartando el resto. Cinco ticks de relay (~2.3 s) y está en pie. El campo
`constructionTick = 2` que declara el constructor **nunca se lee** — `tick()` pone
`_constructionStep` a 0 y no lo consulta.

### 5.3 Minero — `buildingMiner`

| Nivel | Coste mejora | Vida | `mineQuantity` | `targetConstruction` |
|---|---|---|---|---|
| 1 | — | 300 | 4 | 10 |
| 2 | 100 | 500 | **10** | 15 |

- `mineRange` 35, `mineRate` 60, `maxEnergy` 1, tamaño 15.
- **Ciclo de minado** (`buildingMiner.as`, `tick()`): el minero acumula
  `_mineTicker += 8` por tick propio; cuando llega a 60 y tiene `_energy >= 1`,
  extrae `min(mineQuantity, energía del asteroide)` minerales, gasta su energía y
  dibuja el rayo verde. Si no tenía energía, marca `mcLow` y no extrae.
- El asteroide objetivo se elige **al azar** entre los que tiene en rango
  (`_planets[random(...)]`), no el más cercano ni el más rico.
- El rayo **no apunta al centro de la roca** (`buildingMiner.as:265`): el extremo cae
  en `asteroide + sin/cos(random(360)) × (_size / 2)`, es decir un punto al azar
  dentro de la mitad del radio, y se vuelve a sortear en cada extracción.
- **La mejora es la mejor compra del juego**: por 100 minerales pasa de 4 a 10 por
  ciclo (+150 % de ingreso) frente a 45 por un minero nuevo que da 4. El mensaje de
  fin de partida del propio juego lo dice: *"build A LOT of upgraded miners"*.
- El HUD calcula "minerals per minute" como `Σ mineQuantity × 20`
  (`frame_2/DoAction.as:271`) — una estimación nominal, algo optimista frente a la
  cadencia real de tick.

### 5.4 Almacén — `buildingStore`

| Nivel | Coste mejora | Vida | `maxEnergy` | `targetConstruction` |
|---|---|---|---|---|
| 1 | — | 500 | 200 | 10 |
| 2 | 500 | 750 | **600** | 20 |

Batería de la red: cada 20 ticks pide a la red toda la energía que le falta y la
guarda. Propaga energía y cuenta como fuente en el BFS, así que **actúa de planta
solar diferida**: absorbe el excedente de producción y lo devuelve durante los
picos de disparo. No pide energía a otros almacenes.

### 5.5 Reparadora — `buildingRepair`

| Nivel | Coste mejora | Vida | `repairRange` |
|---|---|---|---|
| 1 | — | 400 | 200 |
| 2 | 150 | 600 | 300 |

- `maxEnergy` 5, hasta **4 bots** simultáneos (`_maxRepairBots`), reasignación de
  objetivos cada 30 ticks (`_targetTick`).
- Los bots se fabrican gastando energía (`_shipConstructionStep` se descuenta con
  `requestEnergy`), vuelan al edificio dañado y lo reparan.
- **No propaga energía** (`_relayEnergy = false`): es hoja de la red, un solo enlace.

### 5.6 Torreta láser — `buildingLaser`

Es tres armas distintas bajo el mismo edificio. Se compra por 100 y luego se
**bifurca** con teclas dedicadas (`DefineSprite_1084/frame_1/DoAction.as:164`):
`P` → Pulse (100 más), `T` → THEL (500 más). La torreta base no admite la mejora
genérica (`U`/`espacio`).

**Base (subType 0)** — `_damage` 30, `fireRange` 90, `fireCooldown` 20,
`energyNeeded` 2, vida 200. Es un stub barato: sirve de tapón inicial, no escala.

**Pulse (subType 1)** — antiaéreo de cadencia, la respuesta a Fighters y Swarmers:

| Nivel | Coste | Alcance | Cooldown | Daño | Energía | Vida |
|---|---|---|---|---|---|---|
| 1 | 100 | 110 | 10 | 12 | 5 | 300 |
| 2 | 150 | 115 | 8 | 14 | 10 | 500 |
| 3 | 300 | 130 | 6 | 16 | 15 | 900 |

**THEL / plasma (subType 2)** — haz continuo de largo alcance, la respuesta a
Motherships y naves de misiles:

| Nivel | Coste | Alcance | Daño/tick | Energía | Vida |
|---|---|---|---|---|---|
| 1 | 500 | 200 | 1 | 10 | 400 |
| 2 | 800 | 290 | 5 | 20 | 600 |
| 3 | 1000 | 390 | 10 | 35 | 960 |

- El THEL tiene **rampa de calentamiento**: el daño efectivo es
  `_damage + (_fireStart − 39) / 4`, con `_fireStart` arrancando en 40 al fijar
  blanco y subiendo 1 por tick **sin tope** mientras lo mantiene
  (`buildingLaser.as:366-461`). Lo que acota la rampa es la energía: cada tick
  cuesta `daño/20`, y cuando no llega `_fireStart` cae a 20 y el haz se apaga
  hasta volver a 40. Cambiar de blanco reinicia la rampa — castiga a los
  enjambres y premia a los blancos grandes. Los costes de mejora son 800 y 1000
  (`_upgradeCost` tras convertir y tras el nivel 2), no 1000 y 2000.
- El THEL **no dispara a misiles** (`_incRockets = false`); el Pulse sí.
- Prioridad de objetivo: si algo la está atacando (`_attackingMe`), esa nave manda.
- Consumo: cada torreta pide `energyNeeded / 2` a la red cuando su reserva baja de
  ese umbral. Sin energía, no dispara.

**Cómo se dibuja un láser** (`fire()`, `frame_2/DoAction.as:1152`). No es un
proyectil: es una línea vectorial creada en `mcLasers`, y el daño se resta en el
**mismo fotograma** en que se traza (`target._life.AddNum(-damage)`).

- Vive **2 ticks** — 50 ms a 40 fps — o **4** si el jugador activa la opción
  «láseres lentos» (`optSL`).
- Alfa `80 + random(20)`: parpadea solo, sin animación.
- `thickness` es lo único que distingue visualmente las armas: 1 por defecto,
  3 para el haz de la nodriza.
- Color por defecto rojo (`0xFF0000`) si el tirador es enemigo, verde (`0x00FF00`)
  si es del jugador; cada clase puede pasar el suyo.
- Si un enemigo dispara a una torreta cuyo `fireRange` es **mayor o igual** que el
  suyo, la torreta marca a ese atacante como `_attackingMe` y le da prioridad.

### 5.7 Lanzamisiles — `buildingRocket`

| Nivel | Coste mejora | Vida | Misiles/salva | Alcance | Salpicadura | Daño | `maxEnergy` |
|---|---|---|---|---|---|---|---|
| 1 | — | 500 | 1 | 400 | 40 | 450 | 2 |
| 2 | 500 | 520 | 2 | 480 | 44 | 500 | 3 |
| 3 | 1000 | 540 | 4 | 576 | 48.4 | 550 | 5 |

- La única arma con **coste por disparo**: cada misil cuesta **5 minerales + 1 energía**.
- Salva: `_fireCount = _rockets` misiles, uno cada 15 ticks (`_fireTick`), luego
  200 ticks de recarga (`_fireStep`) si tenía blanco, 20 si no.
- Alcance 400 al nivel 1 — el doble que un THEL de nivel 1. Es el arma de
  interceptación a distancia, y con salpicadura, la respuesta a las oleadas densas.
- Se puede desactivar globalmente con `toggleMissiles()` para dejar de sangrar
  minerales cuando la economía va justa.

**Física del misil** (`__Packages/rocket.as`). A diferencia del láser, sí es un
objeto con vida propia en `_movingQue`:

- Sale a velocidad 1 y acelera `+0.05` por tick hasta **4** (misil enemigo) u
  **8** (misil del jugador).
- Gira `(ánguloDeseado − rotación) / _easing` por tick. `_easing` arranca en
  `distancia / 5` al fijar blanco y baja de 1 en 1 hasta un suelo de 2: **el giro
  se cierra conforme se acerca**.
- `_fuel = 300` ticks; agotado, desaparece sin detonar.
- Detona al entrar en **15 unidades** del blanco. Si pierde el blanco, rebusca uno
  nuevo en radio 100 cada 10 ticks.

**Salpicadura** (`splash()`, `frame_2/DoAction.as:1200`). El blanco recibe el daño
íntegro; todo lo demás dentro del radio recibe
`daño / radio × (radio − distancia)` — **caída lineal hasta cero en el borde**.

**Excepción de los Ringers**: un misil del jugador contra un `ship4` hace
`daño / 15` y le pone `mcShield._alpha = 100` (`rocket.as:105`). Con 550 de daño
se quedan 37. El anillo de esa nave es, literalmente, blindaje antimisil.

---

## 6. Enemigos

Todas las naves entran desde un radio de 2500 alrededor del centro, en el ángulo
de la oleada ± dispersión. Vida = `200 × HPmulti` (`×8` adicional para las
Mothership). Daño = `damage / 2` del parámetro de la oleada (100 por defecto → 50).
Fuente: `spawnQue()`, `frame_2/DoAction.as:1065`.

| # | Nombre UI | Clase | Vel. | Alcance | Arma | Táctica |
|---|---|---|---|---|---|---|
| 1 | **Fighters** | `ship1` | 0.8–1.1 | 70 | Láser, `daño/20` por pulso, ciclo 50 | Caza estándar. Reasigna blanco cada 20–30 ticks. Masa barata. |
| 2 | **Missile** | `ship2` | 0.8–1.1 | **200** | Misil `daño` completo, salpicadura 30, cada 90 ticks | Artillería. Dispara desde fuera del alcance de casi todo salvo el lanzamisiles y el THEL 2+. |
| 3 | **Exploding** | `ship3` | 1.8–2.1 | 70 | Kamikaze: se frena, cuenta 60 ticks de mecha y detona por `daño × 1.2` en radio 100 | Se puede matar durante la mecha. Rápida: llega antes de que reacciones. |
| 4 | **Ringers** | `ship4` | 2.0–2.5 | 60 | Se **detiene** junto al blanco y hace láser continuo `daño/80` (color `0x62A400`) | Se ancla al edificio. Su escudo **no es decorativo**: absorbe misiles (`daño/15`, ver §5.7). Mátalos con láser, no con misiles. |
| 5 | **Swarmers** | `ship5` | 2.8–3.1 | 70 | Láser `daño/10`, ciclo 30–40, tamaño 5 | Enjambre rápido y pequeño. El Pulse es la respuesta; el THEL las pierde por la rampa. |
| 6 | **Mothers** | `ship6` | 0.8 (fija) | **200** | Láser `daño/50` continuo, tamaño 50, **vida ×8** | Nave nodriza. Al fijar blanco **genera 5 escoltas `ship7`**. Si muere, sus escoltas mueren con ella. |
| 7 | *(escolta)* | `ship7` | 2.8–3.1 | 70 | Láser `daño/30`, vida fija 100 | No aparece en oleadas. Vive atada a su madre. |

**Contramedidas según el propio juego** (texto de derrota de la misión 6):
> las Mothership solo se paran con misiles y THELs por su alcance; los Pulse
> sirven para limpiar sus cazas.

### Búsqueda de objetivo

`inMyCell(mc, range, enemy, limit, includeRockets)` (`frame_2/DoAction.as:623`)
consulta la rejilla espacial de `cells.as` en vez de recorrer todas las entidades.
Las naves piden hasta 5 candidatos y toman el primero; las torretas piden 20 o
1000 y también toman el primero, salvo que algo las esté atacando.

---

## 7. Modos, niveles y condiciones

`levels.setup(n, sameseed)` en `__Packages/levels.as`. Mapeo a las pestañas del
menú del wrapper:

| Pestaña | Nivel | Nombre | Minerales inicio | Objetivo |
|---|---|---|---|---|
| Training | 1 | Training 1: Mining & Energy | 1000 | Guiado, sin oleadas |
| Training | 2 | Training 2: Defending yourself | 2000 → 200 | Guiado, sin oleadas |
| Mining Modes | 3 | Easy Mode | 1000 | Minar **15 000** |
| Mining Modes | 4 | Normal Mode | 1200 | Minar **30 000** |
| Mining Modes | 5 | Hard Mode | 2000 | Minar **40 000** |
| Mining Modes | 6 | Madness! | 2500 | Minar **40 000** |
| Survival Modes | 8 | Survivor: Gentle | 2000 | Sobrevivir |
| Survival Modes | 9 | Survivor: Bring it | 2000 | Sobrevivir |
| Survival Modes | 10 | Survivor: No Hope | 2000 | Sobrevivir |
| Bonus Modes | 11 | Wave Mode | 2000 | Sobrevivir a las 6 oleadas que tú lanzas |
| Bonus Modes | 12 | Speed Miner | 400 | Minar el campo entero lo más rápido posible |
| Bonus Modes | 13 | Sandbox Mode | 100 200 | Ninguno |
| Missions | 101–109 | Mission 1–9 | `600 + (n−100) × 100` | Variable (ver abajo) |

> El nivel **7 no existe**. Los minerales de inicio que ves en pantalla son
> menores porque `autoPlace` de la planta solar inicial ya cobra sus 200:
> Easy arranca en 1000 y muestra **800**. Verificado en el juego.

### Derrota

**Única condición** (`destroy()`, `frame_2/DoAction.as:631`): que no quede ningún
nodo en `_nodeQue` con `_construction > 1`. Es decir, **pierdes cuando te destruyen
todos los edificios**. No hay base con puntos de vida. El punto de reunión al
que vuelan las naves sin blanco es `mcMiddle` (`DefineSprite_1087`), no
`mcBase`: el constructor de cada nave pisa el `_goal: mcBase` del `attachMovie`.
`mcMiddle` se planta en el edificio con `_construction > 0` más cercano y solo
se muda cuando ese edificio cae (`reTarget()`, llamado desde `destroy()` y al
colocar un relay); las oleadas entran a 2500 de él — con sus `_x`/`_y` cruzadas
en `spawnQue`.

### Victoria

- Mining Modes y misiones normales: `_totalMined >= _goal`.
- Mission 3 (nivel 103): sobrevivir **600 s**.
- Mission 6 (nivel 106): sobrevivir a las Mothership — a partir de 190 s, cuando
  no queda ninguna nave viva.
- Mission 9 (nivel 109): sobrevivir **1200 s**.
- Wave Mode: haber enviado las 6 oleadas y que no quede ninguna nave.
- Survivor: no hay victoria, solo el tiempo aguantado.

### Formato de una oleada

`_waves[i] = [ disparador, tipoNave, cantidad, dispersión, HPmulti, ángulo ]`

- **disparador**: segundos de partida (`_waveCounter >= t × 40`) en los modos de
  minado y supervivencia; **porcentaje del objetivo minado** en las misiones
  101–109 (salvo 103, 106 y 109, que van por tiempo).
- **dispersión**: apertura angular del abanico de entrada, en grados.
- **HPmulti**: vida = `200 × HPmulti`. Un `0` se normaliza a 1 en `spawnQue`.
- **ángulo** (`levels.as:23-25` y `:257`): `PM_PRNG(seed = 1).nextIntRange(0, 360)`
  **más** un `random(360)` que se sortea **una sola vez por partida**. Como el PRNG
  arranca siempre en la misma semilla y solo se usa para esto, **la secuencia de
  ángulos relativos entre oleadas es idéntica en todas las partidas**: lo único que
  cambia de una a otra es la rotación del patrón completo. El original no normaliza
  la suma a 0–360, la pasa directa a `Math.sin`.
- El ángulo real de cada nave es `ángulo + dispersión/2 − random(dispersión)`
  (`spawnQue`, `frame_2/DoAction.as:1073`).

### Tablas de oleadas generadas

Los modos de minado y supervivencia generan sus tablas con un mismo patrón:
rotan los 6 tipos de nave, la cantidad crece linealmente con tope, `HPmulti` crece
como `int(0.8 + w / k)`, y las Mothership van siempre en grupos fijos.

| Nivel | Cantidad base | Tope | `HPmulti` | Tope HP | Intervalo (s) | Mothers/oleada |
|---|---|---|---|---|---|---|
| 3 Easy | `w × 5` | 40 | `int(0.8 + w/9)` | 6 | `w × 75 + 10` | 3, disp. 90 |
| 4 Normal | `w × 6` | 100 | `int(0.8 + w/8)` | 6 | `w × 70 + 10` | 5, disp. 180 |
| 5 Hard | `7 + w × 8` | 100 | `int(0.8 + w/8)` | 6 | `w × 65` | 8, disp. 360 |
| 6 Madness | `7 + w × 10` | 100 | `int(0.8 + w/6)` | **8** | `w × 45 − 30` | 8, disp. 360 |
| 8 Gentle | `7 + w × 5` | 100 | `int(0.8 + w/8)` | 10 | 80 y luego paso 70→20 | 8, disp. 360 |
| 9 Bring it | `7 + w × 6` | 100 | ídem | 15 | 70 y luego paso 65→20 | 8, disp. 360 |
| 10 No Hope | `7 + w × 7` | 100 | ídem | 20 | 60 y luego paso 60→20 | 8, disp. 360 |

(Survivor según `levels.as:429-664`: la `w` corre hasta 120 en vez de 100, el
tope de HP es 10/15/20 y pasada la w 100 se le suma `w − 100`.)

Modificadores por tipo de nave sobre cantidad y dispersión (idénticos en todos los
niveles salvo el divisor de Swarmers): Missile `/1.5` y disp. `×2`; Exploding `/2`
y disp. `×2`; Ringers `/2` y disp. `/2`; Swarmers `/2` o `/1.8` y disp. fija 20;
Mothers cantidad y dispersión fijas.

En Survivor el intervalo entre oleadas **se acorta 1 s cada oleada** hasta un
suelo de 20 s, y a partir de la oleada 100 el `HPmulti` crece sin tope. De ahí el
nombre "No Hope".

Reproducción del generador de Easy (primeras 12 oleadas):

| # | t | Tipo | Cant. | Disp. | HP× |
|---|---|---|---|---|---|
| 1 | 1:25 | Fighters | 5 | 10 | 1 |
| 2 | 2:40 | Missile | 6 | 40 | 1 |
| 3 | 3:55 | Exploding | 7 | 60 | 1 |
| 4 | 5:10 | Ringers | 10 | 20 | 1 |
| 5 | 6:25 | Swarmers | 8 | 20 | 1 |
| 6 | 7:40 | Mothers | 3 | 90 | 1 |
| 7 | 10:10 | Fighters | 40 | 80 | 1 |
| 8 | 11:25 | Missile | 26 | 180 | 1 |
| 9 | 12:40 | Exploding | 20 | 200 | 1 |
| 10 | 13:55 | Ringers | 20 | 55 | 2 |
| 11 | 15:10 | Swarmers | 13 | 20 | 2 |
| 12 | 16:25 | Mothers | 3 | 90 | 2 |

### Entrenamientos (1 y 2)

`levels.as:69-127` y los clips `DefineSprite_1030_tutorial1` /
`DefineSprite_1000_tutorial2`. El 1: un asteroide de tamaño 5 en (−150, 0), la
planta en el origen, 1000 minerales y ningún permiso; el clip los da por
fotogramas: minero (4-5), relay (7-8), seleccionar el asteroide (9), tres mineros
conectados (11; también exige que no haya mineros con `_construction 0` y
`_age > 40`, pero `_age` nunca sube), seleccionar y mejorar la planta a nivel 2
(12-13), mover el mapa más de 250/100 (15) y bajar el zoom del 70 % (16). El 2:
asteroides de 20/18/16 en (−100, 0), (100, 0) y (50, 100), planta de nivel 3,
mineros en (−70, −25) y (−90, −40), relay en (−35, −45), 200 minerales; torreta
(2-3), dos cazas por 190° a HP 2 (5), seleccionar la torreta y convertirla en
Pulse con 100 minerales (6-7), reparadora con 300 (9), ocho cazas a daño 2 (11).
Los textos de cada fotograma son estáticos del SWF y no están en el AS2.

### Misiones (101–109)

Tablas explícitas, disparadas por **porcentaje minado**, no por tiempo. Literales
de `levels.as`:

```
101: [[20,1,5,10,0.9,0],[50,1,10,20,0.9,0],[80,1,15,30,0.9,0]]
102: [[20,2,10,10,0.9,0],[45,2,15,15,0.9,180],[70,2,20,20,0.9,0],[90,2,25,20,0.9,0]]
104: [[20,4,6,5,0,38],[40,1,17,20,1,85],[55,2,14,60,1,310],[70,3,13,80,1,203],[82,4,8,25,1,230],[90,4,8,25,1,230]]
105: [[15,5,6,15,0,207],[30,5,18,20,1,254],[55,5,11,60,1,479],[70,5,14,15,1,372],[85,5,33,50,1,399],[95,5,33,50,1,399]]
106: [[180,6,5,135,2,0],[190,6,5,135,2,0],[200,6,5,135,2,0],[210,6,5,135,2,0],[220,6,5,135,2,0],[300,6,10,135,2,0]]
107: [[10,1,15,10,0,249],[25,2,13,40,1,296],[40,3,12,60,1,521],[60,4,15,20,1,414],[75,5,11,20,1,441],[90,6,3,90,1,328]]
108: [[10,1,16,10,0,154],[25,2,14,40,1,201],[40,3,14,60,1,426],[60,4,17,20,1,319],[75,5,13,20,1,346],[90,6,8,90,1,233]]
```

Las misiones 103 y 109 no tienen tabla de oleadas por porcentaje: son de
supervivencia pura por tiempo (600 s y 1200 s) y generan sus oleadas por
segundos: la 103 rota solo Fighters/Missile/Exploding con cantidad
`min(5 + w × 5, 50)`, HP `int(0.8 + w/8)` tope 7 y `t = w × 60 + 10`, sin doblar
la `w`; la 109 es la tabla de Easy con cantidad `min(10 + w × 8, 100)`, HP
`int(0.8 + w/5)` tope 9 y `t = 10 + w × 60` (`levels.as:735-855`). La 106 no
genera campo de asteroides (`levels.as:866-869`), y su tabla acaba en un
centinela `[1000000]`.

`_playTime` (el reloj de estas condiciones y del "Play Time" final) sube uno
cada **41** ticks, no 40: `_timerStep` cuenta 0→40 y vuelve a −1
(`frame_2/DoAction.as:429-436`).

Cada misión escala su campo de asteroides con el número: cantidad `5 + m × 5`,
escala `25 + m × 50`, semilla fija `100 + m`, tamaños de `m` a `(m + 12) / 2`, y
el objetivo es **la mitad** del total de minerales generados
(`levels.as:865-871`). Minerales iniciales `600 + m × 100` (20 000 en la 6). Las
misiones se desbloquean en orden con `o.data.mC` (`DefineSprite_718`).

### Wave Mode (nivel 11)

El jugador decide cuándo y qué lanzar. Cada envío escala el siguiente:
**`cantidad = 40 + oleadasEnviadas × 10`** (dividido entre 10 para Mothership).

| Botón | Nave | Dispersión | HPmulti |
|---|---|---|---|
| 1 | Fighters | 360 | 1 |
| 2 | Missile | 360 | 5 |
| 3 | Exploding | 360 | 2 |
| 4 | Ringers | 360 | 2 |
| 5 | Swarmers | 20 | 0.2 |
| 6 | Mothers | 360 | 2 |
| 7 | **Todo a la vez**: 25 × (Fighters HP4, Missile HP4, Exploding HP3, Ringers HP3) | | |

El botón 7 también suma a `_wavesSent`, y la victoria exige `_wavesSent == 6`
exacto con `_waveInProgress == 0` (`frame_2/DoAction.as:377`): usándolo no se
puede ganar. Sandbox (nivel 13, `levels.as:701-721`): 100 200 minerales, sin
campo ni objetivo; `sandbox(ship, n, ángulo, dispersión)` manda `n` naves a HP 1
con 160 ticks de espera entre envíos (`DefineSprite_1243`); nave 1-6, cantidad
25/50/100, dispersión 10/45/90/180/360 y rumbo en pasos de 5° (`DefineSprite_1244`).

El orden en que las lanzas es la estrategia: el mensaje de derrota lo dice
explícitamente (*"maybe try sending the waves in a different order"*).

---

## 8. Controles e interfaz

### Teclado (`DefineSprite_1084/frame_1/DoAction.as:164`)

| Tecla | Acción |
|---|---|
| `1`–`7` | Construir Relay / Miner / Energy / Store / Repair / Laser / Rocket |
| `Esc` | Cancelar la construcción en curso |
| `U` o `Espacio` | Mejorar el edificio seleccionado |
| `P` | Convertir una torreta láser nivel 1 en **Pulse** |
| `T` | Convertir una torreta láser nivel 1 en **THEL** |
| `R` | Vender el edificio seleccionado |
| `W`/`↑`, `S`/`↓` | Desplazar mapa ±200 |
| `A`/`←`, `D`/`→` | Desplazar mapa ±300 |
| `Q` / `E` | Zoom ±30 (rango 20–100) |
| `Shift` al colocar | Encadenar: vuelve a coger el mismo edificio |

Rueda del ratón: zoom. Los edificios se colocan sobre una rejilla de 5 px.

### Opciones (`DefineSprite_862_options`)

Cinco interruptores, guardados en `_root._o.data` (el `SharedObject` de Flash).
Los dos primeros son de accesibilidad y **conviene conservarlos**; los tres
últimos existían por rendimiento en máquinas de 2008.

| Bandera | Efecto verificado |
|---|---|
| `optCB` | Modo daltónico. Enciende `mcShip.mcCB` y agranda las naves a `_xscale = 120` (`frame_2/DoAction.as:1104`). Es el propio juego admitiendo que sus seis colores de nave no bastan. |
| `optSL` | «Láseres lentos»: la línea del disparo vive 4 ticks en vez de 2 (`DoAction.as:1191`). Hace legible un efecto que por defecto dura 50 ms. |
| `optSM` | Desplazamiento suave. Con la opción activa el mapa salta a su destino en vez de interpolar (`DefineSprite_1084/frame_1/DoAction.as:39`). |
| `optMS` | «Fondo fijo»: deja de reescalar y desplazar las tres capas de estrellas (`mcBackground` 1-3: escala `80 + zoom/5`, `/10`, `/20` y desplazamiento del mapa `/10`, `/20`, `/40`, `ídem:111-124`). Con la opción activa se quedan donde estaban. |
| `optEL` | Apaga las líneas de energía: `requestEnergy()` dibuja en `mcRelayLines` una polilínea 0x04D3FF de grosor 2 por cada fuente drenada, del consumidor a la fuente y de vuelta por la ruta, con cada punto temblando `random(4) - 2`, viva dos fotogramas (`frame_2/DoAction.as:1316-1373`). Con `optEL = 1` no se crea el clip. |

### HUD

- **Barra superior**: Pause / Slow / Normal / Fast, nombre del modo, objetivo del
  modo (tiempo, minerales minados y %, oleadas enviadas), Quit / Restart / Setup.
- **Panel inferior derecho**: minerales (con color de alarma), minerales por
  minuto, barra de energía global "N energy (X%)".
- **Barra de construcción** (`mcEnergy`) sobre cada edificio en obra o mejorándose.
- **Barra de vida** (`mcLife`), solo visible cuando está dañado.
- **`mcLow`**: indicador de "sin energía" en mineros y plantas.
- **Minimapa** abajo a la izquierda: verde = edificios, rojo = enemigos, gris = asteroides.
- **Barras de oleada** (`waveBar`): avisos que caducan a los 20 s.
- **Toggles globales**: `toggleMiners()` y `toggleMissiles()` — apagar mineros libera
  energía para las torretas; apagar misiles deja de gastar minerales.
- **Pantalla de fin** (`gameOver(n)`, `frame_2/DoAction.as:756`): título y texto
  por nivel, "Total ships killed / Minerals mined / Play Time", en derrota
  `int(100 / _goal * _totalMined)` %, y dos gráficas de `graph.as`: cada
  `tickTo` ticks (80, y sube uno por muestra hasta 400) guarda
  `[energía de las plantas con _construction ≥ 10, suma de _mineQuantity de
  los mineros activos, _totalMined]`; se dibujan a escala de su máximo y el
  minado se titula "Minerals per minute [max × 20 peak]" (`graph.as:155`).
  La puntuación que manda al CCAPI es `100000 - _playTime` (`:874`): menos
  tiempo es mejor.

### Pestañas «Info» (`mcInfo`, DefineSprite_1151)

Cada botón de construcción tiene dos zonas: el cuerpo (al pasar el ratón
cambia el coste por el nombre, `gotoAndStop(2)`; clic → `build()`) y una
pestaña «Info» aparte (`PlaceObject3_1104_5`): `rollOver` →
`showInfo(clave)`, `rollOut` → `hideInfo()`. Ambas hacen solo
`mcInfo.gotoAndStop(clave | "blank")` (`DefineSprite_1199/frame_1/DoAction.as:130-137`).
La misma pestaña va en los paneles de mejora y en los dos toggles. `build()`
llama a `hideInfo()` y pone `mcUI` en el fotograma `building` mientras se
coloca; `place()` vuelve a `space` salvo con SHIFT (`frame_2/DoAction.as:1660,1742,1753`).

Los textos son estáticos (`DefineText`, decodificados con la tabla de códigos
de la fuente); en negrita lo que el original resalta con otro registro:

| fotograma | texto |
|---|---|
| `relay` | **Energy Relays** are used to transport Energy between Solar Stations and Energy Stores to all other strucures. They do this by reflecting and refracting light. They are cheap to make but are weak. |
| `energy` | **Solar Stations** collect light from the sun and convert it into **Energy** which is needed to construct and power your structures. They can be upgraded several times to improve their efficiency. |
| `miner` | **Miners** extract **Minerals** from any asteroid in range, Minerals are needed to construct structures, ships and missiles. Miners can be upgraded to increase their efficiency. |
| `repair` | **Repair Stations** construct upto 4 repair drones which will fly to and fix any structure in range before returning. This saves you Minerals and Energy you would have spent on replacing lost structures. |
| `store` | **Energy stores** suck up all spare Energy from the Solar Stations and store it for when it is needed. This is ideal for weapons which need large amounts of energy in a short time or if you expand rapidly. |
| `laser` | **Basic Lasers** are your most basic form of defence, they engage the target instantly and only cost Energy to fire. They can be upgraded to pulse or Tactical High Energy Lasers. |
| `rocket` | **Missile launchers** fire high explosive missiles over long ranges. The missiles can follow and re-target enemies once fired. It costs both Energy and Minerals to construct and fire missiles. |
| `energyUpgrade` | Upgrade this Solar Station to improve its Efficiency and Capacity. It will gather energy quicker and will store more for when it is needed. |
| `minerUpgrade` | Upgrade this Miner to increase the quantity of Minerals it can mine in a minute from 80 to 200 Minerals. |
| `storeUpgrade` | Upgrade this Energy Store to increase its capacity from 200 to 600 units of Energy, ideal if you are running low in battle. |
| `laserPulser` | Pulse lasers are rapid firing, short ranged and low damage. Ideal for defending against missiles and smaller enemies. |
| `laserPlasma` | THELs are long range and high damage, they are slow to fire and are ideal for strong enemies. They do not target missiles! |
| `rocketUpgrade` | Upgrade this Missile Launcher to increase its range and the number of missiles it can fire at a time, each costing 5 Minerals to produce. |
| `pulserUpgrade` | Upgrade this Pulse Laser to increase its damage and rate of fire, making it cope with more missiles and stronger enemies. |
| `plasmaUpgrade` | Upgrade this THEL to increase its range and damage, it requires more energy to fire, but its worth it! |
| `repairUpgrade` | Upgrade this Repair Station to increase the range it covers by 50% and improve its health. |
| `toggleMiners` | Give the command for ALL Miners to STOP/START. This is very handy if you are under attack and are running low on Energy! |
| `toggleMissiles` | Give the command for ALL Missile launchers to STOP/START. This is very handy if you are sure your lasers can keep you save and want to reserve your Minerals. |
| `building` (en `mcUI`) | Click to start construction of the structure. Hold down SHIFT to place multiple copies. Press ESC or click on another structure to cancel. |

Erratas («strucures», «upto», «save», «its worth it») son del original. Los
«80 to 200» del minero son los nominales del HUD (`mineQuantity` 4 → 10 por
ciclo, misma proporción; el rendimiento real es 66,7/min, §3); los «200 to
600» del almacén cuadran con `maxEnergy` 200 + 400 de la mejora (§5.4).

### Colores de entidad

`0x02f6ff` edificios de red · `0x7EFF00` láser base · `0x9FDF00` Pulse ·
`0xFFBA00` THEL · `0xa09472` asteroides · `0xFF0000` Fighters · `0x66FF00` Missile ·
`0xFF6600` Exploding · `0x99FF00` Ringers · `0xCCCCCC` Swarmers · `0xFF00FF` Mothers.

### Audio

Tres pistas de música mezcladas por volumen dinámico: `music_backing` (calma, vol. 30),
`music_tension1` (sube a 100 al aparecer enemigos) y `music_tension2` (combate activo,
mientras `_lastFired > 0`). 28 efectos declarados en `frame_1/DoAction.as:113`
con `[offset, duración, volumen, loops]`.

---

## 9. Notas de reimplementación

### El oráculo en Python

`DATA/Python/` fue el primer port de la red de energía, verificado contra estos
números, y sirvió de oráculo para `web/sim.js`. Se conserva tal cual y no se
mantiene: lo vivo es `web/comprobaciones.js`.

| Archivo | Qué es |
|---|---|
| `balance.py` | Solo datos: edificios, mejoras, naves, niveles, generadores de oleadas. Incluye el puerto de `PM_PRNG`, necesario para reproducir los ángulos. `python balance.py` corre su comprobación |
| `game.py` | El modelo: grafo no dirigido, BFS multi-fuente, `request_energy`, colocación, planificador de ticks. `python game.py` corre la comprobación |
| `main.py` | Simulación de una apertura, para ver el techo de energía en acción |

Cadencias que la comprobación fija (y que no se leen directamente de ninguna
constante — salen de componer el planificador con los contadores de cada edificio):

| | ticks | segundos |
|---|---|---|
| Tick de relays y mineros | 1 de cada 18 | 0.45 |
| Pulso de la planta solar | cada 22 | 0.55 |
| Ciclo de minado | cada 144 | 3.6 |

De ahí salen dos números útiles: un minero L1 rinde **66.7 minerales/min** reales
(el HUD dice 80, un 20 % de más), y **una planta L1 alimenta 5 mineros**, no más.

`generate_waves(nivel, angle_offset=0)` devuelve las **seis** columnas del
original, ángulo incluido. El desfase por partida es el parámetro: con el valor por
defecto 0 se obtiene la secuencia canónica del PRNG, y pasarle un `random(360)`
reproduce una partida concreta. Verificado para Normal: los seis tipos en orden a
80, 150, 220, 290, 360 y 430 s, con ángulos 0, 47, 272, 165, 192 y 79.

### Lo que falta

Combate, naves, oleadas en vivo, reparadoras y torretas. Los datos ya están en
`balance.py`; falta el bucle de movimiento y disparo, que es el otro medio tick
del planificador (`tick_moving % 2 == 0`, hoy vacío).

### Decisiones no obvias del original que conviene conservar

1. **PRNG determinista** (`PM_PRNG`, Park–Miller) para el campo de asteroides.
   `sameseed` permite reintentar el mismo mapa — es una feature de diseño, no un
   detalle técnico.
2. **Rejilla espacial** (`cells.as`) para todas las consultas de proximidad. Con
   cientos de naves en pantalla, una búsqueda lineal no aguanta.
3. **La construcción cuesta energía, no tiempo.** Es lo que acopla la economía a
   la topología: no puedes expandir más rápido de lo que tu red bombea.
4. **Se drena la fuente más lejana primero.** Contraintuitivo, pero conserva las
   reservas cercanas y hace que los almacenes remotos sirvan de verdad.
5. **Vender devuelve el 100 % a vida completa.** Reconfigurar la red es gratis;
   perder edificios en combate es lo caro. Empuja a experimentar con la topología.
6. **Coste por misil.** El único arma con economía marginal; convierte la defensa
   pesada en una decisión de presupuesto, no de colocación.

### Cosas que se pueden ignorar

- `SecNum` es una envoltura anti-trampas que guarda cada número con checksum.
  Funcionalmente es un `int`/`float`. Un `get`/`set` normal basta.
- `_hackCheck` es una tabla de validación declarada en cada edificio pero **nunca
  leída** — código muerto. Coincide con las tablas de mejora en coste, vida y
  energía; diverge en el daño del THEL (que es dinámico por la rampa). Útil solo
  como comprobación cruzada.
- `CCAPI` / `CCHandshake` / `SendStat` son la integración con el portal Casual
  Collective (estadísticas, datos persistentes, clase de jugador). Sin portal, no
  hacen nada.
- El orden alterno par/impar de ticks y el ciclo de `_tickRelays` son optimización
  de CPU para Flash de 2009.

---

## 10. Apéndice: inventario de assets

```
DATA/
├── SWF/
│   ├── content.json                        metadatos de Flashpoint
│   ├── scripts/                             ← 449 scripts AS2 desofuscados
│   │   ├── __Packages/                      22 clases del juego
│   │   ├── frame_1/DoAction.as              init: sonido, CCAPI, setupLevel
│   │   ├── frame_2/DoAction.as              bucle de juego (43 funciones)
│   │   └── DefineSprite_*/                  scripts de UI, tutoriales, botones
│   └── content/storage.cloud.casualcollective.com/
│       ├── zones/pub/10/  y  /100/
│       │   ├── thespacegame.v83.swf         1.94 MB — el juego (fuente de la verdad)
│       │   ├── thespacegamebg.swf           fondo
│       │   └── widget.swf                   299 KB — menú y portal
│       ├── zones/pub/stingers/ccblocks.swf  intro del portal
│       └── games/thespacegame*.swf          loaders de 16 KB
├── images/      275 PNG numerados (490 KB)  sprites extraídos, resolución 1×
├── image_2x/    mismos nombres, resolución 2×
├── sprites/     DefineSprite_67/11.png
├── sounds/      28 MP3 + 1 WAV             nombre = <índice>_<símbolo exportado>
└── Python/      balance.py                  tablas de balance (solo datos)
                 game.py                     red de energía + comprobación
                 main.py                     simulación de una apertura
```

Los 28 sonidos están nombrados con su símbolo exportado, así que el mapeo es
directo: `13_missile1.mp3` ↔ `SFX("missile1")` en el código. Los PNG están
numerados por ID de carácter del SWF, sin nombre semántico; para identificarlos
hay que cruzarlos con los `DefineSprite_*` correspondientes.

Los símbolos exportados del SWF (`ExportAssets`, 81 entradas) son la lista
canónica de assets con nombre:

```
sonidos    THEL success bang1..bang6 shipAlert shipInfoDrop bSell bPlace bBuilt
           buttonOver buttonClick missile1 missile2 mining laser1 laser2 laser4
           music_backing music_tension1 music_tension2 buildingStart buildingSell
           buildingFinish fail
edificios  buildingEnergy buildingStore buildingRepair buildingLaser buildingRocket
           buildingRelay buildingMiner
naves      ship1..ship7 rocket repair1 asteroid
efectos    star explode1 explode2 explode3
UI         mainMenu paused options gameOver minimapDot waveBar tutorial1 tutorial2
           missionReminder cover
```

---

## Cómo se obtuvo este documento

```bash
java -jar ffdec-cli.jar -config autoDeobfuscate=1,parallelSpeedUp=0 \
  -export script DATA/SWF/scripts \
  DATA/SWF/content/storage.cloud.casualcollective.com/zones/pub/10/thespacegame.v83.swf
```

JPEXS FFDec 26.2.1 sobre el JDK 25 local. Sin `autoDeobfuscate` la salida es
ilegible: el SWF lleva un ofuscador de flujo de control.

**Verificado contra el juego en ejecución** (Flash Player 32 SA): costes de
construcción 20/45/200/300/300/100/400, "4 energy (100%)" de la planta inicial,
800 minerales al empezar Easy (1000 − 200), objetivos 15 000 / 30 000 / 40 000 /
40 000, y los cuatro botones de velocidad.
