import { signal, effect } from '@preact/signals';

export type Theme = 'light' | 'sepia' | 'warm' | 'dark';
export type FontFamily = 'Literata' | 'Lora' | 'Merriweather' | 'Inter' | 'Lexend' | 'OpenDyslexic';
export type Alignment = 'left' | 'justify';

export interface ReaderSettings {
  theme: Theme;
  fontFamily: FontFamily;
  fontSize: number; // px
  lineHeight: number;
  margin: number; // px
  textWidth: number; // px
  alignment: Alignment;
  indent: boolean;
  dropCap: boolean;
}

export const defaultSettings: ReaderSettings = {
  theme: 'light',
  fontFamily: 'Literata',
  fontSize: 18,
  lineHeight: 1.6,
  margin: 20,
  textWidth: 700,
  alignment: 'justify',
  indent: true,
  dropCap: false,
};

// Load from localStorage if available
const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('pembaca-nyaman-settings') : null;
const initialSettings = saved ? { ...defaultSettings, ...JSON.parse(saved) } : defaultSettings;

export const settings = signal<ReaderSettings>(initialSettings);

// Effect to save to localStorage and apply CSS variables automatically
effect(() => {
  const s = settings.value;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('pembaca-nyaman-settings', JSON.stringify(s));
  }
  
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.setAttribute('data-theme', s.theme);
    if (s.dropCap) root.setAttribute('data-drop-cap', 'true');
    else root.removeAttribute('data-drop-cap');
  
  // Custom property mappings for dynamic styles
  root.style.setProperty('--font-family', `"${s.fontFamily}", ${['Inter', 'Lexend'].includes(s.fontFamily) ? 'sans-serif' : 'serif'}`);
  root.style.setProperty('--font-size', `${s.fontSize}px`);
  root.style.setProperty('--line-height', `${s.lineHeight}`);
  root.style.setProperty('--margin-x', `${s.margin}px`);
  root.style.setProperty('--max-width', `${s.textWidth}px`);
  root.style.setProperty('--text-align', s.alignment);
  root.style.setProperty('--text-indent', s.indent ? '1.5em' : '0');
  
  // Theme colors for Android/PWA status bar
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    const colors: Record<Theme, string> = {
      light: '#ffffff',
      sepia: '#f4ecd8',
      warm: '#e5e1d8',
      dark: '#1a1a1a'
    };
    metaTheme.setAttribute('content', colors[s.theme as Theme] || '#ffffff');
    }
  }
});
