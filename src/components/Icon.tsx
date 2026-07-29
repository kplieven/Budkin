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
  | 'temperature'
  | 'medication'
  | 'note'
  | 'milestone'
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
  | 'sun'
  | 'edit'
  | 'image'
  | 'camera'
  | 'trash'
  /** the Budkin brand mark, for logo badges rather than for use as a UI icon */
  | 'budkin';

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
    case 'temperature':
      // A thermometer: soft-filled stem + bulb with a mercury-column detail line.
      return (
        <Svg {...common}>
          <Rect x={10} y={3} width={4} height={13} rx={2} fill={color} />
          <Circle cx={12} cy={17.5} r={4} fill={color} />
          <Path d="M12 8.5v7" stroke={detail} strokeWidth={1.6} strokeLinecap="round" />
        </Svg>
      );
    case 'medication':
      // A capsule pill on the diagonal, split into two halves by a divider line.
      return (
        <Svg {...common}>
          <Rect x={3.5} y={9} width={17} height={6} rx={3} fill={color} transform="rotate(45 12 12)" />
          <Path d="M9.7 14.3l4.6-4.6" stroke={detail} strokeWidth={1.5} strokeLinecap="round" />
        </Svg>
      );
    case 'milestone':
      // A pennant flag on a pole: the "milestone reached" marker.
      return (
        <Svg {...common}>
          <Path d="M6 3.4v17.2" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
          <Path d="M7.4 4.6h9.9l-2.7 3.4 2.7 3.4H7.4z" fill={color} />
        </Svg>
      );
    case 'note':
      // A soft-filled note page with a folded corner + a few text lines.
      return (
        <Svg {...common}>
          <Path d="M6 3h8l4 4v12.5A1.5 1.5 0 0 1 16.5 21h-10A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6 3z" fill={color} />
          <Path d="M13.6 3.2V7.2a.8.8 0 0 0 .8.8h3.8" fill={detail} />
          <Path d="M8 11h8M8 14h8M8 17h5" stroke={detail} strokeWidth={1.4} strokeLinecap="round" />
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
    case 'edit':
      // A pencil: stroked, matching the other UI (non-activity) icons.
      return (
        <Svg {...common}>
          <Path
            d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      );
    case 'image':
      return (
        <Svg {...common}>
          <Rect x={3.5} y={5} width={17} height={14} rx={2.5} stroke={color} strokeWidth={strokeWidth} />
          <Circle cx={9} cy={10} r={1.7} stroke={color} strokeWidth={strokeWidth} />
          <Path d="M4.5 17l4.5-4.5L13 16l2.5-2.5L20 18" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );
    case 'camera':
      return (
        <Svg {...common}>
          <Path
            d="M4 8.6A1.6 1.6 0 0 1 5.6 7h2L8.8 5.2A1 1 0 0 1 9.6 4.7h4.8a1 1 0 0 1 .8.5L16.4 7h2A1.6 1.6 0 0 1 20 8.6v8.8A1.6 1.6 0 0 1 18.4 19H5.6A1.6 1.6 0 0 1 4 17.4z"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
          <Circle cx={12} cy={13} r={3.3} stroke={color} strokeWidth={strokeWidth} />
        </Svg>
      );
    case 'trash':
      return (
        <Svg {...common}>
          <Path
            d="M5 7h14M10 7V5.6A1.1 1.1 0 0 1 11.1 4.5h1.8A1.1 1.1 0 0 1 14 5.6V7M6.6 7l.8 11a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5L17.4 7"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path d="M10 11v5M14 11v5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
        </Svg>
      );
    case 'budkin':
      // The Budkin mark: a two-leaf sprout resting in an open cradle.
      //
      // Ported from assets/brand/budkin-mark.svg, which draws on a 100-unit grid
      // wrapped in <g transform="translate(50 50) scale(1.22) translate(-50 -56)">
      // because the artwork is centred on (50,56) rather than (50,50). That
      // wrapper and the 100 -> 24 viewBox change are folded together here into one
      // affine map applied to every coordinate:
      //
      //   x' = 0.2928 * x - 2.64        y' = 0.2928 * y - 4.3968
      //
      // with stroke widths scaled by the same 0.2928 (11 -> 3.22, 7 -> 2.05).
      // Re-derive the numbers that way if the source art changes. Do not nudge
      // them by hand: the two shapes must stay clear of each other, and a stem
      // that reaches the cradle turns the whole mark into an anchor.
      //
      // The source's two leaf fills collapse to `color`, the same flattening
      // Android's monochrome themed-icon layer already does.
      return (
        <Svg {...common}>
          <Path
            d="M3.22 6.14 C3.8 13.76 7.02 17.56 12 17.86 C16.98 17.56 20.2 13.76 20.78 6.14"
            fill="none"
            stroke={color}
            strokeWidth={3.22}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path d="M12 16.68 L12 13.17" stroke={color} strokeWidth={2.05} strokeLinecap="round" />
          <Path d="M12 13.17 C12 9.36 10.24 6.44 7.32 6.73 C6.73 9.95 9.07 12.59 12 13.17 Z" fill={color} />
          <Path d="M12 13.17 C12 9.36 13.76 6.44 16.68 6.73 C17.27 9.95 14.93 12.59 12 13.17 Z" fill={color} />
        </Svg>
      );
  }
}
