import type { Page } from '@playwright/test';

export async function waitForSocketEvent(
  page: Page,
  event: 'chat.message.created' | 'access.revoked',
  timeoutMs = 5_000,
): Promise<Record<string, unknown>> {
  return page.evaluate(
    ({ expected, timeout }) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${expected}.`)), timeout);
        const handler = (event_: Event): void => {
          const detail = (event_ as CustomEvent).detail as Record<string, unknown>;
          if (detail?.event === expected) {
            clearTimeout(timer);
            window.removeEventListener('condohub-socket', handler);
            resolve(detail);
          }
        };
        window.addEventListener('condohub-socket', handler);
      }),
    { expected: event, timeout: timeoutMs },
  );
}
