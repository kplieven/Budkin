import { describe, expect, it } from 'vitest';

import { photoFileName } from '@/lib/photoName';

describe('photoFileName', () => {
  it('names the copy after the moment it was taken, keeping the extension', () => {
    expect(photoFileName('cropped-42.jpg', 1754179200000)).toBe('photo-1754179200000.jpg');
  });

  it('lowercases the extension, so the same picture cannot land under two names', () => {
    expect(photoFileName('IMG_0042.JPEG', 1754179200000)).toBe('photo-1754179200000.jpeg');
  });

  it('falls back to jpg when the source name has no extension', () => {
    expect(photoFileName('image', 1754179200000)).toBe('photo-1754179200000.jpg');
  });

  it('falls back to jpg for a trailing dot, which yields an empty extension', () => {
    expect(photoFileName('image.', 1754179200000)).toBe('photo-1754179200000.jpg');
  });

  it('ignores dots in the name itself and takes only the last segment', () => {
    expect(photoFileName('my.holiday.photo.png', 1754179200000)).toBe('photo-1754179200000.png');
  });

  it('rejects an extension that is not plainly alphanumeric, rather than building a path from it', () => {
    // The source name comes from the picker, not from us. An extension is only
    // ever appended to a path we construct, so anything that is not a short
    // run of letters and digits is refused rather than sanitised.
    expect(photoFileName('evil.../../etc/passwd', 1754179200000)).toBe('photo-1754179200000.jpg');
    expect(photoFileName('x.jp g', 1754179200000)).toBe('photo-1754179200000.jpg');
  });
});
