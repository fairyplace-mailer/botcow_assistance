import request from 'supertest';
import * as ciRunner from '../../src/backend/ciRunner';

jest.mock('../../src/backend/ciRunner');

const app = require('../../src/server');

describe('routes: /api/github/workflow/run', () => {
  beforeEach(() => jest.resetAllMocks());

  test('POST run returns tracked object', async () => {
    const tracked = { runId: 1, workflowId: 'ci.yml', ref: 'botcow-prevectus', startedAt: new Date().toISOString(), stored: 'repo' };
    (ciRunner.runWorkflowAndTrack as jest.Mock).mockResolvedValue({ result: { status: 'dispatched' }, tracked });

    const res = await request(app).post('/api/github/workflow/run').send({ workflow_id: 'ci.yml', ref: 'botcow-prevectus' });
    expect(res.status).toBe(200);
    expect(res.body.tracked).toBeDefined();
    expect(res.body.tracked.runId).toBe(1);
  });
});
