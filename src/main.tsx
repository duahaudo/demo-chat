import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/ui/App';
import { Provider } from '@/ui/Provider';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <Provider>
      <App />
    </Provider>
  </StrictMode>,
);
