import logger from '../config/logger';

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

export async function notify(text: string): Promise<void> {
  if (!SLACK_WEBHOOK_URL) return;
  try {
    await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch (err: any) {
    logger.error('[Notify] Slack webhook failed:', err.message);
  }
}
