import { Router } from 'express';
import crypto from 'crypto';
import { GalleryItem } from '../models/GalleryItem.js';
import { config } from '../config.js';
import { optionalAuth, requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

// GET /api/gallery — PUBLIC memories wall. Only returns category='public'.
// "Guess Who?" photos are intentionally excluded so the game isn't spoiled.
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const items = await GalleryItem.find({ approved: true, category: 'public' })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('url thumbUrl resourceType uploaderName createdAt')
      .lean();
    return res.json({
      count: items.length,
      items: items.map((i) => ({
        id: i._id,
        url: i.url,
        thumbUrl: i.thumbUrl || i.url,
        type: i.resourceType,
        uploaderName: i.uploaderName || null,
        uploadedAt: i.createdAt,
      })),
    });
  } catch (err) {
    return next(err);
  }
});

// GET /api/gallery/guesswho — the hidden "Guess Who?" pile. Admin-only, so the
// game stays a surprise until organizers reveal photos on-screen at the event.
router.get('/guesswho', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const items = await GalleryItem.find({ approved: true, category: 'guesswho' })
      .sort({ createdAt: -1 })
      .lean();
    return res.json({
      count: items.length,
      items: items.map((i) => ({
        id: i._id,
        url: i.url,
        thumbUrl: i.thumbUrl || i.url,
        type: i.resourceType,
        uploaderName: i.uploaderName || null,
        guessAnswer: i.guessAnswer || null,
        uploadedAt: i.createdAt,
      })),
    });
  } catch (err) {
    return next(err);
  }
});

// POST /api/gallery — record an upload that just completed in the browser.
// The browser uploads the file directly to Cloudinary (unsigned preset) and
// posts the returned metadata here. We validate the URL actually belongs to
// our configured Cloudinary cloud to prevent arbitrary URL injection.
router.post('/', optionalAuth, async (req, res, next) => {
  try {
    const { cloudName } = config.cloudinary;
    if (!cloudName) {
      return res.status(503).json({ error: 'Uploads are not configured yet.' });
    }

    const b = req.body || {};
    const url = String(b.url || '').trim();
    if (!/^https:\/\/res\.cloudinary\.com\//.test(url) || !url.includes(`/${cloudName}/`)) {
      return res.status(400).json({ error: 'Invalid upload URL' });
    }

    const resourceType = b.resourceType === 'video' ? 'video' : 'image';
    const category = b.category === 'guesswho' ? 'guesswho' : 'public';
    const guessAnswer =
      category === 'guesswho' && b.guessAnswer
        ? String(b.guessAnswer).trim().slice(0, 120)
        : null;
    const uploaderName =
      (b.uploaderName && String(b.uploaderName).trim().slice(0, 80)) ||
      req.user?.name ||
      null;

    // Build a small thumbnail URL via a Cloudinary transformation. For videos
    // we pull a jpg poster frame; for images a cropped 400px thumb.
    let thumbUrl = null;
    try {
      if (resourceType === 'image') {
        thumbUrl = url.replace('/upload/', '/upload/c_fill,w_400,h_400,q_auto,f_auto/');
      } else {
        thumbUrl = url
          .replace('/upload/', '/upload/c_fill,w_400,h_400,q_auto/so_0/')
          .replace(/\.[a-z0-9]+$/i, '.jpg');
      }
    } catch {
      thumbUrl = null;
    }

    const item = await GalleryItem.create({
      url,
      publicId: b.publicId ? String(b.publicId) : null,
      resourceType,
      format: b.format ? String(b.format) : null,
      bytes: Number(b.bytes) || 0,
      width: Number(b.width) || 0,
      height: Number(b.height) || 0,
      thumbUrl,
      uploaderName,
      uploader: req.user?.id || null,
      category,
      guessAnswer,
    });

    return res.status(201).json({
      id: item._id,
      url: item.url,
      thumbUrl: item.thumbUrl,
      type: item.resourceType,
      uploaderName: item.uploaderName,
      uploadedAt: item.createdAt,
    });
  } catch (err) {
    return next(err);
  }
});

// Best-effort delete of the underlying Cloudinary asset (needs API key/secret).
async function destroyCloudinaryAsset(publicId, resourceType) {
  const { cloudName, apiKey, apiSecret } = config.cloudinary;
  if (!cloudName || !apiKey || !apiSecret || !publicId) return { skipped: true };
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHash('sha1')
    .update(`public_id=${publicId}&timestamp=${timestamp}${apiSecret}`)
    .digest('hex');
  const form = new URLSearchParams({
    public_id: publicId,
    timestamp: String(timestamp),
    api_key: apiKey,
    signature,
  });
  const type = resourceType === 'video' ? 'video' : 'image';
  const resp = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/${type}/destroy`,
    { method: 'POST', body: form },
  );
  return resp.json().catch(() => ({}));
}

// DELETE /api/gallery/:id — admin removes an item (record + Cloudinary asset).
router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const item = await GalleryItem.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    try {
      await destroyCloudinaryAsset(item.publicId, item.resourceType);
    } catch (e) {
      console.warn('Cloudinary destroy failed:', e.message);
    }
    await item.deleteOne();
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
