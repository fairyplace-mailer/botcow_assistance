import { describe, expect, it, jest } from '@jest/globals';

jest.mock('@octokit/rest', () => ({
  Octokit: class Octokit {},
}));

jest.mock('../../src/backend/ciDiagnostics', () => ({
  githubDiagnoseLatestWorkflowRun: jest.fn(),
  githubDiagnoseWorkflowRun: jest.fn(),
  githubGetWorkflowRunLogsText: jest.fn(),
}));

jest.mock('../../src/backend/diagnostics/actionsDiagnostics', () => ({
  githubDiagnoseActionsSetup: jest.fn(),
}));

describe('tool schema contract', () => {
  it('keeps all function tools compatible with strict Responses API requirements', () => {
    const { getToolsSchemas } = require('../../src/backend/tools');
    const { validateResponsesToolsContract } = require('../../src/backend/responses');

    expect(validateResponsesToolsContract(getToolsSchemas())).toEqual({ ok: true });
  });
});
