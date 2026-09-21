# TODO — The Space Game

Lo que falta para llegar del prototipo actual al juego completo.

La especificación es [`GDD.md`](GDD.md); los números salen del bytecode
decompilado en `DATA/SWF/scripts/`. **Ningún valor se inventa**: si algo no está
en el GDD, primero se verifica en el AS2 y se cita `archivo:línea`.

Regla del proyecto: **solo JavaScript**, sin dependencias ni paso de compilación.

---

## Estado actual

Funciona la mitad económica del juego: la red de energía completa y verificada.

- `web/sim.js` — grafo de nodos, BFS por fuente, drenaje de la fuente más lejana
  primero, `requestEnergy`, colocación con las reglas reales de `tempLink`,
  construcción pagada en energía, minado, venta y mejoras.
- `web/balance.js` — tablas de relay, minero, planta y almacén; `PM_PRNG`;
  generador del campo de asteroides (con el bug de grados-por-radianes del
  original reproducido a propósito).
- `web/main.js` — render SVG con los sprites del canvas de diseño, cámara,
  colocación, panel de selección de edificio y de asteroide, HUD.
- `web/check.js` — 46 aserciones que comparan el port con el modelo de
  referencia. Corren en `npm run check` y también dentro de la página.

Lo verificado numéricamente: pulso solar cada 22 ticks, ciclo de minado 144
ticks, ingreso real 66,7/min frente a los 80 que anuncia el HUD original,
saturación de la planta L1 entre 5 y 7 mineros.

---

## Bloque 1 — Combate

Es la otra mitad del juego. Existe el bucle de movimiento (el medio tick
alterno, `tick_moving % 2 == 0`), la cola de entrada y la primera nave; nada
dispara de vuelta todavía.

### 1.1 Naves

- [x] Clase `Ship` en `sim.js`: giro con `easing`, entrada a 40× y frenada,
      reasignación de blanco, ráfaga. Solo `ship1`; el resto son subclases de
      lo mismo con otros números y tácticas.
- [x] Entrada desde radio 2500 en el ángulo de la oleada ± dispersión
      (`spawnQue`, `frame_2/DoAction.as:1065`); `net.spawn()` encola y sale
      una por tick.
- [x] Vida = `200 × HPmulti`, daño = `damage / 2`.
- [ ] Los siete tipos con su táctica (§6 del GDD):
  - [x] `ship1` Fighters — láser `daño/20`, reasigna blanco cada 20–30 ticks
        (símbolo `e1` copiado a `sprites.svg`; comprobación 18-20)
  - [x] `ship2` Missile — misil completo desde alcance 200, salpicadura 30
        (`Rocket` en `sim.js` con `rocket.as` entero, incluida la excepción
        Ringer; `Network.splash()`; comprobación 24-25). `_kills` del original
        cuenta también los misiles caducados; aquí solo naves
  - [x] `ship3` Exploding — se frena, mecha de 60 ticks, detona `daño × 1.2` en radio 100
        (comprobación 28-29; el halo de la mecha es del port, el original cambia de fotograma)
  - [x] `ship4` Ringers — se **detiene** y hace láser continuo `daño/80`; su escudo absorbe misiles (`daño/15`)
        (comprobación 30-31; `shield` se apaga 10 por tick como `mcShield._alpha`)
  - [x] `ship5` Swarmers — enjambre, láser `daño/10`, tamaño 5 (comprobación 32)
  - [x] `ship6` Mothers — vida ×8, genera 5 escoltas al fijar blanco; si muere, mueren con ella
        (comprobación 36-38; `laser4` en bucle mientras dispara)
  - [x] `ship7` escolta — no aparece en oleadas, vive atada a su madre
- [x] Cada nave muere con su `bang` (`SHIPS[n].dies`, `net.deaths`)
- [x] Punto de reunión `mcMiddle` (`net.rally`): las naves sin blanco vuelan al
      edificio más cercano al anterior, no al origen (comprobación 33-35)
- [x] Búsqueda de blanco: `Celdas.buscar` reproduce `inMyCell` con sus límites
      (naves y misiles 5, láseres 20, lanzadera 1000/50, reparadora 4), el
      orden de celda y el recorrido inverso de AVM1 (comprobación «inMyCell con límite 5»).
- [x] `optCB`: naves a `_xscale 120` (salvo la nodriza); en rojo con raya en
      el minimapa ya estaban. `mcCB` no tiene sprite en `design/` — la sección
      «Sin color» de `Enemigos.dc.html` apuesta por la forma; se queda fuera.
- [x] `_lastFired`: cuenta atrás de 100 ticks tras cada disparo que decide
      `tension2` (`net.lastFired`, comprobación de `comprobaciones.js`).

### 1.2 Torretas y reparadora

Los tres edificios que faltan de los siete. Datos en §5.5–5.7 del GDD.

- [x] `buildingRepair` — reparadora con sus bots (`Drone`, de
      `DefineSprite_566_repair1`), tecla 5, comprobación 43-46. Reproducido: la
      mejora deja `_value` en NaN y la venta devuelve 0 (`buildingRepair.as:107`).
      Las naves y los misiles enemigos también apuntan a los bots (están en la
      misma celda). Sprite del bot: `#bot` de `design/Edificios.dc.html`, 10 px
      (el bot no declara `_size`). La salpicadura les alcanza: `splash()` pasa
      por `Celdas.buscar` como `inMyCell(mc, range, enemy)`
- [x] `buildingLaser` — base (tecla 6) y las dos conversiones **Pulse** (`P`)
      y **THEL** (`T`) con sus tres niveles y la rampa del THEL, que no tiene
      tope: la acota la energía (comprobación 21-22, 39-42). Sprites de las seis
      variantes de `design/Armas.dc.html`. Pendiente: pulsar `P` sobre un Pulse
      nivel 1 hace en el original la mejora genérica (`upgrade(1)` con
      `subType != 0` pone `n = 0`); aquí no hace nada
- [x] `buildingRocket` — lanzamisiles con su coste por misil (5 minerales +
      1 energía), salvas de 1/2/4, recarga 200/20 y las dos mejoras; tecla 7;
      sprites de los tres niveles de `design/Armas.dc.html` (comprobación 26-27).
      `maxEnergy` es 1 al nivel 1 (`buildingRocket.as:65`), no 2 como dice el
      GDD §5.7
- [x] Añadirlos a `web/balance.js` y a la barra de construcción (teclas 5, 6, 7)
- [x] `toggleMissiles()`: apagar los misiles para dejar de gastar minerales —
      en el panel del lanzamisiles, como en `DefineSprite_1199/frame_7`; solo
      con la partida en marcha (`_gameSpeed > 0`)

### 1.3 Proyectiles y efectos

El diseño ya está resuelto en `design/Efectos.dc.html`; falta implementarlo.

- [x] Láser: línea que vive **2 ticks** (4 con `optSL`), alfa `80 + random(20)`
- [x] Misil: física con aceleración, estela (`Rocket.trail`, doce puntos que
      se separan solos al acelerar) e impacto (anillo naranja 8 ticks)
- [x] Salpicadura con caída lineal por distancia (`Network.splash`)
- [x] Excepción Ringer: los misiles le hacen `daño/15` (`Rocket.tick`; falta el `ship4` que lo estrene)
- [x] Destrucción en 4 ticks — `net.wrecks` con los cuatro `<symbol fx-*>`
      copiados del canvas y el hueco de trazos hasta construir encima. Es
      efecto del port: el original no deja rastro
- [x] Sonido asociado a cada uno

### 1.4 Rejilla espacial

- [x] Port de `cells.as` (`Celdas` en `sim.js`): cuatro niveles, celda con
      retraso en naves (20/15 ticks) y bots (10), misiles al tick. Las
      consultas de colocación (`place()`, asteroides) siguen lineales: sin
      límite dan lo mismo y los asteroides no están en la rejilla.

---

## Bloque 2 — Modos y niveles

Hoy existen tres entradas en `LEVELS`: Entrenamiento 1, un «Tutorial»
inventado para aprender la red (objetivo 3000, número no verificado: el nivel
no existe en el original) y Speed Miner (nivel 12, `levels.as:681-700`, el
único modo real jugable sin combate). Faltan los otros doce modos más las
nueve misiones (§7 del GDD).

- [x] Port de las tablas de oleadas de `balance.py` → `balance.js`
      (`generate_waves`, ya con el ángulo `PM_PRNG(1) + random(360)` corregido)
      — hechos los cuatro modos de minado en `generarOleadas()` con la tabla
      `MODOS` (`levels.as:146-664`, comprobación 23), los tres de Survivor
      con su intervalo acumulativo, y las misiones (`MISIONES` literal, 103 y
      109 por `MODOS`). Wave Mode no tiene tabla: es `Network.sendWave(n)`
- [x] Modos de minado: Easy, Normal, Hard, Madness — `LEVELS[3..6]` con el
      disparador por tiempo y las reglas de ángulo de `frame_2/DoAction.as:464-477`
      (Fácil siempre por el este, Normal este u oeste a cara o cruz, el resto
      el ángulo de la tabla)
- [x] Supervivencia: Gentle, Bring it, No Hope — `LEVELS[8..10]`, sin
      objetivo, siempre acaban en derrota y la marca es el tiempo aguantado
      (`marca: 'mayor'`)
- [x] Bonus: Wave Mode (`LEVELS[11]`, panel `#oleadas` con los siete botones
      de `wave()`, victoria `wavesCleared`), Sandbox (`LEVELS[13]`, panel de
      nave/cantidad/dispersión/rumbo con los 160 ticks de espera de
      DefineSprite_1243; el dial de rumbo del original es un deslizador) y
      Speed Miner (`LEVELS[12]`). El panel no tiene diseño en `design/`
- [x] Entrenamiento 1 y 2 — `LEVELS[1..2]` con sus campos y edificios de
      partida, y el guion `GUION` de `main.js` fotograma a fotograma de
      `tutorial1`/`tutorial2` (permisos, naves, condiciones de paso). Los
      textos son del port: los del original son texto estático del SWF. La
      condición de «mineros atascados» (`_age > 40`) se omite porque `_age`
      nunca sube en el original
- [x] Misiones 101–109 — `LEVELS[101..109]` generados en bucle
      (`levels.as:722-876`): campo con semilla fija `100 + m`, objetivo la
      mitad, `net.wavesByPercent` para el disparador por porcentaje, y se
      desbloquean en orden (`localStorage.misiones` hace de `o.data.mC`). Los
      textos de presentación son del port: el original los lleva en el clip
- [x] Condición de derrota: quedarse sin ningún nodo con `_construction > 1`
      (`Network.defeated`)
- [x] Condiciones de victoria por modo — minado (`reachedGoal`), tiempo
      (`survived`, con `playTime` a 41 ticks por segundo como `_playTime`),
      Mothership (`mothersRepelled`) y Wave Mode (`wavesCleared`)
- [x] `sameseed`: `ultimaSemilla` hace de `_root.lastSeed`; el fin de partida
      tiene «Mismo campo · semilla N» junto a «Reintentar» (los dos botones de
      DefineSprite_1300), el menú enseña la semilla real y sortea otra con el
      botón de al lado, y «Reiniciar» del HUD repite el campo. Se omite el
      calentamiento aleatorio de `random(100)` pasos cuando no hay semilla
      (asteroidField.as:26-32): con semilla explícita el campo es el mismo
- [x] Selector de nivel — raíl del menú y tarjetas de dificultad, sin recargar;
      todos los modos del original

---

## Bloque 3 — Interfaz que falta

Las pantallas ya están diseñadas en `design/`; falta convertirlas en páginas.

- [x] Menú principal (`design/Menu.dc.html`) — raíl, las cuatro tarjetas de
      dificultad, línea de las seis primeras oleadas, mejor marca (tiempo, como
      el `score` que el original manda al CCAPI) y créditos. Sin «Continuar»:
      el original no guarda partidas
- [x] Pantallas de fin (`design/FinVictoria.dc.html`, `design/FinDerrota.dc.html`)
      — textos de `gameOver()`, naves destruidas, porcentaje del objetivo en
      derrota, mejor marca, las dos gráficas de `graph.as` (`net.graph`) y el
      botón «Jugar en …» con la siguiente dificultad
- [x] Minimapa abajo a la izquierda (canvas, escala 1/24, clic para centrar —
      el clic es añadido del port). Faltan los enemigos en rojo y la raya blanca
      de `optCB`, que llegan con las naves
- [x] Barras de aviso de oleada (`waveBar`), caducan a los 20 s — la pastilla
      `oleada` de `design/Avisos.dc.html`; el HUD muestra `_waveCountdown`
- [x] Control de velocidad: Pause / Slow / Normal / Fast (0 / 0.5 / 1 / 4)
- [x] Reinicio de partida sin recargar — `nuevaPartida()` crea otro `Network`
      y la vista olvida el anterior; la música no se corta
- [x] Opciones persistidas en `localStorage` (el original usa el `SharedObject`):
  - [x] `optCB` modo daltónico — cable más claro, naves al 120 %, raya blanca
        en el minimapa (`mcCB` sin sprite, ver 1.1)
  - [x] `optSL` láseres lentos — guardado; se aplica cuando haya láseres
  - [x] `optSM` cámara sin suavizado — la cámara interpola 1/5 por fotograma
        como el original, y con la opción salta
  - [x] `optMS` «Fondo fijo» — las estrellas van en tres capas con el paralaje
        de `mcBackground` 1-3 (`DefineSprite_1084:111-124`); la opción las deja
        donde estén
- [x] Teclas `5`, `6`, `7` (edificios), `P` (Pulse), `T` (THEL)
- [x] Pestañas «Info» (`mcInfo`, DefineSprite_1151) — una por botón de la
      barra y por acción del panel de selección (mejora, Pulse, THEL,
      misiles) más el toggle de minado; `rollOver`/`rollOut` de
      `PlaceObject3_1104_5` → `showInfo`/`hideInfo`. Los 19 textos son los
      estáticos del SWF (decodificados de los `DefineText`), traducidos. Al
      tomar un edificio se enseña el fotograma `building` de `mcUI`, como
      `build()` (`frame_2/DoAction.as:1742`). Los botones de barra y panel
      usan `aria-disabled` y no `disabled`: dentro de un botón `disabled`
      Chrome no entrega el ratón a la pestaña

---

## Bloque 4 — Audio

Hecho en `web/sonido.js` con los MP3 del SWF copiados a `web/sonidos/`
(`DATA/sounds/` sin el prefijo numérico): `sfx()` con la tabla de intervalos y
volúmenes de `frame_1/DoAction.as:114-140`, y las tres pistas en bucle con la
rampa de un punto cada 25 ms. Los interruptores de efectos y música sustituyen
al `CCSetVolume` del wrapper y viven en `opciones`. Nada suena hasta el primer
gesto del usuario (política del navegador).

- [x] Efectos que ya tienen disparador: `bPlace`, `bBuilt`, `bSell`, `mining`,
      `success`, `fail`, `buttonClick`, `buttonOver`
- [x] `bang1-3`, `bang5`, `laser1`, `laser2`, `laser4` (bucle), `missile1`,
      `missile2` — con sus naves y torres
- [x] `THEL` en bucle mientras el haz está encendido
- [x] `bang6` (almacén) y `shipAlert` (aviso de oleada). `bang7` (torretas y
      lanzaderas) y `death4` (misil derribado) se piden pero no están en
      `_soundSFX` ni en `DATA/sounds`: `SFX()` calla, y el port también.
      `bang4`, `laser3`, `shipInfoDrop` y `building*` los declara el original y
      nadie los pide: el port no los lleva.
- [x] `music_backing` a 30 en partida, 50 en el menú, 0 al acabar; el panel de
      opciones deja `tension1` a 50 como el original
- [x] `tension1` a 100 con el primer `spawn` y a 0 con la última nave
- [x] `tension2` a 100 mientras `_lastFired > 0` (100 ticks tras cada disparo)
- [x] `laser4` en bucle mientras la nodriza dispara

---

## Bloque 5 — Deuda y decisiones abiertas

- [x] **`DATA/Python/`**: decidido, se ignora. Se queda como está — el oráculo
      contra el que se verificó `sim.js` — sin portarlo ni borrarlo ni tocarlo.
      `web/comprobaciones.js` es lo que se mantiene.
- [x] **Tamaño dibujado ≠ `_size` de colisión.** Decidido: se acepta. El
      `_size` del original es el ancho del sprite (relay 8, minero 15, planta
      25, almacén 30) y a 1× no se lee; el canvas dibuja 26/34/46/40 y las
      reglas siguen usando el `_size` real. Dos edificios permitidos pueden
      solaparse en pantalla; la plantilla pinta la huella real (`size`) rellena
      dentro de la silueta, y el obstáculo se ilumina con la suya. Comentado en
      `main.js` (`TAM`).
- [x] **`optEL`**: localizado en `requestEnergy()` (`frame_2/DoAction.as:1316`):
      apaga las líneas de energía. Las líneas están (`net.flows`, capa de
      cables, con su temblor) y la opción también.
- [ ] **Edificio aislado por cable bloqueado.** Observado el 2026-09-21 al
      grabar la captura del README: un relay colocado detrás de un asteroide
      queda sin enlace, se cobra y nunca se construye. Es fiel al original:
      `tempLink` (`frame_2/DoAction.as:1465-1470`) pinta ese cable en
      `colBlocked` pero deja colocar, y `linksFor` lo reproduce (`sim.js:954`,
      `hit === 1`). Decidir si se trata como error del original que se corrige
      o como parte del juego. Lo que hoy hace el port: aviso de texto «fuera de
      la red: se construiría, pero sin energía» junto al cursor y, desde el
      2026-09-21, el cable bloqueado en `colBlocked` (`razon.bloqueados` de
      `linksFor`, pintado en `pintarFantasma`). Pendiente: verificar en
      Flashpoint qué ve el jugador exactamente.
- [x] Rendimiento, medido (2026-09-18):
  - Modelo (Node, base de 80 nodos con 24 torretas, en combate): 100 cazas
    0,04 ms/tick, 600 cazas 0,05, 300 misileras 0,06 (peor tick 0,7 ms), 300
    swarmers 0,04. El presupuesto es 25 ms/tick: el modelo no es el problema.
  - Render (panel del escritorio, Caja de arena, 600 cazas en vuelo, ~1300
    elementos SVG): 43 fps, p50 22,9 ms, p95 28,7 ms. El JS del fotograma son
    6,4 ms (3 de ellos `gNaves.replaceChildren`); el resto es el pintado del
    SVG. A 300 naves no hubo medida limpia: el panel estrangula `rAF` a 1 Hz
    en cuanto deja de tener el foco.
  - Conclusión: SVG aguanta las oleadas del juego (Wave Mode manda 40-90 por
    oleada, 25×4 = 100 en la especial). Solo pasar `gNaves` a canvas si en
    una partida real se baja de 40 fps con la ventana a tamaño completo.

---

## No se va a hacer

- `SecNum` — envoltura anti-trampas con checksum. Un número normal basta.
- `_hackCheck` — tabla declarada en cada edificio y **nunca leída**. Sirve solo
  como comprobación cruzada de las tablas de mejora.
- `CCAPI` / `CCHandshake` / `SendStat` — integración con el portal Casual
  Collective. Sin portal, no hacen nada.
- El orden alterno par/impar de ticks y el ciclo de `_tickRelays`: optimización
  de CPU para Flash de 2009. Se conservan **solo** donde cambian el balance
  observable (la cadencia real de relays y mineros, que ya está portada).
- Reempaquetar o modificar el SWF.
