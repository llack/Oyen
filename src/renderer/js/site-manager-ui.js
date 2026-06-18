import iconPencil from '@tabler/icons/outline/pencil.svg?raw';
import iconDelete from '@tabler/icons/outline/trash.svg?raw';
import iconRoute from '@tabler/icons/outline/route.svg?raw';
import { t } from './i18n.js';

const esc = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* Protocol label (instead of an icon — all are remote, so distinguish with SFTP/FTP/FTPS text). */
function siteTypeLabel(p) {
  if (p.type === 'sftp') return 'SFTP';
  if (p.type === 'ftp') return p.secure ? 'FTPS' : 'FTP';
  return '';
}

function siteUriString(p) {
  /* The scheme (sftp://, ftp://) is distinguished by the badge, so omit it. Only host:port — the initial directory isn't shown either. */
  const userPart = p.username ? `${p.username}@` : '';
  if (p.type === 'sftp') return `${userPart}${p.host}:${p.port || 22}`;
  if (p.type === 'ftp') return `${userPart}${p.host}:${p.port || 21}`;
  return '';
}

export function openSiteManager({ getProjects, isRemote, onOpen, onEdit, onRemove, onAdd }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'confirm-backdrop';

  const close = () => {
    backdrop.remove();
    window.removeEventListener('keydown', onKeyDown);
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  };

  function render() {
    const all = getProjects() || [];
    /* Site manager = connection profiles only. Folder projects (derivedRemote) belong to the project panel, so exclude them. */
    const remotes = all.filter((p) => isRemote(p) && !p.derivedRemote);
    /* Most-recently-added first — new sites are appended to the array, so display in reverse. idx keeps the original index. */
    const ordered = remotes.slice().reverse();
    const listHtml = ordered.length
      ? ordered.map((p) => {
          const idx = all.indexOf(p);
          const badgeCls = p.type === 'sftp' ? 'sftp' : 'ftp';
          /* OS badge — SFTP only (Unix semantics like permissions). Color distinguishes by OS. */
          const os = p.type === 'sftp' ? (['windows', 'mac'].includes(p.os) ? p.os : 'linux') : '';
          const osLabel = { linux: 'Linux', windows: 'Windows', mac: 'macOS' }[os] || '';
          const osBadge = os ? `<span class="site-badge os-${os}">${osLabel}</span>` : '';
          /* Clicking a site always opens the folder picker → keep the tooltip's picker guidance consistent. */
          const openHint = esc(t('siteManager.openHint'));
          /* If the site goes through a jump host, show a route icon next to the badge (tooltip = jump host address). */
          const jh = p.jump?.host
            ? `${p.jump.username ? p.jump.username + '@' : ''}${p.jump.host}${p.jump.port ? ':' + p.jump.port : ''}`
            : '';
          const jumpChip = jh
            ? `<span class="site-jump" title="${esc(t('siteManager.jumpTip', { host: jh }))}">${iconRoute}</span>`
            : '';
          return `
            <div class="site-row" data-index="${idx}" title="${openHint}">
              <div class="site-body">
                <div class="site-name-row">
                  <span class="site-badge ${badgeCls}">${siteTypeLabel(p)}</span>
                  ${osBadge}
                  ${jumpChip}
                  <span class="site-name">${esc(p.name)}</span>
                </div>
                <div class="site-uri">${esc(siteUriString(p))}</div>
              </div>
              <button class="site-action site-edit" title="${t('siteManager.edit')}">${iconPencil}</button>
              <button class="site-action site-delete" title="${t('siteManager.delete')}">${iconDelete}</button>
            </div>
          `;
        }).join('')
      : `<div class="site-empty">${t('siteManager.empty')}</div>`;

    backdrop.innerHTML = `
      <section class="confirm-dialog large" role="dialog" aria-modal="true" aria-label="${t('siteManager.title')}">
        <div class="confirm-title">${t('siteManager.title')}</div>
        <div class="site-list">${listHtml}</div>
        <div class="confirm-actions">
          <button class="confirm-btn site-add-btn" data-site-add>+ ${t('menu.ftp.newSite')}</button>
          <button class="confirm-btn primary" data-confirm="close">${t('dlg.close')}</button>
        </div>
      </section>
    `;

    backdrop.querySelectorAll('.site-row').forEach((row) => {
      const idx = Number(row.dataset.index);
      row.querySelector('.site-edit')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await onEdit?.(idx);
        render();
      });
      row.querySelector('.site-delete')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await onRemove?.(idx);
        render();
      });
      /* Row click (excluding the edit/delete buttons) → connect + open folder. */
      row.addEventListener('click', (e) => {
        if (e.target.closest('.site-action')) return;
        close();
        onOpen?.(idx);
      });
    });

    backdrop.querySelector('[data-site-add]')?.addEventListener('click', async () => {
      await onAdd?.();
      render();
    });
    backdrop.querySelector('[data-confirm="close"]').addEventListener('click', close);
  }

  document.body.appendChild(backdrop);
  render();
  window.addEventListener('keydown', onKeyDown);
}
