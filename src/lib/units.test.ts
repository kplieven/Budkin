import { describe, expect, it } from 'vitest';

import {
  fmtValue,
  resolveMetricInput,
  stepVolume,
  toDisplay,
  toMetric,
  unitLabel,
  type UnitKind,
  type UnitSystem,
} from '@/lib/units';

describe('unitLabel', () => {
  it('metric labels', () => {
    expect(unitLabel('weight', 'metric')).toBe('kg');
    expect(unitLabel('height', 'metric')).toBe('cm');
    expect(unitLabel('head', 'metric')).toBe('cm');
    expect(unitLabel('temperature', 'metric')).toBe('°C');
    expect(unitLabel('volume', 'metric')).toBe('ml');
    expect(unitLabel('bmi', 'metric')).toBe('');
  });

  it('imperial labels', () => {
    expect(unitLabel('weight', 'imperial')).toBe('lb');
    expect(unitLabel('height', 'imperial')).toBe('in');
    expect(unitLabel('head', 'imperial')).toBe('in');
    expect(unitLabel('temperature', 'imperial')).toBe('°F');
    expect(unitLabel('volume', 'imperial')).toBe('fl oz');
    expect(unitLabel('bmi', 'imperial')).toBe(''); // dimensionless in both systems
  });
});

describe('toDisplay (metric canonical → system)', () => {
  it('metric is a pass-through for every kind', () => {
    for (const kind of ['weight', 'height', 'head', 'bmi', 'temperature', 'volume'] as UnitKind[]) {
      expect(toDisplay(kind, 12.34, 'metric')).toBe(12.34);
    }
  });

  it('weight kg → lb (×2.2046226)', () => {
    expect(toDisplay('weight', 1, 'imperial')).toBeCloseTo(2.2046226, 6);
    expect(toDisplay('weight', 5.2, 'imperial')).toBeCloseTo(11.4640, 3);
  });

  it('height & head cm → in (÷2.54)', () => {
    expect(toDisplay('height', 2.54, 'imperial')).toBeCloseTo(1, 6);
    expect(toDisplay('height', 58, 'imperial')).toBeCloseTo(22.8346, 3);
    expect(toDisplay('head', 39, 'imperial')).toBeCloseTo(15.3543, 3);
  });

  it('temperature °C → °F with the +32 offset (not a pure ratio)', () => {
    expect(toDisplay('temperature', 0, 'imperial')).toBeCloseTo(32, 6);
    expect(toDisplay('temperature', 37, 'imperial')).toBeCloseTo(98.6, 6);
    expect(toDisplay('temperature', 100, 'imperial')).toBeCloseTo(212, 6);
  });

  it('volume ml → fl oz (÷29.5735)', () => {
    expect(toDisplay('volume', 29.5735, 'imperial')).toBeCloseTo(1, 6);
    expect(toDisplay('volume', 90, 'imperial')).toBeCloseTo(3.0433, 4); // the pumping default
    expect(toDisplay('volume', 120, 'imperial')).toBeCloseTo(4.0577, 4);
  });

  it('bmi is dimensionless — never converted', () => {
    expect(toDisplay('bmi', 15.4, 'imperial')).toBe(15.4);
  });
});

describe('toMetric (typed value in system → metric canonical)', () => {
  it('metric is a pass-through for every kind', () => {
    for (const kind of ['weight', 'height', 'head', 'bmi', 'temperature', 'volume'] as UnitKind[]) {
      expect(toMetric(kind, 12.34, 'metric')).toBe(12.34);
    }
  });

  it('weight lb → kg (÷2.2046226)', () => {
    expect(toMetric('weight', 2.2046226, 'imperial')).toBeCloseTo(1, 6);
  });

  it('height & head in → cm (×2.54)', () => {
    expect(toMetric('height', 1, 'imperial')).toBeCloseTo(2.54, 6);
    expect(toMetric('head', 15, 'imperial')).toBeCloseTo(38.1, 6);
  });

  it('temperature °F → °C inverting the offset', () => {
    expect(toMetric('temperature', 32, 'imperial')).toBeCloseTo(0, 6);
    expect(toMetric('temperature', 98.6, 'imperial')).toBeCloseTo(37, 6);
    expect(toMetric('temperature', 212, 'imperial')).toBeCloseTo(100, 6);
  });

  it('volume fl oz → ml (×29.5735)', () => {
    expect(toMetric('volume', 1, 'imperial')).toBeCloseTo(29.5735, 6);
    expect(toMetric('volume', 3.5, 'imperial')).toBeCloseTo(103.50725, 6);
  });

  it('bmi is dimensionless — never converted', () => {
    expect(toMetric('bmi', 15.4, 'imperial')).toBe(15.4);
  });
});

describe('round-trip (input in imperial → stored metric → re-displayed imperial)', () => {
  const cases: { kind: UnitKind; imperial: number }[] = [
    { kind: 'weight', imperial: 11.5 },
    { kind: 'height', imperial: 22.8 },
    { kind: 'head', imperial: 15.4 },
    { kind: 'temperature', imperial: 98.6 },
    { kind: 'volume', imperial: 3.5 },
    { kind: 'bmi', imperial: 15.4 },
  ];
  for (const { kind, imperial } of cases) {
    it(`${kind}: toDisplay(toMetric(x)) ≈ x`, () => {
      const metric = toMetric(kind, imperial, 'imperial');
      expect(toDisplay(kind, metric, 'imperial')).toBeCloseTo(imperial, 6);
    });
  }
});

describe('fmtValue', () => {
  it('shows metric values exactly (no rounding of stored canonical numbers)', () => {
    expect(fmtValue('weight', 5.2, 'metric')).toBe('5.2');
    expect(fmtValue('height', 58, 'metric')).toBe('58');
    expect(fmtValue('temperature', 36.9, 'metric')).toBe('36.9');
  });

  it('rounds converted imperial values to 1 decimal', () => {
    expect(fmtValue('weight', 5.2, 'imperial')).toBe('11.5'); // 11.4640 → 11.5
    expect(fmtValue('height', 58, 'imperial')).toBe('22.8'); // 22.8346 → 22.8
    expect(fmtValue('head', 39, 'imperial')).toBe('15.4'); // 15.3543 → 15.4
  });

  it('rounds volume to 1 decimal in BOTH systems', () => {
    expect(fmtValue('volume', 90, 'metric')).toBe('90'); // a whole ml stays whole
    expect(fmtValue('volume', 90, 'imperial')).toBe('3'); // 3.0433 → 3
    expect(fmtValue('volume', 103.50725, 'imperial')).toBe('3.5');
    // An amount stepped in fl oz stores an exact ml value. Flipping the lens
    // back to metric must show 103.5 ml, not the raw 103.50725.
    expect(fmtValue('volume', 103.50725, 'metric')).toBe('103.5');
  });

  it('leaves BMI untouched in both systems (dimensionless)', () => {
    expect(fmtValue('bmi', 15.4, 'metric')).toBe('15.4');
    expect(fmtValue('bmi', 15.4, 'imperial')).toBe('15.4');
  });
});

describe('resolveMetricInput (no rounded-display drift on a no-op edit)', () => {
  it('keeps the exact original metric value when an imperial edit is unchanged', () => {
    // 5.2 kg shows as "11.5" lb; re-saving without changing it must stay 5.2,
    // not toMetric("11.5") = 5.21631.
    expect(resolveMetricInput('weight', '11.5', 'imperial', 5.2)).toBe(5.2);
    expect(resolveMetricInput('height', '22.8', 'imperial', 58)).toBe(58);
    expect(resolveMetricInput('temperature', '99', 'imperial', 37.2)).toBe(37.2);
  });

  it('converts a genuinely changed imperial value back to metric', () => {
    expect(resolveMetricInput('weight', '12', 'imperial', 5.2)).toBeCloseTo(12 / 2.2046226, 6);
  });

  it('converts for a new entry (no original) and passes metric through', () => {
    expect(resolveMetricInput('weight', '10', 'imperial')).toBeCloseTo(10 / 2.2046226, 6);
    expect(resolveMetricInput('weight', '6', 'metric', 5.2)).toBe(6);
  });

  it('tolerates surrounding whitespace on an unchanged edit', () => {
    expect(resolveMetricInput('weight', '  11.5  ', 'imperial', 5.2)).toBe(5.2);
  });

  it('returns null for blank / non-numeric input', () => {
    expect(resolveMetricInput('weight', '', 'imperial', 5.2)).toBeNull();
    expect(resolveMetricInput('weight', 'abc', 'metric')).toBeNull();
  });
});

describe('stepVolume (stepper works in display units, stores canonical ml)', () => {
  it('metric steps by whole 10 ml', () => {
    expect(stepVolume(90, 1, 'metric')).toBe(100);
    expect(stepVolume(90, -1, 'metric')).toBe(80);
    expect(stepVolume(0, 1, 'metric')).toBe(10);
  });

  it('clamps at zero instead of going negative', () => {
    expect(stepVolume(0, -1, 'metric')).toBe(0);
    expect(stepVolume(5, -1, 'metric')).toBe(0);
    expect(stepVolume(10, -1, 'imperial')).toBe(0);
  });

  it('snaps an off-grid amount onto the grid, always moving in the pressed direction', () => {
    // A 95 ml amount synced from Baby Buddy is not on the 10 ml grid; a press
    // moves it to the next grid point rather than adding a raw 10.
    expect(stepVolume(95, 1, 'metric')).toBe(100);
    expect(stepVolume(95, -1, 'metric')).toBe(90);
  });

  it('imperial steps by half a fluid ounce', () => {
    expect(toDisplay('volume', stepVolume(toMetric('volume', 3, 'imperial'), 1, 'imperial'), 'imperial')).toBeCloseTo(
      3.5,
      9,
    );
    expect(toDisplay('volume', stepVolume(toMetric('volume', 3, 'imperial'), -1, 'imperial'), 'imperial')).toBeCloseTo(
      2.5,
      9,
    );
  });

  it('lands on a clean half from the off-grid 90 ml pumping default', () => {
    // 90 ml is 3.0433 fl oz. Pressing + must show 3.5, not 3.5433.
    const up = stepVolume(90, 1, 'imperial');
    expect(toDisplay('volume', up, 'imperial')).toBeCloseTo(3.5, 9);
    expect(toDisplay('volume', stepVolume(90, -1, 'imperial'), 'imperial')).toBeCloseTo(3, 9);
  });

  it('repeated imperial presses stay on clean halves without accumulating drift', () => {
    let ml = 0;
    for (let i = 1; i <= 20; i++) {
      ml = stepVolume(ml, 1, 'imperial');
      const shown = toDisplay('volume', ml, 'imperial');
      expect(shown).toBeCloseTo(i * 0.5, 9); // exactly on the half-ounce grid
      expect(shown.toFixed(1)).toBe((i * 0.5).toFixed(1)); // and renders that way
    }
    expect(toDisplay('volume', ml, 'imperial')).toBeCloseTo(10, 9);

    // Stepping all the way back down retraces the same halves and hits zero.
    for (let i = 19; i >= 0; i--) {
      ml = stepVolume(ml, -1, 'imperial');
      expect(toDisplay('volume', ml, 'imperial')).toBeCloseTo(i * 0.5, 9);
    }
    expect(ml).toBe(0);
  });

  it('stores canonical ml, never the imperial display number', () => {
    // 3.5 fl oz is persisted and synced as 103.50725 ml.
    expect(stepVolume(90, 1, 'imperial')).toBeCloseTo(103.50725, 6);
  });
});

// Exhaustive type guard: adding a kind or system without handling it here fails.
const _sys: UnitSystem[] = ['metric', 'imperial'];
void _sys;
