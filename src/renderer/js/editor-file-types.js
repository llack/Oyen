import { languageLabelFromFileName } from './language-map.js';
import { t } from './i18n.js';

export function ext(name) {
  return ((name || '').split('.').pop() || '').toLowerCase();
}

export const isImage = (name) => /\.(png|jpe?g|gif|bmp|webp|svg|ico)$/i.test(name || '');
export const isPdf = (name) => /\.pdf$/i.test(name || '');
export const isVideo = (name) => /\.(mp4|webm|ogv|ogg)$/i.test(name || '');
export const isAudio = (name) => /\.(mp3|wav|flac|m4a|aac|opus)$/i.test(name || '');
export const isMd = (name) => /\.(md|markdown)$/i.test(name || '');
export const isOfficeDocument = (name) => /\.(doc|docx|xls|xlsx)$/i.test(name || '');
export const isWindowsShortcut = (name) => /\.lnk$/i.test(name || '');
export const isPrivateKey = (name) => /\.key$/i.test(name || '');
export const isInstaller = (name) => /\.msi$/i.test(name || '');

const TYPE_FORMATS = {
  png:  { name: 'PNG',  kind: 'image' },
  jpg:  { name: 'JPEG', kind: 'image' },
  jpeg: { name: 'JPEG', kind: 'image' },
  gif:  { name: 'GIF',  kind: 'image' },
  bmp:  { name: 'BMP',  kind: 'image' },
  webp: { name: 'WebP', kind: 'image' },
  svg:  { name: 'SVG',  kind: 'image' },
  ico:  { name: '',     kind: 'icon' },
  pdf:  { name: 'PDF',  kind: null },
  mp4:  { name: 'MP4',  kind: 'video' },
  webm: { name: 'WebM', kind: 'video' },
  ogv:  { name: 'Ogg',  kind: 'video' },
  ogg:  { name: 'Ogg',  kind: 'video' },
  mp3:  { name: 'MP3',  kind: 'audio' },
  wav:  { name: 'WAV',  kind: 'audio' },
  flac: { name: 'FLAC', kind: 'audio' },
  m4a:  { name: 'M4A',  kind: 'audio' },
  aac:  { name: 'AAC',  kind: 'audio' },
  opus: { name: 'Opus', kind: 'audio' }
};

export function typeLabelFromFile(name) {
  const entry = TYPE_FORMATS[ext(name)];
  if (!entry) return languageLabelFromFileName(name);
  if (!entry.kind) return entry.name;
  const kind = t(`type.kind.${entry.kind}`);
  return entry.name ? `${entry.name} ${kind}` : kind;
}

const IMAGE_FORMATS = {
  jpg: 'JPG',
  jpeg: 'JPG',
  png: 'PNG',
  gif: 'GIF',
  bmp: 'BMP',
  webp: 'WEBP',
  svg: 'SVG',
  ico: 'ICO'
};

export function imageFormatLabel(name) {
  return IMAGE_FORMATS[ext(name)] || '';
}

export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${Math.round(bytes).toLocaleString('en-US')} b`;

  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb).toLocaleString('en-US')} KB`;

  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MB`;

  const gb = mb / 1024;
  if (gb < 1024) return `${gb.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GB`;

  const tb = gb / 1024;
  return `${tb.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TB`;
}

export function eolFromContent(content) {
  if (/\r\n/.test(content || '')) return 'CRLF';
  if (/\n/.test(content || '')) return 'LF';
  if (/\r/.test(content || '')) return 'CR';
  return 'No EOL';
}
