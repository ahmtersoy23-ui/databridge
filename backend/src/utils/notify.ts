import logger from '../config/logger';
import { errMessage } from './errors';

const getPrimaryWebhook = () => process.env.SLACK_WEBHOOK_URL;
const getBackupWebhook = () => process.env.SLACK_WEBHOOK_URL_BACKUP;

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;

async function postOnce(url: string, text: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, reason: errMessage(err) || 'fetch threw' };
  }
}

async function deliver(url: string, text: string, channelLabel: string): Promise<{ ok: boolean; attempts: number; lastReason?: string }> {
  let lastReason: string | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await postOnce(url, text);
    if (result.ok) return { ok: true, attempts: attempt };
    lastReason = result.reason;
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, BASE_DELAY_MS * 2 ** (attempt - 1)));
    }
  }
  logger.warn(`[Notify] ${channelLabel} delivery failed after ${MAX_ATTEMPTS} attempts: ${lastReason}`);
  return { ok: false, attempts: MAX_ATTEMPTS, lastReason };
}

export async function notify(text: string): Promise<void> {
  const primary = getPrimaryWebhook();
  const backup = getBackupWebhook();

  if (!primary && !backup) return;

  if (primary) {
    const primaryResult = await deliver(primary, text, 'primary');
    if (primaryResult.ok) return;
  }

  if (backup) {
    const backupResult = await deliver(backup, text, 'backup');
    if (backupResult.ok) return;
  }

  // Tüm kanallar başarısız — PM2 stdout/stderr'de yapılandırılmış kayıt bırak.
  // Bu kayıt grep'lenebilir: `pm2 logs databridge-backend | grep ALARM_DELIVERY_FAIL`
  logger.error('[Notify] ALARM_DELIVERY_FAIL', {
    event: 'ALARM_DELIVERY_FAIL',
    text: text.slice(0, 500),
    hadPrimary: !!primary,
    hadBackup: !!backup,
  });
}
