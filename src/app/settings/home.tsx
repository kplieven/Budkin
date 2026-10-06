import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Tappable } from '@/components/press';
import { Toggle } from '@/components/Toggle';
import { Txt } from '@/components/Txt';
import { ICON_FOR } from '@/features/dashboard/DashboardContent';
import { ACTIVITY_LABEL, ALL_ACTIVITIES, visibleActivities } from '@/lib/activities';
import { hexA } from '@/lib/color';
import { DesktopPage } from '@/shell/DesktopPage';
import { useDesktopShell } from '@/shell/useDesktopShell';
import { useAppStore } from '@/store/useAppStore';
import { makeSettingsListStyles } from '@/theme/settingsList';
import { useTheme } from '@/theme/useTheme';

/** Which activity tiles the Home "Log activity" grid shows on this device. */
export default function HomeCardSettings() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const desktop = useDesktopShell();
  const hiddenActivities = useAppStore((s) => s.hiddenActivities);
  const setActivityVisible = useAppStore((s) => s.setActivityVisible);

  const { group, row, sectionLabel } = makeSettingsListStyles(t);
  const onlyOneLeft = visibleActivities(hiddenActivities).length === 1;

  const body = (
    <>
      <Txt weight={700} size={12.5} color={t.faint} tracking={0.8} style={{ ...sectionLabel, marginTop: 4, textTransform: 'uppercase' }}>
        Log activity
      </Txt>
      <View style={group}>
        {ALL_ACTIVITIES.map((a, i) => {
          const on = !hiddenActivities.includes(a);
          // The store refuses to hide the last tile; the row says so rather than
          // flicking its switch and silently snapping back.
          const locked = on && onlyOneLeft;
          const color = t.activity[a];
          return (
            <Tappable
              key={a}
              onPress={() => setActivityVisible(a, !on)}
              disabled={locked}
              accessibilityRole="switch"
              accessibilityLabel={ACTIVITY_LABEL[a]}
              accessibilityState={{ checked: on, disabled: locked }}
              style={(s) => [
                row,
                { gap: 12, cursor: locked ? 'auto' : 'pointer' },
                i < ALL_ACTIVITIES.length - 1 && { borderBottomWidth: 1, borderBottomColor: t.line },
                !locked && isHovered(s) && { backgroundColor: t.elevated },
              ]}
            >
              <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: hexA(color, 0.16), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={ICON_FOR[a]} color={color} size={19} />
              </View>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Txt unselectable weight={600} size={16}>
                  {ACTIVITY_LABEL[a]}
                </Txt>
                {locked && (
                  <Txt unselectable weight={500} size={12.5} color={t.dim} style={{ marginTop: 2 }}>
                    At least one card stays on Home
                  </Txt>
                )}
              </View>
              <View style={{ opacity: locked ? 0.5 : 1 }}>
                <Toggle on={on} />
              </View>
            </Tappable>
          );
        })}
      </View>
      <Txt weight={500} size={12.5} color={t.faint} style={{ marginTop: 10, marginHorizontal: 4, lineHeight: 18 }}>
        Hidden activities also leave the timer save-as options, and their reminders pause. Anything already logged stays in History.
      </Txt>
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
          Home cards
        </Txt>
      </View>
      {body}
    </ScrollView>
  );
}
