export function mountRootSelect(container, { options, initialKey, onChange }) {
  let opts = Array.isArray(options) ? options.slice() : [];
  let currentKey = initialKey;
  let open = false;

  container.classList.add('root-select');
  container.innerHTML = `
    <button type="button" class="root-select-trigger">
      <span class="root-select-label"></span>
      <span class="root-select-arrow"></span>
    </button>
    <ul class="root-select-options" hidden></ul>
  `;

  const trigger = container.querySelector('.root-select-trigger');
  const labelEl = container.querySelector('.root-select-label');
  const list = container.querySelector('.root-select-options');

  const esc = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function render() {
    const cur = opts.find((o) => o.key === currentKey);
    labelEl.textContent = cur?.label || '';
    list.innerHTML = opts.map((item) => `
      <li class="root-select-option ${item.key === currentKey ? 'active' : ''}" data-key="${esc(item.key)}" title="${esc(item.label)}">
        ${item.icon ? `<span class="root-select-icon">${item.icon}</span>` : ''}
        <span class="root-select-option-text">${esc(item.label)}</span>
      </li>
    `).join('');
  }

  function setOpen(next) {
    open = next;
    list.hidden = !open;
    container.classList.toggle('open', open);
  }

  trigger.addEventListener('click', () => {
    setOpen(!open);
  });

  list.addEventListener('click', (event) => {
    const li = event.target.closest('.root-select-option');
    if (!li) return;
    const key = li.dataset.key;
    if (!key) {
      setOpen(false);
      return;
    }
    currentKey = key;
    render();
    setOpen(false);
    if (typeof onChange === 'function') onChange(key);
  });

  document.addEventListener('click', (event) => {
    if (!container.contains(event.target)) setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open) setOpen(false);
  });

  render();

  return {
    setOptions(nextOptions, nextKey) {
      opts = Array.isArray(nextOptions) ? nextOptions.slice() : [];
      currentKey = nextKey ?? currentKey;
      render();
    },
    setActive(key) {
      currentKey = key;
      render();
    },
    getKey() { return currentKey; }
  };
}
