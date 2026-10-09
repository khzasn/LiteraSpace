import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';

async function test() {
  try {
    // pdfjs.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';
    const pdfPath = join('tests', 'fixtures', 'book.pdf');
    const pdfBuffer = readFileSync(pdfPath);
    
    // Coba load tanpa Worker terlebih dahulu
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(pdfBuffer)
    }).promise;
    
    console.log('Success, pages:', pdf.numPages);
  } catch (e) {
    console.error('Error:', e);
  }
}

test();
