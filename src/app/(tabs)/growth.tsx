import { router } from 'expo-router';
import { ScrollView, View,} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { isHovered } from '@/components/hover';
import { Tappable } from '@/components/press';
import { Txt } from '@/components/Txt';
import { WaitingForBirth } from '@/features/dashboard/WaitingForBirth';
import { MetricCard } from '@/features/measurements/MetricCard';
import { seriesFor } from '@/features/measurements/growthChart';
import { MEAS_KINDS } from '@/lib/measurements';
import { DesktopPage } from '@/shell/DesktopPage';
import { useDesktopShell } from '@/shell/useDesktopShell';
import { measurementsForChild } from '@/store/selectors';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

export default function Growth() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const desktop = useDesktopShell();
  const allMeasurements = useAppStore((s) => s.measurements);
  const child = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId));
  // `measurements` holds every child's, so scope to the selected one or a
  // sibling's weights get charted under this child.
  const measurements = measurementsForChild(allMeasurements, child?.id);
  const openSwitcher = useAppStore((s) => s.openSwitcher);
  const openMeasurement = useAppStore((s) => s.openMeasurement);

  // Swapped in as the body rather than early-returned above the wrappers, so the
  // waiting state keeps the header, safe-area padding and desktop max-width.
  const body = child?.expected ? (
    <WaitingForBirth what="Growth charts" />
  ) : (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 11 }}>
      {MEAS_KINDS.map((kind) => {
        const points = seriesFor(measurements, kind);
        return (
          <MetricCard
            key={kind}
            kind={kind}
            points={points}
            onPress={() =>
              points.length
                ? router.push({ pathname: '/metric/[kind]', params: { kind } })
                : openMeasurement(kind)
            }
          />
        );
      })}
    </View>
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
        <Tappable
          onPress={openSwitcher}
          accessibilityRole="button"
          accessibilityLabel={child ? `${child.first}, switch child` : 'Switch child'}
          style={(s) => [{ cursor: 'pointer' }, isHovered(s) && { opacity: 0.85 }]}
        >
          <Avatar child={child} size={38} radius={12} fontSize={16} />
        </Tappable>
      </View>
      {body}
    </ScrollView>
  );
}
