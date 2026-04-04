import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('notify', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env.SLACK_WEBHOOK_URL;

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.SLACK_WEBHOOK_URL = originalEnv;
  });

  it('does nothing when SLACK_WEBHOOK_URL is not set', async () => {
    delete process.env.SLACK_WEBHOOK_URL;
    // Re-import to get fresh module with no URL
    vi.resetModules();
    const { notify } = await import('../utils/notify');
    await notify('test');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('sends POST to webhook when URL is set', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
    vi.resetModules();
    const { notify } = await import('../utils/notify');
    await notify('hello');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/test',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: 'hello' }),
      }),
    );
  });

  it('does not throw on fetch failure', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network'));
    vi.resetModules();
    const { notify } = await import('../utils/notify');
    await expect(notify('test')).resolves.toBeUndefined();
  });
});
