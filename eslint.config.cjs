const { defineConfig } = require('eslint/config')
const tseslint = require('@electron-toolkit/eslint-config-ts')
const eslintConfigPrettier = require('@electron-toolkit/eslint-config-prettier')
const eslintPluginReact = require('eslint-plugin-react')
const eslintPluginReactHooks = require('eslint-plugin-react-hooks')
const eslintPluginReactRefresh = require('eslint-plugin-react-refresh')

module.exports = defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out', '**/agents'] },
  tseslint.configs.recommended,
  {
    files: ['eslint.config.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules,
      'react/prop-types': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message: 'Use a named export instead of a default export.'
        }
      ]
    }
  },
  eslintConfigPrettier
)
