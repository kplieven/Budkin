import type { ReactNode } from 'react';
import { Pressable } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import type { SharedValue } from 'react-native-reanimated';

import { Txt } from '@/components/Txt';

// The app's delete accent (matches the LogSheet "Delete" button).
const DELETE_COLOR = '#E2725B';

/**
 * Phone-only wrapper: swipe a row left to reveal a Delete action. Desktop
 * history is mouse-driven (swiping is awkward), so it keeps plain rows and
 * doesn't use this. Deletion is undoable via the toast, so the revealed button
 * deletes immediately without a separate confirm.
 */
export function SwipeableRow({ onDelete, children }: { onDelete: () => void; children: ReactNode }) {
  const renderRightActions = (_progress: SharedValue<number>, _translation: SharedValue<number>, methods: SwipeableMethods) => (
    <Pressable
      onPress={() => {
        methods.close();
        onDelete();
      }}
      accessibilityRole="button"
      accessibilityLabel="Delete entry"
      style={(s) => [
        {
          width: 92,
          marginLeft: 8,
          // Inset by the card's 1.5px border (ActivityRow) so the red button
          // matches the card body height instead of peeking above/below on swipe.
          marginVertical: 1.5,
          borderRadius: 18,
          backgroundColor: DELETE_COLOR,
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
        },
        s.pressed && { opacity: 0.85 },
      ]}
    >
      <Txt unselectable weight={800} size={15} color="#ffffff">
        Delete
      </Txt>
    </Pressable>
  );

  return (
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={renderRightActions}
      // overflow:visible so the whole card (including its own left border) slides
      // left as one piece, instead of sliding behind the container's fixed clip.
      containerStyle={{ borderRadius: 18, overflow: 'visible' }}
    >
      {children}
    </ReanimatedSwipeable>
  );
}
