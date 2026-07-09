import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { BottomSheet } from '@/components/BottomSheet';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { fontFamily } from '@/theme/fonts';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';
import type { Child } from '@/types/models';

function midnight(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Clamp raw Y/M/D text fields to a valid, non-future local date and convert
 *  to epoch ms (local midnight) — no date-picker dependency, just numeric
 *  TextInputs validated on save. */
function clampBirth(yStr: string, mStr: string, dStr: string): number {
  const now = new Date();
  const y = Math.min(now.getFullYear(), Math.max(1900, parseInt(yStr, 10) || now.getFullYear()));
  const mo = Math.min(12, Math.max(1, parseInt(mStr, 10) || 1));
  const maxDay = new Date(y, mo, 0).getDate(); // days in month `mo` (1-12)
  const d = Math.min(maxDay, Math.max(1, parseInt(dStr, 10) || 1));
  return Math.min(new Date(y, mo - 1, d).getTime(), midnight());
}

export function ChildSheet() {
  const open = useAppStore((s) => s.childSheet);
  const editingId = useAppStore((s) => s.editingChildId);
  if (!open) return null;
  return <Inner key={editingId ?? 'new'} editingId={editingId} />;
}

function Inner({ editingId }: { editingId: string | null }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const children = useAppStore((s) => s.children);
  const saveChild = useAppStore((s) => s.saveChild);
  const close = useAppStore((s) => s.closeChildSheet);

  const editing: Child | null = editingId ? (children.find((c) => c.id === editingId) ?? null) : null;
  const editingDate = editing ? new Date(editing.birth) : new Date();

  const [first, setFirst] = useState(editing?.first ?? '');
  const [last, setLast] = useState(editing?.last ?? '');
  const [year, setYear] = useState(String(editingDate.getFullYear()));
  const [month, setMonth] = useState(String(editingDate.getMonth() + 1));
  const [day, setDay] = useState(String(editingDate.getDate()));

  const canSave = first.trim().length > 0;

  const onSave = () => {
    if (!canSave) return;
    const birth = clampBirth(year, month, day);
    saveChild({ first: first.trim(), last: last.trim(), birth });
  };

  return (
    <BottomSheet onClose={close}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 14, flexShrink: 0 }}>
        {editing ? (
          <Avatar child={editing} size={44} radius={14} fontSize={18} />
        ) : (
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: hexA(t.primary, t.dark ? 0.2 : 0.16), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="plus" color={t.primary} size={22} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Txt weight={800} size={20} tracking={-0.3}>
            {editingId ? 'Edit child' : 'Add a child'}
          </Txt>
        </View>
        <IconButton name="close" onPress={close} size={20} accessibilityLabel="Close" />
      </View>

      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
        <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 9 }}>
          First name
        </Txt>
        <TextInput
          value={first}
          onChangeText={setFirst}
          placeholder="First name"
          placeholderTextColor={t.faint}
          autoFocus={!editing}
          style={{ height: 52, borderRadius: 14, backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, paddingHorizontal: 14, fontSize: 16, fontFamily: fontFamily(600), color: t.text, marginBottom: 16 }}
        />

        <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 9 }}>
          Last name (optional)
        </Txt>
        <TextInput
          value={last}
          onChangeText={setLast}
          placeholder="Last name"
          placeholderTextColor={t.faint}
          style={{ height: 52, borderRadius: 14, backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, paddingHorizontal: 14, fontSize: 16, fontFamily: fontFamily(600), color: t.text, marginBottom: 16 }}
        />

        <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 9 }}>
          Birth date
        </Txt>
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 8 }}>
          <View style={{ flex: 1.3 }}>
            <Txt weight={600} size={11} color={t.faint} style={{ marginBottom: 5 }}>
              YEAR
            </Txt>
            <TextInput
              value={year}
              onChangeText={setYear}
              keyboardType="number-pad"
              maxLength={4}
              placeholder="YYYY"
              placeholderTextColor={t.faint}
              style={{ height: 52, borderRadius: 14, backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, paddingHorizontal: 12, fontSize: 16, fontFamily: fontFamily(700), color: t.text, textAlign: 'center' }}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Txt weight={600} size={11} color={t.faint} style={{ marginBottom: 5 }}>
              MONTH
            </Txt>
            <TextInput
              value={month}
              onChangeText={setMonth}
              keyboardType="number-pad"
              maxLength={2}
              placeholder="MM"
              placeholderTextColor={t.faint}
              style={{ height: 52, borderRadius: 14, backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, paddingHorizontal: 12, fontSize: 16, fontFamily: fontFamily(700), color: t.text, textAlign: 'center' }}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Txt weight={600} size={11} color={t.faint} style={{ marginBottom: 5 }}>
              DAY
            </Txt>
            <TextInput
              value={day}
              onChangeText={setDay}
              keyboardType="number-pad"
              maxLength={2}
              placeholder="DD"
              placeholderTextColor={t.faint}
              style={{ height: 52, borderRadius: 14, backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, paddingHorizontal: 12, fontSize: 16, fontFamily: fontFamily(700), color: t.text, textAlign: 'center' }}
            />
          </View>
        </View>
        <Txt weight={500} size={12} color={t.faint} style={{ marginBottom: 8 }}>
          Can&apos;t be in the future — out-of-range values are clamped when you save.
        </Txt>
      </ScrollView>

      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 12, paddingBottom: insets.bottom + 8, borderTopWidth: 1, borderTopColor: t.line, flexShrink: 0 }}>
        <Pressable
          onPress={onSave}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSave }}
          style={(s) => [
            {
              flex: 1,
              height: 58,
              borderRadius: 18,
              backgroundColor: t.primary,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: canSave ? 1 : 0.5,
              boxShadow: canSave ? `0px 8px 22px ${hexA(t.primary, 0.35)}` : undefined,
              cursor: canSave ? 'pointer' : 'auto',
            },
            canSave && isHovered(s) && { boxShadow: `0px 8px 22px ${hexA(t.primary, 0.5)}` },
          ]}
        >
          <Txt unselectable weight={800} size={17.5} color={t.onPrimary}>
            {editingId ? 'Save changes' : 'Add child'}
          </Txt>
        </Pressable>
      </View>
    </BottomSheet>
  );
}
