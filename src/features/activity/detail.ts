import { fmtDur } from '@/lib/format';
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
export function detailFor(e: Entry): string {
  switch (e.type) {
    case 'feeding':
      return [
        FEED_TYPE_LABEL[e.feedType] ?? '',
        FEED_METHOD_LABEL[e.method] ?? '',
        e.amount ? `${e.amount}ml` : '',
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
      return [e.amount ? `${e.amount}ml` : '', e.end ? fmtDur((e.end - e.start) / 60000) : '', e.notes ?? '']
        .filter(Boolean)
        .join(' · ');
    case 'tummy':
      return [e.end ? fmtDur((e.end - e.start) / 60000) : '', e.milestone ?? '', e.notes ?? '']
        .filter(Boolean)
        .join(' · ');
    case 'bath':
      return e.wash === 'big' ? 'Big wash' : 'Small wash';
    case 'temperature': {
      const base = `${e.value} °C`;
      return e.notes ? `${base} · ${e.notes}` : base;
    }
  }
}
