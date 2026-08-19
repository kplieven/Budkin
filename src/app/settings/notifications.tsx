import { router } from 'expo-router';
import { Fragment, type ReactNode, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip } from '@/components/Chip';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Toggle } from '@/components/Toggle';
import { Txt } from '@/components/Txt';
import { hasReminderPermission, requestReminderPermission } from '@/notifications/permission';
import { reconcileNow } from '@/notifications/scheduleSync';
import { DesktopPage } from '@/shell/DesktopPage';
import { useDesktopShell } from '@/shell/useDesktopShell';
import { useAppStore } from '@/store/useAppStore';
import { makeSettingsListStyles } from '@/theme/settingsList';
import { useTheme } from '@/theme/useTheme';

type ReminderKey =
  | 'dueDateReminders'
  | 'staleTimerReminders'
  | 'ageMilestones'
  | 'napSuggestions'
  | 'pumpingReminders'
  | 'treatmentReminders'
  | 'milestoneCatchUp';

interface ReminderRow {
  key: ReminderKey;
  label: string;
  hint: string;
  on: boolean;
  /** Settings this reminder owns, revealed directly beneath it while it is on. */
  sub?: ReactNode;
}

/** Grouped by what drives them, the same split as `scheduled.ts`: `Routine` off the
 *  rhythm of what you log, `Milestones` off fixed dates derived from the birth
 *  date, `App` off the app's own state rather than the baby's. */
interface ReminderSection {
  label: string;
  rows: ReminderRow[];
}

/** Selectable gaps between pumping reminders, in minutes. */
const PUMP_INTERVALS_MIN = [120, 180, 240, 300];

export default function NotificationSettings() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const desktop = useDesktopShell();
  const dueDateReminders = useAppStore((s) => s.dueDateReminders);
  const staleTimerReminders = useAppStore((s) => s.staleTimerReminders);
  const ageMilestones = useAppStore((s) => s.ageMilestones);
  const napSuggestions = useAppStore((s) => s.napSuggestions);
  const pumpingReminders = useAppStore((s) => s.pumpingReminders);
  const pumpingIntervalMin = useAppStore((s) => s.pumpingIntervalMin);
  const treatmentReminders = useAppStore((s) => s.treatmentReminders);
  const milestoneCatchUp = useAppStore((s) => s.milestoneCatchUp);
  const setReminderPref = useAppStore((s) => s.setReminderPref);
  const setPumpingInterval = useAppStore((s) => s.setPumpingInterval);

  const [granted, setGranted] = useState(true);
  useEffect(() => {
    void hasReminderPermission().then(setGranted);
  }, []);

  const { group, row, sectionLabel } = makeSettingsListStyles(t);

  const pumpingInterval = (
    <>
      <Txt unselectable weight={500} size={12.5} color={t.dim} style={{ marginBottom: 9 }}>
        Remind me every
      </Txt>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {PUMP_INTERVALS_MIN.map((min) => (
          <Chip
            key={min}
            label={`${min / 60}h`}
            accessibilityLabel={`Every ${min / 60} hours`}
            color={t.primary}
            selected={pumpingIntervalMin === min}
            onPress={() => setPumpingInterval(min)}
          />
        ))}
      </View>
    </>
  );

  const sections: ReminderSection[] = [
    {
      label: 'Routine',
      rows: [
        {
          key: 'napSuggestions',
          label: 'Nap suggestions',
          hint: 'As your baby nears the typical wake window for their age. General guidance, not medical advice.',
          on: napSuggestions,
        },
        {
          key: 'pumpingReminders',
          label: 'Pumping',
          hint: 'On a set interval from your last session.',
          on: pumpingReminders,
          sub: pumpingInterval,
        },
        {
          key: 'treatmentReminders',
          label: 'Treatments',
          hint: 'When a dose of a treatment is due.',
          on: treatmentReminders,
        },
      ],
    },
    {
      label: 'Milestones',
      rows: [
        {
          key: 'dueDateReminders',
          label: 'Due date',
          hint: 'A week before, and on the day itself.',
          on: dueDateReminders,
        },
        {
          key: 'ageMilestones',
          label: 'Age milestones',
          hint: 'One week, one month, then every few months.',
          on: ageMilestones,
        },
        {
          key: 'milestoneCatchUp',
          label: 'Milestone catch-up',
          hint: 'When a typical window passes with nothing logged, a nudge to check whether it already happened.',
          on: milestoneCatchUp,
        },
      ],
    },
    {
      label: 'App',
      rows: [
        {
          key: 'staleTimerReminders',
          label: 'Timer left running',
          hint: 'If a timer runs far longer than usual.',
          on: staleTimerReminders,
        },
      ],
    },
  ];

  const divider = { borderBottomWidth: 1, borderBottomColor: t.line };

  const body = (
    <>
      {Platform.OS === 'android' ? (
        !granted && (
          <Pressable
            onPress={() =>
              void requestReminderPermission().then((g) => {
                setGranted(g);
                // Granting touches no store slice, so the scheduleSync subscriber
                // never sees it: without this nothing would reconcile until the next
                // gated write or the next cold launch.
                if (g) reconcileNow();
              })
            }
            accessibilityRole="button"
            accessibilityLabel="Allow notifications"
            style={(s) => [
              { ...group, ...row, marginBottom: 16, cursor: 'pointer' },
              isHovered(s) && { backgroundColor: t.elevated },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Txt unselectable weight={600} size={16} color={t.primary}>
                Allow notifications
              </Txt>
              <Txt unselectable weight={500} size={12.5} color={t.dim} style={{ marginTop: 2 }}>
                Budkin cannot remind you until you turn these on.
              </Txt>
            </View>
            <Icon name="chevron-right" color={t.faint} size={18} />
          </Pressable>
        )
      ) : (
        // Off Android there is no permission to grant and nothing here ever
        // schedules: `permission.ts`'s stub always reports not-granted, so the card
        // above would show permanently, telling a web or iOS user to turn on
        // something they cannot. The route is reachable by URL off Android, so this
        // branch has to hold on its own.
        <View style={{ ...group, ...row, marginBottom: 16 }}>
          <View style={{ flex: 1 }}>
            <Txt unselectable weight={600} size={16}>
              Android only
            </Txt>
            <Txt unselectable weight={500} size={12.5} color={t.dim} style={{ marginTop: 2 }}>
              Scheduled reminders are available on Android. This device cannot receive them.
            </Txt>
          </View>
        </View>
      )}

      {sections.map((section, si) => (
        <Fragment key={section.label}>
          <Txt
            weight={700}
            size={12.5}
            color={t.faint}
            tracking={0.8}
            style={{ ...sectionLabel, ...(si === 0 && { marginTop: 4 }), textTransform: 'uppercase' }}
          >
            {section.label}
          </Txt>
          <View style={group}>
            {section.rows.map((r, i) => {
              const last = i === section.rows.length - 1;
              const showSub = r.sub != null && r.on;
              return (
                <Fragment key={r.key}>
                  <Pressable
                    onPress={() => setReminderPref(r.key, !r.on)}
                    accessibilityRole="switch"
                    accessibilityLabel={r.label}
                    accessibilityState={{ checked: r.on }}
                    style={(s) => [
                      row,
                      // The sub-row carries the divider in its place.
                      !showSub && !last && divider,
                      { cursor: 'pointer' },
                      isHovered(s) && { backgroundColor: t.elevated },
                    ]}
                  >
                    <View style={{ flex: 1, paddingRight: 12 }}>
                      <Txt unselectable weight={600} size={16}>
                        {r.label}
                      </Txt>
                      <Txt unselectable weight={500} size={12.5} color={t.dim} style={{ marginTop: 2 }}>
                        {r.hint}
                      </Txt>
                    </View>
                    <Toggle on={r.on} />
                  </Pressable>

                  {showSub && (
                    <View
                      style={{
                        backgroundColor: t.elevated,
                        paddingTop: 13,
                        paddingBottom: 15,
                        paddingLeft: 28,
                        paddingRight: 16,
                        ...(!last && divider),
                      }}
                    >
                      {r.sub}
                    </View>
                  )}
                </Fragment>
              );
            })}
          </View>
        </Fragment>
      ))}
    </>
  );

  // DesktopPage takes no title prop, so the heading lives in the mobile branch.
  if (desktop) return <DesktopPage maxWidth={560}>{body}</DesktopPage>;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: insets.bottom + 24 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4, marginBottom: 14 }}>
        <IconButton name="chevron-left" color={t.text} onPress={() => router.back()} accessibilityLabel="Back" />
        <Txt weight={800} size={27} tracking={-0.6}>
          Notifications
        </Txt>
      </View>
      {body}
    </ScrollView>
  );
}
