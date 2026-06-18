export function monoFontStack() {
  return getComputedStyle(document.documentElement)
    .getPropertyValue('--font-mono').trim() || 'monospace';
}
