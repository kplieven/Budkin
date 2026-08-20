import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { BottomSheet } from '@/components/BottomSheet';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Tappable } from '@/components/press';
import { Txt } from '@/components/Txt';
import { ageOrDueLabel } from '@/lib/format';
import { hexA } from '@/lib/color';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

export function ChildSwitcher() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const open = useAppStore((s) => s.showChildSwitcher);
  const children = useAppStore((s) => s.children);
  const selectedId = useAppStore((s) => s.selectedChildId);
  const now = useAppStore((s) => s.now);
  const selectChild = useAppStore((s) => s.selectChild);
  const closeSwitcher = useAppStore((s) => s.closeSwitcher);
  const openAddChild = useAppStore((s) => s.openAddChild);
  const openEditChild = useAppStore((s) => s.openEditChild);

  if (!open) return null;

  return (
    <BottomSheet onClose={closeSwitcher} anchor="bottom-left">
      <Txt weight={800} size={18} style={{ paddingHorizontal: 22, paddingTop: 10, paddingBottom: 14, flexShrink: 0 }}>
        Who are you logging for?
      </Txt>
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 10, gap: 8 }}>
        {children.map((c) => {
          const selected = c.id === selectedId;
          return (
            <Tappable
              key={c.id}
              onPress={() => selectChild(c.id)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={(s) => [
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 13,
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  borderRadius: 18,
                  backgroundColor: selected ? hexA(t.primary, t.dark ? 0.13 : 0.1) : t.chip,
                  borderWidth: 1.5,
                  borderColor: selected ? hexA(t.primary, 0.4) : t.line,
                  cursor: 'pointer',
                },
                !selected && isHovered(s) && { borderColor: t.line2 },
              ]}
            >
              <Avatar child={c} size={42} radius={14} fontSize={17} />
              <View style={{ flex: 1 }}>
                <Txt unselectable weight={700} size={16}>
                  {c.first} {c.last}
                </Txt>
                <Txt weight={500} size={13} color={t.dim}>
                  {ageOrDueLabel(c.birth, !!c.expected, now)}
                </Txt>
              </View>
              <Tappable
                onPress={() => openEditChild(c.id)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${c.first}`}
                style={(s) => [
                  { padding: 7, borderRadius: 9, cursor: 'pointer' },
                  isHovered(s) && { backgroundColor: t.elevated },
                ]}
              >
                <Icon name="edit" color={t.faint} size={16} />
              </Tappable>
              {selected && <Icon name="check" color={t.primary} size={22} />}
            </Tappable>
          );
        })}

        <Tappable
          onPress={openAddChild}
          accessibilityRole="button"
          style={(s) => [
            {
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 9,
              padding: 14,
              borderRadius: 16,
              borderWidth: 1.5,
              borderStyle: 'dashed',
              borderColor: hexA(t.primary, 0.45),
              marginTop: 2,
              cursor: 'pointer',
            },
            isHovered(s) && { backgroundColor: hexA(t.primary, t.dark ? 0.1 : 0.06) },
          ]}
        >
          <Icon name="plus" color={t.primary} size={18} />
          <Txt weight={700} size={15} color={t.primary}>
            Add a child
          </Txt>
        </Tappable>
      </ScrollView>
    </BottomSheet>
  );
}
