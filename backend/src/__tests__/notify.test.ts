import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../config/logger', () => ({ default: loggerMock }));

import { notify } from '../utils/notify';

describe('notify', () => {
  const originalFetch = globalThis.fetch;
  const originalPrimary = process.env.SLACK_WEBHOOK_URL;
  const originalBackup = process.env.SLACK_WEBHOOK_URL_BACKUP;

  beforeEach(() => {
    loggerMock.info.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.error.mockClear();
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalPrimary === undefined) delete process.env.SLACK_WEBHOOK_URL;
    else process.env.SLACK_WEBHOOK_URL = originalPrimary;
    if (originalBackup === undefined) delete process.env.SLACK_WEBHOOK_URL_BACKUP;
    else process.env.SLACK_WEBHOOK_URL_BACKUP = originalBackup;
    vi.useRealTimers();
  });

  it('does nothing when no webhook URL is configured', async () => {
    delete process.env.SLACK_WEBHOOK_URL;
    delete process.env.SLACK_WEBHOOK_URL_BACKUP;
    await notify('test');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it('sends POST to primary webhook when URL is set', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/primary';
    delete process.env.SLACK_WEBHOOK_URL_BACKUP;
    await notify('hello');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/primary',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: 'hello' }),
      }),
    );
  });

  it('reads env lazily (env set AFTER import works)', async () => {
    // Lazy getter sayesinde import sirasinda env okunmaz — runtime'da okunur.
    delete process.env.SLACK_WEBHOOK_URL;
    delete process.env.SLACK_WEBHOOK_URL_BACKUP;
    await notify('first'); // no webhook → no fetch
    expect(globalThis.fetch).not.toHaveBeenCalled();

    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/late';
    await notify('second');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe('https://hooks.slack.com/late');
  });

  it('retries on transient fetch failure (network error)', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/primary';
    delete process.env.SLACK_WEBHOOK_URL_BACKUP;
    let attempt = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      attempt++;
      if (attempt < 3) return Promise.reject(new Error('ECONNRESET'));
      return Promise.resolve({ ok: true, status: 200 });
    });
    vi.useFakeTimers();
    const p = notify('retry-me');
    await vi.runAllTimersAsync();
    await p;
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it('retries on non-2xx response (HTTP 503)', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/primary';
    delete process.env.SLACK_WEBHOOK_URL_BACKUP;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.useFakeTimers();
    const p = notify('flaky');
    await vi.runAllTimersAsync();
    await p;
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining('primary delivery failed after 3 attempts: HTTP 503'),
    );
  });

  it('falls back to backup webhook when primary fails 3x', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/primary';
    process.env.SLACK_WEBHOOK_URL_BACKUP = 'https://hooks.slack.com/backup';
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('primary')) return Promise.resolve({ ok: false, status: 500 });
      return Promise.resolve({ ok: true, status: 200 });
    });
    vi.useFakeTimers();
    const p = notify('fallback');
    await vi.runAllTimersAsync();
    await p;
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it('logs ALARM_DELIVERY_FAIL when both channels fail', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/primary';
    process.env.SLACK_WEBHOOK_URL_BACKUP = 'https://hooks.slack.com/backup';
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.useFakeTimers();
    const p = notify('total-fail');
    await vi.runAllTimersAsync();
    await p;
    expect(globalThis.fetch).toHaveBeenCalledTimes(6);
    expect(loggerMock.error).toHaveBeenCalledWith(
      '[Notify] ALARM_DELIVERY_FAIL',
      expect.objectContaining({
        event: 'ALARM_DELIVERY_FAIL',
        text: 'total-fail',
        hadPrimary: true,
        hadBackup: true,
      }),
    );
  });

  it('does not throw when delivery fails', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/primary';
    delete process.env.SLACK_WEBHOOK_URL_BACKUP;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network'));
    vi.useFakeTimers();
    const p = notify('test');
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeUndefined();
    expect(loggerMock.error).toHaveBeenCalledWith(
      '[Notify] ALARM_DELIVERY_FAIL',
      expect.any(Object),
    );
  });
});
