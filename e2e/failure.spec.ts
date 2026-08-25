import { expect, test } from './fixtures';

test('a rejected request explains itself and the answer arrives on retry', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Message').fill('Make this one fail');
  await page.getByRole('button', { name: 'Send' }).click();

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('The stub rejected the request.');

  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('main').getByText('Hello from the stub.')).toBeVisible();
  await expect(alert).toHaveCount(0);
  // Nothing is lost on the way through a failure: the question is still in the transcript.
  await expect(page.getByRole('main').getByText('Make this one fail')).toBeVisible();
});
