/**
 * Single source for git status. Both git-panel-ui and file-tree-ui subscribe.
 * - Fetches immediately when rootPath changes.
 * - Polls on an intervalMs cycle.
 * - refresh() allows an immediate update right after an action.
 */
export function createGitStatusStore({ intervalMs = 5000, remoteIntervalMs = 12000, fetchIntervalMs = 120000 } = {}) {
  let rootPath = '';
  let snapshot = null;
  const handlers = new Set();
  let timer = null;
  let fetchTimer = null;
  let inflight = null;
  let active = true;

  function isRemote() {
    return /^sftp:\/\//i.test(rootPath);
  }
  /* Remote uses a longer status polling interval because ssh exec is expensive. External/agent changes are
     covered by blur-stop + focus-immediate-refresh (app.js wiring). */
  function statusInterval() {
    return isRemote() ? remoteIntervalMs : intervalMs;
  }

  async function fetchOnce() {
    if (!rootPath) {
      snapshot = null;
      notify();
      return;
    }
    const fetchRoot = rootPath;
    /* Reuse the in-flight request if it's for the same root (avoid duplicate calls). If the in-flight request is for a changed root, ignore it and fetch anew
       — otherwise switching projects reuses the previous project's fetch and never fetches B. */
    if (inflight && inflight.root === fetchRoot) return inflight.promise;
    const promise = (async () => {
      let data;
      try {
        const r = await window.oyen?.git?.status(fetchRoot);
        data = (r && r.ok) ? r.data : undefined;
      } catch {
        data = undefined;
      }
      /* If root changed in the meantime, discard this result (prevents the previous project's git from lingering). */
      if (fetchRoot !== rootPath) return;
      /* Apply only on success. On a transient failure (undefined), keep the last snapshot → prevents flicker. */
      if (data !== undefined) snapshot = data;
      notify();
    })();
    inflight = { root: fetchRoot, promise };
    promise.finally(() => { if (inflight && inflight.promise === promise) inflight = null; });
    return promise;
  }

  function notify() {
    for (const h of handlers) {
      try { h(snapshot); } catch { /* ignore subscriber error */ }
    }
  }

  function setRoot(root) {
    if (root === rootPath) return;
    rootPath = String(root || '');
    snapshot = null;
    notify();
    /* If the root type changes (local↔remote), the polling interval differs too, so rebuild the timer. */
    if (timer) restartTimer();
    fetchOnce();
  }

  async function fetchRemote() {
    if (!rootPath) return;
    /* git fetch doesn't touch the working tree — safe in the background. Auth failures, etc. are silently ignored. */
    try { await window.oyen?.git?.fetch?.(rootPath); } catch { /* silent */ }
    /* Recompute status after fetch — refreshes the behind count. */
    await fetchOnce();
  }

  function clearTimers() {
    if (timer) { clearInterval(timer); timer = null; }
    if (fetchTimer) { clearInterval(fetchTimer); fetchTimer = null; }
  }

  function restartTimer() {
    clearTimers();
    timer = setInterval(fetchOnce, statusInterval());
    fetchTimer = setInterval(fetchRemote, fetchIntervalMs);
  }

  function start() {
    if (timer) return;
    fetchOnce();
    restartTimer();
  }

  function stop() {
    clearTimers();
  }

  /* Window focus/blur integration. On blur, stop polling (especially the expensive remote case); on focus, resume + refresh immediately
     → reflects external/agent changes as soon as you return. */
  function setActive(next) {
    const val = !!next;
    if (val === active) return;
    active = val;
    if (active) {
      restartTimer();
      fetchOnce();
    } else {
      clearTimers();
    }
  }

  function subscribe(handler) {
    handlers.add(handler);
    /* Push the current value immediately — so a newly mounted component receives data. */
    try { handler(snapshot); } catch {}
    return () => handlers.delete(handler);
  }

  return {
    start, stop, setRoot, setActive, subscribe, refresh: fetchOnce,
    getSnapshot: () => snapshot,
    getRootPath: () => rootPath
  };
}
