import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/BottomSheet';
import { Chip } from '@/components/Chip';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { ACTIVITY_LABEL } from '@/lib/activities';
import { hexA } from '@/lib/color';
import { useTheme } from '@/theme/useTheme';
import type { ActivityType } from '@/types/models';

import { dayKeyLabel, type DayOption, type TimelineFilter } from './filter';

/** Which filter sheet is open, or null. Owned by the screen: the chips and the
 *  sheets cannot live in the same parent, see `HistoryFilterSheets`. */
export type OpenFilterSheet = 'day' | 'activity' | null;

/**
 * The row WRAPS, because three chips plus the clear button overflow a 360dp phone once
 * the activity chip shows a long label.
 *
 * The household toggle is NOT part of `TimelineFilter`, and that is load-bearing.
 * `filterItems` is purely subtractive over a list it is handed, where the toggle is
 * additive and changes what that list is built FROM. Keeping it out is also what stops
 * "Clear filters" resetting it: both cleared-state literals spell `TimelineFilter` out in
 * full, so a toggle inside that type would be reset by two call sites that never mention
 * it.
 */
export function HistoryFilterChips({
  filter,
  now,
  onOpen,
  onChange,
  household,
  householdLabel,
  onToggleHousehold,
  showFilters,
}: {
  filter: TimelineFilter;
  now: number;
  onOpen: (sheet: OpenFilterSheet) => void;
  onChange: (next: TimelineFilter) => void;
  /** Whether the whole household is showing, or null to offer no toggle at all
   *  (fewer than two children who can own activity). */
  household: boolean | null;
  /** What the toggle currently shows: the selected child's name when off. */
  householdLabel: string;
  onToggleHousehold: () => void;
  /** Whether there is anything to filter. False when the timeline is empty, and
   *  then the day and activity chips hide: both would open an empty sheet. The
   *  household toggle deliberately still shows, since an empty timeline is
   *  exactly when someone wants to look at the rest of the household. */
  showFilters: boolean;
}) {
  const t = useTheme();

  const dayLabel = filter.day ? dayKeyLabel(filter.day, now) : 'All days';
  const activityLabel =
    filter.types.length === 0
      ? 'All activities'
      : filter.types.length === 1
        ? ACTIVITY_LABEL[filter.types[0]]
        : `${filter.types.length} activities`;
  const filtered = filter.day != null || filter.types.length > 0;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, rowGap: 8, marginHorizontal: 20, marginBottom: 14 }}>
      {/* First, because it is the broadest question the row asks. */}
      {household != null && (
        <ToggleChip
          label={householdLabel}
          accessibilityLabel={`Show the whole household, currently showing ${householdLabel}`}
          on={household}
          onPress={onToggleHousehold}
        />
      )}
      {showFilters && (
        <DropdownChip
          label={dayLabel}
          accessibilityLabel={`Filter by day, showing ${dayLabel}`}
          active={filter.day != null}
          onPress={() => onOpen('day')}
        />
      )}
      {showFilters && (
        <DropdownChip
          label={activityLabel}
          accessibilityLabel={`Filter by activity, showing ${activityLabel}`}
          active={filter.types.length > 0}
          onPress={() => onOpen('activity')}
        />
      )}
      {showFilters && filtered && (
        <Pressable
          // Deliberately does NOT clear the household toggle: `TimelineFilter`
          // is the whole of what "filters" means here, and the toggle is not in it.
          onPress={() => onChange({ day: null, types: [] })}
          accessibilityRole="button"
          accessibilityLabel="Clear filters"
          style={(s) => [
            {
              width: 32,
              height: 32,
              borderRadius: 999,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: t.chip,
              cursor: 'pointer',
            },
            isHovered(s) && { backgroundColor: t.elevated },
          ]}
        >
          <Icon name="close" color={t.dim} size={15} />
        </Pressable>
      )}
    </View>
  );
}

/**
 * The two filter sheets.
 *
 * Separate from the chips, and mounted by the screen OUTSIDE its scroll
 * container, because a sheet is `position: absolute` against its nearest
 * positioned ancestor. Rendered inside the timeline's own ScrollView it anchors
 * to the scrolled CONTENT instead of the viewport: the panel lands at the bottom
 * of the list rather than the bottom of the screen, and the scrim only dims as
 * far as the content reaches.
 */
export function HistoryFilterSheets({
  open,
  onClose,
  days,
  activities,
  filter,
  onChange,
}: {
  open: OpenFilterSheet;
  onClose: () => void;
  /** days that have items under the current activity filter, newest first */
  days: DayOption[];
  /** activities present on the currently selected day */
  activities: ActivityType[];
  filter: TimelineFilter;
  onChange: (next: TimelineFilter) => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  // Removing the last one lands back on the cleared state, which means "all".
  const toggle = (a: ActivityType) => {
    const next = filter.types.includes(a) ? filter.types.filter((x) => x !== a) : [...filter.types, a];
    onChange({ ...filter, types: next });
  };

  return (
    <>
      {open === 'day' && (
        <BottomSheet onClose={onClose} maxHeightRatio={0.7}>
          <SheetHeader title="Jump to a day" subtitle="Only days with something logged" />
          {/* flexGrow: 0 is load-bearing. react-native-web's ScrollView base
              style sets flexGrow: 1, so a plain flexShrink: 1 leaves it growing
              to the panel's maxHeight: a four-day list would open a sheet two
              thirds of the screen tall with the rows stranded at the top. */}
          <ScrollView
            style={{ flexGrow: 0, flexShrink: 1 }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: insets.bottom + 10, gap: 6 }}
          >
            <DayRow
              label="All days"
              count={days.reduce((n, d) => n + d.count, 0)}
              selected={filter.day == null}
              onPress={() => {
                onChange({ ...filter, day: null });
                onClose();
              }}
            />
            {days.map((d) => (
              <DayRow
                key={d.key}
                label={d.label}
                count={d.count}
                selected={filter.day === d.key}
                onPress={() => {
                  onChange({ ...filter, day: d.key });
                  onClose();
                }}
              />
            ))}
          </ScrollView>
        </BottomSheet>
      )}

      {open === 'activity' && (
        <BottomSheet onClose={onClose} maxHeightRatio={0.7}>
          <SheetHeader title="Show" subtitle="Pick as many as you like" />
          <ScrollView
            style={{ flexGrow: 0, flexShrink: 1 }}
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: insets.bottom + 16 }}
          >
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip
                label="Everything"
                color={t.primary}
                selected={filter.types.length === 0}
                onPress={() => onChange({ ...filter, types: [] })}
              />
              {activities.map((a) => (
                <Chip
                  key={a}
                  label={ACTIVITY_LABEL[a]}
                  color={t.activity[a]}
                  selected={filter.types.includes(a)}
                  onPress={() => toggle(a)}
                />
              ))}
            </View>
          </ScrollView>
        </BottomSheet>
      )}
    </>
  );
}

function DropdownChip({
  label,
  accessibilityLabel,
  active,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  active: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
      style={(s) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 5,
          paddingLeft: 13,
          paddingRight: 9,
          paddingVertical: 8,
          borderRadius: 12,
          backgroundColor: active ? hexA(t.primary, t.dark ? 0.16 : 0.1) : t.chip,
          borderWidth: 1.5,
          borderColor: active ? hexA(t.primary, 0.55) : t.line,
          cursor: 'pointer',
        },
        !active && isHovered(s) && { borderColor: t.line2 },
      ]}
    >
      <Txt unselectable weight={700} size={13.5} color={active ? t.primary : t.text}>
        {label}
      </Txt>
      <Icon name="chevron-down" color={active ? t.primary : t.faint} size={16} />
    </Pressable>
  );
}

/**
 * A chip that flips a boolean, styled as the twin of `DropdownChip` but with no
 * chevron: there is no sheet behind it, so the affordance must not promise one.
 * `accessibilityRole="switch"` rather than "button", so a screen reader announces
 * the state as on or off instead of leaving the user to infer it from a label
 * that names only the current one.
 */
function ToggleChip({
  label,
  accessibilityLabel,
  on,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  on: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      // BOTH forms, deliberately. react-native-web drops `accessibilityState` on
      // the floor, which is survivable for a button but not for a switch, whose
      // whole ARIA contract is the checked state. `aria-checked` is what actually
      // reaches the DOM on web, and RN maps the `aria-*` props back onto
      // `accessibilityState` on native, so neither platform announces "switch"
      // with no on or off.
      accessibilityState={{ checked: on }}
      aria-checked={on}
      style={(s) => [
        {
          paddingHorizontal: 13,
          paddingVertical: 8,
          borderRadius: 12,
          backgroundColor: on ? hexA(t.primary, t.dark ? 0.16 : 0.1) : t.chip,
          borderWidth: 1.5,
          borderColor: on ? hexA(t.primary, 0.55) : t.line,
          cursor: 'pointer',
        },
        !on && isHovered(s) && { borderColor: t.line2 },
      ]}
    >
      <Txt unselectable weight={700} size={13.5} color={on ? t.primary : t.text}>
        {label}
      </Txt>
    </Pressable>
  );
}

function SheetHeader({ title, subtitle }: { title: string; subtitle: string }) {
  const t = useTheme();
  return (
    <View style={{ paddingHorizontal: 22, paddingTop: 10, paddingBottom: 6, flexShrink: 0 }}>
      <Txt weight={800} size={18}>
        {title}
      </Txt>
      <Txt weight={500} size={13} color={t.dim} style={{ marginTop: 2 }}>
        {subtitle}
      </Txt>
    </View>
  );
}

function DayRow({
  label,
  count,
  selected,
  onPress,
}: {
  label: string;
  count: number;
  selected: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}, ${count} ${count === 1 ? 'entry' : 'entries'}`}
      style={(s) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 13,
          paddingHorizontal: 14,
          borderRadius: 16,
          backgroundColor: selected ? hexA(t.primary, t.dark ? 0.16 : 0.1) : t.chip,
          borderWidth: 1.5,
          borderColor: selected ? hexA(t.primary, 0.55) : t.line,
          cursor: 'pointer',
        },
        !selected && isHovered(s) && { borderColor: t.line2 },
      ]}
    >
      <Txt unselectable weight={700} size={15.5} style={{ flex: 1 }} color={selected ? t.primary : t.text}>
        {label}
      </Txt>
      <Txt unselectable weight={600} size={13} color={t.dim}>
        {count}
      </Txt>
      {selected ? <Icon name="check" color={t.primary} size={17} /> : null}
    </Pressable>
  );
}
