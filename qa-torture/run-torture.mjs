import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const results = [];

function runStep(layer, name, cmd) {
  console.log(`\n=== ${layer}: ${name} ===`);
  const start = Date.now();
  try {
    const out = execSync(cmd, { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' });
    const ms = Date.now() - start;
    console.log(`PASS (${ms}ms)`);
    results.push({ layer, name, status: 'PASS', ms, detail: out.trim().slice(-500) });
  } catch (err) {
    const ms = Date.now() - start;
    const detail = ((err.stdout || '') + '\n' + (err.stderr || err.message || '')).trim();
    console.error(`FAIL (${ms}ms)\n${detail.slice(-800)}`);
    results.push({ layer, name, status: 'FAIL', ms, detail: detail.slice(-1500) });
  }
}

runStep('Capa 1', 'Salud estática, build y seguridad', 'node qa-torture/checks/static-audit.mjs');
results.push({
  layer: 'Capa 2',
  name: 'Auditoría Electron',
  status: 'SKIP',
  ms: 0,
  detail: 'No aplica (app web/PWA sobre Cloudflare Workers, sin Electron).'
});
runStep('Capa 3', 'Fuzzing / Property-Based Testing (Vitest + fast-check)', 'npx vitest run qa-torture/fuzz');
runStep(
  'Capas 4–7',
  'Playwright (Sabotaje, WCAG Axe-Core, Gremlins 250 acciones, Estrés volumen)',
  'npx playwright test qa-torture/e2e/torture.spec.ts --reporter=list'
);

const failed = results.filter((r) => r.status === 'FAIL');
const lines = [
  '# Reporte de Protocolo de Tortura QA — HayMatch',
  '',
  `Fecha: ${new Date().toISOString()}`,
  `Resultado global: **${failed.length === 0 ? 'APROBADO (TODAS LAS CAPAS EN VERDE)' : `FALLÓ (${failed.length} capa/s)`}**`,
  '',
  '| Capa | Prueba | Estado | Tiempo |',
  '| :--- | :--- | :---: | :---: |',
  ...results.map((r) => `| ${r.layer} | ${r.name} | **${r.status}** | ${r.ms} ms |`),
  '',
  '## Detalles',
  ...results.flatMap((r) => [`### ${r.layer} — ${r.name} (${r.status})`, '```', r.detail || 'OK', '```', ''])
];

fs.writeFileSync(path.join(ROOT, 'qa-torture/TORTURE_REPORT.md'), lines.join('\n'), 'utf8');
console.log('\nReporte guardado en qa-torture/TORTURE_REPORT.md');

if (failed.length > 0) {
  process.exit(1);
}
