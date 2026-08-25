import { expect, test } from './fixtures';

test('a chat can be renamed and deleted', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Message').fill('Name this chat');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('main').getByText('Hello from the stub.')).toBeVisible();

  await page.getByRole('button', { name: 'Rename Name this chat' }).click();
  const field = page.getByLabel('Chat title');
  await field.fill('Renamed');
  await field.press('Enter');
  await expect(page.getByRole('link', { name: /Renamed/ })).toBeVisible();

  await page.getByRole('button', { name: 'Delete Renamed' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Renamed and everything in it will be deleted.');
  await dialog.getByRole('button', { name: 'Delete' }).click();

  await expect(page.getByRole('link', { name: /Renamed/ })).toHaveCount(0);
  await expect(page.getByText('Start a conversation')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('link', { name: /Renamed/ })).toHaveCount(0);
});
