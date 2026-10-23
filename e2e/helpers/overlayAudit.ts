import { expect, type Page, type TestInfo } from '@playwright/test';

export async function installOverlayAudit(page: Page, testInfo: TestInfo, prefix: string) {
  const seen = new Set<string>();
  await page.addLocatorHandler(
    page.locator('dialog[open]:not([aria-busy="true"])').last(),
    async (dialog) => {
      const { id, title, form, preview } = await dialog.evaluate((element) => ({
        id: element.getAttribute('data-testid') ?? 'dialog',
        title: element.querySelector('h2')?.textContent ?? '',
        form: element.querySelector('form')?.getAttribute('data-testid') ?? null,
        preview: element.querySelector('[data-testid="config-change-preview-result"]') ? 1 : 0,
      }));
      const key = `${id}:${title}:${form ?? 'content'}:${preview}`;
      if (seen.has(key)) return;
      seen.add(key);
      const original = page.viewportSize();
      await dialog.evaluate((element) => {
        for (const animation of element.getAnimations()) {
          if (animation.effect?.getComputedTiming().iterations !== Infinity) animation.finish();
        }
      });
      try {
        for (const width of [360, 768, 1366]) {
          await page.setViewportSize({ width, height: 900 });
          const metrics = await dialog.evaluate((element) => {
            const box = element.getBoundingClientRect();
            const body = element.querySelector('[data-ui-dialog-body]');
            return {
              x: box.x,
              y: box.y,
              right: box.right,
              bottom: box.bottom,
              horizontalOverflow: !!body && body.scrollWidth > body.clientWidth + 1,
              controlsWithMissingIcons: Array.from(element.querySelectorAll('select')).filter(
                (select) =>
                  select.closest('[data-ui-select]')?.querySelectorAll('svg').length !== 2,
              ).length,
            };
          });
          expect(metrics, `${prefix}: ${key} at ${width}`).toMatchObject({
            horizontalOverflow: false,
            controlsWithMissingIcons: 0,
          });
          expect(metrics.x).toBeGreaterThanOrEqual(0);
          expect(metrics.y).toBeGreaterThanOrEqual(0);
          expect(metrics.right).toBeLessThanOrEqual(width + 1);
          expect(metrics.bottom).toBeLessThanOrEqual(901);
          if ((await dialog.getByTestId('tenant-account-result').count()) === 0)
            await page.screenshot({
              path: testInfo.outputPath(
                `${prefix}-${id}-${form ?? 'content'}${preview ? '-preview' : ''}-${width}.png`,
              ),
              animations: 'disabled',
            });
        }
      } finally {
        if (original) await page.setViewportSize(original);
      }
    },
    { noWaitAfter: true },
  );
}
