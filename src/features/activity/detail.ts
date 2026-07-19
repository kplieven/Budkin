import { fmtDur } from '@/lib/format';
import { fmtValue, unitLabel } from '@/lib/units';
import { useAppStore } from '@/store/useAppStore';
import { type Entry } from '@/types/models';

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

/** One-line summary of an entry, by activity type. Shared by the History
 *  timeline and the desktop activity rail. */
/** `e.amount` is canonical ml; relabel + convert to the user's units lens.
 *  Read non-reactively from the store, as the temperature case below does. */
function fmtAmount(amount: number): string {
  const system = useAppStore.getState().unitSystem;
  return `${fmtValue('volume', amount, system)} ${unitLabel('volume', system)}`;
}

export function detailFor(e: Entry): string {
  switch (e.type) {
    case 'feeding':
      return [
        FEED_TYPE_LABEL[e.feedType] ?? '',
        FEED_METHOD_LABEL[e.method] ?? '',
        e.amount ? fmtAmount(e.amount) : '',
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
      return e.wash === 'big' ? 'Big wash' : 'Small wash';
    case 'temperature': {
      // `e.value` is canonical °C; relabel + convert to the user's units lens.
      // Read non-reactively from the store — the timeline re-renders often (the
      // per-second `now` tick, navigation) so a units toggle is reflected there.
      const system = useAppStore.getState().unitSystem;
      const base = `${fmtValue('temperature', e.value, system)} ${unitLabel('temperature', system)}`;
      return e.notes ? `${base} · ${e.notes}` : base;
    }
    case 'note':
      return e.text;
    case 'milestone':
      return e.text;
  }
}
