import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { SetupButton } from '@/features/setup/SetupButton';
import { hexA } from '@/lib/color';
import { shadowStyle } from '@/theme/shadow';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

/**
 * First-run step 1: a short welcome, then the one question that forks setup.
 * "Yes" continues to the existing connect form. "Just this device" enters local
 * mode before navigating, so the add-baby step that follows has a live local
 * connection to persist into. The feature tour that used to live here moved to
 * /tour (Settings > Help).
 */
export default function Welcome() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const enterLocal = useAppStore((s) => s.enterLocal);
  const [entering, setEntering] = useState(false);

  // Guarded against a double tap: enterLocal does async storage work before the
  // navigation, and firing twice would push the baby step onto the stack twice.
  const goLocal = async () => {
    if (entering) return;
    setEntering(true);
    await enterLocal();
    router.push('/setup/baby');
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: insets.top + 32,
        paddingHorizontal: 24,
        paddingBottom: insets.bottom + 24,
      }}
    >
      <View
        style={[
          {
            width: 60,
            height: 60,
            borderRadius: 19,
            backgroundColor: t.primary,
            alignItems: 'center',
            justifyContent: 'center',
          },
          shadowStyle(`0px 8px 24px ${hexA(t.primary, 0.4)}`),
        ]}
      >
        <Icon name="heart" color={t.onPrimary} size={30} />
      </View>

      <Txt weight={800} size={28} tracking={-0.6} style={{ marginTop: 22, lineHeight: 34 }}>
        Welcome to Budkin
      </Txt>
      <Txt weight={500} size={15} color={t.dim} style={{ marginTop: 10, lineHeight: 22 }}>
        A calm, fast way to track your baby&apos;s day, from feeds and naps to the milestones in
        between.
      </Txt>

      <View style={{ flex: 1, minHeight: 32 }} />

      <Txt weight={700} size={18} tracking={-0.3} style={{ marginBottom: 8 }}>
        Do you have a Baby Buddy server?
      </Txt>
      <Txt weight={500} size={14} color={t.dim} style={{ marginBottom: 20, lineHeight: 21 }}>
        Baby Buddy is a tracker you host yourself. Connecting one syncs your data across devices.
        Without one, Budkin keeps everything on this device and you can connect later.
      </Txt>

      <SetupButton label="Yes, I have a server" onPress={() => router.push('/onboarding')} />
      <SetupButton
        label="Just use this device"
        variant="secondary"
        onPress={goLocal}
        disabled={entering}
        style={{ marginTop: 12 }}
      />
    </ScrollView>
  );
}
