// Sonido. Los MP3 son los del SWF (DATA/sounds), servidos tal cual.
//
// SFX(n), frame_1/DoAction.as:3-22: cada efecto lleva [último disparo,
// intervalo mínimo en ms, volumen, loops] y no se repite antes de su
// intervalo. La tabla es la de frame_1/DoAction.as:114-140, sin los que el
// original declara y nunca pide (bang4, laser3, shipInfoDrop, building*).
const SFX = {
  bang1: [0, 500, 0.6], bang2: [0, 500, 0.7], bang3: [0, 500, 0.8], bang5: [0, 500, 1], bang6: [0, 500, 1],
  bPlace: [0, 200, 0.4], bSell: [0, 200, 0.8], bBuilt: [0, 200, 0.7], mining: [0, 500, 0.2],
  laser1: [0, 100, 0.8], laser2: [0, 100, 0.8], laser4: [0, 50, 0.5, 20],
  THEL: [0, 250, 1, 1], missile1: [0, 100, 0.9], missile2: [0, 100, 0.9],
  buttonClick: [0, 100, 0.5], buttonOver: [0, 100, 0.4],
  shipAlert: [0, 50, 1], success: [0, 500, 0.8], fail: [0, 500, 0.8],
};

// Tres pistas en bucle desde el arranque (frame_1/DoAction.as:141-190) cuyo
// volumen persigue un objetivo 0-100 a razón de un punto por fotograma. El
// wrapper de la web fijaba _maxMusicVolume/_maxSoundVolume; aquí son los dos
// interruptores de `opciones`.
const PISTAS = { backing: null, tension1: null, tension2: null };
const objetivo = { backing: 0, tension1: 0, tension2: 0 };

let opciones = { sonido: 1, musica: 1 };
let activo = false;

export function iniciarSonido(opts) {
  opciones = opts;
  // El navegador no deja sonar nada sin un gesto: la música arranca al primero.
  addEventListener('pointerdown', activar, { once: true, capture: true });
  addEventListener('keydown', activar, { once: true, capture: true });
}

function activar() {
  if (activo) return;
  activo = true;
  for (const p of Object.keys(PISTAS)) {
    const a = new Audio(`./sonidos/music_${p}.mp3`);
    a.loop = true; a.volume = 0;
    a.play().catch(() => {});
    PISTAS[p] = a;
  }
  setInterval(rampa, 25);   // el SWF va a 40 fps: un punto cada 25 ms
}

function rampa() {
  for (const [p, a] of Object.entries(PISTAS)) {
    const meta = opciones.musica ? objetivo[p] / 100 : 0;
    const v = a.volume;
    if (Math.abs(v - meta) < 0.011) { if (v !== meta) a.volume = meta; continue; }
    a.volume = v < meta ? v + 0.01 : v - 0.01;
  }
}

/** Fija los objetivos de volumen, p. ej. musica({ backing: 30 }). */
export function musica(metas) { Object.assign(objetivo, metas); }
export function objetivosMusica() { return { ...objetivo }; }

export function sfx(n) {
  const s = SFX[n];
  if (!s || !opciones.sonido) return;
  const ahora = performance.now();
  if (ahora - s[0] <= s[1]) return;
  s[0] = ahora;
  const a = new Audio(`./sonidos/${n}.mp3`);
  a.volume = s[2];
  if (s[3]) a.loop = true;   // laser4 y THEL van en bucle; quien los dispara los para
  a.play().catch(() => {});
  return a;
}
