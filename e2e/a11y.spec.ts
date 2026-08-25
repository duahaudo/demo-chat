import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './fixtures';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Screens, not components: each is a state the product can actually be sitting in. */
async function violations(page: Page, within?: string) {
  const builder = new AxeBuilder({ page }).withTags(TAGS);
  const result = await (within === undefined ? builder : builder.include(within)).analyze();
  return result.violations;
}

/** Chakra fades its overlays in; a mid-transition opacity reads as a contrast failure. */
async function settled(locator: Locator) {
  await expect(locator).toBeVisible();
  await locator.evaluate((node) =>
    Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished)),
  );
}

test('@a11y the empty, streaming, interrupted and confirming screens pass the audit', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Start a conversation')).toBeVisible();
  expect(await violations(page)).toEqual([]);

  await page.getByLabel('Message').fill('Answer this one slowly');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByTestId('caret')).toBeVisible();
  expect(await violations(page)).toEqual([]);

  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByText('Stopped.')).toBeVisible();
  expect(await violations(page)).toEqual([]);

  // The page behind an open modal is dimmed by the backdrop, so the dialog is audited alone.
  await page.getByRole('button', { name: /^Delete / }).click();
  await settled(page.getByRole('alertdialog'));
  expect(await violations(page, '[role="alertdialog"]')).toEqual([]);
});
