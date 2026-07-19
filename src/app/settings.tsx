import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip } from '@/components/Chip';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
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
  const unitSystem = useAppStore((s) => s.unitSystem);
  const simulateOffline = useAppStore((s) => s.simulateOffline);
  const networkOnline = useAppStore((s) => s.networkOnline);
  const connection = useAppStore((s) => s.connection);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const setUnitSystem = useAppStore((s) => s.setUnitSystem);
  const toggleOffline = useAppStore((s) => s.toggleOffline);
  const disconnect = useAppStore((s) => s.disconnect);
  const profile = useAppStore((s) => s.profile);
  const loadProfile = useAppStore((s) => s.loadProfile);
  const openAdopt = useAppStore((s) => s.openAdopt);
  const children = useAppStore((s) => s.children);
  const entries = useAppStore((s) => s.entries);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

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

  const host =
    connection?.mode === 'local'
      ? 'Local mode'
      : connection?.mode === 'server'
        ? connection.serverUrl.replace(/^https?:\/\//, '') || '—'
        : '—';
  const tokenMask =
    connection?.mode === 'local'
      ? 'No server'
      : connection?.mode === 'server' && connection.token
        ? `Connected · token ••••${connection.token.slice(-4)}`
        : 'Not connected';

  // Read-only display of the connected user's Baby Buddy general settings
  // (from /api/profile/). The whole group is shown ONLY when the server actually
  // returned some settings: /api/profile/ 500s on some instances (e.g. a user
  // without a Settings row), so rather than surface a scary error we simply omit
  // the group — the fetch failure is logged in the store's loadProfile. Demo mode
  // has no server, so it's hidden there too. Present fields render; missing ones dash.
  const profileRows = [
    { label: 'Username', value: profile?.username || '—' },
    { label: 'Timezone', value: profile?.timezone || '—' },
    { label: 'Language', value: profile?.language || '—' },
    { label: 'Dashboard refresh', value: profile?.dashboardRefreshRate || '—' },
  ];
  const showProfileGroup =
    connection?.mode !== 'local' &&
    !!(profile?.username || profile?.timezone || profile?.language || profile?.dashboardRefreshRate);

  const body = (
    <>
      <Txt weight={700} size={12.5} color={t.faint} tracking={0.8} style={{ ...sectionLabel, marginTop: 4, textTransform: 'uppercase' }}>
        Appearance
      </Txt>
      <View style={group}>
        <Pressable
          onPress={toggleTheme}
          accessibilityRole="switch"
          accessibilityLabel="Night mode"
          accessibilityState={{ checked: themeMode === 'dark' }}
          style={(s) => [
            row,
            { borderBottomWidth: 1, borderBottomColor: t.line, cursor: 'pointer' },
            isHovered(s) && { backgroundColor: t.elevated },
          ]}
        >
          <Txt unselectable weight={600} size={16} style={{ flex: 1 }}>
            Night mode
          </Txt>
          <Toggle on={themeMode === 'dark'} />
        </Pressable>
        <View style={[row, { borderBottomWidth: __DEV__ ? 1 : 0, borderBottomColor: t.line }]}>
          <Txt weight={600} size={16} style={{ flex: 1 }}>
            Units
          </Txt>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['metric', 'imperial'] as const).map((sys) => (
              <Chip
                key={sys}
                label={sys === 'metric' ? 'Metric' : 'Imperial'}
                color={t.primary}
                selected={unitSystem === sys}
                onPress={() => setUnitSystem(sys)}
                padH={13}
                padV={7}
                fontSize={13.5}
              />
            ))}
          </View>
        </View>
        {__DEV__ && (
          <Pressable
            onPress={toggleOffline}
            accessibilityRole="switch"
            accessibilityLabel="Simulate offline"
            accessibilityState={{ checked: simulateOffline }}
            style={(s) => [row, { cursor: 'pointer' }, isHovered(s) && { backgroundColor: t.elevated }]}
          >
            <Txt unselectable weight={600} size={16} style={{ flex: 1 }}>
              Simulate offline
            </Txt>
            <Toggle on={simulateOffline} />
          </Pressable>
        )}
      </View>

      {showProfileGroup && (
        <>
          <Txt weight={700} size={12.5} color={t.faint} tracking={0.8} style={{ ...sectionLabel, textTransform: 'uppercase' }}>
            Baby Buddy
          </Txt>
          <View style={group}>
            {profileRows.map((r, i) => (
              <View
                key={r.label}
                style={[row, i < profileRows.length - 1 && { borderBottomWidth: 1, borderBottomColor: t.line }]}
              >
                <Txt weight={600} size={16} style={{ flex: 1 }}>
                  {r.label}
                </Txt>
                <Txt weight={500} size={13} color={t.dim}>
                  {r.value}
                </Txt>
              </View>
            ))}
          </View>
        </>
      )}

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
        {connection?.mode === 'local' && (
          <Pressable
            onPress={openAdopt}
            accessibilityRole="button"
            style={(s) => [row, { borderBottomWidth: connection?.mode === 'local' ? 0 : 1, borderBottomColor: t.line, cursor: 'pointer' }, isHovered(s) && { backgroundColor: t.elevated }]}
          >
            <View style={{ flex: 1 }}>
              <Txt unselectable weight={600} size={16} color={t.primary}>
                Connect Baby Buddy
              </Txt>
              <Txt unselectable weight={500} size={12.5} color={t.dim} style={{ marginTop: 2 }}>
                {children.length} {children.length === 1 ? 'child' : 'children'} · {entries.length}{' '}
                {entries.length === 1 ? 'entry' : 'entries'} stored on this device
              </Txt>
            </View>
          </Pressable>
        )}
        {connection?.mode !== 'local' && (
          <Pressable
            onPress={() => {
              disconnect();
              if (router.canDismiss()) router.dismissAll();
              router.replace('/onboarding');
            }}
            accessibilityRole="button"
            style={(s) => [row, { cursor: 'pointer' }, isHovered(s) && { backgroundColor: t.elevated }]}
          >
            <Txt unselectable weight={600} size={16} color={t.primary} style={{ flex: 1 }}>
              Reconnect / change server
            </Txt>
          </Pressable>
        )}
      </View>

      <Txt weight={700} size={12.5} color={t.faint} tracking={0.8} style={{ ...sectionLabel, textTransform: 'uppercase' }}>
        Help
      </Txt>
      <View style={group}>
        <Pressable
          onPress={() => router.push('/tour')}
          accessibilityRole="button"
          style={(s) => [row, { cursor: 'pointer' }, isHovered(s) && { backgroundColor: t.elevated }]}
        >
          <Txt unselectable weight={600} size={16} color={t.primary} style={{ flex: 1 }}>
            How Budkin works
          </Txt>
          <Icon name="chevron-right" color={t.faint} size={18} />
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
        <IconButton name="chevron-left" color={t.text} onPress={() => router.back()} accessibilityLabel="Back" />
        <Txt weight={800} size={27} tracking={-0.6}>
          Settings
        </Txt>
      </View>
      {body}
    </ScrollView>
  );
}
