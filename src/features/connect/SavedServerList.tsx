import { ActivityIndicator, View, type ViewStyle } from 'react-native';

import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Tappable } from '@/components/press';
import { Txt } from '@/components/Txt';
import type { SavedServer } from '@/data/servers';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

/**
 * The "previously connected" rows, shared by the two screens that ask for a server:
 * the onboarding form and the local-mode Connect Baby Buddy sheet.
 *
 * What a tap MEANS is the caller's business, hence `onPick` rather than a connect
 * baked in here. Onboarding connects on the spot; the adopt sheet only prefills its
 * fields, because its primary action uploads this device's data and can duplicate
 * what is already on the server.
 *
 * `forgetServer` is NOT a prop: removing a remembered server means the same thing
 * wherever the row is shown.
 */
export function SavedServerList({
  onPick,
  busyUrl = null,
  disabled = false,
  style,
}: {
  onPick: (srv: SavedServer) => void;
  /** the row to spin, for a caller whose tap starts work; null spins nothing */
  busyUrl?: string | null;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const t = useTheme();
  const savedServers = useAppStore((s) => s.savedServers);
  const forgetServer = useAppStore((s) => s.forgetServer);

  if (savedServers.length === 0) return null;

  return (
    <View style={style}>
      <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 8 }}>
        PREVIOUSLY CONNECTED
      </Txt>
      {savedServers.map((srv) => {
        const host = srv.serverUrl.replace(/^https?:\/\//, '');
        const busy = busyUrl === srv.serverUrl;
        return (
          <Tappable
            key={srv.serverUrl}
            onPress={() => onPick(srv)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            style={(s) => [
              {
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                minHeight: 60,
                borderRadius: 15,
                backgroundColor: t.surface,
                borderWidth: 1.5,
                borderColor: t.line2,
                paddingHorizontal: 14,
                paddingVertical: 10,
                marginBottom: 10,
                cursor: disabled ? 'auto' : 'pointer',
              },
              !disabled && isHovered(s) && { borderColor: t.line },
            ]}
          >
            <Icon name="clock" color={t.dim} size={20} />
            <View style={{ flex: 1 }}>
              <Txt unselectable weight={600} size={15} numberOfLines={1}>
                {host}
              </Txt>
              <Txt unselectable weight={500} size={12.5} color={t.dim} style={{ marginTop: 2 }}>
                {'••••'}
                {srv.token.slice(-4)}
              </Txt>
            </View>
            {busy ? (
              <ActivityIndicator color={t.dim} />
            ) : (
              <Tappable
                onPress={() => forgetServer(srv.serverUrl)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${host}`}
                style={(s) => [{ padding: 6, borderRadius: 8, cursor: 'pointer' }, isHovered(s) && { backgroundColor: t.chip }]}
              >
                <Icon name="close" color={t.faint} size={18} />
              </Tappable>
            )}
          </Tappable>
        );
      })}
    </View>
  );
}
