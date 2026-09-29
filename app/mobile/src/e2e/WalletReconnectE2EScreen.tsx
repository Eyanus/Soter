import React, { useEffect, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useWallet } from '../contexts/WalletContext';

export const WalletReconnectE2EScreen: React.FC = () => {
  const { connectWallet, expireSessionForE2E, sessionExpired, cancelReconnect, status, error } = useWallet();
  const [pendingAction, setPendingAction] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [wasExpired, setWasExpired] = useState(false);

  useEffect(() => {
    if (sessionExpired) setWasExpired(true);
  }, [sessionExpired]);

  useEffect(() => {
    if (wasExpired && !sessionExpired && status === 'connected' && pendingAction) {
      setResumed(true);
    }
  }, [wasExpired, sessionExpired, status, pendingAction]);

  const startPendingAction = () => {
    setPendingAction(true);
    setResumed(false);
    setCancelled(false);
  };

  const cancel = () => {
    cancelReconnect();
    setCancelled(true);
    setPendingAction(false);
    setResumed(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Wallet Reconnect E2E</Text>
        <Text testID="e2e-wallet-status" style={styles.status}>Wallet status: {status}</Text>

        <TouchableOpacity testID="e2e-connect-wallet" accessibilityRole="button" onPress={() => void connectWallet()} style={styles.button}>
          <Text style={styles.buttonText}>Connect Test Wallet</Text>
        </TouchableOpacity>

        <TouchableOpacity testID="e2e-start-pending-action" accessibilityRole="button" onPress={startPendingAction} style={styles.button} disabled={status !== 'connected'}>
          <Text style={styles.buttonText}>Start Pending Action</Text>
        </TouchableOpacity>

        <Text testID="e2e-pending-action" style={styles.state}>
          {pendingAction ? 'Pending action: waiting for wallet' : 'Pending action: none'}
        </Text>

        <TouchableOpacity testID="e2e-expire-session" accessibilityRole="button" onPress={expireSessionForE2E} style={styles.button} disabled={!pendingAction || status !== 'connected'}>
          <Text style={styles.buttonText}>Expire Session</Text>
        </TouchableOpacity>

        {sessionExpired ? (
          <View testID="wallet-reconnect-prompt" style={styles.prompt}>
            <Text style={styles.promptTitle}>Wallet session expired</Text>
            <Text style={styles.promptText}>Reconnect your wallet to resume the pending action.</Text>
            <TouchableOpacity testID="e2e-reconnect-wallet" accessibilityRole="button" onPress={() => void connectWallet()} style={styles.button}>
              <Text style={styles.buttonText}>Reconnect Wallet</Text>
            </TouchableOpacity>
            <TouchableOpacity testID="e2e-cancel-reconnect" accessibilityRole="button" onPress={cancel} style={styles.cancelButton}>
              <Text style={styles.cancelText}>Cancel Reconnect</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {resumed ? <Text testID="e2e-pending-action-resumed" style={styles.success}>Pending action resumed after reconnect.</Text> : null}
        {cancelled ? <Text testID="e2e-reconnect-cancelled" style={styles.cancelled}>Reconnect cancelled; pending action was not resumed.</Text> : null}
        {error ? <Text testID="e2e-wallet-error" style={styles.error}>{error}</Text> : null}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, padding: 24, justifyContent: 'center', gap: 14 },
  title: { fontSize: 24, fontWeight: '700', textAlign: 'center' },
  status: { textAlign: 'center', fontSize: 16 },
  state: { textAlign: 'center', fontSize: 15 },
  button: { padding: 14, borderRadius: 10, backgroundColor: '#1E90FF', alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' },
  prompt: { padding: 16, borderRadius: 12, borderWidth: 1, gap: 10 },
  promptTitle: { fontSize: 18, fontWeight: '700' },
  promptText: { fontSize: 14 },
  cancelButton: { padding: 12, alignItems: 'center' },
  cancelText: { fontWeight: '700' },
  success: { textAlign: 'center', fontWeight: '700' },
  cancelled: { textAlign: 'center', fontWeight: '700' },
  error: { textAlign: 'center' },
});
