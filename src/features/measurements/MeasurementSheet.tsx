import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/BottomSheet';
import { DayPicker } from '@/components/DayPicker';
import { noFocusRing } from '@/components/focusRing';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Tappable } from '@/components/press';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { MEAS_META, lowerLabel } from '@/lib/measurements';
import { fmtValue, resolveMetricInput, unitLabel } from '@/lib/units';
import { fontFamily } from '@/theme/fonts';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';
import type { MeasurementKind } from '@/types/models';

function midnight(offsetDays: number): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - offsetDays);
  return d.getTime();
}

const ONE_DAY = 86400000;

export function MeasurementSheet() {
  const sheet = useAppStore((s) => s.measurementSheet);
  const editingId = useAppStore((s) => s.editingMeasurementId);
  if (!sheet) return null;
  return <Inner key={`${sheet.kind}-${editingId ?? 'new'}`} kind={sheet.kind} editingId={editingId} />;
}

function Inner({ kind, editingId }: { kind: MeasurementKind; editingId: string | null }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const measurements = useAppStore((s) => s.measurements);
  const unitSystem = useAppStore((s) => s.unitSystem);
  const now = useAppStore((s) => s.now);
  const childFirst = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId)?.first);
  const saveMeasurement = useAppStore((s) => s.saveMeasurement);
  const deleteMeasurement = useAppStore((s) => s.deleteMeasurement);
  const close = useAppStore((s) => s.closeMeasurementSheet);

  const meta = MEAS_META[kind];
  const unit = unitLabel(kind, unitSystem);
  const editing = editingId ? measurements.find((m) => m.id === editingId) : null;
  // The stored value is canonical metric; show it in the user's chosen system and (in
  // onSave) convert what they type back to metric before persisting.
  const [value, setValue] = useState(editing ? fmtValue(kind, editing.value, unitSystem) : '');
  const [valueFocused, setValueFocused] = useState(false);
  const [dateMs, setDateMs] = useState(editing ? editing.date : midnight(0));
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [calendar, setCalendar] = useState(false);

  const today = midnight(0);
  const isToday = dateMs === today;
  const dateLabel =
    dateMs === today
      ? 'Today'
      : dateMs === midnight(1)
        ? 'Yesterday'
        : new Date(dateMs).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const stepDay = (delta: number) => setDateMs((d) => Math.min(today, d + delta * ONE_DAY));

  const onSave = () => {
    // Persist canonical metric regardless of the display system the user typed in. An
    // unchanged edit keeps the exact stored value (no rounded-display drift), and a
    // blank or invalid value cancels.
    const metric = resolveMetricInput(kind, value, unitSystem, editing?.value);
    if (metric == null) {
      close();
      return;
    }
    saveMeasurement(metric, dateMs, notes.trim() || undefined);
  };

  return (
    <BottomSheet onClose={close}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 14, flexShrink: 0 }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: hexA(meta.color, t.dark ? 0.2 : 0.16), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chart" color={meta.color} size={22} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt weight={800} size={20} tracking={-0.3}>
            {editingId ? 'Edit' : 'Log'} {lowerLabel(meta.label)}
          </Txt>
          {childFirst ? (
            <Txt weight={500} size={13} color={t.dim}>
              for {childFirst}
            </Txt>
          ) : null}
        </View>
        <IconButton name="close" onPress={close} size={20} accessibilityLabel="Close" />
      </View>

      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
        <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 9 }}>
          Value
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.surface, borderWidth: 1.5, borderColor: valueFocused ? meta.color : t.line, borderRadius: 16, paddingHorizontal: 16, marginBottom: 6 }}>
          <TextInput
            value={value}
            onChangeText={setValue}
            onFocus={() => setValueFocused(true)}
            onBlur={() => setValueFocused(false)}
            placeholder="0"
            placeholderTextColor={t.faint}
            keyboardType="decimal-pad"
            style={{ flex: 1, height: 60, fontSize: 30, fontFamily: fontFamily(800), color: t.text, ...noFocusRing }}
          />
          {unit ? (
            <Txt weight={600} size={16} color={t.dim}>
              {unit}
            </Txt>
          ) : null}
        </View>
        <Txt weight={500} size={12} color={t.faint} style={{ marginBottom: 16 }}>
          {kind === 'bmi'
            ? 'BMI is unitless.'
            : `Shown in ${unitSystem} units — change in Settings.`}
        </Txt>

        <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 9 }}>
          Date
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: isToday ? 16 : 8 }}>
          <Tappable
            onPress={() => stepDay(-1)}
            accessibilityRole="button"
            accessibilityLabel="Previous day"
            style={(s) => [
              { width: 48, height: 48, borderRadius: 14, backgroundColor: t.chip, borderWidth: 1.5, borderColor: t.line, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
              isHovered(s) && { backgroundColor: t.elevated },
            ]}
          >
            <Icon name="chevron-left" color={t.text} size={22} />
          </Tappable>
          <Tappable
            onPress={() => setCalendar((c) => !c)}
            accessibilityRole="button"
            accessibilityLabel={`${dateLabel}. Pick a date`}
            accessibilityState={{ expanded: calendar }}
            style={(s) => [
              { flex: 1, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: t.surface, borderWidth: 1.5, borderColor: calendar ? meta.color : t.line, borderRadius: 14, cursor: 'pointer' },
              !calendar && isHovered(s) && { borderColor: t.line2 },
            ]}
          >
            <Txt unselectable weight={700} size={15.5}>
              {dateLabel}
            </Txt>
            <Icon name={calendar ? 'chevron-up' : 'chevron-down'} color={t.dim} size={16} />
          </Tappable>
          <Tappable
            onPress={() => stepDay(1)}
            disabled={isToday}
            accessibilityRole="button"
            accessibilityLabel="Next day"
            accessibilityState={{ disabled: isToday }}
            style={(s) => [
              {
                width: 48,
                height: 48,
                borderRadius: 14,
                backgroundColor: t.chip,
                borderWidth: 1.5,
                borderColor: t.line,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: isToday ? 0.4 : 1,
                cursor: isToday ? 'auto' : 'pointer',
              },
              !isToday && isHovered(s) && { backgroundColor: t.elevated },
            ]}
          >
            <Icon name="chevron-right" color={t.text} size={22} />
          </Tappable>
        </View>

        {calendar && (
          <View style={{ marginBottom: 16, marginTop: -8, padding: 12, backgroundColor: t.bg, borderWidth: 1.5, borderColor: t.line, borderRadius: 16 }}>
            <DayPicker value={dateMs} now={now} color={meta.color} onChange={setDateMs} />
          </View>
        )}
        {!isToday && (
          <Tappable
            onPress={() => setDateMs(today)}
            accessibilityRole="button"
            style={(s) => [
              { alignSelf: 'center', marginBottom: 16, cursor: 'pointer' },
              isHovered(s) && { opacity: 0.75 },
            ]}
          >
            <Txt unselectable weight={600} size={13} color={meta.color}>
              Jump to today
            </Txt>
          </Tappable>
        )}

        <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 9 }}>
          Notes (optional)
        </Txt>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Add a note…"
          placeholderTextColor={t.faint}
          style={{ minHeight: 48, borderRadius: 14, backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, paddingHorizontal: 14, fontSize: 14.5, fontFamily: fontFamily(500), color: t.text, marginBottom: 8 }}
        />
      </ScrollView>

      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 12, paddingBottom: insets.bottom + 8, borderTopWidth: 1, borderTopColor: t.line, flexShrink: 0 }}>
        {editingId && (
          <Tappable
            onPress={() => deleteMeasurement(editingId)}
            accessibilityRole="button"
            style={(s) => [
              { height: 58, paddingHorizontal: 20, borderRadius: 18, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
              isHovered(s) && { backgroundColor: t.elevated },
            ]}
          >
            <Txt unselectable weight={800} size={16} color="#E2725B">
              Delete
            </Txt>
          </Tappable>
        )}
        <Tappable
          onPress={onSave}
          accessibilityRole="button"
          style={(s) => [
            { flex: 1, height: 58, borderRadius: 18, backgroundColor: meta.color, alignItems: 'center', justifyContent: 'center', boxShadow: `0px 8px 22px ${hexA(meta.color, 0.35)}`, cursor: 'pointer' },
            isHovered(s) && { boxShadow: `0px 8px 22px ${hexA(meta.color, 0.5)}` },
          ]}
        >
          <Txt unselectable weight={800} size={17.5} color={t.onActivity}>
            {editingId ? 'Save changes' : `Save ${lowerLabel(meta.short)}`}
          </Txt>
        </Tappable>
      </View>
    </BottomSheet>
  );
}
