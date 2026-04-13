module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  clearMocks: true,
  restoreMocks: true,
  resetMocks: true,
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  transformIgnorePatterns: [
    '/node_modules/(?!(@octokit/rest|@octokit/core|@octokit/plugin-paginate-rest|@octokit/plugin-request-log|@octokit/request|@octokit/endpoint|@octokit/auth-token|@octokit/graphql|@octokit/graphql-schema|before-after-hook|universal-user-agent)/)',
  ],
};
