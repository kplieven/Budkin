import type { IconName } from '@/components/Icon';

export interface WalkthroughSlide {
  icon: IconName;
  headline: string;
  body: string;
}

/** The first-run walkthrough deck. Headlines are unique (used as React keys). */
export const WALKTHROUGH_SLIDES: WalkthroughSlide[] = [
  {
    icon: 'heart',
    headline: 'Welcome to Budkin',
    body: "A calm, fast way to track your baby's day, from feeds and naps to the milestones in between.",
  },
  {
    icon: 'feeding',
    headline: 'Log in seconds',
    body: 'Tap a tile on Home to record a feed, nap, diaper, bath and more. Smart defaults mean most logs are one or two taps.',
  },
  {
    icon: 'timer',
    headline: 'Timers for naps and feeds',
    body: "Start a live timer and save it as any activity when you're done. On Android there's even a home-screen widget to start a nap without opening the app.",
  },
  {
    icon: 'insights',
    headline: 'See the patterns',
    body: 'History, Insights, Growth and Milestones turn your entries into trends: sleep totals, feeding rhythms, growth curves.',
  },
  {
    icon: 'home',
    headline: 'Yours, offline-first',
    body: 'Budkin works fully offline and keeps data on your device. Connect your own Baby Buddy server to sync across devices, or start now and connect later.',
  },
];
