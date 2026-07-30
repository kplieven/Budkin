import { router, usePathname, type Href } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { isHovered } from '@/components/hover';
import { Icon, type IconName } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { ageOrDueLabel } from '@/lib/format';
import { hexA } from '@/lib/color';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

interface NavItem {
  label: string;
  icon: IconName;
  href: Href;
  /** Whether the current pathname marks this item active. */
  match: (pathname: string) => boolean;
}

// Dashboard lives at the (tabs) group index, which resolves to "/".
const NAV: NavItem[] = [
  // Timers is not listed: it is a pushed detail screen, not a top-level
  // destination. The Dashboard's live-timer card and its "Timers" link open it,
  // and its own back chevron returns here.
  { label: 'Dashboard', icon: 'home', href: '/(tabs)', match: (p) => p === '/' },
  { label: 'History', icon: 'list', href: '/history', match: (p) => p.startsWith('/history') },
  { label: 'Insights', icon: 'insights', href: '/insights', match: (p) => p.startsWith('/insights') },
  { label: 'Growth', icon: 'chart', href: '/growth', match: (p) => p.startsWith('/growth') },
  { label: 'Milestones', icon: 'milestone', href: '/milestones', match: (p) => p.startsWith('/milestones') },
  { label: 'Notes', icon: 'note', href: '/notes', match: (p) => p.startsWith('/notes') },
  { label: 'Settings', icon: 'settings', href: '/settings', match: (p) => p.startsWith('/settings') },
];

/** Persistent left sidebar for the desktop shell (replaces the phone tab bar). */
export function Sidebar() {
  const t = useTheme();
  const pathname = usePathname();
  const child = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId));
  const now = useAppStore((s) => s.now);
  const openSwitcher = useAppStore((s) => s.openSwitcher);

  return (
    <View
      style={{
        width: 248,
        paddingTop: 26,
        paddingHorizontal: 18,
        paddingBottom: 22,
        borderRightWidth: 1,
        borderRightColor: t.line,
        backgroundColor: t.dark ? '#13100D' : '#FBF4EB',
      }}
    >
      {/* logo lockup */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 6, marginBottom: 26 }}>
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            backgroundColor: t.primary,
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: `0px 6px 18px ${hexA(t.primary, 0.4)}`,
          }}
        >
          <Icon name="budkin" color={t.onPrimary} size={22} />
        </View>
        <Txt weight={800} size={19} tracking={-0.4}>
          Budkin
        </Txt>
      </View>

      {/* nav */}
      <View style={{ gap: 4 }}>
        {NAV.map((item) => {
          const active = item.match(pathname);
          return (
            <Pressable
              key={item.label}
              onPress={() => router.navigate(item.href)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={item.label}
              style={(s) => [
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 11,
                  paddingHorizontal: 13,
                  borderRadius: 14,
                  borderWidth: 1.5,
                  borderColor: active ? hexA(t.primary, 0.32) : 'transparent',
                  backgroundColor: active ? hexA(t.primary, t.dark ? 0.14 : 0.1) : 'transparent',
                  cursor: 'pointer',
                },
                !active && isHovered(s) && { backgroundColor: t.dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.035)' },
              ]}
            >
              <Icon name={item.icon} color={active ? t.primary : t.faint} size={22} />
              <Txt weight={active ? 700 : 600} size={15} color={active ? t.text : t.dim}>
                {item.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>

      {/* spacer pushes the child card to the bottom */}
      <View style={{ flex: 1 }} />

      {/* child card */}
      <Pressable
        onPress={openSwitcher}
        accessibilityRole="button"
        accessibilityLabel={child ? `${child.first} ${child.last}, switch child` : 'Switch child'}
        style={(s) => [
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 11,
            padding: 11,
            borderRadius: 16,
            backgroundColor: t.surface,
            borderWidth: 1.5,
            borderColor: t.line,
            cursor: 'pointer',
          },
          isHovered(s) && { borderColor: t.line2 },
        ]}
      >
        <Avatar child={child} size={40} radius={13} fontSize={17} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt weight={700} size={14.5} numberOfLines={1}>
            {child ? `${child.first} ${child.last}` : 'No child'}
          </Txt>
          <Txt weight={500} size={12} color={t.dim} numberOfLines={1}>
            {child ? ageOrDueLabel(child.birth, !!child.expected, now) : ''}
          </Txt>
        </View>
        <Icon name="chevron-down" color={t.dim} size={18} />
      </Pressable>
    </View>
  );
}
