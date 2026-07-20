import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Toggle } from '@/components/Toggle';
import { Txt } from '@/components/Txt';
import { hasReminderPermission, requestReminderPermission } from '@/notifications/permission';
import { DesktopPage } from '@/shell/DesktopPage';
import { useDesktopShell } from '@/shell/useDesktopShell';
import { useAppStore } from '@/store/useAppStore';
import { makeSettingsListStyles } from '@/theme/settingsList';
import { useTheme } from '@/theme/useTheme';

type ReminderKey = 'dueDateReminders' | 'staleTimerReminders' | 'ageMilestones';

export default function NotificationSettings() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const desktop = useDesktopShell();
  const dueDateReminders = useAppStore((s) => s.dueDateReminders);
  const staleTimerReminders = useAppStore((s) => s.staleTimerReminders);
  const ageMilestones = useAppStore((s) => s.ageMilestones);
  const setReminderPref = useAppStore((s) => s.setReminderPref);

  const [granted, setGranted] = useState(true);
  useEffect(() => {
    void hasReminderPermission().then(setGranted);
  }, []);

  const { group, row } = makeSettingsListStyles(t);

  const rows: { key: ReminderKey; label: string; hint: string; on: boolean }[] = [
    {
      key: 'dueDateReminders',
      label: 'Due date',
      hint: 'A week before, and on the day itself.',
      on: dueDateReminders,
    },
    {
      key: 'staleTimerReminders',
      label: 'Timer left running',
      hint: 'If a timer runs far longer than usual.',
      on: staleTimerReminders,
    },
    {
      key: 'ageMilestones',
      label: 'Age milestones',
      hint: 'One week, one month, then every few months.',
      on: ageMilestones,
    },
  ];

  const body = (
    <>
      {!granted && (
        <Pressable
          onPress={() => void requestReminderPermission().then(setGranted)}
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
      )}

      <View style={group}>
        {rows.map((r, i) => (
          <Pressable
            key={r.key}
            onPress={() => setReminderPref(r.key, !r.on)}
            accessibilityRole="switch"
            accessibilityLabel={r.label}
            accessibilityState={{ checked: r.on }}
            style={(s) => [
              row,
              i < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: t.line },
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
        ))}
      </View>
    </>
  );

  // Mirrors settings/index.tsx: DesktopPage takes only `maxWidth` and
  // `children` (no title prop), so the heading lives in the mobile branch
  // just as it does there.
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
