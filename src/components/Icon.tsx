/**
 * All SVG glyphs used in the app, ported from the design handoff reference's
 * inline SVGs. Activity icons are soft-filled; UI icons are stroked.
 */

import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { useTheme } from '@/theme/useTheme';

export type IconName =
  | 'feeding'
  | 'sleep'
  | 'diaper'
  | 'pumping'
  | 'bath'
  | 'drop'
  | 'solid'
  | 'tummy'
  | 'timer'
  | 'home'
  | 'list'
  | 'heart'
  | 'settings'
  | 'close'
  | 'plus'
  | 'check'
  | 'info'
  | 'clock'
  | 'chevron-down'
  | 'chevron-right'
  | 'chevron-left'
  | 'chart'
  | 'insights'
  | 'moon'
  | 'sun';

interface IconProps {
  name: IconName;
  /** primary stroke/fill color */
  color: string;
  size?: number;
  /** stroke width for stroked (UI) icons */
  strokeWidth?: number;
  /** override the home icon's fill (for active tab tint) */
  fill?: string;
}

export function Icon({ name, color, size = 24, strokeWidth = 2, fill }: IconProps) {
  const t = useTheme();
  // contrast color for the small inner detail lines on filled activity icons
  const detail = t.dark ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.6)';
  const detail2 = t.dark ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.55)';

  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    // Every icon here is either decorative next to labeled text or sits inside a
    // control whose accessible name comes from the wrapping Pressable/IconButton —
    // hide it from AT so labeled controls read once instead of twice.
    importantForAccessibility: 'no-hide-descendants' as const,
    'aria-hidden': true as const,
  };

  switch (name) {
    case 'feeding':
      return (
        <Svg {...common}>
          <Path d="M9 2h6a1.2 1.2 0 0 1 0 2.6H9A1.2 1.2 0 0 1 9 2z" fill={color} />
          <Path d="M10 4.4h4v2.2h-4z" fill={color} />
          <Path
            d="M8 8.5c0-1 .8-1.8 1.8-1.8h4.4c1 0 1.8.8 1.8 1.8V19a3 3 0 0 1-3 3h-2a3 3 0 0 1-3-3z"
            fill={color}
          />
          <Path d="M11.5 11h3M11.5 14h3" stroke={detail} strokeWidth={1.4} strokeLinecap="round" />
        </Svg>
      );
    case 'sleep':
      return (
        <Svg {...common}>
          <Path d="M12.5 3.2a7.5 7.5 0 1 0 8.3 11.4A6 6 0 0 1 12.5 3.2z" fill={color} />
        </Svg>
      );
    case 'diaper':
      return (
        <Svg {...common}>
          <Path
            d="M4.5 6.5h15c.6 0 1 .5.9 1.1l-1.3 6.6A6.5 6.5 0 0 1 5.9 14.2L4.6 7.6c-.1-.6.3-1.1.9-1.1z"
            fill={color}
          />
          <Path d="M9.5 7v3.5M14.5 7v3.5" stroke={detail2} strokeWidth={1.6} strokeLinecap="round" />
        </Svg>
      );
    case 'pumping':
      return (
        <Svg {...common}>
          <Path d="M12 3.2c3.6 4.4 5.6 7.2 5.6 9.8a5.6 5.6 0 0 1-11.2 0c0-2.6 2-5.4 5.6-9.8z" fill={color} />
        </Svg>
      );
    case 'bath':
      // A bathtub: filled basin, a little faucet spout, short legs, and a
      // water-line detail — reads as "bath" without a literal figure.
      return (
        <Svg {...common}>
          <Path d="M7 11V7.4a1.9 1.9 0 0 1 3.6-.8" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
          <Path d="M3.4 11h17.2c.5 0 .9.5.8 1l-.3 1.9A5.2 5.2 0 0 1 16 18.3H8a5.2 5.2 0 0 1-5.1-4.4l-.3-1.9c-.1-.5.3-1 .8-1z" fill={color} />
          <Path d="M6.6 18.3v1.5M17.4 18.3v1.5" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
          <Path d="M8 13.4h8" stroke={detail} strokeWidth={1.4} strokeLinecap="round" />
        </Svg>
      );
    case 'drop':
      return (
        <Svg {...common}>
          <Path d="M12 3.5c3.2 4.1 5 6.8 5 9.3a5 5 0 0 1-10 0c0-2.5 1.8-5.2 5-9.3z" fill={color} />
        </Svg>
      );
    case 'solid':
      // Abstract "stack" — reads as a solid mass without the literal poop shape.
      return (
        <Svg {...common}>
          <Rect x={5} y={13.5} width={14} height={5} rx={2.5} fill={color} />
          <Rect x={7.5} y={7.5} width={9} height={5} rx={2.5} fill={color} />
        </Svg>
      );
    case 'tummy':
      // 4-point sparkle (milestone metaphor): tummy time is where milestones get logged.
      return (
        <Svg {...common}>
          <Path d="M12 2 Q14.4 9.6 22 12 Q14.4 14.4 12 22 Q9.6 14.4 2 12 Q9.6 9.6 12 2 Z" fill={color} />
        </Svg>
      );
    case 'timer':
      return (
        <Svg {...common}>
          <Circle cx={12} cy={13} r={7.6} stroke={color} strokeWidth={2.2} />
          <Path d="M12 9v4l2.5 2" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
          <Path d="M9 2.5h6" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
        </Svg>
      );
    case 'home':
      return (
        <Svg {...common}>
          <Path
            d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z"
            fill={fill ?? 'none'}
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        </Svg>
      );
    case 'list':
      return (
        <Svg {...common}>
          <Path d="M5 6h14M5 12h14M5 18h9" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
        </Svg>
      );
    case 'heart':
      return (
        <Svg {...common}>
          <Path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z" fill={color} />
        </Svg>
      );
    case 'settings':
      return (
        <Svg {...common}>
          <Path d="M4 7h11M4 17h7" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
          <Circle cx={18} cy={7} r={2.6} fill={t.bg} stroke={color} strokeWidth={2.2} />
          <Circle cx={14} cy={17} r={2.6} fill={t.bg} stroke={color} strokeWidth={2.2} />
        </Svg>
      );
    case 'close':
      return (
        <Svg {...common}>
          <Path d="M6 6l12 12M18 6L6 18" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
        </Svg>
      );
    case 'plus':
      return (
        <Svg {...common}>
          <Path d="M12 5v14M5 12h14" stroke={color} strokeWidth={strokeWidth ?? 2.6} strokeLinecap="round" />
        </Svg>
      );
    case 'check':
      return (
        <Svg {...common}>
          <Path d="M5 12.5l4.5 4.5L19 7" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );
    case 'info':
      return (
        <Svg {...common}>
          <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2} />
          <Path d="M12 11v5M12 8h.01" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
        </Svg>
      );
    case 'clock':
      return (
        <Svg {...common}>
          <Circle cx={12} cy={12} r={8.5} stroke={color} strokeWidth={2} />
          <Path d="M12 8v4l2.5 1.6" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );
    case 'chevron-down':
      return (
        <Svg {...common}>
          <Path d="M7 10l5 5 5-5" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );
    case 'chevron-right':
      return (
        <Svg {...common}>
          <Path d="M9 6l6 6-6 6" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );
    case 'chevron-left':
      return (
        <Svg {...common}>
          <Path d="M15 6l-6 6 6 6" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );
    case 'chart':
      return (
        <Svg {...common}>
          <Path d="M5 4v15h15" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
          <Path d="M8 14l3-3 2.5 2.5L19 8" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );
    case 'insights':
      // a rising three-bar chart, distinct from `chart`
      return (
        <Svg {...common}>
          <Rect x={4} y={12} width={3.4} height={8} rx={1.4} fill={color} />
          <Rect x={10.3} y={7} width={3.4} height={13} rx={1.4} fill={color} />
          <Rect x={16.6} y={9.5} width={3.4} height={10.5} rx={1.4} fill={color} />
        </Svg>
      );
    case 'moon':
      return (
        <Svg {...common}>
          <Path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z" stroke={color} strokeWidth={2} strokeLinejoin="round" />
        </Svg>
      );
    case 'sun':
      return (
        <Svg {...common}>
          <Circle cx={12} cy={12} r={4.2} stroke={color} strokeWidth={2} />
          <Path
            d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
          />
        </Svg>
      );
  }
}
