import AsyncStorage from '@react-native-async-storage/async-storage';

export const SCAN_DEDUPE_WINDOW_MS = 1500;
export const BULK_SCAN_DEDUPE_RETENTION_MS = 24 * 60 * 60 * 1000;
const BULK_SCAN_DEDUPE_STORAGE_KEY = '@soter/bulk-scan-dedupe/v1';

type Clock = () => number;

type StoredScan = {
  timestamp: number;
  sessionId: string;
};

type StoredScans = Record<string, StoredScan>;

export type BulkScanDuplicateStatus =
  | 'new'
  | 'same-session-duplicate'
  | 'previous-session-duplicate';

export type BulkScanDeduperOptions = {
  retentionMs?: number;
  clock?: Clock;
  sessionId?: string;
  storageKey?: string;
};

const createSessionId = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const readStoredScans = async (storageKey: string): Promise<StoredScans> => {
  const raw = await AsyncStorage.getItem(storageKey);
  if (!raw) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([, value]) =>
          value &&
          typeof value === 'object' &&
          typeof (value as StoredScan).timestamp === 'number' &&
          typeof (value as StoredScan).sessionId === 'string',
      ),
    ) as StoredScans;
  } catch {
    return {};
  }
};

const persistScans = async (storageKey: string, scans: StoredScans): Promise<void> => {
  if (Object.keys(scans).length === 0) {
    await AsyncStorage.removeItem(storageKey);
    return;
  }

  await AsyncStorage.setItem(storageKey, JSON.stringify(scans));
};

/**
 * Session-local scanner deduper used by the single scanner flow.
 * Kept synchronous for compatibility with existing callers.
 */
export const createScanDeduper = (
  windowMs: number = SCAN_DEDUPE_WINDOW_MS,
  clock: Clock = Date.now,
) => {
  const recentScans = new Map<string, number>();

  return (scanKey: string): boolean => {
    const now = clock();

    for (const [key, timestamp] of recentScans) {
      if (now - timestamp >= windowMs) {
        recentScans.delete(key);
      }
    }

    const previousScan = recentScans.get(scanKey);
    recentScans.set(scanKey, now);

    return previousScan !== undefined && now - previousScan < windowMs;
  };
};

/**
 * Persistent deduper for bulk scanning. Records survive app restarts for a
 * configurable retention window and distinguish duplicates from this session
 * from duplicates recorded by an earlier session on the same device.
 */
export const createBulkScanDeduper = ({
  retentionMs = BULK_SCAN_DEDUPE_RETENTION_MS,
  clock = Date.now,
  sessionId = createSessionId(),
  storageKey = BULK_SCAN_DEDUPE_STORAGE_KEY,
}: BulkScanDeduperOptions = {}) => {
  if (retentionMs <= 0) {
    throw new Error('Bulk scan dedupe retention must be greater than zero');
  }

  let sessionScans = new Set<string>();

    const cleanupExpired = async (
    now: number,
  ): Promise<{ scans: StoredScans; changed: boolean }> => {
    const scans = await readStoredScans(storageKey);
    const cutoff = now - retentionMs;
    const activeEntries = Object.entries(scans).filter(
      ([, record]) => record.timestamp > cutoff,
    );
    const activeScans = Object.fromEntries(activeEntries) as StoredScans;

    return {
      scans: activeScans,
      changed: activeEntries.length !== Object.keys(scans).length,
    };
  };

  return {
        check: async (scanKey: string): Promise<BulkScanDuplicateStatus> => {
      const normalizedKey = scanKey.trim();
      if (!normalizedKey) return 'new';

      const now = clock();
      const { scans, changed } = await cleanupExpired(now);
      const previous = scans[normalizedKey];

      if (sessionScans.has(normalizedKey) || previous?.sessionId === sessionId) {
        sessionScans.add(normalizedKey);

        if (changed) {
          await persistScans(storageKey, scans);
        }

        return 'same-session-duplicate';
      }

      if (previous) {
        sessionScans.add(normalizedKey);

        if (changed) {
          await persistScans(storageKey, scans);
        }

        return 'previous-session-duplicate';
      }

      scans[normalizedKey] = { timestamp: now, sessionId };
      sessionScans.add(normalizedKey);
      await persistScans(storageKey, scans);

      return 'new';
    },

    cleanup: async (): Promise<void> => {
      const { scans, changed } = await cleanupExpired(clock());

      if (changed) {
        await persistScans(storageKey, scans);
      }
    },
  };
};
