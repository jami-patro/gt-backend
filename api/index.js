// Vercel serverless entrypoint. Wraps the Express app so every /api/* request
// is handled by a single function.
import serverless from 'serverless-http';
import app from '../src/app.js';

export default serverless(app);
