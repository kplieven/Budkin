import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip } from '@/components/Chip';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Toggle } from '@/components/Toggle';
import { Txt } from '@/components/Txt';
import { treatmentDosageLabel, treatmentScheduleLabel } from '@/features/treatments/treatmentLabels';
import { backOr } from '@/lib/nav';
import { DesktopPage } from '@/shell/DesktopPage';
import { useDesktopShell } from '@/shell/useDesktopShell';
import {
  fmtDayStartHour,
  fmtMinuteOfDay,
  parseMinuteOfDay,
  SMALL_WASHES_PER_BIG_MAX,
  SMALL_WASHES_PER_BIG_MIN,
} from '@/store/selectors';
import { useAppStore } from '@/store/useAppStore';
import { fontFamily } from '@/theme/fonts';
import { makeSettingsListStyles } from '@/theme/settingsList';
import { useTheme } from '@/theme/useTheme';

/**
 * One endpoint of the nap window as a type-able 24-hour clock field, the same
 * digits-first shorthand as the log sheet's time editor ("7" is 07:00, "730" is
 * 07:30). A picker over a day's worth of times is a lot of travel for a value
 * that changes about twice a childhood, and typing also reaches the minute,
 * which a half-hour grid never could.
 *
 * Draft-then-commit, not commit-per-keystroke: the field holds its own text
 * while focused (null means "not editing, show the stored value") and only
 * writes on blur or submit. Unparseable text is discarded silently and the
 * stored value comes back, so a half-typed "1" can never land as 01:00.
 */
function ClockField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (min: number) => void;
}) {
  const t = useTheme();
  const [text, setText] = useState<string | null>(null); // null = not editing

  const display = fmtMinuteOfDay(value);

  const commit = (raw: string) => {
    setText(null);
    const min = parseMinuteOfDay(raw);
    if (min != null) onCommit(min);
  };

  // The sizing View around the TextInput is load-bearing on react-native-web:
  // a TextInput left as a direct flex item keeps min-width: auto and is pinned
  // to its intrinsic width, overflowing the row. Same workaround as DateFields.
  return (
    <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
      <Txt weight={600} size={11.5} color={t.faint} tracking={0.2}>
        {label}
      </Txt>
      <TextInput
        value={text ?? display}
        onFocus={() => setText('')}
        onChangeText={setText}
        onBlur={() => text != null && commit(text)}
        onSubmitEditing={() => text != null && commit(text)}
        placeholder={display}
        placeholderTextColor={t.faint}
        inputMode="numeric"
        keyboardType="number-pad"
        returnKeyType="done"
        selectTextOnFocus
        accessibilityLabel={label}
        style={{
          width: '100%',
          height: 46,
          borderRadius: 12,
          backgroundColor: t.surface,
          borderWidth: 1.5,
          borderColor: text != null ? t.primary : t.line2,
          textAlign: 'center',
          fontSize: 19,
          fontFamily: fontFamily(800),
          fontVariant: ['tabular-nums'],
          color: t.text,
        }}
      />
    </View>
  );
}

/**
 * A whole-number setting as a type-able field with − / + on either side. One
 * chip per allowed value stops scaling long before the range does, and it also
 * makes the range look like a rule when it is only a sanity bound, so the count
 * is typed and the buttons are there for the one-step nudge.
 *
 * Same draft-then-commit as ClockField, and here it is load-bearing rather than
 * tidy: the store's clamp turns NaN into the DEFAULT, not into the previous
 * value, so committing per keystroke would reset a user's 5 to 3 and persist it
 * the moment they cleared the field to type a new number. Empty or unparseable
 * text is discarded instead and the stored value comes back.
 */
function CountField({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (n: number) => void;
}) {
  const t = useTheme();
  const [text, setText] = useState<string | null>(null); // null = not editing

  const display = String(value);
  const atMin = value <= min;
  const atMax = value >= max;

  const commit = (raw: string) => {
    setText(null);
    const n = Number(raw.trim());
    // Number('') is 0, which would clamp to the minimum rather than cancel, so
    // an emptied field has to be caught before the parse is trusted.
    if (!raw.trim() || !Number.isFinite(n)) return;
    onCommit(Math.min(max, Math.max(min, Math.round(n))));
  };

  // Stepping abandons any half-typed draft and moves from the stored value, so
  // the two ways of editing can never compose into something out of range.
  const step = (delta: -1 | 1) => {
    setText(null);
    const next = Math.min(max, Math.max(min, value + delta));
    if (next !== value) onCommit(next);
  };

  const btn = (disabled: boolean) => ({
    width: 54,
    height: 46,
    borderRadius: 12,
    backgroundColor: t.chip,
    borderWidth: 1.5,
    borderColor: t.line,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    opacity: disabled ? 0.4 : 1,
    cursor: (disabled ? 'auto' : 'pointer') as 'auto' | 'pointer',
  });

  return (
    <View style={{ gap: 4 }}>
      <Txt weight={600} size={11.5} color={t.faint} tracking={0.2}>
        {label}
      </Txt>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable
          onPress={() => step(-1)}
          disabled={atMin}
          accessibilityRole="button"
          accessibilityLabel={`Fewer ${label.toLowerCase()}`}
          accessibilityState={{ disabled: atMin }}
          style={(s) => [btn(atMin), !atMin && isHovered(s) && { backgroundColor: t.elevated }]}
        >
          <Txt unselectable weight={700} size={22} color={t.text}>
            −
          </Txt>
        </Pressable>
        {/* The sizing View around the TextInput is load-bearing on
            react-native-web, same as in ClockField: a bare flex-item TextInput
            keeps min-width: auto and overflows the row. */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <TextInput
            value={text ?? display}
            onFocus={() => setText('')}
            onChangeText={setText}
            onBlur={() => text != null && commit(text)}
            onSubmitEditing={() => text != null && commit(text)}
            placeholder={display}
            placeholderTextColor={t.faint}
            inputMode="numeric"
            keyboardType="number-pad"
            returnKeyType="done"
            selectTextOnFocus
            accessibilityLabel={label}
            style={{
              width: '100%',
              height: 46,
              borderRadius: 12,
              backgroundColor: t.surface,
              borderWidth: 1.5,
              borderColor: text != null ? t.primary : t.line2,
              textAlign: 'center',
              fontSize: 19,
              fontFamily: fontFamily(800),
              fontVariant: ['tabular-nums'],
              color: t.text,
            }}
          />
        </View>
        <Pressable
          onPress={() => step(1)}
          disabled={atMax}
          accessibilityRole="button"
          accessibilityLabel={`More ${label.toLowerCase()}`}
          accessibilityState={{ disabled: atMax }}
          style={(s) => [btn(atMax), !atMax && isHovered(s) && { backgroundColor: t.elevated }]}
        >
          <Txt unselectable weight={700} size={22} color={t.text}>
            +
          </Txt>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Sentence-case a display label. fmtDayStartHour is a lowercase primitive so it
 * can be dropped mid-sentence elsewhere, but the "Day starts at" pills stand
 * alone, so they capitalize here. A no-op for labels like "7:00".
 */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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
  const rhythmOriginHour = useAppStore((s) => s.rhythmOriginHour);
  const setRhythmOriginHour = useAppStore((s) => s.setRhythmOriginHour);
  const toggleOffline = useAppStore((s) => s.toggleOffline);
  const disconnect = useAppStore((s) => s.disconnect);
  const profile = useAppStore((s) => s.profile);
  const loadProfile = useAppStore((s) => s.loadProfile);
  const openAdopt = useAppStore((s) => s.openAdopt);
  const children = useAppStore((s) => s.children);
  const entries = useAppStore((s) => s.entries);
  const treatments = useAppStore((s) => s.treatments);
  const selectedChildId = useAppStore((s) => s.selectedChildId);
  const openTreatmentEditor = useAppStore((s) => s.openTreatmentEditor);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const { group, row, sectionLabel } = makeSettingsListStyles(t);

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

  // Treatments are per-child, so scope the management list to the selected child.
  // Filtered in the render body (never inside a useAppStore selector) so a fresh
  // array can't drive the zustand v5 re-render loop. Both active and paused treatments
  // are shown here (this is where you manage them); the log picker filters.
  const selectedChild = children.find((c) => c.id === selectedChildId);
  const childTreatments = treatments.filter((c) => c.childId === selectedChildId);

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
          <CountField
            label="Small washes"
            value={smallWashesPerBig}
            min={SMALL_WASHES_PER_BIG_MIN}
            max={SMALL_WASHES_PER_BIG_MAX}
            onCommit={setSmallWashesPerBig}
          />
          <Txt weight={500} size={12} color={t.faint}>
            Type a number or use − and +, anywhere from {SMALL_WASHES_PER_BIG_MIN} to{' '}
            {SMALL_WASHES_PER_BIG_MAX}. The rhythm is read off the baths already logged, so a change
            shows up straight away in what&apos;s due next.
          </Txt>
        </View>

        {/* Nap window. A sleep is pre-set to Nap when it STARTS inside this
            window and to Night sleep otherwise; the log sheet always offers a
            manual override. Start inclusive, end exclusive, and a start later
            than the end wraps midnight, so an "inverted" pair still means
            something rather than matching nothing. */}
        <View style={[row, { flexDirection: 'column', alignItems: 'stretch', gap: 11, borderBottomWidth: 1, borderBottomColor: t.line }]}>
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
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <ClockField
              label="Naps start"
              value={napWindowStartMin}
              onCommit={(m) => setNapWindow(m, napWindowEndMin)}
            />
            <ClockField
              label="Naps end"
              value={napWindowEndMin}
              onCommit={(m) => setNapWindow(napWindowStartMin, m)}
            />
          </View>
          <Txt weight={500} size={12} color={t.faint}>
            24-hour clock: type 7 for 07:00, or 1930 for 19:30. Only affects new entries. Sleep
            already logged keeps whatever it was saved as.
          </Txt>
        </View>

        {/* Day boundary: the hour the 24h "day" starts at. Drives the Insights
            Rhythm graph + its trends and Home's daily sleep total. Persisted. */}
        <View style={[row, { flexDirection: 'column', alignItems: 'stretch', gap: 11 }]}>
          <View>
            <Txt weight={600} size={16}>
              Day starts at
            </Txt>
            <Txt weight={500} size={13} color={t.dim} style={{ marginTop: 2 }}>
              The 24-hour window for the Rhythm graph, its trends, and the daily sleep total on Home
            </Txt>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {[19, 12, 7, 0].map((h) => (
              <Chip
                key={h}
                label={capitalize(fmtDayStartHour(h))}
                color={t.primary}
                selected={rhythmOriginHour === h}
                onPress={() => setRhythmOriginHour(h)}
                padH={13}
                padV={7}
                fontSize={13.5}
              />
            ))}
          </View>
        </View>
      </View>

      {selectedChild && (
        <>
          <Txt weight={700} size={12.5} color={t.faint} tracking={0.8} style={{ ...sectionLabel, textTransform: 'uppercase' }}>
            Treatments for {selectedChild.first}
          </Txt>
          <View style={group}>
            {childTreatments.map((c, i) => (
              <Pressable
                key={c.id}
                onPress={() => openTreatmentEditor(c.id)}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${c.name}`}
                style={(s) => [
                  row,
                  { borderBottomWidth: 1, borderBottomColor: t.line, cursor: 'pointer' },
                  isHovered(s) && { backgroundColor: t.elevated },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Txt unselectable weight={600} size={16}>
                      {c.name}
                    </Txt>
                    {!c.active && (
                      <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: t.elevated }}>
                        <Txt unselectable weight={700} size={11} color={t.dim}>
                          Paused
                        </Txt>
                      </View>
                    )}
                  </View>
                  <Txt unselectable weight={500} size={13} color={t.dim} style={{ marginTop: 2 }}>
                    {[treatmentDosageLabel(c), treatmentScheduleLabel(c), c.condition].filter(Boolean).join(' · ') || 'No schedule set'}
                  </Txt>
                </View>
                <Icon name="chevron-right" color={t.faint} size={18} />
              </Pressable>
            ))}
            <Pressable
              onPress={() => openTreatmentEditor()}
              accessibilityRole="button"
              accessibilityLabel="Add a treatment"
              style={(s) => [row, { cursor: 'pointer' }, isHovered(s) && { backgroundColor: t.elevated }]}
            >
              <Icon name="plus" color={t.primary} size={18} />
              <Txt unselectable weight={600} size={16} color={t.primary} style={{ flex: 1, marginLeft: 10 }}>
                Add a treatment
              </Txt>
            </Pressable>
          </View>
          <Txt weight={500} size={12} color={t.faint} style={{ marginTop: 8, marginHorizontal: 4 }}>
            Treatments sync to Baby Buddy as tagged notes, so they follow you across devices. Doses
            save as ordinary medication entries and are matched to a treatment by name, so renaming
            one leaves its earlier doses behind.
          </Txt>
        </>
      )}

      {/* Scheduled reminders only fire on Android (permission.ts's stub is a
          permanent no off it), so the row is hidden rather than linking to a
          screen that can never do anything there. */}
      {Platform.OS === 'android' && (
        <>
          <Txt weight={700} size={12.5} color={t.faint} tracking={0.8} style={{ ...sectionLabel, textTransform: 'uppercase' }}>
            Reminders
          </Txt>
          <View style={group}>
            <Pressable
              onPress={() => router.navigate('/settings/notifications')}
              accessibilityRole="button"
              accessibilityLabel="Notifications"
              style={(s) => [row, { cursor: 'pointer' }, isHovered(s) && { backgroundColor: t.elevated }]}
            >
              <Txt unselectable weight={600} size={16} style={{ flex: 1 }}>
                Notifications
              </Txt>
              <Icon name="chevron-right" color={t.faint} size={18} />
            </Pressable>
          </View>
        </>
      )}

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
        <IconButton name="chevron-left" color={t.text} onPress={() => backOr()} accessibilityLabel="Back" />
        <Txt weight={800} size={27} tracking={-0.6}>
          Settings
        </Txt>
      </View>
      {body}
    </ScrollView>
  );
}
