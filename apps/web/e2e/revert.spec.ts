import { expect, test } from '@playwright/test';

const VIEWPORTS = [
  { width: 320, height: 680 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 428, height: 926 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

test.describe('REVERT Product Interface', () => {
  test('landing page explains REVERT clearly and toggles preview modes', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Send with confidence/i })).toBeVisible();
    await expect(
      page.getByText(/does not reverse already-finalized conventional blockchain transfers/i),
    ).toBeVisible();

    await page.getByRole('tab', { name: 'Mode A' }).click();
    await expect(page.getByText('Mode A · Protected Window')).toBeVisible();

    await page.getByRole('tab', { name: 'Mode B' }).click();
    await expect(page.getByText('ONCHAIN_TX_LOOKUP_GENERAL')).toBeVisible();
  });

  test('live mode shows honest empty/offline state with zero fake balances', async ({ page }) => {
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: 'Escrow Dashboard' })).toBeVisible();
    // Never displays fake Demo Fixtures banner unless demo mode is active
    await expect(page.getByText('SIMULATED DEMONSTRATION FIXTURES')).toHaveCount(0);
    await expect(page.getByText(/No payments match the current view/i)).toBeVisible();
  });

  test('demo fixtures: dashboard filters, create payment flow, and detail permissions work end-to-end', async ({
    page,
  }) => {
    await page.goto('/app?demo=1');
    await expect(page.getByText('SIMULATED DEMONSTRATION FIXTURES')).toBeVisible();
    await expect(page.getByText('Escrow #1')).toBeVisible();
    await expect(page.getByText('Escrow #2')).toBeVisible();

    // Filter to Mode B Conditional
    await page.getByRole('button', { name: 'Mode B · Conditional' }).click();
    await expect(page.getByText('Escrow #2')).toBeVisible();
    await expect(page.getByText('Escrow #1')).toHaveCount(0);

    // Inspect Mode B Payment Detail (#2) -> shows observed cost, receipt, and SATISFIED verdict
    await page.getByText('Escrow #2').click();
    await expect(page.getByRole('heading', { name: 'Escrow #2' })).toBeVisible();
    await expect(page.getByText('0.01 USDC')).toBeVisible();
    await expect(page.getByText('Cryptographic Match')).toBeVisible();
    await expect(page.getByRole('button', { name: /Settle with Proof/i })).toBeEnabled();

    // Settle simulated conditional escrow -> state transitions to RELEASED
    await page.getByRole('button', { name: /Settle with Proof/i }).click();
    await expect(page.getByText('RELEASED').first()).toBeVisible();

    // Create a new Mode A Protected payment in Demo mode
    await page.goto('/create?demo=1');
    await page.getByLabel('Amount (USDC)').fill('42.50');
    await page.getByRole('button', { name: /Review Terms/i }).click();
    await expect(page.getByText('Review Immutable Terms')).toBeVisible();
    await expect(page.getByText('42.50 USDC')).toBeVisible();
    await page.getByRole('button', { name: /Create Simulated Escrow/i }).click();

    await expect(page.getByRole('heading', { name: /Escrow #5/ })).toBeVisible();
    await expect(page.getByText('42.50 USDC')).toBeVisible();
    // Cancel works before recovery window ends; claim is disabled
    await expect(page.getByRole('button', { name: /Claim Payment/i })).toBeDisabled();
    await page.getByRole('button', { name: /Cancel & Reclaim/i }).click();
    await expect(page.getByText('REFUNDED').first()).toBeVisible();
  });

  test('developers and security page renders trust assumptions and addresses', async ({ page }) => {
    await page.goto('/developers');
    await expect(
      page.getByRole('heading', { name: /Developer & Security Documentation/i }),
    ).toBeVisible();
    await expect(page.getByText('0xcc194e1a843B658526D0D5C431f670028582Ae17')).toBeVisible();
    await expect(page.getByText(/explicitly not claimed to be trustless/i)).toBeVisible();
  });

  test('responsive layouts have zero horizontal overflow across 320..1440px and capture screenshots', async ({
    page,
  }) => {
    const routes = ['/', '/app?demo=1', '/create?demo=1', '/payments/2?demo=1', '/developers'];

    for (const vp of VIEWPORTS) {
      await page.setViewportSize(vp);
      for (const route of routes) {
        await page.goto(route);
        await page.waitForLoadState('networkidle');
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow, `Overflow on ${route} at ${vp.width}px`).toBeLessThanOrEqual(0);
      }
    }

    // Desktop screenshots (1440x900)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/desktop-landing.png', fullPage: true });

    await page.goto('/app?demo=1');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/desktop-dashboard-demo.png', fullPage: true });

    await page.goto('/payments/2?demo=1');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/desktop-payment-detail.png', fullPage: true });

    // Mobile screenshots (375x812)
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/mobile-landing.png', fullPage: true });

    await page.goto('/payments/2?demo=1');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/mobile-payment-detail.png', fullPage: true });
  });
});
