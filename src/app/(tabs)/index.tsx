import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Txt } from '@/components/Txt';
import { DashboardContent } from '@/features/dashboard/DashboardContent';
import { hexA } from '@/lib/color';
import { ageStr } from '@/lib/format';
import { showRail } from '@/shell/breakpoints';
import { TimelineRail } from '@/shell/TimelineRail';
import { useDesktopShell } from '@/shell/useDesktopShell';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

export default function Home() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const desktop = useDesktopShell();
  const { width } = useWindowDimensions();
  const now = useAppStore((s) => s.now);
  const offline = useAppStore((s) => s.offline);
  const queueCount = useAppStore((s) => s.queueCount);
  const child = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId));
  const openSwitcher = useAppStore((s) => s.openSwitcher);
  const refresh = useAppStore((s) => s.refresh);
  const showToast = useAppStore((s) => s.showToast);

  // Tap the offline banner to retry the connection now (works on web + native).
  const retry = useCallback(() => {
    showToast('Checking connection…');
    void refresh();
  }, [refresh, showToast]);

  // Pull-to-refresh: re-check the server and reload. Native only — on web
  // `RefreshControl` is an inert stub (no pull gesture in a browser), so the
  // drag does nothing; the web build reconnects automatically via the AppState
  // (visibilitychange) listener in _layout.tsx instead.
  const canPullToRefresh = Platform.OS !== 'web';
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refresh().finally(() => setRefreshing(false));
  }, [refresh]);

  // Desktop: the sidebar (child card) and top bar (title, offline pill) own the
  // chrome, so the main region scrolls just the dashboard body.
  if (desktop) {
    return (
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 6, paddingHorizontal: 32, paddingBottom: 32 }}>
          <DashboardContent layout="desktop" />
        </ScrollView>
        {showRail(width) && <TimelineRail />}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {offline && (
        <Pressable
          onPress={retry}
          accessibilityRole="button"
          accessibilityLabel="Retry connection"
          style={(pstate) => [
            {
              position: 'absolute',
              top: insets.top - 2,
              left: 12,
              right: 12,
              zIndex: 30,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 9,
              backgroundColor: t.dark ? '#3A2E18' : '#FBEFD4',
              borderWidth: 1,
              borderColor: hexA('#E2B554', 0.5),
              borderRadius: 13,
              paddingVertical: 9,
              paddingHorizontal: 13,
              boxShadow: t.shadow,
              cursor: 'pointer',
            },
            isHovered(pstate) && { borderColor: hexA('#E2B554', 0.9) },
            pstate.pressed && { opacity: 0.85 },
          ]}
        >
          <View style={{ width: 8, height: 8, borderRadius: 99, backgroundColor: '#E2B554' }} />
          <Txt weight={600} size={12.5} style={{ flex: 1 }}>
            {queueCount > 0
              ? `Offline — ${queueCount} ${queueCount === 1 ? 'entry' : 'entries'} queued, will sync when reconnected`
              : 'Offline — changes will sync when reconnected'}
          </Txt>
          <Txt weight={700} size={12.5} color="#E2B554">
            Retry
          </Txt>
        </Pressable>
      )}

      <ScrollView
        style={{ flex: 1 }}
        refreshControl={
          canPullToRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={t.dim}
              colors={['#E2B554']}
              progressViewOffset={insets.top + (offline ? 46 : 0)}
            />
          ) : undefined
        }
        contentContainerStyle={{
          paddingTop: insets.top + 8 + (offline ? 46 : 0),
          paddingHorizontal: 18,
          paddingBottom: 18,
        }}
      >
        {/* child header (phone only — the desktop sidebar carries the child card) */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 4, paddingTop: 6, paddingBottom: 18 }}>
          <Pressable onPress={openSwitcher}>
            <Avatar child={child} size={50} radius={16} fontSize={21} />
          </Pressable>
          <Pressable onPress={openSwitcher} style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <Txt weight={700} size={21} tracking={-0.3} numberOfLines={1} style={{ flexShrink: 1 }}>
                {child ? `${child.first} ${child.last}` : 'No child'}
              </Txt>
              <Icon name="chevron-down" color={t.text} size={18} />
            </View>
            <Txt weight={500} size={13.5} color={t.dim} style={{ marginTop: 1 }}>
              {child ? ageStr(child.birth, now) : ''}
            </Txt>
          </Pressable>
          <IconButton name="settings" onPress={() => router.push('/settings')} />
        </View>

        <DashboardContent layout="phone" />
      </ScrollView>
    </View>
  );
}
