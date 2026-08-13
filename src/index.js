import app from './app.js';

const port = process.env.PORT || 5000;

if (!process.env.VERCEL) {
  app.listen(port, () => console.log(`REFURBICON API running on http://localhost:${port}`));
}

export default app;
