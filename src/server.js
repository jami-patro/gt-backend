// Local development entrypoint. On Vercel, api/index.js is used instead.
import app from './app.js';
import { config } from './config.js';

app.listen(config.port, () => {
  console.log(`gt_backend listening on http://localhost:${config.port}`);
  console.log(`Event: ${config.event.name} on ${config.event.date}`);
});
