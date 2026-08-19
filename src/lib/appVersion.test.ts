import { describe, expect, it } from 'vitest';

import { versionLabel } from '@/lib/appVersion';

describe('versionLabel', () => {
  it('names the build when the config carries a version', () => {
    expect(versionLabel('0.15.0 (447f1a7)')).toBe('Budkin 0.15.0 (447f1a7)');
  });

  it('passes a rolling tag through unchanged', () => {
    // The `experimental` docker tag ships uncommitted WIP, so the sha beside it
    // is the only thing distinguishing two of them.
    expect(versionLabel('experimental (a9781a4)')).toBe('Budkin experimental (a9781a4)');
  });

  it('says dev when the config carries nothing', () => {
    // A dev server with no git, or a build whose env var was never set. "dev" reads
    // as obviously unknown rather than claiming a version this build is not.
    expect(versionLabel(undefined)).toBe('Budkin dev');
  });

  it('treats an empty or blank value as no version at all', () => {
    // `BUDKIN_VERSION=` and `BUDKIN_VERSION="  "` both reach here as strings,
    // and "Budkin " with a dangling space would look like a rendering bug.
    expect(versionLabel('')).toBe('Budkin dev');
    expect(versionLabel('   ')).toBe('Budkin dev');
  });

  it('trims surrounding whitespace rather than drawing it', () => {
    // `git describe` output arrives with a trailing newline.
    expect(versionLabel('0.15.0\n')).toBe('Budkin 0.15.0');
  });
});
