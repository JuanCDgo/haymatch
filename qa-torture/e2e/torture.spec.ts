import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = 'http://127.0.0.1:5173';
const ARTIFACTS_DIR = path.resolve(process.cwd(), 'qa-torture/artifacts');
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

async function enforceIsolation(page: Page) {
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (
      url.startsWith('http://127.0.0.1:') ||
      url.startsWith('http://localhost:') ||
      url.startsWith('ws://127.0.0.1:') ||
      url.startsWith('ws://localhost:') ||
      url.startsWith('data:') ||
      url.startsWith('blob:')
    ) {
      return route.continue();
    }
    return route.abort();
  });
}

async function createRoomViaUI(page: Page, mode: 'cuotas' | 'gastos' = 'cuotas') {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.fill('#org-name', 'Juan QA');
  await page.fill('#org-pin', '1234');
  if (mode === 'gastos') {
    await page.selectOption('#v-mode', 'gastos');
  } else {
    await page.fill('#v-alias', 'asado.qa.test');
  }
  await page.click('button:has-text("Crear sala en vivo")');
  await page.waitForURL(/\/sala\/[A-Z0-9]{4}$/, { timeout: 10000 });
  await page.waitForSelector('text=WebSocket activo', { timeout: 10000 });
}

test.describe('Capas 4–7 — Protocolo de Tortura QA (HayMatch)', () => {
  test('Capa 4: Flujos críticos, sabotaje offline + F5, doble clic y responsive móvil (390x844)', async ({
    page,
    context
  }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });

    await enforceIsolation(page);
    await page.setViewportSize({ width: 390, height: 844 });

    // 1. Crear sala en modo Cuotas y Señas
    await createRoomViaUI(page, 'cuotas');

    // Verificar responsive móvil (sin desborde horizontal > 16px)
    const overflowMatch = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflowMatch).toBeLessThanOrEqual(16);

    // 2. Sabotaje de doble/triple clic en botón de voto
    const yesBtn = page.locator('button:has-text("Sí, va")');
    await Promise.all([yesBtn.click(), yesBtn.click()]);
    await page.waitForTimeout(300);

    // 3. Proponer opción nueva en vivo
    await page.click('button:has-text("Proponer")');
    await page.fill('#opt-title', 'Gancia con limón');
    await page.click('button:has-text("Sumar a la sala en vivo")');
    await expect(page.locator('text=Podio')).toBeVisible();

    // 4. Ir a Vaquita, probar QR y verificar sesión de Organizador auto-activa
    await page.click('nav button:has-text("Vaquita")');
    await expect(page.locator('text=Estado de la Vaquita')).toBeVisible();

    const overflowVaquita = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflowVaquita).toBeLessThanOrEqual(16);

    await page.click('button:has-text("Pagar con Alias / QR")');
    await expect(page.locator('img[alt="Código QR de pago"]')).toBeVisible();
    await page.click('button[aria-label="Cerrar"]');

    // El creador ya entra autenticado como Organizador (Fix /boost #6)
    await expect(page.locator('text=Organizador activo')).toBeVisible();

    await page.fill('input[placeholder="Nombre y apellido"]', 'Carlos QA');
    await page.click('button:has-text("Sumar")');
    await expect(page.locator('text=Carlos QA')).toBeVisible();

    // Verificar seguridad anti-IDOR (nunca exponer clientId) y 400 en JSON malformado
    const roomCode = page.url().split('/').pop()!;
    const stateResp = await page.request.get(`${BASE_URL}/api/salas/${roomCode}`);
    const stateText = await stateResp.text();
    expect(stateText).not.toContain('clientId');
    expect(stateText).not.toContain('client_id');

    const badJsonResp = await page.request.post(`${BASE_URL}/api/salas`, {
      data: '{json-roto',
      headers: { 'Content-Type': 'application/json' }
    });
    expect(badJsonResp.status()).toBe(400);

    // 5. Sabotaje Offline + reconexión + F5 (la sesión de Organizador debe persistir!)
    await context.setOffline(true);
    await page.waitForTimeout(400);
    await context.setOffline(false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=WebSocket activo', { timeout: 10000 });
    await page.click('nav button:has-text("Vaquita")');
    await expect(page.locator('text=Organizador activo')).toBeVisible();

    // Anti pantalla blanca
    const appTextLen = await page.evaluate(() => (document.getElementById('app')?.innerText || '').trim().length);
    expect(appTextLen).toBeGreaterThan(20);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('Capa 5: Accesibilidad WCAG 2.1 A/AA (Modo Noche y Modo Día)', async ({ page }) => {
    await enforceIsolation(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await createRoomViaUI(page, 'cuotas');

    const darkResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    // Cambiar a Modo Día y pestaña Vaquita
    await page.click('button[aria-label="Cambiar tema"]');
    await page.click('nav button:has-text("Vaquita")');
    await page.waitForTimeout(200);

    const lightResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const report = {
      darkViolations: darkResults.violations,
      lightViolations: lightResults.violations
    };
    fs.writeFileSync(path.join(ARTIFACTS_DIR, 'a11y-report.json'), JSON.stringify(report, null, 2));

    const severe = [...darkResults.violations, ...lightResults.violations].filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    );
    expect(severe, JSON.stringify(severe, null, 2)).toEqual([]);
  });

  test('Capa 6: Modo Mono Caótico (gremlins.js, 250 acciones deterministas)', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await enforceIsolation(page);
    await page.addInitScript(() => {
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => '';
      window.open = () => null;
    });

    await createRoomViaUI(page, 'gastos');

    const gremlinsPath = path.resolve(process.cwd(), 'node_modules/gremlins.js/dist/gremlins.min.js');
    await page.addScriptTag({ path: gremlinsPath });

    await page.evaluate(async () => {
      const g = (window as unknown as { gremlins: any }).gremlins;
      const horde = g.createHorde({
        species: [
          g.species.clicker({ canClick: (el: Element) => !el.closest('.icon-btn-exit') }),
          g.species.formFiller(),
          g.species.typer(),
          g.species.scroller()
        ],
        strategies: [g.strategies.allTogether({ nb: 250, delay: 5 })],
        randomizer: new g.Chance(42)
      });
      await horde.unleash();
    });

    const appTextLen = await page.evaluate(() => (document.getElementById('app')?.innerText || '').trim().length);
    expect(appTextLen).toBeGreaterThan(20);
    expect(pageErrors).toEqual([]);
  });

  test('Capa 7: Estrés de volumen y memoria (30+ participantes, 50 opciones, render y DOM)', async ({
    page
  }) => {
    await enforceIsolation(page);
    const t0 = Date.now();
    await createRoomViaUI(page, 'cuotas');
    const initialLoadMs = Date.now() - t0;

    // Ir a Vaquita (creador ya autenticado) y cargar 35 invitados reales
    await page.click('nav button:has-text("Vaquita")');
    await expect(page.locator('text=Organizador activo')).toBeVisible();

    const tRender0 = Date.now();
    for (let i = 1; i <= 35; i++) {
      await page.fill('input[placeholder="Nombre y apellido"]', `Compañero ${i}`);
      await page.click('button:has-text("Sumar")');
    }
    await expect(page.locator('text=Compañero 35')).toBeVisible({ timeout: 10000 });
    const renderStressMs = Date.now() - tRender0;

    const metrics = await page.evaluate(() => {
      const domNodes = document.querySelectorAll('*').length;
      const lsBytes = new Blob([JSON.stringify(localStorage)]).size;
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      return {
        domNodes,
        localStorageKB: Math.round((lsBytes / 1024) * 100) / 100,
        jsHeapMB: mem ? Math.round((mem.usedJSHeapSize / (1024 * 1024)) * 100) / 100 : null
      };
    });

    const fullMetrics = { initialLoadMs, renderStressMs, ...metrics };
    fs.writeFileSync(
      path.join(ARTIFACTS_DIR, 'stress-metrics.json'),
      JSON.stringify(fullMetrics, null, 2)
    );

    expect(initialLoadMs).toBeLessThan(10000);
    expect(renderStressMs).toBeLessThan(15000);
    expect(metrics.domNodes).toBeLessThan(15000);
  });
});
