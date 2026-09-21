// Captura del juego real para el README: abre Chrome headless contra el
// servidor local, juega Speed Miner (campo fijo, seed 15) por CDP y guarda
// design/capturas/juego.png a 1440×900 ×2. Requiere `npm start` en marcha.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const chrome = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const salida = path.join(path.dirname(fileURLToPath(import.meta.url)), "capturas", "juego.png");
const url = "http://localhost:8123/?nivel=12&jugar";

const proc = spawn(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--disable-lcd-text",
  "--force-color-profile=srgb", "--remote-debugging-port=0", "--window-size=1440,900", "about:blank"]);
const puerto = await new Promise((res) => proc.stderr.on("data", (d) => {
  const m = String(d).match(/DevTools listening on ws:\/\/[^:]+:(\d+)/); if (m) res(m[1]);
}));
const [pagina] = (await (await fetch(`http://127.0.0.1:${puerto}/json`)).json()).filter((p) => p.type === "page");
const ws = new WebSocket(pagina.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pendientes = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (pendientes.has(m.id)) { pendientes.get(m.id)(m.result); pendientes.delete(m.id); } };
const cdp = (method, params = {}) => new Promise((r) => { pendientes.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// Un clic humano dura ~100 ms; los instantáneos se cuelan entre fotogramas (CLAUDE.md).
async function clic(x, y) {
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await espera(30);
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await espera(100);
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await espera(150);
}
async function tecla(k) {
  const base = k.length === 1
    ? { key: k, code: "Digit" + k, text: k, windowsVirtualKeyCode: 48 + Number(k) }
    : { key: k, code: k, windowsVirtualKeyCode: { Escape: 27 }[k] };
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", ...base });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  await espera(100);
}

await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
await cdp("Page.navigate", { url });
await espera(2500);

// [tecla, x, y] en píxeles de pantalla (la planta inicial está en el centro, 720,450);
// ["esperar", ms] deja correr la partida; ["mover", x, y] solo desplaza el ratón.
// Los relays se esperan uno a uno: un edificio colocado mientras su vecino aún
// está en obra queda aislado y nunca se construye (fidelidad al original).
const jugadas = [
  ["", 1248, 48],                                       // 4×
  ["1", 680, 492], ["2", 650, 515], ["1", 770, 420], ["2", 812, 405], ["1", 640, 470], ["2", 600, 445],
  ["esperar", 40000],
  ["3", 810, 490],
  ["1", 660, 400], ["esperar", 5000], ["1", 620, 360], ["esperar", 5000], ["2", 555, 365], ["2", 610, 300],
  ["esperar", 15000],
  ["1", 880, 470], ["esperar", 5000], ["1", 950, 500], ["esperar", 5000], ["2", 975, 540], ["2", 1000, 485],
  ["esperar", 20000],
  ["4", 740, 350],
  ["esperar", 30000],
  ["Escape"], ["mover", 400, 300], ["", 1200, 48], ["mover", 400, 300],  // 1× y ratón fuera
  ["esperar", 2000],
];
for (const [k, x, y] of jugadas) {
  if (k === "esperar") { await espera(x); continue; }
  if (k === "mover") { await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); continue; }
  if (k) await tecla(k);
  if (x != null) await clic(x, y);
}

const { data } = await cdp("Page.captureScreenshot", { format: "png" });
writeFileSync(salida, Buffer.from(data, "base64"));
console.log(path.relative(process.cwd(), salida));
ws.close(); proc.kill();
