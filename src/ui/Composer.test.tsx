// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Composer } from './Composer';
import { renderUi } from './test-utils';

afterEach(cleanup);

const composer = (overrides: Partial<Parameters<typeof Composer>[0]> = {}) => (
  <Composer streaming={false} onSend={vi.fn()} onStop={vi.fn()} {...overrides} />
);

const field = () => screen.getByRole('textbox', { name: 'Message' });

/** The hint is the control's own explanation, so read it through `aria-describedby`. */
const describedBy = (element: HTMLElement) => {
  const id = element.getAttribute('aria-describedby') ?? '';
  return document.getElementById(id)?.textContent ?? '';
};

describe('Composer', () => {
  it('sends on Enter and clears the field', () => {
    const onSend = vi.fn();
    renderUi(composer({ onSend }));

    fireEvent.change(field(), { target: { value: '  What is an SSE frame?  ' } });
    fireEvent.keyDown(field(), { key: 'Enter' });

    expect(onSend).toHaveBeenCalledWith('What is an SSE frame?');
    expect((field() as HTMLTextAreaElement).value).toBe('');
  });

  it('inserts a newline on Shift+Enter instead of sending', () => {
    const onSend = vi.fn();
    renderUi(composer({ onSend }));

    fireEvent.change(field(), { target: { value: 'First line' } });
    fireEvent.keyDown(field(), { key: 'Enter', shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
    expect((field() as HTMLTextAreaElement).value).toBe('First line');
  });

  it('will not send whitespace', () => {
    const onSend = vi.fn();
    renderUi(composer({ onSend }));

    fireEvent.change(field(), { target: { value: '   ' } });
    fireEvent.keyDown(field(), { key: 'Enter' });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('says why Send is disabled rather than leaving a dead button', () => {
    renderUi(composer());
    const send = screen.getByRole('button', { name: 'Send' });

    expect((send as HTMLButtonElement).disabled).toBe(true);
    expect(describedBy(send)).toContain('Type a message to send');
  });

  it('becomes Stop while streaming, and says why the field is disabled', () => {
    renderUi(composer({ streaming: true }));

    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    expect((field() as HTMLTextAreaElement).disabled).toBe(true);
    expect(describedBy(field())).toContain('Press Escape or Stop to interrupt it');
  });

  it('stops on Escape while streaming, when the disabled field cannot take the key', () => {
    const onStop = vi.fn();
    renderUi(composer({ streaming: true, onStop }));

    fireEvent.keyDown(screen.getByRole('button', { name: 'Stop' }), { key: 'Escape' });
    expect(onStop).toHaveBeenCalled();
  });

  it('ignores Escape when nothing is streaming', () => {
    const onStop = vi.fn();
    renderUi(composer({ onStop }));

    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(onStop).not.toHaveBeenCalled();
  });
});
