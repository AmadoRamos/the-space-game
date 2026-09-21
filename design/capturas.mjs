// Captura cada canvas de design/ a su tamaño de artboard en design/capturas/.
// Chrome headless, sin dependencias. Regenerar tras cambiar un canvas. Sin antialiasing
// LCD: con él Chrome pinta subpíxeles distintos en cada pasada y la captura nunca es igual.
import { execFileSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

const chrome = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const raiz = path.dirname(fileURLToPath(import.meta.url));

for (const a of JSON.parse(readFileSync(path.join(raiz, "canvas.json"))).artboards) {
  const salida = path.join(raiz, "capturas", a.file.replace(".dc.html", ".png"));
  execFileSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--disable-lcd-text", "--force-color-profile=srgb",
    `--window-size=${a.w},${a.h}`, `--screenshot=${salida}`, "--virtual-time-budget=3000",
    pathToFileURL(path.join(raiz, a.file)).href], { stdio: "ignore", timeout: 60000 });
  console.log(path.relative(raiz, salida));
}
