/**
 * CM6 split editor — second EditorView sharing the primary's state.
 * Transactions on either view are mirrored to the other (see cm6-mount.createSecondary).
 * State swap (setActiveState) fans out from the primary wrapper to both views.
 */
export function createEditorSplit({ host, primaryPane, primaryEditor }) {
  let splitPane = null;
  let splitResizer = null;
  let dragCleanup = null;
  let active = false;

  function enable() {
    if (active) return;
    host.classList.add('split-stack');

    splitResizer = document.createElement('div');
    splitResizer.className = 'editor-resizer';
    host.appendChild(splitResizer);

    splitPane = document.createElement('div');
    splitPane.className = 'editor-pane';
    host.appendChild(splitPane);

    primaryEditor.createSecondary(splitPane);
    setupResizerDrag();
    active = true;
  }

  function disable() {
    if (!active) return;
    if (dragCleanup) { dragCleanup(); dragCleanup = null; }
    primaryEditor.clearSecondary();
    if (splitPane) { splitPane.remove(); splitPane = null; }
    if (splitResizer) { splitResizer.remove(); splitResizer = null; }
    host.classList.remove('split-stack');
    primaryPane.style.flex = '';
    active = false;
  }

  function toggle() {
    if (active) disable();
    else enable();
  }

  function setupResizerDrag() {
    let dragging = false;
    let startY = 0;
    let startSize = 0;

    const onDown = (e) => {
      dragging = true;
      startY = e.clientY;
      startSize = primaryPane.getBoundingClientRect().height;
      document.body.style.cursor = 'row-resize';
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!dragging) return;
      const next = Math.max(80, startSize + (e.clientY - startY));
      primaryPane.style.flex = `0 0 ${next}px`;
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.cursor = '';
    };

    splitResizer.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);

    dragCleanup = () => {
      splitResizer.removeEventListener('mousedown', onDown);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }

  return {
    enable,
    disable,
    toggle,
    isActive: () => active,
    // Phase 1 legacy no-ops (view state lives in CM6 EditorState):
    syncModel() {},
    saveViewState: () => null,
    restoreViewState: () => {}
  };
}
