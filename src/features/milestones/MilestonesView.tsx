import { View } from 'react-native';

import { Txt } from '@/components/Txt';
import { ageMonths } from '@/lib/format';
import { MILESTONES, aroundNow, groupByCategory, reachedForChild } from '@/lib/milestones';
import type { MilestoneDef } from '@/lib/milestones';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

import { MilestoneRow } from './MilestoneRow';

function SectionLabel({ text }: { text: string }) {
  const t = useTheme();
  return (
    <Txt weight={700} size={12.5} color={t.faint} tracking={0.8} style={{ marginHorizontal: 4, marginBottom: 8, textTransform: 'uppercase' }}>
      {text}
    </Txt>
  );
}

export function MilestonesView() {
  const t = useTheme();
  // Select raw arrays and derive in render (never return a fresh ref from a selector).
  const entries = useAppStore((s) => s.entries);
  const now = useAppStore((s) => s.now);
  const child = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId));
  const openMilestone = useAppStore((s) => s.openMilestone);
  const openEditMilestone = useAppStore((s) => s.openEditMilestone);

  // Scope to the selected child so one child's logged milestones do not count as
  // reached for another (in local mode `entries` holds every child's history).
  const reached = reachedForChild(entries, child?.id);
  const months = child ? ageMonths(child.birth, now) : null;
  const upcoming = aroundNow(months, reached);
  const groups = groupByCategory(MILESTONES);

  if (!child) {
    return (
      <View style={{ alignItems: 'center', paddingVertical: 56, paddingHorizontal: 24, gap: 10 }}>
        <Txt weight={700} size={18}>
          No child selected
        </Txt>
        <Txt weight={500} size={14} color={t.dim} style={{ textAlign: 'center', maxWidth: 260, lineHeight: 20 }}>
          Pick a child to browse and log developmental milestones.
        </Txt>
      </View>
    );
  }

  const renderRow = (def: MilestoneDef) => {
    const hit = reached.get(def.key);
    return (
      <MilestoneRow
        key={def.key}
        def={def}
        reachedAt={hit ? hit.time : null}
        onPress={() => (hit ? openEditMilestone(hit.id) : openMilestone(def.key))}
      />
    );
  };

  return (
    <View style={{ gap: 18 }}>
      <Txt weight={600} size={14} color={t.dim} style={{ marginHorizontal: 4 }}>
        {reached.size} of {MILESTONES.length} reached
      </Txt>

      {upcoming.length > 0 ? (
        <View>
          <SectionLabel text="Around now" />
          <View style={{ gap: 9 }}>{upcoming.map(renderRow)}</View>
        </View>
      ) : null}

      {groups.map((g) => (
        <View key={g.category}>
          <SectionLabel text={g.category} />
          <View style={{ gap: 9 }}>{g.items.map(renderRow)}</View>
        </View>
      ))}
    </View>
  );
}
