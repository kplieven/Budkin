import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/BottomSheet';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { treatmentScheduleLabel, treatmentDosageLabel } from '@/features/treatments/treatmentLabels';
import { treatmentDueList, entriesForChild } from '@/store/selectors';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

/**
 * Treatment picker: opened from the Medication tile when the selected child has at
 * least one active treatment covering today (the tile decides via `openMedicationLog`,
 * so this sheet is never shown empty). Tapping a treatment logs a dose from it right
 * away (no form to confirm); "Log manually" opens the plain form instead.
 *
 * A treatment whose dose is owed right now is marked with a "Due" pill and an
 * accent border, and `treatmentDueList` floats those rows to the top, so the sheet
 * answers "what do I give now?" before it answers "what is this child on?".
 *
 * The due list is derived HERE in render (a pure helper over raw-selected
 * `treatments` / `entries`), never from a store selector, per the zustand v5 rule
 * against returning a fresh filtered array.
 */
export function TreatmentPickerSheet() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const open = useAppStore((s) => s.treatmentPicker?.open ?? false);
  // Raw selects (stable references), then derive the filtered list in render.
  const treatments = useAppStore((s) => s.treatments);
  const entries = useAppStore((s) => s.entries);
  const selectedChildId = useAppStore((s) => s.selectedChildId);
  const now = useAppStore((s) => s.now);
  const closeTreatmentPicker = useAppStore((s) => s.closeTreatmentPicker);
  const openSheet = useAppStore((s) => s.openSheet);
  const logMedicationFromTreatment = useAppStore((s) => s.logMedicationFromTreatment);

  if (!open) return null;

  // Entries must be child-scoped before the due maths: the store's `entries` is
  // a flat all-children array, so a sibling's dose of the same medication would
  // otherwise settle this child's treatment.
  const active = treatmentDueList(treatments, selectedChildId, entriesForChild(entries, selectedChildId), now);

  const logManually = () => {
    closeTreatmentPicker();
    openSheet('medication');
  };

  return (
    <BottomSheet onClose={closeTreatmentPicker}>
      <View style={{ paddingHorizontal: 22, paddingTop: 10, paddingBottom: 6, flexShrink: 0 }}>
        <Txt weight={800} size={18}>
          Log a dose
        </Txt>
        <Txt weight={500} size={13} color={t.dim} style={{ marginTop: 2 }}>
          Tap a treatment to log it now, or log manually
        </Txt>
      </View>
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: insets.bottom + 10, gap: 8 }}>
        {active.map(({ treatment: c, due }) => {
          const isDue = due > 0;
          return (
            <Pressable
              key={c.id}
              onPress={() => logMedicationFromTreatment(c.id)}
              accessibilityRole="button"
              // The due state rides in the label too, so it reaches a screen
              // reader that never sees the pill.
              accessibilityLabel={isDue ? `Log a dose of ${c.name}, due` : `Log a dose of ${c.name}`}
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
                  borderColor: isDue ? hexA(t.activity.medication, 0.45) : t.line,
                  cursor: 'pointer',
                },
                isHovered(s) && { borderColor: isDue ? hexA(t.activity.medication, 0.7) : t.line2 },
              ]}
            >
              <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: hexA(t.activity.medication, isDue ? 0.28 : 0.16), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="medication" color={t.activity.medication} size={22} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Txt unselectable weight={700} size={16}>
                    {c.name}
                  </Txt>
                  {isDue ? (
                    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: t.activity.medication }}>
                      <Txt unselectable weight={800} size={11} tracking={0.2} color={t.onActivity}>
                        DUE
                      </Txt>
                    </View>
                  ) : null}
                </View>
                <Txt weight={500} size={13} color={t.dim}>
                  {[treatmentDosageLabel(c), treatmentScheduleLabel(c)].filter(Boolean).join(' · ')}
                </Txt>
              </View>
              <Icon name="chevron-right" color={t.faint} size={18} />
            </Pressable>
          );
        })}

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
