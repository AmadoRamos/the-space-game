// Las aserciones del modelo. Los números son los que fija `python game.py`:
// ese módulo es el oráculo de sim.js. Corren en Node (`npm run check`) y en la
// página (main.js las pinta abajo a la izquierda).

import * as B from './balance.js';
import { Network, Asteroid } from './sim.js';

export function selfCheck() {
  const out = [];
  const ok = (cond, msg) => { if (!cond) throw new Error(msg); out.push(msg); };

  // 1. Pulso de la planta solar: 0.9 de energía cada 22 ticks.
  let net = new Network(0);
  const plant = net.autoplace('energy', 0, 0);
  plant.energy = 0;
  let first = null, gap = null;
  for (let t = 1; t <= 200 && gap === null; t++) {
    const before = plant.energy;
    net.tick();
    if (plant.energy > before) { if (first === null) first = t; else gap = t - first; }
  }
  ok(gap === 22, `pulso solar cada ${gap} ticks (esperado 22)`);
  ok(Math.abs(plant.spec.genAmount * plant.efficiency - 0.9) < 1e-9,
     'la planta L1 genera 0.9 por pulso');

  // 2. Ciclo de minado: 144 ticks.
  net = new Network(0);
  net.asteroids.push(new Asteroid(70, 0, 21, { minerals: Infinity }));
  net.autoplace('energy', 0, 0, 3);
  const miner = net.place('miner', 35, 0, { free: true });
  ok(miner !== null, 'el minero se engancha al asteroide');
  miner.construction = miner.targetConstruction;
  miner.energy = miner.maxEnergy;
  net.repath();
  let mined = null, prev = 0;
  const stamps = [];
  for (let t = 1; t <= 600; t++) {
    net.tick();
    if (miner.totalMined > prev) { stamps.push(t); prev = miner.totalMined; }
    if (stamps.length === 3) break;
  }
  mined = stamps[2] - stamps[1];
  ok(mined === 144, `ciclo de minado ${mined} ticks (esperado 144)`);

  // 3. Ingreso real vs. el que anuncia el HUD.
  const real = (B.BUILDINGS.miner.mineQuantity * B.TICK_RATE * 60) / 144;
  const hud = B.BUILDINGS.miner.mineQuantity * 20;
  ok(Math.abs(real - 66.7) < 0.1, `ingreso real ${real.toFixed(1)}/min (HUD dice ${hud})`);

  // 4. Una planta L1 alimenta 5 mineros, no 7.
  const supply = (count) => {
    const n = new Network(0);
    n.autoplace('energy', 0, 0);
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2;
      const ax = Math.cos(ang) * 120, ay = Math.sin(ang) * 120;
      n.asteroids.push(new Asteroid(ax, ay, 21, { minerals: Infinity }));
      const m = n.place('miner', Math.cos(ang) * 70, Math.sin(ang) * 70, { free: true });
      if (m) { m.construction = m.targetConstruction; m.energy = m.maxEnergy; }
    }
    n.repath();
    const built = n.nodes.filter((x) => x.kind === 'miner').length;
    n.run(180);
    const ideal = built * (180 * B.TICK_RATE / 144) * B.BUILDINGS.miner.mineQuantity;
    return n.totalMined / ideal;
  };
  const r5 = supply(5), r7 = supply(7);
  ok(r5 > 0.95, `5 mineros al ${(r5 * 100).toFixed(0)} % del rendimiento ideal`);
  ok(r7 < r5, `7 mineros al ${(r7 * 100).toFixed(0)} %: la planta L1 ya no llega`);

  // 5. La obra: un minero se construye con la energía de una planta L1.
  //    Lo cubre porque el resto de comprobaciones fuerzan `construction` y se
  //    saltaban esta rama entera.
  net = new Network(1000);
  net.asteroids.push(new Asteroid(120, 0, 12));
  const planta = net.autoplace('energy', 0, 0);
  const enObra = net.place('miner', 70, 0);
  ok(enObra !== null && enObra.routes.size === 1, 'el minero en obra tiene ruta a la planta');
  ok(enObra.construction === 0, 'y empieza sin nada construido');
  let seg = 0;
  while (seg < 20 && !enObra.built) { net.run(1); seg++; }
  ok(enObra.built && seg <= 6, `la obra termina en ${seg} s con una planta L1`);
  ok(planta.energy < planta.maxEnergy, 'y le ha costado energía a la planta');

  // 6. Topología.
  net = new Network(1000);
  net.autoplace('energy', 0, 0);
  const relay = net.place('relay', 80, 0);
  ok(relay !== null && relay.links.length === 1, 'el relay enlaza con la planta');

  // tempLink() devuelve 1 aunque _lines quede vacío (DoAction.as:1491): el
  // original SÍ deja colocar un edificio aislado. Se queda sin energía para
  // siempre y hay que venderlo. Es contraintuitivo, pero es la regla real.
  const orphan = net.place('relay', 400, 400);
  ok(orphan !== null && orphan.links.length === 0,
     'un edificio fuera de alcance se coloca igual, pero sin ningún enlace');
  net.run(30);
  ok(orphan.construction === 0, 'y sin enlaces nunca llega a construirse');

  // Un relay admite 6 cables; un minero, uno solo.
  ok(B.BUILDINGS.relay.maxLinks === 6 && B.BUILDINGS.miner.maxLinks === 1,
     'relay hasta 6 cables, minero terminal con 1');

  // 16. Fin de partida: gana al llegar al objetivo (recortado), pierde sin nodos.
  net = new Network(0);
  const sola = net.autoplace('energy', 0, 0);
  net.totalMined = 31;
  ok(!net.defeated && net.reachedGoal(30) && net.totalMined === 30,
     'victoria al alcanzar el objetivo, con _totalMined recortado');
  net.sell(sola);
  ok(net.defeated, 'derrota al no quedar ningún nodo con construction > 1');

  // 17. Un caza: entra desde 2500, llega, dispara 8 ticks de _damage/20 y
  // reposa 50 (ship1.as:141-156). rand fijo para que el caza sea determinista.
  net = new Network(0, { rand: () => 0.5 });
  const base = net.autoplace('energy', 0, 0);
  net.spawn(1, 90, 0);
  net.tick();
  const caza = net.ships[0];
  ok(caza && Math.abs(caza.y - 2500) < 1e-6 && caza.damage === 50 && caza.life === 200,
     'el caza entra a 2500 con vida 200 y daño 50');
  let llegada = null, ticksDisparo = 0, porTick = true;
  for (let t = 1; t <= 6000 && ticksDisparo < 8; t++) {
    const antes = base.life;
    net.tick();
    if (base.life < antes) { if (llegada === null) llegada = t; ticksDisparo += 1; porTick &&= antes - base.life === 2.5; }
  }
  ok(llegada !== null && porTick && base.life === base.maxLife - 20,
     `el caza llega en ${(llegada / B.TICK_RATE).toFixed(1)} s y su ráfaga quita 8 × 2.5`);
  base.life = 0;
  net.tick(); net.tick();
  ok(caza.attack === null || caza.attack.removed, 'con la planta destruida el caza vuelve al centro');

  // 21. Torreta base: 5 ticks de 30 cada 20 (buildingLaser.as:463-507), y solo
  // con energía. Un caza (200 PV) cae en dos ráfagas.
  net = new Network(0, { rand: () => 0.5 });
  net.autoplace('energy', 0, 0, 3);
  const torre = net.place('laser', 60, 0, { free: true });
  ok(torre !== null && torre.links.length === 1, 'la torreta enlaza con la planta');
  torre.construction = torre.targetConstruction; torre.energy = 1;
  net.repath();
  net.spawn(1, 0, 0, 1, 850);   // la frenada de entrada consume ~760 px
  net.tick();
  const blanco = net.ships[0];
  let disparos = 0, vidaPrevia = blanco.life, t = 0;
  while (net.ships.length && t < 4000) { net.tick(); t++; if (blanco.life < vidaPrevia) { disparos++; vidaPrevia = blanco.life; } }
  ok(net.kills === 1 && disparos === 7, `la torreta derriba al caza en ${disparos} disparos de 30 (${t} ticks)`);

  // 23. Oleadas de Easy (levels.as:146-196): las 12 primeras de la tabla del GDD §7.
  const ol = B.generarOleadas(3, () => 0);
  // el HPmulti 0 de la primera es real: spawnQue lo normaliza a 1
  const esperado = [[85,1,5,10,0],[160,2,6,40,1],[235,3,7,60,1],[310,4,10,20,1],[385,5,8,20,1],[460,6,3,90,1],
                    [610,1,40,80,1],[685,2,26,180,1],[760,3,20,200,1],[835,4,20,55,2],[910,5,13,20,2],[985,6,3,90,2]];
  const igual = esperado.every((e, i) => e.every((v, j) => ol[i][j] === v));
  ok(igual && ol.length === 85, `las 12 primeras oleadas de Easy coinciden con el GDD (${ol.length} en total)`);
  // Normal/Hard/Madness (levels.as:216-412): la primera vuelta de los seis tipos.
  const n4 = B.generarOleadas(4, () => 0), n5 = B.generarOleadas(5, () => 0), n6 = B.generarOleadas(6, () => 0);
  const e4 = [[80,1,6,10,0],[150,2,8,40,1],[220,3,9,60,1],[290,4,12,20,1],[360,5,15,20,1],[430,6,5,180,1]];
  const e5 = [[65,1,15,10,0],[130,2,15,40,1],[195,3,15,60,1],[260,4,19,20,1],[325,5,26,20,1],[390,6,8,360,1]];
  const e6 = [[15,1,17,10,0],[60,2,18,40,1],[105,3,18,60,1],[150,4,23,20,1],[195,5,31,20,1],[240,6,8,360,1]];
  const vuelta = (ol2, e) => e.every((f, i) => f.every((v, j) => ol2[i][j] === v));
  ok(vuelta(n4, e4) && vuelta(n5, e5) && vuelta(n6, e6) && n6[n6.length - 1][4] === 8,
     'Normal, Difícil y Locura: primera vuelta de seis oleadas, y Locura llega a HPmulti 8');
  // Survivor Gentle (levels.as:429-492): intervalo 70, 69, 68… hasta 20; la
  // última sale con w = 118 y el HPmulti, con tope 10, suma w - 100 pasada la 100.
  const n8 = B.generarOleadas(8, () => 0), u8 = n8[n8.length - 1], p8 = n8[n8.length - 2];
  const e8 = [[80,1,12,10,0],[150,2,11,40,1],[219,3,11,60,1],[287,4,13,20,1],[354,5,17,20,1],[420,6,8,360,1]];
  ok(vuelta(n8, e8) && u8[0] - p8[0] === 20 && u8[4] === 28 && B.generarOleadas(10, () => 0)[0][0] === 60,
     `Suave: primera vuelta, ${n8.length} oleadas, las últimas a 20 s y HPmulti ${u8[4]}; Sin esperanza empieza a los 60 s`);
  // Misiones (levels.as:725-855): la 3 rota solo tres tipos sin doblar la w, la
  // 9 es Easy con más naves, y las de tabla se disparan por porcentaje minado.
  const m3 = B.generarOleadas(103, () => 0), m9 = B.generarOleadas(109, () => 0);
  ok(vuelta(m3, [[70,1,10,10,0],[130,2,10,40,1],[190,3,10,60,1],[250,1,25,40,1]]) && m3.length === 99 && m3[m3.length - 1][4] === 7,
     `Misión 3: 99 oleadas de tres tipos, la cuarta vuelve a cazas, HPmulti tope 7`);
  ok(vuelta(m9, [[70,1,18,10,1],[130,2,17,40,1],[190,3,17,60,1],[250,4,21,20,1],[310,5,16,20,1],[370,6,3,90,2]]) && m9[m9.length - 1][4] === 9,
     'Misión 9: primera vuelta y HPmulti tope 9');
  net = new Network(0, { rand: () => 0.5 });
  net.waves = B.generarOleadas(101); net.wavesByPercent = 1000;
  net.autoplace('energy', 0, 0);
  for (let t = 0; t < 2000; t++) net.tick();
  ok(net.waveNumber === 0 && net.nextWaveIn === null, 'Misión 1: sin minar, la oleada del 20 % no entra aunque pase el tiempo');
  net.totalMined = 200; net.tick();
  ok(net.waveNumber === 1 && net.ships.length + net.spawnQueue.length === 5, 'y entra al llegar al 20 % del objetivo');
  // Wave Mode (frame_2/DoAction.as:943-1042, :377): 40, 50, 60… naves, las
  // nodrizas entre 10, y se gana con seis enviadas y ninguna viva.
  net = new Network(0, { rand: () => 0.5 });
  net.autoplace('energy', 0, 0);
  ok(net.sendWave(1) === 40 && net.sendWave(6) === 5 && net.wavesSent === 2 && net.waveInProgress,
     'Wave Mode: la primera oleada son 40 cazas, la segunda 5 nodrizas (50 / 10)');
  for (let i = 0; i < 4; i++) net.sendWave(5);
  ok(net.wavesSent === 6 && !net.wavesCleared, 'con seis enviadas aún no se gana: hay naves en vuelo');
  for (let t = 0; t < 500; t++) net.tick();
  for (const s of net.ships) s.life = 0;
  net.tick(); net.tick();
  ok(!net.ships.length && net.wavesCleared, 'y al caer la última nave, sí');
  // cells.as:212: con `limit` la celda deja de aportar al pasar de él, y AVM1
  // recorre del último añadido al primero: siete edificios en la misma celda,
  // el más cercano registrado el primero, y la nave (límite 5) no lo ve.
  ok((() => {
    const n = new Network(0);
    const edificio = (x) => ({ x, y: 10, kind: 'energy', construction: 10, life: 1, maxLife: 1, bando: 0 });
    for (const x of [20, 80, 70, 60, 50, 40, 30]) n.celdas.registrar(edificio(x));
    const nave = n.celdas.buscar({ x: 0, y: 10, kind: 'ship' }, 100, 0, 5);
    const misil = n.celdas.buscar({ x: 0, y: 10, kind: 'rocket' }, 100, 0);
    return nave.length === 6 && nave[0].range === 30 && misil.length === 7 && misil[0].range === 20;
  })(), 'inMyCell con límite 5 corta a 6 candidatos en orden de celda y se pierde el más cercano (cells.as:205-215)');
  ok((() => {
    const n = new Network(0), blanco = { x: 0, y: 0, life: 100 };
    const antes = n.lastFired;
    n.fire({ kind: 'ship', x: 0, y: 0, fireRange: 0 }, blanco, 1);
    const enDisparo = n.lastFired;
    for (let t = 0; t < 100; t++) n.tick();
    return antes === 0 && enDisparo === 100 && n.lastFired === 0;
  })(), '_lastFired: 100 con el disparo y a 0 tras 100 ticks (frame_2/DoAction.as:1136, :203-211)');
  ok(new Network(0).playTime === 0 && (() => { const n2 = new Network(0); for (let t = 0; t < 41; t++) n2.tick(); return n2.playTime; })() === 1,
     '_playTime sube cada 41 ticks (frame_2/DoAction.as:429-436)');

  // 24. Misilera (ship2.as) y misil (rocket.as): dispara desde 200, el misil
  // acelera hasta 4 y detona a <15 con el daño entero (50) más salpicadura.
  net = new Network(0, { rand: () => 0.5 });
  const planta2 = net.autoplace('energy', 0, 0);
  const relayCerca = net.place('relay', 26, 0, { free: true });   // a 26: salpicadura int(50/30×4) = 6
  relayCerca.construction = relayCerca.targetConstruction;
  // un bot a 20 px del relay: inMyCell(…, 0) lo devuelve igual que a un edificio
  const bot = { x: 26, y: 20, kind: 'drone', bando: 0, life: 60, maxLife: 60, construction: 10 };
  net.celdas.registrar(bot);
  net.spawn(2, 0, 0, 1, 850);
  for (let t = 0; t < 400 && !net.rockets.length; t++) net.tick();
  const misil = net.rockets[0];
  ok(misil && misil.enemy && misil.damage === 50 && misil.splash === 30 && misil.life === 30,
     'la misilera lanza un misil enemigo de 50 con salpicadura 30');
  for (let t = 0; t < 400 && net.rockets.length; t++) net.tick();
  // la nave viene por el este: el relay a x=26 le queda más cerca que la planta
  ok(net.impacts === 1 && relayCerca.life === 100 - 50 && planta2.life === planta2.maxLife - 6,
     `el misil detona en el relay (-50) y salpica a la planta a 26 px (-6, queda ${planta2.life})`);
  ok(bot.life === 60 - 16, `y al bot a 20 px (-16, queda ${bot.life}): la salpicadura no distingue bots de edificios`);

  // 26. Lanzamisiles (buildingRocket.as): un misil de 450 por 5 minerales y 1 de
  // energía a un caza a 300 px; apagado con toggleMissiles no gasta nada.
  net = new Network(100, { rand: () => 0.5 });
  net.autoplace('energy', 0, 0, 3);
  const lanz = net.place('rocket', 60, 0, { free: true });
  lanz.construction = lanz.targetConstruction; lanz.energy = 1;
  net.repath();
  net.spawn(1, 0, 0, 1, 1060);   // tras frenar queda a ~300, dentro de los 400 de alcance
  net.missilesOn = false;
  for (let t = 0; t < 200; t++) net.tick();
  ok(net.rocketsLaunched === 0 && net.minerals === 100, 'con los misiles apagados no dispara ni gasta');
  net.missilesOn = true;
  for (let t = 0; t < 400 && !net.kills; t++) net.tick();
  ok(net.rocketsLaunched === 1 && net.minerals === 95 && net.kills === 1 && net.impacts === 1,
     'un misil de 450 (5 minerales, 1 energía) derriba al caza de 200');

  // 28. Explosiva (ship3.as): daño 50 × 1.2 = 60, mecha de 60 ticks parada
  // junto al blanco, y estalla en radio 100 muriendo ella.
  net = new Network(0, { rand: () => 0.5 });
  const base3 = net.autoplace('energy', 0, 0);
  const lejos = net.place('relay', 80, 0, { free: true });   // a 80: salpica int(60/100×20) = 12
  net.spawn(3, 180, 0, 1, 700);
  net.tick();
  const bomba = net.ships[0];
  ok(bomba.damage === 60 && Math.abs(bomba.speed - bomba.maxSpeed * 19) < 1e-9, 'la explosiva lleva daño 60 y entra a 19×');
  let mecha = 0;
  for (let t = 0; t < 3000 && net.ships.length; t++) { net.tick(); if (bomba.fuse > 0) mecha++; }
  ok(net.detonations === 1 && mecha >= 120 && base3.life === base3.maxLife - 60 && lejos.life === 100 - 12,
     `estalla tras ${mecha} ticks de mecha: planta -60, relay a 80 px -12`);

  // 29. Anillada (ship4.as): se planta a 60 del blanco y hace 50/80 por tick
  // sin parar; un misil propio solo le quita 450/15 = 30 y le enciende el escudo.
  net = new Network(100, { rand: () => 0.5 });
  const base4 = net.autoplace('energy', 0, 0);
  net.spawn(4, 0, 0, 1, 600);
  net.tick();
  const anillo = net.ships[0];
  let parada = 0;
  for (let t = 0; t < 2400 && parada < 200; t++) { net.tick(); if (anillo.speed === 0 && anillo.attack) parada++; }
  const quitado = base4.maxLife - base4.life;
  ok(parada === 200 && Math.abs(quitado - 100 * 0.625) < 0.626 && net.anchors === 1,
     `la anillada se planta y drena ${quitado.toFixed(1)} en 100 ticks propios (0.625 cada uno)`);
  const lanz4 = net.place('rocket', -60, 0, { free: true });
  lanz4.construction = lanz4.targetConstruction; lanz4.energy = 1; net.repath();
  for (let t = 0; t < 400 && !net.impacts; t++) net.tick();
  ok(net.impacts === 1 && anillo.life === 200 - 30 && anillo.shield > 0, 'el misil le hace 450/15 = 30 y enciende el escudo');

  // 32. Enjambre (ship5.as): ráfagas de 3 ticks a 50/10 = 5, recarga 30 + random(10).
  net = new Network(0, { rand: () => 0.5 });
  const base5 = net.autoplace('energy', 0, 0);
  net.spawn(5, 0, 0, 1, 500);
  const golpes = [];
  for (let t = 0; t < 3000 && golpes.length < 6; t++) { const v = base5.life; net.tick(); if (base5.life < v) golpes.push([t, v - base5.life]); }
  const hueco = golpes[3][0] - golpes[2][0];
  ok(golpes.every((g) => g[1] === 5) && golpes[2][0] - golpes[0][0] === 4 && hueco === 2 * (35 - 2),
     `el enjambre pica 3 × 5 y vuelve a los ${hueco / 2} ticks propios`);

  // 33. mcMiddle: al caer el edificio de reunión, las naves van al siguiente
  // más cercano en vez de quedarse dando vueltas donde estaba.
  net = new Network(0, { rand: () => 0.5 });
  const centro = net.autoplace('energy', 0, 0);
  const lejano = net.autoplace('relay', 0, 300);
  ok(net.rally.node === centro, 'el punto de reunión arranca en la planta inicial');
  net.spawn(1, 90, 0, 1, 1200);   // entra por el sur, a 900 del relay
  for (let t = 0; t < 400; t++) net.tick();
  centro.life = 0; net.tick(); net.tick();
  ok(net.rally.node === lejano && net.rally.y === 300, 'con la planta destruida se muda al relay');
  const caza2 = net.ships[0];
  for (let t = 0; t < 6000 && caza2.attack !== lejano; t++) net.tick();
  ok(caza2.attack === lejano && lejano.life < lejano.maxLife, 'y el caza acaba atacando al relay');

  // 36. Nodriza (ship6.as) y escoltas (ship7.as): vida 1600, se planta a 200 y
  // suelta 5 escoltas de 100 PV y daño 10 al fijar blanco; si cae, caen todas.
  net = new Network(0, { rand: () => 0.5 });
  const base6 = net.autoplace('energy', 0, 0);
  net.spawn(6, 0, 0, 1, 2500);
  net.tick();
  const madre = net.ships[0];
  ok(madre.life === 1600 && madre.maxSpeed === 0.8, 'la nodriza entra con 1600 PV y 0.8 fijo');
  for (let t = 0; t < 8000 && !madre.firing; t++) net.tick();
  const escoltas = net.ships.filter((s) => s.sub === 7);
  ok(madre.firing && escoltas.length === 5 && escoltas.every((e) => e.life === 100 && e.damage === 10 && e.mother === madre && e.attack === base6),
     'se planta, dispara el haz y ha soltado 5 escoltas con su mismo blanco');
  madre.life = 0;
  net.tick(); net.tick(); net.tick(); net.tick();
  ok(net.ships.length === 0 && net.deaths[6] === 1 && net.deaths[7] === 5, 'al morir la nodriza mueren las escoltas');

  // 39. Pulse y THEL (buildingLaser.as:120-166): la base se bifurca, vuelve a
  // obra, y el THEL sube el daño 0.25 por tick mientras sostiene el blanco.
  net = new Network(1000, { rand: () => 0.5 });
  net.autoplace('energy', 0, 0, 3);
  const pulso = net.place('laser', 60, 0, { free: true });
  pulso.construction = pulso.targetConstruction;
  ok(!pulso.canUpgrade && pulso.convert(net, 1) && net.minerals === 900 && !pulso.built && pulso.damage === 12 && pulso.fireCooldown === 10 && pulso.maxLife === 300,
     'la base no mejora; en Pulse cuesta 100, vuelve a obra y pasa a 12 de daño cada 10');
  pulso.construction = pulso.targetConstruction;
  ok(pulso.canUpgrade && pulso.nextUpgrade.cost === 150 && pulso.upgrade(net) && pulso.damage === 14 && pulso.fireRange === 115 && pulso.nextUpgrade.cost === 300,
     'Pulse 2 cuesta 150 (14 de daño, alcance 115) y el 3 costará 300');
  const thel = net.place('laser', -60, 0, { free: true });
  thel.construction = thel.targetConstruction;
  ok(thel.convert(net, 2) && net.minerals === 900 - 150 - 500 && thel.fireRange === 200 && thel.damage === 1 && !thel.incRockets && thel.nextUpgrade.cost === 800,
     'THEL cuesta 500: alcance 200, daño base 1, sin misiles, y su nivel 2 cuesta 800');
  thel.construction = thel.targetConstruction; thel.energy = 5; net.repath();
  net.spawn(1, 180, 0, 1, 1000);   // un caza por el oeste, cerca del THEL
  for (let t = 0; t < 4000 && !thel.firing; t++) net.tick();
  const nave = thel.attack, v0 = nave.life;
  net.tick(); net.tick(); const d1 = v0 - nave.life;
  for (let t = 0; t < 20; t++) net.tick(); const v1 = nave.life;
  net.tick(); net.tick(); const d2 = v1 - nave.life;
  ok(thel.firing && d1 === 1.5 && d2 === 1.5 + 11 * 0.25,
     `el THEL empieza en ${d1} por tick y once ticks después va por ${d2}`);

  // 43. Reparadora (buildingRepair.as, repair1): fabrica bots con energía, los
  // manda al edificio más dañado a 200 y lo curan a 1 por tick; la mejora deja
  // el valor en NaN y la venta devuelve 0, como el original.
  net = new Network(0, { rand: () => 0.5 });
  net.autoplace('energy', 0, 0, 3);
  const taller = net.autoplace('repair', 60, 0);
  const herido = net.autoplace('relay', 0, 120);
  herido.life = 50;
  for (let t = 0; t < 1200 && !net.drones.length; t++) net.tick();
  ok(net.drones.length >= 1 && net.drones[0].life === 20 && net.drones[0].maxLife === 60, 'fabrica un bot que nace con 20 de 60 de vida');
  for (let t = 0; t < 8000 && herido.life < herido.maxLife; t++) net.tick();
  ok(herido.life === herido.maxLife && net.drones.length === 4, `el relay vuelve a 100 y ya hay ${net.drones.length} bots`);
  net.minerals = 150;
  ok(taller.upgrade(net) && taller.repairRange === 300 && Number.isNaN(taller.value), 'la mejora sube el alcance a 300 y deja el valor en NaN');
  taller.construction = taller.targetConstruction;
  ok(net.sell(taller) === 0, 'y venderla devuelve 0, como int(NaN)');

  // 44. graph.collect(): muestra al primer tick y luego cada 81, 82, … ticks
  // (tickTo sube uno por muestra); la energía es la de las plantas hechas.
  net = new Network(0, { rand: () => 0.5 });
  net.autoplace('energy', 0, 0);
  net.tick();
  ok(net.graph.data.length === 1 && net.graph.tick === 81, 'muestra al primer tick y espera 81');
  for (let t = 0; t < 82; t++) net.tick();
  ok(net.graph.data.length === 2 && net.graph.tickTo === 82 && net.graph.tick === 82
     && net.graph.maxEnergy === Math.max(...net.graph.data.map((d) => d[0])) && net.graph.maxEnergy > 0,
     `la segunda 82 ticks después, la tercera esperará 82, y el pico de energía es ${net.graph.maxEnergy}`);

  return out;
}
