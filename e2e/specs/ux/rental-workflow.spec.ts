import { installOverlayAudit } from '../../helpers/overlayAudit';
import { randomUUID } from 'node:crypto';
import { expect as baseExpect, test } from '../../helpers/projectPaymentTest';
const expect = baseExpect.configure({ timeout: 30000 });
import { loginAsPoolAdmin, completeFirstLogin, provisionUser } from '../../helpers/owner';
import { readRunContext } from '../../fixtures/run-context';
import { apiJson } from '../../helpers/api';
import { buildValidImage } from '../../helpers/announcementFiles';

test('project and private rentals complete tenant setup, rent payment, maintenance and move-out through UI', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(480000);
  await loginAsPoolAdmin(page, 'workspace');
  await installOverlayAudit(page, testInfo, 'admin');
  const { runId } = await readRunContext();
  const suffix = runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const month = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
  const nextDate = new Date(`${month}-15T12:00:00Z`);
  nextDate.setUTCMonth(nextDate.getUTCMonth() + 1);
  const next = nextDate.toISOString().slice(0, 7);
  const building = await apiJson<{ data: { id: string } }>(page.request, {
    method: 'POST',
    path: '/api/admin/buildings',
    body: { projectId: randomUUID(), name: `E2E-${runId}-RentalWorkflow`, status: 'ACTIVE' },
  });
  expect(building.status).toBe(200);
  const floor = await apiJson<{ data: { id: string } }>(page.request, {
    method: 'POST',
    path: '/api/admin/floors',
    body: { buildingId: building.json.data.id, label: 'Rental floor' },
  });
  expect(floor.status).toBe(200);
  async function makeRoom(label: string) {
    const created = await apiJson<{ data: { id: string } }>(page.request, {
      method: 'POST',
      path: '/api/admin/rooms',
      body: {
        buildingId: building.json.data.id,
        floorId: floor.json.data.id,
        name: `E2E-${runId}-${label}`,
        areaSqm: '40',
        status: 'ACTIVE',
      },
    });
    expect(created.status).toBe(200);
    return created.json.data.id;
  }
  const project = await makeRoom('ProjectRental');
  const privateRoom = await makeRoom('PrivateRental');
  const ownerName = `e2e${suffix}rentowner`.slice(0, 30);
  const owner = await provisionUser(page, {
    username: ownerName,
    name: `E2E-${runId}-RentalOwner`,
  });
  expect(
    (
      await apiJson(page.request, {
        method: 'POST',
        path: `/api/admin/rooms/${privateRoom}/owners`,
        body: { username: ownerName },
      })
    ).status,
  ).toBe(200);
  const existingName = `e2e${suffix}existingtenant`.slice(0, 30);
  const existing = await provisionUser(page, {
    username: existingName,
    name: 'Existing rental tenant',
  });
  const ownerContext = await browser.newContext({ baseURL: 'http://localhost:3000' });
  const ownerPage = await ownerContext.newPage();
  await installOverlayAudit(ownerPage, testInfo, 'owner');
  const tenantContexts = [];
  try {
    await completeFirstLogin(ownerPage, {
      username: ownerName,
      tempPassword: owner.tempPassword,
      newPassword: `Rental-${suffix}-owner-pw1`,
    });
    await page.goto('/admin/billing/settings');
    await page.getByTestId('payment-settings-bank').fill('Rental Project Bank');
    await page.getByTestId('payment-settings-name').fill('Project rental account');
    await page.getByTestId('payment-settings-number').fill('555-000-1111');
    await page.getByTestId('payment-settings-save').click();
    await expect(page.getByText('Payment details saved.', { exact: true })).toBeVisible();
    for (const [manager, roomId, label, amount, bank] of [
      [page, project, 'Project', '5000', '555-000-1111'],
      [ownerPage, privateRoom, 'Private', '8000', '222-333-4444'],
    ] as const) {
      await manager.goto(`/rooms/${roomId}`);
      await expect(manager.getByTestId('room-tenancy-create-open')).toHaveCount(0);
      await expect(manager.getByRole('region', { name: 'Tenancies', exact: true })).toHaveCount(0);
      await manager.getByTestId('room-rental-link').click();
      await expect(manager.getByTestId('room-rental-page')).toBeVisible();
      await manager.getByTestId('room-tenancy-create-open').click();
      await manager.getByTestId('room-tenancy-create-start').fill(`${month}-01`);
      if (label === 'Project')
        await manager.getByTestId('room-tenancy-create-mode').selectOption('PROJECT_MANAGED');
      await manager.getByTestId('room-tenancy-create-submit').click();
      await expect(manager.getByTestId('tenancy-create-dialog')).not.toBeVisible();
      await expect(manager.getByTestId('rental-setup-status')).toContainText('Add a tenant');
      await expect(manager.getByTestId('rent-settings-form')).toHaveCount(0);
      if (label === 'Private') {
        await expect(
          manager.getByRole('link', { name: 'Open room chat', exact: true }),
        ).toHaveCount(0);
        expect((await manager.request.get(`/api/rooms/${roomId}/messages?limit=10`)).status()).toBe(
          404,
        );
        await manager.goto('/rooms');
        await expect(manager.getByTestId('my-rooms-list')).toContainText(
          `E2E-${runId}-PrivateRental`,
        );
        await manager.goto(`/rooms/${roomId}/rental`);
      }
      const tenancyId = (await manager
        .getByTestId('room-rental-page')
        .getAttribute('data-tenancy-id'))!;
      const username = `e2e${suffix}rt${label.toLowerCase()}`.slice(0, 30);
      if (label === 'Private') {
        await manager.goto(`/rooms/${roomId}`);
        await manager.getByTestId('ownership-assign-open').click();
        await manager.getByTestId('ownership-assign-dialog-close').click();
        await manager.getByTestId('room-rental-link').click();
      }
      await manager.getByTestId('rental-tenant-add-open').click();
      await manager.getByTestId('tenant-account-option').click();
      await manager.getByTestId('tenant-account-username').fill(username);
      await manager.getByTestId('tenant-account-name').fill(`E2E ${label} Tenant`);
      await manager.getByTestId('tenant-account-email').fill(`${username}@example.test`);
      await manager.getByTestId('tenant-account-submit').click();
      await expect(manager.getByTestId('tenant-account-result')).toBeVisible();
      const password = await manager.getByTestId('tenant-account-password').inputValue();
      await manager.getByTestId('tenant-account-done').click();
      await expect(manager.getByTestId('rental-tenants')).toContainText(`E2E ${label} Tenant`);
      if (label === 'Project') {
        await manager.getByTestId('rental-tenant-add-open').click();
        await manager.getByTestId('tenant-existing-option').click();
        await expect(manager.getByRole('combobox', { name: 'Tenancy', exact: true })).toHaveCount(
          0,
        );
        await manager.getByTestId('room-member-add-username').fill(existingName);
        await manager.getByTestId('room-member-add-role').selectOption('MAIN');
        await manager.getByTestId('room-member-add-submit').click();
        await expect(manager.getByTestId('rental-tenants')).toContainText('Existing rental tenant');
        const mainContext = await browser.newContext({ baseURL: 'http://localhost:3000' });
        tenantContexts.push(mainContext);
        const mainTenant = await mainContext.newPage();
        await completeFirstLogin(mainTenant, {
          username: existingName,
          tempPassword: existing.tempPassword,
          newPassword: `Rental-${suffix}-main-pw1`,
        });
        await mainTenant.goto(`/rooms/${roomId}/rental`);
        await expect(mainTenant.getByTestId('rental-tenant-add-open')).toBeVisible();
        await mainTenant.getByTestId('rental-nav-payments').click();
        await expect(mainTenant.getByTestId('rent-settings-open')).toHaveCount(0);
        await expect(mainTenant.getByTestId('rent-invoice-open')).toHaveCount(0);
      }
      await manager.getByTestId('rental-nav-payments').focus();
      await manager.keyboard.press('Enter');
      await expect(manager.getByTestId('rental-nav-payments')).toHaveAttribute(
        'aria-current',
        'page',
      );
      await manager.goBack();
      await expect(manager.getByTestId('rental-tenants')).toBeVisible();
      await manager.getByTestId('rental-nav-payments').click();
      await expect(manager.getByTestId('rental-tenants')).toHaveCount(0);
      await manager.getByTestId('rent-settings-open').click();
      await expect(manager.getByTestId('rent-settings-dialog')).toBeVisible();
      await manager.getByTestId('rent-settings-dialog-close').click();
      await expect(manager.getByTestId('rent-settings-open')).toBeFocused();
      await manager.getByTestId('rent-settings-open').click();
      await manager.getByTestId('rent-settings-amount').fill(amount);
      await manager.getByTestId('rent-settings-month').fill(month);
      await manager.getByTestId('rent-settings-save').click();
      await expect(manager.getByText('Monthly rent saved.', { exact: true })).toBeVisible();
      if (label === 'Private') {
        await manager.getByTestId('rental-payment-settings').click();
        await manager.getByTestId('payment-settings-bank').fill('Private Rental Bank');
        await manager.getByTestId('payment-settings-name').fill('Private owner account');
        await manager.getByTestId('payment-settings-number').fill(bank);
        await manager.getByTestId('payment-settings-save').click();
        await expect(manager.getByText('Payment details saved.', { exact: true })).toBeVisible();
        await manager.goto(`/rooms/${roomId}/rental`);
      }
      await expect(manager.getByTestId('rental-setup-status')).toContainText(
        'Rental setup complete',
      );
      await manager.getByTestId('rental-nav-payments').click();
      await manager.getByTestId('rent-invoice-open').click();
      await manager.getByTestId('rent-invoice-create').click();
      await expect(manager).toHaveURL(/\/invoices\/[0-9a-f-]+$/);
      const invoiceId = manager.url().split('/').at(-1)!;
      await expect(manager.getByTestId('invoice-detail-total')).toContainText(`${amount}.00 THB`);
      await expect(manager.getByTestId('invoice-payment-account-number')).toHaveText(bank);
      await manager.goto(`/rooms/${roomId}/rental`);
      await manager.getByTestId('rental-nav-payments').click();
      await manager.getByTestId('rent-settings-open').click();
      await manager.getByTestId('rent-settings-amount').fill(`${Number(amount) + 500}`);
      await manager.getByTestId('rent-settings-save').click();
      await expect(manager.getByText('Monthly rent saved.', { exact: true })).toBeVisible();
      await manager.getByTestId('rental-nav-payments').click();
      await manager.getByTestId('rent-invoice-open').click();
      await manager.getByTestId('rent-invoice-create').click();
      await expect(manager).toHaveURL(new RegExp(`${invoiceId}$`));
      await expect(manager.getByTestId('invoice-detail-total')).toContainText(`${amount}.00 THB`);
      await manager.goto(`/rooms/${roomId}/rental`);
      await manager.getByTestId('rental-nav-payments').click();
      await manager.getByTestId('rent-invoice-open').click();
      await manager.getByTestId('rent-invoice-month').fill(next);
      await manager.getByTestId('rent-invoice-create').click();
      await expect(manager.getByTestId('invoice-detail-total')).toContainText(
        `${Number(amount) + 500}.00 THB`,
      );
      const context = await browser.newContext({ baseURL: 'http://localhost:3000' });
      tenantContexts.push(context);
      const tenant = await context.newPage();
      await installOverlayAudit(tenant, testInfo, `tenant-${label}`);
      await completeFirstLogin(tenant, {
        username,
        tempPassword: password,
        newPassword: `Rental-${suffix}-${label}-pw1`,
      });
      if (label === 'Private') {
        await ownerPage.goto('/');
        await expect(ownerPage.getByTestId('home-hero')).toHaveCount(0);
        await expect(ownerPage.getByTestId('home-rent-collection')).toContainText(
          'Rent to collect',
        );
        await ownerPage.getByTestId('home-rent-collection-all').click();
        await expect(ownerPage.getByTestId(`invoice-row-${invoiceId}`)).toBeVisible();
        await ownerPage.getByTestId(`invoice-row-${invoiceId}`).click();
        await expect(
          ownerPage.getByRole('region', { name: 'Receiving account', exact: true }),
        ).toBeVisible();
        await ownerPage.getByTestId('invoice-detail-back').click();
        await expect(ownerPage.getByTestId('invoice-view-receivable')).toHaveAttribute(
          'aria-current',
          'page',
        );
        await ownerPage.getByTestId('invoice-view-payable').click();
        await expect(ownerPage.getByTestId(`invoice-row-${invoiceId}`)).toHaveCount(0);
        await expect(ownerPage.getByTestId('invoice-list-empty')).toBeVisible();
        await tenant.goto('/');
        await expect(tenant.getByTestId('home-hero')).toBeVisible();
        await expect(tenant.getByTestId('home-rent-collection')).toHaveCount(0);
        await tenant.goto('/invoices');
        await expect(tenant.getByTestId(`invoice-row-${invoiceId}`)).toBeVisible();
        await tenant.goto('/invoices?view=receivable');
        await expect(tenant.getByTestId('invoice-list-empty')).toBeVisible();
        await expect(tenant.getByTestId(`invoice-row-${invoiceId}`)).toHaveCount(0);
      }
      await tenant.goto(`/rooms/${roomId}/rental`);
      await expect(tenant.getByTestId('rent-settings-form')).toHaveCount(0);
      await expect(tenant.getByTestId('rental-tenant-add-open')).toHaveCount(0);
      await tenant.getByTestId('rental-nav-payments').click();
      await expect(tenant.getByTestId(`invoice-state-${invoiceId}`)).toBeVisible();
      await tenant.goto(`/invoices/${invoiceId}`);
      await expect(tenant.getByTestId('invoice-edit-open')).toHaveCount(0);
      await tenant.getByTestId('payment-submit-open').click();
      const image = await buildValidImage('png', 32);
      await tenant
        .getByTestId('payment-submit-upload-input')
        .setInputFiles({ name: 'rent-slip.png', mimeType: 'image/png', buffer: image.bytes });
      await expect(tenant.getByTestId('payment-submit-slip-ready')).toBeVisible({ timeout: 30000 });
      await tenant.getByTestId('payment-submit-button').click();
      await expect(tenant.getByTestId('invoice-payment-pending-count')).toHaveText('1');
      await manager.goto(
        `${label === 'Project' ? '/admin/billing/invoices' : '/invoices'}/${invoiceId}`,
      );
      const first = manager
        .getByTestId('invoice-payment-submissions')
        .locator(':scope > li')
        .first();
      const submission = (await first.getAttribute('data-testid'))!.replace(
        'payment-submission-',
        '',
      );
      await manager.getByTestId(`payment-reject-toggle-${submission}`).click();
      await manager.getByTestId(`payment-reject-toggle-${submission}-close`).click();
      await manager.getByTestId(`payment-approve-toggle-${submission}`).click();
      await manager.getByTestId(`payment-approve-amount-${submission}`).fill(`${amount}.00`);
      await manager.getByTestId(`payment-approve-submit-${submission}`).click();
      await expect(manager.getByTestId('invoice-payment-state')).toHaveText('Paid');
      await tenant.goto(`/rooms/${roomId}/rental`);
      await tenant.getByTestId('rental-nav-maintenance').click();
      await tenant.getByTestId('rental-maintenance-open').click();
      await expect(tenant.getByTestId('maintenance-create-room')).toHaveValue(roomId);
      await tenant.getByTestId('maintenance-create-location').fill('Bathroom');
      await tenant.getByTestId('maintenance-create-subject').fill(`${label} rental leak`);
      await tenant
        .getByTestId('maintenance-create-description')
        .fill('Water leaks from the tap. Please repair it.');
      const repairPhoto = await buildValidImage('png', 32);
      await tenant.getByTestId('maintenance-create-upload-input').setInputFiles({
        name: 'repair-photo.png',
        mimeType: 'image/png',
        buffer: repairPhoto.bytes,
      });
      await expect(tenant.getByTestId('maintenance-create-image-list')).toBeVisible({
        timeout: 30000,
      });
      await tenant.getByTestId('maintenance-create-submit').click();
      await expect(tenant).toHaveURL(/\/maintenance\/[0-9a-f-]+$/);
      const ticketId = tenant.url().split('/').at(-1)!;
      await tenant.getByTestId('maintenance-detail-transition-open').click();
      await tenant.getByTestId('maintenance-detail-transition-dialog-close').click();
      await tenant
        .getByRole('button', { name: 'Enlarge Report photo 1', exact: true })
        .first()
        .click();
      await tenant
        .locator('dialog[open]')
        .getByRole('button', { name: 'Close dialog', exact: true })
        .click();
      if (label === 'Private') {
        expect((await page.request.get(`/api/invoices/${invoiceId}`)).status()).toBe(404);
        expect((await page.request.get(`/api/maintenance/${ticketId}`)).status()).toBe(404);
      }
      await manager.goto(`/rooms/${roomId}/rental`);
      await manager.getByTestId('rental-nav-maintenance').click();
      await expect(manager.getByTestId('rental-maintenance-list')).not.toContainText('Common area');
      await expect(manager.getByTestId('rental-maintenance-list')).toContainText(
        `${label} rental leak`,
      );
      await manager.getByTestId(`rental-maintenance-link-${ticketId}`).click();
      const prefix = label === 'Project' ? 'admin-maintenance-detail' : 'maintenance-detail';
      await manager.getByTestId(`${prefix}-transition-open`).click();
      await manager.getByTestId(`${prefix}-transition-status`).selectOption('COMPLETED');
      await manager.getByTestId(`${prefix}-transition-submit`).click();
      await expect(manager.getByTestId(`${prefix}-status`)).toContainText('Completed');
      await tenant.goto(`/rooms/${roomId}/rental`);
      await expect(tenant.getByTestId('rental-nav-overview')).toHaveAttribute(
        'aria-current',
        'page',
      );
      for (const width of [360, 768, 1366]) {
        await tenant.setViewportSize({ width, height: 1000 });
        expect(
          await tenant.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        ).toBe(true);
        await tenant.screenshot({
          path: testInfo.outputPath(`rental-${label}-${width}.png`),
          fullPage: true,
          animations: 'disabled',
        });
      }
      const unauthorized = await tenant.request.put(`/api/rooms/${roomId}/rent-settings`, {
        data: {
          tenancyId,
          amount: { amount: '1.00', currency: 'THB' },
          effectiveMonth: month,
          expectedId: null,
        },
      });
      expect(unauthorized.status()).toBe(404);
      expect(
        (
          await tenant.request.post(`/api/rooms/${roomId}/rent-invoices`, {
            data: { tenancyId, cycle: next },
          })
        ).status(),
      ).toBe(404);
      const otherManager = label === 'Project' ? ownerPage : page;
      expect(
        (
          await otherManager.request.put(`/api/rooms/${roomId}/rent-settings`, {
            data: {
              tenancyId,
              amount: { amount: '1.00', currency: 'THB' },
              effectiveMonth: month,
              expectedId: null,
            },
          })
        ).status(),
      ).toBe(404);
      expect(
        (
          await otherManager.request.post(`/api/rooms/${roomId}/rent-invoices`, {
            data: { tenancyId, cycle: next },
          })
        ).status(),
      ).toBe(404);
      await manager.goto(`/rooms/${roomId}/rental`);
      for (const width of [360, 768, 1366]) {
        await manager.setViewportSize({ width, height: 1000 });
        await manager.evaluate(() => window.scrollTo(0, 0));
        expect(
          await manager.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        ).toBe(true);
        await manager.screenshot({
          path: testInfo.outputPath(`rental-manager-${label}-${width}.png`),
          fullPage: true,
          animations: 'disabled',
        });
      }
      for (const view of ['payments', 'maintenance'] as const) {
        await manager.getByTestId(`rental-nav-${view}`).click();
        await expect(manager.getByTestId(`rental-nav-${view}`)).toHaveAttribute(
          'aria-current',
          'page',
        );
        await expect(
          manager.getByRole('region', {
            name: view === 'payments' ? 'Rent invoices' : 'Room maintenance',
            exact: true,
          }),
        ).toBeVisible();
        for (const width of [360, 768, 1366]) {
          await manager.setViewportSize({ width, height: 1000 });
          expect(
            await manager.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          await manager.screenshot({
            path: testInfo.outputPath(`rental-${view}-${label}-${width}.png`),
            fullPage: true,
            animations: 'disabled',
          });
        }
      }
      await manager.goto(`/rooms/${roomId}`);
      await expect(manager.getByTestId('room-memberships-list')).toContainText(
        `E2E ${label} Tenant`,
      );
      await expect(manager.getByTestId('room-member-add-open')).toHaveCount(0);
      for (const width of [360, 768, 1366]) {
        await manager.setViewportSize({ width, height: 1000 });
        expect(
          await manager.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        ).toBe(true);
        await manager.screenshot({
          path: testInfo.outputPath(`room-${label}-${width}.png`),
          fullPage: true,
          animations: 'disabled',
        });
      }
      await manager.getByTestId('room-rental-link').click();
      if (label === 'Private') {
        for (const [resident, role] of [
          [ownerPage, 'owner'],
          [tenant, 'tenant'],
        ] as const) {
          for (const width of [360, 768, 1366]) {
            await resident.setViewportSize({ width, height: 900 });
            for (const path of [
              '/',
              '/rooms',
              '/facilities',
              '/invoices',
              '/invoices?view=receivable',
              '/invoices/turnover-reviews',
              '/maintenance',
              '/maintenance/new',
              '/announcements',
            ]) {
              await resident.goto(path);
              await expect(resident.getByRole('heading', { level: 1 }).first()).toBeVisible();
              await expect(resident.getByText('Something went wrong', { exact: true })).toHaveCount(
                0,
              );
              expect(
                await resident.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                `${role} ${path} at ${width}`,
              ).toBe(true);
              await resident.screenshot({
                path: testInfo.outputPath(
                  `${role}-${path.replace(/[^a-z0-9]+/gi, '-') || 'home'}-${width}.png`,
                ),
                fullPage: true,
                animations: 'disabled',
              });
            }
          }
          await resident.goto('/admin/users');
          await expect(resident).toHaveURL('/');
          expect(
            (
              await resident.request.post(
                `/api/admin/billing/common-fee-events/${randomUUID()}/issue`,
                { data: {} },
              )
            ).status(),
          ).toBe(403);
        }
        await manager.goto(`/rooms/${roomId}/rental`);
      }
      if (label === 'Project') {
        await manager
          .getByTestId('rental-tenants')
          .locator('li')
          .filter({ hasText: 'Existing rental tenant' })
          .getByRole('button', { name: 'Remove tenant', exact: true })
          .click();
        await manager.getByTestId('room-membership-end-submit').click();
        await expect(manager.getByTestId('rental-tenants')).not.toContainText(
          'Existing rental tenant',
        );
        await expect(manager.getByRole('region', { name: 'Selected rental' })).toContainText(
          'Active',
        );
        await expect(manager.getByTestId('rental-tenants')).toContainText(`E2E ${label} Tenant`);
        await manager.getByTestId('rental-tenant-add-open').click();
        await manager.getByTestId('tenant-existing-option').click();
        await manager.getByTestId('room-member-add-username').fill(existingName);
        await manager.getByTestId('room-member-add-submit').click();
        await expect(
          manager
            .getByTestId('rental-tenants')
            .getByText('Existing rental tenant', { exact: true }),
        ).toHaveCount(1);
      }
      await manager.getByTestId('rental-period-details').locator('summary').click();
      await manager
        .getByTestId(/^room-tenancy-end-/)
        .first()
        .click();
      await manager.getByTestId('room-tenancy-end-submit').click();
      await expect(manager.getByTestId('rental-tenants')).toHaveCount(0);
      await tenant.goto(`/rooms/${roomId}`);
      await expect(tenant.getByTestId('room-detail-forbidden')).toBeVisible();
      await manager.goto(`/rooms/${roomId}/rental?tenancyId=${tenancyId}`);
      await manager.getByTestId('room-tenancy-create-open').click();
      await manager.getByTestId('room-tenancy-create-start').fill(`${next}-01`);
      await manager.getByTestId('room-tenancy-create-submit').click();
      await expect(manager).toHaveURL(/tenancyId=/);
      await expect(manager.getByTestId('room-rental-page')).not.toHaveAttribute(
        'data-tenancy-id',
        tenancyId,
      );
      await expect(manager.getByRole('region', { name: 'Selected rental' })).toContainText(
        'Scheduled',
      );
      await expect(manager.getByTestId('rental-period-details').locator('summary')).toHaveText(
        'Cancel scheduled rental',
      );
      await manager.getByTestId('rental-tenant-add-open').click();
      await expect(manager.getByTestId('room-member-add-form')).toBeVisible();
      await expect(manager.getByTestId('tenant-account-option')).toHaveCount(0);
      await manager.getByTestId('room-member-add-username').fill(username);
      await manager.getByTestId('room-member-add-submit').click();
      await expect(manager.getByTestId('rental-tenants')).toContainText(`E2E ${label} Tenant`);
    }
  } finally {
    for (const context of tenantContexts) await context.close();
    await ownerContext.close();
  }
});
