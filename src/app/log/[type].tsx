import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { resolveLogDeepLink } from '@/lib/logDeepLink';
import { useAppStore } from '@/store/useAppStore';

/**
 * Deep-link target for `budkin://log/<type>`, from a widget button or a treatment
 * reminder tap. Opens the matching Quick-Log sheet over Home.
 *
 * `?treatment=<id>` opens the medication sheet in confirm mode. It writes nothing: a
 * notification tap opens something, it never writes.
 *
 * `?child=<localId>` names who the link is for, since the widget's bitmap and a pending
 * alert both outlive the selection they were built from.
 *
 * Navigation uses a declarative <Redirect>, not an imperative router.replace() in the
 * effect, so it survives a cold start where the navigation container ref is not live yet.
 */
export default function LogDeepLink() {
  const { type, treatment, child } = useLocalSearchParams<{ type: string; treatment?: string; child?: string }>();
  const connected = useAppStore((s) => s.connected);
  const openSheet = useAppStore((s) => s.openSheet);
  const openMedicationLog = useAppStore((s) => s.openMedicationLog);
  const logMedicationFromTreatment = useAppStore((s) => s.logMedicationFromTreatment);
  const selectChild = useAppStore((s) => s.selectChild);

  useEffect(() => {
    // Read imperatively rather than subscribed. The root layout renders null until
    // `hydrating` clears, so all three are loaded by the time this route mounts, and
    // keeping them out of the dep list stops a background sync re-running this effect and
    // wiping a time the parent had already adjusted. The selection matters most: this
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
    // Before opening anything: every write site in the store reads the global selection,
    // so this is what aims the sheet at the child the link names.
    if (action.selectChildId) selectChild(action.selectChildId);
    if (action.kind === 'sheet') openSheet(action.activity);
    else if (action.kind === 'treatment') logMedicationFromTreatment(action.treatmentId);
    else openMedicationLog();
  }, [connected, type, treatment, child, selectChild, openSheet, openMedicationLog, logMedicationFromTreatment]);

  if (!connected) return <Redirect href="/onboarding" />;
  // Always lands on Home. When the resolver returned 'none' this is a plain redirect
  // rather than one over an open sheet.
  return <Redirect href="/(tabs)" />;
}
