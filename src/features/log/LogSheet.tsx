import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AmountScale } from '@/components/AmountScale';
import { BottomSheet } from '@/components/BottomSheet';
import { Chip } from '@/components/Chip';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Stepper } from '@/components/Stepper';
import { Txt } from '@/components/Txt';
import { TimeEntry } from '@/features/log/TimeEntry';
import { ACTIVITY_LABEL, DURATION_SHORTCUTS } from '@/lib/activities';
import { hexA } from '@/lib/color';
import { fontFamily } from '@/theme/fonts';
import { SOLID_COLORS } from '@/theme/tokens';
import { useAppStore } from '@/store/useAppStore';
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
const TAGS = ['Left side', 'Cluster', 'Spit-up', 'Fussy', 'Sleepy'];

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
  const toggleTag = useAppStore((s) => s.toggleTag);
  const adjustAmount = useAppStore((s) => s.adjustAmount);
  const setEnded = useAppStore((s) => s.setEnded);
  const setOngoing = useAppStore((s) => s.setOngoing);
  const save = useAppStore((s) => s.save);
  const deleteEntry = useAppStore((s) => s.deleteEntry);
  const closeSheet = useAppStore((s) => s.closeSheet);

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
            <FieldLabel>Amount — 1 to 10 (optional)</FieldLabel>
            <View style={{ marginBottom: 16 }}>
              <AmountScale value={te.amount} color={color} onSelect={(n) => setTE({ amount: n })} />
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

        {/* time entry */}
        <TimeEntry type={type} color={color} />

        {/* tags */}
        <FieldLabel>Tags</FieldLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          {TAGS.map((tag) => (
            <Chip
              key={tag}
              label={tag}
              color={color}
              selected={te.tags.includes(tag)}
              onPress={() => toggleTag(tag)}
              padH={13}
              padV={8}
              fontSize={13.5}
            />
          ))}
        </View>
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
