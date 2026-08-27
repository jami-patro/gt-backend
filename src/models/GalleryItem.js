import mongoose from 'mongoose';

// A single guest-uploaded photo or video. The actual file lives in Cloudinary;
// we only store its URL + a little metadata here (a few hundred bytes each),
// so this stays tiny even for hundreds of uploads.
const galleryItemSchema = new mongoose.Schema(
  {
    // Cloudinary secure URL of the asset.
    url: { type: String, required: true },
    // Cloudinary public_id — needed to delete the asset later.
    publicId: { type: String, default: null },
    // 'image' or 'video'.
    resourceType: { type: String, enum: ['image', 'video'], default: 'image' },
    format: { type: String, default: null },
    bytes: { type: Number, default: 0 },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    // A lightweight thumbnail URL (derived transformation) for fast grids.
    thumbUrl: { type: String, default: null },
    // Who uploaded it (best-effort — name is free text; userId set when logged in).
    uploaderName: { type: String, trim: true, default: null },
    uploader: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Where this upload belongs:
    //  - 'public'   → shown in the public Memories wall (default)
    //  - 'guesswho' → an old/childhood photo kept HIDDEN from the wall, used
    //                 only for the "Guess Who?" game (admin-only until revealed)
    category: { type: String, enum: ['public', 'guesswho'], default: 'public' },
    // Optional answer/hint for a Guess Who photo (e.g. the person's name).
    guessAnswer: { type: String, trim: true, default: null },
    // Moderation flag. Uploads are visible by default; admin can hide/delete.
    approved: { type: Boolean, default: true },
  },
  { timestamps: true },
);

galleryItemSchema.index({ createdAt: -1 });

export const GalleryItem =
  mongoose.models.GalleryItem || mongoose.model('GalleryItem', galleryItemSchema);
export default GalleryItem;
