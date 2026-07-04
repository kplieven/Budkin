import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { ActivityRow } from '@/features/activity/ActivityRow';
import { groupByDay } from '@/features/activity/groupByDay';
import { DesktopPage } from '@/shell/DesktopPage';
import { useDesktopShell } from '@/shell/useDesktopShell';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

export default function History() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const desktop = useDesktopShell();
  const entries = useAppStore((s) => s.entries);
  const now = useAppStore((s) => s.now);
  const child = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId));
  const openSwitcher = useAppStore((s) => s.openSwitcher);
  const openEdit = useAppStore((s) => s.openEdit);

  const groups = groupByDay(entries, now);

  const body =
    entries.length === 0 ? (
      <View style={{ alignItems: 'center', paddingVertical: 64, paddingHorizontal: 24, gap: 14 }}>
        <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="list" color={t.faint} size={34} />
        </View>
        <Txt weight={700} size={18}>
          Nothing logged yet
        </Txt>
        <Txt weight={500} size={14} color={t.dim} style={{ textAlign: 'center', maxWidth: 240, lineHeight: 20 }}>
          Your timeline fills up as you log feedings, sleep and diapers. Tap a big button on Home to start.
        </Txt>
      </View>
    ) : (
      groups.map((g) => (
        <View key={g.label} style={{ marginBottom: 18 }}>
          <Txt weight={700} size={12.5} color={t.faint} tracking={0.8} style={{ marginHorizontal: 4, marginBottom: 9, textTransform: 'uppercase' }}>
            {g.label}
          </Txt>
          {/* Desktop: two-up grid (web handoff). Phone: single column. */}
          <View style={desktop ? { flexDirection: 'row', flexWrap: 'wrap', gap: 11 } : { gap: 8 }}>
            {g.items.map((e) => (
              <View key={e.id} style={desktop ? { flexBasis: '48%', flexGrow: 1, minWidth: 280 } : undefined}>
                <ActivityRow entry={e} now={now} onPress={() => openEdit(e.id)} />
              </View>
            ))}
          </View>
        </View>
      ))
    );

  if (desktop) return <DesktopPage maxWidth={760}>{body}</DesktopPage>;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: 24 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2, paddingTop: 4, paddingBottom: 16 }}>
        <Txt weight={800} size={27} tracking={-0.6}>
          History
        </Txt>
        <Pressable
          onPress={openSwitcher}
          accessibilityRole="button"
          accessibilityLabel={child ? `${child.first}, switch child` : 'Switch child'}
          style={(s) => [{ cursor: 'pointer' }, isHovered(s) && { opacity: 0.85 }]}
        >
          <Avatar child={child} size={38} radius={12} fontSize={16} />
        </Pressable>
      </View>
      {body}
    </ScrollView>
  );
}
