module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  clearMocks: true,
  restoreMocks: true,
  resetMocks: true,
};
