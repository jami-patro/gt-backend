import 'dotenv/config';
import mongoose from 'mongoose';
import User from './src/models/User.js';

async function updatePaymentMethods() {
  try {
    await mongoose.connect(process.env.MONGO_URL);
    console.log('Connected to MongoDB');
    
    // Use exact emails from the CSV
    const emails = [
      'doodlyp@gmail.com',           // Doodly Pattajoshi
      'sunita.samant.10@gmail.com',  // Sunita Samant
      'sanjibn950@gmail.com'         // Sanjib kumar Pattanayak
    ];

    console.log('Searching and updating users...\n');
    for (const email of emails) {
      const user = await User.findOne({ email });
      if (user) {
        console.log(`✅ Found: ${user.name} (${user.email})`);
        console.log(`   Current payment method: ${user.paymentMethodUsed}`);
        
        user.paymentMethodUsed = 'PhonePe - J Srikanta Patro';
        await user.save();
        
        console.log(`   ✅ Updated to: PhonePe - J Srikanta Patro\n`);
      } else {
        console.log(`❌ Not found: ${email}\n`);
      }
    }

    console.log('✅ All updates complete!');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

updatePaymentMethods();
