# Reporte de Protocolo de Tortura QA — HayMatch

Fecha: 2026-11-26T00:53:35.616Z
Resultado global: **APROBADO (TODAS LAS CAPAS EN VERDE)**

| Capa | Prueba | Estado | Tiempo |
| :--- | :--- | :---: | :---: |
| Capa 1 | Salud estática, build y seguridad | **PASS** | 29820 ms |
| Capa 2 | Auditoría Electron | **SKIP** | 0 ms |
| Capa 3 | Fuzzing / Property-Based Testing (Vitest + fast-check) | **PASS** | 5380 ms |
| Capas 4–7 | Playwright (Sabotaje, WCAG Axe-Core, Gremlins 250 acciones, Estrés volumen) | **PASS** | 12205 ms |

## Detalles
### Capa 1 — Salud estática, build y seguridad (PASS)
```
STATIC AUDIT PASSED: svelte-check, vite build, npm audit (0 critical/high), 0 secrets.
```

### Capa 2 — Auditoría Electron (SKIP)
```
No aplica (app web/PWA sobre Cloudflare Workers, sin Electron).
```

### Capa 3 — Fuzzing / Property-Based Testing (Vitest + fast-check) (PASS)
```
[1m[30m[46m RUN [49m[39m[22m [36mv5.1.2 [39m[90mC:/Users/juanm/.gemini/antigravity/scratch/haymatch[39m

 [32m✓[39m qa-torture/fuzz/money.fuzz.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 92[2mms[22m[39m

[2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
[2m      Tests [22m [1m[32m4 passed[39m[22m[90m (4)[39m
[2m   Start at [22m 21:53:22
[2m   Duration [22m 529ms[2m (tests 45%, transform 28%, import 24%, worker 3%)[22m
```

### Capas 4–7 — Playwright (Sabotaje, WCAG Axe-Core, Gremlins 250 acciones, Estrés volumen) (PASS)
```
s:125:3 › Capas 4–7 — Protocolo de Tortura QA (HayMatch) › Capa 5: Accesibilidad WCAG 2.1 A/AA (Modo Noche y Modo Día) (1.6s)
  ok 3 qa-torture\e2e\torture.spec.ts:155:3 › Capas 4–7 — Protocolo de Tortura QA (HayMatch) › Capa 6: Modo Mono Caótico (gremlins.js, 250 acciones deterministas) (3.3s)
  ok 4 qa-torture\e2e\torture.spec.ts:192:3 › Capas 4–7 — Protocolo de Tortura QA (HayMatch) › Capa 7: Estrés de volumen y memoria (30+ participantes, 50 opciones, render y DOM) (2.6s)

  4 passed (10.6s)
```
