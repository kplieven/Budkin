import { router } from 'expo-router';
import { View } from 'react-native';

import { isHovered } from '@/components/hover';
import { Tappable } from '@/components/press';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { useTheme } from '@/theme/useTheme';

import { dismissUnitsNotice, useUnitsNotice } from './unitsNotice';

// The offline banner's warning tone, so the two read as the same kind of message.
const AMBER = '#E2B554';

/** Temporary and one-time: see unitsNotice.ts. */
export function UnitsNotice() {
  const t = useTheme();
  const visible = useUnitsNotice((s) => s.visible);
  if (!visible) return null;

  const button = (label: string, onPress: () => void, primary = false) => (
    <Tappable
      onPress={onPress}
      accessibilityRole="button"
      style={(s) => [
        {
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: 11,
          backgroundColor: primary ? AMBER : 'transparent',
          borderWidth: 1,
          borderColor: primary ? AMBER : hexA(AMBER, 0.6),
          cursor: 'pointer',
        },
        isHovered(s) && { opacity: 0.85 },
      ]}
    >
      <Txt weight={700} size={13} color={primary ? '#2A2110' : t.text}>
        {label}
      </Txt>
    </Tappable>
  );

  return (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor: t.dark ? '#3A2E18' : '#FBEFD4',
        borderWidth: 1,
        borderColor: hexA(AMBER, 0.5),
        borderRadius: 16,
        padding: 14,
        marginBottom: 16,
        gap: 6,
      }}
    >
      <Txt weight={700} size={14.5}>
        Units now match your Baby Buddy data
      </Txt>
      <Txt weight={500} size={13} color={t.dim}>
        Budkin no longer converts: numbers show exactly as they are stored, labeled in imperial. Anything
        logged in Budkin with imperial selected before this update was saved in metric. If most of your data
        is metric, switch to Metric in Settings.
      </Txt>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
        {button('Settings', () => {
          dismissUnitsNotice();
          router.push('/settings');
        })}
        {button('Got it', dismissUnitsNotice, true)}
      </View>
    </View>
  );
}
