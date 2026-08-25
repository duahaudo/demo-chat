import { expect, test } from './fixtures';

test('create, send, stream, stop, switch chats, and reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Start a conversation')).toBeVisible();

  await page.getByLabel('Message').fill('Answer this one slowly');
  await page.getByRole('button', { name: 'Send' }).click();

  // Scoped to the transcript: the sidebar shows the same text as a preview.
  const answer = page.getByRole('main').getByText(/tick0/);
  await expect(answer).toBeVisible();
  await expect(page.getByTestId('caret')).toBeVisible();
  // The keepalive comment frame is a protocol artefact, never content.
  await expect(page.getByText('OPENROUTER PROCESSING')).toHaveCount(0);

  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByText('Stopped.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();

  const interrupted = (await answer.textContent()) ?? '';
  expect(interrupted).toContain('tick0');

  await page.getByRole('button', { name: 'New chat' }).click();
  await expect(page.getByText('Start a conversation')).toBeVisible();

  await page.getByRole('link', { name: /Answer this one slowly/ }).click();
  await expect(answer).toHaveText(interrupted);

  await page.reload();
  await expect(page).toHaveURL(/#\/c\//);
  await expect(page.getByRole('main').getByText(/tick0/)).toHaveText(interrupted);
  await expect(page.getByRole('main').getByText('Answer this one slowly')).toBeVisible();
});
