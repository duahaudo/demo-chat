import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Import-boundary zones (TECHNICAL-DESIGN §2, ADR-0004). Dependencies point downward only:
 *
 *   ui -> app -> adapter -> core
 *
 * Patterns are matched against the import specifier, so a `adapter` glob catches both the
 * `@/adapter/x` alias and a relative `../adapter/x` escape. Four directories do not justify
 * a boundaries plugin as a dependency.
 */
const upward = {
  'src/core/**': ['adapter', 'app', 'ui'],
  'src/adapter/**': ['app', 'ui'],
  'src/app/**': ['ui'],
  'src/ui/**': [],
};

const boundaryConfigs = Object.entries(upward)
  .filter(([, forbidden]) => forbidden.length > 0)
  .map(([files, forbidden]) => ({
    files: [files],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: forbidden.map((layer) => ({
            group: [`**/${layer}/**`, `@/${layer}`, `**/${layer}`],
            message: `Import boundary: ${files.replace('/**', '')} must not import from src/${layer}/ — dependencies point downward only (ADR-0004).`,
          })),
        },
      ],
    },
  }));

/** DESIGN-SYSTEM R1, R2 and R4 (§6) — the three rules the spec says lint enforces. */
const designSystemRules = {
  'no-restricted-syntax': [
    'error',
    {
      selector: 'Literal[value=/#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?\\b/]',
      message:
        'R1: no colour literals. Use a semantic token (DESIGN-SYSTEM §2), e.g. "bg.subtle", "fg.muted", "colorPalette.solid".',
    },
    {
      selector: 'Literal[value=/\\b(rgba?|hsla?|oklch|color-mix)\\(/]',
      message: 'R1: no colour literals. Use a semantic token (DESIGN-SYSTEM §2).',
    },
    {
      selector:
        'Literal[value=/\\b(gray|red|orange|yellow|green|teal|blue|cyan|purple|pink)\\.(50|[1-9]00)\\b/]',
      message:
        'R1: no raw palette scales. Set status colour via `colorPalette` and use its semantic tokens (DESIGN-SYSTEM §2).',
    },
    {
      selector: 'Literal[value=/^-?[0-9]+(\\.[0-9]+)?(px|rem|em)$/]',
      message:
        'R2: no off-scale pixel values. Use spacing scale steps 1–8, or a size token (DESIGN-SYSTEM §2).',
    },
    {
      selector: 'Property[key.name="outline"][value.value=/^(none|0)$/]',
      message: 'R4: every interactive element keeps a visible focus indicator.',
    },
    {
      selector: 'JSXAttribute[name.name="outline"][value.value=/^(none|0)$/]',
      message: 'R4: every interactive element keeps a visible focus indicator.',
    },
  ],
};

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'pnpm-lock.yaml'] },

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  prettier,

  {
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // Presentation layer: React rules, a11y, design-system rules, and no I/O of its own.
  {
    files: ['src/ui/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      ...designSystemRules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message:
            'Presentation does not perform I/O. Call through src/app/ (TECHNICAL-DESIGN §2).',
        },
        {
          name: 'XMLHttpRequest',
          message:
            'Presentation does not perform I/O. Call through src/app/ (TECHNICAL-DESIGN §2).',
        },
        {
          name: 'EventSource',
          message:
            'Presentation does not perform I/O. Call through src/app/ (TECHNICAL-DESIGN §2).',
        },
      ],
    },
  },

  // Core is pure: no framework, no I/O, no clock (TECHNICAL-DESIGN §2).
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Core is pure — no I/O.' },
        {
          name: 'localStorage',
          message: 'Core is pure — the storage driver lives in the adapter.',
        },
        { name: 'window', message: 'Core is pure — no browser globals.' },
        { name: 'document', message: 'Core is pure — no browser globals.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Core has no clock — pass time in.' },
        {
          object: 'Math',
          property: 'random',
          message: 'Core is deterministic — pass randomness in.',
        },
      ],
    },
  },

  ...boundaryConfigs,

  // Config files run in Node and are outside the layer rules. They sit outside tsconfig's
  // `include`, so the type-aware rules have no program for them.
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['api/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
);
