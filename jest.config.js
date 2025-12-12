module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '/.next/'],
  moduleNameMapper: {
    '^@octokit/rest$': '<rootDir>/tests/__mocks__/octokitRest.ts'
  },
  setupFiles: ['<rootDir>/tests/setupEnv.ts']
};
