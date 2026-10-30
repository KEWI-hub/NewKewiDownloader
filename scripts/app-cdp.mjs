// Drive the REAL Prism desktop app through the WebView2 DevTools protocol.
//
// Prism is launched with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port,
// then Playwright attaches over CDP. Every Prism window (main, capture dialog, details…)
// is a page in the same WebView2 browser, so the test can click through real flows and
// take screenshots of the actual app. Windows only (WebView2).
//
//   node scripts/app-cdp.mjs <command> [args]
//     launch <prism.exe> <dataDir> [port]   start the app (background) with remote debugging
//     pages [port]                          list open Prism windows
//     shot <urlPart> <file> [port]          screenshot a window
//     eval <urlPart> <js> [port]            run JS in a window, print the JSON result
//     click <urlPart> <text> [port]         click the first visible element with this text / aria-label
//     fill <urlPart> <selector> <value> [port]
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "extension", "package.json"));
const { chromium } = require("playwright");

const [cmd, ...args] = process.argv.slice(2);
const portArg = (i) => Number(args[i] ?? 9333);

async function connect(port) {
  for (let i = 0; i < 60; i++) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`no DevTools endpoint on ${port}`);
}

async function page(browser, part) {
  for (let i = 0; i < 40; i++) {
    const pages = browser.contexts().flatMap((c) => c.pages());
    const p = part === "main" ? pages.find((pg) => /tauri\.localhost\/(#\/?)?$/.test(pg.url())) : pages.find((pg) => pg.url().includes(part));
    if (p) return p;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no window matching "${part}"`);
}

switch (cmd) {
  case "launch": {
    const [exe, dataDir, port = "9333"] = args;
    const child = spawn(exe, [], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        PRISM_DATA_DIR: dataDir,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      },
    });
    child.unref();
    const b = await connect(Number(port));
    console.log(JSON.stringify(b.contexts().flatMap((c) => c.pages()).map((p) => p.url())));
    await b.close();
    break;
  }
  case "pages": {
    const b = await connect(portArg(0));
    for (const p of b.contexts().flatMap((c) => c.pages())) console.log(p.url(), "|", await p.title());
    await b.close();
    break;
  }
  case "shot": {
    const b = await connect(portArg(2));
    const p = await page(b, args[0]);
    await p.waitForTimeout(400);
    await p.screenshot({ path: args[1] });
    console.log("saved", args[1]);
    await b.close();
    break;
  }
  case "eval": {
    const b = await connect(portArg(2));
    const p = await page(b, args[0]);
    const r = await p.evaluate(args[1]);
    console.log(JSON.stringify(r, null, 1));
    await b.close();
    break;
  }
  case "click": {
    const b = await connect(portArg(2));
    const p = await page(b, args[0]);
    const text = args[1];
    const loc = p.locator(`[aria-label="${text}"], [title="${text}"]`).or(p.getByRole("button", { name: text })).or(p.getByText(text, { exact: true }));
    await loc.first().click({ timeout: 5000 });
    console.log("clicked", text);
    await b.close();
    break;
  }
  case "press": {
    const b = await connect(portArg(2));
    const p = await page(b, args[0]);
    await p.keyboard.press(args[1]);
    console.log("pressed", args[1]);
    await b.close();
    break;
  }
  case "fill": {
    const b = await connect(portArg(3));
    const p = await page(b, args[0]);
    await p.locator(args[1]).first().fill(args[2]);
    console.log("filled", args[1]);
    await b.close();
    break;
  }
  default:
    console.error("unknown command; see header");
    process.exit(2);
}
