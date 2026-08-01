import { feedAmountIsVolume, intakeLevelLabel } from '@/lib/activities';
import { fmtDur } from '@/lib/format';
import { fmtValue, unitLabel } from '@/lib/units';
import { useAppStore } from '@/store/useAppStore';
import { type Timer } from '@/types/models';
import { isTimer, type TimelineItem } from './groupByDay';

const FEED_TYPE_LABEL: Record<string, string> = {
  breast: 'Breast milk',
  formula: 'Formula',
  fortified: 'Fortified',
  solid: 'Solid food',
};
const FEED_METHOD_LABEL: Record<string, string> = {
  left: 'left breast',
  right: 'right breast',
  both: 'both',
  bottle: 'bottle',
  parent: 'parent fed',
  self: 'self fed',
};

/** A feeding volume in canonical ml, relabelled and converted to the user's
 *  units lens. Read non-reactively from the store, as the temperature case in
 *  `detailFor` does. Only ever called for amounts that really are volumes: see
 *  `feedAmountIsVolume`. */
function fmtAmount(amount: number): string {
  const system = useAppStore.getState().unitSystem;
  return `${fmtValue('volume', amount, system)} ${unitLabel('volume', system)}`;
}

/**
 * One-line summary of a running timer: the settings it is carrying, minus
 * anything that needs an end, because it has not got one yet. Reads as its
 * future entry would, so a timer row and the entry it becomes say the same
 * thing.
 *
 * Every field but `start` is optional on a `Timer` (they are only filled in
 * once the running timer is edited), so an unset one says nothing rather than
 * guessing. A timer that has never been edited simply has no detail line.
 */
function timerDetail(tm: Timer): string {
  const parts: string[] = [];
  switch (tm.saveAs) {
    case 'feeding':
      if (tm.feedType) parts.push(FEED_TYPE_LABEL[tm.feedType] ?? '');
      if (tm.method) parts.push(FEED_METHOD_LABEL[tm.method] ?? '');
      // Same dual-purpose `amount` as a feeding entry: millilitres from a
      // bottle, a dimensionless intake level at the breast.
      if (tm.amount)
        parts.push(feedAmountIsVolume(tm.feedType, tm.method) ? fmtAmount(tm.amount) : intakeLevelLabel(tm.amount));
      break;
    case 'sleep':
      if (tm.nap != null) parts.push(tm.nap ? 'Nap' : 'Night');
      // Matches the ongoing sleep entry wording in `detailFor`.
      parts.push('ongoing');
      break;
    case 'pumping':
      if (tm.amount) parts.push(fmtAmount(tm.amount));
      break;
    case 'tummy':
      if (tm.milestone) parts.push(tm.milestone);
      break;
  }
  if (tm.notes) parts.push(tm.notes);
  return parts.filter(Boolean).join(' · ');
}

/** One-line summary of a timeline item, by activity type. Shared by the History
 *  timeline and the desktop activity rail. */
export function detailFor(item: TimelineItem): string {
  // A running timer carries no end and only optional metadata, so it cannot go
  // through the entry switch. Splitting it off here rather than widening that
  // switch keeps it an exhaustive nine-case match over `Entry`, which is what
  // makes a newly added activity a compile error instead of a blank row.
  if (isTimer(item)) return timerDetail(item);
  const e = item;
  switch (e.type) {
    case 'feeding':
      return [
        FEED_TYPE_LABEL[e.feedType] ?? '',
        FEED_METHOD_LABEL[e.method] ?? '',
        // A breast feed's `amount` is a dimensionless intake level, not
        // millilitres, so it is shown as its word ("A little"). Formatting it as
        // a measurement would attach a false unit (a level 2 would read as
        // "0.1 fl oz").
        e.amount ? (feedAmountIsVolume(e.feedType, e.method) ? fmtAmount(e.amount) : intakeLevelLabel(e.amount)) : '',
        e.end ? fmtDur((e.end - e.start) / 60000) : '',
        e.notes ?? '',
      ]
        .filter(Boolean)
        .join(' · ');
    case 'sleep':
      return (
        (e.nap ? 'Nap' : 'Night') +
        (e.end ? ' · ' + fmtDur((e.end - e.start) / 60000) : ' · ongoing') +
        (e.notes ? ' · ' + e.notes : '')
      );
    case 'diaper': {
      const base = [e.wet ? 'Wet' : '', e.solid ? 'Solid' : '', e.color ?? ''].filter(Boolean).join(' · ') || 'Dry';
      return e.notes ? `${base} · ${e.notes}` : base;
    }
    case 'pumping':
      return [e.amount ? fmtAmount(e.amount) : '', e.end ? fmtDur((e.end - e.start) / 60000) : '', e.notes ?? '']
        .filter(Boolean)
        .join(' · ');
    case 'tummy':
      return [e.end ? fmtDur((e.end - e.start) / 60000) : '', e.milestone ?? '', e.notes ?? '']
        .filter(Boolean)
        .join(' · ');
    case 'bath':
      return e.wash === 'full' ? 'Full bath' : 'Quick wash';
    case 'temperature': {
      // `e.value` is canonical °C; relabel + convert to the user's units lens.
      // Read non-reactively from the store — the timeline re-renders often (the
      // per-second `now` tick, navigation) so a units toggle is reflected there.
      const system = useAppStore.getState().unitSystem;
      const base = `${fmtValue('temperature', e.value, system)} ${unitLabel('temperature', system)}`;
      return e.notes ? `${base} · ${e.notes}` : base;
    }
    case 'medication': {
      // name, then the amount + free-text unit (e.g. "Paracetamol · 5 mL"). The
      // unit is Baby Buddy's free-text `dosage_unit`, NOT a units.ts quantity, so
      // it is shown verbatim and never converted.
      const dose = e.dosage != null ? (e.dosageUnit ? `${e.dosage} ${e.dosageUnit}` : String(e.dosage)) : '';
      return [e.name, dose, e.notes ?? ''].filter(Boolean).join(' · ');
    }
    case 'note':
      return e.text;
    case 'milestone':
      return e.text;
  }
}
