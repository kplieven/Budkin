import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/BottomSheet';
import { Chip } from '@/components/Chip';
import { DateFields } from '@/components/DateFields';
import { noFocusRing } from '@/components/focusRing';
import { isHovered } from '@/components/hover';
import { IconButton } from '@/components/IconButton';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { fontFamily } from '@/theme/fonts';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';
import type { Treatment, TreatmentScheduleMode, TreatmentTimeOfDay } from '@/types/models';

const REMOVE_COLOR = '#E2725B'; // destructive accent, matches the child sheet

// Quick-pick dosage units, same set as the medication log form. `dosage_unit` is
// free text, so these are shortcuts; "+ Other" takes anything else. µg uses the
// real micro sign.
const MED_UNITS = ['mg', 'ml', 'µg', 'IU', 'drops', 'tablet', 'puff'];

const TIMES_OF_DAY: [TreatmentTimeOfDay, string][] = [
  ['morning', 'Morning'],
  ['noon', 'Noon'],
  ['evening', 'Evening'],
  ['night', 'Night'],
];

/** Local midnight epoch ms from raw D/M/Y text. Unlike `clampBirth` this does
 *  NOT cap at today: a treatment can start or end in the future. Out-of-range parts
 *  are clamped to a valid date. `new Date(y, m-1, d)` is local midnight. */
function toMidnightMs(dStr: string, mStr: string, yStr: string): number {
  const now = new Date();
  const y = Math.min(2999, Math.max(1900, parseInt(yStr, 10) || now.getFullYear()));
  const mo = Math.min(12, Math.max(1, parseInt(mStr, 10) || 1));
  const maxDay = new Date(y, mo, 0).getDate();
  const d = Math.min(maxDay, Math.max(1, parseInt(dStr, 10) || 1));
  return new Date(y, mo - 1, d).getTime();
}

/** Split an epoch ms into DD / MM / YYYY strings for the date fields. */
function toDMY(ms: number): { d: string; m: string; y: string } {
  const dt = new Date(ms);
  return { d: String(dt.getDate()), m: String(dt.getMonth() + 1), y: String(dt.getFullYear()) };
}

export function TreatmentEditor() {
  const editor = useAppStore((s) => s.treatmentEditor);
  if (!editor) return null;
  return <Inner key={editor.editingId ?? 'new'} editingId={editor.editingId} openedAt={editor.openedAt} />;
}

function Inner({ editingId, openedAt }: { editingId: string | null; openedAt: number }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const treatments = useAppStore((s) => s.treatments);
  const selectedChildId = useAppStore((s) => s.selectedChildId);
  const addTreatment = useAppStore((s) => s.addTreatment);
  const updateTreatment = useAppStore((s) => s.updateTreatment);
  const deleteTreatment = useAppStore((s) => s.deleteTreatment);
  const close = useAppStore((s) => s.closeTreatmentEditor);

  const editing: Treatment | null = editingId ? (treatments.find((c) => c.id === editingId) ?? null) : null;
  // The sheet's open instant, stamped by `openTreatmentEditor` (never
  // `Date.now()` here: render must stay pure, and Inner remounts per open via
  // its key, so the stamp is exactly "when this sheet appeared").
  const today = toDMY(openedAt);
  const fromInit = editing ? toDMY(editing.fromDate) : today;
  const toInit = editing?.toDate != null ? toDMY(editing.toDate) : today;

  const [name, setName] = useState(editing?.name ?? '');
  const [condition, setCondition] = useState(editing?.condition ?? '');
  const [scheduleMode, setScheduleMode] = useState<TreatmentScheduleMode>(editing?.scheduleMode ?? 'timesOfDay');
  const [times, setTimes] = useState<TreatmentTimeOfDay[]>(editing?.timesOfDay ?? ['morning']);
  const [everyHours, setEveryHours] = useState(String(editing?.everyHours ?? 6));
  const [dosage, setDosage] = useState(editing?.dosage != null ? String(editing.dosage) : '');
  const [dosageFocused, setDosageFocused] = useState(false);
  const isCustomUnit = !!editing?.dosageUnit && !MED_UNITS.includes(editing.dosageUnit);
  const [unit, setUnit] = useState<string | undefined>(editing?.dosageUnit);
  const [otherOpen, setOtherOpen] = useState(isCustomUnit);
  const [otherText, setOtherText] = useState(isCustomUnit ? (editing?.dosageUnit as string) : '');
  const [fromD, setFromD] = useState(fromInit.d);
  const [fromM, setFromM] = useState(fromInit.m);
  const [fromY, setFromY] = useState(fromInit.y);
  const [toEnabled, setToEnabled] = useState(editing?.toDate != null);
  const [toD, setToD] = useState(toInit.d);
  const [toM, setToM] = useState(toInit.m);
  const [toY, setToY] = useState(toInit.y);
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [active, setActive] = useState(editing?.active ?? true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const canSave = name.trim().length > 0;

  const toggleTime = (tod: TreatmentTimeOfDay) =>
    setTimes((prev) => (prev.includes(tod) ? prev.filter((x) => x !== tod) : [...prev, tod]));

  const pickUnit = (u: string) => {
    setUnit(unit === u ? undefined : u);
    setOtherOpen(false);
    setOtherText('');
  };

  const onSave = () => {
    if (!canSave) return;
    const parsedDose = parseFloat(dosage.replace(',', '.'));
    const parsedHours = Math.max(1, Math.round(parseInt(everyHours, 10) || 1));
    const treatment: Treatment = {
      id: editing?.id ?? 'treatment' + Date.now(),
      // Carry the backing note's server id through an edit. Dropping it would
      // make `updateTreatment` skip the PATCH and leave the treatment looking unsynced,
      // so `flushUnsynced` would POST a second note for the same treatment.
      serverId: editing?.serverId,
      childId: editing?.childId ?? selectedChildId,
      name: name.trim(),
      scheduleMode,
      timesOfDay: scheduleMode === 'timesOfDay' ? times : undefined,
      everyHours: scheduleMode === 'everyHours' ? parsedHours : undefined,
      dosage: Number.isFinite(parsedDose) ? parsedDose : undefined,
      dosageUnit: unit?.trim() || undefined,
      fromDate: toMidnightMs(fromD, fromM, fromY),
      toDate: toEnabled ? toMidnightMs(toD, toM, toY) : undefined,
      notes: notes.trim() || undefined,
      condition: condition.trim() || undefined,
      active,
    };
    if (editing) updateTreatment(treatment);
    else addTreatment(treatment);
    close();
  };

  const onDelete = () => {
    if (!editing) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    deleteTreatment(editing.id);
  };

  const inputStyle = {
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: t.surface,
    borderWidth: 1.5,
    borderColor: t.line,
    paddingHorizontal: 14,
    fontSize: 16,
    fontFamily: fontFamily(600),
    color: t.text,
    marginBottom: 16,
  } as const;

  const label = { marginBottom: 9 } as const;

  return (
    <BottomSheet onClose={close}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 14, flexShrink: 0 }}>
        <View style={{ flex: 1 }}>
          <Txt weight={800} size={20} tracking={-0.3}>
            {editing ? 'Edit treatment' : 'New treatment'}
          </Txt>
        </View>
        <IconButton name="close" onPress={close} size={20} accessibilityLabel="Close" />
      </View>

      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
        <Txt weight={700} size={13} color={t.dim} style={label}>
          Medication
        </Txt>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Paracetamol, vitamin D…"
          placeholderTextColor={t.faint}
          style={inputStyle}
        />

        <Txt weight={700} size={13} color={t.dim} style={label}>
          What it&apos;s for (optional)
        </Txt>
        <TextInput
          value={condition}
          onChangeText={setCondition}
          placeholder="e.g. fever, reflux…"
          placeholderTextColor={t.faint}
          style={inputStyle}
        />

        <Txt weight={700} size={13} color={t.dim} style={label}>
          Schedule
        </Txt>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          {([
            ['timesOfDay', 'Times of day'],
            ['everyHours', 'Every X hours'],
          ] as const).map(([mode, text]) => (
            <Pressable
              key={mode}
              onPress={() => setScheduleMode(mode)}
              accessibilityRole="button"
              accessibilityState={{ selected: scheduleMode === mode }}
              style={(s) => [
                {
                  flex: 1,
                  height: 44,
                  borderRadius: 13,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1.5,
                  borderColor: scheduleMode === mode ? t.primary : t.line,
                  backgroundColor: scheduleMode === mode ? hexA(t.primary, t.dark ? 0.16 : 0.1) : t.surface,
                  cursor: 'pointer',
                },
                isHovered(s) && scheduleMode !== mode && { borderColor: t.line2 },
              ]}
            >
              <Txt unselectable weight={700} size={14} color={scheduleMode === mode ? t.primary : t.text}>
                {text}
              </Txt>
            </Pressable>
          ))}
        </View>

        {scheduleMode === 'timesOfDay' ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {TIMES_OF_DAY.map(([tod, text]) => (
              <Chip
                key={tod}
                label={text}
                color={t.primary}
                selected={times.includes(tod)}
                onPress={() => toggleTime(tod)}
                padH={14}
                padV={9}
              />
            ))}
          </View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <TextInput
              value={everyHours}
              onChangeText={setEveryHours}
              keyboardType="number-pad"
              maxLength={3}
              placeholder="6"
              placeholderTextColor={t.faint}
              accessibilityLabel="Hours between doses"
              style={{ width: 90, height: 50, borderRadius: 14, backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, textAlign: 'center', fontSize: 19, fontFamily: fontFamily(800), color: t.text }}
            />
            <Txt weight={600} size={15} color={t.dim}>
              hours between doses
            </Txt>
          </View>
        )}

        <Txt weight={700} size={13} color={t.dim} style={label}>
          Dose per intake (optional)
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.surface, borderWidth: 1.5, borderColor: dosageFocused ? t.primary : t.line, borderRadius: 14, paddingHorizontal: 14, marginBottom: 12 }}>
          {/* flex:1/minWidth:0 wrapper so the input SHRINKS to fit the unit; a
              bare flex:1 TextInput keeps min-width:auto on web and pushes a long
              unit ("puffs", "drops") past the right edge. Matches LogSheet. */}
          <View style={{ flex: 1, minWidth: 0 }}>
            <TextInput
              value={dosage}
              onChangeText={setDosage}
              onFocus={() => setDosageFocused(true)}
              onBlur={() => setDosageFocused(false)}
              keyboardType="decimal-pad"
              placeholder="5"
              placeholderTextColor={t.faint}
              accessibilityLabel="Dose amount"
              style={{ width: '100%', height: 52, fontSize: 22, fontFamily: fontFamily(800), color: t.text, ...noFocusRing }}
            />
          </View>
          {unit ? (
            <Txt weight={600} size={15} color={t.dim} numberOfLines={1} style={{ flexShrink: 0 }}>
              {unit}
            </Txt>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: otherOpen ? 8 : 16 }}>
          {MED_UNITS.map((u) => (
            <Chip key={u} label={u} color={t.primary} selected={unit === u} onPress={() => pickUnit(u)} padH={13} padV={8} fontSize={13.5} />
          ))}
          {!otherOpen && (
            <Pressable
              onPress={() => setOtherOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Enter a custom unit"
              style={(s) => [
                { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, paddingVertical: 8, borderRadius: 13, borderWidth: 1.5, borderStyle: 'dashed', borderColor: t.line2, cursor: 'pointer' },
                isHovered(s) && { borderColor: t.faint },
              ]}
            >
              <Txt unselectable weight={700} size={13.5} color={t.faint}>
                + Other
              </Txt>
            </Pressable>
          )}
        </View>
        {otherOpen && (
          <TextInput
            autoFocus={!isCustomUnit}
            value={otherText}
            onChangeText={(v) => {
              setOtherText(v);
              setUnit(v.trim() ? v : undefined);
            }}
            placeholder="Custom unit, e.g. ml/kg…"
            placeholderTextColor={t.faint}
            style={{ ...inputStyle, minHeight: 44, fontSize: 14 }}
          />
        )}

        <Txt weight={700} size={13} color={t.dim} style={label}>
          From
        </Txt>
        <View style={{ marginBottom: 16 }}>
          <DateFields day={fromD} month={fromM} year={fromY} onDay={setFromD} onMonth={setFromM} onYear={setFromY} />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
          <Txt weight={700} size={13} color={t.dim}>
            Until (optional)
          </Txt>
          <Pressable
            onPress={() => setToEnabled((v) => !v)}
            accessibilityRole="switch"
            accessibilityLabel="Set an end date"
            accessibilityState={{ checked: toEnabled }}
            style={(s) => [{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, cursor: 'pointer' }, isHovered(s) && { backgroundColor: t.elevated }]}
          >
            <Txt unselectable weight={700} size={13.5} color={t.primary}>
              {toEnabled ? 'Remove end date' : 'Add end date'}
            </Txt>
          </Pressable>
        </View>
        {toEnabled && (
          <View style={{ marginBottom: 16 }}>
            <DateFields day={toD} month={toM} year={toY} onDay={setToD} onMonth={setToM} onYear={setToY} />
          </View>
        )}

        <Txt weight={700} size={13} color={t.dim} style={label}>
          Notes (optional)
        </Txt>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Anything worth remembering…"
          placeholderTextColor={t.faint}
          multiline
          style={{ ...inputStyle, minHeight: 72, paddingTop: 12, textAlignVertical: 'top' }}
        />

        <Txt weight={700} size={13} color={t.dim} style={label}>
          Status
        </Txt>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
          {([
            ['Active', true],
            ['Paused', false],
          ] as const).map(([text, value]) => (
            <Pressable
              key={text}
              onPress={() => setActive(value)}
              accessibilityRole="button"
              accessibilityState={{ selected: active === value }}
              style={(s) => [
                {
                  flex: 1,
                  height: 44,
                  borderRadius: 13,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1.5,
                  borderColor: active === value ? t.primary : t.line,
                  backgroundColor: active === value ? hexA(t.primary, t.dark ? 0.16 : 0.1) : t.surface,
                  cursor: 'pointer',
                },
                isHovered(s) && active !== value && { borderColor: t.line2 },
              ]}
            >
              <Txt unselectable weight={700} size={14} color={active === value ? t.primary : t.text}>
                {text}
              </Txt>
            </Pressable>
          ))}
        </View>
        <Txt weight={500} size={12} color={t.faint} style={{ marginBottom: 4 }}>
          A paused treatment is kept but drops out of the log picker.
        </Txt>

        {editing ? (
          <View style={{ marginTop: 22, paddingTop: 18, borderTopWidth: 1, borderTopColor: t.line }}>
            <Pressable
              onPress={onDelete}
              accessibilityRole="button"
              accessibilityLabel={confirmDelete ? `Confirm delete ${editing.name}` : `Delete ${editing.name}`}
              style={(st) => [
                {
                  height: 50,
                  borderRadius: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: hexA(REMOVE_COLOR, t.dark ? 0.16 : 0.12),
                  borderWidth: 1.5,
                  borderColor: hexA(REMOVE_COLOR, 0.9),
                  cursor: 'pointer',
                },
                isHovered(st) && { backgroundColor: hexA(REMOVE_COLOR, t.dark ? 0.24 : 0.18) },
              ]}
            >
              <Txt unselectable weight={800} size={15} color={REMOVE_COLOR}>
                {confirmDelete ? 'Tap again to delete' : 'Delete treatment'}
              </Txt>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 12, paddingBottom: insets.bottom + 8, borderTopWidth: 1, borderTopColor: t.line, flexShrink: 0 }}>
        <Pressable
          onPress={onSave}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSave }}
          style={(s) => [
            {
              flex: 1,
              height: 56,
              borderRadius: 18,
              backgroundColor: t.primary,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: canSave ? 1 : 0.5,
              cursor: canSave ? 'pointer' : 'auto',
            },
            canSave && isHovered(s) && { boxShadow: `0px 8px 22px ${hexA(t.primary, 0.5)}` },
          ]}
        >
          <Txt unselectable weight={800} size={17} color={t.onPrimary}>
            {editing ? 'Save changes' : 'Add treatment'}
          </Txt>
        </Pressable>
      </View>
    </BottomSheet>
  );
}
