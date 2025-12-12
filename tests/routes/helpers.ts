import express from 'express';
import * as ciRunner from '../../src/backend/ciRunner';

export function createTestApp() {
  const app = express();
  app.use(express.json());

  app.post('/api/github/workflow/run', async (req, res) => {
    try {
      const { workflow_id, ref } = req.body;
      const result = await ciRunner.runWorkflowAndTrack({ workflow_id, ref });
      return res.status(200).json(result);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.post('/api/github/workflow/status', async (req, res) => {
    try {
      const { run_id } = req.body;
      const status = await ciRunner.getWorkflowRunStatus(run_id);
      return res.status(200).json(status);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  return app;
}
