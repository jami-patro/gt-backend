// Throwaway helper: ensure station tokens + a paid test member with a pass,
// then print URLs you can open to test the QR flow locally.
import { connectDB } from '../src/db.js';
import { User } from '../src/models/User.js';
import { getStationTokens } from '../src/utils/stations.js';
import { generatePassToken } from '../src/utils/auth.js';
import { hashPassword } from '../src/utils/auth.js';

const FRONTEND = process.env.TEST_FRONTEND || 'http://localhost:5173';

await connectDB();

// 1) Ensure all station tokens exist (incl. the all-in-one counter).
const tokens = await getStationTokens();

// 2) Ensure a paid test member with a pass token.
let user = await User.findOne({ email: 'testpass@reunion.com' });
if (!user) {
  user = await User.create({
    name: 'Test Guest',
    email: 'testpass@reunion.com',
    passwordHash: hashPassword('test1234'),
    branch: 'Computer Science',
    approved: true,
    paymentStatus: 'paid',
    contributionAmount: 5500,
  });
}
if (!user.passToken) {
  user.passToken = generatePassToken();
}
// Reset redemption state so the test starts clean.
user.eventPass = { checkedIn: false, tshirt: false, souvenir: false, drinks: 0 };
await user.save();

console.log('\n=== QR PASS TEST DATA ===\n');
console.log('Member pass QR/link (this is what a guest shows):');
console.log(`  ${FRONTEND}/pass/${user.passToken}\n`);
console.log('Volunteer counter links (open one, then scan the pass above):');
for (const [key, tok] of Object.entries(tokens)) {
  console.log(`  ${key.padEnd(9)} -> ${FRONTEND}/station/${tok}`);
}
console.log('\nRaw pass token (for API test):', user.passToken);
console.log('All-counter token:', tokens.all);
console.log('Check-in token:', tokens.checkin, '\n');

process.exit(0);
