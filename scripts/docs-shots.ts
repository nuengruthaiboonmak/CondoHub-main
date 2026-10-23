import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from '@playwright/test';

const BASE = process.env.DOCS_BASE_URL ?? 'http://localhost:3000';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'images');

interface DocsAccount {
  username: string;
  password: string;
}

function readAccount(prefix: string): DocsAccount {
  const username = process.env[`${prefix}_USER`];
  const password = process.env[`${prefix}_PASS`];
  if (!username || !password) throw new Error(`Missing ${prefix}_USER/${prefix}_PASS env vars.`);
  return { username, password };
}

async function login(
  page: import('@playwright/test').Page,
  account: DocsAccount,
  returnUrl: string,
): Promise<void> {
  await page.goto(`${BASE}/login?returnUrl=${encodeURIComponent(returnUrl)}`, {
    waitUntil: 'networkidle',
  });
  await page.getByTestId('login-form').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.getByTestId('login-username').fill(account.username);
  await page.getByTestId('login-password').fill(account.password);
  await page.getByTestId('login-submit').click({ noWaitAfter: true });
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 });
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const tenant = readAccount('DOCS_TENANT');
  const owner = readAccount('DOCS_OWNER');
  const admin = readAccount('DOCS_ADMIN');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByTestId('login-form').waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, 'login.png') });
  console.log('captured login.png');

  await login(page, tenant, '/');
  await page.getByTestId('home-page').waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, 'home-dashboard.png') });
  console.log('captured home-dashboard.png');

  await page.goto(`${BASE}/rooms`, { waitUntil: 'networkidle' });
  await page.getByTestId('my-rooms-page').waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, 'rooms-list.png') });
  console.log('captured rooms-list.png');
  await page.getByText('A-701').first().click();
  await page.getByTestId('room-detail-page').waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, 'room-detail.png'), fullPage: true });
  console.log('captured room-detail.png');

  await page.goto(`${BASE}/facilities?query=Sky`, { waitUntil: 'networkidle' });
  await page.getByTestId('facilities-page').waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, 'facilities-list.png') });
  console.log('captured facilities-list.png');
  await page.getByText('Sky Pool').first().click();
  await page.getByTestId('facility-detail-page').waitFor({ timeout: 15000 });
  await page
    .getByTestId('slot-picker-loading')
    .waitFor({ state: 'detached', timeout: 15000 })
    .catch(() => undefined);
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, 'facility-detail.png'), fullPage: true });
  console.log('captured facility-detail.png');

  await page.goto(`${BASE}/invoices`, { waitUntil: 'networkidle' });
  await page.getByTestId('invoice-list-page').waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, 'invoices-list.png') });
  console.log('captured invoices-list.png');
  const firstInvoice = page.locator('[data-testid^="invoice-row-"]').first();
  if ((await firstInvoice.count()) > 0) {
    await firstInvoice.click();
    await page.getByTestId('invoice-detail-page').waitFor({ timeout: 15000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, 'invoice-detail.png'), fullPage: true });
    console.log('captured invoice-detail.png');
  }

  await page.goto(`${BASE}/maintenance`, { waitUntil: 'networkidle' });
  await page.getByTestId('maintenance-page').waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, 'maintenance-list.png') });
  console.log('captured maintenance-list.png');
  await page.getByText('Lobby ceiling light flickers at night').first().click();
  await page.getByTestId('maintenance-detail-page').waitFor({ timeout: 15000 });
  const ticketId = page.url().split('/maintenance/')[1]?.split('?')[0];

  await page.goto(`${BASE}/announcements`, { waitUntil: 'networkidle' });
  await page.getByTestId('announcements-page').waitFor({ timeout: 15000 });
  await page.getByText('Elevator maintenance Saturday').first().click();
  await page.getByTestId('announcement-detail-page').waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, 'announcement-detail.png'), fullPage: true });
  console.log('captured announcement-detail.png');

  await login(page, owner, '/rooms');
  await page.getByTestId('my-rooms-page').waitFor({ timeout: 15000 });
  await page.getByText('A-701').first().click();
  await page.getByTestId('room-detail-page').waitFor({ timeout: 15000 });
  await page.getByTestId('room-rental-link').click();
  await page.getByTestId('room-rental-page').waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, 'room-rental.png'), fullPage: true });
  console.log('captured room-rental.png');

  await login(page, admin, '/admin/buildings?query=Sathorn');
  await page.getByTestId('admin-buildings-page').waitFor({ timeout: 15000 });
  await page.getByText('Sathorn Green Residence Tower A').first().click();
  await page.getByTestId('admin-building-detail-page').waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, 'admin-building-detail.png'), fullPage: true });
  console.log('captured admin-building-detail.png');

  await page.goto(`${BASE}/admin/billing/invoices`, { waitUntil: 'networkidle' });
  await page.getByTestId('admin-invoice-list-page').waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, 'admin-billing-invoices.png') });
  console.log('captured admin-billing-invoices.png');

  if (ticketId !== undefined && ticketId !== '') {
    await page.goto(`${BASE}/admin/maintenance/${ticketId}`, { waitUntil: 'networkidle' });
    await page.getByTestId('admin-maintenance-detail-page').waitFor({ timeout: 15000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, 'admin-ticket-detail.png'), fullPage: true });
    console.log('captured admin-ticket-detail.png');
  }

  await browser.close();
}

void main();
