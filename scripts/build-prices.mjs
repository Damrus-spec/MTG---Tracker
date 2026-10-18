// Builds prices.json for MTG Tracker from Cardmarket's public daily price guide.
// The browser can't load Cardmarket's files directly (no CORS), so this runs daily in
// GitHub Actions (.github/workflows/pages.yml) and is published next to the app.
//
// Output: { updated, fields: [...], p: { "<lowercase card name>": [low, trend, avg, avg1, avg7, avg30] } }
// Per name, each field is the cheapest non-zero value across all printings (non-foil).
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = 'https://downloads.s3.cardmarket.com/productCatalog';
const FIELDS = ['low', 'trend', 'avg', 'avg1', 'avg7', 'avg30'];
const out = process.argv[2] || 'out/prices.json';

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

const [products, guide] = await Promise.all([
  getJson(`${BASE}/productList/products_singles_1.json`),
  getJson(`${BASE}/priceGuide/price_guide_1.json`),
]);

const nameById = new Map();
for (const p of products.products || []) if (p.idCategory === 1 && p.name) nameById.set(p.idProduct, p.name);

const best = new Map(); // lowercase name -> array of FIELDS
const keep = (key, g) => {
  const cur = best.get(key) || FIELDS.map(() => null);
  FIELDS.forEach((f, i) => {
    const v = g[f];
    if (typeof v === 'number' && v > 0 && (cur[i] === null || v < cur[i])) cur[i] = v;
  });
  best.set(key, cur);
};
for (const g of guide.priceGuides || []) {
  const name = nameById.get(g.idProduct);
  if (!name) continue;
  keep(name.toLowerCase(), g);
  // Decklists usually name double-faced/split cards by their front face only
  if (name.includes(' // ')) keep(name.split(' // ')[0].toLowerCase(), g);
}

const p = {};
for (const [k, v] of best) if (v.some(x => x !== null)) p[k] = v;
const count = Object.keys(p).length;
if (count < 20000) throw new Error(`only ${count} priced names — refusing to publish a broken file`);

mkdirSync(out.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
writeFileSync(out, JSON.stringify({ updated: guide.createdAt || new Date().toISOString(), fields: FIELDS, p }));
console.log(`prices.json: ${count} names, guide ${guide.createdAt}`);
