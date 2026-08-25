// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { MessageBubble } from './MessageBubble';
import { renderUi } from './test-utils';

afterEach(cleanup);

describe('MessageBubble', () => {
  it('names the speaker for a screen reader, which alignment alone cannot do', () => {
    const { container } = renderUi(<MessageBubble role="user" content="Hello" />);
    expect(screen.getByText('You said')).toBeTruthy();
    expect(container.textContent).toContain('Hello');

    cleanup();
    renderUi(<MessageBubble role="assistant" content="Hello" />);
    expect(screen.getByText('Assistant said')).toBeTruthy();
  });

  it('shows the caret only while streaming, and hides it from assistive technology', () => {
    const { rerender } = renderUi(<MessageBubble role="assistant" content="Par" caret />);
    expect(screen.getByTestId('caret').getAttribute('aria-hidden')).toBe('true');

    rerender(<MessageBubble role="assistant" content="Partial" />);
    expect(screen.queryByTestId('caret')).toBeNull();
  });
});
