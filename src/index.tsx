import { render } from 'preact';
import { App } from './App';

// Import font offline
import '@fontsource/literata/400.css';
import '@fontsource/literata/400-italic.css';
import '@fontsource/literata/700.css';
import '@fontsource/literata/700-italic.css';

import '@fontsource/lora/400.css';
import '@fontsource/lora/400-italic.css';
import '@fontsource/lora/700.css';
import '@fontsource/lora/700-italic.css';

import '@fontsource/merriweather/400.css';
import '@fontsource/merriweather/400-italic.css';
import '@fontsource/merriweather/700.css';
import '@fontsource/merriweather/700-italic.css';

import '@fontsource/inter/400.css';
import '@fontsource/inter/700.css';

import '@fontsource/lexend/400.css';
import '@fontsource/lexend/700.css';

import '@fontsource/opendyslexic/400.css';
import '@fontsource/opendyslexic/700.css';

import './style.css'; // Kita akan buat style utama nanti

// Jika URL mengandung hash #debug, jalankan halaman debug Tahap 1
if (window.location.hash === '#debug') {
  import('./main').then(() => {
    console.log('Mode debug aktif.');
  });
} else {
  // Render aplikasi Preact utama
  const root = document.getElementById('app');
  if (root) {
    render(<App />, root);
  }
}
