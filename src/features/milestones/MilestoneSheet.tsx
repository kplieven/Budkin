import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/BottomSheet';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { fontFamily } from '@/theme/fonts';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';
import { MILESTONE_BY_KEY } from '@/lib/milestones';
import type { MilestoneDef } from '@/lib/milestones';
import type { MilestoneEntry } from '@/types/models';

const ONE_DAY = 86400000;
function midnight(offsetDays: number): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - offsetDays);
  return d.getTime();
}

export type MilestoneTarget = { mode: 'log'; def: MilestoneDef } | { mode: 'edit'; entry: MilestoneEntry };

/**
 * Rendered once at the app root (like LogSheet/MeasurementSheet) so its overlay
 * anchors to the viewport, not the milestones page. Reads the open descriptor
 * from the store and resolves it to a concrete target: a catalog def to log, or
 * an existing entry to edit. Keyed so switching targets re-seeds the editor.
 */
export function MilestoneSheet() {
  const sheet = useAppStore((s) => s.milestoneSheet);
  const entries = useAppStore((s) => s.entries);
  const close = useAppStore((s) => s.closeMilestoneSheet);

  if (!sheet) return null;
  let target: MilestoneTarget | null = null;
  if (sheet.mode === 'log') {
    const def = MILESTONE_BY_KEY[sheet.key];
    if (def) target = { mode: 'log', def };
  } else {
    const entry = entries.find((e) => e.id === sheet.id);
    if (entry && entry.type === 'milestone') target = { mode: 'edit', entry };
  }
  if (!target) return null;

  const seedKey = sheet.mode === 'log' ? `log-${sheet.key}` : `edit-${sheet.id}`;
  return <Inner key={seedKey} target={target} onClose={close} />;
}

function Inner({ target, onClose }: { target: MilestoneTarget; onClose: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const color = t.activity.note;
  const childFirst = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId)?.first);
  const logMilestone = useAppStore((s) => s.logMilestone);
  const editMilestone = useAppStore((s) => s.editMilestone);
  const deleteEntry = useAppStore((s) => s.deleteEntry);

  const title = target.mode === 'log' ? target.def.title : target.entry.text;
  const editing = target.mode === 'edit';

  const [dateMs, setDateMs] = useState(target.mode === 'edit' ? target.entry.time : midnight(0));
  const [note, setNote] = useState(target.mode === 'edit' ? (target.entry.note ?? '') : '');

  const today = midnight(0);
  const isToday = dateMs >= today;
  const dateLabel =
    dateMs >= today
      ? 'Today'
      : dateMs === midnight(1)
        ? 'Yesterday'
        : new Date(dateMs).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const stepDay = (delta: number) => setDateMs((d) => Math.min(today, d + delta * ONE_DAY));

  const onSave = () => {
    if (target.mode === 'log') logMilestone(target.def.key, dateMs, note.trim() || undefined);
    else editMilestone(target.entry.id, dateMs, note.trim() || undefined);
    onClose();
  };
  const onRemove = () => {
    if (target.mode === 'edit') deleteEntry(target.entry.id);
    onClose();
  };

  return (
    <BottomSheet onClose={onClose}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 14, flexShrink: 0 }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: hexA(color, t.dark ? 0.2 : 0.16), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="milestone" color={color} size={22} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt weight={800} size={20} tracking={-0.3}>
            {title}
          </Txt>
          {childFirst ? (
            <Txt weight={500} size={13} color={t.dim}>
              {editing ? 'reached' : 'mark reached'} for {childFirst}
            </Txt>
          ) : null}
        </View>
        <IconButton name="close" onPress={onClose} size={20} accessibilityLabel="Close" />
      </View>

      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
        <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 9 }}>
          Date reached
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <Pressable
            onPress={() => stepDay(-1)}
            accessibilityRole="button"
            accessibilityLabel="Previous day"
            style={(s) => [
              { width: 48, height: 48, borderRadius: 14, backgroundColor: t.chip, borderWidth: 1.5, borderColor: t.line, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
              isHovered(s) && { backgroundColor: t.elevated },
            ]}
          >
            <Icon name="chevron-left" color={t.text} size={22} />
          </Pressable>
          <View style={{ flex: 1, height: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, borderRadius: 14 }}>
            <Txt weight={700} size={15.5}>
              {dateLabel}
            </Txt>
          </View>
          <Pressable
            onPress={() => stepDay(1)}
            disabled={isToday}
            accessibilityRole="button"
            accessibilityLabel="Next day"
            accessibilityState={{ disabled: isToday }}
            style={(s) => [
              { width: 48, height: 48, borderRadius: 14, backgroundColor: t.chip, borderWidth: 1.5, borderColor: t.line, alignItems: 'center', justifyContent: 'center', opacity: isToday ? 0.4 : 1, cursor: isToday ? 'auto' : 'pointer' },
              !isToday && isHovered(s) && { backgroundColor: t.elevated },
            ]}
          >
            <Icon name="chevron-right" color={t.text} size={22} />
          </Pressable>
        </View>

        <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 9 }}>
          Note (optional)
        </Txt>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Add a memory..."
          placeholderTextColor={t.faint}
          style={{ minHeight: 48, borderRadius: 14, backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, paddingHorizontal: 14, fontSize: 14.5, fontFamily: fontFamily(500), color: t.text, marginBottom: 8 }}
        />
      </ScrollView>

      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 12, paddingBottom: insets.bottom + 8, borderTopWidth: 1, borderTopColor: t.line, flexShrink: 0 }}>
        {editing && (
          <Pressable
            onPress={onRemove}
            accessibilityRole="button"
            style={(s) => [
              { height: 58, paddingHorizontal: 20, borderRadius: 18, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
              isHovered(s) && { backgroundColor: t.elevated },
            ]}
          >
            <Txt unselectable weight={800} size={16} color="#E2725B">
              Remove
            </Txt>
          </Pressable>
        )}
        <Pressable
          onPress={onSave}
          accessibilityRole="button"
          style={(s) => [
            { flex: 1, height: 58, borderRadius: 18, backgroundColor: color, alignItems: 'center', justifyContent: 'center', boxShadow: `0px 8px 22px ${hexA(color, 0.35)}`, cursor: 'pointer' },
            isHovered(s) && { boxShadow: `0px 8px 22px ${hexA(color, 0.5)}` },
          ]}
        >
          <Txt unselectable weight={800} size={17.5} color={t.onActivity}>
            {editing ? 'Save changes' : 'Mark reached'}
          </Txt>
        </Pressable>
      </View>
    </BottomSheet>
  );
}
