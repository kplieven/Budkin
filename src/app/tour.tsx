import { Walkthrough } from '@/features/walkthrough/Walkthrough';
import { backOr } from '@/lib/nav';

/**
 * The feature tour, reachable from Settings > Help. First run becomes a setup
 * wizard (src/app/welcome.tsx), so this route only ever opens from inside the app
 * and dismissing returns the way the user came. It deliberately does not touch
 * `tutorialSeen`: the setup flow owns that flag.
 */
export default function Tour() {
  return <Walkthrough onDone={() => backOr()} />;
}
