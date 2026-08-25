import { ChakraProvider, defaultSystem } from '@chakra-ui/react';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

// jsdom implements neither; the auto-growing textarea and Chakra's responsive props want both.
if (typeof window !== 'undefined' && typeof window.ResizeObserver !== 'function') {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

/**
 * Chakra's system without `next-themes` — the theme provider is not what any of these tests are
 * about, and it wants browser APIs jsdom does not have.
 */
export function renderUi(ui: ReactElement): RenderResult {
  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
    ),
  });
}
