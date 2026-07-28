import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { resolveLogDeepLink } from '@/lib/logDeepLink';
import { useAppStore } from '@/store/useAppStore';

/**
 * Deep-link target: `babybuddy://log/<type>` (a home-screen widget, or a
 * treatment reminder tap). Opens the matching Quick-Log sheet over Home, or
 * routes to onboarding if the app isn't connected yet.
 *
 * `?cure=<id>` seeds the medication sheet from that treatment: name, dosage,
 * unit and next-dose interval filled in, opened in confirm mode, with only the
 * time left to adjust and Log left to press. It writes nothing. A notification
 * tap opens something, it never writes, and `logMedicationFromCure` already
 * holds that line ("No entry is written here; save() commits it once the user
 * confirms").
 *
 * The Quick-Log sheet is a root-level overlay driven by global state, so opening
 * it only needs a store action. Navigation back to the tabs uses a declarative
 * <Redirect> (not an imperative router.replace() in the effect) so it survives a
 * cold start where the navigation container ref isn't live yet, see timer.tsx.
 */
export default function LogDeepLink() {
  const { type, cure } = useLocalSearchParams<{ type: string; cure?: string }>();
  const connected = useAppStore((s) => s.connected);
  const openSheet = useAppStore((s) => s.openSheet);
  const openMedicationLog = useAppStore((s) => s.openMedicationLog);
  const logMedicationFromCure = useAppStore((s) => s.logMedicationFromCure);
  const expected = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId)?.expected ?? false);

  useEffect(() => {
    // `cures` is read imperatively rather than subscribed. The root layout
    // renders null until `hydrating` clears (see _layout.tsx), so cures are
    // already loaded by the time this route mounts, and keeping the array out
    // of the dep list stops a background sync replacing it from re-running this
    // effect, which would reseed the draft and wipe a time the parent had
    // already adjusted.
    const action = resolveLogDeepLink({
      type,
      cure,
      connected,
      expected,
      cures: useAppStore.getState().cures,
    });
    if (action.kind === 'sheet') openSheet(action.activity);
    else if (action.kind === 'cure') logMedicationFromCure(action.cureId);
    else if (action.kind === 'medicationLog') openMedicationLog();
  }, [connected, expected, type, cure, openSheet, openMedicationLog, logMedicationFromCure]);

  if (!connected) return <Redirect href="/onboarding" />;
  // Always lands on Home. When the selected child is expected, the resolver
  // above returns 'none', so this is a plain redirect there instead of over an
  // open sheet.
  return <Redirect href="/(tabs)" />;
}
