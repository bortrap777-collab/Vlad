import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.scratch/**', 'public/**', 'release/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
    },
  },
  {
    files: ['tests/e2e/**/*.mjs', 'tools/**/*.mjs'],
    languageOptions: { globals: { window: 'readonly', document: 'readonly', innerWidth: 'readonly', innerHeight: 'readonly', console: 'readonly', process: 'readonly', localStorage: 'readonly' } },
  },
);
