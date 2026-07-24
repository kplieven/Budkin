import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/BottomSheet';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { cureScheduleLabel, cureDosageLabel } from '@/features/cures/cureLabels';
import { activeCuresForChildToday, startOfDay } from '@/store/selectors';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

/**
 * Cure picker: opened from the Medication tile when the selected child has at
 * least one active cure covering today (the tile decides via `openMedicationLog`,
 * so this sheet is never shown empty). Tapping a cure logs a dose from it right
 * away (no form to confirm); "Log manually" opens the plain form instead. The
 * active-today list is derived HERE in render (a pure helper over raw-selected
 * `cures`), never from a store selector, per the zustand v5 rule against
 * returning a fresh filtered array.
 */
export function CurePickerSheet() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const open = useAppStore((s) => s.curePicker?.open ?? false);
  // Raw selects (stable references), then derive the filtered list in render.
  const cures = useAppStore((s) => s.cures);
  const selectedChildId = useAppStore((s) => s.selectedChildId);
  const now = useAppStore((s) => s.now);
  const closeCurePicker = useAppStore((s) => s.closeCurePicker);
  const openSheet = useAppStore((s) => s.openSheet);
  const logMedicationFromCure = useAppStore((s) => s.logMedicationFromCure);

  if (!open) return null;

  const active = activeCuresForChildToday(cures, selectedChildId, startOfDay(now));

  const logManually = () => {
    closeCurePicker();
    openSheet('medication');
  };

  return (
    <BottomSheet onClose={closeCurePicker}>
      <View style={{ paddingHorizontal: 22, paddingTop: 10, paddingBottom: 6, flexShrink: 0 }}>
        <Txt weight={800} size={18}>
          Log a dose
        </Txt>
        <Txt weight={500} size={13} color={t.dim} style={{ marginTop: 2 }}>
          Tap a treatment to log it now, or log manually
        </Txt>
      </View>
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: insets.bottom + 10, gap: 8 }}>
        {active.map((c) => (
          <Pressable
            key={c.id}
            onPress={() => logMedicationFromCure(c.id)}
            accessibilityRole="button"
            accessibilityLabel={`Log a dose of ${c.name}`}
            style={(s) => [
              {
                flexDirection: 'row',
                alignItems: 'center',
                gap: 13,
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderRadius: 18,
                backgroundColor: t.chip,
                borderWidth: 1.5,
                borderColor: t.line,
                cursor: 'pointer',
              },
              isHovered(s) && { borderColor: t.line2 },
            ]}
          >
            <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: hexA(t.activity.medication, 0.16), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="medication" color={t.activity.medication} size={22} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt unselectable weight={700} size={16}>
                {c.name}
              </Txt>
              <Txt weight={500} size={13} color={t.dim}>
                {[cureDosageLabel(c), cureScheduleLabel(c)].filter(Boolean).join(' · ')}
              </Txt>
            </View>
            <Icon name="chevron-right" color={t.faint} size={18} />
          </Pressable>
        ))}

        <Pressable
          onPress={logManually}
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
          <Icon name="edit" color={t.primary} size={17} />
          <Txt weight={700} size={15} color={t.primary}>
            Log manually
          </Txt>
        </Pressable>
      </ScrollView>
    </BottomSheet>
  );
}
