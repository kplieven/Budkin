type Hex = `#${string}`;

/** SVG markup for widget buttons, matching the app's activity glyphs. */
export function activitySvg(kind: 'feeding' | 'diaper' | 'sleep' | 'timer', color: Hex): string {
  switch (kind) {
    case 'feeding':
      return `<svg viewBox="0 0 24 24"><path d="M9 2h6a1.2 1.2 0 0 1 0 2.6H9A1.2 1.2 0 0 1 9 2z" fill="${color}"/><path d="M10 4.4h4v2.2h-4z" fill="${color}"/><path d="M8 8.5c0-1 .8-1.8 1.8-1.8h4.4c1 0 1.8 .8 1.8 1.8V19a3 3 0 0 1-3 3h-2a3 3 0 0 1-3-3z" fill="${color}"/></svg>`;
    case 'diaper':
      return `<svg viewBox="0 0 24 24"><path d="M4.5 6.5h15c.6 0 1 .5 .9 1.1l-1.3 6.6A6.5 6.5 0 0 1 5.9 14.2L4.6 7.6c-.1-.6 .3-1.1 .9-1.1z" fill="${color}"/></svg>`;
    case 'sleep':
      return `<svg viewBox="0 0 24 24"><path d="M12.5 3.2a7.5 7.5 0 1 0 8.3 11.4A6 6 0 0 1 12.5 3.2z" fill="${color}"/></svg>`;
    case 'timer':
      return `<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="7.6" fill="none" stroke="${color}" stroke-width="2.2"/><path d="M12 9.5v4l2.4 1.7" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.5 3h5" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/></svg>`;
  }
}
