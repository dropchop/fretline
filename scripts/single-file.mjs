// Bundles the built app (dist/) into one self-contained HTML file: dist/fretline.html.
// Inlines the JS and CSS, embeds the icon, and drops the manifest/service-worker links,
// which don't apply to a file opened from disk.
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve('dist');
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');

const readAsset = (href) => fs.readFileSync(path.join(dist, href.replace(/^\.\//, '')), 'utf8');
// A "</script>" inside the bundle would end the inline script early.
const escapeScript = (js) => js.replace(/<\/script/gi, '<\\/script');

let out = html
  .replace(
    /<script type="module"[^>]*src="([^"]+)"><\/script>/g,
    (_, src) => `<script type="module">\n${escapeScript(readAsset(src))}\n</script>`,
  )
  .replace(
    /<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,
    (_, href) => `<style>\n${readAsset(href)}\n</style>`,
  )
  .replace(/\s*<link rel="modulepreload"[^>]*>/g, '')
  .replace(/\s*<link rel="manifest"[^>]*>/g, '')
  .replace(/\s*<link rel="apple-touch-icon"[^>]*>/g, '')
  .replace(/<link rel="icon" href="icon\.svg"[^>]*>/, () => {
    const svg = fs.readFileSync(path.join(dist, 'icon.svg'), 'utf8');
    return `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(svg)}" />`;
  });

if (/src="\.\/assets|href="\.\/assets/.test(out)) throw new Error('an asset reference was not inlined');
const target = path.join(dist, 'fretline.html');
fs.writeFileSync(target, out);
console.log(`${path.relative(process.cwd(), target)}: ${(fs.statSync(target).size / 1024).toFixed(0)} kB`);
