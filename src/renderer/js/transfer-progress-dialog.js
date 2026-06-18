/**
 * Upload/download progress dialog.
 *
 * Usage:
 *   openTransferDialog({
 *     kind: 'upload' | 'download',
 *     targetDir: string,       // for path display
 *     items: [{source, size, name, relativePath?}],
 *     totalBytes: number,
 *     wrapName?: string,
 *     onFinished?: () => void  // job finished (regardless of success/failure/cancel)
 *   })
 *
 * The dialog automatically issues a jobId → subscribes to onProgress → startJob → updates file rows.
 */

import { t } from './i18n.js';

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* For a URI, strip scheme/authority and keep only the path. Local paths are left as-is. */
function displayPath(p) {
  const s = String(p || '');
  const m = s.match(/^[a-z]+:\/\/[^/]*(\/.*)?$/i);
  return m ? (m[1] || '/') : s;
}

function formatBytes(n) {
  const bytes = Number(n) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function newJobId() {
  return `j-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Remote folder scan popup — the file-list aggregation step before a folder download.
 * Updates the discovered file count, cumulative size, and current folder as each directory is read; cancellable.
 * If it finishes within 200ms, the popup is never shown (avoids flicker for small folders — intentional UX delay).
 * Returns: { items, emptyDirs, totalBytes } / null when cancelled. Scan errors are thrown as-is (the caller does friendly mapping).
 */
export async function runRemoteScanDialog(folderUri) {
  const scanId = newJobId();
  const shownPath = displayPath(folderUri);

  const backdrop = document.createElement('div');
  backdrop.className = 'confirm-backdrop';
  backdrop.innerHTML = `
    <section class="transfer-dialog scan-dialog" role="dialog" aria-modal="true" aria-label="${esc(t('transfer.scanning'))}">
      <header class="transfer-head">
        <div class="transfer-title">${esc(t('transfer.scanning'))}</div>
        <div class="transfer-subtitle" title="${esc(shownPath)}">${esc(shownPath)}</div>
      </header>
      <div class="transfer-overall">
        <div class="transfer-overall-bar"><div class="transfer-overall-fill scan-fill"></div></div>
        <div class="transfer-overall-text">
          <span data-scan-count>${esc(t('transfer.scanFiles', { n: 0 }))}</span>
          <span data-scan-bytes>0 B</span>
        </div>
      </div>
      <div class="scan-dir" data-scan-dir>/</div>
      <footer class="transfer-actions">
        <button class="confirm-btn" data-action="cancel">${t('dlg.cancel')}</button>
      </footer>
    </section>
  `;
  const countEl = backdrop.querySelector('[data-scan-count]');
  const bytesEl = backdrop.querySelector('[data-scan-bytes]');
  const dirEl = backdrop.querySelector('[data-scan-dir]');
  const cancelBtn = backdrop.querySelector('[data-action="cancel"]');

  let cancelled = false;
  cancelBtn.addEventListener('click', async () => {
    cancelled = true;
    cancelBtn.disabled = true;
    cancelBtn.textContent = t('transfer.cancelling');
    try { await window.oyen.transfer.cancelScan(scanId); } catch {}
  });

  const unsub = window.oyen.transfer.onScanProgress(scanId, (p) => {
    if (!p) return;
    countEl.textContent = t('transfer.scanFiles', { n: p.files || 0 });
    bytesEl.textContent = formatBytes(p.bytes || 0);
    dirEl.textContent = p.dir || '/';
    dirEl.title = p.dir || '/';
  });

  let shown = false;
  const showTimer = setTimeout(() => { document.body.appendChild(backdrop); shown = true; }, 200);
  try {
    const result = await window.oyen.transfer.scanRemoteDirectory(folderUri, scanId);
    if (cancelled || result?.cancelled) return null;
    return result;
  } finally {
    clearTimeout(showTimer);
    unsub?.();
    if (shown) backdrop.remove();
  }
}

export async function openTransferDialog({ kind, targetDir, items, emptyDirs, totalBytes, wrapName, conflictPolicy, autoStart, onFinished }) {
  items = Array.isArray(items) ? items : [];
  const hasEmptyDirs = Array.isArray(emptyDirs) && emptyDirs.length > 0;
  if (items.length === 0 && !hasEmptyDirs) return;
  const jobId = newJobId();
  const isUpload = kind === 'upload';
  const title = isUpload ? t('transfer.upload') : t('transfer.download');
  const ingTitle = isUpload ? t('transfer.uploading') : t('transfer.downloading');

  const backdrop = document.createElement('div');
  backdrop.className = 'confirm-backdrop';
  const shownPath = displayPath(targetDir);
  backdrop.innerHTML = `
    <section class="transfer-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="transfer-head">
        <div class="transfer-title">${esc(title)}</div>
        <div class="transfer-subtitle" title="${esc(shownPath)}">${esc(shownPath)}</div>
      </header>
      <div class="transfer-overall">
        <div class="transfer-overall-bar"><div class="transfer-overall-fill" style="width:0%"></div></div>
        <div class="transfer-overall-text">
          <span data-overall-count>0 / ${items.length}</span>
          <span data-overall-bytes>0 B / ${formatBytes(totalBytes)}</span>
        </div>
      </div>
      <div class="transfer-list" data-list></div>
      <div class="transfer-error" data-error hidden></div>
      <footer class="transfer-actions">
        <button class="confirm-btn" data-action="cancel">${t('dlg.cancel')}</button>
        ${isUpload ? `<button class="confirm-btn accent" data-action="start">${t('transfer.startBtn')}</button>` : ''}
        <button class="confirm-btn primary" data-action="close" hidden>${t('dlg.close')}</button>
      </footer>
    </section>
  `;

  const listEl = backdrop.querySelector('[data-list]');
  const errorEl = backdrop.querySelector('[data-error]');
  const overallFill = backdrop.querySelector('.transfer-overall-fill');
  const overallCount = backdrop.querySelector('[data-overall-count]');
  const overallBytes = backdrop.querySelector('[data-overall-bytes]');
  const cancelBtn = backdrop.querySelector('[data-action="cancel"]');
  const closeBtn = backdrop.querySelector('[data-action="close"]');
  const startBtn = backdrop.querySelector('[data-action="start"]');
  const titleEl = backdrop.querySelector('.transfer-title');
  let jobStarted = false;

  /* Each file row */
  const fileBars = new Array(items.length);
  const fileStatuses = new Array(items.length);
  const bytesDoneArr = new Array(items.length).fill(0);
  let completedCount = 0;

  const labelPrefix = wrapName ? `${wrapName}/` : '';
  listEl.innerHTML = items.map((it, i) => {
    const label = labelPrefix + (it.relativePath || it.name || '');
    return `
      <div class="transfer-row" data-row="${i}">
        <div class="transfer-row-name" title="${esc(label)}">${esc(label)}</div>
        <div class="transfer-row-bar"><div class="transfer-row-fill" style="width:0%"></div></div>
        <div class="transfer-row-meta">
          <span class="transfer-row-size">${formatBytes(it.size || 0)}</span>
          <span class="transfer-row-status">${t('transfer.rowWaiting')}</span>
        </div>
      </div>
    `;
  }).join('');

  for (let i = 0; i < items.length; i++) {
    const row = listEl.querySelector(`.transfer-row[data-row="${i}"]`);
    fileBars[i] = row.querySelector('.transfer-row-fill');
    fileStatuses[i] = row.querySelector('.transfer-row-status');
  }

  /* Surface the failure message on screen as-is (for diagnostics — raw, no friendly mapping). */
  function showError(label, message) {
    const line = document.createElement('div');
    line.className = 'transfer-error-line';
    line.textContent = label ? `${label} — ${message}` : message;
    errorEl.appendChild(line);
    errorEl.hidden = false;
  }

  function updateOverall() {
    const sumBytes = bytesDoneArr.reduce((a, b) => a + b, 0);
    const pct = totalBytes > 0 ? Math.min(100, (sumBytes / totalBytes) * 100) : (completedCount / items.length * 100);
    overallFill.style.width = `${pct.toFixed(1)}%`;
    overallCount.textContent = `${completedCount} / ${items.length}`;
    overallBytes.textContent = `${formatBytes(sumBytes)} / ${formatBytes(totalBytes)}`;
  }

  function handleProgress(payload) {
    if (!payload) return;
    if (payload.type === 'file') {
      const i = payload.fileIndex;
      const item = items[i];
      const total = item?.size || 0;
      if (payload.status === 'progress') {
        const done = Math.min(payload.bytesDone || 0, total || Infinity);
        bytesDoneArr[i] = done;
        const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
        fileBars[i].style.width = `${pct.toFixed(1)}%`;
        fileStatuses[i].textContent = t('transfer.rowProgress');
        fileStatuses[i].className = 'transfer-row-status';
      } else if (payload.status === 'ok') {
        bytesDoneArr[i] = total;
        fileBars[i].style.width = '100%';
        fileBars[i].classList.add('done');
        fileStatuses[i].textContent = t('transfer.rowOk');
        fileStatuses[i].className = 'transfer-row-status ok';
        completedCount += 1;
      } else if (payload.status === 'error') {
        fileBars[i].classList.add('error');
        fileStatuses[i].textContent = t('transfer.rowError');
        fileStatuses[i].className = 'transfer-row-status error';
        fileStatuses[i].title = payload.message || '';
        showError(labelPrefix + (item?.relativePath || item?.name || ''), payload.message || t('transfer.rowError'));
        completedCount += 1;
      } else if (payload.status === 'cancelled') {
        fileStatuses[i].textContent = t('transfer.rowCancelled');
        fileStatuses[i].className = 'transfer-row-status cancelled';
        completedCount += 1;
      }
      updateOverall();
    } else if (payload.type === 'done') {
      updateOverall();
      cancelBtn.hidden = true;
      closeBtn.hidden = false;
      const failed = (payload.results || []).filter((r) => r.status === 'error').length;
      const cancelled = (payload.results || []).filter((r) => r.status === 'cancelled').length;
      /* Whole-job failure (e.g. wrap folder mkdir) — only a message arrives, with no rows. */
      if (payload.ok === false && payload.message) showError('', payload.message);
      if (payload.cancelled || cancelled) titleEl.textContent = t('transfer.cancelled', { title });
      else if (failed) titleEl.textContent = t('transfer.completeFailed', { title, n: failed });
      else if (payload.ok === false || payload.message) titleEl.textContent = t('transfer.failed', { title });
      else titleEl.textContent = t('transfer.complete', { title });
    }
  }

  const unsub = window.oyen.transfer.onProgress(jobId, handleProgress);

  /* Cancel button: if the job hasn't started, just close the dialog; if it has, call cancelJob. */
  cancelBtn.addEventListener('click', async () => {
    if (!jobStarted) {
      unsub?.();
      backdrop.remove();
      return;
    }
    cancelBtn.disabled = true;
    cancelBtn.textContent = t('transfer.cancelling');
    try { await window.oyen.transfer.cancelJob(jobId); } catch {}
  });

  closeBtn.addEventListener('click', () => {
    unsub?.();
    backdrop.remove();
    onFinished?.();
  });

  async function runJob() {
    jobStarted = true;
    if (startBtn) startBtn.hidden = true;
    titleEl.textContent = ingTitle;
    try {
      await window.oyen.transfer.startJob({ jobId, items, emptyDirs, targetDir, wrapName, conflictPolicy });
    } catch (err) {
      cancelBtn.hidden = true;
      closeBtn.hidden = false;
      showError('', String(err?.message || err));
      titleEl.textContent = t('transfer.failed', { title });
    }
  }

  document.body.appendChild(backdrop);

  /* Uploads only start when the user explicitly clicks the [Send] button (risk of changing the server). With autoStart it's already confirmed, so it starts immediately.
     Downloads start immediately since the folder-selection step acts as the confirmation. */
  if (isUpload && startBtn && !autoStart) {
    startBtn.addEventListener('click', runJob);
    startBtn.focus();
  } else {
    if (startBtn) startBtn.hidden = true;
    runJob();
  }
}
