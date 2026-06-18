import { t, getLanguage } from './i18n.js';

export function getTopMenus({ getRecentFolderItems, getRecentFileItems } = {}) {
  return [
    {
      id: 'file',
      label: t('menu.file.label'),
      items: [
        { icon: '*', text: t('menu.file.newFile'), key: 'Ctrl+N', action: 'newFile' },
        { text: t('menu.file.openFile'), action: 'openFile' },
        { icon: 'O', text: t('menu.file.openFolder'), key: 'Ctrl+O', action: 'openFolder' },
        { text: t('menu.file.newWindow'), action: 'newWindow' },
        {
          text: t('menu.file.recentFolders'),
          arrow: '>',
          getChildren: typeof getRecentFolderItems === 'function' ? getRecentFolderItems : () => [],
          emptyText: t('menu.file.recentEmpty')
        },
        {
          text: t('menu.file.recentFiles'),
          arrow: '>',
          getChildren: typeof getRecentFileItems === 'function' ? getRecentFileItems : () => [],
          emptyText: t('menu.file.recentEmpty')
        },
        { sep: true },
        { icon: 'S', text: t('menu.file.save'), key: 'Ctrl+S', action: 'save' },
        { icon: 'N', text: t('menu.file.saveAs'), key: 'Ctrl+Shift+S', action: 'saveAs' },
        { icon: 'A', text: t('menu.file.saveAll'), action: 'saveAll' },
        { sep: true },
        { icon: 'X', text: t('menu.file.close'), key: 'Ctrl+W', action: 'closeTab' },
        { text: t('menu.file.closeOthers'), action: 'closeOthers' },
        { icon: '-', text: t('menu.file.closeAll'), action: 'closeAll' },
        { sep: true },
        { text: t('menu.file.saveAndQuit'), noShortcut: true, action: 'saveAndQuit' },
        { icon: 'Q', text: t('menu.file.quit'), noShortcut: true, action: 'quit' }
      ]
    },
    {
      id: 'edit',
      label: t('menu.edit.label'),
      items: [
        { icon: 'U', text: t('menu.edit.undo'), key: 'Ctrl+Z', action: 'undo' },
        { icon: 'R', text: t('menu.edit.redo'), key: 'Ctrl+Y', action: 'redo' },
        { sep: true },
        { icon: 'T', text: t('menu.edit.cut'), key: 'Ctrl+X', action: 'cut' },
        { icon: 'C', text: t('menu.edit.copy'), key: 'Ctrl+C', action: 'copy' },
        { icon: 'P', text: t('menu.edit.paste'), key: 'Ctrl+V', action: 'paste' }
      ]
    },
    {
      id: 'search',
      label: t('menu.search.label'),
      items: [
        { icon: 'F', text: t('menu.search.find'), key: 'Ctrl+F', action: 'find' },
        { icon: 'H', text: t('menu.search.replace'), key: 'Ctrl+H', action: 'replace' },
        { icon: 'N', text: t('menu.search.findNext'), key: 'Ctrl+K', action: 'findSelection' },
        { icon: 'P', text: t('menu.search.findPrev'), key: 'Ctrl+Shift+K', action: 'findSelectionPrev' },
        { sep: true },
        { icon: 'M', text: t('menu.search.bracket'), key: 'Ctrl+]', action: 'gotoBracket' }
      ]
    },
    {
      id: 'ftp',
      label: t('menu.ftp.label'),
      items: [
        { text: t('menu.ftp.newSite'), action: 'addRemoteProject' },
        { sep: true },
        { text: t('menu.ftp.manageSites'), action: 'manageRemoteProjects' }
      ]
    },
    {
      id: 'settings',
      label: t('menu.settings.label'),
      items: [
        { text: t('menu.settings.openSettings'), action: 'openSettings' },
        {
          text: t('menu.settings.language'),
          arrow: '>',
          getChildren: () => [
            { text: t('settings.language.options.ko'), action: 'setLanguage:ko', checked: getLanguage() === 'ko' },
            { text: t('settings.language.options.en'), action: 'setLanguage:en', checked: getLanguage() === 'en' }
          ]
        },
        { sep: true },
        { text: t('menu.settings.export'), action: 'exportSettings' },
        { text: t('menu.settings.import'), action: 'importSettings' }
      ]
    }
  ];
}
