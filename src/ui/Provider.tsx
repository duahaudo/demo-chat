import { ChakraProvider, defaultSystem } from '@chakra-ui/react';
import type { ReactNode } from 'react';

/**
 * Chakra's default system, unmodified (DESIGN-SYSTEM R3 — extending it needs an ADR).
 * Light only: `_dark` conditions key off a `.dark` class nothing sets.
 */
export function Provider({ children }: { children: ReactNode }) {
  return <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>;
}
