import { Pressable, View } from 'react-native';

import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { ageMonths } from '@/lib/format';
import { overdueUnlogged, reachedForChild } from '@/lib/milestones';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

// Stable empty ref so the raw selector never feeds a fresh array into derive
// (zustand v5: returning a new ref from a selector loops the render).
const EMPTY: string[] = [];

/**
 * Home-screen catch-up nudge. For the selected child, surfaces one milestone at
 * a time whose typical window has passed and that is not yet logged or already
 * answered. Yes routes to the normal milestone sheet; any action retires the
 * prompt for good (persisted per child). Renders nothing when there is nothing
 * to ask.
 */
export function MilestoneNudge() {
  const t = useTheme();
  // Select raw, derive in render (never return a fresh ref from a selector).
  const entries = useAppStore((s) => s.entries);
  const now = useAppStore((s) => s.now);
  const child = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId));
  const answeredMap = useAppStore((s) => s.answeredMilestonePrompts);
  const openMilestone = useAppStore((s) => s.openMilestone);
  const answerMilestonePrompt = useAppStore((s) => s.answerMilestonePrompt);

  const answered = child ? (answeredMap[child.id] ?? EMPTY) : EMPTY;
  const reached = reachedForChild(entries, child?.id);
  const months = child ? ageMonths(child.birth, now) : null;
  const overdue = overdueUnlogged(months, reached, answered);

  if (!child || overdue.length === 0) return null;

  const def = overdue[0];
  const moreCount = overdue.length - 1;
  const color = t.activity.note; // milestone accent, matches MilestoneRow

  const onYes = () => {
    answerMilestonePrompt(def.key); // retire the prompt even if the sheet is cancelled
    openMilestone(def.key); // log via the normal flow (date + optional note)
  };
  const onNotYet = () => answerMilestonePrompt(def.key);

  return (
    <View
      style={{
        backgroundColor: t.surface,
        borderWidth: 1.5,
        borderColor: hexA(color, 0.4),
        borderRadius: 18,
        paddingTop: 13,
        paddingHorizontal: 15,
        paddingBottom: 14,
        marginBottom: 8,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 26, height: 26, borderRadius: 999, backgroundColor: hexA(color, 0.18), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="milestone" color={color} size={16} />
        </View>
        <Txt weight={700} size={11.5} color={t.dim} style={{ flex: 1, textTransform: 'uppercase' }} tracking={0.6}>
          Did they already?
        </Txt>
        <Pressable
          onPress={onNotYet}
          accessibilityRole="button"
          accessibilityLabel={`Dismiss ${def.title} prompt`}
          hitSlop={8}
          style={(state) => [{ cursor: 'pointer', padding: 2 }, isHovered(state) && { opacity: 0.7 }]}
        >
          <Icon name="close" color={t.faint} size={16} />
        </Pressable>
      </View>

      <Txt weight={700} size={16} color={t.text} style={{ marginTop: 9 }}>
        {def.title}
      </Txt>
      <Txt weight={500} size={13} color={t.dim} style={{ marginTop: 2, lineHeight: 18 }}>
        {`Most babies do this around ${def.minMonths} to ${def.maxMonths} months. Has ${child.first} done this yet?`}
      </Txt>

      <View style={{ flexDirection: 'row', gap: 9, marginTop: 12 }}>
        <Pressable
          onPress={onYes}
          accessibilityRole="button"
          accessibilityLabel={`Yes, ${child.first} has reached ${def.title}`}
          style={(state) => [
            {
              flex: 1,
              backgroundColor: color,
              borderRadius: 12,
              paddingVertical: 10,
              alignItems: 'center',
              cursor: 'pointer',
            },
            isHovered(state) && { opacity: 0.9 },
          ]}
        >
          <Txt unselectable weight={700} size={14} color={t.onActivity}>
            Yes, log it
          </Txt>
        </Pressable>
        <Pressable
          onPress={onNotYet}
          accessibilityRole="button"
          accessibilityLabel={`Not yet for ${def.title}`}
          style={(state) => [
            {
              flex: 1,
              backgroundColor: 'transparent',
              borderWidth: 1.5,
              borderColor: t.line,
              borderRadius: 12,
              paddingVertical: 10,
              alignItems: 'center',
              cursor: 'pointer',
            },
            isHovered(state) && { borderColor: t.line2 },
          ]}
        >
          <Txt unselectable weight={700} size={14} color={t.dim}>
            Not yet
          </Txt>
        </Pressable>
      </View>

      {moreCount > 0 ? (
        <Txt weight={500} size={12} color={t.faint} style={{ marginTop: 9, textAlign: 'center' }}>
          {`+${moreCount} more to check`}
        </Txt>
      ) : null}
    </View>
  );
}
