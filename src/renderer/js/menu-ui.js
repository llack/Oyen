const SUBMENU_OPEN_DELAY_MS = 180;
const SUBMENU_CLOSE_DELAY_MS = 200;

/* item.checked (value or function) → leading checkmark. Re-evaluated in openMenu for top-level, in rebuildItems for submenus. */
function applyCheckmark(iconEl, item) {
  const checked = typeof item?.checked === 'function' ? item.checked() : item?.checked;
  iconEl.textContent = checked ? '✓' : '';
  iconEl.classList.toggle('menu-icon-checked', !!checked);
}

function createMenuRow(item) {
  if (item.sep) {
    const sep = document.createElement('div');
    sep.className = 'menu-sep';
    return sep;
  }

  const row = document.createElement('div');
  const hasSubtext = !!item.subtext;
  let cls = hasSubtext ? 'menu-row with-subtext' : (item.noShortcut ? 'menu-row no-shortcut' : 'menu-row');
  if (item.disabled) cls += ' disabled';
  row.className = cls;

  const icon = document.createElement('span');
  icon.className = 'menu-icon';
  applyCheckmark(icon, item);

  const text = document.createElement('span');
  text.className = 'menu-row-text';
  text.textContent = item.text;

  row.append(icon, text);
  row._menuItem = item;
  row._menuIcon = icon;

  if (hasSubtext) {
    const sub = document.createElement('span');
    sub.className = 'menu-row-subtext';
    sub.textContent = item.subtext;
    row.title = item.fullPath || item.subtext;
    row.append(sub);
  } else if (!item.noShortcut) {
    const key = document.createElement('span');
    key.className = 'menu-key';
    key.textContent = item.key || item.arrow || '';
    row.append(key);
  }

  return row;
}

function isSubmenuItem(item) {
  return !item.sep && (Array.isArray(item.children) || typeof item.getChildren === 'function');
}

/**
 * Submenu component that expands beside the parent row.
 * - hover parentRow → expand after SUBMENU_OPEN_DELAY_MS
 * - moving from parentRow → submenu DOM keeps it open. Leaving elsewhere closes it after SUBMENU_CLOSE_DELAY_MS.
 * - the submenu DOM follows the same hover/leave pattern.
 * - children is an array or a callback (getChildren). The callback runs on each expand → dynamic lists like recents.
 */
function createSubmenu({ item, parentRow, parentMenu, onAction, onAnyAction }) {
  const submenu = document.createElement('div');
  submenu.className = 'dropdown-submenu';
  submenu.setAttribute('hidden', '');

  let openTimer = 0;
  let closeTimer = 0;
  let isOpen = false;

  function clearTimers() {
    if (openTimer) { clearTimeout(openTimer); openTimer = 0; }
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = 0; }
  }

  function rebuildItems() {
    submenu.innerHTML = '';
    const children = typeof item.getChildren === 'function' ? item.getChildren() : (item.children || []);
    if (!children.length) {
      const empty = document.createElement('div');
      empty.className = 'menu-row no-shortcut disabled menu-empty';
      const icon = document.createElement('span');
      icon.className = 'menu-icon';
      const text = document.createElement('span');
      text.textContent = item.emptyText || '';
      empty.append(icon, text);
      submenu.append(empty);
      return;
    }
    for (const child of children) {
      const row = createMenuRow(child);
      if (!child.sep && !child.disabled && child.action) {
        row.addEventListener('click', (event) => {
          event.stopPropagation();
          onAction?.(child.action, child);
          onAnyAction?.();
        });
      }
      submenu.append(row);
    }
  }

  function position() {
    const parentRect = parentMenu.getBoundingClientRect();
    const rowRect = parentRow.getBoundingClientRect();
    const submenuWidth = submenu.offsetWidth || 360;
    const viewportW = window.innerWidth;
    /* If it would clip on the right, flip to the left. */
    let left = parentRect.right;
    if (left + submenuWidth > viewportW - 4) {
      left = parentRect.left - submenuWidth;
    }
    submenu.style.left = `${Math.max(4, left)}px`;
    submenu.style.top = `${rowRect.top}px`;
  }

  function open() {
    if (isOpen) return;
    clearTimers();
    rebuildItems();
    submenu.removeAttribute('hidden');
    position();
    isOpen = true;
    parentRow.classList.add('submenu-open');
  }

  function close() {
    clearTimers();
    submenu.setAttribute('hidden', '');
    isOpen = false;
    parentRow.classList.remove('submenu-open');
  }

  function scheduleOpen() {
    if (isOpen) return;
    clearTimers();
    openTimer = setTimeout(open, SUBMENU_OPEN_DELAY_MS);
  }

  function scheduleClose() {
    /* If not yet open, just cancel the pending open. */
    if (!isOpen) { if (openTimer) { clearTimeout(openTimer); openTimer = 0; } return; }
    clearTimers();
    closeTimer = setTimeout(close, SUBMENU_CLOSE_DELAY_MS);
  }

  parentRow.addEventListener('mouseenter', scheduleOpen);
  parentRow.addEventListener('mouseleave', scheduleClose);
  submenu.addEventListener('mouseenter', () => { clearTimers(); });
  submenu.addEventListener('mouseleave', scheduleClose);
  /* Clicking the parent row toggles the submenu (touch / keyboard assist). */
  parentRow.addEventListener('click', (event) => {
    event.stopPropagation();
    if (isOpen) close();
    else open();
  });

  return { submenu, close, isOpen: () => isOpen };
}

export function mountMenus(menubar, menuDefs, { onAction } = {}) {
  const menuState = new Map();
  const allSubmenus = [];
  let anyMenuOpen = false;

  const closeAllSubmenus = () => {
    for (const s of allSubmenus) s.close();
  };

  const closeMenus = () => {
    closeAllSubmenus();
    menuState.forEach(({ button, menu }) => {
      button.classList.remove('active');
      menu.setAttribute('hidden', '');
    });
    anyMenuOpen = false;
  };

  function openMenu(id) {
    /* Close other menus and open only the given one. Also reset submenu state. */
    closeAllSubmenus();
    menuState.forEach(({ button, menu }, mid) => {
      if (mid === id) {
        button.classList.add('active');
        /* Dynamically refresh checkmarks on top-level toggle items (submenus are handled in rebuildItems on open). */
        menu.querySelectorAll('.menu-row').forEach((row) => {
          if (row._menuItem) applyCheckmark(row._menuIcon, row._menuItem);
        });
        menu.style.left = `${button.offsetLeft}px`;
        menu.removeAttribute('hidden');
      } else {
        button.classList.remove('active');
        menu.setAttribute('hidden', '');
      }
    });
    anyMenuOpen = true;
  }

  menuDefs.forEach((menuDef) => {
    const button = document.createElement('div');
    button.className = 'menu-item';
    button.textContent = menuDef.label;

    const menu = document.createElement('div');
    menu.className = 'dropdown-menu';
    menu.setAttribute('hidden', '');

    menuDef.items.forEach((item) => {
      const row = createMenuRow(item);

      if (isSubmenuItem(item)) {
        /* The arrow indicator is handled by createMenuRow via item.arrow. The submenu itself is appended at the menubar level. */
        const ctrl = createSubmenu({
          item,
          parentRow: row,
          parentMenu: menu,
          onAction,
          onAnyAction: closeMenus
        });
        menubar.append(ctrl.submenu);
        allSubmenus.push(ctrl);
      } else if (!item.sep && item.action) {
        row.addEventListener('click', (event) => {
          event.stopPropagation();
          closeMenus();
          if (onAction) onAction(item.action);
        });
      }

      /* Hovering a sibling submenu row closes other open submenus. */
      if (!item.sep) {
        row.addEventListener('mouseenter', () => {
          for (const s of allSubmenus) {
            if (s.isOpen() && !row.classList.contains('submenu-open')) s.close();
          }
        });
      }

      menu.append(row);
    });

    button.addEventListener('click', () => {
      const isOpen = !menu.hasAttribute('hidden');
      if (isOpen) closeMenus();
      else openMenu(menuDef.id);
    });

    /* While another menu is open, hovering this button switches to its menu. Hover is ignored before the first click. */
    button.addEventListener('mouseenter', () => {
      if (!anyMenuOpen) return;
      const isThisOpen = !menu.hasAttribute('hidden');
      if (!isThisOpen) openMenu(menuDef.id);
    });

    menuState.set(menuDef.id, { button, menu });
    menubar.append(button, menu);
  });

  document.addEventListener('click', (event) => {
    if (menubar.contains(event.target)) return;
    closeMenus();
  });
}
