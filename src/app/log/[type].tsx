import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { resolveLogDeepLink } from '@/lib/logDeepLink';
import { useAppStore } from '@/store/useAppStore';

/**
 * Deep-link target: `budkin://log/<type>` (a home-screen widget, or a treatment
 * reminder tap). Opens the matching Quick-Log sheet over Home, or routes to
 * onboarding if the app isn't connected yet. Development builds ship their own
 * scheme, so the widget derives it rather than hardcoding one; see
 * StatusWidget.tsx and app.config.js.
 *
 * `?treatment=<id>` seeds the medication sheet from that treatment: name, dosage,
 * unit and next-dose interval filled in, opened in confirm mode, with only the
 * time left to adjust and Log left to press. It writes nothing. A notification
 * tap opens something, it never writes, and `logMedicationFromTreatment` already
 * holds that line ("No entry is written here; save() commits it once the user
 * confirms").
 *
 * `?child=<localId>` names who the link is for, since the widget's bitmap and a
 * pending alert both outlive the selection they were built from. The resolver
 * decides whether that selection moves; it refuses outright for a child the
 * roster no longer holds, rather than opening a write surface aimed at whoever
 * is selected instead.
 *
 * The Quick-Log sheet is a root-level overlay driven by global state, so opening
 * it only needs a store action. Navigation back to the tabs uses a declarative
 * <Redirect> (not an imperative router.replace() in the effect) so it survives a
 * cold start where the navigation container ref isn't live yet, see timer.tsx.
 */
export default function LogDeepLink() {
  const { type, treatment, child } = useLocalSearchParams<{ type: string; treatment?: string; child?: string }>();
  const connected = useAppStore((s) => s.connected);
  const openSheet = useAppStore((s) => s.openSheet);
  const openMedicationLog = useAppStore((s) => s.openMedicationLog);
  const logMedicationFromTreatment = useAppStore((s) => s.logMedicationFromTreatment);
  const selectChild = useAppStore((s) => s.selectChild);

  useEffect(() => {
    // The roster, the selection and `treatments` are read imperatively rather
    // than subscribed. The root layout renders null until `hydrating` clears
    // (see _layout.tsx), so all three are loaded by the time this route mounts,
    // and keeping them out of the dep list stops a background sync replacing
    // them from re-running this effect, which would reseed the draft and wipe a
    // time the parent had already adjusted. The selection matters most: this
    // effect MOVES it, so subscribing would re-run it on its own write.
    const s = useAppStore.getState();
    const action = resolveLogDeepLink({
      type,
      treatment,
      child,
      connected,
      expected: s.children.find((c) => c.id === s.selectedChildId)?.expected ?? false,
      selectedChildId: s.selectedChildId,
      children: s.children,
      treatments: s.treatments,
    });
    if (action.kind === 'none') return;
    // Before opening anything: every write site in the store reads the global
    // selection, so this is what makes the sheet log against the child the link
    // names rather than the one left selected.
    if (action.selectChildId) selectChild(action.selectChildId);
    if (action.kind === 'sheet') openSheet(action.activity);
    else if (action.kind === 'treatment') logMedicationFromTreatment(action.treatmentId);
    else openMedicationLog();
  }, [connected, type, treatment, child, selectChild, openSheet, openMedicationLog, logMedicationFromTreatment]);

  if (!connected) return <Redirect href="/onboarding" />;
  // Always lands on Home. When the child this is for is expected, or the link
  // names one we no longer have, the resolver above returns 'none', so this is a
  // plain redirect there instead of over an open sheet.
  return <Redirect href="/(tabs)" />;
}
