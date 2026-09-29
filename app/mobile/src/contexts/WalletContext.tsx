import React, { PropsWithChildren, createContext, useContext, useEffect, useState } from 'react';
import * as ExpoLinking from 'expo-linking';
import {
  ConnectedWalletSession,
  WalletConnectionStatus,
  createWalletConnection,
  disconnectWalletSession,
  openWalletConnectPairingUri,
  restoreWalletSession,
  subscribeWalletSessionExpiry,
  triggerWalletSessionExpiryForE2E,
} from '../services/walletConnect';
import { confirmValueMovingAction } from '../services/valueActionConfirmation';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { detectWalletNetwork, WalletNetworkInfo } from '../services/networkGuard';
import { migrateFromAsyncStorage, secureClearAll } from '../services/secureStorage';

export type RestoreStatus = 'restoring' | 'restored' | 'none' | 'failed' | 'secure_unavailable';

interface WalletContextValue {
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
  recoverSession: () => void;
  reauthenticate: () => Promise<void>;
  error: string | null;
  lastDeepLinkUrl: string | null;
  pairingUri: string | null;
  publicKey: string | null;
  reopenWallet: () => Promise<void>;
  status: WalletConnectionStatus;
  restoreStatus: RestoreStatus;
  secureStorageUnavailable: boolean;
  walletName: string | null;
  chainIds: string[];
  walletNetworkInfo: WalletNetworkInfo | null;
  isOnCorrectNetwork: boolean;
  checkNetwork: () => void;
  /** True after WalletConnect reports that the active session expired or was deleted. */
  sessionExpired: boolean;
  /** Clears the reconnect prompt without reconnecting. */
  cancelReconnect: () => void;
  /** Test-only expiry trigger used by the Maestro harness. */
  expireSessionForE2E: () => void;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return 'An unexpected wallet error occurred.';
};

const idleState = {
  error: null,
  publicKey: null,
  status: 'idle' as WalletConnectionStatus,
  walletName: null,
};

const E2E_MODE = process.env.EXPO_PUBLIC_E2E_WALLET_RECONNECT === '1';

export const WalletProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [status, setStatus] = useState<WalletConnectionStatus>('idle');
  const [restoreStatus, setRestoreStatus] = useState<RestoreStatus>('restoring');
  const [secureStorageUnavailable, setSecureStorageUnavailable] = useState(false);
  const [topic, setTopic] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [pairingUri, setPairingUri] = useState<string | null>(null);
  const [lastDeepLinkUrl, setLastDeepLinkUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  const [chainIds, setChainIds] = useState<string[]>([]);
  const [walletNetworkInfo, setWalletNetworkInfo] = useState<WalletNetworkInfo | null>(null);
  const [isOnCorrectNetwork, setIsOnCorrectNetwork] = useState<boolean>(false);
  const networkStatus = useNetworkStatus();

  const applyConnectedSession = (session: ConnectedWalletSession) => {
    setTopic(session.topic);
    setPublicKey(session.publicKey);
    setWalletName(session.walletName);
    setPairingUri(null);
    setError(null);
    setStatus('connected');
    setSessionExpired(false);
    setSecureStorageUnavailable(false);

    const sessionChainIds = session.chainIds ?? [];
    setChainIds(sessionChainIds);
    const networkInfo = detectWalletNetwork(sessionChainIds);
    setWalletNetworkInfo(networkInfo);
    setIsOnCorrectNetwork(networkInfo.isKnown && networkInfo.isTestnet);
  };

  const handleSessionExpired = (expiredTopic: string) => {
    if (!topic || expiredTopic !== topic) return;

    setTopic(null);
    setPublicKey(null);
    setWalletName(null);
    setPairingUri(null);
    setChainIds([]);
    setWalletNetworkInfo(null);
    setIsOnCorrectNetwork(false);
    setStatus('error');
    setError('Your wallet session expired. Reconnect your wallet to continue the pending action.');
    setSessionExpired(true);
  };

  useEffect(() => {
    let isMounted = true;

    const bootstrap = async () => {
      try {
        await migrateFromAsyncStorage();
      } catch {
        // Migration failures are non-fatal — the restore proceeds regardless.
      }

      try {
        const existingSession = await restoreWalletSession();
        if (isMounted) {
          if (existingSession) {
            applyConnectedSession(existingSession);
            setRestoreStatus('restored');
            setSecureStorageUnavailable(false);
          } else {
            setRestoreStatus('none');
            setSecureStorageUnavailable(false);
          }
        }
      } catch (sessionError) {
        if (!isMounted) return;

        const msg = sessionError instanceof Error ? sessionError.message : '';
        const isSecureFailure =
          sessionError?.constructor?.name === 'SecureStorageUnavailableError' ||
          /secure|keychain|keystore|enclave/i.test(msg);

        if (isSecureFailure) {
          setSecureStorageUnavailable(true);
          setRestoreStatus('secure_unavailable');
          setStatus('error');
          setError('Wallet credentials are locked. Please unlock your device and try again.');
        } else {
          setError(getErrorMessage(sessionError));
          setStatus('error');
          setRestoreStatus('failed');
        }
      }
    };

    const captureInitialUrl = async () => {
      const url = await ExpoLinking.getInitialURL();
      if (url && isMounted) setLastDeepLinkUrl(url);
    };

    void bootstrap();
    void captureInitialUrl();

    const subscription = ExpoLinking.addEventListener('url', ({ url }) => setLastDeepLinkUrl(url));

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!topic) return;

    let cleanup: (() => void) | undefined;
    void subscribeWalletSessionExpiry(topic, handleSessionExpired).then((unsubscribe) => {
      cleanup = unsubscribe;
    });

    return () => cleanup?.();
  }, [topic]);

  useEffect(() => {
    if (status === 'connected' && chainIds.length > 0) {
      const networkInfo = detectWalletNetwork(chainIds);
      setWalletNetworkInfo(networkInfo);
      setIsOnCorrectNetwork(networkInfo.isKnown && networkInfo.isTestnet);
    }
  }, [chainIds, status, networkStatus]);

  const resetWalletState = () => {
    setTopic(null);
    setPublicKey(idleState.publicKey);
    setWalletName(idleState.walletName);
    setPairingUri(idleState.pairingUri);
    setError(idleState.error);
    setStatus(idleState.status);
    setChainIds([]);
    setWalletNetworkInfo(null);
    setIsOnCorrectNetwork(false);
    setSecureStorageUnavailable(false);
    setSessionExpired(false);
  };

  const connectWallet = async () => {
    setStatus('connecting');
    setError(null);

    try {
      const { pairingUri: nextPairingUri, approval } = await createWalletConnection();
      setPairingUri(nextPairingUri);
      setStatus('awaiting-approval');

      try {
        await openWalletConnectPairingUri(nextPairingUri);
      } catch (openError) {
        setError(getErrorMessage(openError));
      }

      try {
        const session = await approval();
        applyConnectedSession(session);
      } catch (approvalError) {
        setError(getErrorMessage(approvalError));
        setStatus('error');
      }
    } catch (connectionError) {
      setError(getErrorMessage(connectionError));
      setStatus('error');
    }
  };

  const disconnectWallet = async () => {
    const activeTopic = topic;
    const confirmationResult = await confirmValueMovingAction('Confirm wallet disconnect');
    if (!confirmationResult.ok) {
      if (confirmationResult.reason === 'cancelled') return;
      setError('Biometric confirmation failed. Please try again.');
      return;
    }

    resetWalletState();

    try {
      await secureClearAll();
    } catch {
      // Non-fatal — the WalletConnect session is already invalidated locally.
    }

    if (!activeTopic) return;

    try {
      await disconnectWalletSession(activeTopic);
    } catch (disconnectError) {
      setError(getErrorMessage(disconnectError));
      setStatus('error');
    }
  };

  const recoverSession = () => {
    resetWalletState();
    setRestoreStatus('none');
  };

  const reauthenticate = async () => {
    const confirmationResult = await confirmValueMovingAction('Unlock your wallet to continue');
    if (!confirmationResult.ok) return;

    setRestoreStatus('restoring');
    setError(null);
    setSecureStorageUnavailable(false);
    setStatus('idle');

    try {
      const existingSession = await restoreWalletSession();
      if (existingSession) {
        applyConnectedSession(existingSession);
        setRestoreStatus('restored');
      } else {
        setRestoreStatus('none');
      }
    } catch (sessionError) {
      setError(getErrorMessage(sessionError));
      setStatus('error');
      setRestoreStatus('failed');
    }
  };

  const cancelReconnect = () => {
    setSessionExpired(false);
    setError(null);
    setStatus('idle');
  };

  const expireSessionForE2E = () => {
    if (!E2E_MODE || !topic) return;
    triggerWalletSessionExpiryForE2E(topic);
  };

  const reopenWallet = async () => {
    if (!pairingUri) return;

    try {
      await openWalletConnectPairingUri(pairingUri);
      setError(null);
    } catch (openError) {
      setError(getErrorMessage(openError));
      setStatus('error');
    }
  };

  const checkNetwork = () => {
    if (status === 'connected' && chainIds.length > 0) {
      const networkInfo = detectWalletNetwork(chainIds);
      setWalletNetworkInfo(networkInfo);
      setIsOnCorrectNetwork(networkInfo.isKnown && networkInfo.isTestnet);
    }
  };

  return (
    <WalletContext.Provider
      value={{
        connectWallet,
        disconnectWallet,
        recoverSession,
        reauthenticate,
        error,
        lastDeepLinkUrl,
        pairingUri,
        publicKey,
        reopenWallet,
        status,
        restoreStatus,
        secureStorageUnavailable,
        walletName,
        chainIds,
        walletNetworkInfo,
        isOnCorrectNetwork,
        checkNetwork,
        sessionExpired,
        cancelReconnect,
        expireSessionForE2E,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) throw new Error('useWallet must be used within a WalletProvider.');
  return context;
};
