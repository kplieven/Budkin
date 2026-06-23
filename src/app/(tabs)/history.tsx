import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { Icon, type IconName } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { ACTIVITY_LABEL } from '@/lib/activities';
import { hexA } from '@/lib/color';
import { dayGroupLabel, fmtAgo, fmtClock, fmtDur } from '@/lib/format';
import { entryTimestamp, type Entry } from '@/types/models';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

const FEED_TYPE_LABEL: Record<string, string> = {
  breast: 'Breast milk',
  formula: 'Formula',
  fortified: 'Fortified',
  solid: 'Solid food',
};
const FEED_METHOD_LABEL: Record<string, string> = {
  left: 'left breast',
  right: 'right breast',
  both: 'both',
  bottle: 'bottle',
  parent: 'parent fed',
  self: 'self fed',
};

function detailFor(e: Entry): string {
  switch (e.type) {
    case 'feeding':
      return [
        FEED_TYPE_LABEL[e.feedType] ?? '',
        FEED_METHOD_LABEL[e.method] ?? '',
        e.amount ? `${e.amount}ml` : '',
        e.end ? fmtDur((e.end - e.start) / 60000) : '',
      ]
        .filter(Boolean)
        .join(' · ');
    case 'sleep':
      return (e.nap ? 'Nap' : 'Night') + (e.end ? ' · ' + fmtDur((e.end - e.start) / 60000) : ' · ongoing');
    case 'diaper':
      return [e.wet ? 'Wet' : '', e.solid ? 'Solid' : '', e.color ?? ''].filter(Boolean).join(' · ') || 'Dry';
    case 'pumping':
      return [e.amount ? `${e.amount}ml` : '', e.end ? fmtDur((e.end - e.start) / 60000) : ''].filter(Boolean).join(' · ');
    case 'tummy':
      return [e.end ? fmtDur((e.end - e.start) / 60000) : '', e.milestone ?? ''].filter(Boolean).join(' · ');
  }
}

export default function History() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const entries = useAppStore((s) => s.entries);
  const now = useAppStore((s) => s.now);
  const child = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId));
  const openSwitcher = useAppStore((s) => s.openSwitcher);
  const openEdit = useAppStore((s) => s.openEdit);

  const sorted = [...entries].sort((a, b) => entryTimestamp(b) - entryTimestamp(a));
  const groups: { label: string; items: Entry[] }[] = [];
  for (const e of sorted) {
    const label = dayGroupLabel(entryTimestamp(e), now);
    let g = groups.find((x) => x.label === label);
    if (!g) {
      g = { label, items: [] };
      groups.push(g);
    }
    g.items.push(e);
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: 24 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2, paddingTop: 4, paddingBottom: 16 }}>
        <Txt weight={800} size={27} tracking={-0.6}>
          History
        </Txt>
        <Pressable onPress={openSwitcher}>
          <Avatar child={child} size={38} radius={12} fontSize={16} />
        </Pressable>
      </View>

      {entries.length === 0 ? (
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
            <View style={{ gap: 8 }}>
              {g.items.map((e) => {
                const ts = entryTimestamp(e);
                const color = t.activity[e.type];
                return (
                  <Pressable
                    key={e.id}
                    onPress={() => openEdit(e.id)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      paddingVertical: 13,
                      paddingHorizontal: 14,
                      backgroundColor: t.surface,
                      borderWidth: 1.5,
                      borderColor: t.line,
                      borderRadius: 18,
                    }}
                  >
                    <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: hexA(color, 0.16), alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name={e.type as IconName} color={color} size={21} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Txt weight={700} size={15.5} tracking={-0.2}>
                        {ACTIVITY_LABEL[e.type]}
                      </Txt>
                      <Txt weight={500} size={13} color={t.dim} style={{ marginTop: 1 }}>
                        {detailFor(e)}
                      </Txt>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Txt weight={600} size={14} style={{ fontVariant: ['tabular-nums'] }}>
                        {fmtClock(ts)}
                      </Txt>
                      <Txt weight={500} size={12} color={t.faint} style={{ marginTop: 1 }}>
                        {fmtAgo(ts, now)}
                      </Txt>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}
