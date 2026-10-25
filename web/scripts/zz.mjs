// CLI used by the Python server (and the Managed Agent sandbox):
//   node zz.mjs compile scene.js            -> {spec, errors}
//   node zz.mjs sim spec.json [windFrom] [seed] [mph]   -> sim result
//   node zz.mjs apply spec.json fixes.json  -> {spec, applied, rejected}
//   node zz.mjs describe spec.json          -> text
//   node zz.mjs catalog                     -> mitigation catalog
import fs from "node:fs";
import vm from "node:vm";
import { compileScene } from "../src/kit/spec.js";
import { simulate } from "../src/sim/embers.js";
import { applyFixes, describeSpec, CATALOG } from "../src/sim/mitigations.js";

const [cmd, a, b, c, d] = process.argv.slice(2);
const read = (p) => fs.readFileSync(p, "utf8");
const out = (o) => process.stdout.write(typeof o === "string" ? o : JSON.stringify(o));

if (cmd === "compile") {
  out(compileScene(read(a), (code, kit) => vm.runInNewContext(code, Object.freeze({ kit }), { timeout: 2000 })));
} else if (cmd === "sim") {
  const opts = {};
  if (b !== undefined) opts.windFrom = +b;
  if (c !== undefined) opts.seed = +c;
  if (d !== undefined) opts.mph = +d;
  out(simulate(JSON.parse(read(a)), opts));
} else if (cmd === "apply") {
  out(applyFixes(JSON.parse(read(a)), JSON.parse(read(b))));
} else if (cmd === "catalog") {
  out(CATALOG);
} else if (cmd === "describe") {
  out(describeSpec(JSON.parse(read(a))));
} else {
  console.error("usage: zz.mjs compile|sim|apply|describe ...");
  process.exit(2);
}
