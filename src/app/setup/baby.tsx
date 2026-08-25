import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { DateFields } from '@/components/DateFields';
import { isHovered } from '@/components/hover';
import { Icon, type IconName } from '@/components/Icon';
import { Tappable } from '@/components/press';
import { Txt } from '@/components/Txt';
import { SetupButton } from '@/features/setup/SetupButton';
import { useFinishSetup } from '@/features/setup/useFinishSetup';
import { clampBirth, clampDueDate } from '@/lib/birthDate';
import { hexA } from '@/lib/color';
import { requestReminderPermission } from '@/notifications/permission';
import { backOr } from '@/lib/nav';
import { pickChildPhoto } from '@/lib/photo';
import { useDesktopShell } from '@/shell/useDesktopShell';
import { fontFamily } from '@/theme/fonts';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';
import type { ChildGender, PhotoChange } from '@/types/models';

type Step = 'ask' | 'form' | 'expecting';

/** Mirrors ChildSheet's gender picker: `undefined` ("Not set") is a first-class choice. */
const GENDER_OPTIONS: readonly (readonly [string, ChildGender | undefined])[] = [
  ['Not set', undefined],
  ['Girl', 'girl'],
  ['Boy', 'boy'],
];

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
  const color = tone === 'danger' ? '#E2725B' : t.text;
  return (
    <Tappable
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
    </Tappable>
  );
}

function PhotoPicker({
  photo,
  previewFirst,
  onPick,
  onRemove,
}: {
  photo: string | null;
  previewFirst: string;
  onPick: (source: 'library' | 'camera') => void;
  onRemove: () => void;
}) {
  const t = useTheme();
  const previewChild = { first: previewFirst.trim() || '?', color: t.primary, picture: photo };
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ marginBottom: 12 }}>
        {photo || previewFirst.trim() ? (
          <Avatar child={previewChild} size={80} radius={26} fontSize={30} />
        ) : (
          <View style={{ width: 80, height: 80, borderRadius: 26, backgroundColor: hexA(t.primary, t.dark ? 0.2 : 0.16), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="image" color={t.primary} size={30} />
          </View>
        )}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <PhotoPill icon="image" label="Library" onPress={() => onPick('library')} />
        <PhotoPill icon="camera" label="Camera" onPress={() => onPick('camera')} />
        {photo ? <PhotoPill icon="trash" label="Remove" tone="danger" onPress={onRemove} /> : null}
      </View>
    </View>
  );
}

/** On a phone, pushes the button to the bottom of the screen as before. On desktop
 *  the viewport is much taller than the form, so a flex spacer there would strand
 *  the button far below the content instead: give it a fixed gap. */
function BottomSpacer({ minHeight }: { minHeight: number }) {
  const desktop = useDesktopShell();
  return desktop ? <View style={{ height: minHeight }} /> : <View style={{ flex: 1, minHeight }} />;
}

function GenderPicker({
  gender,
  onChange,
}: {
  gender: ChildGender | undefined;
  onChange: (value: ChildGender | undefined) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 7 }}>
      {GENDER_OPTIONS.map(([label, value]) => {
        const selected = gender === value;
        return (
          <Tappable
            key={label}
            onPress={() => onChange(value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={(s) => [
              {
                flex: 1,
                height: 48,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1.5,
                borderColor: selected ? t.primary : t.line2,
                backgroundColor: selected ? hexA(t.primary, t.dark ? 0.16 : 0.1) : t.surface,
                cursor: 'pointer',
              },
              isHovered(s) && !selected && { borderColor: t.line2 },
            ]}
          >
            <Txt unselectable weight={700} size={13.5} color={selected ? t.primary : t.text}>
              {label}
            </Txt>
          </Tappable>
        );
      })}
    </View>
  );
}

/**
 * First-run step 2: who are we tracking. Reached from the welcome screen in the
 * local branch, and from the connect form when a server turns out to have no
 * children on it yet.
 *
 * An expecting parent gives a name and a due date, which creates a child carrying
 * expected: true with `birth` holding the due date. That child is held back from
 * server sync until the birth is confirmed.
 */
export default function SetupBaby() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const finish = useFinishSetup();
  const saveChild = useAppStore((s) => s.saveChild);
  const showToast = useAppStore((s) => s.showToast);

  const [step, setStep] = useState<Step>('ask');
  const today = new Date();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoChange, setPhotoChange] = useState<PhotoChange>({ kind: 'none' });
  const [gender, setGender] = useState<ChildGender | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const [year, setYear] = useState(String(today.getFullYear()));
  const [month, setMonth] = useState(String(today.getMonth() + 1));
  const [day, setDay] = useState(String(today.getDate()));
  // The due date is its own state with its own default: sharing the birthday
  // fields leaks one date into the other when the branch changes.
  const due = new Date();
  due.setDate(due.getDate() + 30);
  const [dueYear, setDueYear] = useState(String(due.getFullYear()));
  const [dueMonth, setDueMonth] = useState(String(due.getMonth() + 1));
  const [dueDay, setDueDay] = useState(String(due.getDate()));
  const [saving, setSaving] = useState(false);

  const canSave = first.trim().length > 0;

  const onPickPhoto = async (source: 'library' | 'camera') => {
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

  // Guarded against a double tap: saveChild returns before its server push settles
  // and finish() only schedules the navigation, so a second tap landing before the
  // screen unmounts would create a second child.
  const onAdd = () => {
    if (!canSave || saving) return;
    setSaving(true);
    saveChild({
      first: first.trim(),
      last: last.trim(),
      birth: clampBirth(year, month, day),
      photo: photoChange,
      gender,
    });
    finish();
  };

  // Same double-tap guard as onAdd. setSaving(true) runs before the first await
  // below, so a second tap during the permission dialog is blocked too.
  const onAddExpected = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    // Ask BEFORE saving, not after: saveChild's store write is what triggers the
    // scheduling reconciler (scheduleSync), and that reconciler silently skips
    // scheduling when permission is missing rather than requesting it itself. An
    // ask fired after saveChild would race the reconciler and lose, and granting
    // afterwards touches no store slice, so nothing would re-run the reconciler to
    // pick it up. A denial still saves the child, it just means no reminders.
    await requestReminderPermission();
    saveChild({
      first: first.trim(),
      last: last.trim(),
      birth: clampDueDate(dueYear, dueMonth, dueDay),
      expected: true,
      photo: photoChange,
      gender,
    });
    finish();
  };

  // Back leaves the fork before it leaves the route, so changing the answer does
  // not drop the user back to the branch they arrived from. Leaving the route falls
  // back to welcome, the step this one is pushed from, for a session that started
  // here (welcome re-gates a finished setup itself).
  const onBack = () => {
    if (step === 'ask') backOr('/welcome');
    else setStep('ask');
  };

  const input = {
    height: 54,
    borderRadius: 15,
    backgroundColor: t.surface,
    borderWidth: 1.5,
    borderColor: t.line2,
    paddingHorizontal: 16,
    fontSize: 15.5,
    fontFamily: fontFamily(500),
    color: t.text,
  } as const;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{
        flexGrow: 1,
        alignItems: 'center',
        paddingTop: insets.top + 16,
        paddingHorizontal: 24,
        paddingBottom: insets.bottom + 24,
      }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Capped so the form isn't full-bleed on wide desktop/web viewports. */}
      <View style={{ flex: 1, width: '100%', maxWidth: 460 }}>
        <Tappable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={(s) => [
            { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginLeft: -8, cursor: 'pointer' },
            isHovered(s) && { backgroundColor: t.chip },
          ]}
        >
          <Icon name="chevron-left" color={t.text} size={22} />
        </Tappable>

        {step === 'ask' && (
          <>
            <Txt weight={800} size={26} tracking={-0.5} style={{ marginTop: 12, lineHeight: 32 }}>
              Has your baby arrived?
            </Txt>
            <Txt weight={500} size={15} color={t.dim} style={{ marginTop: 10, lineHeight: 22 }}>
              Budkin tracks feeds, naps, diapers and growth from day one.
            </Txt>

            <BottomSpacer minHeight={24} />

            <SetupButton label="Yes, they are here" onPress={() => setStep('form')} />
            <SetupButton
              label="Not yet"
              variant="secondary"
              onPress={() => setStep('expecting')}
              style={{ marginTop: 12 }}
            />
          </>
        )}

        {step === 'form' && (
          <>
            <Txt weight={800} size={26} tracking={-0.5} style={{ marginTop: 12, lineHeight: 32 }}>
              Add your baby
            </Txt>
            <Txt weight={500} size={15} color={t.dim} style={{ marginTop: 10, lineHeight: 22 }}>
              Just a name and a birthday. Everything else can wait.
            </Txt>

            <View style={{ marginTop: 24 }}>
              <PhotoPicker photo={photo} previewFirst={first} onPick={onPickPhoto} onRemove={onRemovePhoto} />
            </View>

            <View style={{ marginTop: 24 }}>
              <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 8 }}>
                FIRST NAME
              </Txt>
              <TextInput
                value={first}
                onChangeText={setFirst}
                placeholder="Rowan"
                placeholderTextColor={t.faint}
                autoCapitalize="words"
                autoCorrect={false}
                style={input}
              />
            </View>

            <View style={{ marginTop: 16 }}>
              <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 8 }}>
                LAST NAME (OPTIONAL)
              </Txt>
              <TextInput
                value={last}
                onChangeText={setLast}
                placeholder="Optional"
                placeholderTextColor={t.faint}
                autoCapitalize="words"
                autoCorrect={false}
                style={input}
              />
            </View>

            <View style={{ marginTop: 16 }}>
              <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 8 }}>
                GENDER (OPTIONAL)
              </Txt>
              <GenderPicker gender={gender} onChange={setGender} />
            </View>

            <View style={{ marginTop: 16 }}>
              <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 8 }}>
                BIRTHDAY
              </Txt>
              <DateFields
                day={day}
                month={month}
                year={year}
                onDay={setDay}
                onMonth={setMonth}
                onYear={setYear}
              />
            </View>

            <BottomSpacer minHeight={24} />

            <SetupButton
              label="Add baby"
              onPress={onAdd}
              disabled={!canSave || saving}
              style={{ marginTop: 24 }}
            />

            <Tappable
              onPress={finish}
              accessibilityRole="button"
              style={(s) => [{ marginTop: 18, alignItems: 'center', cursor: 'pointer' }, isHovered(s) && { opacity: 0.75 }]}
            >
              <Txt unselectable weight={600} size={13.5} color={t.dim}>
                Skip for now
              </Txt>
            </Tappable>
          </>
        )}

        {step === 'expecting' && (
          <>
            <Txt weight={800} size={26} tracking={-0.5} style={{ marginTop: 12, lineHeight: 32 }}>
              When are they due?
            </Txt>
            <Txt weight={500} size={15} color={t.dim} style={{ marginTop: 10, lineHeight: 22 }}>
              Budkin will count down, and start tracking the day they arrive.
            </Txt>

            <View style={{ marginTop: 24 }}>
              <PhotoPicker photo={photo} previewFirst={first} onPick={onPickPhoto} onRemove={onRemovePhoto} />
            </View>

            <View style={{ marginTop: 24 }}>
              <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 8 }}>
                FIRST NAME
              </Txt>
              <TextInput
                value={first}
                onChangeText={setFirst}
                placeholder="Rowan"
                placeholderTextColor={t.faint}
                autoCapitalize="words"
                autoCorrect={false}
                style={input}
              />
            </View>

            <View style={{ marginTop: 16 }}>
              <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 8 }}>
                GENDER (OPTIONAL)
              </Txt>
              <GenderPicker gender={gender} onChange={setGender} />
            </View>

            <View style={{ marginTop: 16 }}>
              <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 8 }}>
                DUE DATE
              </Txt>
              <DateFields
                day={dueDay}
                month={dueMonth}
                year={dueYear}
                onDay={setDueDay}
                onMonth={setDueMonth}
                onYear={setDueYear}
              />
            </View>

            <BottomSpacer minHeight={24} />

            <SetupButton
              label="Add baby"
              onPress={onAddExpected}
              disabled={!canSave || saving}
              style={{ marginTop: 24 }}
            />

            <Tappable
              onPress={finish}
              accessibilityRole="button"
              style={(s) => [{ marginTop: 18, alignItems: 'center', cursor: 'pointer' }, isHovered(s) && { opacity: 0.75 }]}
            >
              <Txt unselectable weight={600} size={13.5} color={t.dim}>
                Skip for now
              </Txt>
            </Tappable>
          </>
        )}
      </View>
    </ScrollView>
  );
}
