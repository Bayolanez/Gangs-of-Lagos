#!/usr/bin/env node
/**
 * Packages dist/ for simple static hosts that only serve web file types (for example a claude.ai
 * Artifact): the page with its CSS and JS inlined, plus data/ and areas/, with each tile's .glb mesh
 * wrapped as base64 in a .json file (the game loads either form).
 *
 *   npm run build && node tools/web-bundle.mjs <out-dir>
 *
 * Writes <out-dir>/gangs-of-lagos.html (page body only, no <html>/<head>, for hosts that add their own
 * skeleton) and the supporting files next to it. dist/test-areas is left out.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2];
if (!out) {
  console.error('Usage: node tools/web-bundle.mjs <out-dir>');
  process.exit(2);
}
const dist = 'dist';
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const asset = (ext) => readdirSync(join(dist, 'assets')).find((f) => f.endsWith(ext));
const js = readFileSync(join(dist, 'assets', asset('.js')), 'utf8').replaceAll('</script', '<\\/script');
const css = readFileSync(join(dist, 'assets', asset('.css')), 'utf8');
const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/)?.[0] ?? '';

if (existsSync(out)) rmSync(out, { recursive: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'gangs-of-lagos.html'), `<meta charset="utf-8">
<title>Gangs of Lagos</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${fonts}
<style>
:root { color-scheme: dark; }
html, body { background: #121310; }
${css}
</style>
${body}
<script type="module">
${js}
</script>
`);
cpSync(join(dist, 'data'), join(out, 'data'), { recursive: true });
// Recorded sounds and licensed music listed in data/sounds.json and data/radio.json (if any).
if (existsSync(join(dist, 'audio'))) cpSync(join(dist, 'audio'), join(out, 'audio'), { recursive: true });

let tiles = 0;
if (existsSync(join(dist, 'areas'))) {
  cpSync(join(dist, 'areas'), join(out, 'areas'), { recursive: true });
  for (const area of readdirSync(join(out, 'areas'))) {
    const dir = join(out, 'areas', area);
    if (!statSync(dir).isDirectory()) continue;
    const mPath = join(dir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(mPath, 'utf8'));
    for (const t of manifest.tiles) {
      const glbPath = join(dir, t.glb);
      const wrapped = t.glb.replace(/\.glb$/, '.glb.json');
      writeFileSync(join(dir, wrapped), JSON.stringify({ glb: readFileSync(glbPath).toString('base64') }));
      rmSync(glbPath);
      t.glb = wrapped;
      tiles++;
    }
    writeFileSync(mPath, JSON.stringify(manifest, null, 2));
  }
}
console.log(`bundled into ${out}: page + data + ${tiles} tile meshes as JSON`);
