import { test as base } from '@playwright/test';

/**
 * Stub for `/api/chat`, installed as an init script — serialised into the page, so it must be
 * self-contained. It answers with real SSE bytes over a live `ReadableStream` so streaming, stop
 * and failure stay observable. The message text selects the behaviour: "slow" streams long enough
 * to interrupt, "fail" is rejected on its first attempt only.
 */
function installChatStub(): void {
  const state = window as unknown as { __chatAttempts?: number };
  state.__chatAttempts = 0;

  const encoder = new TextEncoder();
  const realFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes('/api/chat')) return realFetch(input, init);

    const body = typeof init?.body === 'string' ? init.body : '';
    state.__chatAttempts = (state.__chatAttempts ?? 0) + 1;

    if (body.includes('fail') && state.__chatAttempts === 1) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: { message: 'The stub rejected the request.' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }

    const slow = body.includes('slow');
    const tokens = slow
      ? Array.from({ length: 400 }, (_, index) => `tick${index} `)
      : ['Hello', ' from', ' the', ' stub', '.'];
    const signal = init?.signal ?? null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let index = 0;
        let timer = 0;

        const abort = () => {
          window.clearInterval(timer);
          controller.error(new DOMException('The user aborted a request.', 'AbortError'));
        };

        if (signal?.aborted) {
          abort();
          return;
        }
        signal?.addEventListener('abort', abort);

        // A keepalive comment frame first: the client must not render it.
        controller.enqueue(encoder.encode(': OPENROUTER PROCESSING\n\n'));

        timer = window.setInterval(
          () => {
            const token = tokens[index++];
            if (token === undefined) {
              window.clearInterval(timer);
              signal?.removeEventListener('abort', abort);
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
              return;
            }
            const payload = JSON.stringify({ choices: [{ delta: { content: token } }] });
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
          },
          slow ? 40 : 10,
        );
      },
    });

    return Promise.resolve(
      new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    );
  };
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(installChatStub);
    await use(page);
  },
});

export { expect } from '@playwright/test';
