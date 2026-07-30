import { router, usePathname } from 'expo-router';
import { Pressable, View } from 'react-native';

import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import {
  QUEUE_ROUTE,
  isQueueRoute,
  offlineBannerA11yLabel,
  offlineBannerAction,
} from '@/features/queue/offlineBanner';
import { greetingFor, screenTitleFor } from '@/shell/labels';
import { selectPendingCount, selectServerMode } from '@/store/selectors';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

/** Desktop top bar: greeting + screen title, clock, offline pill, theme toggle. */
export function TopBar() {
  const t = useTheme();
  const pathname = usePathname();
  const now = useAppStore((s) => s.now);
  const offline = useAppStore((s) => s.offline);
  const pending = useAppStore(selectPendingCount);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const refresh = useAppStore((s) => s.refresh);
  const showToast = useAppStore((s) => s.showToast);
  const childFirst = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId)?.first);
  // The shared predicate, so this and Home's banner cannot answer the question
  // differently. It hands back a boolean and never a reshaped `connection`: a
  // freshly built reference here is the zustand v5 render loop.
  const serverMode = useAppStore(selectServerMode);

  // `DesktopShell` wraps the whole navigator, so this pill rides every route
  // including the queue screen itself. Sending it there from there is a no-op
  // that reads as a broken button, hence `atQueue`.
  const pillAction = offlineBannerAction({ serverMode, atQueue: isQueueRoute(pathname) });

  const greeting = greetingFor(new Date(now).getHours());
  const title = screenTitleFor(pathname, childFirst);
  const clock = new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 24,
        paddingHorizontal: 32,
        paddingBottom: 18,
      }}
    >
      <View style={{ minWidth: 0 }}>
        <Txt weight={700} size={13} color={t.faint} tracking={1} style={{ textTransform: 'uppercase' }}>
          {greeting}
        </Txt>
        <Txt weight={800} size={26} tracking={-0.6} numberOfLines={1} style={{ marginTop: 2 }}>
          {title}
        </Txt>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {offline && (
          <Pressable
            onPress={() => {
              if (pillAction === 'open-queue') {
                router.navigate(QUEUE_ROUTE);
                return;
              }
              // Nowhere to navigate: the queue screen is either already on
              // screen or, in local mode, deliberately unreachable. The press
              // keeps the toast and the `refresh()` it always had, which on the
              // queue screen re-checks the connection and in local mode does
              // nothing at all (`refresh` returns early off server mode).
              showToast('Checking connection…');
              void refresh();
            }}
            accessibilityRole="button"
            accessibilityLabel={offlineBannerA11yLabel(pillAction)}
            style={(pstate) => [
              {
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingVertical: 8,
                paddingHorizontal: 13,
                borderRadius: 12,
                backgroundColor: t.dark ? '#3A2E18' : '#FBEFD4',
                borderWidth: 1,
                borderColor: 'rgba(226,181,84,0.5)',
                cursor: 'pointer',
              },
              isHovered(pstate) && { borderColor: 'rgba(226,181,84,0.9)' },
              pstate.pressed && { opacity: 0.85 },
            ]}
          >
            <View style={{ width: 8, height: 8, borderRadius: 99, backgroundColor: '#E2B554' }} />
            <Txt weight={600} size={12.5} color={t.text}>
              {pending > 0 ? `Offline · ${pending} pending` : 'Offline'}
            </Txt>
            {/* The same chevron the phone banner grew, and for the same reason:
                the pill opens a screen now, and nothing else here says so. It
                is dropped in the two cases where the press opens nothing. */}
            {pillAction === 'open-queue' && <Icon name="chevron-right" color="#E2B554" size={16} />}
          </Pressable>
        )}

        <Txt weight={700} size={14.5} color={t.dim} style={{ fontVariant: ['tabular-nums'] }}>
          {clock}
        </Txt>

        <Pressable
          onPress={toggleTheme}
          accessibilityRole="button"
          accessibilityLabel="Toggle theme"
          style={(s) => [
            {
              width: 42,
              height: 42,
              borderRadius: 13,
              backgroundColor: t.chip,
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            },
            isHovered(s) && { backgroundColor: t.elevated },
          ]}
        >
          <Icon name={t.dark ? 'moon' : 'sun'} color={t.text} size={20} />
        </Pressable>
      </View>
    </View>
  );
}
