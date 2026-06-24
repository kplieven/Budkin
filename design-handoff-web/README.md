# Handoff: Baby Buddy — Web (Tablet / Laptop)

## Overview
Baby Buddy is a warm, dark-first client for a self-hosted [Baby Buddy](https://github.com/babybuddy/babybuddy) server. It lets a caregiver log infant activities — feeding, sleep, diaper, pumping, tummy time — in 1–3 clicks, including at 3am while holding a baby.

This package covers the **tablet / laptop web** adaptation. The companion mobile app (iOS/Android) lives in a separate handoff (`design_handoff_baby_buddy`). The two share an identical design language, color system, and the "never type a time" entry component; only the layout ergonomics differ.

The core design philosophy, translated to a large landscape screen:
- **Thumb-zone → glanceable command center.** A persistent left sidebar replaces the mobile bottom tab bar. The whole day fits on one screen — status, six large log tiles, and a live activity rail — so the common log needs **no scrolling**.
- **Bottom sheet → centered modal.** The same chip-based time-entry component, presented as a mouse-appropriate dialog with explicit Cancel + Save.
- **Dark-first.** Night mode is the default (a tablet on a nightstand / kitchen counter); a Daylight theme is one click away.

## About the Design Files
The files in this bundle are **design references created in HTML** — a working prototype demonstrating intended look, layout, and behavior. **They are not production code to copy directly.**

The task is to **recreate this design in the target codebase's existing environment** (React, Vue, Svelte, etc.), using its established component patterns, styling approach, and libraries. If no front-end environment exists yet, choose the most appropriate framework for the project and implement the design there.

The prototype is authored as a "Design Component" (`.dc.html`) — a small bespoke runtime (`support.js`) renders an inline-styled template driven by a `Component` logic class. **Do not port `support.js` or the `.dc.html` format.** Read them only to understand structure, state, and styling values, all of which are documented below.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, radii, and interactions are all specified. Recreate the UI pixel-accurately using the codebase's existing libraries. All exact values are in [Design Tokens](#design-tokens).

## Target & Layout Frame
- Designed at **1440 × 940**; intended for tablet landscape and laptop (≥ ~1180px wide).
- The layout is fluid (CSS fl/grid). The two reflowing grids (status strip, log tiles) use `repeat(auto-fit, minmax(…, 1fr))` so they wrap gracefully on narrower tablets. The timeline rail is a fixed 372px column.
- Full-viewport app: `height: 100vh`, `min-height: 640px`, `overflow: hidden`. Internal regions scroll independently.

---

## Global Shell

The app is a **3-region flex row**: Sidebar (fixed) · Main (fluid) · [overlays].

### Sidebar
- Width **248px**, `flex: none`, full height, `padding: 26px 18px 22px`, `border-right: 1px solid {line}`.
- Background is a slightly darker/lighter shade than the main bg: **dark `#13100D`**, **light `#FBF4EB`**.
- **Top:** logo lockup — a 38×38 rounded-12px square in `{primary}` with a white heart glyph and `box-shadow: 0 6px 18px rgba(primary, .4)`, next to wordmark "Baby Buddy" (19px / 800 / -0.4px).
- **Nav** (vertical, gap 4px). Each item: `display:flex; align-items:center; gap:12px; padding:11px 13px; border-radius:14px`. 22×22 icon + label (15px, weight 600 inactive / 700 active).
  - Active item: background `rgba(primary, .14 dark / .10 light)`, `border: 1.5px solid rgba(primary, .32)`, label color `{text}`, icon color `{primary}`.
  - Inactive: transparent bg + border, label/icon color `{dim}` / `{faint}`.
  - Items: **Dashboard, History, Timers, Settings**.
- **Bottom (pushed down by `flex:1` spacer):** child card — `padding:11px 12px; border-radius:16px; background:{bg2}; border:1.5px solid {line}`. Contains a 40×40 rounded-13px avatar (child's initial, tinted with the child's color), name (14.5px/700) + age (12px/500/{dim}), and an up/down chevron. Click opens the Child Switcher.

### Main region
- `flex:1; display:flex; flex-direction:column; overflow:hidden`.
- **Top bar** (`flex:none; padding:24px 32px 18px; display:flex; justify-content:space-between; align-items:center`):
  - Left: greeting eyebrow (13px/700/{faint}/uppercase/1px tracking — time-based: "Good morning" <12h, "Good afternoon" <17h, "Good evening" <22h, "Late night" / "Still up" <5h) above the screen title (26px/800/-0.6px). Dashboard title is `"{ChildFirstName}'s day"`; others are "History" / "Timers" / "Settings".
  - Right: offline pill (only when offline), current clock (14.5px/700/{dim}, tabular-nums), and a 42×42 theme-toggle icon button (moon in dark / sun in light).

---

## Screens / Views

### 1. Dashboard (default)
Two columns inside the main region: a fluid **left content column** and the fixed **timeline rail** (rail hidden when `showRail` is false).

**Left column** (`flex:1; overflow-y:auto; padding:6px 32px 32px; display:flex; flex-direction:column; gap:18px`):

1. **Status strip** — `display:grid; grid-template-columns:repeat(auto-fit, minmax(150px,1fr)); gap:14px`. Three cards:
   - Card: `background:{bg2}; border:1.5px solid {line}; border-radius:20px; padding:18px 20px 20px`. Light mode adds `box-shadow:0 1px 2px rgba(120,86,52,.05)`.
   - Contents: a colored 9px dot + uppercase label (12px/700/{dim}/0.4px) on one row; big value (30px/800/-0.8px) below; sub-line (13px/500/{faint}).
   - The three: **Last fed** (feed color dot, e.g. "1h18m ago" / "right breast · 18 min"), **Sleep** (sleep color, "27 min · napping now" when a sleep timer runs, else "2h 38m · total today"), **Diaper** (diaper color, e.g. "41m ago · wet").
2. **Running-timer banner** (only when ≥1 timer active) — `display:flex; align-items:center; gap:16px; background:{bg2}; border:1.5px solid rgba(timerColor,.4); border-radius:22px; padding:18px 22px; cursor:pointer`. Pulsing 12px dot (timer's activity color) + label "{Activity} running" (12.5px/700/{dim}/uppercase) over a large elapsed readout (30px/800/-1px, tabular-nums, in the activity color) + a "Stop & save" button (`padding:12px 20px; border-radius:14px; background:{timerColor}; color:#1A120B (dark)/#fff (light); 800/14.5px`). Banner click → Timers; button click → stop & save the running timer immediately.
3. **"Log activity"** eyebrow (14px/800/{faint}/uppercase/1px).
4. **Log tiles grid** — `display:grid; grid-template-columns:repeat(auto-fit, minmax(158px,1fr)); gap:14px`. Six tiles:
   - Tile: `background:{bg2}; border:1.5px solid {line}; border-radius:22px; padding:20px 20px 22px; min-height:132px; display:flex; flex-direction:column; cursor:pointer`. `transition: transform .14s, border-color .14s, box-shadow .14s`.
   - **Hover:** `transform: translateY(-3px); border-color: rgba(activityColor,.55); box-shadow: 0 14px 34px rgba(0,0,0,.45) (dark) / 0 14px 30px rgba(120,86,52,.14) (light)`.
   - Layout: 54×54 rounded-16px icon chip tinted `rgba(activityColor,.16)` holding a 28px activity icon; then label (18px/700/-0.3px, `margin-top:14px`); then hint (13px/500/{dim}).
   - Tiles 1–5: **Feeding, Sleep, Diaper, Pumping, Tummy time** — clicking opens the Log Modal for that activity. Hints show smart status (e.g. feeding "1h18m ago · auto-alternates", sleep "napping 27 min").
   - Tile 6: **Start timer** — a dashed variant: `background:rgba(primary,.10 dark/.08 light); border:1.5px dashed rgba(primary,.5)`. Icon chip tinted with primary, 28px clock icon. Clicking starts a generic feeding timer and navigates to Timers.

**Timeline rail** (`width:372px; flex:none; border-left:1px solid {line}; padding:6px 24px 24px; background:#13100D dark / #FBF4EB light; display:flex; flex-direction:column`):
- Header row: "Recent activity" (16px/800/-0.3px) + "All" link (13px/700/{primary}) → History.
- Scroll area with day groups (see [Activity Row](#activity-row-shared)). Group label is 11.5px/700/{faint}/uppercase.

### 2. History
- Full-width scroll page (`padding:6px 32px 32px`), content capped at `max-width:760px`.
- Same day-grouped entries as the rail, but laid out **two-up**: `display:grid; grid-template-columns:1fr 1fr; gap:11px`, with slightly larger type (title 15.5px, time 14px). Group label 13px/800/{faint}/uppercase.

### 3. Timers
- Scroll page. Cards in `display:grid; grid-template-columns:repeat(auto-fill, minmax(320px,1fr)); gap:16px; max-width:760px`.
- **Timer card:** `background:{bg2}; border:1.5px solid {line}; border-radius:24px; padding:24px; box-shadow:{shadow}`.
  - Header row: 40×40 icon chip (tinted save-as activity color) + name (16px/700) & "started {ago}" (12.5px/500/{dim}) + a pulsing 11px dot.
  - Giant elapsed clock: **58px / 800 / -2px**, tabular-nums, centered, in the activity color. Format `m:ss` (or `h:mm:ss` past an hour).
  - Action row (`margin-top:20px; gap:10px`): **Discard** (`flex:1; height:52; border-radius:15; background:{bg3}; color:{dim}; 700/15px`) and **Stop & save as {activity}** (`flex:2.2; height:52; border-radius:15; background:{activityColor}; color:#1A120B/#fff; 800/14.5px`).
  - "Save as" chip row underneath (`margin-top:11px; centered; wrap`): chips for Feeding / Sleep / Pumping / Tummy — selecting changes which activity the timer will be saved as (recolors the card). Chip = small variant (`padding:6px 11px; font-size:12.5px; border-radius:10px`).
- **Empty state:** centered 76×76 rounded-22px {bg3} art tile with a clock icon, "No timers running" (19px/700), and helper copy (14px/{dim}, max-width 320px).

### 4. Settings
- Scroll page, `max-width:560px`.
- Grouped rows. Group = `background:{bg2}; border:1.5px solid {line}; border-radius:18px; overflow:hidden`. Row = `padding:16px 18px; display:flex; align-items:center` with a 1px bottom divider except the last.
- **Appearance:** "Night mode" toggle (bound to theme) and "Simulate offline" toggle. Eyebrow label 13px/800/{faint}/uppercase.
- **Server:** static "babybuddy.home.lan / Connected · token ••••3f9a" row with a green status dot, then a "Reconnect / change server" action row in {primary}.
- **Toggle switch:** track 50×30 rounded-99px (`{primary}` on / `{bg4}` off), knob 24×24 white circle, `top:3; left: 23 on / 3 off`, `transition:.15s`, knob `box-shadow:0 1px 3px rgba(0,0,0,.3)`.

---

## Shared Components

### Activity Row (shared)
Used in the rail and History. `display:flex; align-items:center; gap:12px; padding:12px 14px; background:{bg2}; border:1.5px solid {line}; border-radius:16px`.
- 40×40 rounded-12px icon chip, tinted `rgba(activityColor,.16)`, holding a 21px activity icon.
- Middle: title (14.5px/700/-0.2px) + detail line (12.5px/500/{dim}, ellipsis). Detail examples: Feeding → "Breast milk · right breast · 18 min"; Sleep → "Nap · 1h 58m"; Diaper → "Wet" / "Wet · Solid · yellow"; Pumping → "90ml · 17 min"; Tummy → "8 min · Lifted head".
- Right: time (13px/700, tabular-nums, e.g. "10:38 AM") + relative ago (11.5px/500/{faint}).
- Entries are sorted newest-first and grouped by day ("Today" / "Yesterday" / locale date).

### Log Modal (the heart of fast logging)
Opened by the five activity tiles. Centered dialog: `width:min(560px, calc(100% - 48px)); max-height:88%; background:{bg}; border-radius:26px; border:1px solid {line}; box-shadow:{shadow}`. Animates in with `bbwPop` (.22s `cubic-bezier(.2,.8,.2,1)`, opacity + translateY(10px)→0 + scale .98→1). A `rgba(0,0,0,.5)` scrim with 2px backdrop blur sits behind (`bbwFade` .2s); clicking it closes.

**Header** (`padding:22px 24px 16px; border-bottom:1px solid {line}`): 46×46 icon chip (tinted activity color) + title "Log {activity}" (21px/800/-0.4px) & subtitle "for {ChildFirstName}" (13px/500/{dim}) + a 42×42 close (×) icon button.

**Body** (`padding:20px 24px 8px; overflow-y:auto`). Activity-specific fields first, then the time-entry block, then tags.

Field label style: 13px/700/{dim}, `margin-bottom:10px`.

- **Sleep:** two shortcut tiles first — "Woke up now / ended this nap" (tinted) and "Still sleeping / start a live timer" ({bg3}). Each `flex:1; padding:14px 16px; border-radius:16px`.
- **Feeding:** "Type" chip group (Breast milk / Formula / Fortified / Solid food) → "Method" chip group (Left / Right / Both / Bottle / Parent fed / Self fed); a method hint "↔ auto-alternating" appears in {primary} when Left/Right is selected. "Amount (optional)" stepper appears only when type ≠ breast or method = bottle.
- **Diaper:** "Contents" — two large toggles, **Wet 💧** and **Solid 💩** (`flex:1; padding:15px 0; border-radius:16px; border:2px solid {activityColor} when on, else {line}; bg tinted when on`). If Solid is on, a "Color" chip group appears (Black / Brown / Green / Yellow, each with a swatch dot).
- **Pumping:** "Amount" stepper.
- **Tummy time:** optional "Milestone" text field (placeholder "e.g. lifted head, rolled over…").

**Chip** (the universal selectable pill): `padding:10px 15px; border-radius:13px; font-size:14px; font-weight:700; display:inline-flex; align-items:center; gap:7px; white-space:nowrap; transition:all .12s`.
- Selected: `background:{activityColor}; color:#1A120B (dark)/#fff (light); border:1.5px solid {activityColor}`.
- Unselected: `background:{bg3}; color:{text}; border:1.5px solid {line}`.

**Stepper:** `display:flex; align-items:center; gap:12px; background:{bg2}; border:1.5px solid {line}; border-radius:16px; padding:8px`. −/+ buttons are 56×50 rounded-12 {bg3} tiles (26px). Value shows 26px/800 number + "ml" suffix (15px/{dim}). Steps by 10, floored at 0.

#### Time-entry block ("never type a time")
The reusable core. `background:{bg2}; border:1.5px solid {line}; border-radius:20px; padding:18px`. Two shapes:
- **Interval** (feeding, sleep, pumping, tummy): a result readout ("3:42 PM → 4:00 PM", "lasted 18 min"); when not live: "Quick — ended just now" presets (Last 15m / 30m / 45m), an "Ended" row (Now / 15m ago / 30m ago / 1h ago), a "Lasted" row (sleep: 20/45/90/120 min, else 10/20/30/45). Plus **Smart anchors** ("Since last feed (1h18m)", "Since they woke (…)") and a dashed "▶ Start live timer" chip. When live: a live note with a pulsing dot, "started {time}, still going", and a "Set end" link.
- **Point-in-time** (diaper): a "When" row of ago chips (Now / 5m / 15m / 30m / 1h / 2h) + Smart anchors ("When last feed ended", "When they woke").
- Both shapes end with a **±5m nudge** row (`border-top:1px solid {line}; padding-top:14px`): a label ("Nudge" / "Fine-tune time") + "−5m" and "+5m" buttons (`padding:8px 14px; border-radius:11px; background:{bg3}; border:1.5px solid {line}; 13.5px/700`).
- Section sub-labels: 12px/700/{faint}/uppercase/0.5px.

**Tags:** chip group (Left side / Cluster / Spit-up / Fussy / Sleepy), multi-select, slightly larger padding.

**Save bar** (`padding:16px 24px 20px; border-top:1px solid {line}; display:flex; gap:12px`): **Cancel** (`width:120; height:54; border-radius:16; background:{bg3}; color:{dim}; 700/16px`) + **Save {activity}** (`flex:1; height:54; border-radius:16; background:{activityColor}; color:#1A120B/#fff; 800/17px; box-shadow:0 8px 22px rgba(activityColor,.35)`). Label becomes "Start live timer" when the live option is chosen.

### Child Switcher
Anchored popover at `left:24px; bottom:22px; width:340px; background:{bg}; border-radius:22px; box-shadow:{shadow}; padding:18px 16px 16px` (`bbwPop` animation), behind a full scrim. Heading "Who are you logging for?" (18px/800). One selectable row per child (44×44 tinted avatar, name 16px/700 + age, a check in {primary} when selected; selected row tinted with primary). Plus a dashed "+ Add a child" row.

### Toast
`position:absolute; bottom:30px; left:50%; transform:translateX(-50%)`. Dark pill on light (`#F3EBE1` bg / `#3A2E24` text) and vice-versa, `padding:13px 22px; border-radius:14px; 14.5px/700; box-shadow:0 12px 36px rgba(0,0,0,.4)`. Auto-dismisses after 2.4s (`bbwToast` keyframes). Messages: "Saved", "Saved · queued offline", "Timer started", "Live timer started", "Saved as {activity}".

### Offline banner / pill
When offline: a pill in the top bar — `display:flex; gap:8px; padding:8px 13px; border-radius:12px; background:#3A2E18 (dark)/#FBEFD4 (light); border:1px solid rgba(226,181,84,.5)`, amber dot + "Offline · 2 entries queued". (Mobile uses a full-width banner; web uses the compact pill.)

---

## Interactions & Behavior
- **Navigation:** sidebar items switch the main `screen` (dashboard / history / timers / settings). No routing library assumed — map to routes as appropriate.
- **Logging:** tile → modal → choose options (all chip/stepper, never a keyboard time) → Save. Saving prepends an entry, closes the modal, and fires a toast. Feeding saves remember last type/method (so the next feed auto-alternates breast side).
- **Live timers:** choosing "Start live timer" in the modal (or the Start-timer tile, or "Still sleeping") creates a running timer instead of an entry. The Dashboard banner and Timers screen show elapsed time ticking every second. "Stop & save" converts it to a completed entry.
- **Theme toggle:** top-bar button and Settings switch flip dark/daylight instantly across all tokens.
- **Smart defaults on open:** feeding duration 18m / sleep 90m / pumping 15m; feeding pre-selects last type and the *opposite* breast; sleep nap-vs-night inferred from current hour (nap if 7am–7pm).
- **Animations:** `bbwPop` modal/popover entrance (.22s ease-out-back), `bbwFade` scrim, `bbwPulse` 1.6s on live dots, `bbwToast` 2.4s, tile hover lift .14s. Honor `prefers-reduced-motion` in production.
- **Responsive:** status & log grids reflow via `auto-fit minmax`. Below ~1180px consider collapsing the rail (the prototype exposes a `showRail` flag).

## State Management
- `theme` ('dark' | 'light'), `offline` (bool), `showRail` (bool) — view-level prefs.
- `screen` — active nav route.
- `selectedChildId`, `children[]` (id, first, last, birth, color).
- `entries[]` — logged activities. Shapes: interval (`start`, `end`) for feeding/sleep/pumping/tummy; point (`time`) for diaper. Plus per-type fields (feedType, method, amount, wet, solid, color, nap, milestone, tags).
- `timers[]` — running timers (id, activity, name, start, saveAs).
- `sheet` — `{ type }` of the open modal (null when closed).
- `te` — transient working state for the time-entry component (shape, durationMin, endedAgoMin, agoMin, live, startAgoMin, nudge, plus activity fields).
- `toast`, `showChildSwitcher`.
- A 1s interval drives `now` for live elapsed displays.

### Data / API
Backend is a self-hosted Baby Buddy server (REST API, token auth). In production, replace the in-memory `entries`/`timers`/`children` with the server's `/api/` resources (children, feedings, sleep, changes/diapers, pumping, tummy-time, timers, tags). Saves should optimistically update locally and queue when offline (the "queued" toast/pill reflects this).

## Design Tokens

### Theme — Night (default / dark)
| Token | Value | Use |
|---|---|---|
| bg | `#16110E` | app background |
| bg2 | `#221B16` | cards / surfaces |
| bg3 | `#2C231C` | chips / steppers / inset |
| bg4 | `#3A2E25` | toggle track (off) |
| sidebar/rail bg | `#13100D` | sidebar & rail panels |
| line | `rgba(255,255,255,0.07)` | hairline borders/dividers |
| line2 | `rgba(255,255,255,0.13)` | stronger borders |
| text | `#F3EBE1` | primary text |
| dim | `#B4A492` | secondary text |
| faint | `#7C6F61` | tertiary / eyebrows |
| primary | `#EC9A66` | brand / accents |
| onPrimary | `#2A170B` | text on primary |
| shadow | `0 18px 50px rgba(0,0,0,0.55)` | elevated surfaces |

### Theme — Daylight (light)
| Token | Value |
|---|---|
| bg | `#F2E7DA` |
| bg2 | `#FFFCF8` |
| bg3 | `#F4EADD` |
| bg4 | `#E8DAC8` |
| sidebar/rail bg | `#FBF4EB` |
| line | `rgba(58,46,36,0.10)` |
| line2 | `rgba(58,46,36,0.18)` |
| text | `#3A2E24` |
| dim | `#7C6C5C` |
| faint | `#A89684` |
| primary | `#D17A45` |
| onPrimary | `#FFFFFF` |
| shadow | `0 18px 46px rgba(120,86,52,0.18)` |

> Note: `color: #1A120B` is used for text/icons sitting on a saturated activity color in dark mode; `#fff` in light mode.

### Activity colors (dark / light)
| Activity | Dark | Light | Shape |
|---|---|---|---|
| Feeding | `#F0A878` | `#D9854B` | interval |
| Sleep | `#A99EDC` | `#7E6FC9` | interval |
| Diaper | `#6FC0A6` | `#3E9D80` | point-in-time |
| Pumping | `#E6BE5E` | `#C79A36` | interval |
| Tummy time | `#EA958A` | `#D06E62` | interval |

Tints used throughout: icon chips & toggles `rgba(activityColor, .16)`; hover border `rgba(activityColor, .55)`; save-button glow `rgba(activityColor, .35)`.

Diaper solid-color swatches: black `#3A3330`, brown `#7A5230`, green `#6F8F4A`, yellow `#D8B04A`. Amber/offline accent `#E2B554`. Green "connected" dot `#5FB39B`.

### Typography
- Family: **Figtree** (Google Fonts), weights 400/500/600/700/800. Fallback `system-ui, sans-serif`. `-webkit-font-smoothing: antialiased`.
- Scale (px / weight / letter-spacing):
  - Screen title 26 / 800 / -0.6 · Wordmark 19 / 800 / -0.4
  - Rail header 16 / 800 / -0.3 · Modal title 21 / 800 / -0.4
  - Status value 30 / 800 / -0.8 · Timer banner elapsed 30 / 800 / -1 · Timer card elapsed 58 / 800 / -2 (tabular-nums)
  - Tile label 18 / 700 / -0.3 · Row/setting body 15–16 / 600–700
  - Chip 14 / 700 · Body/detail 13–14.5 / 500–700
  - Eyebrows/labels 11.5–14 / 700–800 / uppercase, ~0.4–1px tracking
- Use `font-variant-numeric: tabular-nums` for all clocks, elapsed timers, and amounts.

### Spacing, radius, shadow
- Spacing rhythm: 8 / 10–14 (gaps) / 18 (column gap) / 24–32 (page padding).
- Radii: chips/nudges 11–13 · steppers/toggles 16 · cards/surfaces 18–22 · rows 16 · timer cards & modal 24–26 · pills 99.
- Borders: 1px hairlines for dividers; 1.5px for card/chip outlines; 2px for active diaper toggles.
- Shadows: see theme `shadow` token; light mode cards add `0 1px 2px rgba(120,86,52,.05)`; tile hover and toast/popover use the larger values noted inline above.

## Assets
- **Icons:** all UI and activity icons are inline SVG (no icon font, no image files) — bottle (feeding), crescent (sleep), diaper, droplet (pumping), star (tummy), clock (timer), plus nav glyphs (home, list, clock, gear) and a heart logo. Recreate with the codebase's icon system or copy the SVG paths from the prototype's `icon()` / `navIcon()` methods.
- **Emoji:** 💧 and 💩 are used intentionally on the diaper Wet/Solid toggles.
- **Font:** Figtree via Google Fonts (`https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800`).
- No raster images or brand assets.

## Files
- `Baby Buddy Web.dc.html` — the full web prototype (template + `Component` logic class with all state, formatting helpers, and exact style objects). **Primary reference.**
- `support.js` — the prototype runtime. Reference only; do not port.
- Companion mobile handoff: `design_handoff_baby_buddy/` (iOS/Android) — shares the same tokens and time-entry component.
