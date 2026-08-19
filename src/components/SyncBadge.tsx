import { View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { useTheme } from '@/theme/useTheme';

/** Tiny per-timer sync indicator: a check when the timer's server mirror exists, a
 *  clock while it is still pending a push. Only meaningful in server mode, so
 *  callers gate it on the connection mode. */
export function SyncBadge({
  synced,
  inline,
}: {
  synced: boolean;
  /** Opt in when the badge sits in a horizontal row rather than stacked under a
   *  line of text: drops the top margin that would read as a stray gap mid-row. */
  inline?: boolean;
}) {
  const t = useTheme();
  const color = synced ? t.dim : t.primary;
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={synced ? 'Synced to server' : 'Pending sync to server'}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: inline ? 0 : 3 }}
    >
      <Icon name={synced ? 'check' : 'clock'} color={color} size={12} />
      <Txt weight={600} size={11.5} color={color}>
        {synced ? 'Synced' : 'Pending sync'}
      </Txt>
    </View>
  );
}
