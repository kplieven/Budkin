import { View } from 'react-native';

import { Txt } from '@/components/Txt';
import { useTheme } from '@/theme/useTheme';

/**
 * Placeholder for the views that key off a child's age while that child is
 * still expected. One component so the three tabs cannot drift apart in copy.
 * `what` names the view, e.g. "Growth charts".
 */
export function WaitingForBirth({ what }: { what: string }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 56, paddingHorizontal: 24, gap: 10 }}>
      <Txt weight={700} size={18}>
        Nothing to show yet
      </Txt>
      <Txt weight={500} size={14} color={t.dim} style={{ textAlign: 'center', maxWidth: 260, lineHeight: 20 }}>
        {what} begin once your baby arrives.
      </Txt>
    </View>
  );
}
