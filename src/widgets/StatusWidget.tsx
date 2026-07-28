'use no memo';

// Android home-screen widget UI (RemoteViews via react-native-android-widget).
// `use no memo` opts out of the React Compiler; `now` is passed in (not read in
// render) to keep the render pure.
//
// Layout: a header + a flex:1 status list (fills the upper area) + a 2x2 button
// grid pinned to the bottom, so it fills a portrait cell at any height.

import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget';

import { ageOrDueLabel, fmtAgoShort, fmtDur } from '@/lib/format';
import type { WidgetSnapshot } from '@/widgets/snapshot';
import { activitySvg } from '@/widgets/widgetIcons';

type Hex = `#${string}`;

const BG: Hex = '#16110E';
const SURFACE: Hex = '#2C231C';
const TEXT: Hex = '#F3EBE1';
const DIM: Hex = '#B4A492';
const FEED: Hex = '#F0A878';
const SLEEP: Hex = '#A99EDC';
const DIAPER: Hex = '#6FC0A6';
const PRIMARY: Hex = '#EC9A66';

function agoLabel(ms: number | null | undefined, now: number): string {
  if (ms == null) return '—';
  return `${fmtAgoShort(Math.max(0, Math.round((now - ms) / 60000)))} ago`;
}

function StatRow({ label, value, color }: { label: string; value: string; color: Hex }) {
  return (
    <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', alignItems: 'center', justifyContent: 'space-between' }}>
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
        <FlexWidget style={{ width: 9, height: 9, borderRadius: 8, backgroundColor: color, marginRight: 9 }} />
        <TextWidget text={label} style={{ fontSize: 14, color: TEXT }} />
      </FlexWidget>
      <TextWidget text={value} style={{ fontSize: 15, fontWeight: 'bold', color }} />
    </FlexWidget>
  );
}

function IconButton({ kind, label, color, uri }: { kind: 'feeding' | 'diaper' | 'sleep' | 'timer'; label: string; color: Hex; uri: string }) {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri }}
      style={{
        flex: 1,
        height: 60,
        margin: 4,
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: SURFACE,
        borderRadius: 16,
      }}
    >
      <SvgWidget svg={activitySvg(kind, color)} style={{ height: 28, width: 28 }} />
      <TextWidget text={label} style={{ fontSize: 12, fontWeight: 'bold', color: TEXT, marginTop: 3 }} />
    </FlexWidget>
  );
}

export function StatusWidget({ snapshot, now }: { snapshot: WidgetSnapshot | null; now: number }) {
  const s = snapshot;
  const nextSide = s?.nextSide === 'right' ? 'Right' : 'Left';
  const age = s?.birth != null ? ageOrDueLabel(s.birth, s.expected, now) : '';
  const napping = s?.sleepStart != null;
  const sleepValue = napping
    ? fmtDur((now - (s as WidgetSnapshot).sleepStart!) / 60000)
    : s && s.sleepTodayMin > 0
      ? `${fmtDur(s.sleepTodayMin)} today`
      : '—';
  const today = `Today · ${s?.feedsToday ?? 0} feeds · ${s?.diapersToday ?? 0} changes`;

  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{ height: 'match_parent', width: 'match_parent', flexDirection: 'column', backgroundColor: BG, borderRadius: 24, padding: 16 }}
    >
      <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', justifyContent: 'space-between', alignItems: 'center' }}>
        <FlexWidget style={{ flexDirection: 'column' }}>
          <TextWidget text={s?.childName || 'Budkin'} style={{ fontSize: 18, fontWeight: 'bold', color: TEXT }} />
          {age ? <TextWidget text={age} style={{ fontSize: 12, color: DIM }} /> : <FlexWidget style={{ height: 0 }} />}
        </FlexWidget>
        <TextWidget text={`start ${nextSide}`} style={{ fontSize: 14, fontWeight: 'bold', color: FEED }} />
      </FlexWidget>

      <FlexWidget style={{ flex: 1, flexDirection: 'column', width: 'match_parent', justifyContent: 'space-around', marginTop: 6, marginBottom: 6 }}>
        <StatRow label="Fed" value={agoLabel(s?.lastFeedStart, now)} color={FEED} />
        <StatRow label={napping ? 'Napping' : 'Sleep'} value={sleepValue} color={SLEEP} />
        <StatRow label="Diaper" value={agoLabel(s?.lastDiaper, now)} color={DIAPER} />
        <TextWidget text={today} style={{ fontSize: 12, color: DIM }} />
      </FlexWidget>

      <FlexWidget style={{ flexDirection: 'column', width: 'match_parent' }}>
        <FlexWidget style={{ flexDirection: 'row', width: 'match_parent' }}>
          <IconButton kind="feeding" label="Feed" color={FEED} uri="budkin://log/feeding" />
          <IconButton kind="diaper" label="Diaper" color={DIAPER} uri="budkin://log/diaper" />
        </FlexWidget>
        <FlexWidget style={{ flexDirection: 'row', width: 'match_parent' }}>
          <IconButton kind="sleep" label="Sleep" color={SLEEP} uri="budkin://log/sleep" />
          <IconButton kind="timer" label="Timer" color={PRIMARY} uri="budkin://timer" />
        </FlexWidget>
      </FlexWidget>
    </FlexWidget>
  );
}
