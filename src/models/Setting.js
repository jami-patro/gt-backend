import mongoose from 'mongoose';

// A tiny key/value store for runtime-toggatable settings that the admin can
// change without a redeploy (e.g. whether contributions are open).
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true },
);

settingSchema.statics.get = async function get(key, fallback = null) {
  const doc = await this.findOne({ key }).lean();
  return doc ? doc.value : fallback;
};

settingSchema.statics.set = async function set(key, value) {
  const doc = await this.findOneAndUpdate(
    { key },
    { key, value },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return doc.value;
};

export const Setting = mongoose.model('Setting', settingSchema);
