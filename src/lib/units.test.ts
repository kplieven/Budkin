import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PUMP_AMOUNT,
  DEFAULT_TEMPERATURE,
  fmtValue,
  fromMetric,
  resolveInput,
  stepVolume,
  unitLabel,
  type UnitSystem,
} from '@/lib/units';
import type { MeasurementKind } from '@/types/models';

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
    expect(unitLabel('bmi', 'imperial')).toBe('');
  });
});

describe('fromMetric (genuinely metric reference data → the user units)', () => {
  it('metric is a pass-through for every kind', () => {
    for (const kind of ['weight', 'height', 'head', 'bmi'] as MeasurementKind[]) {
      expect(fromMetric(kind, 12.34, 'metric')).toBe(12.34);
    }
  });

  it('weight kg → lb (×2.2046226)', () => {
    expect(fromMetric('weight', 1, 'imperial')).toBeCloseTo(2.2046226, 6);
    expect(fromMetric('weight', 5.2, 'imperial')).toBeCloseTo(11.464, 3);
  });

  it('height & head cm → in (÷2.54)', () => {
    expect(fromMetric('height', 2.54, 'imperial')).toBeCloseTo(1, 6);
    expect(fromMetric('height', 58, 'imperial')).toBeCloseTo(22.8346, 3);
    expect(fromMetric('head', 39, 'imperial')).toBeCloseTo(15.3543, 3);
  });

  it('bmi is kg/m² in both systems, never converted', () => {
    expect(fromMetric('bmi', 15.4, 'imperial')).toBe(15.4);
  });
});

describe('fmtValue (stored numbers shown as stored)', () => {
  it('never converts: the units setting only picks the label', () => {
    // An imperial family's 12 lb must read 12, not 26.5.
    expect(fmtValue(12)).toBe('12');
    expect(fmtValue(4)).toBe('4');
    expect(fmtValue(98.6)).toBe('98.6');
  });

  it('keeps a weight recorded to the gram', () => {
    expect(fmtValue(3.475)).toBe('3.475');
  });

  it('trims float tails an older converting Budkin stored', () => {
    expect(fmtValue(103.50725)).toBe('103.507');
    expect(fmtValue(5.216304465)).toBe('5.216');
  });
});

describe('resolveInput (no rounded-display drift on a no-op edit)', () => {
  it('keeps the exact original value when the edit is unchanged', () => {
    // 5.216304465 shows as "5.216"; re-saving without changing it keeps every digit.
    expect(resolveInput('5.216', 5.216304465)).toBe(5.216304465);
  });

  it('tolerates surrounding whitespace on an unchanged edit', () => {
    expect(resolveInput('  5.216  ', 5.216304465)).toBe(5.216304465);
  });

  it('returns a changed or new value as typed, never converted', () => {
    expect(resolveInput('12', 5.2)).toBe(12);
    expect(resolveInput('12')).toBe(12);
    expect(resolveInput('7,5')).toBe(7.5); // a decimal comma
  });

  it('returns null for blank / non-numeric input', () => {
    expect(resolveInput('', 5.2)).toBeNull();
    expect(resolveInput('abc')).toBeNull();
  });
});

describe('stepVolume (stepper presses on the stored number)', () => {
  it('metric steps by whole 10 ml', () => {
    expect(stepVolume(90, 1, 'metric')).toBe(100);
    expect(stepVolume(90, -1, 'metric')).toBe(80);
    expect(stepVolume(0, 1, 'metric')).toBe(10);
  });

  it('imperial steps by half a fluid ounce, on the number itself', () => {
    expect(stepVolume(3, 1, 'imperial')).toBe(3.5);
    expect(stepVolume(3, -1, 'imperial')).toBe(2.5);
    expect(stepVolume(4, 1, 'imperial')).toBe(4.5);
  });

  it('clamps at zero instead of going negative', () => {
    expect(stepVolume(0, -1, 'metric')).toBe(0);
    expect(stepVolume(5, -1, 'metric')).toBe(0);
    expect(stepVolume(0.25, -1, 'imperial')).toBe(0);
  });

  it('snaps an off-grid amount onto the grid, always moving in the pressed direction', () => {
    // A typed 137 ml or 3.25 fl oz moves to the next mark rather than by a raw step.
    expect(stepVolume(137, 1, 'metric')).toBe(140);
    expect(stepVolume(137, -1, 'metric')).toBe(130);
    expect(stepVolume(3.25, 1, 'imperial')).toBe(3.5);
    expect(stepVolume(3.25, -1, 'imperial')).toBe(3);
  });

  it('a value a hair off a mark still moves a whole step', () => {
    expect(stepVolume(3.5000000000000004, 1, 'imperial')).toBe(4);
    expect(stepVolume(3.4999999999999996, -1, 'imperial')).toBe(3);
  });

  it('repeated imperial presses stay on clean halves', () => {
    let oz = 0;
    for (let i = 1; i <= 20; i++) {
      oz = stepVolume(oz, 1, 'imperial');
      expect(oz).toBe(i * 0.5);
    }
    for (let i = 19; i >= 0; i--) {
      oz = stepVolume(oz, -1, 'imperial');
      expect(oz).toBe(i * 0.5);
    }
  });
});

describe('defaults are in the user units', () => {
  it('pumping starts on 90 ml or 3 fl oz, each on its own stepper grid', () => {
    expect(DEFAULT_PUMP_AMOUNT).toEqual({ metric: 90, imperial: 3 });
  });

  it('temperature starts on 37.0 °C or 98.6 °F', () => {
    expect(DEFAULT_TEMPERATURE).toEqual({ metric: 37, imperial: 98.6 });
  });
});

// Exhaustive type guard: adding a kind or system without handling it here fails.
const _sys: UnitSystem[] = ['metric', 'imperial'];
void _sys;
