// Vercel serverless entrypoint. On Vercel's Node runtime, an Express app is a
// valid (req, res) request handler, so we can export it directly.
import app from '../src/app.js';

export default app;
