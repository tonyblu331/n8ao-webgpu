import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(__dirname, "results");

async function main() {
  let baseline, ign;
  try {
    baseline = JSON.parse(await readFile(join(RESULTS, "baseline.json"), "utf8"));
    ign = JSON.parse(await readFile(join(RESULTS, "ign.json"), "utf8"));
  } catch {
    console.log("Need both baseline.json and ign.json in benchmark/results/");
    process.exit(1);
  }

  const blMap = Object.fromEntries(baseline.map(r => [r.scene, r]));
  const igMap = Object.fromEntries(ign.map(r => [r.scene, r]));

  console.log("\n" + "=".repeat(90));
  console.log("  N8AO BENCHMARK — BLUE NOISE vs IGN (Optimized)");
  console.log("  All scenes rendered with AO. Lower ms = better.");
  console.log("=".repeat(90));
  console.log(
    `${"Scene".padEnd(12)} ${"BlueNoise ms".padStart(13)} ${"IGN ms".padStart(13)} ` +
    `${"Delta ms".padStart(10)} ${"Delta %".padStart(8)} ` +
    `${"Blue FPS".padStart(10)} ${"IGN FPS".padStart(10)}`
  );
  console.log("-".repeat(90));

  for (const name of ["helmet", "interior", "skeleton"]) {
    const bl = blMap[name];
    const ig = igMap[name];
    if (!bl || !ig) continue;

    const blMs = parseFloat(bl.avgMs);
    const igMs = parseFloat(ig.avgMs);
    const delta = igMs - blMs;
    const deltaPct = blMs > 0 ? (delta / blMs) * 100 : 0;
    const sign = delta > 0 ? "+" : "";

    console.log(
      `${name.padEnd(12)} ` +
      `${bl.avgMs.padStart(13)} ` +
      `${ig.avgMs.padStart(13)} ` +
      `${sign + delta.toFixed(4).padStart(9)} ` +
      `${sign + deltaPct.toFixed(1).padStart(7)}% ` +
      `${bl.fps.padStart(10)} ` +
      `${ig.fps.padStart(10)}`
    );
  }
  console.log("=".repeat(90));
  console.log("  Note: CPU-side timing (performance.now). GPU may differ.");
  console.log("  WebGL2 fallback — WebGPU was not available in test env.");
}

main();
