// Red de energía de The Space Game — puerto de DATA/Python/game.py, que a su
// vez es puerto de frame_2/DoAction.as y __Packages/building*.as.
//
//   - la red es un grafo NO dirigido de nodos con radio de enlace,
//   - las rutas salen de un BFS por cada fuente (path/pathB),
//   - el consumo drena la fuente MÁS LEJANA primero (requestEnergy), no reparte,
//   - construir cuesta energía, no tiempo.
//
// Las aserciones que lo comparan con `python game.py` están en
// comprobaciones.js: ese módulo es el oráculo de este.

import * as B from './balance.js';

const hypot = Math.hypot;

/**
 * cells.as: la rejilla espacial del original. Cuatro niveles de celda (100,
 * 200, 400 y 700 sobre _cellSize = 100, frame_2/DoAction.as:2060) y cada
 * objeto vive en los cuatro; la consulta elige el nivel por alcance y mira las
 * 3×3 celdas de alrededor (cells.as:150-179), la propia primero. Como la celda
 * es al menos tan ancha como el alcance, nunca se escapa nada; lo que sí se
 * reproduce es `limit`: cada celda deja de aportar en cuanto la lista pasa de
 * `limit` (:212), así que con muchos candidatos el elegido depende del orden de
 * las celdas y del de los objetos dentro de cada una — AVM1 enumera un Object
 * del último añadido al primero, y mover de celda vuelve a añadir.
 * Las naves solo actualizan su celda cada 20 o 15 ticks (ship1.as:99), los bots
 * cada 10, los misiles cada tick: la rejilla va con retraso y se conserva.
 */
const CELDA = 100;
const NIVELES = [1, 2, 4, 7];
class Celdas {
  constructor() { this.celdas = new Map(); }   // clave "nivel:cx:cy:bando" → Set en orden de llegada
  clave(mc, i) { const k = CELDA * NIVELES[i]; return `${i + 1}:${Math.trunc(mc.x / k)}:${Math.trunc(mc.y / k)}:${mc.bando}`; }
  registrar(mc, solo = -1) {
    mc.celda ??= [];
    for (let i = 0; i < 4; i++) {
      if (solo >= 0 && solo !== i) continue;
      const c = mc.celda[i] = this.clave(mc, i);
      if (!this.celdas.has(c)) this.celdas.set(c, new Set());
      this.celdas.get(c).add(mc);
    }
  }
  quitar(mc) { for (const c of mc.celda ?? []) this.celdas.get(c)?.delete(mc); }
  mover(mc) {   // moveCell: nivel a nivel, solo los que cambian
    for (let i = 0; i < 4; i++) {
      if (mc.celda[i] === this.clave(mc, i)) continue;
      this.celdas.get(mc.celda[i])?.delete(mc);
      this.registrar(mc, i);
    }
  }
  /** inMyCell, cells.as:129-224: lista {node, range, damage} ordenada, o null. */
  buscar(mc, range, bando, limit = 0, includeRockets = false, onlyDamaged = false) {
    const i = range > CELDA * 4 ? 3 : range > CELDA * 2 ? 2 : range > CELDA ? 1 : 0;
    const k = CELDA * NIVELES[i], cx = Math.trunc(mc.x / k), cy = Math.trunc(mc.y / k);
    const found = [];
    const enCelda = (c) => {   // inCell: devuelve en cuanto pasa de `limit`, pero cada celda aporta al menos uno
      for (const o of [...(this.celdas.get(c) ?? [])].reverse()) {
        if (o === mc && !onlyDamaged) continue;
        if (!includeRockets && o.kind === 'rocket') continue;
        if (mc.kind === 'ship' && o.construction === 0) continue;   // :205
        if (onlyDamaged && !(o.life < o.maxLife && o.kind !== 'drone')) continue;
        const d = Math.trunc(hypot(o.x - mc.x, o.y - mc.y));
        if (d > range) continue;
        found.push({ node: o, range: d, damage: 3000 - (o.maxLife - o.life) });
        if (limit && found.length > limit) return;
      }
    };
    enCelda(`${i + 1}:${cx}:${cy}:${bando}`);
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) if (x !== cx || y !== cy) enCelda(`${i + 1}:${x}:${y}:${bando}`);
    }
    if (!found.length) return null;
    const prop = onlyDamaged ? 'damage' : 'range';
    found.sort((a, b) => a[prop] - b[prop]);   // bubbleSortOn es estable; sort() también
    return found;
  }
}

export class Asteroid {
  constructor(x, y, size, { minerals = null, rotation = 0 } = {}) {
    this.kind = 'planet';
    this.x = x; this.y = y;
    this.size = B.ASTEROID_SIZE_OFFSET + size;   // radio real
    this.rotation = rotation;
    this.minerals = minerals === null ? B.asteroidMinerals(size) : minerals;
    this.maxMinerals = this.minerals;
  }
  /** asteroid.as:32 — la capa seca se funde en saltos de 10 %. */
  get depleted() {
    if (this.minerals <= 0) return 100;
    return Math.floor((100 - Math.floor((100 / this.maxMinerals) * this.minerals)) / 10) * 10;
  }
}

let nextId = 1;

export class Node {
  constructor(kind, x, y) {
    const spec = B.BUILDINGS[kind];
    this.id = nextId++;
    this.kind = kind;
    this.bando = 0;              // _enemy = 0
    this.x = x; this.y = y;
    this.spec = spec;
    this.size = spec.size;
    this.energyRange = spec.energyRange;
    this.relayEnergy = spec.relayEnergy;
    this.maxLinks = spec.maxLinks;

    this.life = this.maxLife = spec.life;
    this.energy = 0;
    this.maxEnergy = spec.maxEnergy;
    this.buildEnergy = 0;

    this.construction = 0;
    this.targetConstruction = spec.targetConstruction;
    this.constructionTick = spec.constructionTick;
    this.constructionStep = 0;
    this.tickStep = 0;

    this.level = 1;
    this.value = spec.cost;      // lo que devuelve al venderse, a vida completa

    this.links = [];             // vecinos: grafo NO dirigido
    this.routes = new Map();     // _mines: índice de fuente -> {mine, depth, path}
    this.asteroids = [];         // solo mineros

    this.efficiency = spec.efficiency ?? 0;
    this.mineQuantity = spec.mineQuantity ?? 0;
    this.mineTicker = spec.mineRate ?? 0;
    this.totalMined = 0;
    this.lowPower = false;
    // torretas (buildingLaser.as:76-105)
    this.fireRange = spec.fireRange ?? 0;
    this.fireStart = spec.fireStart ?? 0;
    this.fireCooldown = spec.fireCooldown ?? 0;
    this.damage = spec.damage ?? 0;
    this.energyNeeded = spec.energyNeeded ?? 0;
    this.fireStep = 0;
    this.attack = null;
    this.attackingMe = null;     // la nave que me dispara manda (fire(), frame_2/DoAction.as:1158)
    this.laser = null;
    this.subType = 0;            // torreta: 0 base, 1 Pulse, 2 THEL
    this.branch = null;
    this.colour = spec.colour ?? null;
    this.incRockets = spec.incRockets ?? false;
    this.reTarget = 0;           // THEL (buildingLaser.as:366-461)
    this.firing = false;         // THEL: su sonido va en bucle mientras dispara
    // reparadora (buildingRepair.as:56-69)
    this.repairRange = spec.repairRange ?? 0;
    this.bots = [];              // bahías: null cuando el bot ha muerto
    this.shipStep = 0;
    this.shipTick = 15;
    this.targetTick = spec.targetTick ?? 0;
    // lanzamisiles (buildingRocket.as:66-69)
    this.splash = spec.splash ?? 0;
    this.rockets = spec.rockets ?? 0;
    this.fireCount = 0;
    this.fireTick = 0;
  }

  get built() { return this.construction >= this.targetConstruction; }
  get propagates() { return this.relayEnergy && this.construction >= B.PROPAGATE_AT; }
  get upgrades() { return (this.branch ?? this.spec).upgrades; }
  get canUpgrade() { return this.built && this.level <= this.upgrades.length; }
  get nextUpgrade() { return this.upgrades[this.level - 1] ?? null; }
  get label() { return this.branch?.label ?? this.spec.label; }

  /**
   * buildingLaser.upgrade(1|2): la torreta base se bifurca a Pulse o THEL.
   * Cobra, cambia los números y vuelve a obra (sube _targetConstruction).
   */
  convert(net, n) {
    const rama = B.LASER_BRANCHES[n];
    if (this.kind !== 'laser' || this.subType !== 0 || !this.built || !rama) return false;
    if (!net.charge(rama.cost)) return false;
    this.value += rama.valueAdd;
    Object.assign(this, rama.set);
    this.life += rama.life; this.maxLife += rama.life;
    this.targetConstruction += rama.targetConstruction;
    this.constructionTick += rama.constructionTick;
    this.subType = rama.subType;
    this.branch = rama;
    return true;
  }

  /**
   * buildingX.upgrade(): cobra, sube nivel y sube el objetivo de obra.
   * El original NO reinicia _construction: sube _targetConstruction, con lo que
   * el edificio vuelve a quedar por debajo y reentra en la rama de construcción.
   */
  upgrade(net) {
    if (!this.canUpgrade) return false;
    const up = this.nextUpgrade;
    if (!net.charge(up.cost)) return false;

    this.value += up.cost / 2;
    this.level += 1;
    for (const [key, val] of Object.entries(up)) {
      if (key === 'cost') continue;
      if (key === 'valueNaN') { this.value = NaN; continue; }   // buildingRepair.as:107, ver balance.js
      if (key === 'life') { this.life += val; this.maxLife += val; }
      else if (typeof val === 'string') this[key] = this[key] * parseFloat(val.slice(1));
      else if (B.ADDITIVE.has(key)) this[key] += val;
      else this[key] = val;
    }
    return true;
  }

  /** Devuelve true si el edificio ha sido destruido este tick. */
  tick(net) {
    if (this.life <= 0) return true;
    this[`_tick_${this.kind}`](net);
    return false;
  }

  /** Paso de obra con cadencia: energy, store, repair y torretas. */
  _buildGated(net) {
    if (this.built) return false;
    if (this.constructionStep === this.constructionTick) {
      this.buildEnergy += net.requestEnergy(this, 1);
      this.constructionStep = 0;
      if (this.buildEnergy >= 1) {
        this.construction += 1;
        this.buildEnergy -= 1;
        // buildingEnergy.as:220 y buildingStore.as:196: solo la fuente nueva
        // (nivel 1) recalcula rutas; la reparadora y el lanzamisiles, nunca
        if (this.built && this.level === 1 && (this.kind === 'energy' || this.kind === 'store')) net.path();
      }
    }
    this.constructionStep += 1;
    return true;
  }

  _tick_energy(net) {
    if (!this.built) {
      if (this.level > 1) {
        // buildingEnergy.as: de nivel 2 en adelante la obra no cuesta energía
        if (this.constructionStep === this.constructionTick) {
          this.constructionStep = 0;
          this.construction += 1;   // la mejora no recalcula rutas (:220 exige nivel 1)
        }
        this.constructionStep += 1;
      } else {
        this._buildGated(net);
      }
      return;
    }
    if (this.tickStep <= 0) {
      this.tickStep = this.spec.genPeriod;
      if (this.energy < this.maxEnergy) this.energy += this.spec.genAmount * this.efficiency;
      this.energy = Math.min(this.energy, this.maxEnergy);
    } else {
      this.tickStep -= 1;
    }
    this.lowPower = this.energy < 1;   // mcLow, buildingEnergy.as:232
  }

  _tick_relay(net) {
    // mcLow al 50 % con los 6 cables ocupados (buildingRelay.as:174-181): no es
    // falta de energía, pero es el mismo aviso y main.js lo pinta a media mezcla.
    if (this.built) { this.lowPower = this.links.length >= 6; return; }
    this.energy = net.requestEnergy(this, 1);
    if (this.energy >= this.spec.constructionThreshold) {
      this.construction += this.spec.constructionStep;
      this.energy = 0;
      // buildingRelay.as:164: el relay de un solo cable no recalcula, ya lo hizo quickPath
      if (this.built && this.links.length > 1) net.path();
    }
  }

  /** buildingLaser.as:296-540, subType 0. */
  _tick_laser(net) {
    if (this.attack?.life <= 0 || this.attack?.removed) this.attack = null;
    if (this.attackingMe?.life <= 0) this.attackingMe = null;
    if (this.laser) {
      if (this.laser.life === 0 || !this.attack || this.life <= 0) { net.dropLaser(this.laser); this.laser = null; }
      else this.laser.life -= 1;
    }
    if (!this.built) {
      // :338-344 — a diferencia de la planta, cualquier energía > 0 avanza la obra
      if (this.constructionStep >= this.constructionTick) {
        this.energy = net.requestEnergy(this, 1);
        this.constructionStep = 0;
        if (this.energy > 0) this.construction += 1;   // no relaya: no recalcula rutas
      }
      this.constructionStep += 2;
      return;
    }
    if (net.ships.length) {
      if (this.subType === 2) this._tickThel(net);
      else if (this.fireStep === this.fireStart) {
        if (this.attackingMe) this.attack = this.attackingMe;
        else {
          this.attack = net.nearestEnemy(this, this.fireRange, this.incRockets, 20);   // buildingLaser.as:392
          if (this.attack) net.bursts += 1;                   // SFX laser1, :479
        }
      } else if (this.fireStep < this.fireStart) {
        if (!this.attack) this.fireStep = this.fireCooldown;
        else if (this.energy > 0) {
          this.energy -= this.energyNeeded / 7 / this.fireStart;
          this.laser = net.fire(this, this.attack, this.damage, this.colour);
        } else this.fireStep = 0;
        if (this.fireStep === 0) this.fireStep = this.fireCooldown;
      }
      if (this.subType !== 2) this.fireStep -= 1;
    } else this.firing = false;
    // :514-524 — pide hasta energyNeeded/2 un tick sí y otro no
    if (this.tickStep <= 0) {
      this.tickStep = 1;
      if (this.energy < this.energyNeeded / 2) this.energy += net.requestEnergy(this, this.energyNeeded / 2 - this.energy);
    } else this.tickStep -= 1;
    this.lowPower = this.energy < 1;
  }

  /** buildingRepair.as:160-260. */
  _tick_repair(net) {
    const spec = this.spec;
    if (this._buildGated(net)) return;
    // :208-236 — fabrica un bot si hay bahía libre o uno ha muerto
    if (this.shipStep === 0) {
      if (this.bots.length < spec.maxBots || this.bots.some((b) => !b || b.removed)) this.shipStep = spec.botEnergy;
    }
    if (this.shipStep > 0) {
      if (this.shipTick <= 0) {
        this.shipTick = spec.botTick;
        this.shipStep -= net.requestEnergy(this, 1);
        if (this.shipStep < 1) { this.shipStep = 0; this._createDrone(net); }
      }
      this.shipTick -= 1;
    } else if (this.energy < this.maxEnergy) {
      this.energy += net.requestEnergy(this, this.maxEnergy - this.energy);
    }
    // :242-258 — cada 30 ticks manda a los bots cargados al edificio más dañado
    if (this.targetTick <= 0) {
      this.targetTick = spec.retargetTick;
      const targets = this.nextTarget(net);
      if (targets) {
        for (const b of this.bots) {
          if (b && !b.removed && b.returnToBase && b.energy === b.maxEnergy && b.life === b.maxLife) {
            b.returnToBase = false; b.repair = targets[0]; b.launchCooldown = 60;
          }
        }
      }
    }
    this.targetTick -= 1;
  }

  /** createShip(), buildingRepair.as:261-286: ocupa la primera bahía libre, a 9 px y 90° por bahía. */
  _createDrone(net) {
    let slot = this.bots.length < this.spec.maxBots ? this.bots.length : 0;
    this.bots.forEach((b, i) => { if (!b || b.removed) slot = i; });
    const a = 90 * slot;
    const x = Math.trunc(this.x + Math.sin(a * DEG) * B.DRONE.bay), y = Math.trunc(this.y + Math.cos(a * DEG) * B.DRONE.bay);
    const d = new Drone(x, y, -a, this);
    net.drones.push(d);
    net.celdas.registrar(d);
    this.bots[slot] = d;
  }

  /** nextTarget(): inMyCell(…, onlyDamaged): lo dañado a repairRange, la propia estación incluida, el más dañado primero. */
  nextTarget(net) {   // buildingRepair.as:300: límite 4
    return net.celdas.buscar(this, this.repairRange, 0, 4, false, true)?.map((f) => f.node) ?? null;
  }

  /** buildingRocket.as:174-311. */
  _tick_rocket(net) {
    const spec = this.spec;
    if (this.attack?.life <= 0 || this.attack?.removed) this.attack = null;
    if (this.attackingMe?.life <= 0) this.attackingMe = null;
    if (!this.built) {
      const antes = this.construction;
      this._buildGated(net);
      if (this.built && antes < this.construction) this.energy += 1;   // :211, sale con un misil cargado
      return;
    }
    if (net.missilesOn) {
      if (this.fireStep <= 0) {
        this.attack = null;
        if (this.attackingMe) { this.attack = this.attackingMe; this.fireCount = this.rockets; this.fireTick = 0; }
        else if (net.ships.length) {
          this.attack = net.nearestEnemy(this, this.fireRange, false, 1000);   // buildingRocket.as:238
          if (this.attack) { this.fireCount = this.rockets; this.fireTick = 0; }
          else this.fireCount = 0;
        }
        this.fireStep = this.attack ? spec.reload : spec.reloadIdle;
      }
      if (this.fireCount > 0) {
        if (this.fireTick === 0) {
          if (this.energy >= 1) {
            if (!this.attack) this.attack = net.nearestEnemy(this, this.fireRange, false, 50);   // :270
            // :271-275 — el misil cuesta 5 minerales; sin ellos no sale, pero la salva sigue contando
            if (this.attack && net.charge(spec.rocketCost)) {
              this.energy -= 1;
              net.fireRocket(this, this.attack, this.damage, this.splash, spec.rocketLife);
            }
          }
          this.fireTick = spec.salvoGap;
          this.fireCount -= 1;
        }
        this.fireTick -= 1;
      }
    }
    this.fireStep -= 1;
    // :290-310 — pide 1 cada 5 ticks hasta maxEnergy
    if (this.tickStep <= 0) {
      this.tickStep = 4;
      if (this.energy < this.maxEnergy) this.energy = Math.min(this.maxEnergy, this.energy + net.requestEnergy(this, 1));
    } else this.tickStep -= 1;
    this.lowPower = this.energy < 1;
  }

  /**
   * buildingLaser.as:366-461, el THEL. `_fireStart` es aquí un contador que
   * arranca en 40 al fijar blanco y sube sin tope: el daño por tick es
   * damage + (fireStart − 39) / 4, y cuesta daño/20 de energía; cuando la
   * energía no llega, el contador cae a 20 y el haz se apaga hasta volver a 40.
   * La rampa la acota la red, no una constante. No dispara a misiles.
   */
  _tickThel(net) {
    this.firing = false;
    if (this.reTarget === 0) {
      if (!this.attack) {
        if (this.attackingMe) { this.attack = this.attackingMe; this.reTarget = 1000; this.fireStart = 40; }
        else {
          this.attack = net.nearestEnemy(this, this.fireRange, false, 20);   // buildingLaser.as:470
          if (this.attack) { this.reTarget = 1000; this.fireStart = 40; }
          else { this.reTarget = 10; this.fireStart = 0; }
        }
      } else this.reTarget = 1000;
    } else {
      this.reTarget -= 1;
      if (this.fireStart >= 40) {
        if (!this.attack) { this.reTarget = 20; this.fireStart = 0; }
        else {
          const dmg = this.damage + (this.fireStart - 39) / 4;
          if (this.energy >= dmg / 20) {
            this.energy -= dmg / 20;
            this.firing = true;
            this.laser = net.fire(this, this.attack, dmg, this.colour, Math.min(dmg / 3, 5));
          } else this.fireStart = 20;
        }
      }
      this.fireStart += 1;
    }
  }

  _tick_store(net) {
    if (this._buildGated(net)) return;
    if (this.tickStep <= 0) {
      this.tickStep = this.spec.refillPeriod;
      if (this.energy < this.maxEnergy) {
        this.energy += net.requestEnergy(this, this.maxEnergy - this.energy);
      }
      this.energy = Math.min(this.energy, this.maxEnergy);
    } else {
      this.tickStep -= 1;
    }
  }

  _tick_miner(net) {
    // buildingMiner.as: la obra del minero no tiene cadencia, pide cada tick.
    if (!this.built) {
      this.buildEnergy += net.requestEnergy(this, this.maxEnergy - this.buildEnergy);
      if (this.buildEnergy >= 1) {
        this.construction += 1;
        this.buildEnergy -= 1;
        if (this.built) this.energy = this.maxEnergy;
      }
      return;
    }
    if (!net.minersOn) { this.lowPower = true; return; }

    this.asteroids = this.asteroids.filter((a) => a.minerals > 0);
    if (this.asteroids.length === 0) { this.lowPower = true; return; }

    // el original elige al azar entre los que tiene en rango, no el más cercano
    const target = this.asteroids[Math.floor(net.rand() * this.asteroids.length)];
    if (this.mineTicker >= this.spec.mineRate) {
      this.mineTicker = 0;
      if (this.energy >= this.maxEnergy) {
        this.lowPower = false;
        this.energy = 0;
        const take = Math.min(this.mineQuantity, target.minerals);
        target.minerals -= take;
        this.totalMined += take;
        net.minerals += take;
        net.totalMined += take;
        // buildingMiner.as:265 — el rayo cae en un punto al azar dentro de r/2
        const a = net.rand() * Math.PI * 2;
        net.beams.push({
          from: this, to: target, until: net.ticks + 6,
          hx: target.x + Math.sin(a) * (target.size / 2),
          hy: target.y + Math.cos(a) * (target.size / 2),
        });
      } else {
        this.lowPower = true;
      }
    }
    if (this.energy < this.maxEnergy) {
      this.energy += net.requestEnergy(this, this.maxEnergy - this.energy);
    }
    this.mineTicker += this.spec.mineStep;
  }
}

// --- Naves ------------------------------------------------------------------
// __Packages/ship1.as, tick a tick. Los grados se quedan en grados porque el
// original gira `mcShip._rotation` y mueve con cos/sin de eso.
const DEG = Math.PI / 180;
const random = (net, n) => Math.floor(net.rand() * n);   // random(n) de AS2

export class Ship {
  /** spawnQue: `angle` en grados, `life` = 200 × HPmulti, `damage` ya partido por 2. */
  constructor(sub, x, y, angle, life, damage, net) {
    const spec = B.SHIPS[sub];
    this.kind = 'ship';
    this.bando = 1;              // _enemy = 1
    this.sub = sub;
    this.spec = spec;
    this.x = x; this.y = y;
    this.rotation = angle - 180;                       // frame_2/DoAction.as:1097
    this.life = this.maxLife = life;
    this.damage = damage * (spec.damageMul ?? 1);
    this.size = spec.size;
    this.maxSpeed = spec.speed + random(net, spec.speedRandom) / 1000;
    this.speed = this.maxSpeed * spec.entry;
    this.easing = spec.easing;
    this.fuse = 0;
    this.targetSpeed = this.maxSpeed;   // ship4: 0 mientras asedia
    this.shield = 0;                     // mcShield._alpha, lo enciende un misil
    this.fireRange = spec.fireRange;
    this.fireStep = spec.fireStep;
    this.retarget = random(net, 60);
    this.mmTick = 0;
    this.attack = null;      // null = vuela al punto de reunión (mcMiddle, net.rally)
    this.laser = null;
    this.mother = null;      // ship7: su _goal es la nodriza
    this.children = null;    // ship6: sus escoltas, una vez soltadas
    this.firing = false;     // ship6: el haz suena en bucle mientras dispara
  }

  /** ship6.as:154-178: la nodriza suelta 5 escoltas en su posición la primera vez que fija blanco. */
  _spawnEscorts(net) {
    this.children = [];
    const spec = B.SHIPS[7];
    for (let i = 0; i < this.spec.escorts; i++) {
      const e = new Ship(7, this.x, this.y, random(net, 360) + 180, spec.life, spec.damage, net);
      e.mother = this;
      e.attack = this.attack;
      net.ships.push(e);
      net.celdas.registrar(e);
      this.children.push(e);
    }
    net.escortSpawns += 1;   // SFX missile1 (×5 en el original, que el intervalo funde)
  }

  /** ship1.as:47-160 y ship2.as, que solo cambia números y el arma. Devuelve true cuando la nave muere. */
  tick(net) {
    const spec = this.spec;
    if (this.laser) {
      if (this.laser.life === 0 || this.life <= 0) { net.dropLaser(this.laser); this.laser = null; }
      else this.laser.life -= 1;
    }
    if (this.life <= 0) {
      if (this.children) for (const c of this.children) c.life = 0;   // ship6.as:77-80
      return true;
    }
    // un blanco destruido o vendido deja `_attack` apuntando a un clip vacío
    if (this.attack?.removed) this.attack = null;
    const goal = this.mother ?? net.rally;
    const tx = this.attack ? this.attack.x : goal.x, ty = this.attack ? this.attack.y : goal.y;
    const dx = tx - this.x, dy = ty - this.y;
    if (spec.weapon === 'fuse' && this.fuse > 0) {
      // ship3.as:99-108: con la mecha encendida se frena hasta pararse
      if (this.speed > 0) { this.speed -= 0.05; this.easing = spec.brakeEasing; } else this.speed = 0;
    } else if (spec.weapon === 'beam') {
      // ship4.as:88-103: persigue _targetSpeed, que cae a 0 al fijar blanco
      if (this.speed > this.maxSpeed) { this.speed -= 1; if (this.speed < this.maxSpeed) this.speed = this.maxSpeed; }
      else if (this.speed < this.targetSpeed) this.speed += 0.02;
      else if (this.speed > this.targetSpeed) this.speed -= spec.brake;
    } else {
      this.easing = spec.easing;
      if (this.speed < this.maxSpeed) this.speed += 0.02;
      else if (this.speed > this.maxSpeed) { this.speed -= 1; if (this.speed < this.maxSpeed) this.speed = this.maxSpeed; }
    }
    this.y += Math.sin(this.rotation * DEG) * this.speed;
    this.x += Math.cos(this.rotation * DEG) * this.speed;
    if (this.mmTick === spec.mmReset) { net.celdas.mover(this); this.mmTick = 0; }   // ship1.as:99-103
    this.mmTick += 1;
    if (this.speed > this.maxSpeed) return false;     // mientras frena ni gira ni apunta
    if (this.mmTick % spec.turnEvery === 0) {
      // ship1.as:107-118: el -90/+90 es literal; envuelve el giro al lado corto
      let a = Math.atan2(dy, dx) / DEG - 90;
      const d = this.rotation - a;
      if (d > 180) a += 360; else if (d < -180) a -= 360;
      a += 90;
      this.rotation += (a - this.rotation) / (this.easing / 3);
    }
    if (spec.weapon === 'escort') {
      // ship7.as: no busca blanco; se lo da la nodriza
    } else if (!this.attack && this.retarget <= 0) {
      this.fuse = 0;
      const n = net.nearestNode(this, this.fireRange, 5);   // ship1.as:130
      if (n) { this.attack = n; if (spec.burst) this.fireStep = spec.burst[0] + random(net, spec.burst[1]); }
      this.targetSpeed = n ? 0 : this.maxSpeed;
      if (spec.escorts) {
        if (!this.children) { if (n) this._spawnEscorts(net); }
        else for (const c of this.children) c.attack = n;   // sin blanco vuelven a la nodriza
      }
      this.retarget = spec.retarget[0] + (spec.retarget[1] ? random(net, spec.retarget[1]) : 0);
    } else if (spec.weapon === 'beam') this.retarget -= 1;   // ship4.as:149-153: solo en el else
    if (spec.weapon !== 'beam' && spec.weapon !== 'escort') this.retarget -= 1;
    if (spec.weapon === 'laser') {
      if (this.fireStep < spec.burstBelow && this.attack) {
        if (this.fireStep === spec.burstBelow - 1) net.bursts += 1;      // ship1.as:145, SFX laser1
        this.laser = net.fire(this, this.attack, this.damage / spec.damageDiv, spec.colour ?? null);
        if (this.fireStep <= 0) this.fireStep = spec.reload[0] + (spec.reload[1] ? random(net, spec.reload[1]) : 0);
      }
    } else if (spec.weapon === 'rocket') {
      if (this.attack && this.fireStep <= 0) {
        // ship2.as:132-136: un misil con el daño entero, salpicadura 30, 30 de vida
        net.fireRocket(this, this.attack, this.damage, spec.splash, spec.rocketLife);
        this.fireStep = spec.cooldown;
      }
    } else if (spec.weapon === 'beam') {
      this.firing = false;
      if (this.attack) {
        if (!spec.escorts) this.retarget = 20 + random(net, 10);   // solo ship4.as:159
        if (this.speed <= spec.stopAt) {
          if (this.speed > 0 && !spec.escorts) net.anchors += 1;   // SFX laser2, al plantarse
          this.speed = 0;
          this.firing = true;
          this.laser = net.fire(this, this.attack, this.damage / spec.damageDiv, spec.colour, spec.thickness ?? 1);
        }
      }
      if (this.shield > 0) this.shield -= 10;
    } else if (spec.weapon === 'escort') {
      // ship7.as:135-153: ráfaga de 10 ticks, y solo si el blanco está a menos de 70
      if (this.attack && this.fireStep < spec.burstBelow) {
        const d = Math.trunc(hypot(this.x - this.attack.x, this.y - this.attack.y));
        if (d < 70) {
          if (this.fireStep === spec.burstBelow - 1) net.bursts += 1;
          this.laser = net.fire(this, this.attack, this.damage / spec.damageDiv, spec.colour);
          if (this.fireStep <= 0) this.fireStep = spec.reload[0];
        }
      }
    } else if (spec.weapon === 'fuse' && this.attack) {
      // ship3.as:176-189: se puede matar mientras cuenta; al detonar muere ella
      if (this.fuse > spec.fuse) {
        net.splash(this.attack, spec.blast, this.damage, false);
        net.blasts.push({ x: this.x, y: this.y, r: spec.blast, until: net.ticks + 8 });
        net.detonations += 1;    // SFX bang2
        this.life = 0;
        return true;
      }
      this.fuse += 1;
    }
    this.fireStep -= 1;
    return false;
  }
}

// DefineSprite_566_repair1: el bot de la reparadora. Sale de su bahía hacia
// el edificio dañado, lo cura a -1 por tick de energía, y vuelve a la bahía a
// recargar (+6 de energía y +3 de vida por cada 1 de la estación).
export class Drone {
  constructor(x, y, rotation, base) {
    this.kind = 'drone';
    this.bando = 0;              // repair1:194
    this.x = x; this.y = y;
    this.rotation = rotation;
    this.base = base;
    this.basePos = [x, y, rotation];
    this.life = B.DRONE.life; this.maxLife = B.DRONE.maxLife;
    this.energy = B.DRONE.energy; this.maxEnergy = B.DRONE.energy;
    this.speed = 0; this.maxSpeed = B.DRONE.maxSpeed;
    this.easing = B.DRONE.easing;
    this.mmTick = 0;
    this.returnToBase = true;
    this.repair = null;
    this.launchCooldown = 0;
    this.laser = null;
  }

  tick(net) {
    if (this.laser) {
      if (this.laser.life === 0 || !this.repair || this.life <= 0) { net.dropLaser(this.laser); this.laser = null; }
      else this.laser.life -= 1;
    }
    if (this.life <= 0) return true;
    if (this.base.removed) return true;
    if (this.repair?.removed) this.repair = null;
    let move = true, dx, dy;
    if (this.returnToBase) {
      dx = this.basePos[0] - this.x; dy = this.basePos[1] - this.y;
      if (Math.sqrt(dx * dx + dy * dy) < 2) {
        this.x = this.basePos[0]; this.y = this.basePos[1]; this.rotation = this.basePos[2];
        move = false;
        if (this.life < this.maxLife && this.base.energy >= 1) {
          this.life = Math.min(this.maxLife, this.life + 3); this.base.energy -= 1;
        }
        if (this.energy < this.maxEnergy && this.base.energy >= 1) {
          this.energy = Math.min(this.maxEnergy, this.energy + 6); this.base.energy -= 1;
        }
      }
    } else if (this.repair) {
      dx = this.repair.x - this.x; dy = this.repair.y - this.y;
    } else { dx = 0; dy = 0; }
    if (!move) return false;
    if (this.speed < this.maxSpeed) this.speed += 0.02;
    this.y += Math.sin(this.rotation * DEG) * this.speed;
    this.x += Math.cos(this.rotation * DEG) * this.speed;
    if (this.mmTick === 10) { net.celdas.mover(this); this.mmTick = 0; }   // repair1:104-108
    this.mmTick += 1;
    let a = Math.atan2(dy, dx) / DEG - 90;
    const d = this.rotation - a;
    if (d > 180) a += 360; else if (d < -180) a -= 360;
    a += 90;
    this.rotation += (a - this.rotation) / this.easing;
    if (this.returnToBase) {
      if (this.easing > 1) this.easing -= 1;
      return false;
    }
    if (this.easing < 12) this.easing += 1;
    if (this.energy > 0 && this.repair) {
      if (this.repair.life >= this.repair.maxLife) {
        this.repair.life = this.repair.maxLife;
        const t = this.base.nextTarget(net);
        if (t) { this.repair = t[random(net, t.length)]; this.easing = 40; this.launchCooldown = 20; }
        else this.returnToBase = true;
      }
    } else { this.returnToBase = true; this.repair = null; }
    if (this.repair) {
      if (this.launchCooldown <= 0) {
        const rx = this.repair.x - this.x, ry = this.repair.y - this.y;
        if (Math.sqrt(rx * rx + ry * ry) < B.DRONE.repairRange && this.energy > 0) {
          this.energy -= 1;
          this.laser = net.fire(this, this.repair, -1, '#00FF00');   // daño -1: cura
        }
      } else this.launchCooldown -= 1;
    }
    return false;
  }
}

// rocket.as. Enemigo o propio según quién lo dispara; vuela recto hasta que
// encuentra blanco, y el giro se cierra (`easing` baja a 2) conforme se acerca.
export class Rocket {
  constructor(x, y, target, enemy, damage, splash, life) {
    this.trail = [];             // últimas posiciones, para la estela (design/Efectos.dc.html)
    this.kind = 'rocket';
    this.bando = enemy ? 1 : 0;  // int(_enemy): el misil de una nave cuenta como nave
    this.x = x; this.y = y;
    this.attack = target;
    this.enemy = enemy;
    this.damage = damage;
    this.splash = splash;
    this.life = this.maxLife = life;
    this.speed = B.ROCKET.speed;
    this.maxSpeed = enemy ? B.ROCKET.maxSpeed : B.ROCKET.maxSpeedPlayer;
    this.easing = B.ROCKET.easing;
    this.fuel = B.ROCKET.fuel;
    this.retarget = 0;
    this.rotation = 0;           // rocket.as:32: nace apuntando a +x, sea de donde sea
  }

  /** rocket.as:35-113. Devuelve true cuando el misil desaparece. */
  tick(net) {
    this.fuel -= 1;
    if (this.fuel <= 0) return true;
    if (this.life <= 0) { net.rocketsDown += 1; return true; }   // SFX death4: no está en _soundSFX, calla
    if (this.attack?.removed || this.attack?.life <= 0) this.attack = null;
    if (!this.attack && this.retarget <= 0) {
      this.retarget = 10;
      const t = this.enemy ? net.nearestNode(this, B.ROCKET.seek, 5) : net.nearestEnemy(this, B.ROCKET.seek, false, 5);   // rocket.as:65
      if (t) { this.easing = Math.trunc(hypot(t.x - this.x, t.y - this.y)) / 5; this.attack = t; }
    }
    this.retarget -= 1;
    if (this.speed < this.maxSpeed) this.speed += 0.05;
    if (this.easing > 2) this.easing -= 1;
    if (this.attack) {
      const dx = this.attack.x - this.x, dy = this.attack.y - this.y;
      if (Math.sqrt(dx * dx + dy * dy) < B.ROCKET.hit) {
        let dmg = this.damage;
        // el escudo del Ringer: un misil propio le hace daño/15 (rocket.as:88)
        if (!this.enemy && this.attack.sub === 4) { dmg /= 15; this.attack.shield = 100; }
        net.splash(this.attack, this.splash, dmg, !this.enemy);
        net.blasts.push({ x: this.x, y: this.y, r: this.splash, until: net.ticks + 8 });
        net.impacts += 1;        // SFX bang1
        return true;
      }
    }
    this.y += Math.sin(this.rotation * DEG) * this.speed;
    this.x += Math.cos(this.rotation * DEG) * this.speed;
    this.trail.push(this.x, this.y);
    if (this.trail.length > 24) this.trail.splice(0, 2);   // doce puntos: se separan al acelerar
    net.celdas.mover(this);      // rocket.as:126, cada tick
    // sin blanco el original mete NaN en _rotation y Flash lo ignora: sigue recto
    if (this.attack) {
      let a = Math.atan2(this.attack.y - this.y, this.attack.x - this.x) / DEG - 90;
      const d = this.rotation - a;
      if (d > 180) a += 360; else if (d < -180) a -= 360;
      a += 90;
      this.rotation += (a - this.rotation) / this.easing;
    }
    return false;
  }
}

export class Network {
  constructor(minerals = 0, { rand = Math.random } = {}) {
    this.nodes = [];
    this.asteroids = [];
    this.minerals = minerals;
    this.totalMined = 0;
    this.minersOn = true;
    this.beams = [];
    this.ships = [];
    this.rockets = [];
    this.drones = [];            // bots de reparación; las naves también los atacan
    this.celdas = new Celdas();
    this.blasts = [];            // impactos de misil, para el render
    // requestEnergy() dibuja cada toma de energía (frame_2/DoAction.as:1316-1373):
    // un clip de dos fotogramas por consumidor, con una polilínea por fuente
    // drenada. optEL = 1 lo apaga. Aquí solo se anota; main.js la pinta.
    this.flows = [];
    // design/Efectos.dc.html, Destrucción: cuatro ticks de efecto por cada
    // edificio o nave caída y, para los edificios, el hueco de trazos hasta
    // que se construye encima. Efecto del port: el original no deja rastro.
    this.wrecks = [];
    this.rocketsDown = 0;        // misiles derribados, para el sonido
    this.destroyed = 0;          // edificios caídos, para el sonido
    this.spawnQueue = [];
    this.lasers = [];
    this.laserLife = 2;          // fire(): 2, o 4 con optSL (frame_2/DoAction.as:1179)
    // _lastFired, frame_2/DoAction.as:2067: 100 ticks tras cada disparo con
    // blanco (:1136), incluido el de la reparadora (repair1:178). Manda en
    // tension2 (main.js). Vale 100 justo en el tick del disparo.
    this.lastFired = 0;
    this.kills = 0;
    this.bursts = 0;             // ráfagas empezadas, para el sonido
    this.rocketsFired = 0;       // enemigos, SFX missile2
    this.rocketsLaunched = 0;    // propios, SFX missile1
    this.impacts = 0;
    this.detonations = 0;        // explosivas que han estallado, SFX bang2
    this.anchors = 0;            // anilladas que se plantan, SFX laser2
    this.escortSpawns = 0;       // nodrizas que sueltan escoltas, SFX missile1
    this.deaths = [0, 0, 0, 0, 0, 0, 0, 0];   // bajas por tipo: cada nave muere con su bang
    // graph.as:46-50: una muestra [energía en plantas hechas, minado activo,
    // total minado] cada tickTo ticks; tickTo empieza en 80 y sube uno por
    // muestra hasta 400. Es lo que dibuja la pantalla de fin.
    this.graph = { tick: 0, tickTo: 80, data: [], maxEnergy: 0, maxMining: 0 };
    this.missilesOn = true;      // toggleMissiles(), frame_2/DoAction.as:1884
    this.waves = [];             // tabla de generarOleadas(); vacía = sin oleadas
    this.waveNumber = 0;
    this.waveCounter = 0;
    this.waveAngle = null;       // regla del nivel; null = el ángulo de la tabla
    this.wavesByPercent = null;  // misiones: objetivo; la oleada entra al minar ese % de él
    this.wavesSent = 0;          // _wavesSent: oleadas lanzadas a mano (Wave Mode y Sandbox)
    this.waveInProgress = false; // _waveInProgress: se apaga al morir la última nave
    this.lastWave = null;        // { n, sub, count, angle, tick } para el HUD
    // mcMiddle (DefineSprite_1087): el punto al que vuelan las naves sin blanco
    // y desde el que se mide la entrada. Se planta en el edificio más cercano
    // y solo se mueve cuando ese edificio desaparece.
    this.rally = { x: 0, y: 0, node: null };

    this.tickMoving = 0;
    this.tickRelays = 0;
    this.pathStep = 0;           // _pathStep: fuentes que faltan por recorrer
    this.pathTick = 0;           // _pathTick: pathB() solo en ticks alternos
    this.ticks = 0;
    this.rand = rand;
  }

  /** frame_2/DoAction.as:1794 — atómico: o alcanza, o no ocurre nada. */
  charge(v) {
    if (this.minerals >= v) { this.minerals -= v; return true; }
    return false;
  }

  get sources() { return this.nodes.filter((n) => n.kind === 'energy' || n.kind === 'store'); }

  // -- geometría -------------------------------------------------------------
  /** Cuadrática idéntica a intersects() del original. */
  static segmentHitsCircle(ax, ay, bx, by, cx, cy, r) {
    const a = (bx - ax) ** 2 + (by - ay) ** 2;
    if (a === 0) return false;
    const b = 2 * ((bx - ax) * (ax - cx) + (by - ay) * (ay - cy));
    const c = cx * cx + cy * cy + ax * ax + ay * ay - 2 * (ax * cx + ay * cy) - r * r;
    const disc = b * b - 4 * a * c;
    if (disc <= 0) return false;
    const s = Math.sqrt(disc);
    const t1 = (-b + s) / (2 * a), t2 = (-b - s) / (2 * a);
    if ((t1 < 0 || t1 > 1) && (t2 < 0 || t2 > 1)) {
      return !((t1 < 0 && t2 < 0) || (t1 > 1 && t2 > 1));
    }
    return true;
  }

  /** intersects(A, B): 0 libre, 1 enlace bloqueado, 2 posición inválida. */
  intersects(node, other) {
    const { x: ax, y: ay } = node, { x: bx, y: by } = other;
    const S = Network.segmentHitsCircle;

    for (const ast of this.asteroids) {
      if (hypot(ast.x - ax, ast.y - ay) > 100) continue;
      if (S(ax, ay, bx, by, ast.x, ast.y, ast.size / 2 + 8)) return 1;
    }
    for (const n of this.nodes) {
      if (n === node || n === other || hypot(n.x - ax, n.y - ay) > 100) continue;
      if (S(ax, ay, bx, by, n.x, n.y, n.size / 2)) return 1;
    }
    // el nodo nuevo no puede quedar encima de un cable ya tendido
    for (const n of this.nodes) {
      if (n === node || hypot(n.x - ax, n.y - ay) > 100) continue;
      for (const nb of n.links) {
        if (S(n.x, n.y, nb.x, nb.y, ax, ay, node.size / 2)) return 2;
      }
    }
    return 0;
  }

  /**
   * tempLink(): vecinos a los que enlazaría, o null si la posición no vale.
   * `reason` recoge por qué falla, para que la HUD pueda decirlo.
   */
  linksFor(node, reason = {}) {
    for (const n of this.nodes) {
      const d = hypot(n.x - node.x, n.y - node.y);
      if (d <= node.energyRange && (d < node.size || d < n.size)) {
        reason.why = 'overlap'; reason.what = n; return null;
      }
    }
    for (const ast of this.asteroids) {
      const d = hypot(ast.x - node.x, ast.y - node.y);
      if (d <= 50 && (d < node.size || d < ast.size)) {
        reason.why = 'overlap'; reason.what = ast; return null;
      }
    }
    if (node.kind === 'miner') {
      node.asteroids = this.asteroids.filter(
        (a) => a.minerals > 0 && hypot(a.x - node.x, a.y - node.y) - a.size < node.spec.mineRange);
      if (node.asteroids.length === 0) { reason.why = 'noAsteroid'; return null; }
    }

    const lines = [];
    for (const other of this.nodes) {
      if (other.maxLinks !== null && other.links.length >= other.maxLinks) continue;
      if (!other.relayEnergy && other.links.length) continue;
      if (!(other.relayEnergy || node.relayEnergy)) continue;
      const d = hypot(other.x - node.x, other.y - node.y);
      if (!(node.energyRange > d && other.energyRange > d)) continue;
      // un consumidor terminal se conforma con el primer enlace válido
      if (!node.relayEnergy && lines.length) break;
      const hit = this.intersects(node, other);
      if (hit === 2) { reason.why = 'onCable'; reason.what = other; return null; }
      // cable bloqueado: no se tiende, pero se construye. Se apunta en `reason`
      // para que la plantilla lo pinte en colBlocked (DoAction.as:1465-1470)
      if (hit === 1) { (reason.bloqueados ??= []).push(other); continue; }
      lines.push(other);
    }
    return lines;
  }

  // -- construcción ----------------------------------------------------------
  place(kind, x, y, { free = false } = {}) {
    const node = new Node(kind, x, y);
    const lines = this.linksFor(node);
    if (lines === null) return null;
    if (!free && !this.charge(node.value)) return null;
    for (const other of lines) { node.links.push(other); other.links.push(node); }
    this.nodes.push(node);
    this.celdas.registrar(node);   // buildingX.place(): en la rejilla desde que se coloca
    this.wrecks = this.wrecks.filter((w) => !w.hueco || hypot(w.x - x, w.y - y) > w.size);
    // link(), frame_2/DoAction.as:1512-1520: con un solo cable a un no-fuente
    // ya construido hereda sus rutas al instante; si no, recálculo completo
    const a = lines[0];
    if (lines.length === 1 && a.kind !== 'energy' && a.kind !== 'store' && a.construction >= B.PROPAGATE_AT) this.quickPath(a, node);
    else this.path();
    if (kind === 'relay') this.moveMiddle();   // buildingRelay.as:126, solo el relay lo llama
    return node;
  }

  /** autoPlace(): coloca ya construido. Lo usa levels.as para la planta inicial. */
  autoplace(kind, x, y, level = 1) {
    const node = this.place(kind, x, y, { free: true });
    if (!node) return null;
    node.construction = node.targetConstruction;
    node.energy = node.maxEnergy;
    for (let i = 1; i < level; i++) {
      this.minerals += node.nextUpgrade.cost;   // gratis
      node.upgrade(this);
      node.construction = node.targetConstruction;
    }
    this.moveMiddle();           // mcMiddle.reset() tras el autoPlace del nivel
    return node;
  }

  remove(node) {
    for (const nb of node.links) nb.links.splice(nb.links.indexOf(node), 1);
    // destroy(), frame_2/DoAction.as:715-721: detatch() no vacía _linked del
    // caído, así que cuenta los cables que tenía; y ya está fuera de las colas
    const recalcular = node.relayEnergy && (node.kind === 'energy' || node.kind === 'store' || node.links.length > 1);
    node.links.length = 0;
    node.removed = true;
    this.celdas.quitar(node);
    this.nodes.splice(this.nodes.indexOf(node), 1);
    if (recalcular) this.path();
    this.moveMiddle();           // destroy(), frame_2/DoAction.as:729
  }

  /**
   * mcMiddle.reTarget(): si su edificio ya no está, se va al edificio con
   * _construction > 0 más cercano a donde estaba, y se conforma con el primero
   * a menos de 100. El for..in de AS2 recorre _nodeQue del último al primero.
   */
  moveMiddle() {
    const r = this.rally;
    if (r.node && !r.node.removed) return;
    r.node = null;
    let best = Infinity;
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      if (n.construction <= 0) continue;
      const d = hypot(n.x - r.x, n.y - r.y);
      if (d < best) { best = d; r.node = n; if (d < 100) break; }
    }
    if (r.node) { r.x = r.node.x; r.y = r.node.y; }   // sin edificios se queda donde estaba
  }

  // -- combate ---------------------------------------------------------------
  /** spawn(), frame_2/DoAction.as:1059: encola; spawnQue saca una por tick. */
  spawn(sub, angle, spread, hpMulti = 1, distance = B.SPAWN_DISTANCE, damage = B.SHIP_DAMAGE) {
    this.spawnQueue.push([sub, angle, spread, hpMulti, distance, damage]);
  }

  /**
   * wave(n), frame_2/DoAction.as:943-1042 (Wave Mode): 40 + 10 por oleada ya
   * enviada; las nodrizas van entre 10; los enjambres a HP 0.2 y daño 10. El
   * botón 7 suelta 25 de cada uno de los cuatro primeros tipos y también cuenta
   * como oleada enviada, así que con él nunca se llega a "6 exactas".
   */
  sendWave(n) {
    this.waveInProgress = true;
    this.wavesSent += 1;
    const cant = 40 + (this.wavesSent - 1) * 10;
    if (n === 7) {
      for (let i = 0; i < 25; i++) {
        this.spawn(1, 0, 360, 4, 2500, 100); this.spawn(2, 0, 360, 4, 2500, 100);
        this.spawn(3, 0, 360, 3, 2500, 100); this.spawn(4, 0, 360, 3, 2500, 100);
      }
      this.lastWave = { n: this.wavesSent, sub: 0, count: 100, angle: 0, spread: 360, tick: this.ticks };
      return 100;
    }
    const T = { 1: [1, 0, 360, 1, 2500, 100], 2: [2, 0, 360, 5, 2500, 100], 3: [3, 0, 360, 2, 2500, 100],
                4: [4, 0, 360, 2, 2500, 100], 5: [5, 0, 20, 0.2, 2500, 10], 6: [6, 0, 360, 2, 2500, 100] };
    const w = T[n], c = n === 6 ? cant / 10 : cant;
    for (let i = 0; i < c; i++) this.spawn(...w);
    this.lastWave = { n: this.wavesSent, sub: n, count: c, angle: 0, spread: w[2], tick: this.ticks };
    return c;
  }

  /** sandbox(), frame_2/DoAction.as:1043-1057: HP 1, 2500 de entrada, daño 100. */
  sandbox(sub, quantity, angle, spread) {
    this.waveInProgress = true;
    this.wavesSent += 1;
    for (let i = 0; i < quantity; i++) this.spawn(sub, angle, spread, 1, 2500, 100);
    this.lastWave = { n: this.wavesSent, sub, count: quantity, angle, spread, tick: this.ticks };
  }

  /** frame_2/DoAction.as:377: seis enviadas (ni una más) y ninguna en vuelo. */
  get wavesCleared() { return this.wavesSent === 6 && !this.waveInProgress; }

  /** spawnQue(), frame_2/DoAction.as:1065-1113. */
  _spawnOne() {
    const [sub, angle, spread, hpMulti, distance, damage] = this.spawnQueue.shift();
    const a = angle + spread / 2 - random(this, spread);
    // frame_2/DoAction.as:1092-1099: _y = mcMiddle._x + sin, _x = mcMiddle._y + cos.
    // Las coordenadas del punto de reunión van cruzadas; solo se nota cuando
    // mcMiddle ya no está en el origen. Se reproduce.
    const x = this.rally.y + Math.cos(a * DEG) * distance, y = this.rally.x + Math.sin(a * DEG) * distance;
    let life = B.SHIP_LIFE * (hpMulti || 1);
    if (sub === 6) life *= 8;
    const ship = new Ship(sub, x, y, a, life, damage / 2, this);
    this.ships.push(ship);
    this.celdas.registrar(ship);
  }

  /**
   * inMyCell(mc, range, 0, limit), cells.as:190-224: edificios (y bots) a
   * `range` del centro, sin restar tamaños; la nave toma el primero.
   */
  nearestNode(from, range, limit) { return this.celdas.buscar(from, range, 0, limit)?.[0].node ?? null; }

  /** inMyCell(mc, range, 1, limit, includeRockets): lo enemigo más cercano; los misiles enemigos cuentan si se pide. */
  nearestEnemy(from, range, includeRockets, limit) { return this.celdas.buscar(from, range, 1, limit, includeRockets)?.[0].node ?? null; }

  /** fire('rocket'), frame_2/DoAction.as:1139-1151. */
  fireRocket(from, target, damage, splash, life) {
    this.lastFired = 100;
    const r = new Rocket(from.x, from.y, target, from.kind === 'ship', damage, splash, life);
    this.rockets.push(r);
    this.celdas.registrar(r);
    if (r.enemy) this.rocketsFired += 1; else this.rocketsLaunched += 1;
    return r;
  }

  /**
   * splash(), frame_2/DoAction.as:1197-1205: daño entero al blanco y caída
   * lineal hasta cero en el borde para lo demás del mismo bando, con la
   * distancia truncada como en inCell.
   */
  splash(target, range, damage, enemy) {
    target.life -= Math.trunc(damage);
    // inMyCell(mc, range, enemy) sin límite: en el bando 0 caen también los bots
    for (const f of this.celdas.buscar(target, range, enemy ? 1 : 0) ?? []) {
      f.node.life -= Math.trunc(Math.trunc(damage / range * (range - f.range)));
    }
  }

  /** fire('laser'), frame_2/DoAction.as:1152-1183: el daño entra al instante. */
  fire(from, target, damage, colour = null, thickness = 1) {
    this.lastFired = 100;
    target.life -= damage;
    // una torreta con alcance igual o mayor que quien la ataca le devuelve el fuego
    if (from.kind === 'ship' && target.fireRange && target.fireRange >= from.fireRange) target.attackingMe = from;
    if (from.laser) return from.laser;
    const laser = { x1: from.x, y1: from.y, x2: target.x, y2: target.y,
                    enemy: from.kind === 'ship', colour, thickness, life: this.laserLife };
    this.lasers.push(laser);
    return laser;
  }
  dropLaser(l) { const i = this.lasers.indexOf(l); if (i >= 0) this.lasers.splice(i, 1); }

  /** sell(): devuelve value * vida/vidaMáxima — el 100 % a vida completa. */
  sell(node) {
    const refund = Math.floor(node.value * node.life / node.maxLife) || 0;   // int(NaN) = 0 en AS2
    this.minerals += refund;
    this.remove(node);
    return refund;
  }

  // -- rutas -----------------------------------------------------------------
  /**
   * path(), frame_2/DoAction.as:1223: borra TODAS las rutas y encola una
   * pasada de pathB() por fuente. Hasta que pathB() llega a una fuente, nadie
   * puede beber de ella: cada obra de fuente o relay con dos cables y cada
   * derribo apagan la red 2 ticks por fuente. Es balance del original y se
   * reproduce; ver _pathStepTick().
   */
  path() {
    for (const n of this.nodes) n.routes = new Map();
    this.pathStep = this.sources.length;
  }

  /** pathB(), :1231: el BFS de la fuente m = fuentes − _pathStep. */
  pathB() {
    const srcs = this.sources;
    const m = srcs.length - this.pathStep, src = srcs[m];
    if (!src || src.construction < B.PROPAGATE_AT) return;
    for (const n of this.nodes) n.routes.set(m, { mine: src, depth: B.UNREACHABLE, path: [] });
    let frontier = [src], depth = 1;
    const pathed = new Set();
    while (frontier.length) {
      const next = [];
      for (const cur of frontier) {
        pathed.add(cur.id);
        for (const nb of cur.links) {
          if (pathed.has(nb.id)) continue;
          const r = nb.routes.get(m);
          if (r.depth > depth) {
            r.depth = depth;
            r.path = [...cur.routes.get(m).path, cur];
          }
          if (nb.propagates) next.push(nb);
        }
      }
      depth += 1;
      frontier = next;
    }
  }

  /**
   * quickPath(A, B), :1208: B hereda las rutas de A un salto más lejos, sin
   * esperar a pathB(). Copia también las inalcanzables (depth 1000, ruta
   * vacía), que salen con ruta [A] y por tanto válidas para requestEnergy():
   * B bebe de fuentes a las que A no llega hasta el siguiente path(). Y si A
   * es un minero, B bebe a través de él aunque no relaye. Quirks del original.
   */
  quickPath(a, b) {
    b.routes = new Map();
    for (const [m, r] of a.routes) b.routes.set(m, { mine: r.mine, depth: r.depth + 1, path: [...r.path, a] });
  }

  /** :565-577, al cierre de tickGameB: una fuente cada dos ticks. */
  _pathStepTick() {
    if (this.pathTick <= 0) {
      this.pathTick = 1;
      if (this.pathStep > 0) { this.pathB(); this.pathStep -= 1; }
    } else {
      this.pathTick = 0;
    }
  }

  /** path() y todas sus pasadas de golpe. Solo para las comprobaciones. */
  repath() {
    this.path();
    while (this.pathStep > 0) { this.pathB(); this.pathStep -= 1; }
  }

  /**
   * requestEnergy(): drena las fuentes alcanzables, la MÁS LEJANA primero.
   * No es un reparto proporcional: el primer consumidor en tickear se lleva lo
   * que necesita. Por eso el orden de tick importa.
   */
  requestEnergy(node, needs) {
    if (needs <= 0) return 0;
    let got = 0;
    // sortOn("depth", DESCENDING | NUMERIC)
    const routes = [...node.routes.values()].sort((a, b) => b.depth - a.depth);
    for (const { mine: src, path } of routes) {
      if (!path.length) continue;   // :1327, la fuente misma o aún sin ruta
      if (node.kind === 'store' && src.kind === 'store') continue;
      if (src.construction !== src.targetConstruction) continue;
      const take = Math.min(src.energy, needs - got);
      if (take > 0) {
        src.energy -= take; got += take;
        // :1346-1358: moveTo(consumidor) y lineTo por cada punto de `path`, que
        // va de la FUENTE hacia el consumidor; con dos o más saltos el original
        // salta directo a la fuente y vuelve por los relays. Desviación
        // deliberada del port: se invierte para que el haz siga la ruta real,
        // consumidor → relay más cercano → … → fuente.
        this.flows.push({ x: node.x, y: node.y, pts: path.map((p) => [p.x, p.y]).reverse(), until: this.ticks + 3 });
      }
      if (got >= needs) break;
    }
    return got;
  }

  // -- planificador ----------------------------------------------------------
  /** tickGameB(): ticks alternos movimiento/red, con el ciclo de _tickRelays. */
  /** _waveCountdown, frame_2/DoAction.as:448: segundos hasta la próxima oleada. */
  get nextWaveIn() {
    const w = this.waves[this.waveNumber];
    if (!w || this.wavesByPercent) return null;
    return Math.trunc(w[0] - this.waveCounter / B.TICK_RATE);
  }

  /**
   * _playTime, frame_2/DoAction.as:429-436: sube uno cuando _timerStep llega
   * a 40 y vuelve a -1, o sea, cada 41 ticks. El reloj del original va un
   * 2,5 % lento; se reproduce porque las misiones por tiempo lo miran.
   */
  get playTime() { return Math.floor(this.ticks / 41); }

  // frame_2/DoAction.as:306-350: las misiones 3 y 9 se ganan por _playTime; la
  // 6 cuando pasados 190 s no queda ninguna nave en _movingQue.
  survived(seconds) { return this.playTime >= seconds; }
  get mothersRepelled() { return this.playTime > 190 && this.ships.length === 0; }

  tick() {
    this.ticks += 1;
    this.tickMoving += 1;
    if (this.lastFired > 0) this.lastFired -= 1;   // frame_2/DoAction.as:203-211, antes de que nadie dispare
    if (this.flows.length) this.flows = this.flows.filter((f) => f.until > this.ticks);
    // graph.collect() cierra el tick del original (frame_2/DoAction.as:578);
    // abrir el siguiente con ella lee el mismo estado.
    this._collectGraph();
    // tickGameB, frame_2/DoAction.as:445-497: disparador por tiempo
    if (this.waves.length) {
      this.waveCounter += 1;
      const w = this.waves[this.waveNumber];
      // frame_2/DoAction.as:452-461: por porcentaje del objetivo o por segundos
      const toca = this.wavesByPercent ? 100 / this.wavesByPercent * this.totalMined >= w?.[0] : this.waveCounter >= w?.[0] * B.TICK_RATE;
      if (w && toca) {
        const angle = this.waveAngle ? this.waveAngle(this.rand) : w[5];
        for (let i = 0; i < w[2]; i++) this.spawn(w[1], angle, w[3], w[4]);
        this.lastWave = { n: this.waveNumber + 1, sub: w[1], count: w[2], angle, tick: this.ticks };
        this.waveNumber += 1;
      }
    }
    if (this.spawnQueue.length) this._spawnOne();
    if (this.tickMoving % B.NODE_TICK_PERIOD === 0) {
      const dead = [];
      for (const s of this.ships) if (s.tick(this)) dead.push(s);
      // el original suma a _kills también los misiles que caducan; aquí solo naves
      for (const s of dead) {
        s.removed = true; this.celdas.quitar(s); this.ships.splice(this.ships.indexOf(s), 1); this.kills += 1; this.deaths[s.sub] += 1;
        this.wrecks.push({ x: s.x, y: s.y, kind: 'ship', sub: s.sub, size: s.size, tick: this.ticks, hueco: false });
      }
      if (dead.length && !this.ships.length) this.waveInProgress = false;   // destroy(), frame_2/DoAction.as:650-661
      const gone = [];
      for (const r of this.rockets) if (r.tick(this)) gone.push(r);
      for (const r of gone) { r.removed = true; this.celdas.quitar(r); this.rockets.splice(this.rockets.indexOf(r), 1); }
      const lost = [];
      for (const d of this.drones) if (d.tick(this)) lost.push(d);
      for (const d of lost) { d.removed = true; this.celdas.quitar(d); this.drones.splice(this.drones.indexOf(d), 1); }
      if (this.blasts.length) this.blasts = this.blasts.filter((b) => b.until > this.ticks);
      if (this.wrecks.length) this.wrecks = this.wrecks.filter((w) => w.hueco || this.ticks - w.tick < 4);
      this._pathStepTick();
      return;
    }
    this.tickRelays += 1;
    const dead = [];
    for (const n of [...this.nodes]) {
      let active = n.kind !== 'relay' && n.kind !== 'miner';
      if (this.tickRelays === B.RELAY_SLOT && n.kind === 'relay') active = true;
      else if (this.tickRelays === B.MINER_SLOT && n.kind === 'miner') active = true;
      if (this.tickRelays > B.RELAY_CYCLE - 1) this.tickRelays = 0;
      if (active && n.tick(this)) dead.push(n);
    }
    for (const n of dead) {
      this.remove(n); this.destroyed += 1;   // SFX bang5
      this.wrecks.push({ x: n.x, y: n.y, kind: n.kind, size: n.size, tick: this.ticks, hueco: true });
    }
    if (this.beams.length) this.beams = this.beams.filter((b) => b.until > this.ticks);
    this._pathStepTick();
  }

  run(seconds) { for (let i = 0; i < seconds * B.TICK_RATE; i++) this.tick(); }

  // graph.collect(), graph.as:69-119
  _collectGraph() {
    const g = this.graph;
    if (g.tick > 0) { g.tick -= 1; return; }
    if (g.tickTo < 400) g.tickTo += 1;
    g.tick = g.tickTo;
    let energia = 0, minado = 0;
    for (const n of this.nodes) {
      if ((n.kind === 'energy' || n.kind === 'store') && n.construction >= 10) energia += n.energy;
      // _mining && _minedOK && obra acabada; aquí lowPower hace de _minedOK
      else if (n.kind === 'miner' && n.built && !n.lowPower) minado += n.mineQuantity;
    }
    energia = Math.trunc(energia); minado = Math.trunc(minado);
    if (energia > g.maxEnergy) g.maxEnergy = energia;
    if (minado > g.maxMining) g.maxMining = minado;
    g.data.push([energia, minado, Math.trunc(this.totalMined)]);
  }

  /**
   * frame_2/DoAction.as:351 — victoria en los modos de minado: _totalMined
   * se recorta al objetivo para que el marcador no lo pase.
   */
  reachedGoal(goal) {
    if (!goal || this.totalMined < goal) return false;
    this.totalMined = goal;
    return true;
  }

  /**
   * destroy(), frame_2/DoAction.as:675-686 — única condición de derrota: no
   * queda ningún nodo con _construction > 1. No hay base con vida. El
   * original solo lo mira al destruir un nodo; aquí se consulta cada tick y da
   * lo mismo, porque solo cambia cuando un nodo cae.
   */
  get defeated() { return !this.nodes.some((n) => n.construction > 1); }
}

