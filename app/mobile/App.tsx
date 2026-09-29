import React, { useEffect, useRef, useState } from 'react';
import * as ExpoLinking from 'expo-linking';
import {
  NavigationContainer,
  NavigationContainerRef,
} from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@sentry/react-native';
import { AppNavigator } from './src/navigation/AppNavigator';
import {
  RootStackParamList,
  deepLinkToNavParams,
} from './src/navigation/types';
import { WalletProvider } from './src/contexts/WalletContext';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { BiometricProvider } from './src/contexts/BiometricContext';
import { SyncProvider } from './src/contexts/SyncContext';
import {
  NotificationProvider,
  useNotification,
} from './src/contexts/NotificationContext';
import { SaverModeProvider } from './src/contexts/SaverModeContext';
import { SyncDeferralProvider } from './src/contexts/SyncDeferralContext';
import { LanguageProvider } from './src/contexts/LanguageContext';
import { UpdateProvider, useUpdate } from './src/contexts/UpdateContext';
import {
  CrashReportingProvider,
  useCrashReporting,
} from './src/contexts/CrashReportingContext';
import { ReleaseNotesModal } from './src/components/ReleaseNotesModal';
import { ForceUpgradeScreen } from './src/screens/ForceUpgradeScreen';
import { WalletReconnectE2EScreen } from './src/e2e/WalletReconnectE2EScreen';
import { markColdStartPhase } from './src/startup/coldStartTracker';

const isWalletReconnectE2E = process.env.EXPO_PUBLIC_E2E_WALLET_RECONNECT === '1';

const linking = {
  prefixes: [ExpoLinking.createURL('/'), 'soter://'],

  config: {
    screens: {
      Home: '',
      AidOverview: 'aid',
      AidDetails: 'aid/:aidId',
      ClaimReceipt: 'claim/:claimId',
      Settings: 'settings',
      Health: 'health',
      Scanner: 'scanner',
    },
  },
};

const AppInner = () => {
  const { navTheme, scheme } = useTheme();
  const { pendingDeepLink, consumeDeepLink } = useNotification();
  const navigationRef =
    useRef<NavigationContainerRef<RootStackParamList>>(null);
  const { isForceUpgrade, isLoading } = useUpdate();
  const [isNavReady, setIsNavReady] = useState(false);

  useEffect(() => {
    if (!pendingDeepLink || !isNavReady) return;

    const navParams = deepLinkToNavParams(pendingDeepLink);
    if (!navParams) {
      consumeDeepLink();
      return;
    }

    if (navigationRef.current?.isReady?.()) {
      navigationRef.current.navigate(
        navParams.screen as any,
        navParams.params as any,
      );
      consumeDeepLink();
    }
  }, [pendingDeepLink, isNavReady, consumeDeepLink]);

  if (isLoading) {
    return null;
  }

  if (isForceUpgrade) {
    return <ForceUpgradeScreen />;
  }

  return (
    <WalletProvider>
      {isWalletReconnectE2E ? (
        <WalletReconnectE2EScreen />
      ) : (
        <BiometricProvider>
          <SyncDeferralProvider>
            <SyncProvider>
              <NavigationContainer
                linking={linking}
                theme={navTheme}
                ref={navigationRef}
                onReady={() => {
                  markColdStartPhase('navigationReady');
                  setIsNavReady(true);
                }}
              >
                <AppNavigator />
                <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
              </NavigationContainer>
              <ReleaseNotesModal />
            </SyncProvider>
          </SyncDeferralProvider>
        </BiometricProvider>
      )}
    </WalletProvider>
  );
};

const CrashReportingGate: React.FC = () => {
  const { isLoading } = useCrashReporting();
  if (isLoading) return null;

  return (
    <ErrorBoundary
      onError={(error, errorInfo) => {
        console.warn('[CrashReportingGate] Caught by ErrorBoundary:', error);
      }}
    >
      <SafeAreaProvider>
        <ThemeProvider>
          <LanguageProvider>
            <UpdateProvider>
              <SaverModeProvider>
                <SyncDeferralProvider>
                  <NotificationProvider>
                    <AppInner />
                  </NotificationProvider>
                </SyncDeferralProvider>
              </SaverModeProvider>
            </UpdateProvider>
          </LanguageProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
};

export default function App() {
  markColdStartPhase('appRenderStart');
  return (
    <CrashReportingProvider>
      <CrashReportingGate />
    </CrashReportingProvider>
  );
}
