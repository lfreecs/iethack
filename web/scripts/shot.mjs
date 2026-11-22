// Captura de pantalla con el Chrome instalado (sin dependencias), para revisar la interfaz sin abrir el navegador.
// Uso: node scripts/shot.mjs <url> <salida.png> [--wait=6000] [--size=1440x900] [--mobile=1] [--steps="js;;sleep:800;;click:300,400;;js"]
// Cada paso es una expresion JS que se evalua en la pagina, "sleep:ms", "click:x,y" (clic real del mouse) o "tap:x,y" (toque).
// --mobile=1 emula un telefono (pantalla tactil). Imprime errores y avisos de la consola.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const [url, out, ...rest] = process.argv.slice(2);
const opt = Object.fromEntries(rest.map((a) => a.replace(/^--/, "").split(/=(.*)/s).slice(0, 2)));
const [w, h] = (opt.size || "1440x900").split("x").map(Number);
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(
  CHROME,
  ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), "shot-"))}`, `--window-size=${w},${h}`,
    "--hide-scrollbars", "--no-first-run", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", ...(opt.offline ? ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost"] : []), "about:blank"],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageSocket() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome aun no abre el puerto
    }
    await sleep(200);
  }
  throw new Error("Chrome no respondio");
}

try {
  const ws = new WebSocket(await pageSocket());
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result ?? msg.error);
      pending.delete(msg.id);
    } else if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type)) {
      logs.push(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300)}`);
    } else if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      logs.push(`[excepcion] ${(d.exception?.description ?? d.text).slice(0, 400)}`);
    }
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      pending.set(++id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: opt.mobile ? 2 : 1, mobile: !!opt.mobile });
  if (opt.mobile) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
  await send("Page.navigate", { url });
  await sleep(Number(opt.wait || 6000));
  for (const step of opt.steps ? opt.steps.split(";;") : []) {
    if (step.startsWith("sleep:")) await sleep(Number(step.slice(6)));
    else if (step.startsWith("click:")) {
      const [x, y] = step.slice(6).split(",").map(Number);
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1 });
    } else if (step.startsWith("tap:")) {
      const [x, y] = step.slice(4).split(",").map(Number);
      await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      const r = await send("Runtime.evaluate", { expression: step, awaitPromise: true });
      if (r.exceptionDetails) logs.push(`[paso] ${step.slice(0, 60)} -> ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    }
  }
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log(`${out} | avisos de consola: ${logs.length}`);
  [...new Set(logs)].slice(0, 12).forEach((l) => console.log("  " + l));
  ws.close();
} finally {
  chrome.kill();
}
