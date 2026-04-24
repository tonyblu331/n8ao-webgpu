import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";
import { writeFile, mkdir, readFile, copyFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const MODES = [
  { name: "ao", label: "AO" },
  { name: "noao", label: "No AO" },
  { name: "full", label: "Full" },
];

const N8AO_TS = join(ROOT, "src", "N8AONode.ts");
const BLUENOISE_JS = join(ROOT, "src", "BlueNoise.js");
const N8AO_BACKUP = join(ROOT, "src", "N8AONode.ts.ign-bak");

async function build() {
  execSync("pnpm build", { cwd: ROOT, stdio: "pipe" });
}

async function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", ["benchmark/server.mjs"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", (data) => {
      const m = data.toString().match(/http:\/\/localhost:(\d+)/);
      if (m) resolve({ proc, port: parseInt(m[1]) });
    });
    proc.on("error", reject);
    setTimeout(() => reject(new Error("Server start timeout")), 10000);
  });
}

async function runBranch(branch, port, generateDiffs = false) {
  const url = `http://localhost:${port}/benchmark/benchmark.html`;
  const browser = await chromium.launch({ headless: true });
  const screenshotDir = join(ROOT, "benchmark", "screenshots");
  await mkdir(screenshotDir, { recursive: true });

  const allResults = [];

  for (const mode of MODES) {
    // Skip diff mode in normal branch runs - it's generated post-hoc
    if (mode.name === "diff" && !generateDiffs) continue;

    console.log(`\n  --- ${branch} / ${mode.label} ---`);

    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.setDefaultTimeout(300000);

    page.on("console", msg => {
      const t = msg.text();
      if (t.startsWith("RESULT:")) allResults.push(JSON.parse(t.slice("RESULT:".length)));
      if (t.startsWith("BENCHMARK_RESULTS:")) allResults.push(...JSON.parse(t.slice("BENCHMARK_RESULTS:".length)));
    });
    page.on("pageerror", err => console.error(`    PAGE: ${err.message}`));

    const modeUrl = `${url}#mode=${mode.name}`;
    console.log(`  Navigate: ${modeUrl}`);
    await page.goto(modeUrl, { waitUntil: "networkidle", timeout: 180000 });

    for (const name of ["helmet", "interior"]) {
      console.log(`    Waiting for ${name}...`);
      await page.waitForFunction(n => window._readyForScreenshot === n, name, { timeout: 300000 });
      const fp = join(screenshotDir, `${name}-${mode.name}-${branch}.png`);
      await page.screenshot({ path: fp, fullPage: false });
      console.log(`    Saved: ${name}-${mode.name}-${branch}.png`);
      await page.evaluate(() => { window._screenshotDone(); });
    }

    await page.waitForFunction(() => window._done === true, { timeout: 300000 });
    await ctx.close();
  }

  await browser.close();

  const resultsDir = join(ROOT, "benchmark", "results");
  await mkdir(resultsDir, { recursive: true });

  // Deduplicate
  const uniq = [];
  const seen = new Set();
  for (const r of allResults) {
    const key = `${r.scene}:${r.mode}`;
    if (!seen.has(key)) { seen.add(key); uniq.push(r); }
  }

  await writeFile(join(resultsDir, `${branch}.json`), JSON.stringify(uniq, null, 2));
  return uniq;
}

async function generateSideBySide(screenshotDir, sceneName, mode, serverPort) {
  const baselinePath = join(screenshotDir, `${sceneName}-${mode}-baseline.png`);
  const ignPath = join(screenshotDir, `${sceneName}-${mode}-ign.png`);
  const outPath = join(screenshotDir, `${sceneName}-sidebyside-${mode}.png`);

  // Read files in Node.js
  const [baselineBuf, ignBuf] = await Promise.all([
    readFile(baselinePath),
    readFile(ignPath)
  ]);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Navigate to a valid page
  await page.goto(`http://localhost:${serverPort}/benchmark/benchmark.html`, { waitUntil: "networkidle" });

  const buffer = await page.evaluate(async ({ baselineBytes, ignBytes, modeLabel }) => {
    const bBlob = new Blob([new Uint8Array(baselineBytes)], { type: "image/png" });
    const iBlob = new Blob([new Uint8Array(ignBytes)], { type: "image/png" });

    const [bBitmap, iBitmap] = await Promise.all([
      createImageBitmap(bBlob),
      createImageBitmap(iBlob)
    ]);

    const w = bBitmap.width;
    const h = bBitmap.height;

    const canvas = new OffscreenCanvas(w * 2, h);
    const ctx = canvas.getContext("2d");

    // Draw baseline left, IGN right
    ctx.drawImage(bBitmap, 0, 0);
    ctx.drawImage(iBitmap, w, 0);

    // Divider line
    ctx.strokeStyle = "#00ff00";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w, 0);
    ctx.lineTo(w, h);
    ctx.stroke();

    // Labels
    ctx.fillStyle = "#00ff00";
    ctx.font = "bold 32px monospace";
    ctx.fillText("BASELINE", 20, 45);
    ctx.fillText("IGN", w + 20, 45);

    // Mode label at bottom
    ctx.font = "bold 28px monospace";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(modeLabel.toUpperCase(), 20, h - 20);

    const blob = await canvas.convertToBlob({ type: "image/png" });
    const buf = await blob.arrayBuffer();
    return Array.from(new Uint8Array(buf));
  }, { baselineBytes: Array.from(baselineBuf), ignBytes: Array.from(ignBuf), modeLabel: mode });

  await browser.close();
  await writeFile(outPath, Buffer.from(buffer));
  console.log(`    Created: ${sceneName}-sidebyside-${mode}.png`);
}

async function bundleSize() {
  const dist = join(ROOT, "dist");
  if (!existsSync(dist)) return null;
  const files = (await (await import("node:fs/promises")).readdir(dist)).filter(f => f.endsWith(".js"));
  let total = 0;
  const info = {};
  for (const f of files) {
    const s = (await stat(join(dist, f))).size;
    info[f] = s;
    total += s;
  }
  return { total, info };
}

async function printCompare() {
  const rd = join(ROOT, "benchmark", "results");
  let bl, ig;
  try { bl = JSON.parse(await readFile(join(rd, "baseline.json"), "utf8")); } catch { console.log("No baseline.json"); return; }
  try { ig = JSON.parse(await readFile(join(rd, "ign.json"), "utf8")); } catch { console.log("No ign.json"); return; }

  const blMap = new Map(bl.map(r => [`${r.scene}:${r.mode}`, r]));
  const igMap = new Map(ig.map(r => [`${r.scene}:${r.mode}`, r]));

  console.log("\n" + "=".repeat(100));
  console.log("  N8AO BENCHMARK — BLUE NOISE vs CoD IGN");
  console.log("  Ultra quality, aoRadius=5, intensity=25, denoiseRadius=6, distanceFalloff=0.3");
  console.log("=".repeat(100));

  for (const scene of ["helmet", "interior"]) {
    console.log(`\n  [ ${scene.toUpperCase()} ]`);
    console.log(`${"Mode".padEnd(12)} ${"Blue ms".padStart(10)} ${"IGN ms".padStart(10)} ${"Delta ms".padStart(10)} ${"Delta %".padStart(8)} ${"Blue FPS".padStart(10)} ${"IGN FPS".padStart(10)}`);
    console.log("-".repeat(72));
    for (const mode of MODES) {
      const blr = blMap.get(`${scene}:${mode.name}`);
      const igr = igMap.get(`${scene}:${mode.name}`);
      if (!blr || !igr) continue;
      const d = parseFloat(igr.avgMs) - parseFloat(blr.avgMs);
      const dp = parseFloat(blr.avgMs) > 0 ? (d / parseFloat(blr.avgMs)) * 100 : 0;
      const sign = d > 0 ? "+" : "";
      console.log(
        `${mode.label.padEnd(12)} ` +
        `${blr.avgMs.padStart(10)} ` + `${igr.avgMs.padStart(10)} ` +
        `${(sign + d.toFixed(4)).padStart(10)} ` + `${(sign + dp.toFixed(1)).padStart(7)}% ` +
        `${blr.fps.padStart(10)} ` + `${igr.fps.padStart(10)}`
      );
    }
  }

  // Screenshots listing
  const sd = join(ROOT, "benchmark", "screenshots");
  console.log(`\n  SCREENSHOTS: ${sd}`);
  const files = (await (await import("node:fs/promises")).readdir(sd)).sort();
  for (const f of files) {
    const s = (await stat(join(sd, f))).size;
    console.log(`    ${f.padEnd(45)} ${(s / 1024).toFixed(1)} KB`);
  }

  // Side-by-side summary
  console.log(`\n  SIDE-BY-SIDE COMPARISONS: BASELINE | IGN`);
  console.log(`    *-sidebyside-ao.png    = AO mode comparison`);
  console.log(`    *-sidebyside-noao.png  = No AO mode comparison`);
  console.log(`    *-sidebyside-full.png  = Full/Combined mode comparison`);
}

async function main() {
  console.log("N8AO Benchmark Pipeline\n");

  // Save IGN source before potential baseline checkout
  if (!existsSync(N8AO_BACKUP)) {
    await copyFile(N8AO_TS, N8AO_BACKUP);
    console.log("Backed up IGN source.");
  }

  // Build current = IGN
  console.log("Building IGN...");
  await build();

  const { proc, port } = await startServer();
  console.log(`Server: http://localhost:${port}`);

  const screenshotDir = join(ROOT, "benchmark", "screenshots");
  await mkdir(screenshotDir, { recursive: true });

  try {
    // Run IGN branch
    console.log("\n=== IGN BRANCH ===");
    await runBranch("ign", port);

    // Bundle size for IGN
    const ignBundle = await bundleSize();
    if (ignBundle) {
      console.log(`\n  IGN bundle: ${ignBundle.total.toLocaleString()} B (${(ignBundle.total / 1024).toFixed(1)} KB)`);
    }

    // Switch to baseline
    console.log("\n=== BASELINE BRANCH ===");
    if (existsSync(BLUENOISE_JS) || !existsSync(N8AO_BACKUP)) {
      console.log("  Skipping baseline — BlueNoise.js already exists or no IGN backup.");
    } else {
      // Restore baseline from git
      execSync("git checkout HEAD -- src/N8AONode.ts src/BlueNoise.js", { cwd: ROOT, stdio: "pipe" });
      await build();

      const blBundle = await bundleSize();
      if (blBundle) {
        console.log(`  Baseline bundle: ${blBundle.total.toLocaleString()} B (${(blBundle.total / 1024).toFixed(1)} KB)`);
        const delta = ignBundle ? blBundle.total - ignBundle.total : 0;
        if (delta > 0) console.log(`  IGN saves: ${delta.toLocaleString()} B (${(delta / 1024).toFixed(1)} KB, ${((delta / blBundle.total) * 100).toFixed(1)}%)`);
      }

      console.log("  Running baseline benchmark...");
      await runBranch("baseline", port);

      // Restore IGN
      console.log("  Restoring IGN...");
      await copyFile(N8AO_BACKUP, N8AO_TS);
      if (existsSync(BLUENOISE_JS)) await rm(BLUENOISE_JS);
      await build();
      console.log("  IGN restored.");

      // Generate side-by-side comparisons BEFORE killing server
      console.log("\n=== GENERATING SIDE-BY-SIDE COMPARISONS ===");
      for (const scene of ["helmet", "interior"]) {
        console.log(`  Comparing ${scene}...`);
        for (const mode of ["ao", "noao", "full"]) {
          await generateSideBySide(screenshotDir, scene, mode, port);
        }
      }
    }
  } finally {
    proc.kill();
  }

  // Print comparison
  await printCompare();

  console.log("\nDone. Check benchmark/screenshots/ for PNGs.");
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
