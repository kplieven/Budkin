import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Platform, RefreshControl, ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Tappable } from '@/components/press';
import { Txt } from '@/components/Txt';
import { groupByDay } from '@/features/activity/groupByDay';
import { useWebPullToRefresh } from '@/features/dashboard/useWebPullToRefresh';
import { hexA } from '@/lib/color';
import { fmtAgo, fmtClock } from '@/lib/format';
import { DesktopPage } from '@/shell/DesktopPage';
import { useDesktopShell } from '@/shell/useDesktopShell';
import { entriesForChild } from '@/store/selectors';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';
import { entryTimestamp, type NoteEntry } from '@/types/models';

function NoteRow({ note, now, onPress }: { note: NoteEntry; now: number; onPress: () => void }) {
  const t = useTheme();
  const color = t.activity.note;
  const ts = entryTimestamp(note);
  return (
    <Tappable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Edit note"
      style={(s) => [
        {
          gap: 10,
          paddingVertical: 14,
          paddingHorizontal: 15,
          backgroundColor: t.surface,
          borderWidth: 1.5,
          borderColor: t.line,
          borderRadius: 18,
          cursor: 'pointer',
        },
        isHovered(s) && { borderColor: hexA(color, 0.5) },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: hexA(color, 0.16), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="note" color={color} size={18} />
        </View>
        <View style={{ flex: 1 }} />
        <View style={{ alignItems: 'flex-end' }}>
          <Txt weight={600} size={13.5} style={{ fontVariant: ['tabular-nums'] }}>
            {fmtClock(ts)}
          </Txt>
          <Txt weight={500} size={11.5} color={t.faint} style={{ marginTop: 1 }}>
            {fmtAgo(ts, now)}
          </Txt>
        </View>
      </View>
      {note.text ? (
        <Txt weight={500} size={15} color={t.text} style={{ lineHeight: 21 }}>
          {note.text}
        </Txt>
      ) : null}
      {note.tags.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {note.tags.map((tag) => (
            <View key={tag} style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8, backgroundColor: t.chip }}>
              <Txt weight={600} size={11.5} color={t.dim}>
                {tag}
              </Txt>
            </View>
          ))}
        </View>
      ) : null}
    </Tappable>
  );
}

export default function Notes() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const desktop = useDesktopShell();
  // Raw `entries` (a stable reference), filtered in render: filtering *inside* the
  // selector returns a fresh array every call, which makes zustand v5's
  // useSyncExternalStore loop forever ("Maximum update depth exceeded").
  const entries = useAppStore((s) => s.entries);
  const selectedChildId = useAppStore((s) => s.selectedChildId);
  // Scoped to the selected child: `entries` holds every child's records, so
  // without this the previous child's notes stay on screen after a switch.
  // Notes are the one kind an expecting child can genuinely own.
  const notes = entriesForChild(entries, selectedChildId).filter((e): e is NoteEntry => e.type === 'note');
  const now = useAppStore((s) => s.now);
  const child = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId));
  const openSwitcher = useAppStore((s) => s.openSwitcher);
  const openSheet = useAppStore((s) => s.openSheet);
  const openEdit = useAppStore((s) => s.openEdit);
  const refresh = useAppStore((s) => s.refresh);

  // Native uses RefreshControl, touch-web a custom gesture, mouse-web nothing.
  const canPullToRefresh = Platform.OS !== 'web';
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refresh().finally(() => setRefreshing(false));
  }, [refresh]);
  const scrollRef = useRef<ScrollView | null>(null);
  const webPull = useWebPullToRefresh(scrollRef, refresh);

  const groups = groupByDay(notes, now);

  const addButton = (
    <Tappable
      onPress={() => openSheet('note')}
      accessibilityRole="button"
      accessibilityLabel="Add note"
      style={(s) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          height: 52,
          borderRadius: 16,
          backgroundColor: hexA(t.primary, t.dark ? 0.14 : 0.12),
          borderWidth: 1.5,
          borderColor: hexA(t.primary, 0.5),
          borderStyle: 'dashed',
          marginBottom: 14,
          cursor: 'pointer',
        },
        isHovered(s) && { borderColor: hexA(t.primary, 0.75) },
      ]}
    >
      <Icon name="plus" color={t.primary} size={20} />
      <Txt unselectable weight={700} size={15.5} color={t.primary}>
        Add note
      </Txt>
    </Tappable>
  );

  const body = (
    <>
      {addButton}
      {notes.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 56, paddingHorizontal: 24, gap: 14 }}>
          <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="note" color={t.faint} size={34} />
          </View>
          <Txt weight={700} size={18}>
            No notes yet
          </Txt>
          <Txt weight={500} size={14} color={t.dim} style={{ textAlign: 'center', maxWidth: 250, lineHeight: 20 }}>
            Jot down anything worth remembering — milestones, questions for the doctor, little moments.
          </Txt>
        </View>
      ) : (
        groups.map((g) => (
          <View key={g.label} style={{ marginBottom: 14 }}>
            <Txt weight={700} size={12.5} color={t.faint} tracking={0.8} style={{ marginHorizontal: 4, marginBottom: 8, textTransform: 'uppercase' }}>
              {g.label}
            </Txt>
            <View style={{ gap: 9 }}>
              {g.items.map((e) => {
                const note = e as NoteEntry;
                return <NoteRow key={note.id} note={note} now={now} onPress={() => openEdit(note.id)} />;
              })}
            </View>
          </View>
        ))
      )}
    </>
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
            Notes
          </Txt>
          <Tappable
            onPress={openSwitcher}
            accessibilityRole="button"
            accessibilityLabel={child ? `${child.first}, switch child` : 'Switch child'}
            style={(s) => [{ cursor: 'pointer' }, isHovered(s) && { opacity: 0.85 }]}
          >
            <Avatar child={child} size={38} radius={12} fontSize={16} />
          </Tappable>
        </View>
        {body}
      </ScrollView>
    </View>
  );
}
