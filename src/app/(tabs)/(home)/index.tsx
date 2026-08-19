import { Redirect, router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Txt } from '@/components/Txt';
import { DashboardContent } from '@/features/dashboard/DashboardContent';
import { useWebPullToRefresh } from '@/features/dashboard/useWebPullToRefresh';
import { QUEUE_ROUTE, offlineBannerA11yLabel, offlineBannerAction } from '@/features/queue/offlineBanner';
import { hexA } from '@/lib/color';
import { ageOrDueLabel } from '@/lib/format';
import { showRail } from '@/shell/breakpoints';
import { TimelineRail } from '@/shell/TimelineRail';
import { useDesktopShell } from '@/shell/useDesktopShell';
import { selectPendingCount, selectServerMode } from '@/store/selectors';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

export default function Home() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const desktop = useDesktopShell();
  const { width } = useWindowDimensions();
  const now = useAppStore((s) => s.now);
  const offline = useAppStore((s) => s.offline);
  const tutorialSeen = useAppStore((s) => s.tutorialSeen);
  const pending = useAppStore(selectPendingCount);
  const child = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId));
  const openSwitcher = useAppStore((s) => s.openSwitcher);
  const refresh = useAppStore((s) => s.refresh);
  const showToast = useAppStore((s) => s.showToast);
  // The shared predicate, so this and the desktop pill cannot answer differently.
  // It hands back a boolean and never a reshaped `connection`: a freshly built
  // reference here is the zustand v5 render loop.
  const serverMode = useAppStore(selectServerMode);

  // `atQueue` is false because this banner belongs to `/` and cannot be rendered
  // over its own destination; the desktop pill is the one that has to answer that.
  const bannerAction = offlineBannerAction({ serverMode, atQueue: false });
  const onBannerPress = useCallback(() => {
    if (bannerAction === 'open-queue') {
      router.navigate(QUEUE_ROUTE);
      return;
    }
    // Local mode, where the queue screen is deliberately unreachable, so there is
    // nowhere to send the user. `refresh` returns early for a non-server
    // connection, so the toast is the whole of it.
    showToast('Checking connection…');
    void refresh();
  }, [bannerAction, refresh, showToast]);

  // Native uses the platform RefreshControl. On web that control is an inert stub,
  // so touch-capable web gets a custom gesture instead; mouse-driven laptops get
  // neither, only the auto-refresh when the tab regains focus (`_layout.tsx`).
  const canPullToRefresh = Platform.OS !== 'web';
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refresh().finally(() => setRefreshing(false));
  }, [refresh]);
  const scrollRef = useRef<ScrollView | null>(null);
  const webPull = useWebPullToRefresh(scrollRef, refresh);

  // First-run gate. On web this Home route is what actually serves `/` (it shadows
  // app/index.tsx, which also resolves to `/`), so the redirect must live here too
  // or a fresh web visitor never lands on it. A no-op on native, where
  // app/index.tsx redirects before Home ever mounts. Placed after every hook above
  // so the rules of hooks hold on both branches.
  if (!tutorialSeen) return <Redirect href="/welcome" />;

  // Desktop: the sidebar and top bar own the chrome, so the main region scrolls
  // just the dashboard body.
  if (desktop) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: t.bg }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 6, paddingHorizontal: 32, paddingBottom: 32 }}>
          <DashboardContent layout="desktop" />
        </ScrollView>
        {/* Hidden while expecting: a "Recent activity" rail inviting the parent to
            log activity for an unborn baby is the same dead affordance that
            DashboardContent and Growth already suppress. Scoping entries by child
            leaves it correctly empty, but empty is not the same as absent. */}
        {showRail(width) && !child?.expected && <TimelineRail />}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {offline && (
        <Pressable
          onPress={onBannerPress}
          accessibilityRole="button"
          accessibilityLabel={offlineBannerA11yLabel(bannerAction)}
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
            {pending > 0
              ? `Offline — ${pending} pending, will sync when reconnected`
              : 'Offline — changes will sync when reconnected'}
          </Txt>
          {/* A chevron because the press opens the queue, where the retry button
              lives. Local mode says "Retry", because there the press opens
              nothing. */}
          {bannerAction === 'open-queue' ? (
            <Icon name="chevron-right" color="#E2B554" size={16} />
          ) : (
            <Txt weight={700} size={12.5} color="#E2B554">
              Retry
            </Txt>
          )}
        </Pressable>
      )}

      {webPull.enabled && (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: insets.top + (offline ? 46 : 0) - 6,
              left: 0,
              right: 0,
              alignItems: 'center',
              zIndex: 25,
            },
            webPull.style,
          ]}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 99,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: t.surface,
              borderWidth: 1,
              borderColor: t.line,
              boxShadow: t.shadow,
            }}
          >
            {webPull.refreshing ? (
              <ActivityIndicator color={t.dim} />
            ) : (
              <Animated.View style={webPull.glyphStyle}>
                <Icon name="chevron-down" color={t.dim} size={22} />
              </Animated.View>
            )}
          </View>
        </Animated.View>
      )}

      <ScrollView
        ref={scrollRef}
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
        {/* child header (phone only, the desktop sidebar carries the child card) */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 4, paddingTop: 6, paddingBottom: 18 }}>
          <Pressable
            onPress={openSwitcher}
            accessibilityRole="button"
            accessibilityLabel={child ? `${child.first}, switch child` : 'Switch child'}
            style={(s) => [{ cursor: 'pointer' }, isHovered(s) && { opacity: 0.85 }]}
          >
            <Avatar child={child} size={50} radius={16} fontSize={21} />
          </Pressable>
          <Pressable
            onPress={openSwitcher}
            accessibilityRole="button"
            style={(s) => [{ flex: 1, cursor: 'pointer' }, isHovered(s) && { opacity: 0.85 }]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <Txt weight={700} size={21} tracking={-0.3} numberOfLines={1} style={{ flexShrink: 1 }}>
                {child ? `${child.first} ${child.last}` : 'No child'}
              </Txt>
              <Icon name="chevron-down" color={t.text} size={18} />
            </View>
            <Txt weight={500} size={13.5} color={t.dim} style={{ marginTop: 1 }}>
              {child ? ageOrDueLabel(child.birth, !!child.expected, now) : ''}
            </Txt>
          </Pressable>
          <IconButton name="settings" onPress={() => router.push('/settings')} accessibilityLabel="Open settings" />
        </View>

        <DashboardContent layout="phone" />
      </ScrollView>
    </View>
  );
}
