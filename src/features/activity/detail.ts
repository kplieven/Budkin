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
      ]
        .filter(Boolean)
        .join(' · ');
    case 'sleep':
      return (e.nap ? 'Nap' : 'Night') + (e.end ? ' · ' + fmtDur((e.end - e.start) / 60000) : ' · ongoing');
    case 'diaper':
      return [e.wet ? 'Wet' : '', e.solid ? 'Solid' : '', e.color ?? ''].filter(Boolean).join(' · ') || 'Dry';
    case 'pumping':
      return [e.amount ? `${e.amount}ml` : '', e.end ? fmtDur((e.end - e.start) / 60000) : ''].filter(Boolean).join(' · ');
    case 'tummy':
      return [e.end ? fmtDur((e.end - e.start) / 60000) : '', e.milestone ?? ''].filter(Boolean).join(' · ');
  }
}
