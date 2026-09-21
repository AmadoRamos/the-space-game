// Tablas de balance de The Space Game v83, portadas de DATA/Python/balance.py.
// Fuente última: DATA/SWF/scripts/. Solo datos y los generadores que el propio
// juego usa para producirlos.
//
// Esta rebanada cubre minado, energía y la primera nave; el resto de armas y
// naves llegan con el Bloque 1 de TODO.md.

// --- Tiempo -----------------------------------------------------------------
// frame_2/DoAction.as:429
export const TICK_RATE = 40;        // ticks de simulación por segundo

// frame_2/DoAction.as:501-545 -- planificador alterno par/impar
export const NODE_TICK_PERIOD = 2;  // un tick de nodos cada 2 de simulación
export const RELAY_CYCLE = 9;
export const RELAY_SLOT = 1;
export const MINER_SLOT = 3;
// => relays y mineros tickean 1 de cada 18 ticks

// --- Edificios --------------------------------------------------------------
// coste: frame_2/DoAction.as:1657 · resto: __Packages/building*.as
export const BUILDINGS = {
  relay: {
    cost: 20, size: 8, energyRange: 90,
    relayEnergy: true, maxLinks: 6,
    life: 100, maxEnergy: 0,
    targetConstruction: 10, constructionTick: 0,
    // buildingRelay.as: pide 1 por tick propio y con >= 0.5 avanza 2 pasos.
    // constructionTick existe en el original pero nunca se lee.
    constructionStep: 2, constructionThreshold: 0.5,
    label: 'Relay', upgrades: [],
  },
  miner: {
    cost: 45, size: 15, energyRange: 90,
    relayEnergy: false, maxLinks: 1,
    life: 300, maxEnergy: 1,
    targetConstruction: 10, constructionTick: 0,
    mineRange: 35, mineRate: 60, mineStep: 8, mineQuantity: 4,
    label: 'Minero',
    upgrades: [{ cost: 100, life: 200, mineQuantity: 10, targetConstruction: 5 }],
  },
  energy: {
    cost: 200, size: 25, energyRange: 90,
    relayEnergy: true, maxLinks: null,
    life: 600, maxEnergy: 4,
    targetConstruction: 10, constructionTick: 10,
    // buildingEnergy.as: +genAmount * efficiency cada genPeriod ticks propios
    genAmount: 3, genPeriod: 10, efficiency: 0.3,
    label: 'Planta',
    upgrades: [
      { cost: 200, life: 200, maxEnergy: 5, efficiency: 0.7, targetConstruction: 10, constructionTick: -2 },
      { cost: 200, life: 200, maxEnergy: 5, efficiency: 1.0, targetConstruction: 10, constructionTick: -2 },
    ],
  },
  store: {
    cost: 300, size: 30, energyRange: 90,
    relayEnergy: true, maxLinks: null,
    life: 500, maxEnergy: 200,
    targetConstruction: 10, constructionTick: 10,
    refillPeriod: 20,
    label: 'Almacén',
    upgrades: [{ cost: 500, life: 250, maxEnergy: 400, targetConstruction: 10, constructionTick: -2 }],
  },
  // buildingLaser.as:76-105, la torreta base (subType 0). No admite la mejora
  // genérica: se bifurca a Pulse (P) o THEL (T), pendientes en TODO.md.
  laser: {
    cost: 100, size: 18, energyRange: 90,
    relayEnergy: false, maxLinks: 1,
    life: 200, maxEnergy: 1,
    targetConstruction: 10, constructionTick: 15,
    fireRange: 90, fireStart: 5, fireCooldown: 20, damage: 30, energyNeeded: 2,
    incRockets: true,        // la base y el Pulse derriban misiles; el THEL no (:101, :165)
    colour: '#02f6ff',
    label: 'Torreta', upgrades: [],
  },
  // buildingRepair.as:46-91. Hasta 4 bots (_maxRepairBots), no los 2 del
  // canvas de diseño; cada uno se fabrica con 10 de energía a razón de una
  // petición cada 10 ticks (:208-236). La mejora suma _upgradeCost / 2 al valor
  // SIN GetNum(): el valor queda NaN y la venta devuelve int(NaN) = 0 (:107).
  repair: {
    cost: 300, size: 24, energyRange: 90,
    relayEnergy: false, maxLinks: 1,
    life: 400, maxEnergy: 5,
    targetConstruction: 10, constructionTick: 15,
    repairRange: 200, maxBots: 4, botEnergy: 10, botTick: 10, targetTick: 80, retargetTick: 30,
    label: 'Reparadora',
    upgrades: [{ cost: 150, life: 200, repairRange: 100, targetConstruction: 10, constructionTick: -2, valueNaN: true }],
  },
  // buildingRocket.as:49-92. maxEnergy 1 en el constructor (:65), no 2 como
  // dice el GDD §5.7; las mejoras lo dejan en rockets + 1 (:117). Cada misil
  // cuesta 5 minerales y 1 de energía (:271-275).
  rocket: {
    cost: 400, size: 14, energyRange: 90,
    relayEnergy: false, maxLinks: 1,
    life: 500, maxEnergy: 1,
    targetConstruction: 10, constructionTick: 15,
    fireRange: 400, damage: 450, splash: 40, rockets: 1,
    salvoGap: 15, reload: 200, reloadIdle: 20, rocketLife: 200, rocketCost: 5,
    label: 'Lanzamisiles',
    upgrades: [
      { cost: 500, life: 20, damage: 50, rockets: '*2', fireRange: '*1.2', splash: '*1.1', maxEnergy: 2, targetConstruction: 20, constructionTick: -5 },
      { cost: 1000, life: 20, damage: 50, rockets: '*2', fireRange: '*1.2', splash: '*1.1', maxEnergy: 2, targetConstruction: 20, constructionTick: -5 },
    ],
  },
};

// buildingLaser.as:120-166: las dos conversiones de la torreta base (teclas P y
// T, DefineSprite_1084/frame_1/DoAction.as:178-185) y sus mejoras (:167-252).
// Los costes de mejora del THEL son 800 y 1000 (_upgradeCost tras convertir y
// tras el nivel 2, confirmado por _hackCheck :102), no 1000 y 2000 como dice el
// GDD §5.6. Los campos sin sufijo se asignan; damage, life, targetConstruction
// y constructionTick se suman (ADDITIVE).
export const LASER_BRANCHES = {
  1: {
    label: 'Pulse', sprite: 'pulse', cost: 100, valueAdd: 50, subType: 1,
    set: { fireRange: 110, fireStart: 4, fireCooldown: 10, damage: 12, energyNeeded: 5, colour: '#9FDF00' },
    life: 100, targetConstruction: 5, constructionTick: -2,
    upgrades: [
      { cost: 150, fireRange: 115, fireCooldown: 8, damage: 2, energyNeeded: 10, life: 200, targetConstruction: 5, constructionTick: -2 },
      { cost: 300, fireRange: 130, fireCooldown: 6, damage: 2, energyNeeded: 15, life: 400, targetConstruction: 5, constructionTick: -2 },
    ],
  },
  2: {
    label: 'THEL', sprite: 'thel', cost: 500, valueAdd: 250, subType: 2,
    set: { fireRange: 200, fireStart: 0, damage: 1, energyNeeded: 10, colour: '#FFBA00', incRockets: false },
    life: 200, targetConstruction: 10, constructionTick: -2,
    upgrades: [
      { cost: 800, fireRange: 290, damage: 4, energyNeeded: 20, life: 200, targetConstruction: 10, constructionTick: -2 },
      { cost: 1000, fireRange: 390, damage: 5, energyNeeded: 35, life: 360, targetConstruction: 20, constructionTick: -2 },
    ],
  },
};

// Campos de mejora que se SUMAN al valor actual en vez de reemplazarlo.
export const ADDITIVE = new Set([
  'maxEnergy', 'targetConstruction', 'constructionTick', 'repairRange', 'damage', 'rockets',
]);

// buildingEnergy/Relay/Store comprueban `_construction >= 10` literal, no
// `>= _targetConstruction`: un edificio mejorándose sigue propagando.
export const PROPAGATE_AT = 10;
export const UNREACHABLE = 1000;

// --- Asteroides -------------------------------------------------------------
// asteroidField.as: minerales = (5 + tamaño) * 52; radio = 5 + tamaño
export const ASTEROID_SIZE_OFFSET = 5;
export const ASTEROID_UNIT = 52;
export const asteroidMinerals = (size) => (ASTEROID_SIZE_OFFSET + size) * ASTEROID_UNIT;

// --- PRNG -------------------------------------------------------------------
/** Park-Miller, puerto literal de __Packages/PM_PRNG.as. */
export class PM_PRNG {
  constructor(seed = 1) { this.seed = seed; }
  gen() { return (this.seed = (this.seed * 16807) % 2147483647); }
  nextDouble() { return this.gen() / 2147483647; }
  nextIntRange(lo, hi) {
    lo -= 0.4999; hi += 0.4999;
    // Math.round de AS2 y de JS coinciden: mitad hacia +infinito.
    return Math.round(lo + (hi - lo) * this.nextDouble());
  }
}

/**
 * genAsteroids() de asteroidField.as.
 *
 * Reproduce dos rarezas del original a propósito:
 *  - el ángulo por asteroide sale de nextIntRange(0,360) y se pasa DIRECTO a
 *    Math.cos/sin sin convertir a radianes. Es un fallo del original, pero es
 *    lo que produce su distribución característica a grumos: cambiarlo daría
 *    otro campo.
 *  - solo la rotación global sí convierte bien (grados -> radianes).
 */
export function genAsteroids({ quantity, scale, seed = null, minSize = 1, maxSize = 21,
                               pX = null, pY = null, pS = null }) {
  const pr = new PM_PRNG(seed === null ? 1 + Math.floor(Math.random() * 999) : seed);
  for (let i = 0; i < 200; i++) pr.nextIntRange(0, 360);   // calentamiento
  const base = pr.nextIntRange(0, 360);
  const rad = (base * Math.PI) / 180;
  const s = Math.sin(rad), c = Math.cos(rad);

  const out = [];
  for (let i = 0; i < quantity; i++) {
    let x, y, size;
    if (pX !== null) {
      x = pX; y = pY; size = pS;
    } else {
      const a = pr.nextIntRange(0, 360);              // sin convertir: ver arriba
      const rx = Math.cos(a) * (pr.nextIntRange(50, scale * 2.5) * 0.3);
      const ry = Math.sin(a) * pr.nextIntRange(50, scale * 2.5);
      x = rx * c - ry * s;
      y = rx * s + ry * c;
      if (Math.abs(x) < 50 && Math.abs(y) < 50) {
        x = pr.nextIntRange(100, 200);
        y = pr.nextIntRange(100, 200);
      }
      size = pr.nextIntRange(minSize, maxSize);
    }
    out.push({ x, y, size, rotation: i * 10 });        // asteroidField.as:88
  }
  return out;
}

// --- Oleadas ----------------------------------------------------------------
// levels.as. Cada oleada es [segundos, tipo de nave, cantidad, dispersión,
// HPmulti, ángulo]. El ángulo sale de un PM_PRNG con semilla 1 sin calentar
// más un random(360) sorteado una vez por partida (levels.as:22-23): la
// secuencia relativa es siempre la misma y solo gira el conjunto.
//
// Los modos de minado y de supervivencia comparten el bucle y cambian solo
// estas cifras: cantidad base y su tope, HPmulti y su tope, el segundo en que
// entra la oleada, el divisor de los enjambres y el grupo fijo de nodrizas.
// En supervivencia `t` es acumulativo: `[inicio, paso]`, y el paso baja un
// segundo por oleada hasta 20; el tope de HP deja de valer pasada la w 100.
const MODOS = {
  3: { cant: (w) => Math.min(w * 5, 40), hp: (w) => Math.min(Math.trunc(0.8 + w / 9), 6), t: (w) => w * 75 + 10, enjambre: 3, nodrizas: [3, 90] },      // levels.as:146-196
  4: { cant: (w) => Math.min(w * 6, 100), hp: (w) => Math.min(Math.trunc(0.8 + w / 8), 6), t: (w) => w * 70 + 10, enjambre: 2, nodrizas: [5, 180] },     // levels.as:216-268
  5: { cant: (w) => Math.min(7 + w * 8, 100), hp: (w) => Math.min(Math.trunc(0.8 + w / 8), 6), t: (w) => w * 65, enjambre: 1.8, nodrizas: [8, 360] },    // levels.as:288-340
  6: { cant: (w) => Math.min(7 + w * 10, 100), hp: (w) => Math.min(Math.trunc(0.8 + w / 6), 8), t: (w) => w * 45 - 30, enjambre: 1.8, nodrizas: [8, 360] },   // levels.as:360-412
  8: { cant: (w) => Math.min(7 + w * 5, 100), hp: (w) => Math.min(Math.trunc(0.8 + w / 8), 10) + Math.max(0, w - 100), t: [80, 70], hasta: 120, enjambre: 1.8, nodrizas: [8, 360] },   // levels.as:429-492
  9: { cant: (w) => Math.min(7 + w * 6, 100), hp: (w) => Math.min(Math.trunc(0.8 + w / 8), 15) + Math.max(0, w - 100), t: [70, 65], hasta: 120, enjambre: 1.8, nodrizas: [8, 360] },   // levels.as:515-578
  10: { cant: (w) => Math.min(7 + w * 7, 100), hp: (w) => Math.min(Math.trunc(0.8 + w / 8), 20) + Math.max(0, w - 100), t: [60, 60], hasta: 120, enjambre: 1.8, nodrizas: [8, 360] },  // levels.as:601-664
  // Misión 3: solo cazas, misileras y explosivas, y la w sube una vez por
  // oleada (el tipo vuelve a 1 sin subirla). Misión 9: la tabla de Easy con
  // más naves y HP hasta 9.
  103: { cant: (w) => Math.min(5 + w * 5, 50), hp: (w) => Math.min(Math.trunc(0.8 + w / 8), 7), t: (w) => w * 60 + 10, tipos: 3 },   // levels.as:735-773
  109: { cant: (w) => Math.min(10 + w * 8, 100), hp: (w) => Math.min(Math.trunc(0.8 + w / 5), 9), t: (w) => 10 + w * 60, enjambre: 3, nodrizas: [3, 90] },   // levels.as:800-855
};
// Misiones con tabla literal (levels.as:725-799). El primer campo es el
// PORCENTAJE del objetivo minado que la dispara (frame_2/DoAction.as:452-458),
// salvo en la 106, que va por segundos. La 106 lleva en el original un
// centinela final `[1000000]` para no salirse de la tabla; aquí no hace falta.
const MISIONES = {
  101: [[20,1,5,10,0.9,0],[50,1,10,20,0.9,0],[80,1,15,30,0.9,0]],
  102: [[20,2,10,10,0.9,0],[45,2,15,15,0.9,180],[70,2,20,20,0.9,0],[90,2,25,20,0.9,0]],
  104: [[20,4,6,5,0,38],[40,1,17,20,1,85],[55,2,14,60,1,310],[70,3,13,80,1,203],[82,4,8,25,1,230],[90,4,8,25,1,230]],
  105: [[15,5,6,15,0,207],[30,5,18,20,1,254],[55,5,11,60,1,479],[70,5,14,15,1,372],[85,5,33,50,1,399],[95,5,33,50,1,399]],
  106: [[180,6,5,135,2,0],[190,6,5,135,2,0],[200,6,5,135,2,0],[210,6,5,135,2,0],[220,6,5,135,2,0],[300,6,10,135,2,0]],
  107: [[10,1,15,10,0,249],[25,2,13,40,1,296],[40,3,12,60,1,521],[60,4,15,20,1,414],[75,5,11,20,1,441],[90,6,3,90,1,328]],
  108: [[10,1,16,10,0,154],[25,2,14,40,1,201],[40,3,14,60,1,426],[60,4,17,20,1,319],[75,5,13,20,1,346],[90,6,8,90,1,233]],
};
export function generarOleadas(nivel, aleatorio = Math.random) {
  if (MISIONES[nivel]) return MISIONES[nivel].map((w) => [...w]);
  const pr = new PM_PRNG(1);
  const giro = Math.floor(aleatorio() * 360);
  const out = [];
  const m = MODOS[nivel];
  if (!m) return out;
  let tipo = 1, w = 1;
  let [acum, paso] = Array.isArray(m.t) ? m.t : [0, 0];
  while (w < (m.hasta ?? 100)) {
    let cant = m.cant(w);
    const hp = m.hp(w);
    let disp = w * 10;
    if (tipo === 2) { cant /= 1.5; disp *= 2; }
    if (tipo === 3) { cant /= 2; disp *= 2; }
    if (tipo === 4) { cant /= 2; disp /= 2; }
    if (tipo === 5) { cant /= m.enjambre; disp = 20; }
    if (tipo === 6) [cant, disp] = m.nodrizas;
    let t;
    if (Array.isArray(m.t)) { t = acum; acum += paso; if (paso > 20) paso -= 1; } else t = m.t(w);
    out.push([t, tipo, Math.trunc(cant), Math.trunc(disp), hp, pr.nextIntRange(0, 360) + giro]);
    tipo += 1;
    if (tipo > (m.tipos ?? 6)) { tipo = 1; if (!m.tipos) w += 1; }   // sí: w sube dos veces cada seis oleadas
    w += 1;
  }
  return out;
}

// --- Niveles ----------------------------------------------------------------
// levels.as. Solo los que esta rebanada sabe jugar (sin combate).
export const LEVELS = {
  // Training 1 y 2, levels.as:69-127: campos fijos, edificios de partida y
  // ningún permiso de construir; el guion del clip (tutorial1/tutorial2) los
  // va dando por etapas (main.js, GUION). El 2 fija 2000 minerales y luego
  // los deja en 200 tras colocar lo de partida (:123).
  1: {
    title: 'Entrenamiento 1',
    tag: 'Minado y energía',
    desc: 'Paso a paso: mineros, relays, la planta y cómo moverse por el mapa.',
    tarjeta: ['guiado', 'paso a paso'],
    minerals: 1000,
    field: { quantity: 1, pX: -150, pY: 0, pS: 5, seed: 1 },
    build: [],
    canScroll: false, canZoom: false,
    goal: null,
  },
  2: {
    title: 'Entrenamiento 2',
    tag: 'Defensa',
    desc: 'Torreta, Pulse y reparadora contra dos oleadas pequeñas de cazas.',
    tarjeta: ['guiado', 'paso a paso'],
    minerals: 200,
    field: [{ quantity: 1, pX: -100, pY: 0, pS: 20, seed: 1 }, { quantity: 1, pX: 100, pY: 0, pS: 18, seed: 1 },
            { quantity: 1, pX: 50, pY: 100, pS: 16, seed: 1 }],
    inicio: [['energy', 0, 0, 3], ['miner', -70, -25], ['miner', -90, -40], ['relay', -35, -45]],
    build: [],
    canScroll: false, canZoom: false,
    goal: null,
  },
  // Easy Mode, levels.as:128-197. `waveAngle` es la regla de tickGameB para
  // el nivel 3 (frame_2/DoAction.as:464-467): ignora el ángulo de la tabla y
  // entra siempre por 10 - random(20), es decir, por el este.
  3: {
    title: 'Fácil',
    tag: 'Fácil',
    desc: 'Un solo campo de asteroides. Mina hasta el objetivo antes de que las oleadas te desmonten la red.',
    oleadas: 'una cada 75 s',
    minerals: 1000,
    field: { quantity: 50, scale: 400 },
    build: ['relay', 'miner', 'energy', 'store', 'repair', 'laser', 'rocket'],
    canScroll: true, canZoom: true,
    goal: 15000,
    waves: 3,
    waveAngle: (rand) => 10 - Math.floor(rand() * 20),
  },
  // Normal Mode, levels.as:198-269. El ángulo (frame_2/DoAction.as:468-477)
  // es el este o el oeste a cara o cruz, ±10.
  4: {
    title: 'Normal',
    tag: 'Normal',
    desc: 'Un solo campo de asteroides. Mina hasta el objetivo antes de que las oleadas te desmonten la red.',
    oleadas: 'una cada 70 s',
    minerals: 1200,
    field: { quantity: 60, scale: 500 },
    build: ['relay', 'miner', 'energy', 'store', 'repair', 'laser', 'rocket'],
    canScroll: true, canZoom: true,
    goal: 30000,
    waves: 4,
    waveAngle: (rand) => (Math.floor(rand() * 2) === 1 ? 10 : 190) - Math.floor(rand() * 20),
  },
  // Hard Mode, levels.as:270-341. Desde aquí el ángulo es el de la tabla.
  5: {
    title: 'Difícil',
    tag: 'Difícil',
    desc: 'Campo más grande, oleadas más gordas y desde cualquier rumbo.',
    oleadas: 'una cada 65 s',
    minerals: 2000,
    field: { quantity: 80, scale: 600 },
    build: ['relay', 'miner', 'energy', 'store', 'repair', 'laser', 'rocket'],
    canScroll: true, canZoom: true,
    goal: 40000,
    waves: 5,
  },
  // Madness!, levels.as:342-413: la primera oleada entra a los 15 s.
  6: {
    title: 'Locura',
    tag: 'Locura',
    desc: 'La primera oleada llega a los quince segundos y el HPmulti sube hasta 8.',
    oleadas: 'una cada 45 s',
    minerals: 2500,
    field: { quantity: 85, scale: 650 },
    build: ['relay', 'miner', 'energy', 'store', 'repair', 'laser', 'rocket'],
    canScroll: true, canZoom: true,
    goal: 40000,
    waves: 6,
  },
  // Survivor, levels.as:414-666: sin objetivo (_goal = 0), campo de 70 a 650,
  // y la partida acaba siempre en derrota; la marca es el tiempo aguantado
  // (CCAPI "score" = _playTime, frame_2/DoAction.as:904).
  8: {
    title: 'Supervivencia',
    tag: 'Suave',
    desc: 'Sin objetivo: aguanta todo lo que puedas. Las oleadas se acercan hasta llegar una cada 20 s.',
    oleadas: 'de 70 s a 20 s',
    minerals: 2000,
    field: { quantity: 70, scale: 650 },
    build: ['relay', 'miner', 'energy', 'store', 'repair', 'laser', 'rocket'],
    canScroll: true, canZoom: true,
    goal: null, marca: 'mayor',
    waves: 8,
  },
  9: {
    title: 'Supervivencia',
    tag: 'Venga',
    desc: 'Oleadas más gordas y HPmulti hasta 15. Pasada la oleada 100 ya no hay tope.',
    oleadas: 'de 65 s a 20 s',
    minerals: 2000,
    field: { quantity: 70, scale: 650 },
    build: ['relay', 'miner', 'energy', 'store', 'repair', 'laser', 'rocket'],
    canScroll: true, canZoom: true,
    goal: null, marca: 'mayor',
    waves: 9,
  },
  10: {
    title: 'Supervivencia',
    tag: 'Sin esperanza',
    desc: 'La primera oleada al minuto, HPmulti hasta 20 y luego sin tope. El nombre lo dice todo.',
    oleadas: 'de 60 s a 20 s',
    minerals: 2000,
    field: { quantity: 70, scale: 650 },
    build: ['relay', 'miner', 'energy', 'store', 'repair', 'laser', 'rocket'],
    canScroll: true, canZoom: true,
    goal: null, marca: 'mayor',
    waves: 10,
  },
  // Wave Mode, levels.as:658-679: campo de 80 a 500, 2000 minerales, sin
  // tabla; las seis oleadas las lanza el jugador (wave(), frame_2/DoAction.as:943)
  // y se gana cuando las seis han salido y no queda ninguna nave (:377).
  11: {
    title: 'Modo oleada',
    tag: 'Modo oleada',
    desc: 'Seis oleadas, una por tipo, y las lanzas tú cuando quieras. El orden es la estrategia.',
    oleadas: 'las lanzas tú',
    tarjeta: ['seis oleadas', 'cuando tú digas'],
    minerals: 2000,
    field: { quantity: 80, scale: 500 },
    build: ['relay', 'miner', 'energy', 'store', 'repair', 'laser', 'rocket'],
    canScroll: true, canZoom: true,
    goal: null,
    modo: 'oleadas',
  },
  // Sandbox, levels.as:701-721: 100 200 minerales, sin campo, sin objetivo.
  // Las naves las manda el panel (sandbox(), frame_2/DoAction.as:1043).
  13: {
    title: 'Caja de arena',
    tag: 'Caja de arena',
    desc: 'Sin asteroides, sin objetivo y 100 200 minerales. Elige nave, cantidad, rumbo y dispersión, y mira qué aguanta tu red.',
    oleadas: 'las que quieras',
    tarjeta: ['sin fin', 'hasta que caiga la red'],
    minerals: 100200,
    field: { quantity: 0 },
    build: ['relay', 'miner', 'energy', 'store', 'repair', 'laser', 'rocket'],
    canScroll: true, canZoom: true,
    goal: null,
    modo: 'arena',
  },
  // No es un nivel del original: campo de Normal Mode (60 asteroides, 1200
  // minerales) sin oleadas, para aprender la red con topología real. El
  // objetivo NO viene del AS2: 3000 es lo que tarda una red de 8-10 mineros
  // en un rato corto.
  0: {
    title: 'Tutorial',
    desc: 'Un campo real sin enemigos. Tiende la red, mina hasta el objetivo.',
    minerals: 1200,
    field: { quantity: 60, scale: 500, seed: 418 },
    build: ['relay', 'miner', 'energy', 'store'],
    canScroll: true, canZoom: true,
    goal: 3000,
  },
  // Speed Miner, levels.as:681-700: 400 minerales, genAsteroids(25, 200, …,
  // seed 15) y el objetivo es lo que devuelve genAsteroids, la suma de
  // minerales del campo (asteroidField.as:90-103). Sin oleadas. El original
  // habilita también láser, cohete y reparador, pero sin naves no disparan y
  // la reparadora solo atiende nodos con _life < _maxLife (cells.as:209): son
  // solo la barra completa. Se añaden por fidelidad cuando existan.
  12: {
    title: 'Minero veloz',
    tag: 'Contrarreloj',
    desc: 'Mina el campo entero lo más rápido que puedas. Sin enemigos: la puntuación es el reloj.',
    minerals: 400,
    field: { quantity: 25, scale: 200, seed: 15 },
    build: ['relay', 'miner', 'energy', 'store', 'repair', 'laser', 'rocket'],
    canScroll: true, canZoom: true,
    goal: 'campo',
  },
};

// Misiones 1-9, levels.as:722-876: 600 + m × 100 minerales (la 6, 20 000),
// campo de 5 + m × 5 asteroides a escala 25 + m × 50 con semilla fija 100 + m
// y tamaños m … (m + 12) / 2, y el objetivo es la MITAD de sus minerales. La
// 6 no genera campo (:868). Las oleadas se disparan por porcentaje minado,
// salvo 103 y 109 (aguantar 600 y 1200 s) y 106 (nodrizas a los 180 s, y se
// gana cuando pasados 190 s no queda ninguna nave; frame_2/DoAction.as:306-350).
// Los textos son del port: el original los lleva en el clip de la misión.
const DESC_MISION = {
  101: ['Tres oleadas de cazas al 20, 50 y 80 % del objetivo.', 'al 20, 50 y 80 %'],
  102: ['Misileras: cuatro oleadas, una de ellas por el oeste.', 'al 20, 45, 70 y 90 %'],
  103: ['Aguanta diez minutos: cazas, misileras y explosivas, una oleada por minuto.', 'una por minuto'],
  104: ['Anilladas de entrada y luego los cuatro primeros tipos, uno tras otro.', 'del 20 al 90 %'],
  105: ['Solo enjambres, cada vez más grandes.', 'del 15 al 95 %'],
  106: ['Sin asteroides y con 20 000 minerales: a los tres minutos llegan las nodrizas. Derríbalas todas.', 'nodrizas a los 3:00'],
  107: ['Los seis tipos en orden, del 10 al 90 % del objetivo.', 'del 10 al 90 %'],
  108: ['Como la 7, con más naves y ocho nodrizas al final.', 'del 10 al 90 %'],
  109: ['Aguanta veinte minutos con toda la fuerza del enemigo encima.', 'una por minuto'],
};
for (let m = 1; m <= 9; m++) {
  const n = 100 + m;
  LEVELS[n] = {
    title: `Misión ${m}`,
    tag: `Misión ${m}`,
    desc: DESC_MISION[n][0],
    oleadas: DESC_MISION[n][1],
    minerals: n === 106 ? 20000 : 600 + m * 100,
    field: n === 106 ? { quantity: 0 } : { quantity: 5 + m * 5, scale: 25 + m * 50, seed: n, minSize: m, maxSize: (m + 12) / 2 },
    build: ['relay', 'miner', 'energy', 'store', 'repair', 'laser', 'rocket'],
    canScroll: true, canZoom: true,
    goal: n === 106 ? null : 'mitad',
    waves: n,
    porPorcentaje: n !== 103 && n !== 106 && n !== 109,
    sobrevivir: n === 103 ? 600 : n === 109 ? 1200 : null,
    nodrizas: n === 106,
  };
}

// --- Naves ------------------------------------------------------------------
// Constructor de cada __Packages/shipN.as. Velocidad = base + random(rnd)/1000;
// entra a 40× esa velocidad y frena 1 por tick (ship1.as:34-35, :81-88).
export const SHIPS = {
  1: {
    label: 'Cazas',
    speed: 0.8, speedRandom: 300, entry: 40, easing: 40, turnEvery: 3,
    fireRange: 70, fireStep: 50, size: 10,
    mmReset: 20, retarget: [20, 10],             // ship1.as:99, :140
    weapon: 'laser', damageDiv: 20,              // láser de _damage/20 por tick, ship1.as:147
    burst: [10, 2],                              // al fijar blanco, _fireStep = 10 + random(2)
    burstBelow: 8, reload: [50, 0],              // dispara con _fireStep <= 7 y recarga a 50
  },
  2: {
    label: 'Misileras',
    speed: 0.8, speedRandom: 300, entry: 40, easing: 70, turnEvery: 3,
    fireRange: 200, fireStep: 50, size: 10,
    mmReset: 15, retarget: [30, 0],              // ship2.as:85, :125
    weapon: 'rocket', splash: 30, rocketLife: 30, cooldown: 90,   // ship2.as:134-136
  },
  // ship3.as: entra a 19× (no 40×), gira cada 2 ticks, y al fijar blanco se
  // frena 0.05 por tick con giro cerrado (easing 10) mientras cuenta la mecha;
  // a los 60 ticks detona _damage × 1.2 en radio 100 (:52, :99-126, :181-186).
  3: {
    label: 'Explosivas',
    speed: 1.8, speedRandom: 300, entry: 19, easing: 45, turnEvery: 2,
    fireRange: 70, fireStep: 50, size: 10,
    mmReset: 15, retarget: [30, 0],
    weapon: 'fuse', fuse: 60, blast: 100, damageMul: 1.2, brakeEasing: 10,
  },
  // ship4.as: entra a 15×, easing 70, alcance 60. Al fijar blanco pone
  // _targetSpeed = 0 y frena 0.2 por tick; parada (<= 0.5) hace láser continuo
  // de _damage/80 color 0x62A400 (:36-46, :96-103, :140-167). Muere con bang2.
  4: {
    label: 'Anilladas',
    speed: 2, speedRandom: 500, entry: 15, easing: 70, turnEvery: 3,
    fireRange: 60, fireStep: 180, size: 10,
    mmReset: 15, retarget: [20, 0],
    weapon: 'beam', damageDiv: 80, colour: '#62A400', brake: 0.2, stopAt: 0.5,
    dies: 'bang2',
  },
  // ship5.as: un caza pequeño y rápido — entra a 15×, easing 15, tamaño 5 —
  // con ráfaga de 3 ticks a _damage/10 y recarga 30 + random(10) (:34-48, :147-153).
  5: {
    label: 'Enjambre',
    speed: 2.8, speedRandom: 300, entry: 15, easing: 15, turnEvery: 3,
    fireRange: 70, fireStep: 50, size: 5,
    mmReset: 15, retarget: [30, 0],
    weapon: 'laser', damageDiv: 10, colour: '#CCCCCC',
    burst: [10, 0], burstBelow: 3, reload: [30, 10],
    dies: 'bang2',
  },
  // ship6.as: 0.8 fijo, entra a 70×, easing 120, alcance 200, tamaño 50, vida
  // ×8 (spawnQue). Al fijar blanco se para (<= 0.2, frena 0.02) y hace un haz
  // de _damage/50 grosor 3; la primera vez suelta 5 escoltas (:154-178) y
  // después les pasa su blanco. Si muere, mueren con ella (:77-82).
  6: {
    label: 'Nodrizas',
    speed: 0.8, speedRandom: 0, entry: 70, easing: 120, turnEvery: 3,
    fireRange: 200, fireStep: 180, size: 50,
    mmReset: 15, retarget: [30, 0],
    weapon: 'beam', damageDiv: 50, colour: '#FF00FF', thickness: 3, brake: 0.02, stopAt: 0.2,
    escorts: 5, dies: 'bang3',
  },
  // ship7.as: la escolta. Nace en la nodriza con rumbo random(360), vida 100 y
  // daño 10 (:46-54, ship6.as:170); su objetivo es la nodriza y su blanco el
  // de ella. Ráfaga de 10 ticks a _damage/30 solo a menos de 70 (:135-153).
  7: {
    label: 'Escoltas',
    speed: 2.8, speedRandom: 300, entry: 2, easing: 15, turnEvery: 2,
    fireRange: 70, fireStep: 50, size: 5,
    mmReset: 15,
    weapon: 'escort', damageDiv: 30, colour: '#FF00FF', burstBelow: 10, reload: [50, 0],
    life: 100, damage: 10, dies: 'bang1',
  },
};
// rocket.as:19-33: acelera 0.05 por tick de 1 a 4 (8 si es del jugador),
// 300 ticks de combustible, detona a menos de 15 del blanco (:68).
export const ROCKET = { speed: 1, maxSpeed: 4, maxSpeedPlayer: 8, easing: 2, fuel: 300, hit: 15, seek: 100 };
// spawnQue, frame_2/DoAction.as:1074-1098: daño 100 partido por 2, vida 200×HP,
// entrada desde 2500.
export const SHIP_DAMAGE = 100;
export const SHIP_LIFE = 200;
export const SPAWN_DISTANCE = 2500;

// DefineSprite_1084/frame_1/DoAction.as:164
// DefineSprite_566_repair1/frame_1/DoAction.as:196-212 y buildingRepair.as:283:
// el bot nace con 20 de vida de 60 (se cura en la bahía), 80 de energía, 1.8
// de velocidad, giro 12, y repara a 50 con un láser de daño -1 por energía.
export const DRONE = { life: 20, maxLife: 60, energy: 80, maxSpeed: 1.8, easing: 12, repairRange: 50, bay: 9 };

export const HOTKEYS = { 1: 'relay', 2: 'miner', 3: 'energy', 4: 'store', 5: 'repair', 6: 'laser', 7: 'rocket' };
export const PLACEMENT_GRID = 5;
