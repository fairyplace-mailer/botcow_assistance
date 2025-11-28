import express from 'express';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(4000, () => {
  console.log('Express server running on http://localhost:4000');
});
