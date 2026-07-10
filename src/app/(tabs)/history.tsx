import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { TimelineEntry } from '@/features/activity/TimelineEntry';
import { groupByDay } from '@/features/activity/groupByDay';
import { useWebPullToRefresh } from '@/features/dashboard/useWebPullToRefresh';
import { DesktopPage } from '@/shell/DesktopPage';
import { useDesktopShell } from '@/shell/useDesktopShell';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

export default function History() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const desktop = useDesktopShell();
  const entries = useAppStore((s) => s.entries);
  const now = useAppStore((s) => s.now);
  const child = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId));
  const openSwitcher = useAppStore((s) => s.openSwitcher);
  const openEdit = useAppStore((s) => s.openEdit);
  const refresh = useAppStore((s) => s.refresh);

  // Pull-to-refresh, mirroring Home: native uses RefreshControl, touch-web a
  // custom gesture, mouse-web nothing. History has no offline banner, so the
  // offsets are simply the safe-area inset.
  const canPullToRefresh = Platform.OS !== 'web';
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refresh().finally(() => setRefreshing(false));
  }, [refresh]);
  const scrollRef = useRef<ScrollView | null>(null);
  const webPull = useWebPullToRefresh(scrollRef, refresh);

  // General notes live in the shared `entries` array (for queue/undo/sync reuse)
  // but have their OWN dedicated tab — exclude them from the activity timeline.
  const activityEntries = entries.filter((e) => e.type !== 'note');
  const groups = groupByDay(activityEntries, now);

  const body =
    activityEntries.length === 0 ? (
      <View style={{ alignItems: 'center', paddingVertical: 64, paddingHorizontal: 24, gap: 14 }}>
        <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="list" color={t.faint} size={34} />
        </View>
        <Txt weight={700} size={18}>
          Nothing logged yet
        </Txt>
        <Txt weight={500} size={14} color={t.dim} style={{ textAlign: 'center', maxWidth: 240, lineHeight: 20 }}>
          Your timeline fills up as you log feedings, sleep and diapers. Tap a big button on Home to start.
        </Txt>
      </View>
    ) : (
      groups.map((g) => (
        <View key={g.label} style={{ marginBottom: 14 }}>
          <Txt weight={700} size={12.5} color={t.faint} tracking={0.8} style={{ marginHorizontal: 4, marginBottom: 6, textTransform: 'uppercase' }}>
            {g.label}
          </Txt>
          {/* A continuous timeline spine per day. Tap a row to open the
              editor, where entries can be edited or deleted. */}
          <View>
            {g.items.map((e, i) => (
              <TimelineEntry
                key={e.id}
                entry={e}
                now={now}
                onPress={() => openEdit(e.id)}
                isFirst={i === 0}
                isLast={i === g.items.length - 1}
              />
            ))}
          </View>
        </View>
      ))
    );

  if (desktop) return <DesktopPage maxWidth={600}>{body}</DesktopPage>;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {webPull.enabled && (
        <Animated.View
          pointerEvents="none"
          style={[
            { position: 'absolute', top: insets.top - 6, left: 0, right: 0, alignItems: 'center', zIndex: 25 },
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
        style={{ flex: 1, backgroundColor: t.bg }}
        refreshControl={
          canPullToRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={t.dim}
              colors={['#E2B554']}
              progressViewOffset={insets.top}
            />
          ) : undefined
        }
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: 24 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2, paddingTop: 4, paddingBottom: 16 }}>
          <Txt weight={800} size={27} tracking={-0.6}>
            History
          </Txt>
          <Pressable
            onPress={openSwitcher}
            accessibilityRole="button"
            accessibilityLabel={child ? `${child.first}, switch child` : 'Switch child'}
            style={(s) => [{ cursor: 'pointer' }, isHovered(s) && { opacity: 0.85 }]}
          >
            <Avatar child={child} size={38} radius={12} fontSize={16} />
          </Pressable>
        </View>
        {body}
      </ScrollView>
    </View>
  );
}
