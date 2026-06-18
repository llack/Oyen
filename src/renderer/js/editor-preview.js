import MarkdownIt from 'markdown-it';
import iconZoomIn from '@tabler/icons/outline/zoom-in.svg?raw';
import iconZoomOut from '@tabler/icons/outline/zoom-out.svg?raw';
import iconFit from '@tabler/icons/outline/arrows-maximize.svg?raw';
import {
  typeLabelFromFile, imageFormatLabel, formatFileSize, eolFromContent
} from './editor-file-types.js';
import { t } from './i18n.js';

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false
});
const defaultLinkOpen = markdown.renderer.rules.link_open
  || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
markdown.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  token.attrSet('target', '_blank');
  token.attrSet('rel', 'noopener noreferrer');
  return defaultLinkOpen(tokens, idx, options, env, self);
};

const esc = (v) => String(v || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function renderMarkdown(mdText) {
  const html = markdown.render(mdText || '');
  return `<div class="markdown-preview"><article class="markdown-body">${html}</article></div>`;
}

/**
 * Image viewer. Zoom/pan via transform: translate + scale.
 * - default mode: 'fit' — fits the box with CSS max-width/height: 100%
 * - 'zoom' mode: entered via wheel / button click. scale + translate via transform.
 * - Ctrl+wheel: anchored to the mouse pointer position (preserves the exact imageX/Y)
 * - drag: in zoom mode, mousedown→mousemove moves the translate
 * - double-click: return to fit
 *
 * State (scale/tx/ty/mode) is kept in the closure. Preserved even when the DOM is reattached via the tab cache (`previewNode`).
 */
function buildImageViewer(src, altText, onLoad) {
  const wrap = document.createElement('div');
  wrap.className = 'image-preview-wrap';

  const toolbar = document.createElement('div');
  toolbar.className = 'image-preview-toolbar';
  toolbar.innerHTML = `
    <button type="button" class="ipv-btn" data-action="zoomOut" title="${t('imageViewer.zoomOut')}">${iconZoomOut}</button>
    <span class="ipv-percent" data-percent>100%</span>
    <button type="button" class="ipv-btn" data-action="zoomIn" title="${t('imageViewer.zoomIn')}">${iconZoomIn}</button>
    <span class="ipv-sep"></span>
    <button type="button" class="ipv-btn" data-action="fit" title="${t('imageViewer.fit')}">${iconFit}</button>
  `;

  const box = document.createElement('div');
  box.className = 'image-preview-box';

  const img = document.createElement('img');
  img.className = 'image-preview-img';
  img.src = src;
  img.alt = altText || '';
  img.draggable = false;

  box.appendChild(img);
  wrap.appendChild(toolbar);
  wrap.appendChild(box);

  const percentEl = toolbar.querySelector('[data-percent]');

  let mode = 'fit';
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let natW = 0;
  let natH = 0;

  function fitScale() {
    if (!natW || !natH) return 1;
    const bw = box.clientWidth || 1;
    const bh = box.clientHeight || 1;
    return Math.min(bw / natW, bh / natH, 1);
  }

  function updatePercent() {
    const effective = mode === 'fit' ? fitScale() : scale;
    percentEl.textContent = `${Math.round(effective * 100)}%`;
  }

  function applyTransform() {
    if (mode === 'fit') {
      img.classList.remove('transformed');
      img.style.transform = '';
      box.classList.remove('zoomed');
    } else {
      img.classList.add('transformed');
      img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
      box.classList.add('zoomed');
    }
    updatePercent();
  }

  function enterZoom(initialScale) {
    mode = 'zoom';
    scale = initialScale;
    tx = (box.clientWidth - natW * scale) / 2;
    ty = (box.clientHeight - natH * scale) / 2;
    applyTransform();
  }

  function setScaleAt(newScale, mx, my) {
    const clamped = Math.max(0.05, Math.min(10, newScale));
    /* Adjust tx/ty so the image point under the mouse pointer stays at the same screen position after zooming. */
    const imgX = (mx - tx) / scale;
    const imgY = (my - ty) / scale;
    tx = mx - imgX * clamped;
    ty = my - imgY * clamped;
    scale = clamped;
    applyTransform();
  }

  function zoomBy(factor, mx, my) {
    if (mode === 'fit') enterZoom(fitScale());
    setScaleAt(scale * factor, mx, my);
  }

  function toFit() {
    mode = 'fit';
    scale = 1;
    tx = 0;
    ty = 0;
    applyTransform();
  }

  img.addEventListener('load', () => {
    natW = img.naturalWidth;
    natH = img.naturalHeight;
    updatePercent();
    if (typeof onLoad === 'function') onLoad();
  }, { once: true });

  toolbar.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    event.preventDefault();
    const cx = box.clientWidth / 2;
    const cy = box.clientHeight / 2;
    const action = btn.dataset.action;
    if (action === 'zoomOut') zoomBy(1 / 1.25, cx, cy);
    else if (action === 'zoomIn') zoomBy(1.25, cx, cy);
    else if (action === 'fit') toFit();
  });

  box.addEventListener('wheel', (event) => {
    /* Wheel: zoom anchored to the mouse pointer position. */
    event.preventDefault();
    const rect = box.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    zoomBy(factor, mx, my);
  }, { passive: false });

  box.addEventListener('mousedown', (event) => {
    if (mode !== 'zoom') return;
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const baseTx = tx;
    const baseTy = ty;
    box.classList.add('grabbing');
    const onMove = (e) => {
      tx = baseTx + (e.clientX - startX);
      ty = baseTy + (e.clientY - startY);
      applyTransform();
    };
    const onUp = () => {
      box.classList.remove('grabbing');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  img.addEventListener('dblclick', () => {
    toFit();
  });

  /* Handle box resize — recompute the box center on both axes. */
  let prevCy = 0;
  const ro = new ResizeObserver(() => {
    const cy = box.clientHeight / 2;
    if (mode === 'zoom') {
      tx = (box.clientWidth - natW * scale) / 2;
      if (prevCy) ty += (cy - prevCy);
      applyTransform();
    } else {
      updatePercent();
    }
    prevCy = cy;
  });
  ro.observe(box);

  return { wrap, img };
}

function waitForPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export function createEditorPreview({ previewRoot, hostTarget, setStatus }) {
  function showPreviewProgress() {
    const progress = document.createElement('div');
    progress.className = 'editor-progress';
    progress.setAttribute('aria-label', 'loading');
    progress.innerHTML = '<div class="editor-progress-bar"></div>';
    previewRoot.appendChild(progress);
    return progress;
  }

  function showLoadingView(tab) {
    hostTarget.hidden = true;
    previewRoot.hidden = false;
    previewRoot.innerHTML = `<div class="loading-preview"><div class="editor-progress" aria-label="${t('aria.loading')}"><div class="editor-progress-bar"></div></div></div>`;
    setStatus(tab.path, []);
  }

  /* Detach a once-built media node and reuse it on the next visit — avoids re-requesting src on every tab switch. */
  function reuseCachedPreview(tab) {
    if (!tab.previewNode) return false;
    previewRoot.appendChild(tab.previewNode);
    setStatus(tab.path, tab.previewStatus || (tab.size ? [formatFileSize(tab.size)] : []));
    return true;
  }

  function rememberPreview(tab, node, status) {
    tab.previewNode = node;
    tab.previewStatus = status;
  }

  function renderPreviewFailure(name) {
    previewRoot.innerHTML = `
      <div class="unsupported-preview file-preview-empty-wrap">
        <div class="file-preview-empty-icon" aria-hidden="true">⚠</div>
        <div class="file-preview-empty-name">${esc(name || '')}</div>
        <div class="file-preview-empty">${t('preview.loadFailed')}</div>
      </div>
    `;
  }

  async function fetchMediaUrl(tab) {
    if (!tab.mediaUrl) {
      tab.mediaUrl = await window.oyen.localFs.getMediaUrl(tab.path);
    }
    return tab.mediaUrl;
  }

  async function showPreview(tab) {
    hostTarget.hidden = true;
    previewRoot.hidden = false;
    previewRoot.innerHTML = '';

    if (reuseCachedPreview(tab)) return;

    setStatus(tab.path, tab.size ? [formatFileSize(tab.size)] : []);

    if (tab.type === 'image' || tab.type === 'pdf') {
      const progress = showPreviewProgress();
      await waitForPaint();
      const data = await fetchMediaUrl(tab);
      if (!data?.ok || !data.url) { renderPreviewFailure(tab.name); return; }

      if (tab.type === 'image') {
        const viewer = buildImageViewer(data.url, tab.name, () => {
          progress.remove();
          const w = viewer.img.naturalWidth;
          const h = viewer.img.naturalHeight;
          const size = w && h ? `${w} x ${h}` : '';
          const status = [imageFormatLabel(tab.name), size, formatFileSize(data.size)];
          setStatus(tab.path, status);
          rememberPreview(tab, viewer.wrap, status);
        });
        viewer.img.addEventListener('error', () => progress.remove(), { once: true });
        previewRoot.appendChild(viewer.wrap);
        return;
      }

      const box = document.createElement('div');
      box.className = 'pdf-preview';
      const frame = document.createElement('iframe');
      frame.className = 'file-preview-frame';
      frame.src = data.url;
      frame.addEventListener('load', () => {
        progress.remove();
        const status = [typeLabelFromFile(tab.name), formatFileSize(data.size)];
        setStatus(tab.path, status);
        rememberPreview(tab, box, status);
      }, { once: true });
      box.appendChild(frame);
      previewRoot.appendChild(box);
      return;
    }

    if (tab.type === 'video' || tab.type === 'audio') {
      const progress = showPreviewProgress();
      await waitForPaint();
      const mediaUrl = await fetchMediaUrl(tab);
      if (!mediaUrl?.ok || !mediaUrl.url) { renderPreviewFailure(tab.name); return; }

      const box = document.createElement('div');
      box.className = `media-preview-box ${tab.type === 'audio' ? 'audio' : 'video'}`;
      const media = document.createElement(tab.type === 'audio' ? 'audio' : 'video');
      media.className = 'media-preview-player';
      media.controls = true;
      media.preload = 'metadata';
      media.src = mediaUrl.url;
      media.addEventListener('loadedmetadata', () => {
        progress.remove();
        const detail = tab.type === 'video' && media.videoWidth && media.videoHeight
          ? `${media.videoWidth} x ${media.videoHeight}`
          : '';
        const status = [typeLabelFromFile(tab.name), detail, formatFileSize(mediaUrl.size)];
        setStatus(tab.path, status);
        rememberPreview(tab, box, status);
      }, { once: true });
      media.addEventListener('error', () => {
        progress.remove();
        box.innerHTML = `
          <div class="unsupported-preview file-preview-empty-wrap">
            <div class="file-preview-empty-icon" aria-hidden="true">⚠</div>
            <div class="file-preview-empty-name">${esc(tab.name)}</div>
            <div class="file-preview-empty">${t('preview.unsupportedMedia')}</div>
          </div>
        `;
        setStatus(tab.path, []);
      }, { once: true });
      box.appendChild(media);
      previewRoot.appendChild(box);
      return;
    }

    if (tab.type === 'markdown') {
      /* The dirty state during editing must be shown as-is, so prefer the CM6 state's doc when present. */
      const text = tab.state ? tab.state.doc.toString() : (tab.content || '');
      setStatus(tab.path, [tab.encoding || 'UTF-8', eolFromContent(text), typeLabelFromFile(tab.name), formatFileSize(tab.size)]);
      previewRoot.innerHTML = renderMarkdown(text);
      return;
    }

    setStatus(tab.path, []);
    previewRoot.innerHTML = `
      <div class="unsupported-preview file-preview-empty-wrap">
        <div class="file-preview-empty-icon" aria-hidden="true">⚠</div>
        <div class="file-preview-empty-name">${esc(tab.name)}</div>
        <div class="file-preview-empty">${t('preview.unsupportedEncoding')}</div>
      </div>
    `;
  }

  return { showPreview, showLoadingView };
}
