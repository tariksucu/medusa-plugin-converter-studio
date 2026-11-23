/** Unit tests (no network) and the integration test against a Converter Studio API. */
const transform = {
  '^.+\\.[jt]sx?$': [
    '@swc/jest',
    { jsc: { parser: { syntax: 'typescript', decorators: true }, target: 'es2021' } },
  ],
};

module.exports = {
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      transform,
      testMatch: ['<rootDir>/test/unit/**/*.test.ts'],
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      transform,
      testMatch: ['<rootDir>/test/integration/**/*.test.ts'],
    },
  ],
};
