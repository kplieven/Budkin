import { useState } from 'react';
import { View } from 'react-native';

import { Txt } from '@/components/Txt';
import { ageMonths } from '@/lib/format';
import { MILESTONES, aroundNow, groupByCategory, reachedByKey } from '@/lib/milestones';
import type { MilestoneDef } from '@/lib/milestones';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';
import type { MilestoneEntry } from '@/types/models';

import { MilestoneRow } from './MilestoneRow';
import { MilestoneSheet, type MilestoneTarget } from './MilestoneSheet';

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

  const [target, setTarget] = useState<MilestoneTarget | null>(null);
  const onLog = (def: MilestoneDef) => setTarget({ mode: 'log', def });
  const onEdit = (entry: MilestoneEntry) => setTarget({ mode: 'edit', entry });

  const reached = reachedByKey(entries);
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
        onPress={() => (hit ? onEdit(hit) : onLog(def))}
      />
    );
  };

  return (
    <>
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
      {target ? <MilestoneSheet target={target} onClose={() => setTarget(null)} /> : null}
    </>
  );
}
