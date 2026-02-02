const fs = require('fs');
const path = require('path');

const buildInfoPath = path.join(__dirname, '..', 'artifacts', 'build-info', '99db6467c3198afdfd251808b2b7e984.json');
const outDir = path.join(__dirname, '..', 'artifacts', 'flattened');
const target = 'contracts/FlashArbitrage.sol';

if (!fs.existsSync(buildInfoPath)) {
  console.error('build-info not found:', buildInfoPath);
  process.exit(1);
}

const build = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
const sources = build.input && build.input.sources ? build.input.sources : build.input?.sources;
if (!sources) {
  console.error('No sources in build-info');
  process.exit(1);
}

// parse imports
const importRe = /^\s*import\s+[^"']+["']([^"']+)["'];/gm;
function getImports(src) {
  const res = [];
  let m;
  while ((m = importRe.exec(src)) !== null) {
    res.push(m[1]);
  }
  return res;
}

// build dependency graph nodes from sources keys
const nodes = Object.keys(sources);
const deps = {};
nodes.forEach(n => {
  deps[n] = getImports(sources[n].content || sources[n].raw || '');
});

// topological sort starting from target
const visited = new Set();
const temp = new Set();
const order = [];
function visit(n) {
  if (visited.has(n)) return;
  if (!nodes.includes(n)) return; // skip external
  if (temp.has(n)) return; // cycle
  temp.add(n);
  (deps[n] || []).forEach(d => {
    // resolve relative imports
    let key = d;
    if (!nodes.includes(key)) {
      // try relative to contracts/
      const rel = path.posix.normalize(path.posix.join(path.posix.dirname(n), d));
      if (nodes.includes(rel)) key = rel;
    }
    if (nodes.includes(key)) visit(key);
  });
  temp.delete(n);
  visited.add(n);
  order.push(n);
}

visit(target);
// include any remaining nodes that might be needed (e.g., OZ)
nodes.forEach(n => { if (!visited.has(n)) visit(n); });

// determine SPDX and pragma from target or first file
let spdx = null;
let pragma = null;
const spdxRe = /SPDX-License-Identifier:\s*(.*)/;
const pragmaRe = /pragma\s+solidity\s+([^;]+);/;

for (const pKey of order) {
  const content = sources[pKey].content || sources[pKey].raw || '';
  if (!spdx) {
    const m = content.match(spdxRe);
    if (m) spdx = m[1].trim();
  }
  if (!pragma) {
    const m = content.match(pragmaRe);
    if (m) pragma = m[1].trim();
  }
  if (spdx && pragma) break;
}

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'FlashArbitrage_flat.sol');

let out = '';
if (spdx) out += `// SPDX-License-Identifier: ${spdx}\n`;
if (pragma) out += `pragma solidity ${pragma};\n\n`;

order.forEach(k => {
  const c = sources[k].content || sources[k].raw || '';
  // remove SPDX and pragma lines and import statements
  const cleaned = c
    .split(/\r?\n/)
    .filter(line => !line.match(spdxRe) && !line.match(pragmaRe) && !line.trim().startsWith('import '))
    .join('\n');
  out += `// File: ${k}\n` + cleaned + '\n\n';
});

fs.writeFileSync(outPath, out, 'utf8');
console.log('Wrote flattened file to', outPath);
