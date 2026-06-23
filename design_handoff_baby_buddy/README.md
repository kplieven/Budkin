# Handoff: Baby Buddy — One-Handed Baby Activity Tracker

## Overview
Baby Buddy is a warm, friendly **cross-platform mobile app (iOS + Android)** that acts as a client for a self-hosted [Baby Buddy](https://github.com/babybuddy/babybuddy) server's REST API. It is built for one core job: **let a sleep-deprived parent log a common baby activity in 1–3 taps, one-handed, in the dark.** Speed and large tap targets beat density everywhere there is a tradeoff.

The signature feature is a **single reusable time-entry component** used everywhere a time is set — it replaces manual time typing (the pain point of the Baby Buddy website) with relative "ago" chips, duration presets, smart event-anchored shortcuts, and back-datable live timers.

v1 scope (high-frequency logging only): **Feeding, Sleep, Diaper change, Pumping, Tummy time, Timers.**

## About the Design Files
The files in this bundle are **design references created in HTML/JS** — interactive prototypes that demonstrate the intended look, layout, and behavior. They are **not production code to copy directly.**

The task is to **recreate these designs in the target codebase's environment**, using its established patterns and libraries. Recommended for a real cross-platform build: **React Native (+ Expo)** or **Flutter**, both of which respect each platform's navigation conventions. If you start fresh, pick whichever your team knows best — the design is platform-neutral by intent (see "Platform conventions" below). The HTML prototype uses a small React-like class component with inline styles; treat that as a spec, not an architecture.

> The prototype runtime ("Design Components" / `support.js`) is a prototyping harness — **ignore it** when implementing. Only the visual design, copy, tokens, and interaction logic described below matter.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, radii, iconography, copy, and interaction logic are all specified below and present in the prototype. Recreate the UI to match, substituting your codebase's component primitives. Exact hex/spacing values are in **Design Tokens**.

---

## Platform conventions (iOS + Android)
The app is **designed once in a neutral style** and shown inside both an iOS and an Android device frame. The chrome (status bar, home indicator vs. gesture pill) comes from the OS; the app content is identical. When implementing natively, keep these parity rules:
- **Bottom tab bar** (Home · Timers · History) works for both platforms — keep it.
- **Bottom sheets** slide up from the bottom on both. Use the platform-native sheet where available.
- **Safe-area insets**: top inset ~52px on iOS (Dynamic Island), ~14px on Android; bottom inset ~26px iOS / ~16px Android. Use real safe-area APIs in production.
- Respect platform back-gesture / system back on Android.

---

## Screens / Views

### 1. Onboarding / Connect
- **Purpose**: Connect to the user's self-hosted server with a URL + pasted API **token** (never username/password).
- **Layout**: Single scroll column, 24px horizontal padding. Top: 60×60 rounded-square logo (radius 19, primary fill, heart glyph). Heading (28/800, two lines). Body paragraph (15/500, dim). Two labeled fields. A help card. A full-width primary button. A footer link.
- **Components**:
  - **Logo tile**: 60×60, radius 19, bg `primary`, glyph white heart, shadow `0 8px 24px rgba(primary,.4)`.
  - **Heading**: "Connect your Baby Buddy server", 28px/800, letter-spacing −0.6px.
  - **Body**: "Baby Buddy runs on your own server. Paste its address and an access token to start logging." 15px/500, color `dim`, line-height 1.5.
  - **Field label**: "SERVER URL" / "API TOKEN", 13/700, color `dim`, 8px bottom margin.
  - **Input**: height 54, radius 15, bg `surface`, border 1.5px `line2`, padding 0 16px, 15.5px/500. Placeholder text in `faint`.
  - **Help card**: bg `primary @ 8–10% alpha`, border 1px `primary @ 30%`, radius 16, padding 16. Title row: info-circle icon (18px, primary) + "Where do I find my token?" (14/700, primary). Body: "On your server, open **Settings → User → API**. Copy the long token string and paste it above. Never your password." (13.5/dim, the path bold in `text`).
  - **Primary button**: height 56, radius 17, bg `primary`, text `onPrimary` 17/800, shadow `0 8px 22px rgba(primary,.35)`. Label "Connect".
  - **Footer**: "Don't have a server? **Learn how to host one**" centered, 13.5/faint, link in primary.
- **States**: This is the default screen when not connected. Loading = button shows spinner; Error = inline message under the token field ("Couldn't reach server / Invalid token"). 

### 2. Home / Dashboard — *the heart of one-handed use*
- **Purpose**: At-a-glance status + big primary actions to log activities and timers.
- **Layout**: Scroll column, 18px horizontal padding, top padding = safe-top + 8. Sections top→bottom: child header → 3-up status strip → live-timer card (conditional) → "Log activity" section label → 2-column activity grid. Bottom tab bar is fixed below the scroll area.
- **Components**:
  - **Child header**: 50×50 avatar tile (radius 16, bg `childColor @ ~30% alpha`, initial in `childColor`, 21/800) + name (21/700, truncates with ellipsis) + chevron-down (switcher affordance) + age sub-line (13.5/500, `dim`). Trailing 40×40 settings icon button (radius 13, bg `chip`, border `line`). Tapping name/avatar opens the **Child Switcher**.
  - **Status strip**: `grid-template-columns: 1fr 1fr 1fr; gap 9px`. Each card: bg `surface`, border 1.5px `line`, radius 18, padding 13/13/14. Contents: a 9px color dot + UPPERCASE label (11.5/600, `dim`), value (19/700, −0.4px), sub (12/500, `faint`). The three are **Fed** (time since last feeding end + side), **Sleep** (live nap duration if napping, else today total), **Diaper** (time since last + wet/solid).
  - **Live-timer card** (only if a timer runs): bg `surface`, border 1.5px `line`, radius 20, padding 15/17. Pulsing dot in the timer's activity color + "‹ACTIVITY› RUNNING" (12/600 caps, dim) + elapsed (26/800, tabular-nums, activity color) + "View ›". Tapping → Timers screen.
  - **Section label row**: "LOG ACTIVITY" (13/700 caps, `faint`, letter-spacing .8px) + "Timers" link (13.5/600, primary) on the right.
  - **Activity grid**: `2 columns, gap 11px`. Six tiles: Feeding, Sleep, Diaper, Pumping, Tummy time, and **Start timer**. Each activity tile: bg `surface`, border 1.5px `line`, radius 22, padding 15/15/16, min-height 104, flex column. Inside: 46×46 icon wrap (radius 14, bg `activityColor @ 16% alpha`, filled icon 25px in activity color), title (17/700, −0.2px), hint sub (12.5/500, `dim` — e.g. "1h18m ago" / "napping 27 min" / "Tap to log"). **Start timer** tile uses a dashed `primary @ 50%` border, `primary` tint bg, clock icon, "Save as any activity" hint.
- **States**: Empty = status cards show "—"; hints show "Tap to log". Offline = banner overlay (see Interactions). Loading = skeleton cards.

### 3. Quick-Log Sheet (one component, parameterized per activity)
- **Purpose**: Minimal-tap entry for Feeding / Sleep / Diaper / Pumping / Tummy time.
- **Layout**: Bottom sheet, radius 28 top corners, bg `bg`, max-height 92%, shadow `0 -8px 40px rgba(0,0,0,.4)`, slide-up animation `bbSheetUp .26s cubic-bezier(.2,.8,.2,1)`. Structure: grabber → header (activity icon tile + "Log ‹activity›" 20/800 + "for ‹child›" sub + close X) → **scrollable body** (activity-specific fields, then the **Time-Entry component**, then Tags) → fixed **Save bar** at the bottom (thumb zone).
- **Activity-specific fields** (above the time component):
  - **Feeding**: "Type" chips [Breast milk · Formula · Fortified · Solid food]; "Method" chips [Left · Right · Both · Bottle · Parent fed · Self fed] with a right-aligned "↔ auto-alternating" hint when left/right; "Amount (optional)" stepper (shown only for bottle/formula/fortified/solid) in ml, ±10.
  - **Diaper**: "Contents" — two big toggle tiles **Wet** 💧 / **Solid** 💩 (each flex:1, padding 14, radius 16, 2px border that turns the activity color when active). If Solid: "Color" chips [Black · Brown · Green · Yellow] each with a swatch dot.
  - **Pumping**: "Amount" stepper (ml, ±10, default 90).
  - **Tummy time**: "Milestone (optional)" text input.
  - **Sleep**: two shortcut tiles at the very top — **"Woke up now"** (ended this nap) and **"Still sleeping"** (start a live timer). nap/night is auto-suggested by time of day.
- **Save bar**: full-width button, height 58, radius 18, bg = activity color, text `#1A120B` (dark mode) / white (light), 17.5/800, shadow `0 8px 22px rgba(activityColor,.35)`. Label "Save ‹activity›", or "Start live timer" when the live toggle is on.
- **Tags**: "Tags" label + wrap of toggleable chips [Left side · Cluster · Spit-up · Fussy · Sleepy] (multi-select).

### 4. Time-Entry Component — *reusable, used in every flow* ⭐
This is the most important component. It has **two shapes**; the activity decides which. Container: bg `surface`, border 1.5px `line`, radius 20, padding 16.
- **Readout (always on top)**: small clock icon (activity color) + bold result line + sub line.
  - Interval: `9:32 AM → 9:52 AM` (or `→ now` when live) / sub `lasted 20 min` (or `running · 4 min so far`).
  - Point: `9:32 AM` / sub `Today, 12m ago`.
- **INTERVAL shape** (Feeding, Sleep, Pumping, Tummy):
  - "QUICK — ENDED JUST NOW": chips **Last 15m / Last 30m / Last 45m** → sets ended=now, duration=X.
  - "ENDED": chips **Now / 15m ago / 30m ago / 1h ago**.
  - "LASTED": chips **10m/20m/30m/45m** (Sleep uses **20m/45m/1h30m/2h**).
  - "SMART ANCHORS": **Since last feed (‹elapsed›)**, and for Sleep **Since they woke (‹elapsed›)** → set duration to that gap, ended now. Plus a dashed **▶ Start live timer** chip → converts entry into a back-dated running timer.
  - When **live** is on: a banner ("Live timer — started ‹time›, still going") with a "Set end" action replaces the Ended/Lasted rows.
- **POINT shape** (Diaper, notes):
  - "WHEN": chips **Now / 5m / 15m / 30m / 1h / 2h**.
  - "SMART ANCHORS": **When last feed ended**, **When they woke**.
- **Fine nudge (both shapes)**: a top-bordered row — label ("Nudge" / "Fine-tune time") + two buttons **−5m** and **+5m** that shift the resulting time.
- **Chip visuals**: padding 10/15, radius 13, 14/700. Unselected: bg `chip`, text `text`, border 1.5px `line`. Selected: bg = activity color, text `#1A120B` (dark) / white (light), border = activity color. Anchor chips render unselected (they're actions). Transition `all .12s`.

### 5. Active Timer View (Timers screen)
- **Purpose**: Show running timer(s) prominently; one-tap stop-and-save.
- **Layout**: Header (back chevron + "Timers" 27/800). Empty state if none. Else a column of timer cards (gap 14). A dashed "New timer" button at the bottom.
- **Timer card**: bg `surface`, border 1.5px `line`, radius 24, padding 20, shadow. Header row: 38×38 activity-icon tile + name (16/700) + "started ‹ago›" (12.5/dim) + pulsing dot. **Big elapsed clock**: 52/800 tabular-nums, −1.5px, centered, activity color, format `H:MM:SS` or `M:SS`. Action row: **Discard** (flex 1, bg `chip`, dim) + **Stop & save as ‹activity›** (flex 2.4, bg activity color). Below: a row of small chips to change the save-as target [Feeding · Sleep · Pumping · Tummy time].
- **Empty state**: clock icon in a 72×72 rounded tile (`chip` bg) + "No timers running" (18/700) + helper copy about back-dating.

### 6. History / Timeline
- **Purpose**: Reverse-chronological list of recent entries with quick scan.
- **Layout**: Header ("History" 27/800 + small child avatar). Day groups (each: UPPERCASE day label 12.5/700 `faint` + column of rows, gap 8). 
- **Row**: bg `surface`, border 1.5px `line`, radius 18, padding 13/14, flex row gap 12. 40×40 activity-icon tile + title (15.5/700) + detail (13/500, dim — e.g. "Breast milk · right breast · 18 min") + right-aligned time (14/600 tabular-nums) over ago (12/500 `faint`).
- **Empty state**: list icon in 72×72 tile + "Nothing logged yet" + helper copy.
- Production: add swipe-to-edit / swipe-to-delete per row (the prototype lists; edit/delete not yet wired).

### 7. Settings
- Grouped rows (bg `surface`, radius 18, dividers `line`). **Appearance**: "Night mode" toggle, "Simulate offline" toggle (dev aid — replace with a real connectivity indicator). **Server**: connected host + masked token + status dot; "Reconnect / change server" → Onboarding.

### 8. Child Switcher (bottom sheet)
- Grabber + "Who are you logging for?" (18/800). Rows per child: avatar (childColor) + name (16/700) + age (13/dim) + check when selected; selected row tinted `primary @ ~12%` with `primary @ 40%` border. A dashed "Add a child" row at the bottom.

---

## Interactions & Behavior
- **Tab bar nav**: Home / Timers / History. Active tab uses `primary` for icon stroke + label; Home's active icon also gets a `primary @ 22%` fill. Labels 11/700.
- **Open log sheet**: tapping an activity tile opens its sheet with smart defaults pre-applied (see State). Scrim fade-in `bbFade .2s`; sheet slide-up `.26s`.
- **Save**: builds an entry from the time component + activity fields, prepends it to the entries list, closes the sheet, shows a **toast** (`bbToast 2.4s`, bottom-center). If the live toggle was on, a running **timer** is created instead of an entry.
- **Start timer**: "Start timer" tile / "New timer" → creates a running timer (default save-as Feeding) and navigates to Timers; toast "Timer started".
- **Stop & save**: converts a timer to an entry using its elapsed start→now; toast "Saved as ‹activity›".
- **Smart anchors**: compute the gap to the most recent feeding-end / sleep-end and set duration (interval) or timestamp (point) accordingly.
- **Nudge ±5m**: shifts the computed result by ±5 minutes (additive `nudge` offset).
- **Offline**: a pinned banner under the status bar ("Offline — N entries queued, will sync when reconnected", amber dot). Saves still succeed locally and toast "Saved · queued offline". Production: persist a queue and flush on reconnect.
- **Live clock**: a 1s interval re-renders elapsed durations and "ago" labels.
- **Theme**: Night (default) ↔ Daylight, toggled in Settings; all tokens swap.

## State Management
State needed (per the prototype): `theme` (dark|light), `platform` (ios|android), `screen` (home|timeline|timers|settings|onboarding), `offline` (bool), `selectedChildId`, `children[]`, `entries[]`, `timers[]` (each `{id, activity, name, start, saveAs}`), `now` (ticking ms), `sheet` ({type}|null), `te` (the working time-entry + activity fields), `lastFeed` ({feedType, method}) for alternating/prefill, `toast`.
- **Time-entry working model `te`**: `{ shape:'interval'|'point', endedAgoMin, durationMin, live, startAgoMin, agoMin, nudge, feedType, method, amount, wet, solid, color, nap, milestone, tags[] }`. Derived: `start = end − duration` (interval) or `now − agoMin + nudge` (point); `end = now − endedAgoMin + nudge` (or `now` if live).
- **Smart defaults on open**: start time = now; Feeding pre-selects last-used type and the **opposite** breast side; typical durations (Sleep 90m, Pumping 15m, Feeding 18m); Diaper defaults Wet; Sleep nap/night by hour of day.
- **Data fetching**: back this with the Baby Buddy REST API (`/api/feedings`, `/api/sleep`, `/api/changes`, `/api/pumping`, `/api/tummy-times`, `/api/timers`, `/api/children`, `/api/tags`). Auth via `Authorization: Token <token>`. Queue writes while offline.

## Design Tokens

### Colors — Night (default)
| Token | Hex |
|---|---|
| bg | `#16110E` |
| surface | `#221B16` |
| chip | `#2C231C` |
| elevated (bg4) | `#3A2E25` |
| line | `rgba(255,255,255,0.07)` |
| line2 | `rgba(255,255,255,0.13)` |
| text | `#F3EBE1` |
| dim | `#B4A492` |
| faint | `#7C6F61` |
| primary | `#EC9A66` |
| onPrimary | `#2A170B` |
| shadow | `0 12px 40px rgba(0,0,0,0.5)` |

### Colors — Daylight
| Token | Hex |
|---|---|
| bg | `#F6EDE3` |
| surface | `#FFFCF8` |
| chip | `#F1E6D8` |
| elevated (bg4) | `#E8DAC8` |
| line | `rgba(58,46,36,0.10)` |
| line2 | `rgba(58,46,36,0.18)` |
| text | `#3A2E24` |
| dim | `#7C6C5C` |
| faint | `#A89684` |
| primary | `#D17A45` |
| onPrimary | `#FFFFFF` |
| shadow | `0 12px 36px rgba(120,86,52,0.16)` |

### Activity colors (night / daylight)
| Activity | Night | Daylight |
|---|---|---|
| Feeding | `#F0A878` | `#D9854B` |
| Sleep | `#A99EDC` | `#7E6FC9` |
| Diaper | `#6FC0A6` | `#3E9D80` |
| Pumping | `#E6BE5E` | `#C79A36` |
| Tummy time | `#EA958A` | `#D06E62` |
| Diaper-solid swatches | Black `#3A3330` · Brown `#7A5230` · Green `#6F8F4A` · Yellow `#D8B04A` | same |

Activity tints: icon-wrap / card-tint backgrounds use the activity color at **16% alpha**. Selected chips use the **solid** activity color.

### Typography — **Figtree** (Google Fonts, weights 400/500/600/700/800)
| Role | Size / weight / tracking |
|---|---|
| Display | 27–32 / 800 / −0.6 to −0.8px |
| Title | 20–21 / 700–800 / −0.3px |
| Body | 14–15.5 / 500 |
| Button | 15–17.5 / 800 |
| Stat value | 19–26 / 700–800 (tabular-nums) |
| Timer clock | 52 / 800 (tabular-nums, −1.5px) |
| Label (caps) | 11–13 / 700, letter-spacing .5–.8px |
| Chip | 14 / 700 |

### Radius
Sheets 28 · big tiles/cards 20–24 · inputs 14–17 · chips 11–13 · icon wraps 12–14 · avatars 16 · pills/dots 9999.

### Spacing
Screen padding 18px (24 onboarding). Card padding 13–20. Grid/chip gaps 8–11. Tap targets ≥ 44px (steppers 48–54, save 58, primary 56).

### Animations
`bbSheetUp` (.26s cubic-bezier(.2,.8,.2,1)), `bbFade` (.2s), `bbPulse` (1.6s ease-in-out infinite — live dots), `bbToast` (2.4s), `bbSpin` (loading). Chip/toggle state transitions `all .12s`.

## Assets
- **Icons**: drawn inline as simple filled SVG (24×24 viewBox) — bottle (feeding), crescent moon (sleep), nappy (diaper), droplet (pumping), 4-point sparkle (tummy), clock (timer), house/clock/list (tab bar), gear/chevrons/check/plus/info (UI). Replace with your icon library's nearest equivalents (Phosphor/Lucide "fill" style match the soft-filled look). Wet/Solid toggles use the 💧 and 💩 emoji.
- **Fonts**: Figtree via Google Fonts.
- **Child photos**: the data model includes a child photo; the prototype uses a colored initial tile as the avatar/placeholder — support a real photo when present.
- No raster image assets are required.

## Files
- `Baby Buddy.dc.html` — the showcase: design-system band + the app running in iOS & Android frames across screens/states. **Start here.**
- `BabyBuddyApp.dc.html` — the actual interactive app (all screens, state, the time-entry component, live timer). The implementation reference.
- `ios-frame.jsx` / `android-frame.jsx` — device-bezel chrome used only to present the app; **not part of the product** (use real OS chrome).
- `screenshots/` — reference captures of the design in iOS & Android frames: `01` design system · `02–03` home (night, both platforms + daylight) · `04–05` log sheets with the time-entry component (feeding, sleep, diaper) · `06` onboarding + active timer · `07` history + offline home.

> To run the prototype: open `Baby Buddy.dc.html` in the design tool. The `.dc.html` format depends on its prototyping runtime; treat the markup + logic as a spec.
