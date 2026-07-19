import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { BottomSheet } from '@/components/BottomSheet';
import { isHovered } from '@/components/hover';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Txt } from '@/components/Txt';
import { clampBirth } from '@/lib/birthDate';
import { hexA } from '@/lib/color';
import { pickChildPhoto } from '@/lib/photo';
import { fontFamily } from '@/theme/fonts';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';
import type { Child, PhotoChange } from '@/types/models';

const REMOVE_COLOR = '#E2725B'; // destructive accent, matches the LogSheet Delete button

/** A compact icon+label action pill for the photo controls. */
function PhotoPill({
  icon,
  label,
  onPress,
  tone = 'default',
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  tone?: 'default' | 'danger';
}) {
  const t = useTheme();
  const color = tone === 'danger' ? REMOVE_COLOR : t.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={(s) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 7,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 13,
          backgroundColor: t.chip,
          borderWidth: 1.5,
          borderColor: t.line,
          cursor: 'pointer',
        },
        isHovered(s) && { borderColor: t.line2 },
      ]}
    >
      <Icon name={icon} color={color} size={17} />
      <Txt unselectable weight={700} size={14} color={color}>
        {label}
      </Txt>
    </Pressable>
  );
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
  const deleteChild = useAppStore((s) => s.deleteChild);
  const showToast = useAppStore((s) => s.showToast);
  const close = useAppStore((s) => s.closeChildSheet);
  const connection = useAppStore((s) => s.connection);
  const offline = useAppStore((s) => s.offline);

  const editing: Child | null = editingId ? (children.find((c) => c.id === editingId) ?? null) : null;
  const editingDate = editing ? new Date(editing.birth) : new Date();

  const [first, setFirst] = useState(editing?.first ?? '');
  const [last, setLast] = useState(editing?.last ?? '');
  const [year, setYear] = useState(String(editingDate.getFullYear()));
  const [month, setMonth] = useState(String(editingDate.getMonth() + 1));
  const [day, setDay] = useState(String(editingDate.getDate()));
  const [photo, setPhoto] = useState<string | null>(editing?.picture ?? null);
  const [photoChange, setPhotoChange] = useState<PhotoChange>({ kind: 'none' });
  const [picking, setPicking] = useState(false);
  const [confirmName, setConfirmName] = useState('');

  const canSave = first.trim().length > 0;
  const previewChild = { first: first.trim() || editing?.first || '?', color: editing?.color ?? t.primary };

  // Delete is gated behind typing the child's first name (front-loaded
  // confirmation — the cascade is NOT undoable, so there's no undo toast).
  // A server-backed child (has a serverId, mirrors the store's delete gating)
  // can only be deleted durably while online in server mode; offline the next
  // refresh would resurrect it, so block it. Local-mode children delete in memory.
  const serverBacked = !!editing && editing.serverId != null;
  const deleteBlocked = serverBacked && !!connection && connection.mode === 'server' && offline;
  const nameConfirmed =
    !!editing && confirmName.trim().toLowerCase() === editing.first.trim().toLowerCase();
  const canDelete = nameConfirmed && !deleteBlocked;

  const onDelete = () => {
    if (!canDelete || !editing) return;
    deleteChild(editing.id);
  };

  const onPick = async (source: 'library' | 'camera') => {
    if (picking) return;
    setPicking(true);
    try {
      const res = await pickChildPhoto(source);
      if (res.ok) {
        setPhoto(res.photo.uri);
        setPhotoChange({ kind: 'set', photo: res.photo });
      } else if (res.reason === 'denied') {
        showToast(source === 'camera' ? 'Camera permission needed' : 'Photo permission needed');
      }
    } finally {
      setPicking(false);
    }
  };

  const onRemovePhoto = () => {
    setPhoto(null);
    setPhotoChange({ kind: 'remove' });
  };

  const onSave = () => {
    if (!canSave) return;
    const birth = clampBirth(year, month, day);
    saveChild({ first: first.trim(), last: last.trim(), birth, photo: photoChange });
  };

  const inputStyle = {
    height: 52,
    borderRadius: 14,
    backgroundColor: t.surface,
    borderWidth: 1.5,
    borderColor: t.line,
    paddingHorizontal: 14,
    fontSize: 16,
    fontFamily: fontFamily(600),
    color: t.text,
    marginBottom: 16,
  } as const;

  return (
    <BottomSheet onClose={close}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 14, flexShrink: 0 }}>
        {photo || editing ? (
          <Avatar child={{ ...previewChild, picture: photo }} size={44} radius={14} fontSize={18} />
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
          Photo
        </Txt>
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <View style={{ marginBottom: 12 }}>
            {photo || first.trim() || editing ? (
              <Avatar child={{ ...previewChild, picture: photo }} size={88} radius={28} fontSize={34} />
            ) : (
              <View style={{ width: 88, height: 88, borderRadius: 28, backgroundColor: hexA(t.primary, t.dark ? 0.2 : 0.16), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="image" color={t.primary} size={32} />
              </View>
            )}
          </View>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <PhotoPill icon="image" label="Library" onPress={() => onPick('library')} />
            <PhotoPill icon="camera" label="Camera" onPress={() => onPick('camera')} />
            {photo ? <PhotoPill icon="trash" label="Remove" tone="danger" onPress={onRemovePhoto} /> : null}
          </View>
        </View>

        <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 9 }}>
          First name
        </Txt>
        <TextInput
          value={first}
          onChangeText={setFirst}
          placeholder="First name"
          placeholderTextColor={t.faint}
          autoFocus={!editing}
          style={inputStyle}
        />

        <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 9 }}>
          Last name (optional)
        </Txt>
        <TextInput
          value={last}
          onChangeText={setLast}
          placeholder="Last name"
          placeholderTextColor={t.faint}
          style={inputStyle}
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

        {editing ? (
          <View style={{ marginTop: 24, paddingTop: 20, borderTopWidth: 1, borderTopColor: t.line }}>
            <Txt weight={800} size={15} color={REMOVE_COLOR} style={{ marginBottom: 6 }}>
              Delete child
            </Txt>
            <Txt weight={500} size={13} color={t.dim} style={{ marginBottom: 14, lineHeight: 19 }}>
              This permanently removes {editing.first} and all their history. This can&apos;t be
              undone.
            </Txt>
            <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 9 }}>
              Type &ldquo;{editing.first}&rdquo; to confirm
            </Txt>
            <TextInput
              value={confirmName}
              onChangeText={setConfirmName}
              placeholder={editing.first}
              placeholderTextColor={t.faint}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!deleteBlocked}
              style={{ ...inputStyle, marginBottom: 12, opacity: deleteBlocked ? 0.5 : 1 }}
            />
            <Pressable
              onPress={onDelete}
              disabled={!canDelete}
              accessibilityRole="button"
              accessibilityLabel={`Delete ${editing.first}`}
              accessibilityState={{ disabled: !canDelete }}
              style={(st) => [
                {
                  height: 52,
                  borderRadius: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: hexA(REMOVE_COLOR, t.dark ? 0.16 : 0.12),
                  borderWidth: 1.5,
                  borderColor: hexA(REMOVE_COLOR, canDelete ? 0.9 : 0.35),
                  opacity: canDelete ? 1 : 0.5,
                  cursor: canDelete ? 'pointer' : 'auto',
                },
                canDelete && isHovered(st) && { backgroundColor: hexA(REMOVE_COLOR, t.dark ? 0.24 : 0.18) },
              ]}
            >
              <Txt unselectable weight={800} size={15.5} color={REMOVE_COLOR}>
                Delete {editing.first}
              </Txt>
            </Pressable>
            {deleteBlocked ? (
              <Txt weight={600} size={12} color={t.faint} style={{ marginTop: 10, textAlign: 'center' }}>
                Reconnect to delete {editing.first}
              </Txt>
            ) : null}
          </View>
        ) : null}
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
