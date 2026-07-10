import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/IconButton';
import { Txt } from '@/components/Txt';
import { MilestonesView } from '@/features/milestones/MilestonesView';
import { DesktopPage } from '@/shell/DesktopPage';
import { useDesktopShell } from '@/shell/useDesktopShell';
import { useTheme } from '@/theme/useTheme';

// Standalone Milestones screen. On desktop it is a dedicated sidebar destination
// (the sidebar has room); on phone the catalog lives inside the Growth tab's
// segment, so this route is reached only via a back-header fallback.
export default function Milestones() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const desktop = useDesktopShell();

  if (desktop) return <DesktopPage maxWidth={640}><MilestonesView /></DesktopPage>;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: insets.bottom + 24 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4, marginBottom: 14 }}>
        <IconButton name="chevron-left" color={t.text} onPress={() => router.back()} accessibilityLabel="Back" />
        <Txt weight={800} size={27} tracking={-0.6}>
          Milestones
        </Txt>
      </View>
      <MilestonesView />
    </ScrollView>
  );
}
