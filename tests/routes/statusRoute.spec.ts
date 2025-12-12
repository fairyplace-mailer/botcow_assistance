import request from 'supertest';
import * as ciRunner from '../../src/backend/ciRunner';
import { createTestApp } from './helpers';

jest.mock('../../src/backend/ciRunner');

const app = createTestApp();

describe('routes: /api/github/workflow/status', () => {
  beforeEach(() => jest.resetAllMocks());

  test('POST status returns status when run present', async () => {
    const status = { status: 'completed', conclusion: 'success' };
    (ciRunner.getWorkflowRunStatus as jest.Mock).mockResolvedValue(status);

    const res = await request(app).post('/api/github/workflow/status').send({ run_id: 1 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
  });
});
