// @ts-check
import antfu from '@antfu/eslint-config'

export default antfu(
  {
    ignores: [
      // eslint ignore globs here
      'test/**/*',
    ],
  },
  {
    rules: {
      // overrides
      'no-restricted-syntax': 'off',
      'unused-imports/no-unused-vars': 'off',
      'import/no-mutable-exports': 'off',
    },
  },
)
