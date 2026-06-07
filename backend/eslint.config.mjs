import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'node_modules', 'coverage']),
  {
    files: ['**/*.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      '@typescript-eslint/no-namespace': 'warn',
      'no-useless-assignment': 'warn',
      // ESLint 10 ile gelen yeni kural; mevcut kod tabanında 21+ yer var.
      // 'cause' ekleme ileride ayrı PR'da yapılır; şimdilik warning seviyesinde.
      'preserve-caught-error': 'warn',
    },
  },
  {
    // Test dosyalarinda `any` bilerek kullanilir (vi.mock cikti tipleri, fixture
    // govdeleri) — burada uyari gurultu. Uretim kodunda kural acik kalir.
    files: ['**/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
])
