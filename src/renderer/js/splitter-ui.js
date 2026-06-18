/**
 * Left pane width + tree/file-list split.
 * - initial: receives { leftPaneWidth, treeHeight } and applies it immediately on mount
 * - onChange: called at drag end (pointerup) — triggers settings save
 */
export function mountSplitters({ initial = {}, onChange } = {}) {
  const main = document.getElementById('mainLayout');
  const left = document.getElementById('leftPane');
  const treeSplit = document.getElementById('treeSplit');
  const mainSplit = document.getElementById('mainSplit');

  const state = {
    leftPaneWidth: Number(initial.leftPaneWidth) || 275,
    treeHeight: Number(initial.treeHeight) || 0  // 0 defaults to 1fr
  };

  function applyLeftPaneWidth(px) {
    main.style.gridTemplateColumns = `${px}px 3px 1fr`;
  }
  function applyTreeHeight(px) {
    if (px > 0) {
      left.style.gridTemplateRows = `28px 30px ${px}px 3px 1fr`;
    }
  }

  /* Apply the saved values immediately on startup. */
  applyLeftPaneWidth(state.leftPaneWidth);
  applyTreeHeight(state.treeHeight);

  function notify() {
    if (typeof onChange === 'function') onChange({ ...state });
  }

  treeSplit.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    treeSplit.setPointerCapture(event.pointerId);

    const leftRect = left.getBoundingClientRect();
    const minTree = 80;
    const minFiles = 80;

    const onMove = (moveEvent) => {
      const offsetY = moveEvent.clientY - leftRect.top;
      const maxTree = leftRect.height - 28 - 30 - 3 - minFiles;
      const treeHeight = Math.max(minTree, Math.min(offsetY - 58, maxTree));
      state.treeHeight = Math.round(treeHeight);
      applyTreeHeight(state.treeHeight);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      notify();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  mainSplit.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    mainSplit.setPointerCapture(event.pointerId);

    const mainRect = main.getBoundingClientRect();
    const minLeft = 180;
    const minRight = 320;

    const onMove = (moveEvent) => {
      const leftWidth = moveEvent.clientX - mainRect.left;
      const maxLeft = mainRect.width - 3 - minRight;
      const clampedLeft = Math.max(minLeft, Math.min(leftWidth, maxLeft));
      state.leftPaneWidth = Math.round(clampedLeft);
      applyLeftPaneWidth(state.leftPaneWidth);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      notify();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}
