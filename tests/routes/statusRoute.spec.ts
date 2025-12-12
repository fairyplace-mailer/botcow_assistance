import request from 'supertest';
import * as ciRunner from '../../src/backend/ciRunner';

jest.mock('../../src/backend/ciRunner');

const app = require('../../src/server');

describe('routes: /api/github/workflow/status', () => {
  beforeEach(() => jest.resetAllMocks());

  test('POST status returns status when run present', async () => {
    const status = { run_id: 1, status: 'completed', conclusion: 'success' };
    (ciRunner.getWorkflowRunStatus as jest.Mock).mockResolvedValue(status);

    const res = await request(app).post('/api/github/workflow/status').send({ run_id: 1 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
  });
});
