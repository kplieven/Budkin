import { useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AmountScale } from '@/components/AmountScale';
import { BottomSheet } from '@/components/BottomSheet';
import { Chip } from '@/components/Chip';
import { DiaperAmountScale } from '@/components/DiaperAmountScale';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Stepper } from '@/components/Stepper';
import { Txt } from '@/components/Txt';
import { TimeEntry } from '@/features/log/TimeEntry';
import { ACTIVITY_LABEL, DURATION_SHORTCUTS } from '@/lib/activities';
import { hexA } from '@/lib/color';
import { fmtClock } from '@/lib/format';
import { fmtValue, toMetric, unitLabel } from '@/lib/units';
import { fontFamily } from '@/theme/fonts';
import { SOLID_COLORS } from '@/theme/tokens';
import { useAppStore, visibleTags } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';
import type { DiaperColor, FeedMethod, FeedType } from '@/types/models';

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
/**
 * Free-form tag creator: type a brand-new tag name and submit to add it as a
 * selected tag. No server call — Baby Buddy auto-creates the tag when the entry
 * is POSTed with the new name (createTag rejects blank / structural names). The
 * text state clears on submit; the component unmounts with the sheet, so it
 * re-seeds empty on every open.
 */
function TagCreator({ color, onCreate }: { color: string; onCreate: (name: string) => void }) {
  const t = useTheme();
  const [text, setText] = useState('');
  const submit = () => {
    if (!text.trim()) return;
    onCreate(text);
    setText('');
  };
  return (
    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
      <TextInput
        value={text}
        onChangeText={setText}
        onSubmitEditing={submit}
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
 * Decimal temperature reading. The Stepper is integer-only and AmountScale is
 * 1–10, so neither fits 37.4 — this is a free decimal TextInput (styled like
 * MeasurementSheet's value input). Local text state holds the raw string so a
 * trailing "." while typing "37." isn't dropped. The stored value (`te.temperature`)
 * is always canonical °C: the field shows it in the user's units lens and
 * converts the typed value back to °C before pushing it to the store. The block
 * is conditionally rendered, so it remounts (re-seeding from the store) on every
 * temperature sheet open.
 */
function TemperatureField({ value, onChange }: { value?: number; onChange: (v?: number) => void }) {
  const t = useTheme();
  const unitSystem = useAppStore((s) => s.unitSystem);
  const [text, setText] = useState(value != null ? fmtValue('temperature', value, unitSystem) : '');
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
          borderColor: t.line,
          borderRadius: 16,
          paddingHorizontal: 16,
          marginBottom: 16,
        }}
      >
        <TextInput
          value={text}
          onChangeText={(v) => {
            setText(v);
            const n = parseFloat(v.replace(',', '.'));
            onChange(Number.isNaN(n) ? undefined : toMetric('temperature', n, unitSystem));
          }}
          placeholder={unitSystem === 'imperial' ? '98.6' : '37.0'}
          placeholderTextColor={t.faint}
          keyboardType="decimal-pad"
          style={{ flex: 1, height: 60, fontSize: 30, fontFamily: fontFamily(800), color: t.text }}
        />
        <Txt weight={600} size={16} color={t.dim}>
          {unitLabel('temperature', unitSystem)}
        </Txt>
      </View>
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
  const childFirst = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId)?.first);
  const setTE = useAppStore((s) => s.setTE);
  const toggleWet = useAppStore((s) => s.toggleWet);
  const toggleSolid = useAppStore((s) => s.toggleSolid);
  const setWash = useAppStore((s) => s.setWash);
  const toggleTag = useAppStore((s) => s.toggleTag);
  const createTag = useAppStore((s) => s.createTag);
  const tags = useAppStore((s) => s.tags);
  const loadTags = useAppStore((s) => s.loadTags);
  const adjustAmount = useAppStore((s) => s.adjustAmount);
  const setEnded = useAppStore((s) => s.setEnded);
  const setOngoing = useAppStore((s) => s.setOngoing);
  const save = useAppStore((s) => s.save);
  const deleteEntry = useAppStore((s) => s.deleteEntry);
  const closeSheet = useAppStore((s) => s.closeSheet);

  // Lazy-load the server tag list on first sheet open (cached in the store;
  // subsequent opens no-op). Mirrors how Settings lazy-loads the profile.
  useEffect(() => {
    if (sheet) loadTags();
  }, [sheet, loadTags]);

  if (!sheet) return null;
  const type = sheet.type;
  const color = t.activity[type];
  const label = ACTIVITY_LABEL[type];
  const shortcut = DURATION_SHORTCUTS[type];
  const showVolume = type === 'feeding' && (te.feedType !== 'breast' || te.method === 'bottle');
  const showIntake = type === 'feeding' && te.feedType === 'breast' && te.method !== 'bottle';
  const showStartSide = type === 'feeding' && te.feedType === 'breast' && te.method === 'both';
  const saveLabel = editingId
    ? 'Save changes'
    : fromTimerId
      ? te.ongoing
        ? 'Save details'
        : te.endAbs != null
          ? `Stop & save · ended ${fmtClock(te.endAbs)}`
          : 'Stop & save'
      : te.ongoing && te.shape === 'interval'
        ? 'Start live timer'
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
          {childFirst ? (
            <Txt weight={500} size={13} color={t.dim}>
              for {childFirst}
            </Txt>
          ) : null}
        </View>
        <IconButton name="close" onPress={closeSheet} size={20} accessibilityLabel="Close" />
      </View>

      {/* scrollable body */}
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
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
                  <Stepper value={te.amount ?? 0} onMinus={() => adjustAmount(-10)} onPlus={() => adjustAmount(10)} />
                </View>
              </>
            )}
            {showIntake && (
              <>
                <FieldLabel>Intake — 1 to 10 (optional)</FieldLabel>
                <View style={{ marginBottom: 16 }}>
                  <AmountScale value={te.amount} color={color} onSelect={(n) => setTE({ amount: n })} />
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
                  <DiaperAmountScale value={te.amount} color={color} onSelect={(n) => setTE({ amount: n })} />
                </View>
              </>
            )}
          </>
        )}

        {/* bath fields — small vs big wash */}
        {type === 'bath' && (
          <>
            <FieldLabel hint="follows your rhythm">Wash</FieldLabel>
            <View style={{ flexDirection: 'row', gap: 9, marginBottom: 16 }}>
              {(['small', 'big'] as const).map((w) => {
                const selected = (te.wash ?? 'small') === w;
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
                      {w === 'small' ? 'Small wash' : 'Big wash'}
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
              <Stepper value={te.amount ?? 0} onMinus={() => adjustAmount(-10)} onPlus={() => adjustAmount(10)} />
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
          <TemperatureField value={te.temperature} onChange={(v) => setTE({ temperature: v })} />
        )}

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
              autoFocus
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
            activities; NOT for bath (structural note body) and NOT for a general
            note (its body IS its primary text — a note doesn't annotate itself). */}
        {type !== 'bath' && type !== 'note' && (
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
            ones (bath/small/big, breastfeeding left/right). Server colors render
            via the Chip swatch; a "New tag…" field adds a brand-new tag. */}
        <FieldLabel>Tags</FieldLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {visibleTags(tags, te.tags).map((tag) => (
            <Chip
              key={tag.name}
              label={tag.name}
              color={color}
              swatch={tag.color}
              selected={te.tags.includes(tag.name)}
              onPress={() => toggleTag(tag.name)}
              padH={13}
              padV={8}
              fontSize={13.5}
            />
          ))}
        </View>
        <TagCreator color={color} onCreate={createTag} />
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
