export const themes = {
  darkModern: {
    '--win-bg': '#1E1E1E',
    '--text': '#D4D4D4',
    '--menu-bg': '#252526',
    '--toolbar-bg': '#2D2D30',
    '--line': '#3C3C3C',
    '--line-strong': '#4A4A4A',
    '--panel-bg': '#252526',
    '--panel-sub-bg': '#2D2D30',
    '--editor-bg': '#1E1E1E',
    '--tab-bg': '#1E1E1E',
    '--status-bg': '#252526',
    '--resizer-bg': '#3C3C3C',
    '--status-text': '#FFFFFF'
  }
};

export function applyTheme(name) {
  const theme = themes[name];
  if (!theme) return;

  Object.entries(theme).forEach(([key, value]) => {
    document.documentElement.style.setProperty(key, value);
  });
}


