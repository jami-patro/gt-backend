import 'dotenv/config';
import { sendPaymentUnderReview, isEmailEnabled, emailProvider } from './src/services/email.js';

console.log('email enabled:', isEmailEnabled(), '| provider:', emailProvider());

const res = await sendPaymentUnderReview({
  name: 'Test Person',
  email: 'jami@mysmartorbit.com',
});
console.log('result:', res);
process.exit(0);
