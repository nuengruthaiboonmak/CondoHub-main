import { expect, test } from '@playwright/test';
import { loginAsPoolAdmin } from '../../helpers/owner';
import { readRunContext } from '../../fixtures/run-context';
import { findChatRoom } from '../chat/chatFlow';

test('room chat keeps its composer in the viewport and scrolls messages independently', async ({
  page,
}, testInfo) => {
  const { runId } = await readRunContext();
  await loginAsPoolAdmin(page, 'workspace');
  const roomId = await findChatRoom(page, `E2E-${runId}-301`);
  for (const viewport of [
    { width: 360, height: 640 },
    { width: 768, height: 800 },
    { width: 1366, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`/admin/rooms/${roomId}/chat`);
    await expect(page.getByTestId('admin-chat-title')).toHaveText('Room chat');
    await expect(page.getByTestId('admin-chat-connection')).toHaveText('Connected');
    const composer = page.getByTestId('admin-chat-composer');
    const box = await composer.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1),
    ).toBe(true);
    const text = page.getByTestId('admin-chat-composer-text');
    await expect(page.getByTestId('admin-chat-composer-send')).toBeDisabled();
    await text.fill('Draft line');
    await text.press('Shift+Enter');
    await page.keyboard.type('Second line');
    await expect(text).toHaveValue('Draft line\nSecond line');
    await expect(page.getByTestId('admin-chat-composer-send')).toBeEnabled();
    await page.screenshot({
      path: testInfo.outputPath(`chat-${viewport.width}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
});
