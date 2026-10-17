import { LEVELS } from '../www/js/levels.js';
import { generateMap, bfs, FLOOR } from '../www/js/mapgen.js';
let fail = 0;
for (let li = 0; li < LEVELS.length; li++) {
  const lv = LEVELS[li];
  let stats = [];
  for (let s = 1; s <= 12; s++) {
    const t = performance.now();
    const m = generateMap(lv, s * 7919 + li);
    const ms = performance.now() - t;
    const d = bfs(m.grid, m.W, m.H, m.spawn.x, m.spawn.y);
    let unreachable = 0;
    for (let i = 0; i < m.W * m.H; i++) if (m.grid[i] === FLOOR && d[i] < 0) unreachable++;
    const ed = d[m.exit.y * m.W + m.exit.x];
    if (unreachable || ed < 10 || m.floors.length < 150) { fail++; console.log('FAIL', lv.name, s, { unreachable, ed, floors: m.floors.length }); }
    stats.push([m.floors.length, ed, m.lights.length, ms]);
  }
  const avg = (k) => (stats.reduce((a, b) => a + b[k], 0) / stats.length).toFixed(0);
  console.log(`${lv.name.padEnd(9)} ${lv.gen.padEnd(9)} floors=${avg(0)} exitDist=${avg(1)} lights=${avg(2)} ms=${avg(3)}`);
}
// determinism
const a = generateMap(LEVELS[3], 42), b = generateMap(LEVELS[3], 42);
if (a.grid.join() !== b.grid.join()) { fail++; console.log('FAIL determinism'); }
console.log(fail ? `${fail} failures` : 'ALL MAPGEN OK');
process.exit(fail ? 1 : 0);
