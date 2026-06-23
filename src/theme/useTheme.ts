import { useMemo } from 'react';

import { useAppStore } from '@/store/useAppStore';
import { makeTheme, type Theme } from '@/theme/tokens';

/** Resolve the active theme from the global theme mode (default: Night). */
export function useTheme(): Theme {
  const mode = useAppStore((s) => s.themeMode);
  return useMemo(() => makeTheme(mode), [mode]);
}
