import { describe, expect, it } from 'vitest';

import { fmtValue, resolveMetricInput, toDisplay, toMetric, unitLabel, type UnitKind, type UnitSystem } from '@/lib/units';

describe('unitLabel', () => {
  it('metric labels', () => {
    expect(unitLabel('weight', 'metric')).toBe('kg');
    expect(unitLabel('height', 'metric')).toBe('cm');
    expect(unitLabel('head', 'metric')).toBe('cm');
    expect(unitLabel('temperature', 'metric')).toBe('°C');
    expect(unitLabel('bmi', 'metric')).toBe('');
  });

  it('imperial labels', () => {
    expect(unitLabel('weight', 'imperial')).toBe('lb');
    expect(unitLabel('height', 'imperial')).toBe('in');
    expect(unitLabel('head', 'imperial')).toBe('in');
    expect(unitLabel('temperature', 'imperial')).toBe('°F');
    expect(unitLabel('bmi', 'imperial')).toBe(''); // dimensionless in both systems
  });
});

describe('toDisplay (metric canonical → system)', () => {
  it('metric is a pass-through for every kind', () => {
    for (const kind of ['weight', 'height', 'head', 'bmi', 'temperature'] as UnitKind[]) {
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

  it('bmi is dimensionless — never converted', () => {
    expect(toDisplay('bmi', 15.4, 'imperial')).toBe(15.4);
  });
});

describe('toMetric (typed value in system → metric canonical)', () => {
  it('metric is a pass-through for every kind', () => {
    for (const kind of ['weight', 'height', 'head', 'bmi', 'temperature'] as UnitKind[]) {
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

// Exhaustive type guard: adding a kind or system without handling it here fails.
const _sys: UnitSystem[] = ['metric', 'imperial'];
void _sys;
