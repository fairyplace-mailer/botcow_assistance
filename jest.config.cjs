module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  clearMocks: true,
  restoreMocks: true,
  resetMocks: true,
  transformIgnorePatterns: [
    '/node_modules/(?!(@octokit/rest|@octokit/core|@octokit/plugin-paginate-rest|@octokit/plugin-request-log|@octokit/request|@octokit/endpoint|@octokit/auth-token|before-after-hook|universal-user-agent)/)',
  ],
};
