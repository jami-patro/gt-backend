// One-off: send a sample reunion-pass email so we can see how it looks.
import { connectDB } from '../src/db.js';
import { sendPassEmail, emailProvider } from '../src/services/email.js';
import { config } from '../src/config.js';

await connectDB();

const to = process.argv[2] || 'jami.patro@gmail.com';
const frontend = config.frontendUrls[0] || 'http://localhost:5173';
// A sample pass link (demo token — just for showing the look).
const passUrl = `${frontend}/pass/SAMPLE1234demo`;

const sampleUser = { name: 'Jami Patro', email: to };

console.log(`Email provider: ${emailProvider()}`);
console.log(`Sending sample pass to: ${to}`);

const res = await sendPassEmail(sampleUser, passUrl);
console.log('Result:', res);

process.exit(res.ok ? 0 : 1);
