import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/BottomSheet';
import { isHovered } from '@/components/hover';
import { Tappable } from '@/components/press';
import { Txt } from '@/components/Txt';
import { loadPendingOps } from '@/data/pendingOps';
import { DISCONNECT_BASE_LINE, disconnectLossLine } from '@/features/queue/disconnectWarning';
import { hexA } from '@/lib/color';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

const REMOVE_COLOR = '#E2725B'; // destructive accent, matches the child sheet

/**
 * The confirm step in front of Settings' "Reconnect / change server" row.
 * `disconnect()` clears the write queue and the offline op-log along with the entity
 * cache. The cache is refetchable; the other two exist nowhere else, so one unguarded
 * tap could silently destroy entries logged offline.
 *
 * A hand-built sheet and not `Alert.alert` because the app ships on web too, where
 * RN's Alert renders no buttons, so the confirm could never be answered.
 *
 * `queueCount` comes live from the store. The op-log has no mirror in state, so it is
 * read from AsyncStorage once when the sheet opens; until that read lands the loss line
 * counts the queue alone, which only ever understates.
 */
export function ConfirmDisconnectSheet({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const queueCount = useAppStore((s) => s.queueCount);
  const [pendingOpsCount, setPendingOpsCount] = useState(0);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadPendingOps().then((ops) => {
      if (alive) setPendingOpsCount(ops.length);
    });
    return () => {
      alive = false;
    };
  }, []);

  const loss = disconnectLossLine(queueCount, pendingOpsCount);

  // One shot: the confirm disconnects and navigates, so a second press mid-way would
  // replay the whole sequence against an already-cleared store.
  const confirm = () => {
    if (leaving) return;
    setLeaving(true);
    onConfirm();
  };

  return (
    <BottomSheet onClose={onCancel}>
      <View style={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: insets.bottom + 20 }}>
        <Txt weight={800} size={21} tracking={-0.3}>
          Reconnect / change server
        </Txt>
        <Txt weight={500} size={14.5} color={t.dim} style={{ marginTop: 8, lineHeight: 21 }}>
          {DISCONNECT_BASE_LINE}
        </Txt>
        {loss != null && (
          <Txt weight={700} size={14.5} color={REMOVE_COLOR} style={{ marginTop: 10, lineHeight: 21 }}>
            {loss}
          </Txt>
        )}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 22 }}>
          <Tappable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            style={(s) => [
              {
                flex: 1,
                height: 52,
                borderRadius: 14,
                backgroundColor: t.chip,
                borderWidth: 1.5,
                borderColor: t.line,
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              },
              isHovered(s) && { backgroundColor: t.elevated },
            ]}
          >
            <Txt unselectable weight={800} size={15.5} color={t.text}>
              Cancel
            </Txt>
          </Tappable>
          <Tappable
            onPress={confirm}
            disabled={leaving}
            accessibilityRole="button"
            accessibilityLabel="Sign out of this server"
            accessibilityState={{ disabled: leaving }}
            style={(s) => [
              {
                flex: 1,
                height: 52,
                borderRadius: 14,
                backgroundColor: hexA(REMOVE_COLOR, t.dark ? 0.16 : 0.12),
                borderWidth: 1.5,
                borderColor: hexA(REMOVE_COLOR, 0.9),
                alignItems: 'center',
                justifyContent: 'center',
                opacity: leaving ? 0.5 : 1,
                cursor: leaving ? 'auto' : 'pointer',
              },
              !leaving && isHovered(s) && { backgroundColor: hexA(REMOVE_COLOR, t.dark ? 0.24 : 0.18) },
            ]}
          >
            <Txt unselectable weight={800} size={15.5} color={REMOVE_COLOR}>
              Sign out
            </Txt>
          </Tappable>
        </View>
      </View>
    </BottomSheet>
  );
}
