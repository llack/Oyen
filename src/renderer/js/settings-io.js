/* Settings export/import flow. Invoked from the menu actions (exportSettings/importSettings). */
import { selectSectionsDialog, notifyAlert } from './dialogs.js';
import { t } from './i18n.js';

/* The section list is determined dynamically by main (export-import-service) — new settings keys are exposed automatically without code changes.
   Label key: settings.io.section.<id> (general/colors/shortcuts/servers/other). */
const sectionLabel = (id) => t(`settings.io.section.${id}`);
const fileFilters = [{ name: 'OYEN', extensions: ['json'] }];

/* Only existing sections become checkboxes (all checked). */
const toSections = (ids) => (ids || []).map((id) => ({ id, label: sectionLabel(id), checked: true }));

function importErrorMessage(error) {
  if (error === 'parse') return t('settings.io.errParse');
  if (error === 'version') return t('settings.io.errVersion');
  if (error === 'read') return t('settings.io.errRead');
  return t('settings.io.errFormat');
}

export async function exportSettingsFlow() {
  const available = await window.oyen?.appConfig?.exportSections?.();
  if (!available?.length) {
    await notifyAlert(t('settings.io.errEmpty'), t('settings.io.title'));
    return;
  }
  const picked = await selectSectionsDialog({
    title: t('settings.io.exportTitle'),
    message: t('settings.io.exportMessage'),
    confirmLabel: t('settings.io.export'),
    sections: toSections(available)
  });
  if (!picked || !picked.length) return;

  const save = await window.oyen?.localFs?.pickSaveFile?.({
    title: t('settings.io.exportTitle'),
    defaultPath: 'settings.json',
    filters: fileFilters
  });
  if (!save?.ok || !save.path) return;

  const res = await window.oyen?.appConfig?.exportConfig?.(save.path, picked);
  await notifyAlert(res?.ok ? t('settings.io.exportDone') : t('settings.io.exportFail'), t('settings.io.title'));
}

export async function importSettingsFlow() {
  const pick = await window.oyen?.localFs?.pickFile?.({
    title: t('settings.io.importTitle'),
    filters: fileFilters
  });
  if (!pick?.ok || !pick.path) return;

  /* First safety net: validate OYEN format, JSON, and version + identify which sections the file contains. */
  const info = await window.oyen?.appConfig?.inspectImport?.(pick.path);
  if (!info?.ok) {
    await notifyAlert(importErrorMessage(info?.error), t('settings.io.title'));
    return;
  }
  if (!info.available?.length) {
    await notifyAlert(t('settings.io.errEmpty'), t('settings.io.title'));
    return;
  }

  const picked = await selectSectionsDialog({
    title: t('settings.io.importTitle'),
    message: t('settings.io.importMessage'),
    confirmLabel: t('settings.io.import'),
    sections: toSections(info.available)
  });
  if (!picked || !picked.length) return;

  /* Second safety net: re-validate each key's type at apply time (main). */
  const res = await window.oyen?.appConfig?.importConfig?.(pick.path, picked);
  if (!res?.ok) {
    await notifyAlert(importErrorMessage(res?.error), t('settings.io.title'));
    return;
  }
  /* Restart to apply — prevents mismatch with the in-memory settings (same as the language change flow). */
  await notifyAlert(t('settings.io.importDone'), t('settings.io.title'));
  location.reload();
}
