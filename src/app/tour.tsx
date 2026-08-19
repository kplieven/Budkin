import { Walkthrough } from '@/features/walkthrough/Walkthrough';
import { backOr } from '@/lib/nav';

/**
 * The feature tour, reachable from Settings > Help. Deliberately does not touch
 * `tutorialSeen`: the setup wizard (welcome.tsx) owns that flag.
 */
export default function Tour() {
  return <Walkthrough onDone={() => backOr()} />;
}
