import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/IconButton';
import { Txt } from '@/components/Txt';
import { DesktopPage } from '@/shell/DesktopPage';
import { useDesktopShell } from '@/shell/useDesktopShell';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

function Toggle({ on }: { on: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        width: 50,
        height: 30,
        borderRadius: 99,
        backgroundColor: on ? t.primary : t.elevated,
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: 3,
          left: on ? 23 : 3,
          width: 24,
          height: 24,
          borderRadius: 99,
          backgroundColor: '#fff',
          boxShadow: '0px 1px 3px rgba(0,0,0,0.3)',
        }}
      />
    </View>
  );
}

export default function Settings() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const desktop = useDesktopShell();
  const themeMode = useAppStore((s) => s.themeMode);
  const simulateOffline = useAppStore((s) => s.simulateOffline);
  const networkOnline = useAppStore((s) => s.networkOnline);
  const connection = useAppStore((s) => s.connection);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const toggleOffline = useAppStore((s) => s.toggleOffline);
  const disconnect = useAppStore((s) => s.disconnect);

  const group = {
    backgroundColor: t.surface,
    borderWidth: 1.5,
    borderColor: t.line,
    borderRadius: 18,
    overflow: 'hidden' as const,
  };
  const row = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 15,
    paddingHorizontal: 16,
  };
  const sectionLabel = {
    marginTop: 22,
    marginBottom: 9,
    marginHorizontal: 4,
  };

  const host = connection?.demo ? 'Demo mode' : connection?.serverUrl?.replace(/^https?:\/\//, '') || '—';
  const tokenMask = connection?.demo
    ? 'No server'
    : connection?.token
      ? `Connected · token ••••${connection.token.slice(-4)}`
      : 'Not connected';

  const body = (
    <>
      <Txt weight={700} size={12.5} color={t.faint} tracking={0.8} style={{ ...sectionLabel, marginTop: 4, textTransform: 'uppercase' }}>
        Appearance
      </Txt>
      <View style={group}>
        <Pressable onPress={toggleTheme} style={[row, { borderBottomWidth: 1, borderBottomColor: t.line }]}>
          <Txt weight={600} size={16} style={{ flex: 1 }}>
            Night mode
          </Txt>
          <Toggle on={themeMode === 'dark'} />
        </Pressable>
        <Pressable onPress={toggleOffline} style={row}>
          <Txt weight={600} size={16} style={{ flex: 1 }}>
            Simulate offline
          </Txt>
          <Toggle on={simulateOffline} />
        </Pressable>
      </View>

      <Txt weight={700} size={12.5} color={t.faint} tracking={0.8} style={{ ...sectionLabel, textTransform: 'uppercase' }}>
        Server
      </Txt>
      <View style={group}>
        <View style={[row, { borderBottomWidth: 1, borderBottomColor: t.line }]}>
          <Txt weight={600} size={16} style={{ flex: 1 }}>
            Network
          </Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Txt weight={500} size={13} color={t.dim}>
              {networkOnline ? 'Online' : 'Offline'}
            </Txt>
            <View style={{ width: 9, height: 9, borderRadius: 99, backgroundColor: networkOnline ? '#5FB39B' : '#E2B554' }} />
          </View>
        </View>
        <View style={[row, { borderBottomWidth: 1, borderBottomColor: t.line }]}>
          <View style={{ flex: 1 }}>
            <Txt weight={600} size={16}>
              {host}
            </Txt>
            <Txt weight={500} size={13} color={t.dim} style={{ marginTop: 2 }}>
              {tokenMask}
            </Txt>
          </View>
          <View style={{ width: 9, height: 9, borderRadius: 99, backgroundColor: '#5FB39B' }} />
        </View>
        <Pressable
          onPress={() => {
            disconnect();
            router.replace('/onboarding');
          }}
          style={row}
        >
          <Txt weight={600} size={16} color={t.primary} style={{ flex: 1 }}>
            Reconnect / change server
          </Txt>
        </Pressable>
      </View>
    </>
  );

  if (desktop) return <DesktopPage maxWidth={560}>{body}</DesktopPage>;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: insets.bottom + 24 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4, marginBottom: 14 }}>
        <IconButton name="chevron-left" color={t.text} onPress={() => router.back()} />
        <Txt weight={800} size={27} tracking={-0.6}>
          Settings
        </Txt>
      </View>
      {body}
    </ScrollView>
  );
}
