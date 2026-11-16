import { expect, test } from '@playwright/test';
import { FRONTEND_URL, WORKER_URL } from '../../../fixtures/test-helpers';

const legacyProvider = {
  name: 'legacy-provider',
  clientID: 'legacy-client',
  clientSecret: 'legacy-secret',
  authorizationURL: 'https://idp.example.com/authorize',
  accessTokenURL: 'https://idp.example.com/token',
  accessTokenFormat: 'json',
  userInfoURL: 'https://idp.example.com/userinfo',
  redirectURL: 'https://mail.example.com/user/oauth2/callback',
  userEmailKey: 'email',
  scope: 'openid email',
};

test.describe('Admin OAuth2 invite-only settings', () => {
  test.afterEach(async ({ request }) => {
    await request.post(`${WORKER_URL}/admin/user_oauth2_settings`, { data: [] });
  });

  test('legacy providers show auto-register on, and both switches save', async ({ page, request }) => {
    // A provider saved before this feature has neither field set.
    const seed = await request.post(`${WORKER_URL}/admin/user_oauth2_settings`, { data: [legacyProvider] });
    expect(seed.ok()).toBe(true);

    await page.addInitScript(() => {
      localStorage.setItem('adminAuth', 'e2e-admin-pass');
      sessionStorage.setItem('adminTab', 'user');
    });
    await page.goto(`${FRONTEND_URL}/en/admin`);
    await page.getByText('Oauth2 Settings', { exact: true }).click();
    await page.getByText('legacy-provider', { exact: true }).click();

    const autoRegisterRow = page.locator('.n-form-item').filter({ hasText: 'Auto-register new users on first sign-in' });
    const verifiedRow = page.locator('.n-form-item').filter({ hasText: 'Require the provider to verify the email' });
    const autoRegister = autoRegisterRow.getByRole('checkbox');
    const requireVerified = verifiedRow.getByRole('checkbox');

    await expect(autoRegister).toBeVisible();
    await expect(autoRegister).toBeChecked();
    await expect(requireVerified).not.toBeChecked();

    await autoRegisterRow.screenshot({ path: test.info().outputPath('oauth2-switches-before.png') });

    await autoRegister.click();
    await requireVerified.click();
    await expect(autoRegister).not.toBeChecked();
    await expect(requireVerified).toBeChecked();

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Save Success')).toBeVisible();

    await page.locator('.n-collapse-item').first().screenshot({
      path: test.info().outputPath('oauth2-provider-form-after.png'),
    });

    const saved = await (await request.get(`${WORKER_URL}/admin/user_oauth2_settings`)).json();
    expect(saved).toHaveLength(1);
    expect(saved[0].enableAutoRegister).toBe(false);
    expect(saved[0].requireEmailVerified).toBe(true);
  });
});
