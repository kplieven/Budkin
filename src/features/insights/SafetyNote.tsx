import { View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { useTheme } from '@/theme/useTheme';
import type { SafetyFlag } from './safety';

// Warm amber, NOT red: a hydration/intake nudge must read as gentle attention
// rather than an alarm. The theme has no warn/danger token, so it is defined
// locally; one value works in both themes on a tinted card.
const AMBER = '#C8944B';

function copyFor(flag: SafetyFlag): { title: string; body: string } {
  if (flag.kind === 'wetLow') {
    return {
      title: 'Fewer wet nappies than usual',
      body: `Wet nappies have been under the usual ${flag.floor} a day for ${flag.days} days running. Babies vary a lot, but if that keeps up it is worth a quick word with your doctor or health visitor.`,
    };
  }
  return {
    title: 'Fewer feeds than usual',
    body: `Feeds have been under ${flag.floor} a day for ${flag.days} days running. If that continues, it is worth mentioning to your doctor or health visitor.`,
  };
}

export function SafetyNote({ flags }: { flags: SafetyFlag[] }) {
  const t = useTheme();
  if (!flags.length) return null;
  return (
    <View style={{ gap: 10 }}>
      {flags.map((flag) => {
        const { title, body } = copyFor(flag);
        return (
          <View
            key={flag.kind}
            accessibilityRole="alert"
            style={{ flexDirection: 'row', gap: 12, backgroundColor: hexA(AMBER, t.dark ? 0.14 : 0.12), borderWidth: 1.4, borderColor: hexA(AMBER, 0.4), borderRadius: 18, padding: 15 }}
          >
            <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: hexA(AMBER, 0.22), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="info" size={17} color={AMBER} />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Txt weight={700} size={14}>{title}</Txt>
              <Txt weight={500} size={12.5} color={t.dim} style={{ lineHeight: 18 }}>{body}</Txt>
            </View>
          </View>
        );
      })}
    </View>
  );
}
