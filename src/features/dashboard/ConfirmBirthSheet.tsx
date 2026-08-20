import { useState } from 'react';
import { View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { DateFields } from '@/components/DateFields';
import { isHovered } from '@/components/hover';
import { Tappable } from '@/components/press';
import { Txt } from '@/components/Txt';
import { clampBirth } from '@/lib/birthDate';
import { hexA } from '@/lib/color';
import { shadowStyle } from '@/theme/shadow';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

/**
 * One field: the real birth date, prefilled with today. The name already exists from
 * the due-date form, so there is nothing else to ask for. Uses clampBirth, not
 * clampDueDate: this IS a birth date now, so it must not be in the future.
 */
export function ConfirmBirthSheet() {
  const id = useAppStore((s) => s.confirmBirthFor);
  if (!id) return null;
  return <Inner id={id} />;
}

function Inner({ id }: { id: string }) {
  const t = useTheme();
  const close = useAppStore((s) => s.closeConfirmBirth);
  const confirmBirth = useAppStore((s) => s.confirmBirth);
  const child = useAppStore((s) => s.children.find((c) => c.id === id));

  const today = new Date();
  const [year, setYear] = useState(String(today.getFullYear()));
  const [month, setMonth] = useState(String(today.getMonth() + 1));
  const [day, setDay] = useState(String(today.getDate()));
  const [saving, setSaving] = useState(false);

  const onConfirm = () => {
    if (saving) return;
    setSaving(true);
    confirmBirth(id, clampBirth(year, month, day));
    close();
  };

  return (
    <BottomSheet onClose={close}>
      <View style={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: 20 }}>
        <Txt weight={800} size={21} tracking={-0.3}>
          Welcome, {child?.first ?? 'little one'}
        </Txt>
        <Txt weight={500} size={14.5} color={t.dim} style={{ marginTop: 8, lineHeight: 21 }}>
          What day did they arrive? Everything starts from here.
        </Txt>

        <View style={{ marginTop: 20 }}>
          <DateFields
            day={day}
            month={month}
            year={year}
            onDay={setDay}
            onMonth={setMonth}
            onYear={setYear}
          />
        </View>

        <Tappable
          onPress={onConfirm}
          disabled={saving}
          accessibilityRole="button"
          accessibilityState={{ disabled: saving }}
          style={(s) => [
            {
              height: 54,
              borderRadius: 16,
              marginTop: 22,
              backgroundColor: t.primary,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: saving ? 0.5 : 1,
              cursor: saving ? 'auto' : 'pointer',
            },
            !saving && shadowStyle(`0px 8px 22px ${hexA(t.primary, 0.35)}`),
            !saving && isHovered(s) && { opacity: 0.9 },
          ]}
        >
          <Txt unselectable weight={800} size={17} color={t.onPrimary}>
            Confirm birth
          </Txt>
        </Tappable>
      </View>
    </BottomSheet>
  );
}
