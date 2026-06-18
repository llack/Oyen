import { t } from './i18n.js';
import { confirmReload, notifyAlert } from './dialogs.js';
import { friendlyFsError } from './friendly-error.js';
import { runBusy } from './busy-lock.js';

function esc(v) {
  return String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* LRM (Left-to-Right Mark). When the path is truncated from the left (.git-file-dir direction:rtl), weak characters
   at the path's ends ('_'/'.' etc., e.g. __gitlisttest__) get reordered toward the rtl base direction; this prevents that bidi glitch. Wrap both ends in LRM. */
const LRM = '‎';

function joinAbs(root, rel) {
  if (!root) return rel;
  const sep = root.includes('\\') ? '\\' : '/';
  return root.replace(/[\\/]+$/, '') + sep + String(rel).replace(/\//g, sep);
}

/* Keep the main [✓ Commit] button's default action as the last commit-family action the user selected.
   amend / push / pull / sync / undoLastCommit are one-shot by intent, so they're excluded from being the default. */
const LAST_ACTION_KEY = 'oyen.git.lastCommitAction';
const DEFAULT_ACTION_KEYS = new Set(['commit', 'commit-push', 'commit-sync']);

function getLastDefaultAction() {
  try {
    const v = localStorage.getItem(LAST_ACTION_KEY);
    return DEFAULT_ACTION_KEYS.has(v) ? v : 'commit';
  } catch { return 'commit'; }
}

function saveLastDefaultAction(action) {
  if (!DEFAULT_ACTION_KEYS.has(action)) return;
  try { localStorage.setItem(LAST_ACTION_KEY, action); } catch { /* ignore */ }
}

export function mountGitPanel({ root, store, onOpenFile, onFileChangedOnDisk }) {
  if (!root) return { dispose: () => {} };

  root.innerHTML = `
    <div class="git-panel-header">
      <div class="git-branch-row">
        <span class="codicon codicon-git-branch git-branch-icon" aria-hidden="true"></span>
        <span class="git-branch-name" id="gitBranchName">—</span>
        <span class="git-sync-info" id="gitSyncInfo">
          <button type="button" class="git-sync-btn git-sync-pull" data-git-action="pull" hidden>↓<span class="git-sync-count">0</span></button>
          <button type="button" class="git-sync-btn git-sync-push" data-git-action="push" hidden>↑<span class="git-sync-count">0</span></button>
        </span>
      </div>
      <textarea class="git-commit-message" id="gitCommitMessage" rows="3" data-i18n-placeholder="git.commit.placeholder"></textarea>
      <div class="git-commit-actions">
        <button class="git-commit-btn" id="gitCommitBtn">
          <span data-commit-label>${esc(t('git.commit'))}</span>
        </button>
        <button class="git-commit-more" id="gitCommitMore" aria-label="${esc(t('git.commitMore'))}">
          <span class="codicon codicon-chevron-down" aria-hidden="true"></span>
        </button>
        <div class="git-commit-menu" id="gitCommitMenu" hidden>
          <button class="git-commit-menu-item" data-git-action="commit">${esc(t('git.commit'))}</button>
          <button class="git-commit-menu-item" data-git-action="amend">${esc(t('git.commit.amend'))}</button>
          <button class="git-commit-menu-item" data-git-action="commit-push">${esc(t('git.commit.push'))}</button>
          <button class="git-commit-menu-item" data-git-action="commit-sync">${esc(t('git.commit.sync'))}</button>
          <div class="git-commit-menu-sep"></div>
          <button class="git-commit-menu-item" data-git-action="push">${esc(t('git.action.push'))}</button>
          <button class="git-commit-menu-item" data-git-action="pull">${esc(t('git.action.pull'))}</button>
          <button class="git-commit-menu-item" data-git-action="sync">${esc(t('git.action.sync'))}</button>
          <div class="git-commit-menu-sep"></div>
          <button class="git-commit-menu-item" data-git-action="undoLastCommit">${esc(t('git.action.undoLastCommit'))}</button>
        </div>
      </div>
    </div>
    <div class="git-panel-list" id="gitPanelList"></div>
    <div class="git-split" id="gitHistorySplit" hidden></div>
    <div class="git-history" id="gitHistory" hidden>
      <div class="git-history-header" id="gitHistoryToggle">
        <span class="codicon codicon-chevron-down git-history-caret" aria-hidden="true"></span>
        <span class="git-history-label">${esc(t('git.section.history'))}</span>
      </div>
      <div class="git-history-list" id="gitHistoryList"></div>
    </div>
  `;

  const branchName = root.querySelector('#gitBranchName');
  const syncInfo = root.querySelector('#gitSyncInfo');
  const pullBtn = syncInfo?.querySelector('.git-sync-pull');
  const pushBtn = syncInfo?.querySelector('.git-sync-push');
  const messageEl = root.querySelector('#gitCommitMessage');
  const commitBtn = root.querySelector('#gitCommitBtn');
  const commitMore = root.querySelector('#gitCommitMore');
  const commitMenu = root.querySelector('#gitCommitMenu');
  const listEl = root.querySelector('#gitPanelList');
  const historyEl = root.querySelector('#gitHistory');
  const historyList = root.querySelector('#gitHistoryList');
  const historySplit = root.querySelector('#gitHistorySplit');
  const historyToggle = root.querySelector('#gitHistoryToggle');
  const historyCaret = historyToggle?.querySelector('.git-history-caret');

  /* i18n placeholder fixup — handle data-i18n-placeholder. */
  if (messageEl) messageEl.placeholder = t('git.commit.placeholder');

  const commitLabelEl = commitBtn?.querySelector('[data-commit-label]');
  function updateCommitBtnLabel(action) {
    if (!commitLabelEl) return;
    const labels = {
      'commit': t('git.commit'),
      'commit-push': t('git.commit.push'),
      'commit-sync': t('git.commit.sync')
    };
    commitLabelEl.textContent = labels[action] || labels['commit'];
  }
  /* Initial label — based on the last default action saved in localStorage. */
  updateCommitBtnLabel(getLastDefaultAction());

  commitBtn?.addEventListener('click', () => runCommit(getLastDefaultAction()));
  syncInfo?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-git-action]');
    if (!btn) return;
    runCommit(btn.dataset.gitAction);
  });
  commitMore?.addEventListener('click', (e) => {
    e.stopPropagation();
    commitMenu.hidden = !commitMenu.hidden;
  });

  const closeMenu = (e) => {
    if (!commitMenu) return;
    if (commitMenu.contains(e.target) || e.target === commitMore || commitMore?.contains(e.target)) return;
    commitMenu.hidden = true;
  };
  document.addEventListener('click', closeMenu);

  commitMenu?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-git-action]');
    if (!btn) return;
    commitMenu.hidden = true;
    const action = btn.dataset.gitAction;
    /* commit-family default candidates = only switch the main button mode (update label/default). Execution happens on the main [Commit] button click.
       amend/push/pull/sync/undoLastCommit are one-shot (can't be a main-button mode) — run directly from the menu. */
    if (DEFAULT_ACTION_KEYS.has(action)) {
      saveLastDefaultAction(action);
      updateCommitBtnLabel(action);
      return;
    }
    await runCommit(action);
  });

  listEl?.addEventListener('click', async (e) => {
    const actionBtn = e.target.closest('[data-file-action]');
    if (actionBtn) {
      e.stopPropagation();
      const file = actionBtn.dataset.file;
      const action = actionBtn.dataset.fileAction;
      const untracked = actionBtn.dataset.untracked === '1';
      await runFileAction(action, file, untracked);
      return;
    }
    const row = e.target.closest('.git-file-row');
    if (row && onOpenFile) {
      const absPath = row.dataset.absPath;
      const name = row.dataset.name;
      if (absPath) onOpenFile(absPath, name, row.dataset.rel || '');
    }
  });

  /* ── History section ──
     - Header click = collapse/expand toggle (arrow shows state). When collapsed, the changes take the whole area.
     - When expanded, drag the splitter above to resize the height.
     - Loads once on entering a root, and reloads after graph-changing actions (commit/pull/sync/undo). */
  let historyReqToken = 0;
  let historyRoot = null; /* Last loaded root — prevents reloading on every polling render */

  /* History area height (px, 0=half-and-half) / collapsed state — both persisted in localStorage. */
  const HISTORY_H_KEY = 'oyen.git.historyHeight';
  const HISTORY_COLLAPSED_KEY = 'oyen.git.historyCollapsed';
  let historyHeight = (() => {
    try {
      const v = parseInt(localStorage.getItem(HISTORY_H_KEY), 10);
      return Number.isFinite(v) && v > 0 ? v : 0;
    } catch { return 0; }
  })();
  let historyCollapsed = (() => {
    try { return localStorage.getItem(HISTORY_COLLAPSED_KEY) === '1'; } catch { return false; }
  })();

  /* Apply the height only when expanded (called from the drag onMove — lightweight). */
  function applyHistoryHeight() {
    if (!historyEl || historyCollapsed) return;
    historyEl.style.flex = historyHeight > 0 ? `0 0 ${historyHeight}px` : '';
  }

  /* Sync class/arrow/splitter/height according to collapsed/expanded state. */
  function syncHistoryUi() {
    if (historyEl) historyEl.classList.toggle('is-collapsed', historyCollapsed);
    if (historyCaret) {
      historyCaret.classList.toggle('codicon-chevron-down', !historyCollapsed);
      historyCaret.classList.toggle('codicon-chevron-right', historyCollapsed);
    }
    const visible = !!(historyEl && !historyEl.hidden);
    if (historySplit) historySplit.hidden = !visible || historyCollapsed;
    if (historyCollapsed) {
      if (historyEl) historyEl.style.flex = ''; /* CSS .is-collapsed = 0 0 auto */
    } else {
      applyHistoryHeight();
    }
  }
  syncHistoryUi();

  historyToggle?.addEventListener('click', () => {
    historyCollapsed = !historyCollapsed;
    try { localStorage.setItem(HISTORY_COLLAPSED_KEY, historyCollapsed ? '1' : '0'); } catch { /* ignore */ }
    syncHistoryUi();
  });

  historySplit?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    historySplit.setPointerCapture(e.pointerId);
    const panelRect = root.getBoundingClientRect();
    const headerH = root.querySelector('.git-panel-header')?.offsetHeight || 0;
    const minList = 80;  /* Minimum height for the changes list */
    const minHist = 60;  /* Minimum height for the history */
    const maxHist = panelRect.height - headerH - minList;

    const onMove = (me) => {
      /* History sits at the panel's bottom, so its height ≈ panel bottom - pointer y. */
      const h = panelRect.bottom - me.clientY;
      historyHeight = Math.round(Math.max(minHist, Math.min(h, maxHist)));
      applyHistoryHeight();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      try { localStorage.setItem(HISTORY_H_KEY, String(historyHeight)); } catch { /* ignore */ }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  /* VSCode Source Control Graph tone: left node (dot) + vertical connector line, message + author.
     Single vertical line only — no actual multi-branch graph rendering. The first commit (=HEAD) is a highlighted circle. */
  function historyRowHtml(c, isHead) {
    const tip = (c.message || '') + (c.shortHash ? `\n${c.shortHash}` : '');
    return `
      <div class="git-history-row${isHead ? ' is-head' : ''}" title="${esc(tip)}">
        <span class="git-history-graph"><span class="git-history-node"></span></span>
        <span class="git-history-body">
          <span class="git-history-msg">${esc(c.message)}</span>
          <span class="git-history-author">${esc(c.author)}</span>
        </span>
      </div>
    `;
  }

  async function loadHistory() {
    if (!historyList) return;
    const rp = store.getRootPath();
    if (!rp) { historyList.innerHTML = ''; return; }
    const token = ++historyReqToken;
    /* If rows already exist (=reload), don't flicker with the loading text; quietly replace when the result arrives. */
    const hadRows = !!historyList.querySelector('.git-history-row');
    if (!hadRows) historyList.innerHTML = `<div class="git-history-empty">${esc(t('git.history.loading'))}</div>`;
    const r = await window.oyen.git.log(rp, 30);
    if (token !== historyReqToken) return; /* Discard a late result from a root switch / duplicate call */
    const commits = (r && r.ok && Array.isArray(r.data)) ? r.data : [];
    historyList.innerHTML = commits.length
      ? commits.map((c, i) => historyRowHtml(c, i === 0)).join('')
      : `<div class="git-history-empty">${esc(t('git.history.empty'))}</div>`;
  }

  /* After a graph-changing action — reload if visible. */
  function reloadHistory() {
    if (historyEl && !historyEl.hidden) loadHistory();
  }

  function render(snapshot) {
    const rp = store.getRootPath();

    if (!snapshot || !snapshot.isRepo) {
      branchName.textContent = '—';
      applySyncInfo(0, 0);
      listEl.innerHTML = `<div class="git-panel-empty">${esc(t('git.noRepo'))}</div>`;
      commitBtn.disabled = true;
      commitMore.disabled = true;
      messageEl.disabled = true;
      if (historyEl) historyEl.hidden = true;
      if (historySplit) historySplit.hidden = true;
      historyRoot = null;
      return;
    }
    if (historyEl) historyEl.hidden = false;
    syncHistoryUi(); /* Reflect split visibility/collapse/arrow */
    /* Load only on entering a new root — don't re-request on every polling render (5s/12s). */
    if (rp !== historyRoot) {
      historyRoot = rp;
      loadHistory();
    }
    branchName.textContent = snapshot.branch || '(detached)';
    applySyncInfo(snapshot.ahead, snapshot.behind);
    applyMenuAvailability(snapshot.ahead, snapshot.behind);
    commitBtn.disabled = false;
    commitMore.disabled = false;
    messageEl.disabled = false;

    /* Two sections: Staged and Changes (modified+deleted+untracked). Each sorted alphabetically by path. */
    const staged = [];
    const changes = [];
    for (const f of snapshot.files) {
      if (f.untracked) {
        changes.push(f);
      } else if (f.staged && !f.unstaged) {
        staged.push(f);
      } else if (f.staged && f.unstaged) {
        staged.push(f);
        changes.push(f);
      } else {
        changes.push(f);
      }
    }
    staged.sort((a, b) => a.path.localeCompare(b.path));
    changes.sort((a, b) => a.path.localeCompare(b.path));

    const sections = [];
    if (staged.length) sections.push(sectionHtml('staged', t('git.section.staged'), staged));
    if (changes.length) sections.push(sectionHtml('changes', t('git.section.changes'), changes));

    listEl.innerHTML = sections.length
      ? sections.join('')
      : `<div class="git-panel-empty">${esc(t('git.noChanges'))}</div>`;
  }

  function sectionHtml(key, label, files) {
    return `
      <div class="git-section" data-section="${key}">
        <div class="git-section-header">
          <span class="git-section-label">${esc(label)} (${files.length})</span>
        </div>
        <div class="git-section-rows">
          ${files.map((f) => fileRowHtml(f, key)).join('')}
        </div>
      </div>
    `;
  }

  function fileRowHtml(f, section) {
    const relPath = f.path;
    const name = relPath.split('/').pop();
    const dir = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
    const absPath = joinAbs(store.getRootPath(), relPath);
    const actions = sectionActions(section, f);
    return `
      <div class="git-file-row" data-rel="${esc(relPath)}" data-abs-path="${esc(absPath)}" data-name="${esc(name)}" data-git-marker="${esc(f.marker)}" title="${esc(relPath)}">
        <span class="git-file-name">${esc(name)}</span>
        <span class="git-file-dir">${LRM}${esc(dir)}${LRM}</span>
        <span class="git-file-actions">${actions}</span>
        <span class="git-marker git-marker-${esc(f.marker)}">${esc(f.marker)}</span>
      </div>
    `;
  }

  function sectionActions(section, f) {
    /* Opening a file via row click is enough — no separate [Open] button. Hover buttons are only [Unstage] / [Discard][Stage]. */
    if (section === 'staged') {
      return `<button type="button" class="git-file-action" data-file-action="unstage" data-file="${esc(f.path)}" title="${esc(t('git.action.unstage'))}"><span class="codicon codicon-remove" aria-hidden="true"></span></button>`;
    }
    /* section === 'changes' — untracked / modified / deleted all land here. Branch per-file on the untracked flag. */
    if (f.untracked) {
      return `<button type="button" class="git-file-action" data-file-action="discard" data-file="${esc(f.path)}" data-untracked="1" title="${esc(t('git.action.deleteFile'))}"><span class="codicon codicon-trash" aria-hidden="true"></span></button>`
        + `<button type="button" class="git-file-action" data-file-action="stage" data-file="${esc(f.path)}" title="${esc(t('git.action.stage'))}"><span class="codicon codicon-add" aria-hidden="true"></span></button>`;
    }
    return `<button type="button" class="git-file-action" data-file-action="discard" data-file="${esc(f.path)}" data-untracked="0" title="${esc(t('git.action.discard'))}"><span class="codicon codicon-discard" aria-hidden="true"></span></button>`
      + `<button type="button" class="git-file-action" data-file-action="stage" data-file="${esc(f.path)}" title="${esc(t('git.action.stage'))}"><span class="codicon codicon-add" aria-hidden="true"></span></button>`;
  }

  function applyMenuAvailability(ahead, behind) {
    /* Standalone push/pull/sync are enabled only when there's ahead/behind. Commit-family is always enabled. */
    const pushItem = commitMenu?.querySelector('[data-git-action="push"]');
    const pullItem = commitMenu?.querySelector('[data-git-action="pull"]');
    const syncItem = commitMenu?.querySelector('[data-git-action="sync"]');
    if (pushItem) pushItem.disabled = !ahead;
    if (pullItem) pullItem.disabled = !behind;
    if (syncItem) syncItem.disabled = !ahead && !behind;
  }

  function applySyncInfo(ahead, behind) {
    if (pullBtn) {
      pullBtn.hidden = !behind;
      pullBtn.querySelector('.git-sync-count').textContent = behind || 0;
      pullBtn.title = behind ? t('git.action.pull') + ' (' + behind + ')' : '';
    }
    if (pushBtn) {
      pushBtn.hidden = !ahead;
      pushBtn.querySelector('.git-sync-count').textContent = ahead || 0;
      pushBtn.title = ahead ? t('git.action.push') + ' (' + ahead + ')' : '';
    }
  }

  async function runFileAction(action, file, untracked) {
    const rp = store.getRootPath();
    if (!rp || !file) return;
    if (action === 'discard') {
      const ok = await confirmReload(
        untracked ? t('git.confirm.deleteTitle') : t('git.confirm.discardTitle'),
        untracked ? t('git.confirm.deleteMessage') : t('git.confirm.discardMessage'),
        t('dlg.confirm'),
        t('dlg.cancel'),
        file
      );
      if (!ok) return;
    }
    /* Wrap in runBusy to block races while in progress + cursor:progress + automatic sidebar progress. */
    await runBusy(async () => {
      if (action === 'stage') {
        const r = await window.oyen.git.stage(rp, [file]);
        if (!r.ok) await notifyAlert(friendlyFsError(r.message, t('git.error.title')));
      } else if (action === 'unstage') {
        const r = await window.oyen.git.unstage(rp, [file]);
        if (!r.ok) await notifyAlert(friendlyFsError(r.message, t('git.error.title')));
      } else if (action === 'discard') {
        const r = await window.oyen.git.discard(rp, [file], untracked);
        if (!r.ok) await notifyAlert(friendlyFsError(r.message, t('git.error.title')));
        else if (!untracked && onFileChangedOnDisk) onFileChangedOnDisk(joinAbs(rp, file));
      }
    });
    store.refresh();
  }

  async function runCommit(action) {
    const rp = store.getRootPath();
    if (!rp) return;

    /* Running only push/pull/sync with no commit step. Message irrelevant. */
    if (action === 'push' || action === 'pull' || action === 'sync') {
      await runBusy(async () => {
        const r = await window.oyen.git[action](rp);
        if (!r.ok) await notifyAlert(friendlyFsError(r.message, t('git.error.title')));
      });
      store.refresh();
      reloadHistory();
      return;
    }

    if (action === 'undoLastCommit') {
      const ok = await confirmReload(
        t('git.confirm.undoLastCommitTitle'),
        t('git.confirm.undoLastCommitMessage'),
        t('dlg.confirm'),
        t('dlg.cancel')
      );
      if (!ok) return;
      await runBusy(async () => {
        const r = await window.oyen.git.undoLastCommit(rp);
        if (!r.ok) await notifyAlert(friendlyFsError(r.message, t('git.error.title')));
      });
      store.refresh();
      reloadHistory();
      return;
    }

    /* Commit family — commit / amend / commit-push / commit-sync. */
    const msg = messageEl.value.trim();
    /* amend is OK with an empty message (keeps the previous message). Otherwise a message is required. */
    if (action !== 'amend' && !msg) {
      await notifyAlert(t('git.error.emptyMessage'), t('git.error.title'));
      return;
    }
    await runBusy(async () => {
      /* GUI auto-stage: if not amend, staged is empty, and there are changes, stage them all. */
      if (action !== 'amend') {
        const snap = store.getSnapshot();
        if (snap && Array.isArray(snap.files)) {
          const hasStaged = snap.files.some((f) => f.staged);
          const toStage = snap.files.filter((f) => !f.staged).map((f) => f.path);
          if (!hasStaged && toStage.length > 0) {
            const sr = await window.oyen.git.stage(rp, toStage);
            if (!sr.ok) {
              await notifyAlert(friendlyFsError(sr.message, t('git.error.title')));
              return;
            }
          }
        }
      }
      const r = await window.oyen.git.commit(rp, msg, { amend: action === 'amend' });
      if (!r.ok) {
        await notifyAlert(friendlyFsError(r.message, t('git.error.title')));
        return;
      }
      messageEl.value = '';
      if (action === 'commit-push') {
        const p = await window.oyen.git.push(rp);
        if (!p.ok) await notifyAlert(friendlyFsError(p.message, t('git.error.title')));
      } else if (action === 'commit-sync') {
        const s = await window.oyen.git.sync(rp);
        if (!s.ok) await notifyAlert(friendlyFsError(s.message, t('git.error.title')));
      }
    });
    store.refresh();
    reloadHistory();
  }

  const unsubscribe = store.subscribe(render);

  return {
    dispose() {
      unsubscribe?.();
      document.removeEventListener('click', closeMenu);
    }
  };
}
