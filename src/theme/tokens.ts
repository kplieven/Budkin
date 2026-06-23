/**
 * Design tokens for Baby Buddy, ported exactly from the design handoff.
 * Two themes: Night (default) and Daylight. All hex/rgba values match the
 * handoff's Design Tokens table and the reference implementation's theme().
 */

export type ThemeMode = 'dark' | 'light';

export type ActivityKey = 'feeding' | 'sleep' | 'diaper' | 'pumping' | 'tummy';

export interface Palette {
  /** true for Night mode */
  dark: boolean;
  bg: string;
  /** card / input surface (handoff "surface", reference bg2) */
  surface: string;
  /** chip / inset surface (handoff "chip", reference bg3) */
  chip: string;
  /** elevated surface (handoff "elevated", reference bg4) */
  elevated: string;
  line: string;
  line2: string;
  text: string;
  dim: string;
  faint: string;
  primary: string;
  onPrimary: string;
  /** Text color drawn on top of a solid activity color (selected chips, save bar). */
  onActivity: string;
  /** CSS box-shadow string (React Native >= 0.81 supports the boxShadow style). */
  shadow: string;
}

export interface Theme extends Palette {
  mode: ThemeMode;
  activity: Record<ActivityKey, string>;
}

const NIGHT: Palette = {
  dark: true,
  bg: '#16110E',
  surface: '#221B16',
  chip: '#2C231C',
  elevated: '#3A2E25',
  line: 'rgba(255,255,255,0.07)',
  line2: 'rgba(255,255,255,0.13)',
  text: '#F3EBE1',
  dim: '#B4A492',
  faint: '#7C6F61',
  primary: '#EC9A66',
  onPrimary: '#2A170B',
  onActivity: '#1A120B',
  shadow: '0px 12px 40px rgba(0,0,0,0.5)',
};

const DAYLIGHT: Palette = {
  dark: false,
  bg: '#F6EDE3',
  surface: '#FFFCF8',
  chip: '#F1E6D8',
  elevated: '#E8DAC8',
  line: 'rgba(58,46,36,0.10)',
  line2: 'rgba(58,46,36,0.18)',
  text: '#3A2E24',
  dim: '#7C6C5C',
  faint: '#A89684',
  primary: '#D17A45',
  onPrimary: '#FFFFFF',
  onActivity: '#FFFFFF',
  shadow: '0px 12px 36px rgba(120,86,52,0.16)',
};

const ACTIVITY_NIGHT: Record<ActivityKey, string> = {
  feeding: '#F0A878',
  sleep: '#A99EDC',
  diaper: '#6FC0A6',
  pumping: '#E6BE5E',
  tummy: '#EA958A',
};

const ACTIVITY_DAYLIGHT: Record<ActivityKey, string> = {
  feeding: '#D9854B',
  sleep: '#7E6FC9',
  diaper: '#3E9D80',
  pumping: '#C79A36',
  tummy: '#D06E62',
};

/** Diaper "solid" stool color swatches — identical in both themes. */
export const SOLID_COLORS: Record<'black' | 'brown' | 'green' | 'yellow', string> = {
  black: '#3A3330',
  brown: '#7A5230',
  green: '#6F8F4A',
  yellow: '#D8B04A',
};

export function makeTheme(mode: ThemeMode): Theme {
  const palette = mode === 'dark' ? NIGHT : DAYLIGHT;
  return {
    ...palette,
    mode,
    activity: mode === 'dark' ? ACTIVITY_NIGHT : ACTIVITY_DAYLIGHT,
  };
}

/** Activity tint alpha used for icon-wrap / card-tint backgrounds (handoff: 16%). */
export const ACTIVITY_TINT_ALPHA = 0.16;
