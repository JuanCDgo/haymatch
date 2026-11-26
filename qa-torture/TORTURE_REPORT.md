# Reporte de Protocolo de Tortura QA — HayMatch

Fecha: 2026-11-26T00:35:13.385Z
Resultado global: **APROBADO (TODAS LAS CAPAS EN VERDE)**

| Capa | Prueba | Estado | Tiempo |
| :--- | :--- | :---: | :---: |
| Capa 1 | Salud estática, build y seguridad | **PASS** | 20356 ms |
| Capa 2 | Auditoría Electron | **SKIP** | 0 ms |
| Capa 3 | Fuzzing / Property-Based Testing (Vitest + fast-check) | **PASS** | 4353 ms |
| Capas 4–7 | Playwright (Sabotaje, WCAG Axe-Core, Gremlins 250 acciones, Estrés volumen) | **PASS** | 11364 ms |

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

 [32m✓[39m qa-torture/fuzz/money.fuzz.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 84[2mms[22m[39m

[2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
[2m      Tests [22m [1m[32m4 passed[39m[22m[90m (4)[39m
[2m   Start at [22m 21:35:01
[2m   Duration [22m 306ms[2m (tests 51%, import 24%, transform 22%, worker 3%)[22m
```

### Capas 4–7 — Playwright (Sabotaje, WCAG Axe-Core, Gremlins 250 acciones, Estrés volumen) (PASS)
```
ts:113:3 › Capas 4–7 — Protocolo de Tortura QA (HayMatch) › Capa 5: Accesibilidad WCAG 2.1 A/AA (Modo Noche y Modo Día) (1.5s)
  ok 3 qa-torture\e2e\torture.spec.ts:143:3 › Capas 4–7 — Protocolo de Tortura QA (HayMatch) › Capa 6: Modo Mono Caótico (gremlins.js, 250 acciones deterministas) (3.1s)
  ok 4 qa-torture\e2e\torture.spec.ts:180:3 › Capas 4–7 — Protocolo de Tortura QA (HayMatch) › Capa 7: Estrés de volumen y memoria (30+ participantes, 50 opciones, render y DOM) (2.5s)

  4 passed (9.9s)
```
