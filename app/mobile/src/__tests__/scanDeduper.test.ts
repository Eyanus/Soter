import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BULK_SCAN_DEDUPE_RETENTION_MS,
  createBulkScanDeduper,
  createScanDeduper,
} from '../screens/scanDeduper';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

beforeEach(() => {
  jest.clearAllMocks();
  storage.getItem.mockResolvedValue(null);
  storage.setItem.mockResolvedValue();
  storage.removeItem.mockResolvedValue();
});

describe('scan deduplication', () => {
  it('suppresses the same scan during the debounce window', () => {
    let now = 1000;
    const isDuplicate = createScanDeduper(1500, () => now);

    expect(isDuplicate('aid-123')).toBe(false);
    now += 500;
    expect(isDuplicate('aid-123')).toBe(true);
    now += 1500;
    expect(isDuplicate('aid-123')).toBe(false);
  });

  it('allows different packages without waiting', () => {
    const isDuplicate = createScanDeduper(1500, () => 1000);

    expect(isDuplicate('aid-123')).toBe(false);
    expect(isDuplicate('aid-456')).toBe(false);
  });
});

describe('persistent bulk scan deduplication', () => {
  it('flags a repeated scan in the same session distinctly', async () => {
    let now = 10_000;
    const deduper = createBulkScanDeduper({ sessionId: 'session-a', clock: () => now });

    await expect(deduper.check('aid-123')).resolves.toBe('new');
    now += 1000;
    await expect(deduper.check('aid-123')).resolves.toBe('same-session-duplicate');
  });

  it('flags a scan recorded by a previous session', async () => {
    let now = 10_000;
    let stored = JSON.stringify({
      'aid-123': { timestamp: now, sessionId: 'previous-session' },
    });
    storage.getItem.mockImplementation(async () => stored);
    storage.setItem.mockImplementation(async (_key, value) => {
      stored = value;
    });

    const deduper = createBulkScanDeduper({ sessionId: 'new-session', clock: () => now });

    await expect(deduper.check('aid-123')).resolves.toBe('previous-session-duplicate');
  });

  it('accepts a scan after its retained record expires and cleans it up', async () => {
    let now = 10_000;
    const expired = JSON.stringify({
      'aid-123': { timestamp: now - BULK_SCAN_DEDUPE_RETENTION_MS - 1, sessionId: 'old-session' },
    });
    storage.getItem.mockResolvedValue(expired);

    const deduper = createBulkScanDeduper({ sessionId: 'new-session', clock: () => now });

    await expect(deduper.check('aid-123')).resolves.toBe('new');
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(storage.setItem).toHaveBeenCalled();

    const [, persisted] = storage.setItem.mock.calls.at(-1)!;
    expect(JSON.parse(persisted)['aid-123']).toEqual({
      timestamp: now,
      sessionId: 'new-session',
    });
  });

  it('uses a configurable retention window', async () => {
    let now = 10_000;
    const stored = JSON.stringify({
      'aid-123': { timestamp: now - 6_000, sessionId: 'old-session' },
    });
    storage.getItem.mockResolvedValue(stored);

    const deduper = createBulkScanDeduper({
      retentionMs: 5_000,
      sessionId: 'new-session',
      clock: () => now,
    });

    await expect(deduper.check('aid-123')).resolves.toBe('new');
  });
});
