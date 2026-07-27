#!/usr/bin/env node
/** Build the committed, minified browser scripts from their canonical sources. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = path.join(root, "site");
const check = process.argv.includes("--check");
const sources = [
  "statistics.js", "data-contracts.js", "data-loader.js", "router.js",
  "route-loader.js", "route-app.js", "preferences.js", "live-updates.js",
  "observability.js", "cloudflare-live.js", "url-safety.js", "app.js",
  "home-snapshot.js", "game-centre.js", "player-comparison.js",
  "routes/night.js", "routes/season.js", "routes/people.js", "routes/explore.js",
];
const stylesheets = ["core-routes.css", "full-routes.css"];

let stale = false;
for (const source of sources) {
  const input = path.join(site, source);
  const output = path.join(site, source.replace(/\.js$/, ".min.js"));
  const result = await build({
    entryPoints: [input],
    bundle: true,
    format: "iife",
    target: ["es2020"],
    minify: true,
    legalComments: "none",
    write: false,
    outfile: output,
    logLevel: "silent",
  });
  const generated = result.outputFiles[0].contents;
  if (check) {
    const committed = fs.existsSync(output) ? fs.readFileSync(output) : null;
    if (!committed || !committed.equals(generated)) {
      console.error(`Stale optimized asset: ${path.relative(root, output)}`);
      stale = true;
    }
  } else {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, generated);
    console.log(`${path.relative(root, output)}=${generated.byteLength} bytes`);
  }
}

for (const source of stylesheets) {
  const input = path.join(site, source);
  const output = path.join(site, source.replace(/\.css$/, ".min.css"));
  const result = await build({
    entryPoints: [input],
    bundle: true,
    target: ["safari15"],
    minify: true,
    legalComments: "none",
    write: false,
    outfile: output,
    logLevel: "silent",
  });
  const generated = result.outputFiles[0].contents;
  if (check) {
    const committed = fs.existsSync(output) ? fs.readFileSync(output) : null;
    if (!committed || !committed.equals(generated)) {
      console.error(`Stale optimized asset: ${path.relative(root, output)}`);
      stale = true;
    }
  } else {
    fs.writeFileSync(output, generated);
    console.log(`${path.relative(root, output)}=${generated.byteLength} bytes`);
  }
}

if (stale) {
  console.error("Run pnpm build:assets and commit the generated assets.");
  process.exitCode = 1;
}
