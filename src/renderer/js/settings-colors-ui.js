import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { syntaxHighlighting } from '@codemirror/language';
import { oyenTheme, oyenHighlight, extensionForFileName, hideActiveLineOnSelection } from './cm6-extensions.js';
import {
  SUPPORTED_COLOR_LANGS,
  TOKEN_GROUPS,
  UI_GROUPS,
  GLOBAL_PREVIEW,
  buildSyntaxColorExtensions
} from './cm6-syntax-colors.js';
import { syntaxColorsCompartment } from './cm6-mount.js';
import { t } from './i18n.js';
import { monoFontStack } from './fonts.js';

const PREVIEW_DEBOUNCE_MS = 100;

function esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function normalizeHex(c) {
  if (!c) return '';
  const s = String(c).trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  const m3 = /^#?([0-9a-f]{3})$/i.exec(s);
  if (m3) return `#${m3[1].split('').map((ch) => ch + ch).join('').toLowerCase()}`;
  const m6 = /^#?([0-9a-f]{6})$/i.exec(s);
  if (m6) return `#${m6[1].toLowerCase()}`;
  return '';
}

/** Global group entry color (settings entry → fallback baseColor → fallback fg). */
function resolveGlobalColor(settings, groupId) {
  const groupDef = TOKEN_GROUPS.find((g) => g.id === groupId);
  const entry = settings?.global?.groups?.[groupId];
  return normalizeHex(entry?.color) || normalizeHex(groupDef?.baseColor) || '#d4d4d4';
}

/**
 * Mount the colors tab — global token colors + language-specific specials.
 * Mutates only the pending object. On save, settings-modal-ui applies it to disk + the main editor.
 */
export function mountColorsTab({ getSyntaxColors, resetSyntaxColors, getEditorFont }) {
  const detailEl = document.getElementById('colorsDetail');
  if (!detailEl) return { render: () => {}, activate: () => {} };

  let previewTimer = null;
  let previewView = null;

  function schedulePreview() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      previewTimer = null;
      refreshPreview();
    }, PREVIEW_DEBOUNCE_MS);
  }

  function mutate(mutator) {
    const all = getSyntaxColors() || {};
    mutator(all);
    schedulePreview();
  }

  function mutateGlobal(groupId, patch) {
    mutate((all) => {
      all.global = all.global || {};
      all.global.groups = { ...(all.global.groups || {}) };
      if (patch === null) {
        delete all.global.groups[groupId];
      } else {
        all.global.groups[groupId] = { ...(all.global.groups[groupId] || {}), ...patch };
      }
    });
  }

  function mutateUi(groupId, patch) {
    mutate((all) => {
      all.ui = all.ui || {};
      all.ui.groups = { ...(all.ui.groups || {}) };
      if (patch === null) {
        delete all.ui.groups[groupId];
      } else {
        all.ui.groups[groupId] = { ...(all.ui.groups[groupId] || {}), ...patch };
      }
    });
  }

  function mutateLangSpecial(langId, groupId, patch) {
    mutate((all) => {
      all[langId] = all[langId] || {};
      all[langId].groups = { ...(all[langId].groups || {}) };
      if (patch === null) {
        delete all[langId].groups[groupId];
      } else {
        all[langId].groups[groupId] = { ...(all[langId].groups[groupId] || {}), ...patch };
      }
    });
  }

  /* Apply the editor font/size to the preview — placed after oyenTheme to override only the font. */
  function fontTheme() {
    const f = (typeof getEditorFont === 'function' ? getEditorFont() : null) || {};
    const fontFamily = f.fontFamily || monoFontStack();
    const fontSize = Number(f.fontSize) || 14;
    return EditorView.theme({
      '&': { fontSize: `${fontSize}px` },
      '.cm-content': { fontFamily },
      '.cm-gutters': { fontFamily }
    });
  }

  function buildPreviewState() {
    return EditorState.create({
      doc: GLOBAL_PREVIEW.code,
      extensions: [
        basicSetup,
        oyenTheme,
        hideActiveLineOnSelection,
        fontTheme(),
        extensionForFileName(GLOBAL_PREVIEW.fileName),
        syntaxColorsCompartment.of(buildSyntaxColorExtensions(getSyntaxColors() || {})),
        syntaxHighlighting(oyenHighlight),
        EditorState.readOnly.of(true)
      ]
    });
  }

  function buildPreviewView() {
    const host = detailEl.querySelector('[data-preview-host]');
    if (!host) return;
    if (previewView) { try { previewView.destroy(); } catch (_) {} previewView = null; }
    host.innerHTML = '';
    previewView = new EditorView({ parent: host, state: buildPreviewState() });
  }

  function refreshPreview() {
    buildPreviewView();
  }

  /** Special sample for phpDollar: `$` uses the card color, the identifier part is dynamic with the global variable color. */
  function renderSampleHtmlPhpDollar(groupDef, entry, settings) {
    const dollarColor = normalizeHex(entry?.color) || normalizeHex(groupDef.baseColor) || '#c2780a';
    const variableColor = resolveGlobalColor(settings, 'variable');
    const sample = groupDef.sample || '';
    const parts = sample.split(/(\$\w+)/g);
    return parts.map((p) => {
      const m = /^\$(\w+)$/.exec(p);
      if (m) {
        return `<span style="color:${dollarColor}">$</span><span style="color:${variableColor}">${esc(m[1])}</span>`;
      }
      return esc(p);
    }).join('');
  }

  function renderSampleHtml(groupDef, entry, settings) {
    if (groupDef.kind === 'php-dollar') {
      return renderSampleHtmlPhpDollar(groupDef, entry, settings);
    }
    const color = normalizeHex(entry?.color) || normalizeHex(groupDef.baseColor) || '#d4d4d4';
    return `<span style="color:${color}">${esc(groupDef.sample)}</span>`;
  }

  function renderRow(groupDef, entry, opts = {}) {
    const settings = getSyntaxColors() || {};
    const swatchColor = normalizeHex(entry?.color) || normalizeHex(groupDef.baseColor) || '#d4d4d4';
    const hexShown = normalizeHex(entry?.color || groupDef.baseColor) || '—';
    const effectiveBold = entry?.bold !== undefined ? entry.bold : !!groupDef.baseBold;
    const effectiveItalic = entry?.italic !== undefined ? entry.italic : !!groupDef.baseItalic;
    const sampleStyle = [
      effectiveBold ? 'font-weight:700' : '',
      effectiveItalic ? 'font-style:italic' : ''
    ].filter(Boolean).join(';');
    return `
      <div class="colors-group-row" data-row data-scope="${esc(opts.scope || 'global')}" data-lang="${esc(opts.langId || '')}" data-group="${esc(groupDef.id)}">
        <div>
          <div class="colors-group-label">${esc(t(groupDef.labelKey))}</div>
          <div class="colors-group-sample" style="${sampleStyle}">${renderSampleHtml(groupDef, entry, settings)}</div>
        </div>
        <input type="color" class="colors-color-swatch" data-color value="${esc(swatchColor)}" />
        <span class="colors-hex-text">${esc(hexShown)}</span>
        <button type="button" class="colors-style-btn ${effectiveBold ? 'active' : ''}" data-style="bold" title="${t('settings.colors.bold')}">B</button>
        <button type="button" class="colors-style-btn ${effectiveItalic ? 'active' : ''}" data-style="italic" title="${t('settings.colors.italic')}"><i>I</i></button>
        <button type="button" class="colors-reset-btn" data-reset title="${t('settings.colors.resetGroup')}">↺</button>
      </div>
    `;
  }

  function renderUiRow(groupDef, entry) {
    const swatchColor = normalizeHex(entry?.color) || normalizeHex(groupDef.baseColor) || '#000000';
    const hexShown = normalizeHex(entry?.color || groupDef.baseColor) || '—';
    return `
      <div class="colors-group-row" data-row data-scope="ui" data-group="${esc(groupDef.id)}">
        <div>
          <div class="colors-group-label">${esc(t(groupDef.labelKey))}</div>
        </div>
        <input type="color" class="colors-color-swatch" data-color value="${esc(swatchColor)}" />
        <span class="colors-hex-text">${esc(hexShown)}</span>
        <span></span>
        <span></span>
        <button type="button" class="colors-reset-btn" data-reset title="${t('settings.colors.resetGroup')}">↺</button>
      </div>
    `;
  }

  function renderDetail() {
    const settings = getSyntaxColors() || {};
    const globalGroups = settings.global?.groups || {};
    const uiGroups = settings.ui?.groups || {};

    const uiRows = UI_GROUPS.map((g) => renderUiRow(g, uiGroups[g.id])).join('');
    const globalRows = TOKEN_GROUPS.map((g) => renderRow(g, globalGroups[g.id], { scope: 'global' })).join('');

    const langSections = SUPPORTED_COLOR_LANGS
      .filter((langDef) => (langDef.specialGroups || []).length > 0)
      .map((langDef) => {
        const langGroups = settings[langDef.id]?.groups || {};
        const specialRows = langDef.specialGroups
          .map((sg) => renderRow(sg, langGroups[sg.id], { scope: 'lang', langId: langDef.id }))
          .join('');
        return `
          <div class="colors-detail-section">
            <h3># ${esc(langDef.label)}</h3>
            ${specialRows}
          </div>
        `;
      }).join('');

    detailEl.innerHTML = `
      <div class="colors-detail-section colors-preview-section">
        <div class="colors-section-header">
          <h3>Preview</h3>
        </div>
        <div class="colors-preview-host" data-preview-host></div>
      </div>
      <div class="colors-detail-section">
        <h3>${t('settings.colors.editor')}</h3>
        ${uiRows}
      </div>
      <div class="colors-detail-section">
        <h3>${t('settings.colors.syntax')}</h3>
        ${globalRows}
      </div>
      ${langSections}
    `;

    buildPreviewView();
  }

  function rerender() { renderDetail(); }

  detailEl.addEventListener('input', (e) => {
    const target = e.target;
    const groupRow = target.closest('[data-row]');
    if (groupRow && target.matches('[data-color]')) {
      const scope = groupRow.dataset.scope;
      const gid = groupRow.dataset.group;
      const color = normalizeHex(target.value);
      if (scope === 'global') mutateGlobal(gid, { color });
      else if (scope === 'ui') mutateUi(gid, { color });
      else mutateLangSpecial(groupRow.dataset.lang, gid, { color });
      // live: hex text only. For phpDollar the sample also depends on the variable color, so just update the plain inline color
      const hex = groupRow.querySelector('.colors-hex-text');
      if (hex) hex.textContent = color;
      // variable also affects the phpDollar sample, but a full rerender recreates the color input
      // and closes the OS color picker → partial update only while adjusting. phpDollar refreshes on tab switch/reopen.
      // The sample color of its own row updates immediately (a full rerender is more accurate for phpDollar)
      if (groupRow.dataset.group === 'phpDollar' || groupRow.dataset.scope === 'lang') {
        // phpDollar has $ and name separated, so partial update is hard → re-render just that row's sample area
        const sampleEl = groupRow.querySelector('.colors-group-sample');
        const groupDef = scope === 'global'
          ? TOKEN_GROUPS.find((g) => g.id === gid)
          : SUPPORTED_COLOR_LANGS.find((l) => l.id === groupRow.dataset.lang)?.specialGroups.find((g) => g.id === gid);
        if (sampleEl && groupDef) {
          const entry = scope === 'global'
            ? (getSyntaxColors() || {}).global?.groups?.[gid]
            : (getSyntaxColors() || {})[groupRow.dataset.lang]?.groups?.[gid];
          sampleEl.innerHTML = renderSampleHtml(groupDef, entry, getSyntaxColors() || {});
        }
      } else {
        // regular group: update only the sample color
        const sampleSpan = groupRow.querySelector('.colors-group-sample span');
        if (sampleSpan) sampleSpan.style.color = color;
      }
      return;
    }
  });

  /* Reset all — called via colorsTab.resetAll() from the editor tab's reset button (settings-modal-ui). */
  function resetAll() {
    if (typeof resetSyntaxColors === 'function') {
      resetSyntaxColors();
    } else {
      // fallback: mutate target object in place
      const all = getSyntaxColors() || {};
      for (const k of Object.keys(all)) delete all[k];
    }
    schedulePreview();
    rerender();
  }

  detailEl.addEventListener('click', (e) => {
    const target = e.target;
    const groupRow = target.closest('[data-row]');
    if (!groupRow) return;
    const scope = groupRow.dataset.scope;
    const gid = groupRow.dataset.group;
    const lang = groupRow.dataset.lang;
    const settings = getSyntaxColors() || {};
    const entry = scope === 'global'
      ? settings.global?.groups?.[gid]
      : scope === 'ui'
        ? settings.ui?.groups?.[gid]
        : settings[lang]?.groups?.[gid];
    const setGroup = (patch) => {
      if (scope === 'global') return mutateGlobal(gid, patch);
      if (scope === 'ui') return mutateUi(gid, patch);
      return mutateLangSpecial(lang, gid, patch);
    };

    const groupDef = scope === 'global'
      ? TOKEN_GROUPS.find((g) => g.id === gid)
      : SUPPORTED_COLOR_LANGS.find((l) => l.id === lang)?.specialGroups.find((g) => g.id === gid);
    const currentBold = entry?.bold !== undefined ? entry.bold : !!groupDef?.baseBold;
    const currentItalic = entry?.italic !== undefined ? entry.italic : !!groupDef?.baseItalic;

    if (target.matches('[data-style="bold"]')) {
      setGroup({ bold: !currentBold });
      rerender();
    } else if (target.matches('[data-style="italic"]')) {
      setGroup({ italic: !currentItalic });
      rerender();
    } else if (target.matches('[data-reset]')) {
      setGroup(null);
      rerender();
    }
  });

  return {
    render: rerender,
    activate: () => rerender(),
    resetAll,
    refreshFont: schedulePreview
  };
}
