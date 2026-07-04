import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { MEAS_KINDS, MEAS_META } from '@/lib/measurements';
import { DesktopPage } from '@/shell/DesktopPage';
import { useDesktopShell } from '@/shell/useDesktopShell';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

const dateLabel = (ms: number) => new Date(ms).toLocaleDateString();

export default function Growth() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const desktop = useDesktopShell();
  const measurements = useAppStore((s) => s.measurements);
  const child = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId));
  const openSwitcher = useAppStore((s) => s.openSwitcher);
  const openMeasurement = useAppStore((s) => s.openMeasurement);
  const openEditMeasurement = useAppStore((s) => s.openEditMeasurement);

  const recent = [...measurements].sort((a, b) => b.date - a.date);

  const body = (
    <>
      {/* latest value cards */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 11 }}>
        {MEAS_KINDS.map((kind) => {
          const meta = MEAS_META[kind];
          const latest = recent.find((m) => m.kind === kind);
          return (
            <Pressable
              key={kind}
              onPress={() => openMeasurement(kind)}
              accessibilityRole="button"
              style={(s) => [
                {
                  width: '47.8%',
                  flexGrow: 1,
                  backgroundColor: t.surface,
                  borderWidth: 1.5,
                  borderColor: t.line,
                  borderRadius: 20,
                  padding: 15,
                  minHeight: 96,
                  cursor: 'pointer',
                },
                isHovered(s) && { borderColor: hexA(meta.color, 0.5), boxShadow: t.shadow },
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 }}>
                <View style={{ width: 9, height: 9, borderRadius: 99, backgroundColor: meta.color }} />
                <Txt weight={600} size={11.5} color={t.dim} style={{ textTransform: 'uppercase' }}>
                  {meta.short}
                </Txt>
              </View>
              {latest ? (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                    <Txt weight={800} size={24} tracking={-0.4}>
                      {latest.value}
                    </Txt>
                    {meta.unit ? (
                      <Txt weight={600} size={13} color={t.dim} style={{ marginLeft: 3 }}>
                        {meta.unit}
                      </Txt>
                    ) : null}
                  </View>
                  <Txt weight={500} size={12} color={t.faint} style={{ marginTop: 2 }}>
                    {dateLabel(latest.date)}
                  </Txt>
                </>
              ) : (
                <Txt weight={600} size={13.5} color={meta.color} style={{ marginTop: 4 }}>
                  + Tap to add
                </Txt>
              )}
            </Pressable>
          );
        })}
      </View>

      {/* recent measurements */}
      <Txt weight={700} size={12.5} color={t.faint} tracking={0.8} style={{ marginHorizontal: 4, marginTop: 22, marginBottom: 9, textTransform: 'uppercase' }}>
        Recent
      </Txt>
      {recent.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24, gap: 12 }}>
          <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="chart" color={t.faint} size={34} />
          </View>
          <Txt weight={700} size={16}>
            No measurements yet
          </Txt>
          <Txt weight={500} size={14} color={t.dim} style={{ textAlign: 'center', maxWidth: 250, lineHeight: 20 }}>
            Tap a card above to record weight, height, head circumference or BMI.
          </Txt>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {recent.map((m) => {
            const meta = MEAS_META[m.kind];
            return (
              <Pressable
                key={m.id}
                onPress={() => openEditMeasurement(m.id)}
                accessibilityRole="button"
                style={(s) => [
                  {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingVertical: 13,
                    paddingHorizontal: 14,
                    backgroundColor: t.surface,
                    borderWidth: 1.5,
                    borderColor: t.line,
                    borderRadius: 18,
                    cursor: 'pointer',
                  },
                  isHovered(s) && { borderColor: hexA(meta.color, 0.5) },
                ]}
              >
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: hexA(meta.color, 0.16), alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="chart" color={meta.color} size={20} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt weight={700} size={15.5} tracking={-0.2}>
                    {meta.label}
                  </Txt>
                  <Txt weight={500} size={13} color={t.dim} style={{ marginTop: 1 }}>
                    {m.value}
                    {meta.unit ? ` ${meta.unit}` : ''}
                    {m.notes ? ` · ${m.notes}` : ''}
                  </Txt>
                </View>
                <Txt weight={600} size={13} color={t.faint} style={{ fontVariant: ['tabular-nums'] }}>
                  {dateLabel(m.date)}
                </Txt>
              </Pressable>
            );
          })}
        </View>
      )}
    </>
  );

  if (desktop) return <DesktopPage maxWidth={640}>{body}</DesktopPage>;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: 24 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2, paddingTop: 4, paddingBottom: 16 }}>
        <Txt weight={800} size={27} tracking={-0.6}>
          Growth
        </Txt>
        <Pressable
          onPress={openSwitcher}
          accessibilityRole="button"
          accessibilityLabel={child ? `${child.first}, switch child` : 'Switch child'}
        >
          <Avatar child={child} size={38} radius={12} fontSize={16} />
        </Pressable>
      </View>
      {body}
    </ScrollView>
  );
}
