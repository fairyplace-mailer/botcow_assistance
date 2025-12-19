import { app } from './serverBase';
import { callTool, getTools } from './backend/api/tools';

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Tools proxy endpoints
app.get('/tools', getTools);
app.post('/tools/call', callTool);

// Start server only outside tests to avoid open handle issues
if (process.env.NODE_ENV !== 'test') {
  const port = process.env.PORT || 4000;
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Express server running on http://localhost:${port}`);
  });
}
