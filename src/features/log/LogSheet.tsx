import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/BottomSheet';
import { Chip } from '@/components/Chip';
import { noFocusRing } from '@/components/focusRing';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { LevelScale } from '@/components/LevelScale';
import { Stepper } from '@/components/Stepper';
import { Txt } from '@/components/Txt';
import { TimeEntry } from '@/features/log/TimeEntry';
import { ACTIVITY_LABEL, DIAPER_LEVELS, DURATION_SHORTCUTS, INTAKE_LEVELS, allowsMultipleChildren, feedAmountIsVolume } from '@/lib/activities';
import { hexA } from '@/lib/color';
import { fmtClock } from '@/lib/format';
import { eligibleTargetChildren, sheetTargetIds, targetChildrenLabel } from '@/lib/logTargets';
import { fmtValue, toMetric, unitLabel } from '@/lib/units';
import { fontFamily } from '@/theme/fonts';
import { SOLID_COLORS } from '@/theme/tokens';
import { useAppStore, visibleTags } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';
import type { DiaperColor, FeedMethod, FeedType, Tag } from '@/types/models';

const FEED_TYPES: [FeedType, string][] = [
  ['breast', 'Breast milk'],
  ['formula', 'Formula'],
  ['fortified', 'Fortified'],
  ['solid', 'Solid food'],
];
const FEED_METHODS: [FeedMethod, string][] = [
  ['left', 'Left'],
  ['right', 'Right'],
  ['both', 'Both'],
  ['bottle', 'Bottle'],
  ['parent', 'Parent fed'],
  ['self', 'Self fed'],
];
const COLORS: [DiaperColor, string][] = [
  ['black', SOLID_COLORS.black],
  ['brown', SOLID_COLORS.brown],
  ['green', SOLID_COLORS.green],
  ['yellow', SOLID_COLORS.yellow],
];
// Quick-pick dosage units. Baby Buddy's `dosage_unit` is free text, so these are
// just shortcuts; the "+ Other" field takes anything else. µg uses the real
// micro sign so it reads correctly rather than an ASCII "u".
const MED_UNITS = ['mg', 'ml', 'µg', 'IU', 'drops', 'tablet', 'puff'];
/**
 * Dashed "+ New tag" pill that sits at the end of the tag chip row. Tapping it
 * reveals TagInputRow below the chips. Styled lighter than a real Chip (dashed
 * border, faint text) so it never reads as a selectable / selected tag; its
 * dimensions mirror the tag chips (padH 13 / padV 8 / radius 13) so it lines up
 * in the wrap row.
 */
function AddTagPill({ onPress }: { onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Add a new tag"
      style={(s) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 13,
          paddingVertical: 8,
          borderRadius: 13,
          borderWidth: 1.5,
          borderStyle: 'dashed',
          borderColor: t.line2,
          cursor: 'pointer',
        },
        isHovered(s) && { borderColor: t.faint },
      ]}
    >
      <Txt unselectable weight={700} size={13.5} color={t.faint}>
        + New tag
      </Txt>
    </Pressable>
  );
}

/**
 * Free-form tag input, revealed by AddTagPill. Type a brand-new tag name and
 * submit to add it as a selected tag. No server call — Baby Buddy auto-creates
 * the tag when the entry is POSTed (createTag rejects blank / structural names).
 * Enter or "Add" commits and keeps the row open for fast multi-add; blurring
 * while empty (or Escape on web) collapses back to the pill via onDismiss. Local
 * text state re-seeds empty on every reveal since the row unmounts on collapse.
 *
 * blurOnSubmit={false} is load-bearing, not a nicety: without it react-native-web
 * blurs the input on Enter, which (with an empty field post-submit) would trip
 * the blur-when-empty collapse and defeat multi-add. It still fires
 * onSubmitEditing for this single-line input, so tags commit on Enter.
 */
function TagInputRow({
  color,
  onCreate,
  onDismiss,
}: {
  color: string;
  onCreate: (name: string) => void;
  onDismiss: () => void;
}) {
  const t = useTheme();
  const [text, setText] = useState('');
  const ref = useRef<TextInput>(null);
  const submit = () => {
    if (!text.trim()) return;
    onCreate(text);
    setText('');
    ref.current?.focus();
  };
  return (
    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
      <TextInput
        ref={ref}
        autoFocus
        value={text}
        onChangeText={setText}
        onSubmitEditing={submit}
        onBlur={() => {
          if (!text.trim()) onDismiss();
        }}
        onKeyPress={(e) => {
          if (e.nativeEvent.key === 'Escape') onDismiss();
        }}
        blurOnSubmit={false}
        placeholder="New tag…"
        placeholderTextColor={t.faint}
        returnKeyType="done"
        style={{
          flex: 1,
          minHeight: 44,
          borderRadius: 12,
          backgroundColor: t.surface,
          borderWidth: 1.5,
          borderColor: t.line,
          paddingHorizontal: 14,
          fontSize: 14,
          fontFamily: fontFamily(600),
          color: t.text,
        }}
      />
      <Pressable
        onPress={submit}
        accessibilityRole="button"
        accessibilityLabel="Add tag"
        style={(s) => [
          {
            paddingHorizontal: 16,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: t.chip,
            borderWidth: 1.5,
            borderColor: t.line,
            cursor: 'pointer',
          },
          isHovered(s) && { borderColor: t.line2 },
        ]}
      >
        <Txt unselectable weight={700} size={14} color={color}>
          Add
        </Txt>
      </Pressable>
    </View>
  );
}

/**
 * The "Tags" field: selectable chips for the server list ∪ the entry's own tags
 * (minus structural ones), plus an AddTagPill that expands into TagInputRow for
 * creating a brand-new tag. The editing flag lives here so the pill (in the chip
 * row) and the input (below it) can sit in different rows; it unmounts with the
 * sheet, so the field always re-opens collapsed.
 */
function TagField({
  color,
  tags,
  selected,
  onToggle,
  onCreate,
}: {
  color: string;
  tags: Tag[];
  selected: string[];
  onToggle: (name: string) => void;
  onCreate: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      <FieldLabel>Tags</FieldLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {visibleTags(tags, selected).map((tag) => (
          <Chip
            key={tag.name}
            label={tag.name}
            color={color}
            swatch={tag.color}
            selected={selected.includes(tag.name)}
            onPress={() => onToggle(tag.name)}
            padH={13}
            padV={8}
            fontSize={13.5}
          />
        ))}
        {!editing && <AddTagPill onPress={() => setEditing(true)} />}
      </View>
      {editing && <TagInputRow color={color} onCreate={onCreate} onDismiss={() => setEditing(false)} />}
    </>
  );
}

function FieldLabel({ children, hint }: { children: string; hint?: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 9 }}>
      <Txt weight={700} size={13} color={t.dim}>
        {children}
      </Txt>
      {hint ? (
        <Txt weight={600} size={12.5} color={t.primary}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

/**
 * Decimal temperature reading. The Stepper is integer-only and LevelScale has
 * three fixed steps, so neither fits 37.4. This is a free decimal TextInput
 * (styled like MeasurementSheet's value input). Local text state holds the raw string so a
 * trailing "." while typing "37." isn't dropped. The stored value (`te.temperature`)
 * is always canonical °C: the field shows it in the user's units lens and
 * converts the typed value back to °C before pushing it to the store. The block
 * is conditionally rendered, so it remounts (re-seeding from the store) on every
 * temperature sheet open.
 */
function TemperatureField({ value, color, onChange }: { value?: number; color: string; onChange: (v?: number) => void }) {
  const t = useTheme();
  const unitSystem = useAppStore((s) => s.unitSystem);
  const [text, setText] = useState(value != null ? fmtValue('temperature', value, unitSystem) : '');
  const [focused, setFocused] = useState(false);
  return (
    <>
      <FieldLabel>Temperature</FieldLabel>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          backgroundColor: t.surface,
          borderWidth: 1.5,
          borderColor: focused ? color : t.line,
          borderRadius: 16,
          paddingHorizontal: 16,
          marginBottom: 16,
        }}
      >
        <TextInput
          value={text}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChangeText={(v) => {
            setText(v);
            const n = parseFloat(v.replace(',', '.'));
            onChange(Number.isNaN(n) ? undefined : toMetric('temperature', n, unitSystem));
          }}
          placeholder={unitSystem === 'imperial' ? '98.6' : '37.0'}
          placeholderTextColor={t.faint}
          keyboardType="decimal-pad"
          style={{ flex: 1, height: 60, fontSize: 30, fontFamily: fontFamily(800), color: t.text, ...noFocusRing }}
        />
        <Txt weight={600} size={16} color={t.dim}>
          {unitLabel('temperature', unitSystem)}
        </Txt>
      </View>
    </>
  );
}

/**
 * Medication field block: a required name, an optional amount paired with a unit,
 * and a unit picker of quick-pick chips with a free-text "+ Other" fallback. The
 * unit is Baby Buddy's free-text `dosage_unit`, so it is stored as a plain string
 * and never routed through the units.ts converter. Conditionally rendered, so it
 * remounts (re-seeding its local text state from the store draft) on every open.
 */
function MedicationField({
  name,
  dosage,
  unit,
  color,
  onName,
  onDosage,
  onUnit,
}: {
  name?: string;
  dosage?: number;
  unit?: string;
  color: string;
  onName: (v: string) => void;
  onDosage: (v?: number) => void;
  onUnit: (v?: string) => void;
}) {
  const t = useTheme();
  // A stored unit that is not one of the presets is a custom one; open the free
  // text field on it so an edit doesn't silently drop it.
  const isCustom = !!unit && !MED_UNITS.includes(unit);
  const [amountText, setAmountText] = useState(dosage != null ? String(dosage) : '');
  const [amountFocused, setAmountFocused] = useState(false);
  const [otherOpen, setOtherOpen] = useState(isCustom);
  const [otherText, setOtherText] = useState(isCustom ? (unit as string) : '');
  const pickPreset = (u: string) => {
    onUnit(unit === u ? undefined : u);
    setOtherOpen(false);
    setOtherText('');
  };
  return (
    <>
      <FieldLabel>Medication</FieldLabel>
      <TextInput
        value={name ?? ''}
        onChangeText={onName}
        placeholder="e.g. Paracetamol, vitamin D…"
        placeholderTextColor={t.faint}
        style={{
          minHeight: 48,
          borderRadius: 14,
          backgroundColor: t.surface,
          borderWidth: 1.5,
          borderColor: t.line,
          paddingHorizontal: 14,
          fontSize: 15.5,
          fontFamily: fontFamily(600),
          color: t.text,
          marginBottom: 16,
        }}
      />
      <FieldLabel>Amount (optional)</FieldLabel>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          backgroundColor: t.surface,
          borderWidth: 1.5,
          borderColor: amountFocused ? color : t.line,
          borderRadius: 16,
          paddingHorizontal: 16,
          marginBottom: 12,
        }}
      >
        {/* The input is wrapped in a flex:1/minWidth:0 View so it SHRINKS to make
            room for the unit. A bare flex:1 TextInput keeps min-width:auto on web
            and won't shrink, pushing a long unit ("puffs", "drops") past the right
            edge. See src/components/DateFields.tsx for the same pattern. */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <TextInput
            value={amountText}
            onFocus={() => setAmountFocused(true)}
            onBlur={() => setAmountFocused(false)}
            onChangeText={(v) => {
              setAmountText(v);
              const n = parseFloat(v.replace(',', '.'));
              onDosage(Number.isNaN(n) ? undefined : n);
            }}
            placeholder="5"
            placeholderTextColor={t.faint}
            keyboardType="decimal-pad"
            style={{ width: '100%', height: 56, fontSize: 26, fontFamily: fontFamily(800), color: t.text, ...noFocusRing }}
          />
        </View>
        {unit ? (
          <Txt weight={600} size={16} color={t.dim} numberOfLines={1} style={{ flexShrink: 0 }}>
            {unit}
          </Txt>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: otherOpen ? 8 : 16 }}>
        {MED_UNITS.map((u) => (
          <Chip key={u} label={u} color={color} selected={unit === u} onPress={() => pickPreset(u)} padH={13} padV={8} fontSize={13.5} />
        ))}
        {!otherOpen && (
          <Pressable
            onPress={() => setOtherOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Enter a custom unit"
            style={(s) => [
              {
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 13,
                paddingVertical: 8,
                borderRadius: 13,
                borderWidth: 1.5,
                borderStyle: 'dashed',
                borderColor: t.line2,
                cursor: 'pointer',
              },
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
          autoFocus={!isCustom}
          value={otherText}
          onChangeText={(v) => {
            setOtherText(v);
            onUnit(v.trim() ? v : undefined);
          }}
          placeholder="Custom unit, e.g. ml/kg…"
          placeholderTextColor={t.faint}
          style={{
            minHeight: 44,
            borderRadius: 12,
            backgroundColor: t.surface,
            borderWidth: 1.5,
            borderColor: t.line,
            paddingHorizontal: 14,
            fontSize: 14,
            fontFamily: fontFamily(600),
            color: t.text,
            marginBottom: 16,
          }}
        />
      )}
    </>
  );
}

export function LogSheet() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const sheet = useAppStore((s) => s.sheet);
  const te = useAppStore((s) => s.te);
  const editingId = useAppStore((s) => s.editingId);
  const fromTimerId = useAppStore((s) => s.fromTimerId);
  // Raw selections, derived below in the render body: a selector that builds a
  // fresh array (a .filter or a .map) makes zustand v5 see a snapshot that never
  // settles, which blank-screens the web build.
  const children = useAppStore((s) => s.children);
  const sheetChildIds = useAppStore((s) => s.sheetChildIds);
  const selectedChildId = useAppStore((s) => s.selectedChildId);
  const setSheetChildren = useAppStore((s) => s.setSheetChildren);
  const toggleSheetChild = useAppStore((s) => s.toggleSheetChild);
  const setTE = useAppStore((s) => s.setTE);
  const toggleWet = useAppStore((s) => s.toggleWet);
  const toggleSolid = useAppStore((s) => s.toggleSolid);
  const setWash = useAppStore((s) => s.setWash);
  const setNap = useAppStore((s) => s.setNap);
  const toggleTag = useAppStore((s) => s.toggleTag);
  const createTag = useAppStore((s) => s.createTag);
  const tags = useAppStore((s) => s.tags);
  const loadTags = useAppStore((s) => s.loadTags);
  const adjustAmount = useAppStore((s) => s.adjustAmount);
  const unitSystem = useAppStore((s) => s.unitSystem);
  const setEnded = useAppStore((s) => s.setEnded);
  const setOngoing = useAppStore((s) => s.setOngoing);
  const save = useAppStore((s) => s.save);
  const deleteEntry = useAppStore((s) => s.deleteEntry);
  const closeSheet = useAppStore((s) => s.closeSheet);
  const expandMedicationLog = useAppStore((s) => s.expandMedicationLog);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Collapse the picker whenever the sheet changes. LogSheet itself never
  // unmounts (it renders null while closed), so unlike TagField's reveal this
  // state would otherwise survive from one open to the next. Adjusted DURING
  // render against the previous value rather than in an effect: React re-runs
  // this component before touching the DOM, so the picker is never painted
  // open, and an effect here would be a setState-in-effect anyway.
  const [pickerFor, setPickerFor] = useState(sheet);
  if (sheet !== pickerFor) {
    setPickerFor(sheet);
    setPickerOpen(false);
  }

  // Lazy-load the server tag list on first sheet open (cached in the store;
  // subsequent opens no-op). Mirrors how Settings lazy-loads the profile.
  useEffect(() => {
    if (sheet) loadTags();
  }, [sheet, loadTags]);

  if (!sheet) return null;
  const type = sheet.type;
  const color = t.activity[type];
  const label = ACTIVITY_LABEL[type];
  // Confirm mode: the medication sheet opened from a saved treatment. It shows a
  // read-only treatment summary + the time picker only; "Edit" expands it into
  // the full form. `sheet` is non-null here (guarded above).
  const confirmMode = type === 'medication' && !!sheet.confirm;
  const medDoseLabel = te.medDosage != null ? [String(te.medDosage), te.medUnit].filter(Boolean).join(' ') : '';
  const shortcut = DURATION_SHORTCUTS[type];
  // Exact complements by construction: a feeding shows the volume stepper or
  // the intake scale, never both, and never neither.
  const showVolume = type === 'feeding' && feedAmountIsVolume(te.feedType, te.method);
  const showIntake = type === 'feeding' && !feedAmountIsVolume(te.feedType, te.method);
  const showStartSide = type === 'feeding' && te.feedType === 'breast' && te.method === 'both';
  // Who this save is for. `sheetChildIds` is empty only for a sheet nothing
  // seeded, where the old rule (the global selection) still applies.
  const targetIds = sheetTargetIds(sheetChildIds, selectedChildId);
  const targetLabel = targetChildrenLabel(children, targetIds);
  // A single-child household gets the plain static line it always had: a dead
  // tap target for every solo-child user is worse than no affordance at all.
  const options = eligibleTargetChildren(children);
  const canRetarget = options.length > 1;
  // "Log for both" is create-only, and only for the routines siblings share.
  // Editing offers the picker as a plain single-select (re-aiming a record is
  // still useful), and a timer stop belongs to the one timer being stopped.
  const canLogForSeveral = canRetarget && !editingId && !fromTimerId && allowsMultipleChildren(type);
  // Marking a logged entry as still ongoing does not save changes to it, it
  // replaces it with a running timer, so the button must not promise an edit.
  // With several children targeted the button stops naming the activity and
  // says how many records the press writes, since that is the surprising part.
  // The header line above it already names them.
  const several = targetIds.length > 1;
  const saveLabel = editingId
    ? te.ongoing && te.shape === 'interval'
      ? 'Start live timer'
      : 'Save changes'
    : fromTimerId
      ? te.ongoing
        ? 'Save details'
        : te.endAbs != null
          ? `Stop & save · ended ${fmtClock(te.endAbs)}`
          : 'Stop & save'
      : te.ongoing && te.shape === 'interval'
        ? several
          ? 'Start live timers'
          : 'Start live timer'
        : several
          ? targetIds.length === 2
            ? 'Save for both'
            : `Save for all ${targetIds.length}`
          : `Save ${label.toLowerCase()}`;

  return (
    <BottomSheet onClose={closeSheet}>
      {/* header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 14, flexShrink: 0 }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: hexA(color, t.dark ? 0.18 : 0.16), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={type} color={color} size={24} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt weight={800} size={20} tracking={-0.3}>
            {editingId ? 'Edit' : 'Log'} {label.toLowerCase()}
          </Txt>
          {targetLabel && canRetarget ? (
            <Pressable
              onPress={() => setPickerOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: pickerOpen }}
              accessibilityLabel={`Logging for ${targetLabel}. Change who this is for`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', cursor: 'pointer' }}
            >
              <Txt unselectable weight={600} size={13} color={t.primary}>
                for {targetLabel}
              </Txt>
              <Icon name={pickerOpen ? 'chevron-down' : 'chevron-right'} color={t.primary} size={13} />
            </Pressable>
          ) : targetLabel ? (
            <Txt weight={500} size={13} color={t.dim}>
              for {targetLabel}
            </Txt>
          ) : null}
        </View>
        <IconButton name="close" onPress={closeSheet} size={20} accessibilityLabel="Close" />
      </View>

      {/* scrollable body */}
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
        {/* child picker, revealed by the header's "for X" line. It lives here
            rather than in the header so a long roster scrolls with the body
            instead of eating the sheet's fixed top. Picking does NOT move the
            global selection: after logging for a sibling the user stays on
            whoever they were on. */}
        {pickerOpen && canRetarget && (
          <>
            <FieldLabel hint={canLogForSeveral ? 'one entry each' : undefined}>Log for</FieldLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {options.map((c) => (
                <Chip
                  key={c.id}
                  label={c.first}
                  color={color}
                  swatch={c.color}
                  selected={targetIds.includes(c.id)}
                  onPress={() => {
                    // Multi-select stays open (the point is picking a second
                    // child); single-select collapses, since the choice is made.
                    if (canLogForSeveral) {
                      toggleSheetChild(c.id);
                      return;
                    }
                    setSheetChildren([c.id]);
                    setPickerOpen(false);
                  }}
                />
              ))}
            </View>
          </>
        )}

        {/* duration shortcuts (every interval activity): "log as just-ended" vs
            "start a live timer". Highlight tracks te.ongoing so the selected one
            is always the tinted one. */}
        {shortcut && (
          <View style={{ flexDirection: 'row', gap: 9, marginBottom: 8 }}>
            <Pressable
              onPress={() => setEnded(0)}
              accessibilityRole="button"
              accessibilityState={{ selected: !te.ongoing }}
              style={(s) => [
                {
                  flex: 1,
                  paddingVertical: 13,
                  paddingHorizontal: 14,
                  borderRadius: 16,
                  borderWidth: 1.5,
                  backgroundColor: !te.ongoing ? hexA(color, 0.14) : t.chip,
                  borderColor: !te.ongoing ? hexA(color, 0.4) : t.line,
                  cursor: 'pointer',
                },
                isHovered(s) && { borderColor: !te.ongoing ? hexA(color, 0.7) : t.line2 },
              ]}
            >
              <Txt unselectable weight={700} size={15}>
                {shortcut.doneTitle}
              </Txt>
              <Txt unselectable weight={500} size={12} color={t.dim} style={{ marginTop: 1 }}>
                {shortcut.doneSub}
              </Txt>
            </Pressable>
            <Pressable
              onPress={() => setOngoing()}
              accessibilityRole="button"
              accessibilityState={{ selected: !!te.ongoing }}
              style={(s) => [
                {
                  flex: 1,
                  paddingVertical: 13,
                  paddingHorizontal: 14,
                  borderRadius: 16,
                  borderWidth: 1.5,
                  backgroundColor: te.ongoing ? hexA(color, 0.14) : t.chip,
                  borderColor: te.ongoing ? hexA(color, 0.4) : t.line,
                  cursor: 'pointer',
                },
                isHovered(s) && { borderColor: te.ongoing ? hexA(color, 0.7) : t.line2 },
              ]}
            >
              <Txt unselectable weight={700} size={15}>
                {shortcut.liveTitle}
              </Txt>
              <Txt unselectable weight={500} size={12} color={t.dim} style={{ marginTop: 1 }}>
                {shortcut.liveSub}
              </Txt>
            </Pressable>
          </View>
        )}

        {/* feeding fields */}
        {type === 'feeding' && (
          <>
            <FieldLabel>Type</FieldLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {FEED_TYPES.map(([v, l]) => (
                <Chip key={v} label={l} color={color} selected={te.feedType === v} onPress={() => setTE({ feedType: v })} />
              ))}
            </View>
            <FieldLabel>Method</FieldLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {FEED_METHODS.map(([v, l]) => (
                <Chip key={v} label={l} color={color} selected={te.method === v} onPress={() => setTE({ method: v })} />
              ))}
            </View>
            {showStartSide && (
              <>
                <FieldLabel hint="auto-alternating">Started on</FieldLabel>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                  {(['left', 'right'] as const).map((side) => (
                    <Chip
                      key={side}
                      label={side === 'left' ? 'Left' : 'Right'}
                      color={color}
                      selected={te.startSide === side}
                      onPress={() => setTE({ startSide: side })}
                    />
                  ))}
                </View>
              </>
            )}
            {showVolume && (
              <>
                <FieldLabel>Amount (optional)</FieldLabel>
                <View style={{ marginBottom: 16 }}>
                  <Stepper
                    value={te.amount ?? 0}
                    system={unitSystem}
                    onMinus={() => adjustAmount(-1)}
                    onPlus={() => adjustAmount(1)}
                  />
                </View>
              </>
            )}
            {showIntake && (
              <>
                <FieldLabel>Intake (optional)</FieldLabel>
                <View style={{ marginBottom: 16 }}>
                  <LevelScale levels={INTAKE_LEVELS} value={te.amount} color={color} onSelect={(n) => setTE({ amount: n })} />
                </View>
              </>
            )}
          </>
        )}

        {/* diaper fields */}
        {type === 'diaper' && (
          <>
            <FieldLabel>Contents</FieldLabel>
            <View style={{ flexDirection: 'row', gap: 9, marginBottom: 16 }}>
              <Pressable
                onPress={toggleWet}
                accessibilityRole="button"
                accessibilityState={{ selected: te.wet }}
                style={(s) => [
                  { flex: 1, paddingVertical: 14, borderRadius: 16, alignItems: 'center', backgroundColor: te.wet ? hexA(color, 0.16) : t.chip, borderWidth: 2, borderColor: te.wet ? color : t.line, cursor: 'pointer' },
                  !te.wet && isHovered(s) && { borderColor: t.line2 },
                ]}
              >
                <Icon name="drop" color={te.wet ? color : t.dim} size={22} />
                <Txt unselectable weight={700} size={14.5} style={{ marginTop: 2 }}>
                  Wet
                </Txt>
              </Pressable>
              <Pressable
                onPress={toggleSolid}
                accessibilityRole="button"
                accessibilityState={{ selected: te.solid }}
                style={(s) => [
                  { flex: 1, paddingVertical: 14, borderRadius: 16, alignItems: 'center', backgroundColor: te.solid ? hexA(color, 0.16) : t.chip, borderWidth: 2, borderColor: te.solid ? color : t.line, cursor: 'pointer' },
                  !te.solid && isHovered(s) && { borderColor: t.line2 },
                ]}
              >
                <Icon name="solid" color={te.solid ? color : t.dim} size={22} />
                <Txt unselectable weight={700} size={14.5} style={{ marginTop: 2 }}>
                  Solid
                </Txt>
              </Pressable>
            </View>
            {te.solid && (
              <>
                <FieldLabel>Color</FieldLabel>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                  {COLORS.map(([v, swatch]) => (
                    <Chip
                      key={v}
                      label={v.charAt(0).toUpperCase() + v.slice(1)}
                      color={color}
                      swatch={swatch}
                      selected={te.color === v}
                      onPress={() => setTE({ color: v })}
                    />
                  ))}
                </View>
              </>
            )}
            {te.solid && (
              <>
                <FieldLabel>Amount (optional)</FieldLabel>
                <View style={{ marginBottom: 16 }}>
                  <LevelScale levels={DIAPER_LEVELS} value={te.amount} color={color} onSelect={(n) => setTE({ amount: n })} />
                </View>
              </>
            )}
          </>
        )}

        {/* sleep fields — nap vs night sleep */}
        {type === 'sleep' && (
          <>
            <FieldLabel hint="follows your rhythm">Kind</FieldLabel>
            <View style={{ flexDirection: 'row', gap: 9, marginBottom: 16 }}>
              {/* The sheet already seeded te.nap from the nap window on open,
                  and save() writes whatever te.nap holds, so flipping this
                  simply wins. No separate "user touched it" flag is needed. */}
              {([true, false] as const).map((isNap) => {
                const selected = (te.nap ?? true) === isNap;
                return (
                  <Pressable
                    key={String(isNap)}
                    onPress={() => setNap(isNap)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={(sh) => [
                      { flex: 1, paddingVertical: 14, borderRadius: 16, alignItems: 'center', backgroundColor: selected ? hexA(color, 0.16) : t.chip, borderWidth: 2, borderColor: selected ? color : t.line, cursor: 'pointer' },
                      !selected && isHovered(sh) && { borderColor: t.line2 },
                    ]}
                  >
                    <Txt unselectable weight={700} size={14.5}>
                      {isNap ? 'Nap' : 'Night sleep'}
                    </Txt>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        {/* bath fields, quick wash vs full bath */}
        {type === 'bath' && (
          <>
            <FieldLabel hint="follows your rhythm">Bath type</FieldLabel>
            <View style={{ flexDirection: 'row', gap: 9, marginBottom: 16 }}>
              {(['quick', 'full'] as const).map((w) => {
                const selected = (te.wash ?? 'quick') === w;
                return (
                  <Pressable
                    key={w}
                    onPress={() => setWash(w)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={(sh) => [
                      { flex: 1, paddingVertical: 14, borderRadius: 16, alignItems: 'center', backgroundColor: selected ? hexA(color, 0.16) : t.chip, borderWidth: 2, borderColor: selected ? color : t.line, cursor: 'pointer' },
                      !selected && isHovered(sh) && { borderColor: t.line2 },
                    ]}
                  >
                    <Txt unselectable weight={700} size={14.5}>
                      {w === 'quick' ? 'Quick wash' : 'Full bath'}
                    </Txt>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        {/* pumping fields */}
        {type === 'pumping' && (
          <>
            <FieldLabel>Amount</FieldLabel>
            <View style={{ marginBottom: 16 }}>
              <Stepper
                value={te.amount ?? 0}
                system={unitSystem}
                onMinus={() => adjustAmount(-1)}
                onPlus={() => adjustAmount(1)}
              />
            </View>
          </>
        )}

        {/* tummy fields */}
        {type === 'tummy' && (
          <>
            <FieldLabel>Milestone (optional)</FieldLabel>
            <TextInput
              value={te.milestone ?? ''}
              onChangeText={(v) => setTE({ milestone: v })}
              placeholder="e.g. lifted head, rolled over…"
              placeholderTextColor={t.faint}
              style={{
                minHeight: 48,
                borderRadius: 14,
                backgroundColor: t.surface,
                borderWidth: 1.5,
                borderColor: t.line,
                paddingHorizontal: 14,
                fontSize: 14.5,
                fontFamily: fontFamily(500),
                color: t.text,
                marginBottom: 16,
              }}
            />
          </>
        )}

        {/* temperature field — a decimal reading with a °C unit */}
        {type === 'temperature' && (
          <TemperatureField value={te.temperature} color={color} onChange={(v) => setTE({ temperature: v })} />
        )}

        {/* medication field: in confirm mode, a read-only treatment summary
            (name and, if present, dose) with notes and tags hidden below. In
            normal mode, the full editable field, with notes and tags shown
            as usual. */}
        {type === 'medication' &&
          (confirmMode ? (
            <>
              <FieldLabel>Treatment</FieldLabel>
              <View
                style={{
                  backgroundColor: t.surface,
                  borderWidth: 1.5,
                  borderColor: t.line,
                  borderRadius: 16,
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  marginBottom: 16,
                }}
              >
                <Txt weight={700} size={16.5}>
                  {te.medName}
                </Txt>
                {medDoseLabel ? (
                  <Txt weight={500} size={13.5} color={t.dim} style={{ marginTop: 2 }}>
                    {medDoseLabel}
                  </Txt>
                ) : null}
              </View>
            </>
          ) : (
            <MedicationField
              name={te.medName}
              dosage={te.medDosage}
              unit={te.medUnit}
              color={color}
              onName={(v) => setTE({ medName: v })}
              onDosage={(v) => setTE({ medDosage: v })}
              onUnit={(v) => setTE({ medUnit: v })}
            />
          ))}

        {/* note field — the PRIMARY multiline body (taller than the secondary
            per-entry notes input, which is suppressed for a note below) */}
        {type === 'note' && (
          <>
            <FieldLabel>Note</FieldLabel>
            <TextInput
              value={te.noteText ?? ''}
              onChangeText={(v) => setTE({ noteText: v })}
              placeholder="Write a note…"
              placeholderTextColor={t.faint}
              multiline
              style={{
                minHeight: 132,
                borderRadius: 14,
                backgroundColor: t.surface,
                borderWidth: 1.5,
                borderColor: t.line,
                paddingHorizontal: 14,
                paddingTop: 12,
                paddingBottom: 12,
                textAlignVertical: 'top',
                fontSize: 15.5,
                fontFamily: fontFamily(500),
                color: t.text,
                marginBottom: 16,
              }}
            />
          </>
        )}

        {/* time entry */}
        <TimeEntry key={type} type={type} color={color} />

        {/* notes — the secondary per-entry annotation. Shown for the 5 real
            activities; NOT for bath (structural note body), NOT for a general
            note (its body IS its primary text), and NOT for medication in
            confirm mode (read-only summary only). */}
        {type !== 'bath' && type !== 'note' && !confirmMode && (
          <>
            <FieldLabel>Notes (optional)</FieldLabel>
            <TextInput
              value={te.notes ?? ''}
              onChangeText={(v) => setTE({ notes: v })}
              placeholder="Anything worth remembering…"
              placeholderTextColor={t.faint}
              multiline
              style={{
                minHeight: 72,
                borderRadius: 14,
                backgroundColor: t.surface,
                borderWidth: 1.5,
                borderColor: t.line,
                paddingHorizontal: 14,
                paddingTop: 12,
                paddingBottom: 12,
                textAlignVertical: 'top',
                fontSize: 14.5,
                fontFamily: fontFamily(500),
                color: t.text,
                marginBottom: 16,
              }}
            />
          </>
        )}

        {/* tags — the server list ∪ the entry's own tags, minus the structural
            ones (bath/bath:quick/bath:full and the legacy bare small/big,
            breastfeeding left/right). Server colors render via the Chip
            swatch; a "New tag…" field adds a brand-new tag. */}
        {!confirmMode && (
          <TagField color={color} tags={tags} selected={te.tags} onToggle={toggleTag} onCreate={createTag} />
        )}
      </ScrollView>

      {/* save bar */}
      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 12, paddingBottom: insets.bottom + 8, borderTopWidth: 1, borderTopColor: t.line, flexShrink: 0 }}>
        {editingId && (
          <Pressable
            onPress={() => deleteEntry(editingId)}
            accessibilityRole="button"
            style={(s) => [
              { height: 58, paddingHorizontal: 20, borderRadius: 18, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
              isHovered(s) && { backgroundColor: t.elevated },
            ]}
          >
            <Txt unselectable weight={800} size={16} color="#E2725B">
              Delete
            </Txt>
          </Pressable>
        )}
        {confirmMode && (
          <Pressable
            onPress={expandMedicationLog}
            accessibilityRole="button"
            accessibilityLabel="Edit the dose details"
            style={(s) => [
              { height: 58, paddingHorizontal: 20, borderRadius: 18, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
              isHovered(s) && { backgroundColor: t.elevated },
            ]}
          >
            <Txt unselectable weight={800} size={16} color={t.text}>
              Edit
            </Txt>
          </Pressable>
        )}
        <Pressable
          onPress={save}
          accessibilityRole="button"
          style={(s) => [
            { flex: 1, height: 58, borderRadius: 18, backgroundColor: color, alignItems: 'center', justifyContent: 'center', boxShadow: `0px 8px 22px ${hexA(color, 0.35)}`, cursor: 'pointer' },
            isHovered(s) && { boxShadow: `0px 8px 22px ${hexA(color, 0.5)}` },
          ]}
        >
          <Txt unselectable weight={800} size={17.5} color={t.onActivity}>
            {saveLabel}
          </Txt>
        </Pressable>
      </View>
    </BottomSheet>
  );
}
