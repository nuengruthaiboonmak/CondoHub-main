import { test as base, type BrowserContext, type Page } from '@playwright/test';

export type E2ERole =
  | 'admin'
  | 'ownerA'
  | 'ownerC'
  | 'ownerNewB'
  | 'main'
  | 'sub'
  | 'privateTenant'
  | 'formerTenant'
  | 'formerOwner'
  | 'noAccess'
  | 'suspended'
  | 'freshUser';

export interface AuthFixtures {
  loginAs: (role: E2ERole, page: Page) => Promise<void>;
  storageStateFor: (role: E2ERole) => Promise<string>;
  contextFor: (role: E2ERole) => Promise<BrowserContext>;
}

export const test = base.extend<AuthFixtures>({
  loginAs: async ({ browser }, use) => {
    const loginAs = async (role: E2ERole, page: Page): Promise<void> => {
      void browser;
      void role;
      void page;
      throw new Error('loginAs is a P0b stub. P1 wires the real login flow.');
    };
    await use(loginAs);
  },
  storageStateFor: async ({ browser }, use) => {
    const storageStateFor = async (role: E2ERole): Promise<string> => {
      void browser;
      void role;
      throw new Error('storageStateFor is a P0b stub. P1 wires the real login flow.');
    };
    await use(storageStateFor);
  },
  contextFor: async ({ browser }, use) => {
    const contextFor = async (role: E2ERole): Promise<BrowserContext> => {
      void role;
      return browser.newContext();
    };
    await use(contextFor);
  },
});

export { expect } from '@playwright/test';
