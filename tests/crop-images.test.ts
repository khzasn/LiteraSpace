import { describe, it, expect } from 'vitest';
import { cropImages } from '../src/worker/cropper';
import type { ImgJob } from '../src/worker/parser';

describe('Bagian 3: cropImages shared function', () => {
  it('fungsi cropImages terdefinisi dan dapat dipanggil dengan imgJobs kosong', async () => {
    const emptyBuffer = new ArrayBuffer(0);
    const jobs: ImgJob[] = [];
    const result = await cropImages(emptyBuffer, jobs, 'test-book');
    expect(result).toEqual({});
  });
});
