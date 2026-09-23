-- Safari can fall back to JPEG when WebP canvas encoding is unavailable.
update storage.buckets
set allowed_mime_types = array['image/webp', 'image/jpeg']
where id in ('post-images', 'matching-photos');
