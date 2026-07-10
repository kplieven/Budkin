import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { isHovered } from '@/components/hover';
import { IconButton } from '@/components/IconButton';
import { Txt } from '@/components/Txt';
import { changeSince, seriesFor, xTicksFor, yTicksFor } from '@/features/measurements/growthChart';
import { TrendChart } from '@/features/insights/TrendChart';
import { hexA } from '@/lib/color';
import { MEAS_KINDS, MEAS_META } from '@/lib/measurements';
import { fmtValue, toDisplay, unitLabel } from '@/lib/units';
import { DesktopPage } from '@/shell/DesktopPage';
import { useDesktopShell } from '@/shell/useDesktopShell';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';
import type { MeasurementKind } from '@/types/models';

const shortDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const rowDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const tipDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const GOOD = '#3E9E6E';

export default function MetricDetailRoute() {
  const { kind } = useLocalSearchParams<{ kind: string }>();
  if (!MEAS_KINDS.includes(kind as MeasurementKind)) return <Redirect href="/growth" />;
  return <MetricDetail kind={kind as MeasurementKind} />;
}

function MetricDetail({ kind }: { kind: MeasurementKind }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const desktop = useDesktopShell();
  const [width, setWidth] = useState(0);
  const measurements = useAppStore((s) => s.measurements);
  const unitSystem = useAppStore((s) => s.unitSystem);
  const child = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId));
  const openSwitcher = useAppStore((s) => s.openSwitcher);
  const openMeasurement = useAppStore((s) => s.openMeasurement);
  const openEditMeasurement = useAppStore((s) => s.openEditMeasurement);

  const meta = MEAS_META[kind];
  const unit = unitLabel(kind, unitSystem);
  // Stored values are canonical metric. Convert the whole series to the display
  // unit up front so the hero, delta chip, chart (line + y-axis labels + hover)
  // and ticks all agree. (These kinds are weight/height/head/bmi — no additive
  // offset — so a converted delta stays a true difference.)
  const rawPoints = seriesFor(measurements, kind);
  const points = rawPoints.map((p) => ({ ...p, value: toDisplay(kind, p.value, unitSystem) }));
  const latest = rawPoints.length ? rawPoints[rawPoints.length - 1] : null;
  const change = changeSince(points);
  const { ticks, fmtY } = yTicksFor(points);
  const chartW = width - 32; // card horizontal padding (16 * 2), matches the width prop below
  const maxXTicks = Math.max(2, Math.min(7, Math.floor((chartW - 36) / 56) + 1)); // ~56px per label; 36 = svg gutter+right
  const { ticks: xTicks, fmtX } = xTicksFor(points, maxXTicks);
  const history = measurements.filter((x) => x.kind === kind).sort((a, b) => b.date - a.date);

  const body = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: change ? 4 : 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexShrink: 1 }}>
          {latest ? (
            <>
              <Txt weight={800} size={34} tracking={-0.6}>{fmtValue(kind, latest.value, unitSystem)}</Txt>
              {unit ? <Txt weight={600} size={16} color={t.dim}>{unit}</Txt> : null}
            </>
          ) : (
            <Txt weight={700} size={20} color={t.dim}>No data yet</Txt>
          )}
        </View>
        <Pressable
          onPress={() => openMeasurement(kind)}
          accessibilityRole="button"
          accessibilityLabel={`Add ${meta.label.toLowerCase()}`}
          style={(s) => [
            { flexDirection: 'row', alignItems: 'center', height: 38, paddingHorizontal: 15, borderRadius: 13, backgroundColor: meta.color, boxShadow: `0px 5px 14px ${hexA(meta.color, 0.32)}`, cursor: 'pointer' },
            isHovered(s) && { boxShadow: `0px 5px 16px ${hexA(meta.color, 0.5)}` },
          ]}
        >
          <Txt unselectable weight={800} size={14.5} color={t.onActivity}>+ Add</Txt>
        </Pressable>
      </View>
      {change ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 16 }}>
          <View style={{ backgroundColor: change.delta >= 0 ? hexA(GOOD, 0.14) : t.chip, borderRadius: 9, paddingHorizontal: 8, paddingVertical: 2 }}>
            <Txt weight={700} size={12} color={change.delta >= 0 ? GOOD : t.faint}>
              {change.delta >= 0 ? '+' : ''}{Math.round(change.delta * 100) / 100}{unit ? ` ${unit}` : ''}
            </Txt>
          </View>
          <Txt weight={500} size={12.5} color={t.faint}>since {shortDate(change.sinceT)}</Txt>
        </View>
      ) : null}

      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, borderRadius: 20, padding: 16, marginBottom: 22 }}>
        {points.length >= 2 ? (
          <TrendChart
            points={points}
            band={null}
            color={meta.color}
            yTicks={ticks}
            fmtY={fmtY}
            width={width - 32}
            xMode="time"
            xStartLabel={shortDate(points[0].t)}
            xEndLabel={shortDate(points[points.length - 1].t)}
            xTicks={xTicks}
            fmtX={fmtX}
            dots="all"
            hover
            unit={unit}
            fmtHoverDate={tipDate}
          />
        ) : (
          <Txt weight={500} size={13.5} color={t.faint} style={{ paddingVertical: 20, textAlign: 'center' }}>
            {points.length === 1 ? 'Add another measurement to see a trend.' : 'No measurements yet.'}
          </Txt>
        )}
      </View>

      <Txt weight={700} size={12.5} color={t.faint} tracking={0.8} style={{ marginHorizontal: 4, marginBottom: 9, textTransform: 'uppercase' }}>
        History
      </Txt>
      {history.length === 0 ? (
        <Txt weight={500} size={14} color={t.dim} style={{ marginHorizontal: 4, marginBottom: 20 }}>Nothing logged yet.</Txt>
      ) : (
        <View style={{ gap: 8, marginBottom: 20 }}>
          {history.map((mm) => (
            <Pressable
              key={mm.id}
              onPress={() => openEditMeasurement(mm.id)}
              accessibilityRole="button"
              style={(s) => [
                { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14, backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, borderRadius: 18, cursor: 'pointer' },
                isHovered(s) && { borderColor: hexA(meta.color, 0.5) },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Txt weight={700} size={15.5} tracking={-0.2}>{fmtValue(kind, mm.value, unitSystem)}{unit ? ` ${unit}` : ''}</Txt>
                {mm.notes ? <Txt weight={500} size={13} color={t.dim} style={{ marginTop: 1 }}>{mm.notes}</Txt> : null}
              </View>
              <Txt weight={600} size={13} color={t.faint} style={{ fontVariant: ['tabular-nums'] }}>{rowDate(mm.date)}</Txt>
            </Pressable>
          ))}
        </View>
      )}
    </>
  );

  if (desktop) {
    return (
      <DesktopPage maxWidth={640}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <IconButton name="chevron-left" color={t.text} onPress={() => router.back()} accessibilityLabel="Back" />
          <Txt weight={800} size={24} tracking={-0.5}>{meta.label}</Txt>
        </View>
        {body}
      </DesktopPage>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: insets.bottom + 24 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, marginBottom: 14 }}>
        <IconButton name="chevron-left" color={t.text} onPress={() => router.back()} accessibilityLabel="Back" />
        <Txt weight={800} size={27} tracking={-0.6} style={{ flex: 1 }}>{meta.label}</Txt>
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
