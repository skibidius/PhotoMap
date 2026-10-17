// Auto-update: checks the configured updater endpoint, asks the user and
// installs the update if they agree. Errors are swallowed — a manual download
// from GitHub Releases always remains an option.

import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { ask } from '@tauri-apps/plugin-dialog';

import { t } from './i18n';

export async function checkForUpdates(silent = false): Promise<void> {
  try {
    const update = await check();
    if (!update) {
      if (!silent) {
        await ask(t('upToDate'), { title: 'PhotoMap', kind: 'info' });
      }
      return;
    }

    const yes = await ask(t('updateAvailable', { version: update.version }), {
      title: 'PhotoMap',
      kind: 'info',
      okLabel: t('updateNow'),
      cancelLabel: t('later'),
    });
    if (!yes) return;

    await update.downloadAndInstall();
    await relaunch();
  } catch {
    if (!silent) {
      // Don't nag about transient network failures, but surface the error for
      // the manual "check" button.
    }
  }
}
