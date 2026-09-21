// Render, entrada y HUD. La simulación entera vive en sim.js; aquí solo se
// dibuja lo que ese modelo dice y se le mandan órdenes.
//
// El render es SVG porque los assets YA son SVG: los <symbol> de sprites.svg son
// literalmente los del canvas de diseño, sin conversión.
// ponytail: SVG aguanta de sobra los ~80 nodos de una partida sin combate. Si
// algún día entran 200 naves a 40 fps, ese día se pasa a canvas — no antes.

import * as B from './balance.js';
import { Network, Node, Asteroid } from './sim.js';
import { selfCheck } from './comprobaciones.js';
import { iniciarSonido, sfx, musica, objetivosMusica } from './sonido.js';

const SVG = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);
const el = (name, attrs = {}) => {
  const n = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

// --- mundo ------------------------------------------------------------------
// `?nivel=N` elige el nivel; sin él, el tutorial. La partida la crea
// nuevaPartida(), al final del módulo, cuando ya existe todo lo que toca.
const consulta = new URLSearchParams(location.search);   // nuevaPartida() la reescribe
let idNivel = consulta.get('nivel') ?? '0';
let nivel = null, net = null;

// --- opciones ---------------------------------------------------------------
// DefineSprite_862_options: interruptores en el SharedObject `_o.data`; aquí en
// localStorage.
const opciones = { optCB: 0, optSL: 0, optSM: 0, optEL: 0, optMS: 0, sonido: 1, musica: 1 };
try { Object.assign(opciones, JSON.parse(localStorage.opciones ?? '{}')); } catch { /* sin almacén */ }
iniciarSonido(opciones);
// showMenu(1), frame_1/DoAction.as:69: fondo a 50 en el menú
musica({ backing: 50 });
function guardarOpciones() {
  try { localStorage.opciones = JSON.stringify(opciones); } catch { /* sin almacén */ }
}

// --- cámara -----------------------------------------------------------------
// `meta` es a donde quiere ir la cámara; `cam` es donde está. Sin optSM se
// acerca 1/5 por fotograma (DefineSprite_1084/frame_1/DoAction.as:39-60); con
// optSM salta.
const meta = { x: 0, y: 0, zoom: 1 };
const cam = { x: 0, y: 0, zoom: 1 };
const world = $('world');
const gCam = $('cam');

// Los sprites viven en sprites.svg y se inyectan aquí, dentro del mismo
// documento, en vez de referenciarlos como <use href="sprites.svg#id">: los
// degradados (fill="url(#roca)") solo resuelven contra el documento propio, y
// así ningún href cambia. El await bloquea el módulo hasta tenerlos: nada de
// lo de abajo corre sin sprites.
{
  const texto = await (await fetch('./sprites.svg')).text();
  const doc = new DOMParser().parseFromString(texto, 'image/svg+xml');
  world.prepend(document.adoptNode(doc.querySelector('defs')));
}

function aplicarCamara() {
  const w = innerWidth, h = innerHeight;
  world.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const dx = w / 2 - cam.x * cam.zoom, dy = h / 2 - cam.y * cam.zoom;
  gCam.setAttribute('transform', `translate(${dx} ${dy}) scale(${cam.zoom})`);
  // mcBackground 1-3 (DefineSprite_1084/frame_1/DoAction.as:111-124): escala
  // 80 + zoom%/5, /10, /20 y desplazamiento del mapa /10, /20, /40. Con optMS
  // no se vuelven a tocar y se quedan donde estaban, como en el original.
  if (opciones.optMS) return;
  [[5, 10], [10, 20], [20, 40]].forEach(([e, m], i) => {
    $(`gEstrellas${i + 1}`).setAttribute('transform',
      `translate(${w / 2 + (dx - w / 2) / m} ${h / 2 + (dy - h / 2) / m}) scale(${0.8 + cam.zoom / e})`);
  });
}
const aPantalla = (ev, c = cam) => {
  const w = innerWidth, h = innerHeight;
  return { x: (ev.clientX - w / 2) / c.zoom + c.x, y: (ev.clientY - h / 2) / c.zoom + c.y };
};
function moverCamara() {
  for (const k of ['x', 'y', 'zoom']) {
    const d = meta[k] - cam[k];
    cam[k] += opciones.optSM || Math.abs(d) < (k === 'zoom' ? 0.005 : 1) ? d : d / 5;
  }
  aplicarCamara();
}
addEventListener('resize', aplicarCamara);

// --- estrellas (tres capas; se dibujan una vez, aplicarCamara las mueve) -----
{
  const pr = new B.PM_PRNG(7);
  for (let i = 0; i < 340; i++) {
    $(`gEstrellas${i % 3 + 1}`).appendChild(el('circle', {
      cx: pr.nextIntRange(-1400, 1400), cy: pr.nextIntRange(-1000, 1000),
      r: pr.nextIntRange(4, 13) / 10, fill: '#fff',
      opacity: (pr.nextIntRange(12, 55) / 100).toFixed(2),
    }));
  }
}

// --- asteroides (estáticos salvo la capa seca) ------------------------------
const FORMAS = ['#fa', '#fb', '#fc'];
const capasSecas = new Map();
function pintarCampo() {
  const g = $('gAsteroides');
  g.replaceChildren();
  capasSecas.clear();
  net.asteroids.forEach((a, i) => {
    const w = 64 * (a.size / 26);          // el dibujo ocupa r≈26 en su viewBox
    const t = `translate(${a.x} ${a.y}) rotate(${a.rotation}) scale(${w / 64}) translate(-32 -32)`;
    const grupo = el('g', { transform: t });
    grupo.appendChild(el('use', {
      href: FORMAS[i % 3], fill: 'url(#roca)', stroke: '#453d2c', 'stroke-width': 1.2,
    }));
    const seca = el('use', {
      href: FORMAS[i % 3], fill: 'url(#rocaSeca)', stroke: '#3b352b',
      'stroke-width': 1.2, opacity: 0,
    });
    grupo.appendChild(seca);
    capasSecas.set(a, seca);
    g.appendChild(grupo);
  });
}

// --- sprites de edificio ----------------------------------------------------
const SPRITE = {
  relay: () => '#sp-relay',
  miner: (n) => (n.level > 1 ? '#sp-miner2' : '#sp-miner'),
  energy: (n) => (n.level > 2 ? '#sp-energy3' : n.level > 1 ? '#sp-energy2' : '#sp-energy'),
  store: (n) => (n.level > 1 ? '#sp-store2' : '#sp-store'),
  repair: (n) => (n.level > 1 ? '#sp-repair2' : '#sp-repair'),
  laser: (n) => (n.branch ? `#sp-${n.branch.sprite}${n.level > 1 ? n.level : ''}` : '#sp-laser'),
  rocket: (n) => (n.level > 2 ? '#sp-rocket3' : n.level > 1 ? '#sp-rocket2' : '#sp-rocket'),
};
// Anchos DIBUJADOS, del canvas de diseño. Son mayores que el _size del
// original (relay 8, minero 15, planta 25…), que es el ancho de su sprite y lo
// que usan las reglas de colocación crudo (`dist < _size`, frame_2/DoAction.as:1393).
// Divergencia aceptada: a 1× un relay de 8 px no se lee. La consecuencia es que
// dos edificios permitidos pueden solaparse en pantalla; la plantilla enseña la
// huella real (`size`) para que se vea por qué entra o por qué no.
// Acento de cada símbolo (currentColor en sprites.svg). Con mcLow (energía < 1,
// o minero parado, o relay con 6 cables) el acento pasa a rojo: los originales
// funden un clip rojo encima (buildingEnergy.as:232, buildingLaser.as:526,
// buildingMiner.as:258-301, buildingRelay.as:174-181). Los casos «al 50 %» del
// original (minado apagado, relay lleno) se mezclan a medias. Sin fundido.
const ACENTO = { energy: '#5AB8D9', relay: '#5AB8D9', miner: '#E9A25A', laser: '#EE8F6E' };
function colorAcento(n) {
  const base = ACENTO[n.kind] ?? '#5AB8D9';
  if (!n.lowPower || !(n.kind in ACENTO)) return base;
  const medio = n.kind === 'relay' || (n.kind === 'miner' && !net.minersOn);
  return medio ? `color-mix(in srgb, #E06A6A, ${base})` : '#E06A6A';
}
const TAM = { relay: 26, miner: 34, energy: 46, store: 40, repair: 44, laser: 36, rocket: 32 };
const TAM_NAVE = { 1: 26, 2: 26, 3: 26, 4: 30, 5: 16, 6: 96, 7: 14 };   // _size 10, 5 y 50
const TAM_BOT = 10;              // el bot no declara _size (repair1); ancho del canvas

/**
 * Qué hay bajo un punto del mundo. Las capas del SVG no reciben eventos
 * (index.html), así que el acierto es geométrico y contra lo DIBUJADO, no
 * contra el _size de colisión: si lo ves, lo puedes pinchar.
 * Los edificios ganan al asteroide que tengan debajo.
 */
function bajoElCursor(p) {
  let mejor = null, dmin = Infinity;
  for (const n of net.nodes) {
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if (d < TAM[n.kind] / 2 + 6 && d < dmin) { mejor = n; dmin = d; }
  }
  if (mejor) return mejor;
  for (const a of net.asteroids) {
    const d = Math.hypot(a.x - p.x, a.y - p.y);
    if (d < a.size && d < dmin) { mejor = a; dmin = d; }
  }
  return mejor;
}

function actualizarCursor() {
  world.style.cursor = construyendo ? 'crosshair'
    : bajoElCursor(raton) ? 'pointer' : 'default';
}

// --- estado de interfaz -----------------------------------------------------
let construyendo = null;     // tipo de edificio en la mano
let estado = 'menu';         // 'menu' | 'jugando' | 'victoria' | 'derrota'
let seleccion = null;
let raton = { x: 0, y: 0 };
let encadenar = false;

const MOTIVO = {
  overlap: 'ahí no cabe: se solapa con algo',
  onCable: 'cae encima de un cable ya tendido',
  noAsteroid: 'un minero necesita un asteroide con mineral a 35 px',
};

// design/Avisos.dc.html. `alerta` (rojo, 1,6 s) para lo que has intentado y no
// se puede; `nota` (neutro, 4 s) para informar; `exito` (verde, 4 s) para lo
// que ha salido. Se apilan hasta tres; repetir el mismo texto reaviva la
// pastilla en vez de apilarla. `html` admite <span class="n"> para cifras.
const ICONO = {
  oleada: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.2 21 19.4H3z"/><path d="M12 10v4M12 16.6v.1"/></svg>',
  alerta: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.2 21 19.4H3z"/><path d="M12 10v4M12 16.6v.1"/></svg>',
  nota: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="8.2"/><path d="M12 11v5M12 8.2v.1"/></svg>',
  exito: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.2"/><path d="M8.5 12.2l2.4 2.4 4.6-4.8"/></svg>',
};
function avisar(html, tipo = 'alerta', ms = tipo === 'alerta' ? 1600 : 4000) {
  const pila = $('avisos');
  let a = [...pila.children].find((x) => x.dataset.html === html && !x.classList.contains('fuera'));
  if (!a) {
    a = document.createElement('div');
    a.className = `aviso ${tipo}`;
    a.dataset.html = html;
    a.innerHTML = ICONO[tipo] + `<span>${html}</span>`;
    pila.appendChild(a);
    void a.offsetWidth;            // fuerza el reflow para que la transición arranque
    a.classList.add('on');
    while (pila.children.length > 3) pila.firstChild.remove();
  }
  clearTimeout(a._t);
  a._t = setTimeout(() => { a.classList.add('fuera'); setTimeout(() => a.remove(), 300); }, ms);
}

// Diálogo modal: congela la partida como el panel de opciones y resuelve con
// la respuesta. `color` es el del acto: 'rojo' destruye, ámbar (por defecto) cuesta.
function confirmar(titulo, texto, { si = 'Aceptar', no = 'Cancelar', color = '' } = {}) {
  return new Promise((resolver) => {
    abrirModal('dialogo');
    $('dTitulo').textContent = titulo;
    $('dTexto').textContent = texto;
    $('dSi').firstElementChild.textContent = si;
    $('dNo').firstElementChild.textContent = no;
    $('dSi').className = `accion ${color}`;
    const cerrar = (r) => { cerrarModal('dialogo'); removeEventListener('keydown', teclas, true); resolver(r); };
    const teclas = (ev) => {
      if (ev.key === 'Escape') { ev.stopPropagation(); cerrar(false); }
      if (ev.key === 'Enter') { ev.stopPropagation(); cerrar(true); }
    };
    addEventListener('keydown', teclas, true);
    $('dSi').onclick = () => cerrar(true);
    $('dNo').onclick = () => cerrar(false);
    $('velo').onclick = () => cerrar(false);
    $('dNo').focus();
  });
}

// --- barra de construcción --------------------------------------------------
// mcInfo (DefineSprite_1151): un fotograma de texto estático por edificio.
// Cada botón lleva una pestaña "Info" aparte del cuerpo (DefineSprite_1108,
// PlaceObject3_1104_5): rollOver → showInfo(clave), rollOut → hideInfo().
const INFO = {
  relay: '<b>Los relays</b> transportan la energía de las plantas solares y los almacenes al resto de estructuras reflejando y refractando la luz. Son baratos, pero frágiles.',
  energy: '<b>Las plantas solares</b> recogen la luz del sol y la convierten en <b>energía</b>, necesaria para construir y alimentar tus estructuras. Se pueden mejorar varias veces para aumentar su rendimiento.',
  miner: '<b>Los mineros</b> extraen <b>minerales</b> de cualquier asteroide a su alcance. Los minerales hacen falta para construir estructuras, naves y misiles. Se pueden mejorar para aumentar su rendimiento.',
  repair: '<b>Las reparadoras</b> fabrican hasta 4 drones que vuelan hasta cualquier estructura a su alcance, la reparan y vuelven. Te ahorran los minerales y la energía que gastarías en reponer lo perdido.',
  store: '<b>Los almacenes</b> absorben toda la energía sobrante de las plantas solares y la guardan para cuando haga falta. Ideales para armas que necesitan mucha energía de golpe o si te expandes rápido.',
  laser: '<b>Las torretas láser</b> son la defensa más básica: alcanzan el objetivo al instante y solo gastan energía al disparar. Se pueden mejorar a láser de pulsos o THEL.',
  rocket: '<b>Los lanzamisiles</b> disparan misiles explosivos a larga distancia. Los misiles siguen y reeligen enemigos una vez lanzados. Construirlos y dispararlos cuesta energía y minerales.',
  // panel de selección (mcInfo fotogramas 10-21)
  energyUpgrade: 'Mejora esta planta solar para <b>aumentar su rendimiento y su capacidad</b>: recogerá energía más rápido y guardará más para cuando haga falta.',
  minerUpgrade: 'Mejora este minero para aumentar la cantidad de minerales que extrae por minuto <b>de 80 a 200</b>.',
  storeUpgrade: 'Mejora este almacén para aumentar su capacidad <b>de 200 a 600 unidades</b> de energía, ideal si te quedas corto en plena batalla.',
  laserPulser: 'Los láseres de pulsos disparan rápido, a corto alcance y con poco daño. <b>Ideales contra misiles y enemigos pequeños.</b>',
  laserPlasma: 'Los THEL tienen <b>largo alcance y mucho daño</b>, pero disparan despacio: ideales contra enemigos fuertes. <b>No apuntan a misiles.</b>',
  rocketUpgrade: 'Mejora este lanzamisiles para aumentar su alcance y <b>el número de misiles que dispara a la vez</b>, a 5 minerales cada uno.',
  pulserUpgrade: 'Mejora este láser de pulsos para aumentar <b>su daño y su cadencia</b>, y que aguante más misiles y enemigos más fuertes.',
  plasmaUpgrade: 'Mejora este THEL para aumentar <b>su alcance y su daño</b>. Gasta más energía por disparo, pero merece la pena.',
  repairUpgrade: 'Mejora esta reparadora para <b>ampliar un 50 % el alcance</b> que cubre y mejorar su resistencia.',
  toggleMiners: 'Ordena a <b>TODOS los mineros</b> PARAR/ARRANCAR. Muy útil si te atacan y andas corto de energía.',
  toggleMissiles: 'Ordena a <b>TODOS los lanzamisiles</b> PARAR/ARRANCAR. Muy útil si confías en que los láseres te cubren y quieres reservar minerales.',
  // mcUI fotograma "building": sustituye a los botones mientras se coloca
  building: '<b>Clic</b> para empezar la construcción. Mantén <b>MAYÚS</b> para colocar varias copias. <b>ESC</b> o clic en otra estructura para cancelar.',
};
function mostrarInfo(clave) { $('info').innerHTML = INFO[clave] ?? ''; }
// La pestaña de `el` enseña `clave` (o `el.dataset.info` si se decide al pintar).
function pestanaInfo(el, clave) {
  const p = el.querySelector('.i');
  p.onclick = (ev) => ev.stopPropagation();   // solo informa, no actúa
  p.onmouseenter = () => mostrarInfo(clave ?? el.dataset.info);
  p.onmouseleave = () => mostrarInfo(construyendo && 'building');
}

const botones = new Map();
function pintarBarra() {
  const barra = $('barra');
  barra.replaceChildren();
  botones.clear();
  nivel.build.forEach((kind, i) => {
    const spec = B.BUILDINGS[kind];
    const b = document.createElement('button');
    const tecla = Object.keys(B.HOTKEYS).find((k) => B.HOTKEYS[k] === kind);
    b.innerHTML = `<span class="num k">${tecla}</span>
      <svg viewBox="0 0 64 64" width="32" height="32" color="${ACENTO[kind] ?? '#5AB8D9'}"><use href="${SPRITE[kind]({ level: 1 })}"/></svg>
      <span class="n">${spec.label}</span><span class="num c">${spec.cost}</span>
      <span class="i">Info</span>`;
    b.onclick = () => { if (estado === 'jugando') tomar(construyendo === kind ? null : kind); };
    pestanaInfo(b, kind);
    barra.appendChild(b);
    botones.set(kind, b);
  });
}

function tomar(kind) {
  construyendo = kind;
  // build(): hideInfo() y luego mcUI.gotoAndStop("building"); place() vuelve a
  // "space" salvo con MAYÚS (frame_2/DoAction.as:1660,1742,1753-1760)
  mostrarInfo(kind && 'building');
  seleccion = null;
  for (const [k, b] of botones) b.setAttribute('aria-pressed', String(k === kind));
  $('gFantasma').replaceChildren();
  actualizarCursor();
  pintarSeleccion();
}

// --- entrada ----------------------------------------------------------------
world.addEventListener('mousemove', (ev) => { raton = aPantalla(ev); actualizarCursor(); });

// Arrastrar con cualquier botón mueve el mundo. Un clic que recorre más de
// 4 px es arrastre, y el `click` que llega tras soltar no coloca ni selecciona.
let arrastre = null;
world.addEventListener('mousedown', (ev) => {
  if (!nivel.canScroll) return;
  arrastre = { x: ev.clientX, y: ev.clientY, movido: false };
});
addEventListener('mousemove', (ev) => {
  if (!arrastre || !ev.buttons) return;
  const dx = ev.clientX - arrastre.x, dy = ev.clientY - arrastre.y;
  if (!arrastre.movido && Math.hypot(dx, dy) < 4) return;
  arrastre.movido = true;
  meta.x -= dx / cam.zoom; meta.y -= dy / cam.zoom;
  arrastre.x = ev.clientX; arrastre.y = ev.clientY;
});
world.addEventListener('contextmenu', (ev) => ev.preventDefault());

world.addEventListener('click', (ev) => {
  const fueArrastre = arrastre?.movido;
  arrastre = null;
  if (fueArrastre || estado !== 'jugando') return;
  const p = aPantalla(ev);
  if (construyendo) {
    const gx = Math.round(p.x / B.PLACEMENT_GRID) * B.PLACEMENT_GRID;
    const gy = Math.round(p.y / B.PLACEMENT_GRID) * B.PLACEMENT_GRID;
    const razon = {};
    const prueba = new Node(construyendo, gx, gy);
    if (net.linksFor(prueba, razon) === null) {
      avisar(MOTIVO[razon.why] ?? 'posición no válida');
      return;
    }
    if (net.minerals < B.BUILDINGS[construyendo].cost) { avisar('No te llegan los minerales.'); return; }
    net.place(construyendo, gx, gy);
    sfx('bPlace');                      // frame_2/DoAction.as:1750
    if (!encadenar) tomar(null);
    return;
  }
  const mejor = bajoElCursor(p);
  // clic al vacío sin herramienta: el fallo más fácil de cometer y el único
  // que antes no decía nada
  if (!mejor) avisar('Elige antes qué construir: teclas 1-4 o la barra de abajo.', 'nota');
  seleccion = mejor;
  pintarSeleccion();
});

addEventListener('keydown', (ev) => {
  if (estado !== 'jugando') return;
  if (ev.key === 'Shift') encadenar = true;
  const k = ev.key.toLowerCase();
  if (B.HOTKEYS[k] && nivel.build.includes(B.HOTKEYS[k])) { tomar(B.HOTKEYS[k]); return; }
  if (ev.key === 'Escape') { tomar(null); seleccion = null; pintarSeleccion(); return; }
  if (ev.key === 'Enter' && GUION[idNivel]?.[etapa]?.boton) { avanzar(); return; }
  if ((k === 'u' || ev.key === ' ') && seleccion) { ev.preventDefault(); mejorar(); return; }
  if (k === 'r' && seleccion) { vender(); return; }
  if (k === 'p' && seleccion) { convertir(1); return; }   // DefineSprite_1084/frame_1/DoAction.as:182
  if (k === 't' && seleccion) { convertir(2); return; }   // :178
  if (!nivel.canScroll) return;
  const paso = 200 / meta.zoom;
  if (k === 'w' || ev.key === 'ArrowUp') meta.y -= paso;
  if (k === 's' || ev.key === 'ArrowDown') meta.y += paso;
  if (k === 'a' || ev.key === 'ArrowLeft') meta.x -= paso * 1.5;
  if (k === 'd' || ev.key === 'ArrowRight') meta.x += paso * 1.5;
  if (k === 'q') meta.zoom = Math.max(0.2, meta.zoom - 0.15);
  if (k === 'e') meta.zoom = Math.min(2.4, meta.zoom + 0.15);
});
addEventListener('keyup', (ev) => { if (ev.key === 'Shift') encadenar = false; });

// La rueda acerca hacia el cursor: el punto del mundo bajo el ratón no se mueve.
world.addEventListener('wheel', (ev) => {
  if (!nivel.canZoom) return;
  ev.preventDefault();
  const antes = aPantalla(ev, meta);
  meta.zoom = Math.min(2.4, Math.max(0.2, meta.zoom * (ev.deltaY < 0 ? 1.12 : 0.89)));
  const despues = aPantalla(ev, meta);
  meta.x += antes.x - despues.x; meta.y += antes.y - despues.y;
}, { passive: false });

$('rMineros').onclick = () => { net.minersOn = !net.minersOn; };

function mejorar() {
  if (!seleccion?.canUpgrade) return;
  if (!seleccion.upgrade(net)) avisar('No te llegan los minerales para la mejora.');
  else avisar(`${seleccion.spec.label} a nivel ${seleccion.level}`, 'exito');
  pintarSeleccion();
}
function vender() {
  if (!seleccion || seleccion.kind === 'planet') return;
  avisar(`Vendido por <span class="n">+${net.sell(seleccion)}</span> minerales`, 'exito');
  sfx('bSell');                         // frame_2/DoAction.as:1860
  seleccion = null;
  pintarSeleccion();
}
$('sMejorar').onclick = mejorar;
$('sVender').onclick = vender;

// --- dibujo -----------------------------------------------------------------
function pintarMundo() {
  // cables
  const cables = [];
  const vistos = new Set();
  for (const n of net.nodes) {
    for (const nb of n.links) {
      const key = n.id < nb.id ? `${n.id}-${nb.id}` : `${nb.id}-${n.id}`;
      if (vistos.has(key)) continue;
      vistos.add(key);
      const vivo = n.propagates || nb.propagates;
      // optCB sube el cable a colEnergy = 0x72abf8 (DefineSprite_862_options,
      // botón optCB); el color base es el de la paleta del port, no el 0x1d74ea
      cables.push(el('path', {
        d: `M${n.x} ${n.y} L${nb.x} ${nb.y}`, stroke: opciones.optCB ? '#72abf8' : '#5AB8D9',
        'stroke-width': 1.6 / cam.zoom, opacity: vivo ? 0.5 : 0.22, fill: 'none',
      }));
    }
  }
  // líneas de energía (mcRelayLines, frame_2/DoAction.as:1318): 0x04D3FF de
  // grosor 2, cada punto tiembla random(4)-2 en cada fotograma. optEL las quita.
  if (!opciones.optEL) {
    const j = () => Math.floor(Math.random() * 4) - 2;
    for (const f of net.flows) {
      cables.push(el('path', {
        d: `M${f.x} ${f.y}` + f.pts.map(([x, y]) => ` L${x + j()} ${y + j()}`).join(''),
        stroke: '#04D3FF', 'stroke-width': 2, fill: 'none',
      }));
    }
  }
  $('gCables').replaceChildren(...cables);

  // rayos de minado
  $('gRayos').replaceChildren(...net.beams.map((b) => el('path', {
    d: `M${b.from.x} ${b.from.y} L${b.hx} ${b.hy}`, stroke: '#8ED07A',
    'stroke-width': 1.8 / cam.zoom, opacity: 0.72, 'stroke-linecap': 'round',
  })));

  // nodos
  const nodos = [];
  for (const n of net.nodes) {
    const w = TAM[n.kind];
    if (n.built) {
      nodos.push(el('use', { href: SPRITE[n.kind](n), x: n.x - w / 2, y: n.y - w / 2, width: w, height: w,
                             color: colorAcento(n) }));
      if (n.kind === 'store' && n.energy > 0) {
        // El arco del núcleo se completa con la energía guardada. El original lo
        // intentaba con mcEnergy1/mcEnergy2 (buildingStore.as:221-229), clips que
        // no existen en el sprite de v83; aquí se usa el arco que tenía el símbolo.
        const k = w / 64, r = (n.level > 1 ? 10.5 : 9.5) * k;   // viewBox 64 → TAM
        const frac = n.energy / n.maxEnergy;
        const arco = Math.min(0.9999, frac);                    // 1 exacto no dibuja arco
        const ang = -Math.PI / 2 + arco * Math.PI * 2;
        nodos.push(el('path', {
          d: `M${n.x} ${n.y - r} A${r} ${r} 0 ${arco > 0.5 ? 1 : 0} 1 ${n.x + Math.cos(ang) * r} ${n.y + Math.sin(ang) * r}`,
          fill: 'none', stroke: '#5AB8D9', 'stroke-width': (n.level > 1 ? 2.5 : 2.3) * k, 'stroke-linecap': 'round',
        }));
        // Las pilas del símbolo (4 en nivel 1, 6 en nivel 2) se llenan en orden
        // horario desde la de arriba, cada una con su 1/n, del núcleo hacia fuera.
        // Coordenadas del viewBox del símbolo: hueco interior de cada pila.
        const pilas = n.level > 1 ? 6 : 4, [y0, h] = n.level > 1 ? [7.5, 12] : [9.5, 11];
        const g = el('g', { transform: `translate(${n.x - w / 2} ${n.y - w / 2}) scale(${k})`, fill: '#5AB8D9' });
        for (let i = 0; i < pilas; i++) {
          const f = Math.min(1, frac * pilas - i);
          if (f <= 0) break;
          g.append(el('rect', { x: 29, y: y0 + h * (1 - f), width: 6, height: h * f, rx: 3,
                                transform: `rotate(${(360 / pilas) * i} 32 32)` }));
        }
        nodos.push(g);
      }
    } else {
      // "en obra": silueta a trazos + arco cian con la energía ya bombeada
      const r = w / 2;
      nodos.push(el('circle', {
        cx: n.x, cy: n.y, r, fill: 'none', stroke: '#2b3a4e',
        'stroke-width': 1.4 / cam.zoom, 'stroke-dasharray': `${3 / cam.zoom} ${2.6 / cam.zoom}`,
      }));
      const frac = n.construction / n.targetConstruction;
      const ang = -Math.PI / 2 + frac * Math.PI * 2;
      nodos.push(el('path', {
        d: `M${n.x} ${n.y - r} A${r} ${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${n.x + Math.cos(ang) * r} ${n.y + Math.sin(ang) * r}`,
        fill: 'none', stroke: '#5AB8D9', 'stroke-width': 2.4 / cam.zoom, 'stroke-linecap': 'round',
      }));
    }
    if (n.lowPower && n.built && !(n.kind in ACENTO)) {   // el resto ya lo dice el acento
      nodos.push(el('circle', { cx: n.x, cy: n.y + w / 2 + 6, r: 2.4 / cam.zoom, fill: '#E9C15A' }));
    }
    if (n.life < n.maxLife) {
      const bw = w * 0.8;
      nodos.push(el('rect', { x: n.x - bw / 2, y: n.y + w / 2 + 3, width: bw, height: 2.6 / cam.zoom,
                              rx: 1.3, fill: 'rgba(150,180,215,.18)' }));
      nodos.push(el('rect', { x: n.x - bw / 2, y: n.y + w / 2 + 3, width: Math.max(0, bw * n.life / n.maxLife),
                              height: 2.6 / cam.zoom, rx: 1.3, fill: '#E06A6A' }));
    }
    if (n === seleccion) {
      nodos.push(el('circle', { cx: n.x, cy: n.y, r: n.energyRange, fill: 'none', stroke: '#E9A25A',
                                'stroke-width': 1 / cam.zoom, 'stroke-dasharray': `${3 / cam.zoom} ${6 / cam.zoom}`,
                                opacity: 0.7 }));
      if (n.kind === 'miner') {
        nodos.push(el('circle', { cx: n.x, cy: n.y, r: n.spec.mineRange, fill: 'none', stroke: '#8ED07A',
                                  'stroke-width': 1 / cam.zoom, 'stroke-dasharray': `${3 / cam.zoom} ${5 / cam.zoom}`,
                                  opacity: 0.5 }));
      }
    }
  }
  if (seleccion?.kind === 'planet') {
    nodos.push(el('circle', { cx: seleccion.x, cy: seleccion.y, r: seleccion.size + 5,
                              fill: 'none', stroke: '#E9A25A', 'stroke-width': 1 / cam.zoom,
                              'stroke-dasharray': `${3 / cam.zoom} ${6 / cam.zoom}`, opacity: 0.75 }));
  }
  $('gNodos').replaceChildren(...nodos);

  // design/Efectos.dc.html: destrucción en cuatro ticks, el hueco de trazos
  // mientras no se construya encima, y la estela del misil, cuyos puntos se
  // separan solos porque el misil acelera.
  const efectos = [];
  const FASE = ['#fx-destello', '#fx-anillo', '#fx-escombros', '#fx-dispersos'];
  for (const w of net.wrecks) {
    const edad = net.ticks - w.tick;
    const ancho = (w.kind === 'ship' ? TAM_NAVE[w.sub] : TAM[w.kind]) * 2;   // el canvas dibuja un edificio de ~50 en 100
    const href = edad < 4 ? FASE[edad] : '#fx-hueco';
    efectos.push(el('use', { href, x: w.x - ancho / 2, y: w.y - ancho / 2, width: ancho, height: ancho }));
  }
  for (const r of net.rockets) {
    const t = r.trail, n = t.length / 2;
    for (let i = 0; i < n; i++) {
      efectos.push(el('circle', { cx: t[2 * i], cy: t[2 * i + 1], r: 1.6 + i * 0.1, fill: '#EE8F6E', opacity: 0.25 + (i / 11) * 0.63 }));
    }
  }
  $('gEfectos').replaceChildren(...efectos);

  // naves: el símbolo del canvas apunta arriba y _rotation 0 apunta a +x
  const naves = [];
  for (const s of net.ships) {
    // optCB: _xscale 120 salvo la nodriza (frame_2/DoAction.as:1103-1109); solo
    // el dibujo, _size no cambia. mcCB no tiene sprite en el canvas: la sección
    // «Sin color» de design/Enemigos.dc.html apuesta por que la forma baste.
    const w = TAM_NAVE[s.sub] * (opciones.optCB && s.sub !== 6 ? 1.2 : 1);
    naves.push(el('use', { href: `#e${s.sub}`, x: s.x - w / 2, y: s.y - w / 2, width: w, height: w,
                           transform: `rotate(${s.rotation + 90} ${s.x} ${s.y})` }));
    // mcShield: el anillo rojo del canvas de Efectos, que se apaga 10 por tick
    if (s.shield > 0) {
      naves.push(el('circle', { cx: s.x, cy: s.y, r: w / 2 + 1, fill: '#E06A6A', opacity: 0.16 * s.shield / 100 }));
      naves.push(el('circle', { cx: s.x, cy: s.y, r: w / 2, fill: 'none', stroke: '#E06A6A',
                                'stroke-width': 2 / cam.zoom, opacity: 0.9 * s.shield / 100 }));
    }
    // ship3.as:180: mcShip.gotoAndStop(2) mientras cuenta la mecha — aquí un halo que crece
    if (s.fuse > 0) {
      naves.push(el('circle', { cx: s.x, cy: s.y, r: 6 + s.fuse / 4, fill: 'none', stroke: '#ff6600',
                                'stroke-width': 1.2 / cam.zoom, opacity: 0.35 + s.fuse / 120 }));
    }
    if (s.life < s.maxLife) {
      const bw = w * 0.8;
      naves.push(el('rect', { x: s.x - bw / 2, y: s.y + w / 2 + 3, width: bw, height: 2.6 / cam.zoom,
                              rx: 1.3, fill: 'rgba(224,106,106,.2)' }));
      naves.push(el('rect', { x: s.x - bw / 2, y: s.y + w / 2 + 3, width: Math.max(0, bw * s.life / s.maxLife),
                              height: 2.6 / cam.zoom, rx: 1.3, fill: '#E06A6A' }));
    }
  }
  // bots de reparación (design/Edificios.dc.html): el símbolo apunta arriba y
  // mcShip._rotation 0 apunta a +x, como las naves
  for (const d of net.drones) {
    naves.push(el('use', { href: '#bot', x: d.x - TAM_BOT / 2, y: d.y - TAM_BOT / 2, width: TAM_BOT, height: TAM_BOT,
                           transform: `rotate(${d.rotation + 90} ${d.x} ${d.y})` }));
    if (d.life < d.maxLife) {
      naves.push(el('rect', { x: d.x - 5, y: d.y + 5, width: Math.max(0, 10 * d.life / d.maxLife), height: 1.6 / cam.zoom, fill: '#8ED07A' }));
    }
  }
  // misiles e impactos (design/Efectos.dc.html)
  for (const r of net.rockets) {
    naves.push(el('use', { href: '#sp-misil', x: r.x - 7, y: r.y - 7, width: 14, height: 21,
                           transform: `rotate(${r.rotation + 90} ${r.x} ${r.y})` }));
  }
  for (const b of net.blasts) {
    const f = (b.until - net.ticks) / 8;
    naves.push(el('circle', { cx: b.x, cy: b.y, r: b.r * (1.2 - f * 0.6), fill: '#EE8F6E', opacity: 0.16 * f }));
    naves.push(el('circle', { cx: b.x, cy: b.y, r: 13 * f, fill: '#EE8F6E', opacity: 0.9 * f }));
  }
  $('gNaves').replaceChildren(...naves);

  // fire('laser'): rojo enemigo, verde propio, alfa 80 + random(20)
  $('gLaseres').replaceChildren(...net.lasers.map((l) => el('path', {
    d: `M${l.x1} ${l.y1} L${l.x2} ${l.y2}`, stroke: l.colour ?? (l.enemy ? '#ff3b3b' : '#8ED07A'),
    'stroke-width': (l.thickness ?? 1) / cam.zoom, opacity: 0.8 + Math.random() * 0.2,
  })));

  // capa seca de cada asteroide, en los saltos de 10 % del original
  for (const [a, capa] of capasSecas) capa.setAttribute('opacity', a.depleted / 100);
}

function pintarFantasma() {
  const g = $('gFantasma');
  if (!construyendo) { g.replaceChildren(); return; }
  const gx = Math.round(raton.x / B.PLACEMENT_GRID) * B.PLACEMENT_GRID;
  const gy = Math.round(raton.y / B.PLACEMENT_GRID) * B.PLACEMENT_GRID;
  const razon = {};
  const prueba = new Node(construyendo, gx, gy);
  const lineas = net.linksFor(prueba, razon);
  const vale = lineas !== null && net.minerals >= B.BUILDINGS[construyendo].cost;
  const col = vale ? '#5AB8D9' : '#E06A6A';
  const w = TAM[construyendo];
  const hijos = [
    el('circle', { cx: gx, cy: gy, r: prueba.energyRange, fill: col, opacity: 0.05 }),
    el('circle', { cx: gx, cy: gy, r: prueba.energyRange, fill: 'none', stroke: col,
                   'stroke-width': 1 / cam.zoom, 'stroke-dasharray': `${3 / cam.zoom} ${5 / cam.zoom}`,
                   opacity: 0.55 }),
    // la huella real: `_size` de diámetro. Dos huellas iguales pueden tocarse
    // (dist ≥ max(_size)); el sprite, más ancho, se solapará y es correcto
    el('circle', { cx: gx, cy: gy, r: prueba.size / 2, fill: col, opacity: 0.18 }),
    el('circle', { cx: gx, cy: gy, r: w / 2, fill: 'none', stroke: col,
                   'stroke-width': 1.6 / cam.zoom, 'stroke-dasharray': `${3 / cam.zoom} ${2.6 / cam.zoom}` }),
  ];
  // tempLink (frame_2/DoAction.as:1415-1425): del minero sale un rayo verde a
  // cada asteroide con minerales al alcance. El círculo es mcMineRange, visible
  // solo en el fotograma template (buildingMiner.as:177); su radio lo fija el
  // sprite y no está verificado: se dibuja el mineRange, que se mide desde el
  // borde del asteroide, así que la línea manda y el círculo orienta.
  // añadido del port: el alcance de tiro o de reparación en la plantilla, como el de minado
  if (prueba.fireRange || prueba.repairRange) {
    hijos.push(el('circle', { cx: gx, cy: gy, r: prueba.fireRange || prueba.repairRange, fill: 'none',
                              stroke: prueba.repairRange ? '#8ED07A' : '#02f6ff', 'stroke-width': 1 / cam.zoom, opacity: 0.35 }));
  }
  if (construyendo === 'miner') {
    hijos.push(el('circle', { cx: gx, cy: gy, r: prueba.spec.mineRange, fill: 'none', stroke: '#8ED07A',
                              'stroke-width': 1 / cam.zoom, opacity: 0.35 }));
    for (const a of prueba.asteroids ?? []) {
      hijos.push(el('path', { d: `M${gx} ${gy} L${a.x} ${a.y}`, stroke: '#8ED07A',
                              'stroke-width': 2 / cam.zoom, opacity: 0.85, fill: 'none' }));
    }
  }
  // los cables que nacerían, ya dibujados; los bloqueados por un asteroide o
  // un edificio, en colBlocked como el original (frame_2/DoAction.as:1465-1470,
  // 0xea1d4e; 0xff5f85 con optCB): avisan, pero no impiden colocar
  const cables = [...(lineas ?? []).map((o) => [o, col]),
                  ...(razon.bloqueados ?? []).map((o) => [o, opciones.optCB ? '#ff5f85' : '#ea1d4e'])];
  for (const [other, c] of cables) {
    hijos.push(el('path', { d: `M${gx} ${gy} L${other.x} ${other.y}`, stroke: c,
                            'stroke-width': 1.6 / cam.zoom, 'stroke-dasharray': `${4 / cam.zoom} ${4 / cam.zoom}`,
                            opacity: 0.8, fill: 'none' }));
  }
  // el motivo, pegado al cursor: el aviso de arriba está demasiado lejos de
  // donde mira el jugador para enterarse de por qué le rechazan el clic
  const motivo = lineas === null
    ? MOTIVO[razon.why] ?? 'posición no válida'
    : net.minerals < B.BUILDINGS[construyendo].cost ? 'no te llegan los minerales'
    : lineas.length === 0 ? 'fuera de la red: se construiría, pero sin energía'
    : null;
  if (motivo) {
    const t = el('text', {
      x: gx, y: gy + w / 2 + 14 / cam.zoom, 'text-anchor': 'middle',
      'font-size': 11 / cam.zoom, fill: lineas === null ? '#E06A6A' : '#E9C15A',
    });
    t.textContent = motivo;
    hijos.push(t);
  }
  // se señala la CAUSA, no el síntoma: se ilumina el obstáculo
  if (razon.what) {
    const o = razon.what;
    hijos.push(el('circle', { cx: o.x, cy: o.y, r: o.size / 2 + (o.kind === 'planet' ? 8 : 0),
                              fill: 'none', stroke: '#E06A6A', 'stroke-width': 1.4 / cam.zoom,
                              'stroke-dasharray': `${3 / cam.zoom} ${4 / cam.zoom}`, opacity: 0.8 }));
  }
  g.replaceChildren(...hijos);
}

// --- minimapa ---------------------------------------------------------------
// minimapAdd (frame_2/DoAction.as:1902-1940): escala 1/24, cuadrado de
// _size/24×2 con mínimo 2 px, color del edificio o rojo. El original mantiene
// un clip por entidad y mueve las naves cada 20 ticks; aquí es un canvas que
// se repinta entero cada fotograma, como el resto del render: cientos de
// puntos de 2 px sin detalle es lo que canvas hace mejor que el DOM. Los
// asteroides no se mueven: van en un canvas de fondo pintado una vez.
const MINI = { k: 24, w: 184, h: 132 };
const mini = $('mini');
const dpr = devicePixelRatio || 1;
mini.width = MINI.w * dpr; mini.height = MINI.h * dpr;
const ctxMini = mini.getContext('2d');
ctxMini.scale(dpr, dpr);
const fondoMini = document.createElement('canvas');
fondoMini.width = mini.width; fondoMini.height = mini.height;
function pintarFondoMini() {
  const c = fondoMini.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, MINI.w, MINI.h);
  c.fillStyle = '#575238';
  for (const a of net.asteroids) {
    c.beginPath();
    c.arc(MINI.w / 2 + a.x / MINI.k, MINI.h / 2 + a.y / MINI.k, Math.max(1, a.size / MINI.k), 0, Math.PI * 2);
    c.fill();
  }
}

function pintarMinimapa() {
  const c = ctxMini, k = MINI.k, ox = MINI.w / 2, oy = MINI.h / 2;
  c.clearRect(0, 0, MINI.w, MINI.h);
  c.drawImage(fondoMini, 0, 0, MINI.w, MINI.h);
  c.fillStyle = '#5AB8D9';
  for (const n of net.nodes) {
    const s = Math.max(2, n.size / k * 2);
    c.fillRect(ox + n.x / k - s / 2, oy + n.y / k - s / 2, s, s);
  }
  c.fillStyle = '#E06A6A';
  for (const n of net.ships) {
    const s = Math.max(2, n.size / k * 2);
    c.fillRect(ox + n.x / k - s / 2, oy + n.y / k - s / 2, s, s);
  }
  // el marco es el viewport real; el original lo aproxima con (110 - zoom) / 6
  const vw = innerWidth / cam.zoom / k, vh = innerHeight / cam.zoom / k;
  c.strokeStyle = 'rgba(230,236,245,.34)';
  c.lineWidth = 1;
  c.strokeRect(Math.round(ox + cam.x / k - vw / 2) + 0.5, Math.round(oy + cam.y / k - vh / 2) + 0.5,
               Math.round(vw), Math.round(vh));
}

// Añadido del port: el minimapa original no acepta clics.
mini.onclick = (ev) => {
  if (estado !== 'jugando' || !nivel.canScroll) return;
  const r = mini.getBoundingClientRect();
  meta.x = (ev.clientX - r.left - MINI.w / 2) * MINI.k;
  meta.y = (ev.clientY - r.top - MINI.h / 2) * MINI.k;
};

// --- HUD --------------------------------------------------------------------
const nf = new Intl.NumberFormat('es-ES');
const reloj = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function pintarHUD() {
  $('oTitulo').textContent = nivel.title;
  $('oReloj').textContent = reloj(net.playTime);
  if (nivel.goal) {
    $('oMinados').textContent = nf.format(net.totalMined);
    $('oObjetivo').textContent = `/ ${nf.format(nivel.goal)} minados`;
    $('oBarra').style.width = `${Math.min(100, (net.totalMined / nivel.goal) * 100)}%`;
  }
  $('oMeta').classList.toggle('oculto', !nivel.goal);
  // mcCounterTxt, frame_2/DoAction.as:306-350: "Survive for", "Mother ships
  // detected" / "Defend!"; en las misiones por porcentaje, el % que la dispara
  const prox = net.nextWaveIn, w = net.waves[net.waveNumber];
  $('oOleada').textContent = nivel.sobrevivir ? `sobrevive ${reloj(nivel.sobrevivir - net.playTime)}`
    : nivel.nodrizas ? (net.playTime < 180 ? `nodrizas detectadas en ${reloj(180 - net.playTime)}` : '¡defiende!')
    : nivel.modo === 'oleadas' ? `${net.wavesSent}/6 oleadas`
    : nivel.modo === 'arena' ? `${net.wavesSent} oleadas enviadas`
    : net.wavesByPercent && w ? `próxima oleada al ${w[0]} % minado`
    : prox === null ? '' : `próxima oleada en ${reloj(prox)}`;

  $('rMinerales').textContent = nf.format(Math.floor(net.minerals));
  const mineros = net.nodes.filter((n) => n.kind === 'miner' && n.built);
  // ingreso real medido, no la estimación optimista del HUD original
  const porMin = mineros.reduce((s, m) => s + m.mineQuantity, 0) * (B.TICK_RATE * 60) / 144;
  $('rRitmo').textContent = `+${Math.round(porMin)}/min`;

  const fuentes = net.sources.filter((n) => n.built);
  const e = fuentes.reduce((s, n) => s + n.energy, 0);
  const emax = fuentes.reduce((s, n) => s + n.maxEnergy, 0);
  $('rEnergia').textContent = `${e.toFixed(1)} / ${emax}`;
  const pct = emax ? (e / emax) * 100 : 0;
  $('rEnergiaLlena').style.flexGrow = pct;
  $('rEnergiaResto').style.flexGrow = 100 - pct;

  const plantas = net.nodes.filter((n) => n.kind === 'energy' && n.built).length;
  $('rConteo').textContent = `${mineros.length} mineros · ${plantas} plantas`;
  const t = $('rMineros');
  t.textContent = net.minersOn ? 'Minado ON' : 'Minado OFF';
  t.style.color = net.minersOn ? 'var(--repara)' : 'var(--dim)';
  t.style.background = net.minersOn ? 'rgba(142,208,122,.12)' : 'rgba(150,180,215,.08)';

  // aria-disabled y no disabled: dentro de un botón disabled la pestaña Info no
  // recibe el ratón. Todos los clics ya comprueban los minerales por su cuenta.
  for (const [kind, b] of botones) b.ariaDisabled = net.minerals < B.BUILDINGS[kind].cost;
}

/** El mismo panel, con el asteroide como sujeto: cuánto mineral le queda. */
function pintarAsteroide(a) {
  const s = $('sSprite');
  s.setAttribute('href', FORMAS[net.asteroids.indexOf(a) % 3]);
  s.setAttribute('fill', 'url(#roca)');
  s.setAttribute('stroke', '#453d2c');
  s.setAttribute('stroke-width', '1.2');

  $('sNombre').textContent = 'Asteroide';
  $('sNivel').textContent = `radio ${a.size} · ${a.depleted}% agotado`;

  const pct = (a.minerals / a.maxMinerals) * 100;
  $('sVida').style.flexGrow = pct;
  $('sVidaResto').style.flexGrow = 100 - pct;
  $('sVida').style.background = 'var(--mineral)';
  $('sVidaTxt').textContent =
    `${nf.format(Math.ceil(a.minerals))} / ${nf.format(a.maxMinerals)} minerales`;
  $('sEnergia').textContent = '';

  const mineros = net.nodes.filter((n) => n.kind === 'miner' && n.built && n.asteroids.includes(a));
  const fichas = [['Minado por', `${mineros.length} minero${mineros.length === 1 ? '' : 's'}`]];
  if (mineros.length && a.minerals > 0) {
    // cada minero extrae mineQuantity por ciclo de 144 ticks, repartido entre
    // los asteroides que tenga enganchados
    const porSeg = mineros.reduce((t, m) => t + m.mineQuantity / m.asteroids.length, 0)
                   * B.TICK_RATE / 144;
    fichas.push(['Se agota en', reloj(a.minerals / porSeg)]);
  }
  $('sFichas').innerHTML = fichas
    .map(([x, y]) => `<div class="fila"><span>${x}</span><span>${y}</span></div>`).join('');

  $('sMejorar').classList.add('oculto');
  $('sVender').classList.add('oculto');
}

function pintarSeleccion() {
  const p = $('seleccion'), n = seleccion;
  if (!n) { p.classList.add('oculto'); return; }
  p.classList.remove('oculto');
  if (n.kind === 'planet') { pintarAsteroide(n); return; }

  const s = $('sSprite');
  s.setAttribute('href', SPRITE[n.kind](n));
  s.setAttribute('color', colorAcento(n));
  for (const at of ['fill', 'stroke', 'stroke-width']) s.removeAttribute(at);
  $('sVida').style.background = 'var(--repara)';
  $('sVender').classList.remove('oculto');
  $('sNombre').textContent = n.label;
  $('sNivel').textContent = n.built ? `nivel ${n.level}` : `en obra ${n.construction}/${n.targetConstruction}`;
  const vp = (n.life / n.maxLife) * 100;
  $('sVida').style.flexGrow = vp; $('sVidaResto').style.flexGrow = 100 - vp;
  $('sVidaTxt').textContent = `${Math.round(n.life)} / ${n.maxLife} PV`;
  $('sEnergia').textContent = n.maxEnergy ? `${n.energy.toFixed(1)} / ${n.maxEnergy} E` : '—';

  const fichas = [];
  if (n.kind === 'miner') {
    fichas.push(['Extrae', `${n.mineQuantity} por ciclo`], ['Ciclo', '3,6 s'],
                ['Asteroides', String(n.asteroids.length)]);
  } else if (n.kind === 'energy') {
    fichas.push(['Genera', `${(n.spec.genAmount * n.efficiency).toFixed(1)} por pulso`],
                ['Pulso', '0,55 s'], ['Eficiencia', String(n.efficiency)]);
  } else if (n.kind === 'store') {
    fichas.push(['Reserva', `${n.maxEnergy} E`], ['Rellena', 'cada 20 ticks']);
  } else if (n.kind === 'laser' && n.subType === 2) {
    fichas.push(['Daño', `${n.damage} + rampa`], ['Alcance', String(n.fireRange)], ['Haz', 'continuo, sin misiles']);
  } else if (n.kind === 'laser') {
    fichas.push(['Daño', `${n.damage} por tick`], ['Alcance', String(n.fireRange)],
                ['Ráfaga', `${n.fireStart} de ${n.fireCooldown} ticks`]);
  } else if (n.kind === 'repair') {
    const vivos = n.bots.filter((b) => b && !b.removed).length;
    fichas.push(['Alcance', String(n.repairRange)], ['Bots', `${vivos} / ${n.spec.maxBots}`],
                ['Fuera', String(n.bots.filter((b) => b && !b.removed && !b.returnToBase).length)]);
  } else if (n.kind === 'rocket') {
    fichas.push(['Daño', `${n.damage} · salpica ${Math.round(n.splash)}`], ['Alcance', String(Math.round(n.fireRange))],
                ['Salva', `${n.rockets} misil${n.rockets === 1 ? '' : 'es'} · 5 min cada uno`]);
  } else {
    fichas.push(['Cables', `${n.links.length} / 6`], ['Alcance', String(n.energyRange)]);
  }
  $('sFichas').innerHTML = fichas
    .map(([a, b]) => `<div class="fila"><span>${a}</span><span>${b}</span></div>`).join('');

  const up = n.nextUpgrade;
  const btn = $('sMejorar');
  if (up && n.canUpgrade) {
    btn.classList.remove('oculto');
    btn.ariaDisabled = net.minerals < up.cost;
    $('sMejorarTxt').textContent = `Mejorar a nivel ${n.level + 1}`;
    $('sCoste').textContent = up.cost;
    btn.dataset.info = n.kind === 'laser' ? ['', 'pulserUpgrade', 'plasmaUpgrade'][n.subType] : `${n.kind}Upgrade`;
  } else {
    btn.classList.add('oculto');
  }
  $('sReembolso').textContent = `+${Math.floor(n.value * n.life / n.maxLife)}`;
  // la torreta base no mejora: se bifurca (buildingLaser.as:106-108)
  const base = n.kind === 'laser' && n.subType === 0 && n.built;
  $('sPulse').classList.toggle('oculto', !base);
  $('sThel').classList.toggle('oculto', !base);
  $('sPulse').ariaDisabled = net.minerals < B.LASER_BRANCHES[1].cost;
  $('sThel').ariaDisabled = net.minerals < B.LASER_BRANCHES[2].cost;
  // toggleMissiles vive en el panel del lanzamisiles (DefineSprite_1199/frame_7)
  $('sMisiles').classList.toggle('oculto', n.kind !== 'rocket');
  $('sMisilesTxt').textContent = net.missilesOn ? 'Misiles ON' : 'Misiles OFF';
  $('sMisilesTxt').style.color = net.missilesOn ? 'var(--repara)' : 'var(--dim)';
}
$('sMisiles').onclick = () => { if (velocidad > 0) net.missilesOn = !net.missilesOn; pintarSeleccion(); };
pestanaInfo($('sMejorar'));
pestanaInfo($('sPulse'), 'laserPulser');
pestanaInfo($('sThel'), 'laserPlasma');
pestanaInfo($('sMisiles'), 'toggleMissiles');
pestanaInfo($('rMinado'), 'toggleMiners');
function convertir(n) {
  if (!seleccion?.convert) return;
  if (!seleccion.convert(net, n)) { if (seleccion.subType === 0) avisar('No te llegan los minerales.'); return; }
  avisar(`Torreta convertida en ${seleccion.label}`, 'exito');
  pintarSeleccion();
}
$('sPulse').onclick = () => convertir(1);
$('sThel').onclick = () => convertir(2);

// --- entrenamientos ---------------------------------------------------------
// Las etapas son los fotogramas de DefineSprite_1030_tutorial1 y
// DefineSprite_1000_tutorial2: cada una abre permisos o suelta naves (`al`),
// y pasa sola cuando se cumple `hasta` o con el botón (`boton`). Los textos
// son del port: en el original son texto estático del SWF, fuera del AS2.
const permitir = (...kinds) => { nivel.build = kinds; pintarBarra(); };
let aparecidas = false;
const idaYVuelta = () => { if (net.ships.length) aparecidas = true; return aparecidas && !net.ships.length; };
const GUION = {
  1: [
    { boton: true, texto: 'Esta es tu planta solar: genera la energía que mueve todo lo demás. Los edificios se conectan entre sí por cables de energía.' },
    { boton: true, texto: 'El asteroide de la izquierda tiene minerales. Los mineros los extraen, pero cada disparo del minero gasta energía de la red.' },
    { boton: true, texto: 'Para ganar minerales hay que minar, y para minar hay que llevar la energía hasta el asteroide.' },
    { texto: 'Elige el minero en la barra de abajo (tecla 2).', al: () => permitir('miner'), hasta: () => construyendo === 'miner' },   // fotograma 4
    { texto: 'Colócalo junto al asteroide, dentro de su alcance.', hasta: () => net.nodes.some((n) => n.kind === 'miner'), fin: () => permitir() },
    { boton: true, texto: 'Fíjate: el minero está fuera del alcance de la planta y no se construye. Hace falta un relay para llevarle la energía.' },
    { texto: 'Elige el relay (tecla 1).', al: () => permitir('relay'), hasta: () => construyendo === 'relay' },
    { texto: 'Ponlo entre la planta y el minero: cuando el cable llegue, el minero empezará a construirse.',
      hasta: () => net.nodes.some((n) => n.kind === 'miner' && n.construction > 0), fin: () => permitir() },
    { texto: 'Pincha en el asteroide para ver cuántos minerales le quedan.', hasta: () => seleccion?.kind === 'planet' },
    { boton: true, texto: 'Cada minero saca poco; varios a la vez, mucho. Y cada uno consume energía de la planta.' },
    // fotograma 11: el original también exige que no haya mineros con
    // _construction 0 y _age > 40, pero _age nunca sube (buildingMiner.as:87)
    { texto: 'Construye hasta tener tres mineros en obra o listos, todos conectados.', al: () => permitir('relay', 'miner'),
      hasta: () => net.nodes.filter((n) => n.kind === 'miner' && n.construction > 0).length >= 3 },
    { texto: 'Pincha en la planta solar.', hasta: () => seleccion?.kind === 'energy' },
    { texto: 'Mejórala (U o barra espaciadora): una planta de nivel 2 da más energía.', hasta: () => net.nodes.some((n) => n.kind === 'energy' && n.level === 2) },
    { boton: true, texto: 'Con más energía la red mina más rápido. Ya sabes lo esencial.' },
    { texto: 'Ahora arrastra el mapa para moverte (o WASD).', al: () => { nivel.canScroll = true; }, hasta: () => Math.abs(cam.x) > 250 || Math.abs(cam.y) > 100 },
    { texto: 'Y aléjate con la rueda (o Q).', al: () => { nivel.canZoom = true; }, hasta: () => cam.zoom < 0.7 },
    { boton: true, texto: 'Entrenamiento 1 completado.' },
  ],
  2: [
    { boton: true, texto: 'Los piratas vienen a por tu red. Esta vez tienes una planta de nivel 3, dos mineros y un relay.' },
    { texto: 'Elige la torreta láser (tecla 6).', al: () => { permitir('laser'); tomar(null); }, hasta: () => construyendo === 'laser' },
    { texto: 'Colócala al oeste, conectada a la red: dispara con la energía que le llega.', hasta: () => net.nodes.some((n) => n.kind === 'laser'), fin: () => permitir() },
    { boton: true, texto: 'Ahí vienen dos cazas por el oeste. Mira cómo la torreta los recibe.' },
    { texto: 'Aguanta hasta que caigan.', al: () => { for (let i = 0; i < 2; i++) net.spawn(1, 190, 10, 2, 1000, 100); }, hasta: idaYVuelta },   // fotograma 5
    { texto: 'Pincha en la torreta.', hasta: () => seleccion?.kind === 'laser' },
    { texto: 'Conviértela en Pulse (P): más alcance y cadencia. Cuesta 100.', al: () => { net.minerals = 100; },
      hasta: () => net.nodes.some((n) => n.kind === 'laser' && n.subType === 1) },
    { boton: true, texto: 'Las torretas gastan energía al disparar; sin planta suficiente se quedan mudas.' },
    { texto: 'Construye una reparadora (tecla 5): sus bots curan los edificios dañados.', al: () => { permitir('repair'); net.minerals = 300; tomar(null); },
      hasta: () => net.nodes.some((n) => n.kind === 'repair' && n.construction > 0), fin: () => permitir() },
    { boton: true, texto: 'Ahora ocho cazas más, débiles pero muchos. La reparadora se encargará de los daños.' },
    { texto: 'Defiende.', al: () => { for (let i = 0; i < 8; i++) net.spawn(1, 190, 10, 1, 1000, 2); }, hasta: idaYVuelta },   // fotograma 11
    { boton: true, texto: 'Entrenamiento 2 completado. Ya puedes jugar el resto de modos.' },
  ],
};
let etapa = -1;
function irEtapa(i) {
  etapa = i; aparecidas = false;
  const e = GUION[idNivel]?.[i];
  $('guion').classList.toggle('oculto', !e);
  if (!e) return;
  e.al?.();
  $('gPaso').textContent = `PASO ${i + 1} / ${GUION[idNivel].length}`;
  $('gTexto').textContent = e.texto;
  $('gSiguiente').classList.toggle('oculto', !e.boton);
  $('gSiguiente').firstElementChild.textContent = i === GUION[idNivel].length - 1 ? 'Terminar' : 'Siguiente';
}
function avanzar() {
  const g = GUION[idNivel];
  g[etapa].fin?.();
  if (etapa === g.length - 1) terminar(true); else irEtapa(etapa + 1);
}
function tickGuion() {
  const e = GUION[idNivel]?.[etapa];
  if (e && !e.boton && e.hasta()) avanzar();
}
$('gSiguiente').onclick = () => { if (estado === 'jugando') avanzar(); };

// --- panel de oleadas (Wave Mode y Sandbox) ---------------------------------
// mcWaves: seis botones de un solo uso más el séptimo "todo", con la cantidad
// que tocaría ahora (wave(), frame_2/DoAction.as:955-985).
const enviadas = new Set();
function pintarOleadas() {
  const panel = $('oleadas');
  panel.classList.toggle('oculto', !nivel.modo);
  if (!nivel.modo) return;
  $('olTitulo').textContent = nivel.modo === 'oleadas' ? 'Lanza las oleadas' : 'Manda naves';
  $('olBotones').classList.toggle('oculto', nivel.modo !== 'oleadas');
  $('olArena').classList.toggle('oculto', nivel.modo !== 'arena');
  if (nivel.modo === 'arena') $('olAngulo').oninput();
  if (nivel.modo === 'oleadas') {
    const g = $('olBotones');
    g.replaceChildren();
    const cant = 40 + net.wavesSent * 10;
    for (let n = 1; n <= 7; n++) {
      const b = document.createElement('button');
      b.className = n === 7 ? 'todo' : '';
      b.disabled = enviadas.has(n) || estado !== 'jugando';
      b.innerHTML = n === 7 ? '<span>Todo: 25 × cuatro tipos</span>'
        : `<svg viewBox="0 0 64 64" width="22" height="22"><use href="#e${n}"/></svg><span class="num">${n === 6 ? cant / 10 : cant}</span><span>${B.SHIPS[n].label}</span>`;
      b.onclick = () => { if (estado === 'jugando' && !enviadas.has(n)) { enviadas.add(n); net.sendWave(n); pintarOleadas(); } };
      g.appendChild(b);
    }
  }
}
// DefineSprite_1244: nave 1-6, cantidad 25/50/100, dispersión 10-360, rumbo en
// pasos de 5° y 160 ticks de espera entre envíos (DefineSprite_1243). El dial
// del original es un arrastre; aquí un deslizador con los mismos pasos.
const arena = { sub: 1, cantidad: 50, dispersion: 45, angulo: 0, hasta: 0 };
function filaArena(id, valores, clave, texto = (v) => v) {
  const f = $(id);
  f.replaceChildren();
  for (const v of valores) {
    const b = document.createElement('button');
    b.className = 'num';
    b.innerHTML = texto(v);
    b.setAttribute('aria-pressed', String(arena[clave] === v));
    b.onclick = () => { arena[clave] = v; filaArena(id, valores, clave, texto); };
    f.appendChild(b);
  }
}
filaArena('olNave', [1, 2, 3, 4, 5, 6], 'sub', (v) => `<svg viewBox="0 0 64 64" width="20" height="20"><use href="#e${v}"/></svg>`);
filaArena('olTamano', [25, 50, 100], 'cantidad');
filaArena('olDispersion', [10, 45, 90, 180, 360], 'dispersion', (v) => `${v}°`);
$('olAngulo').oninput = () => { arena.angulo = Number($('olAngulo').value); $('olRumboTxt').textContent = `${arena.angulo}° · ${rumbo(arena.angulo)}`; };
$('olEnviar').onclick = () => {
  if (estado !== 'jugando' || net.ticks < arena.hasta) return;
  net.sandbox(arena.sub, arena.cantidad, arena.angulo, arena.dispersion);
  arena.hasta = net.ticks + 160;
};
function pintarEnfriamiento() {
  if (nivel.modo !== 'arena') return;
  const resto = Math.max(0, arena.hasta - net.ticks);
  $('olEnviar').disabled = resto > 0 || estado !== 'jugando';
  $('olEnfria').textContent = resto ? `${(resto / B.TICK_RATE).toFixed(1)} s` : '';
}

// --- menú y fin de partida --------------------------------------------------
// Cada partida es un Network nuevo; la vista olvida la anterior en
// nuevaPartida(). `?nivel=N&jugar` salta el menú.
const miles = (n) => String(n).replace(/\B(?=(\d{3})+$)/g, ' ');
// Mejor marca por nivel: el original manda 100000 - _playTime al CCAPI
// (frame_2/DoAction.as:874), o sea, menos tiempo es mejor. Aquí se guarda
// el tiempo en localStorage.
const marcas = {};
try { Object.assign(marcas, JSON.parse(localStorage.marcas ?? '{}')); } catch { /* sin almacén */ }
// Las misiones se desbloquean en orden (DefineSprite_718: `o.data.mC`)
let misionesHechas = Number(localStorage.misiones) || 0;
const navs = [...document.querySelectorAll('#menu .nav[data-nivel]')];
const grupoDe = (n) => (n.dataset.grupo ?? n.dataset.nivel).split(' ');
for (const n of navs) {
  n.onclick = () => { if (!grupoDe(n).includes(idNivel)) nuevaPartida(n.dataset.nivel); };
}
function pintarMenu() {
  const nav = navs.find((n) => grupoDe(n).includes(idNivel));
  for (const n of navs) n.classList.toggle('on', n === nav);
  $('mTitulo').textContent = nav ? nav.firstElementChild.textContent : nivel.title;
  $('mDesc').textContent = nivel.desc ?? '';
  $('mMarca').textContent = marcas[idNivel] === undefined ? '—' : reloj(marcas[idNivel]);
  $('mSemilla').textContent = ultimaSemilla ?? '—';
  $('mOtraSemilla').classList.toggle('oculto', [].concat(nivel.field).some((f) => f.seed != null || !f.quantity));
  const tarjetas = $('mTarjetas');
  tarjetas.replaceChildren();
  const grupo = nav ? grupoDe(nav) : [idNivel];
  tarjetas.classList.toggle('compacto', grupo.length > 4);
  for (const id of grupo) {
    const lv = B.LEVELS[id], t = document.createElement('div');
    const bloqueada = Number(id) > 100 && Number(id) - 100 > misionesHechas + 1;
    t.className = `diff${id === idNivel ? ' on' : ''}${id === '6' ? ' locura' : ''}${bloqueada ? ' bloqueada' : ''}`;
    t.innerHTML = `<div style="display:flex;align-items:baseline;justify-content:space-between">
        <div style="font-size:16px;font-weight:600">${lv.tag ?? lv.title}</div>
        ${id === idNivel ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--energia)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12.5 9.5 17.5 19.5 6.5"/></svg>' : ''}
      </div>
      <div class="num" style="margin-top:10px;font-size:21px;font-weight:600;letter-spacing:-.02em;color:var(--mineral)">${lv.tarjeta?.[0] ?? (lv.goal === 'campo' ? 'el campo' : lv.goal === 'mitad' ? 'medio campo' : lv.goal ? miles(lv.goal) : lv.nodrizas ? 'nodrizas' : 'aguanta')}</div>
      <div style="margin-top:2px;font-size:11.5px;color:#7f8fa8">${lv.tarjeta?.[1] ?? (lv.sobrevivir ? `aguanta ${lv.sobrevivir / 60} min` : lv.goal ? 'minerales para ganar' : lv.nodrizas ? 'derríbalas todas' : 'todo lo que puedas')}</div>
      <div class="sep">
        <div class="row"><span>Empiezas con</span><span class="num">${miles(lv.minerals)}</span></div>
        <div class="row"><span>Asteroides</span><span class="num">${lv.field.quantity}</span></div>
        <div class="row"><span>Oleadas</span><span class="num">${lv.oleadas ?? 'ninguna'}</span></div>
      </div>`;
    t.onclick = () => { if (id !== idNivel && !bloqueada) nuevaPartida(id); };
    tarjetas.appendChild(t);
  }
  pintarLinea();
}
// Las seis primeras oleadas de la tabla, con el sprite de cada nave. El giro
// aleatorio solo cambia el ángulo, que aquí no se enseña.
function pintarLinea() {
  const oleadas = nivel.waves ? B.generarOleadas(nivel.waves, () => 0).slice(0, 6) : [];
  $('mLinea').classList.toggle('oculto', !oleadas.length);
  if (!oleadas.length) return;
  $('mLineaTitulo').textContent = `Primeras oleadas · ${nivel.tag ?? nivel.title}`;
  $('mLineaNota').textContent = nivel.oleadas + (Number(idNivel) < 100 ? ' · los seis tipos en orden' : '');
  const svg = $('mLineaSvg');
  svg.replaceChildren(el('path', { d: 'M8 62 H880', stroke: 'rgba(150,180,215,.14)', 'stroke-width': 1 }));
  oleadas.forEach(([seg, sub, cant], i) => {
    const x = i < 5 ? 66 + i * 134 : 782, nodriza = sub === 6, tam = nodriza ? 40 : sub === 5 ? 20 : 24;
    const color = nodriza ? '#E06A6A' : '#8b9bb4';
    const g = el('g');
    if (nodriza) g.appendChild(el('circle', { cx: x, cy: 34, r: 30, fill: '#E06A6A', opacity: .07 }));
    g.appendChild(el('use', { href: `#e${sub}`, x: x - tam / 2, y: 34 - tam / 2, width: tam, height: tam }));
    g.appendChild(el('path', { d: `M${x} ${34 + tam / 2} V62`, stroke: nodriza ? 'rgba(224,106,106,.5)' : 'rgba(150,180,215,.2)', 'stroke-width': 1 }));
    g.appendChild(el('circle', { cx: x, cy: 62, r: nodriza ? 3.2 : 2.4, fill: nodriza ? '#E06A6A' : '#7f8fa8' }));
    const t1 = el('text', { x, y: 80, fill: color, 'font-size': 10.5, 'text-anchor': 'middle', 'font-family': 'IBM Plex Mono, monospace' });
    t1.textContent = nivel.porPorcentaje ? `${seg} %` : reloj(seg);
    const t2 = el('text', { x, y: 93, fill: nodriza ? color : '#5f6d82', 'font-size': 9.5, 'text-anchor': 'middle', 'font-family': 'IBM Plex Mono, monospace' });
    t2.textContent = `${cant} ${B.SHIPS[sub].label.toLowerCase()}`;
    g.append(t1, t2);
    svg.appendChild(g);
  });
}

/** Crea la partida del nivel `id` y deja la vista como recién cargada. */
// _root.lastSeed (asteroidField.as:17-35): la semilla del último campo, para
// repetirlo con `sameseed` desde el panel de fin (DefineSprite_1300).
let ultimaSemilla = null;
function nuevaPartida(id, semilla = null) {
  idNivel = String(B.LEVELS[id] ? id : 0);
  nivel = { ...B.LEVELS[idNivel] };          // copia: el objetivo 'campo' se resuelve abajo
  history.replaceState(null, '', `?nivel=${idNivel}`);
  net = new Network(nivel.minerals);
  for (const campo of [].concat(nivel.field)) {
    const seed = campo.seed ?? semilla ?? 1 + Math.floor(Math.random() * 999);
    for (const a of B.genAsteroids({ ...campo, seed })) net.asteroids.push(new Asteroid(a.x, a.y, a.size, { rotation: a.rotation }));
    ultimaSemilla = seed;
  }
  if (nivel.waves) { net.waves = B.generarOleadas(nivel.waves); net.waveAngle = nivel.waveAngle ?? null; }
  // Speed Miner: el objetivo es el campo entero (levels.as:696); misiones, la mitad (:868)
  const campo = net.asteroids.reduce((t, a) => t + a.minerals, 0);
  if (nivel.goal === 'campo') nivel.goal = campo;
  if (nivel.goal === 'mitad') nivel.goal = Math.trunc(campo) / 2;
  if (nivel.porPorcentaje) net.wavesByPercent = nivel.goal;
  // levels.as: la planta inicial se autocoloca en el origen, ya construida
  for (const [k, x, y, lv] of nivel.inicio ?? [['energy', 0, 0]]) net.autoplace(k, x, y, lv);
  net.laserLife = opciones.optSL ? 4 : 2;   // frame_2/DoAction.as:1177-1181

  // lo que la vista recordaba de la partida anterior
  Object.assign(meta, { x: 0, y: 0, zoom: 1 });
  Object.assign(cam, meta);
  hazThel?.pause?.(); hazNodriza?.pause?.(); hazThel = hazNodriza = null;
  oido = {}; bajasOidas = [0, 0, 0, 0, 0, 0, 0, 0];
  habiaNaves = false; oleadaVista = null;
  enviadas.clear(); arena.hasta = 0;
  acumulado = 0; ultimo = performance.now();
  velocidad = 1;
  for (const b of document.querySelectorAll('#velocidad button')) b.setAttribute('aria-pressed', String(b.dataset.v === '1'));
  $('avisos').replaceChildren();
  $('fin').classList.add('oculto');
  $('velo').classList.add('oculto');

  pintarCampo();
  pintarFondoMini();
  pintarBarra();
  pintarMenu();
  pintarOleadas();
  irEtapa(GUION[idNivel] ? 0 : -1);
  tomar(null);
  aplicarCamara();
  pintarMundo();
  pintarMinimapa();
  pintarHUD();
  sonarModelo();   // la planta inicial ya está hecha: que no suene como obra acabada
}
function jugar() {
  estado = 'jugando';
  $('menu').classList.add('oculto');
  document.body.classList.remove('menu');
  musica({ backing: 30, tension1: 0, tension2: 0 });   // levels.as:26
  ultimo = performance.now();
  pintarOleadas();
  if (nivel.canScroll) avisar('Arrastra para mover el mundo · rueda para acercar · WASD y Q/E también', 'nota', 5000);
}
// showMenu(1), frame_1/DoAction.as:69: fondo a 50 en el menú
function irAlMenu() {
  estado = 'menu';
  nuevaPartida(idNivel);
  $('menu').classList.remove('oculto');
  document.body.classList.add('menu');
  musica({ backing: 50, tension1: 0, tension2: 0 });
}
// Los dos botones del gameOver original (DefineSprite_1300): setupLevel(n)
// sortea otro campo; setupLevel(n, false, 1) repite la semilla.
function reiniciar(misma = false) { nuevaPartida(idNivel, misma ? ultimaSemilla : null); jugar(); }
$('mOtraSemilla').onclick = () => nuevaPartida(idNivel);
$('mJugar').onclick = jugar;

// changeSpeed(s), DefineSprite_1292/frame_1/DoAction.as:18-30: Pause 0,
// Slow 0.5 (un tick cada dos fotogramas, frame_2/DoAction.as:408), Normal 1,
// Fast 4 (cuatro ticks por fotograma, :415).
let velocidad = 1;
for (const b of document.querySelectorAll('#velocidad button')) {
  b.onclick = () => {
    velocidad = Number(b.dataset.v);
    for (const o of b.parentNode.children) o.setAttribute('aria-pressed', String(o === b));
  };
}

// showOptions()/hideOptions(), frame_2/DoAction.as:152-172: abrir el panel
// congela la partida y cerrarlo la devuelve donde estaba.
let estadoPrevio = null;
function abrirModal(id) {
  estadoPrevio = estado; estado = 'modal';
  $(id).classList.remove('oculto'); $('velo').classList.remove('oculto');
}
function cerrarModal(id) {
  estado = estadoPrevio;
  $(id).classList.add('oculto'); $('velo').classList.add('oculto');
}
// showOptions() apaga el fondo y deja tension1 a 50 mientras el panel está
// abierto; hideOptions() devuelve los tres volúmenes (frame_2/DoAction.as:155-175).
let musicaPrevia = null;
function abrirOpciones() {
  for (const c of document.querySelectorAll('#opciones input')) c.checked = !!opciones[c.name];
  abrirModal('opciones');
  musicaPrevia = objetivosMusica();
  musica({ backing: 0, tension1: 50, tension2: 0 });
  $('velo').onclick = cerrarOpciones;
}
function cerrarOpciones() { cerrarModal('opciones'); musica(musicaPrevia); pintarIconos(); }
const iconos = document.querySelectorAll('#menu [data-opcion]');
function pintarIconos() {
  for (const b of iconos) b.setAttribute('aria-pressed', String(!!opciones[b.dataset.opcion]));
}
for (const b of iconos) b.onclick = () => { opciones[b.dataset.opcion] ^= 1; guardarOpciones(); pintarIconos(); };
pintarIconos();
// buttonClick/buttonOver van en todos los botones del original (118 llamadas).
// Las pestañas y tarjetas del menú son <div>, pero en el SWF son botones.
const BOTON = 'button, .nav, .diff';
addEventListener('click', (ev) => { if (ev.target.closest(BOTON)) sfx('buttonClick'); }, true);
addEventListener('mouseover', (ev) => {
  const b = ev.target.closest(BOTON);
  if (b && !b.contains(ev.relatedTarget)) sfx('buttonOver');
}, true);
for (const c of document.querySelectorAll('#opciones input')) {
  c.onchange = () => { opciones[c.name] = c.checked ? 1 : 0; guardarOpciones(); net.laserLife = opciones.optSL ? 4 : 2; };
}
$('mOpciones').onclick = abrirOpciones;
$('oOpciones').onclick = abrirOpciones;
$('opCerrar').onclick = cerrarOpciones;
$('mCreditos').onclick = () => { abrirModal('creditos'); $('velo').onclick = () => cerrarModal('creditos'); };
$('crCerrar').onclick = () => cerrarModal('creditos');
$('fReiniciar').onclick = () => reiniciar();
$('fMismo').onclick = () => reiniciar(true);
$('fSiguiente').onclick = () => { nuevaPartida(SIGUIENTE[idNivel]); jugar(); };
$('fMenu').onclick = irAlMenu;
$('oReiniciar').onclick = async () => {
  if (await confirmar('¿Reiniciar el nivel?', 'El campo se vuelve a generar con la misma semilla.', { si: 'Reiniciar' })) reiniciar(true);
};
$('oSalir').onclick = async () => {
  if (await confirmar('¿Abandonar la partida?', 'Perderás el progreso de este nivel y volverás al menú.',
                      { si: 'Abandonar', no: 'Seguir jugando', color: 'rojo' })) irAlMenu();
};

// gameOver(n), frame_2/DoAction.as:756: para el juego (_gameSpeed = 0), cancela
// la construcción en mano y muestra el resumen.
// Los textos de gameOver() por nivel (frame_2/DoAction.as:800-830, :876-895);
// el tutorial no está en el original y lleva uno propio.
const FIN = {
  3: { titulo: 'Objetivo cumplido', texto: 'Has completado la misión «Fácil». ¿Te ves capaz en «Normal»?',
       derrota: 'Los piratas ganaron esta ronda. Siempre puedes volver a intentarlo.' },
  4: { titulo: 'Objetivo cumplido', texto: 'Has completado la misión «Normal», nada mal. ¿Te ves capaz en «Difícil»?',
       derrota: 'Los piratas ganaron esta ronda (bueno, esto no es el modo Fácil), pero siempre puedes volver a intentarlo.' },
  5: { titulo: 'Objetivo cumplido', texto: 'Has completado el nivel «Difícil». ¿Crees que puedes con «Locura»?',
       derrota: 'Los piratas ganaron esta ronda (bueno, lo juegas en «Difícil»), pero siempre puedes volver a intentarlo.' },
  6: { titulo: 'Objetivo cumplido', texto: 'Has completado el nivel «Locura». Echa un vistazo a los modos Supervivencia, Oleadas y Minero veloz.',
       derrota: 'Los piratas ganaron esta ronda (bueno, lo juegas en «Locura»), pero siempre puedes volver a intentarlo.' },
  // Survivor, frame_2/DoAction.as:900-907: siempre acaba en derrota
  8: { derrota: (t) => `Aguantaste ${t}. ¿Crees que durarás más la próxima vez?` },
  9: { derrota: (t) => `Aguantaste ${t}. ¿Crees que durarás más la próxima vez?` },
  10: { derrota: (t) => `Aguantaste ${t}. ¿Crees que durarás más la próxima vez?` },
  // Misiones, frame_2/DoAction.as:829-868 y :928-938
  103: { titulo: 'Misión cumplida', texto: 'Has sobrevivido diez minutos, bien hecho. Creo que estás listo para la siguiente misión.' },
  106: { titulo: 'Misión cumplida', texto: 'Te has defendido de las nodrizas; cuidado con ellas en las próximas misiones.',
         derrota: 'Las nodrizas han destruido tu base. Los misiles y los THEL son la única defensa contra su alcance; los Pulse ayudan contra sus cazas.' },
  109: { titulo: 'Misión cumplida', texto: 'Has sobrevivido veinte minutos con toda la fuerza del enemigo encima. Si quieres más reto, prueba los modos de minado y supervivencia del menú.' },
  // Training, frame_2/DoAction.as:786-795
  1: { titulo: 'Entrenamiento completado', texto: 'Nivel 1 de entrenamiento completado. Ahora, a aprender a defenderte.' },
  2: { titulo: 'Entrenamiento completado', texto: 'Nivel 2 de entrenamiento completado. Ya puedes jugar el resto de modos.' },
  // Wave Mode y Sandbox, frame_2/DoAction.as:820-822, :915-926
  11: { titulo: 'Oleadas superadas', texto: '¡Has sobrevivido a todas las oleadas!',
        derrota: (t, red) => `Más suerte la próxima vez; prueba a mandar las oleadas en otro orden. Oleadas enviadas: ${red.wavesSent}. ¿Crees que puedes hacerlo mejor?` },
  13: { derrota: (t, red) => `Naves destruidas: ${red.kills} · tiempo: ${t} · oleadas enviadas: ${red.wavesSent}.` },
  12: { titulo: '100 % completado', texto: (t) => `Has completado el modo Minero veloz en ${t}. La clave de un buen tiempo es no quedarte nunca sin energía y construir MUCHOS mineros mejorados. Nunca guardes minerales en el banco: gástalos en mineros tan rápido como puedas.` },
};
// «Jugar en Difícil» (design/FinVictoria.dc.html): la siguiente dificultad
const SIGUIENTE = { 1: '2', 3: '4', 4: '5', 5: '6' };
function terminar(ganada) {
  estado = ganada ? 'victoria' : 'derrota';
  tomar(null);
  seleccion = null;
  pintarSeleccion();
  const seg = net.playTime, t = reloj(seg), textos = FIN[idNivel] ?? {};
  if (ganada && Number(idNivel) > 100 && Number(idNivel) - 100 > misionesHechas) {
    misionesHechas = Number(idNivel) - 100;   // _o.data.mC, frame_2/DoAction.as:833
    try { localStorage.misiones = misionesHechas; } catch { /* sin almacén */ }
  }
  // en supervivencia la marca es el tiempo aguantado y se mejora perdiendo
  const previa = marcas[idNivel];
  const mejor = nivel.marca === 'mayor' ? previa === undefined || seg > previa : ganada && (previa === undefined || seg < previa);
  if (mejor) {
    marcas[idNivel] = seg;
    try { localStorage.marcas = JSON.stringify(marcas); } catch { /* sin almacén */ }
  }
  $('fin').classList.toggle('derrota', !ganada);
  $('fModo').textContent = (nivel.tag ?? nivel.title).toUpperCase();
  const mision = Number(idNivel) > 100;
  $('fTitulo').textContent = ganada ? textos.titulo ?? (mision ? 'Misión cumplida' : 'Objetivo cumplido') : 'Derrota';
  const texto = ganada ? textos.texto ?? (mision ? `Has alcanzado el objetivo de minado en ${t}.` : 'Has alcanzado el objetivo de minado.')
    : textos.derrota ?? (mision ? `Has minado el ${Math.trunc(100 / nivel.goal * net.totalMined)} % del campo. Más suerte la próxima vez.` : 'No te queda ningún edificio en pie.');
  $('fTexto').textContent = typeof texto === 'function' ? texto(t, net) : texto;
  $('fPorcentaje').classList.toggle('oculto', !nivel.goal);
  $('fProgreso').classList.toggle('oculto', !nivel.goal);
  if (!ganada && nivel.goal) {
    // "Percent Completed", frame_2/DoAction.as:877: int(100 / _goal * _totalMined)
    const pct = nivel.goal ? Math.trunc(100 / nivel.goal * net.totalMined) : 0;
    $('fPct').textContent = pct;
    $('fBarra').style.width = `${Math.min(100, pct)}%`;
    $('fMinados').textContent = `${nf.format(net.totalMined)} minados`;
    $('fObjetivo').textContent = nf.format(nivel.goal ?? 0);
  }
  // "Total ships killed / Minerals mined / Play Time", frame_2/DoAction.as:781
  const stats = ganada
    ? [[nf.format(net.totalMined), 'minerales extraídos', 'var(--mineral)'], [net.kills, 'naves destruidas'], [t, 'tiempo de partida'],
       mejor ? [previa === undefined ? t : `−${reloj(previa - seg)}`, 'mejor marca superada', 'var(--repara)'] : [reloj(previa), 'tu mejor marca', 'var(--faint)']]
    : nivel.marca === 'mayor'
    ? [[t, 'tiempo aguantado', 'var(--mineral)'], [net.kills, 'naves destruidas'], [net.destroyed, 'edificios perdidos', 'var(--mal)'],
       mejor ? [previa === undefined ? t : `+${reloj(seg - previa)}`, 'mejor marca superada', 'var(--repara)'] : [reloj(previa), 'tu mejor marca', 'var(--faint)']]
    : [[net.kills, 'naves destruidas'], [t, 'tiempo de partida'], [net.destroyed, 'edificios perdidos', 'var(--mal)'],
       [previa === undefined ? '—' : reloj(previa), 'tu mejor marca', 'var(--faint)']];
  $('fStats').innerHTML = stats.map(([v, l, c]) =>
    `<div class="stat"><div class="v num"${c ? ` style="color:${c}"` : ''}>${v}</div><div class="l">${l}</div></div>`).join('');
  // graph.create(), graph.as:121-156: energía y minado a escala de su máximo;
  // el título del minado va ×20 ("Minerals per minute", graph.as:155)
  const g = net.graph;
  grafica($('fGrafE'), g.data.map((d) => d[0]), g.maxEnergy, 'var(--energia)');
  grafica($('fGrafM'), g.data.map((d) => d[1] * 20), g.maxMining * 20, 'var(--mineral)');
  $('fPicoE').textContent = `pico ${nf.format(g.maxEnergy)}`;
  $('fPicoM').textContent = `pico ${nf.format(g.maxMining * 20)}`;
  const eje = $('fEje');
  eje.replaceChildren();
  for (const f of [0, 1 / 3, 2 / 3, 1]) {
    const tx = el('text', { x: f === 1 ? 572 : f * 576, y: 14, fill: '#5f6d82', 'font-size': 10, 'font-family': 'IBM Plex Mono, monospace' });
    tx.textContent = reloj(seg * f);
    eje.appendChild(tx);
  }
  pintarOleadas();
  $('fReiniciar').textContent = ganada ? `Repetir ${nivel.tag ?? nivel.title}` : 'Reintentar';
  // sin campo o con semilla fija, «mismo campo» no añade nada
  $('fMismo').classList.toggle('oculto', [].concat(nivel.field).some((f) => f.seed != null || !f.quantity));
  $('fMismoSemilla').textContent = `semilla ${ultimaSemilla}`;
  const sig = ganada && SIGUIENTE[idNivel];
  $('fSiguiente').classList.toggle('oculto', !sig);
  $('fReiniciar').classList.toggle('principal', !sig);
  if (sig) $('fSiguiente').textContent = `Jugar en ${B.LEVELS[sig].tag}`;
  $('fin').classList.remove('oculto');
  $('velo').classList.remove('oculto');
  $('velo').onclick = null;
  // gameOver(), frame_2/DoAction.as:756-773
  musica({ backing: 0, tension1: 0, tension2: 0 });
  sfx(ganada ? 'success' : 'fail');
}

// Una serie como área + línea en un SVG de 672×96 (design/FinVictoria.dc.html)
function grafica(svg, serie, max, color) {
  svg.replaceChildren();
  for (const y of [8, 48, 88]) svg.appendChild(el('path', { d: `M0 ${y} H620`, stroke: 'rgba(150,180,215,.09)', 'stroke-width': 1 }));
  if (serie.length < 2 || !max) return;
  const px = (i) => (i * 620) / (serie.length - 1), py = (v) => 88 - (80 * v) / max;
  const linea = serie.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(' ');
  svg.appendChild(el('path', { d: `${linea} L620 88 L0 88 Z`, fill: color, opacity: .12 }));
  svg.appendChild(el('path', { d: linea, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  const ult = serie[serie.length - 1];
  svg.appendChild(el('circle', { cx: 620, cy: py(ult), r: 4, fill: color, stroke: '#0b101a', 'stroke-width': 2 }));
  const tx = el('text', { x: 632, y: py(ult) + 4, fill: '#c8d2e0', 'font-size': 11, 'font-family': 'IBM Plex Mono, monospace' });
  tx.textContent = nf.format(ult);
  svg.appendChild(tx);
}

// El modelo no sabe de sonido: lo que pasó en los ticks del fotograma se lee
// del estado. bBuilt al acabar cada obra o mejora (buildingMiner.as:221 y
// hermanos); mining con cada rayo (buildingMiner.as:276).
const acabados = new WeakSet(), rayosOidos = new WeakSet();
function sonarModelo() {
  for (const n of net.nodes) {
    if (!n.built) { acabados.delete(n); continue; }
    if (!acabados.has(n)) { acabados.add(n); if (net.ticks) sfx('bBuilt'); }
  }
  for (const b of net.beams) {
    if (!rayosOidos.has(b)) { rayosOidos.add(b); sfx('mining'); }
  }
  // laser1 al empezar cada ráfaga (ship1.as:145) y bang1 al morir (ship1.as:60)
  if (nuevo('bursts')) sfx('laser1');
  // cada nave muere con su bang (shipN.as, la rama _life <= 0); la explosiva
  // que estalla ya sonó bang2 al detonar
  for (let sub = 1; sub <= 7; sub++) {
    if (net.deaths[sub] > bajasOidas[sub]) {
      const estallada = sub === 3 && net.detonations > (oido.detonations ?? 0);
      if (!estallada) sfx(B.SHIPS[sub].dies ?? 'bang1');
      bajasOidas[sub] = net.deaths[sub];
    }
  }
  if (nuevo('escortSpawns')) sfx('missile1');   // ship6.as:174
  // THEL (buildingLaser.as:376-435): en bucle mientras el haz está encendido
  const thelDispara = net.nodes.some((n) => n.subType === 2 && n.firing);
  if (thelDispara && !hazThel) hazThel = sfx('THEL') ?? true;
  if (!thelDispara && hazThel) { hazThel.pause?.(); hazThel = null; }
  // laser4 (ship6.as:202-215): en bucle mientras la nodriza dispara, parado al soltar
  const nodrizaDispara = net.ships.some((s) => s.sub === 6 && s.firing);
  if (nodrizaDispara && !hazNodriza) hazNodriza = sfx('laser4') ?? true;
  if (!nodrizaDispara && hazNodriza) { hazNodriza.pause?.(); hazNodriza = null; }
  if (nuevo('rocketsFired')) sfx('missile2');      // ship2.as:135
  if (nuevo('rocketsLaunched')) sfx('missile1');   // buildingRocket.as:276
  if (nuevo('impacts')) sfx('bang1');              // rocket.as:97
  if (nuevo('detonations')) sfx('bang2');          // ship3.as:184
  if (nuevo('anchors')) sfx('laser2');             // ship4.as:164
  // buildingX.as, _life <= 0: bang5 casi todos, bang6 el almacén. Torretas y
  // lanzaderas piden bang7, que no está en _soundSFX (frame_1/DoAction.as:113):
  // SFX() compara con undefined y calla. Lo mismo le pasa a death4 (rocket.as:49).
  if (nuevo('destroyed')) {
    for (const w of net.wrecks) {
      if (w.tick !== net.ticks || !w.hueco) continue;
      if (w.kind === 'store') sfx('bang6');
      else if (w.kind !== 'laser' && w.kind !== 'rocket') sfx('bang5');
    }
  }
  // waveBar, frame_2/DoAction.as:1955: "N fighters detected", vive 20 s
  if (net.lastWave && net.lastWave !== oleadaVista) {
    oleadaVista = net.lastWave;
    const { n, sub, count, angle, spread } = oleadaVista;
    avisar(`<b>Oleada ${n}</b><span>${count} ${B.SHIPS[sub]?.label.toLowerCase() ?? 'naves'} ${spread >= 360 ? 'por todos lados' : `por el ${rumbo(angle)}`}</span>`,
           'oleada', 20000);
    sfx('shipAlert');   // frame_2/DoAction.as:1988
  }
  // fire() (frame_2/DoAction.as:1136-1138) sube tension2 y el fondo a 100 con
  // cada disparo; a los 100 ticks sin disparar, el fondo vuelve a 30 cada
  // fotograma (:203-207), lo que pisa el 60 del spawn() de abajo al siguiente
  if (net.lastFired === 100) musica({ tension2: 100, backing: 100 });
  if (net.lastFired <= 0) musica({ tension2: 0, backing: 30 });
  // spawn() sube tension1 (frame_2/DoAction.as:1061); destroy() la baja con la
  // última nave (:657-659)
  if (net.ships.length && !habiaNaves) musica({ tension1: 100, backing: 60 });
  if (!net.ships.length && habiaNaves) musica({ tension1: 0, tension2: 0, backing: 30 });
  habiaNaves = net.ships.length > 0;
}
// contadores del modelo ya sonados, por nombre; `nuevo` avanza y dice si subió
let oido = {}, bajasOidas = [0, 0, 0, 0, 0, 0, 0, 0], hazNodriza = null, hazThel = null;
const nuevo = (k) => net[k] > (oido[k] ?? 0) && (oido[k] = net[k]);
let habiaNaves = false, oleadaVista = null;
// spawnQue: x = cos, y = sin con y hacia abajo → 0° es el este, 90° el sur
const RUMBOS = ['este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste', 'norte', 'noreste'];
const rumbo = (a) => RUMBOS[Math.round((((a % 360) + 360) % 360) / 45) % 8];

// --- bucle ------------------------------------------------------------------
// 40 ticks por segundo, desacoplados del refresco de pantalla.
let acumulado = 0, ultimo = performance.now();

function bucle(ahora) {
  const dt = Math.min(250, ahora - ultimo);   // tras un cambio de pestaña, no dispares
  ultimo = ahora;
  acumulado += dt * velocidad;
  const paso = 1000 / B.TICK_RATE;
  while (acumulado >= paso) { if (estado === 'jugando') net.tick(); acumulado -= paso; }
  if (estado === 'jugando') {
    sonarModelo();
    tickGuion();
    const ganada = nivel.sobrevivir ? net.survived(nivel.sobrevivir) : nivel.nodrizas ? net.mothersRepelled
      : nivel.modo === 'oleadas' ? net.wavesCleared : net.reachedGoal(nivel.goal);
    if (ganada) terminar(true);
    else if (net.defeated) terminar(false);
  }

  moverCamara();
  pintarMundo();
  pintarFantasma();
  pintarMinimapa();
  pintarHUD();
  pintarEnfriamiento();
  if (seleccion) pintarSeleccion();
  requestAnimationFrame(bucle);
}

nuevaPartida(idNivel);
requestAnimationFrame(bucle);
if (consulta.has('jugar')) jugar();

// --- comprobación en caliente -----------------------------------------------
// Si el puerto se desvía del oráculo de game.py, se ve aquí y en la consola.
try {
  const lineas = selfCheck();
  $('check').innerHTML = `<b>✓ modelo verificado</b> · ${lineas.length} comprobaciones<br>`
    + lineas.slice(0, 4).join('<br>');
  console.log('%csim.js coincide con game.py', 'color:#8ED07A', lineas);
} catch (err) {
  $('check').classList.add('mal');
  $('check').innerHTML = `<b>✗ el modelo NO coincide con game.py</b><br>${err.message}`;
  console.error(err);
}
