import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DateFields } from '@/components/DateFields';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { SetupButton } from '@/features/setup/SetupButton';
import { useFinishSetup } from '@/features/setup/useFinishSetup';
import { clampBirth, clampDueDate } from '@/lib/birthDate';
import { fontFamily } from '@/theme/fonts';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

type Step = 'ask' | 'form' | 'expecting';

/**
 * First-run step 2: who are we tracking. Reached from the welcome screen in the
 * local branch, and from the connect form when a server turns out to have no
 * children on it yet. Both cases create the child through the store's saveChild,
 * which handles the server push itself when connected.
 *
 * An expecting parent gives a name and a due date, which creates a child
 * carrying expected: true with birth holding the due date. Budkin counts down
 * to it, and the child is held back from server sync until the birth is
 * confirmed.
 */
export default function SetupBaby() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const finish = useFinishSetup();
  const saveChild = useAppStore((s) => s.saveChild);

  const [step, setStep] = useState<Step>('ask');
  const today = new Date();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [year, setYear] = useState(String(today.getFullYear()));
  const [month, setMonth] = useState(String(today.getMonth() + 1));
  const [day, setDay] = useState(String(today.getDate()));
  // The due date is its own state with its own default. Sharing the birthday
  // fields meant switching branches leaked one date into the other, and
  // re-entering this step silently discarded a hand-edited due date.
  const due = new Date();
  due.setDate(due.getDate() + 30);
  const [dueYear, setDueYear] = useState(String(due.getFullYear()));
  const [dueMonth, setDueMonth] = useState(String(due.getMonth() + 1));
  const [dueDay, setDueDay] = useState(String(due.getDate()));
  const [saving, setSaving] = useState(false);

  const canSave = first.trim().length > 0;

  // Guarded against a double tap: saveChild returns before its server push
  // settles and finish() only schedules the navigation, so a second tap landing
  // before the screen unmounts would create a second child.
  const onAdd = () => {
    if (!canSave || saving) return;
    setSaving(true);
    saveChild({ first: first.trim(), last: last.trim(), birth: clampBirth(year, month, day) });
    finish();
  };

  // Guarded against a double tap for the same reason as onAdd: saveChild returns
  // before its work settles and finish() only schedules the navigation.
  const onAddExpected = () => {
    if (!canSave || saving) return;
    setSaving(true);
    saveChild({
      first: first.trim(),
      last: last.trim(),
      birth: clampDueDate(dueYear, dueMonth, dueDay),
      expected: true,
    });
    finish();
  };

  // Back leaves the fork before it leaves the route, so changing the answer
  // does not drop the user back to the branch they arrived from.
  const onBack = () => {
    if (step === 'ask') router.back();
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
        paddingTop: insets.top + 16,
        paddingHorizontal: 24,
        paddingBottom: insets.bottom + 24,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <Pressable
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
      </Pressable>

      {step === 'ask' && (
        <>
          <Txt weight={800} size={26} tracking={-0.5} style={{ marginTop: 12, lineHeight: 32 }}>
            Has your baby arrived?
          </Txt>
          <Txt weight={500} size={15} color={t.dim} style={{ marginTop: 10, lineHeight: 22 }}>
            Budkin tracks feeds, naps, nappies and growth from day one.
          </Txt>

          <View style={{ flex: 1, minHeight: 24 }} />

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

          <View style={{ flex: 1, minHeight: 24 }} />

          <SetupButton
            label="Add baby"
            onPress={onAdd}
            disabled={!canSave || saving}
            style={{ marginTop: 24 }}
          />

          <Pressable
            onPress={finish}
            accessibilityRole="button"
            style={(s) => [{ marginTop: 18, alignItems: 'center', cursor: 'pointer' }, isHovered(s) && { opacity: 0.75 }]}
          >
            <Txt unselectable weight={600} size={13.5} color={t.dim}>
              Skip for now
            </Txt>
          </Pressable>
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

          <View style={{ flex: 1, minHeight: 24 }} />

          <SetupButton
            label="Add baby"
            onPress={onAddExpected}
            disabled={!canSave || saving}
            style={{ marginTop: 24 }}
          />

          <Pressable
            onPress={finish}
            accessibilityRole="button"
            style={(s) => [{ marginTop: 18, alignItems: 'center', cursor: 'pointer' }, isHovered(s) && { opacity: 0.75 }]}
          >
            <Txt unselectable weight={600} size={13.5} color={t.dim}>
              Skip for now
            </Txt>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}
