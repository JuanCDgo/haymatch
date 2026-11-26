import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const findings = [];

function run(cmd, label) {
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' });
    return { ok: true, label };
  } catch (err) {
    return {
      ok: false,
      label,
      detail: (err.stdout || '') + '\n' + (err.stderr || err.message)
    };
  }
}

// 1. Type check
const check = run('npm run check', 'svelte-check (TypeScript + Svelte)');
if (!check.ok) findings.push(`svelte-check falló:\n${check.detail}`);

// 2. Production build
const build = run('npm run build', 'vite build');
if (!build.ok) findings.push(`vite build falló:\n${build.detail}`);

// 3. npm audit --omit=dev
try {
  const out = execSync('npm audit --omit=dev --json', { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' });
  const parsed = JSON.parse(out);
  const meta = parsed.metadata?.vulnerabilities || {};
  if ((meta.critical || 0) > 0 || (meta.high || 0) > 0) {
    findings.push(`Vulnerabilidades en producción: critical=${meta.critical}, high=${meta.high}`);
  }
} catch (err) {
  try {
    const parsed = JSON.parse(err.stdout || '{}');
    const meta = parsed.metadata?.vulnerabilities || {};
    if ((meta.critical || 0) > 0 || (meta.high || 0) > 0) {
      findings.push(`Vulnerabilidades en producción: critical=${meta.critical}, high=${meta.high}`);
    }
  } catch {
    findings.push('No se pudo parsear npm audit --omit=dev');
  }
}

// 4. Secret scan in src/ and worker/
const SECRET_PATTERNS = [
  /AIza[0-9A-Za-z_-]{35}/g,
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /AKIA[0-9A-Z]{16}/g,
  /ghp_[0-9A-Za-z]{36}/g
];

function scanDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(full);
    } else if (/\.(ts|js|svelte|json|jsonc|html|css)$/.test(entry.name)) {
      const content = fs.readFileSync(full, 'utf8');
      for (const rx of SECRET_PATTERNS) {
        if (rx.test(content)) {
          findings.push(`Posible secreto hardcodeado en ${path.relative(ROOT, full)}`);
        }
      }
    }
  }
}

scanDir(path.join(ROOT, 'src'));
scanDir(path.join(ROOT, 'worker'));

if (findings.length > 0) {
  console.error('STATIC AUDIT FAILED:\n' + findings.join('\n'));
  process.exit(1);
}

console.log('STATIC AUDIT PASSED: svelte-check, vite build, npm audit (0 critical/high), 0 secrets.');
