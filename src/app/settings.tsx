import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip } from '@/components/Chip';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Txt } from '@/components/Txt';
import { DesktopPage } from '@/shell/DesktopPage';
import { useDesktopShell } from '@/shell/useDesktopShell';
import {
  fmtMinuteOfDay,
  MINUTES_PER_DAY,
  NAP_WINDOW_STEP_MIN,
  SMALL_WASHES_PER_BIG_MAX,
  SMALL_WASHES_PER_BIG_MIN,
} from '@/store/selectors';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

/** The selectable bath rhythms, 1..7 small washes between big ones. */
const WASH_CHOICES = Array.from(
  { length: SMALL_WASHES_PER_BIG_MAX - SMALL_WASHES_PER_BIG_MIN + 1 },
  (_, i) => SMALL_WASHES_PER_BIG_MIN + i,
);

/** Every half hour of the day, 00:00 to 23:30, as minutes since midnight. */
const CLOCK_CHOICES = Array.from(
  { length: MINUTES_PER_DAY / NAP_WINDOW_STEP_MIN },
  (_, i) => i * NAP_WINDOW_STEP_MIN,
);

/**
 * One endpoint of the nap window as a single-line, horizontally-scrollable strip
 * of half-hour chips (the same strip pattern as the log sheet's quick-set row).
 * 48 chips would be eight wrapped rows inline, which would swamp the group; one
 * scrolling line keeps both endpoints readable at a glance.
 */
function ClockStrip({ value, onSelect }: { value: number; onSelect: (min: number) => void }) {
  const t = useTheme();
  const ref = useRef<ScrollView>(null);

  // Bring the selected chip into view. The strip is 48 chips wide and starts at
  // 00:00, so a default 07:00 would otherwise sit well off the right edge and
  // the row would look like nothing was selected at all.
  //
  // Driven by the selected chip's own onLayout rather than by arithmetic over an
  // assumed chip width: the labels are proportional text, so a computed offset
  // would drift. onLayout fires when the chip is first placed and again only if
  // it actually moves, so tapping a different chip does not yank the strip.
  const revealSelected = (x: number) => {
    ref.current?.scrollTo({ x: Math.max(0, x - 12), animated: false });
  };

  return (
    <ScrollView
      ref={ref}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 7, paddingRight: 4 }}
    >
      {CLOCK_CHOICES.map((min) => (
        <View
          key={min}
          onLayout={min === value ? (e) => revealSelected(e.nativeEvent.layout.x) : undefined}
        >
          <Chip
            label={fmtMinuteOfDay(min)}
            color={t.primary}
            selected={value === min}
            onPress={() => onSelect(min)}
            padH={11}
            padV={7}
            fontSize={13}
            radius={11}
          />
        </View>
      ))}
    </ScrollView>
  );
}

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
  const smallWashesPerBig = useAppStore((s) => s.smallWashesPerBig);
  const setSmallWashesPerBig = useAppStore((s) => s.setSmallWashesPerBig);
  const napWindowStartMin = useAppStore((s) => s.napWindowStartMin);
  const napWindowEndMin = useAppStore((s) => s.napWindowEndMin);
  const setNapWindow = useAppStore((s) => s.setNapWindow);
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

      <Txt weight={700} size={12.5} color={t.faint} tracking={0.8} style={{ ...sectionLabel, textTransform: 'uppercase' }}>
        Rhythm
      </Txt>
      <View style={group}>
        {/* The value counts SMALL washes between big ones, so the copy has to
            say "after every N small washes" — "every N baths" would be off by
            one, since the big wash is the (N+1)th bath of the cycle. */}
        <View style={[row, { flexDirection: 'column', alignItems: 'stretch', gap: 11, borderBottomWidth: 1, borderBottomColor: t.line }]}>
          <View>
            <Txt weight={600} size={16}>
              Big wash
            </Txt>
            <Txt weight={500} size={13} color={t.dim} style={{ marginTop: 2 }}>
              After every {smallWashesPerBig} small {smallWashesPerBig === 1 ? 'wash' : 'washes'}
            </Txt>
          </View>
          <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap' }}>
            {WASH_CHOICES.map((n) => (
              <Chip
                key={n}
                label={String(n)}
                color={t.primary}
                selected={smallWashesPerBig === n}
                onPress={() => setSmallWashesPerBig(n)}
                padH={13}
                padV={7}
                fontSize={13.5}
              />
            ))}
          </View>
        </View>

        {/* Nap window. A sleep is pre-set to Nap when it STARTS inside this
            window and to Night sleep otherwise; the log sheet always offers a
            manual override. Start inclusive, end exclusive, and a start later
            than the end wraps midnight, so an "inverted" pair still means
            something rather than matching nothing. */}
        <View style={[row, { flexDirection: 'column', alignItems: 'stretch', gap: 11 }]}>
          <View>
            <Txt weight={600} size={16}>
              Naps
            </Txt>
            <Txt weight={500} size={13} color={t.dim} style={{ marginTop: 2 }}>
              {napWindowStartMin === napWindowEndMin
                ? 'No nap window, so every sleep starts as night sleep'
                : `Sleep starting between ${fmtMinuteOfDay(napWindowStartMin)} and ${fmtMinuteOfDay(napWindowEndMin)} is a nap`}
            </Txt>
          </View>
          <View style={{ gap: 4 }}>
            <Txt weight={600} size={11.5} color={t.faint} tracking={0.2}>
              Naps start
            </Txt>
            <ClockStrip value={napWindowStartMin} onSelect={(m) => setNapWindow(m, napWindowEndMin)} />
          </View>
          <View style={{ gap: 4 }}>
            <Txt weight={600} size={11.5} color={t.faint} tracking={0.2}>
              Naps end
            </Txt>
            <ClockStrip value={napWindowEndMin} onSelect={(m) => setNapWindow(napWindowStartMin, m)} />
          </View>
          <Txt weight={500} size={12} color={t.faint}>
            Only affects new entries. Sleep already logged keeps whatever it was saved as.
          </Txt>
        </View>
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
