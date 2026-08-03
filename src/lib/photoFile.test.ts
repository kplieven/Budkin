import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Directory, File } from 'expo-file-system';
import { Platform } from 'react-native';

import { discardPhotoFile, persistPhotoFile, reopenPhotoFile, sweepPhotoFiles } from '@/lib/photoFile';
import { photoFileName } from '@/lib/photoName';

// The module's only native surface: `expo-file-system`'s `File`/`Directory`/
// `Paths`, plus `react-native`'s `Platform`. Mocked as plain classes so the
// real photoFile.ts loads directly under node, per `permission.android.test.ts`
// (which does the same for `expo-notifications`) and `servers.test.ts` (for
// `expo-secure-store`). `Paths.document` is a fixed 'file:///doc' directory;
// every URI below is built by joining onto it, exactly as the real classes do.
const fsMock = vi.hoisted(() => {
  const uriOf = (part: unknown): string => (typeof part === 'string' ? part : (part as { uri: string }).uri);
  const join = (parts: unknown[]): string =>
    parts.map(uriOf).reduce((acc, p) => (acc ? `${acc.replace(/\/+$/, '')}/${p.replace(/^\/+/, '')}` : p));

  const state = {
    exists: new Map<string, boolean>(),
    dirListing: new Map<string, unknown[]>(),
    dirListThrows: new Set<string>(),
    deleted: [] as string[],
    createCalls: [] as { uri: string; options: unknown }[],
    copyCalls: [] as { from: string; to: string; options: unknown }[],
    copyThrows: false,
    deleteThrows: false,
  };

  class MockFile {
    readonly uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists(): boolean {
      return state.exists.get(this.uri) ?? false;
    }
    delete(): void {
      if (state.deleteThrows) throw new Error('delete failed');
      state.deleted.push(this.uri);
    }
    async copy(destination: { uri: string }, options?: unknown): Promise<void> {
      if (state.copyThrows) throw new Error('copy failed');
      state.copyCalls.push({ from: this.uri, to: destination.uri, options });
    }
  }

  class MockDirectory {
    readonly uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists(): boolean {
      return state.exists.get(this.uri) ?? false;
    }
    create(options?: unknown): void {
      state.createCalls.push({ uri: this.uri, options });
    }
    // A real Directory can also be deleted. Given here so a broken `item
    // instanceof File` guard in sweepPhotoFiles reveals itself as a recorded
    // deletion, rather than as a thrown-and-swallowed TypeError that happens
    // to leave `state.deleted` looking untouched either way.
    delete(): void {
      if (state.deleteThrows) throw new Error('delete failed');
      state.deleted.push(this.uri);
    }
    list(): unknown[] {
      if (state.dirListThrows.has(this.uri)) throw new Error('list failed');
      return state.dirListing.get(this.uri) ?? [];
    }
  }

  return { state, MockFile, MockDirectory, documentUri: 'file:///doc' };
});

vi.mock('expo-file-system', () => ({
  File: fsMock.MockFile,
  Directory: fsMock.MockDirectory,
  Paths: { document: new fsMock.MockDirectory(fsMock.documentUri) },
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

const DIR_URI = 'file:///doc/childPhotos';
const NOW = 1754179200000;

beforeEach(() => {
  fsMock.state.exists.clear();
  fsMock.state.dirListing.clear();
  fsMock.state.dirListThrows.clear();
  fsMock.state.deleted = [];
  fsMock.state.createCalls = [];
  fsMock.state.copyCalls = [];
  fsMock.state.copyThrows = false;
  fsMock.state.deleteThrows = false;
  Platform.OS = 'android';
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('persistPhotoFile', () => {
  it('creates the directory, copies to a name from photoFileName, and returns the target uri', async () => {
    const target = `${DIR_URI}/${photoFileName('pick.jpg', NOW)}`;

    const result = await persistPhotoFile('file:///cache/pick.jpg', 'pick.jpg');

    expect(fsMock.state.createCalls).toEqual([{ uri: DIR_URI, options: { intermediates: true, idempotent: true } }]);
    expect(fsMock.state.copyCalls).toEqual([{ from: 'file:///cache/pick.jpg', to: target, options: { overwrite: true } }]);
    expect(result).toBe(target);
  });

  it('returns undefined when the copy throws', async () => {
    fsMock.state.copyThrows = true;

    await expect(persistPhotoFile('file:///cache/pick.jpg', 'pick.jpg')).resolves.toBeUndefined();
  });

  it('does nothing and returns undefined on web', async () => {
    Platform.OS = 'web';

    await expect(persistPhotoFile('file:///cache/pick.jpg', 'pick.jpg')).resolves.toBeUndefined();
    expect(fsMock.state.createCalls).toEqual([]);
    expect(fsMock.state.copyCalls).toEqual([]);
  });
});

describe('reopenPhotoFile', () => {
  const stored = { uri: `${DIR_URI}/photo-1.jpg`, name: 'photo-1.jpg', type: 'image/jpeg' };

  it('returns undefined when the stored file no longer exists', () => {
    expect(reopenPhotoFile(stored)).toBeUndefined();
  });

  it('rebuilds a PickedPhoto whose nativeFile is the File, durable, carrying the stored name/type', () => {
    fsMock.state.exists.set(stored.uri, true);

    expect(reopenPhotoFile(stored)).toEqual({
      uri: stored.uri,
      name: stored.name,
      type: stored.type,
      nativeFile: new File(stored.uri),
      durable: true,
    });
  });

  it('returns undefined on web, without checking existence', () => {
    Platform.OS = 'web';
    fsMock.state.exists.set(stored.uri, true);

    expect(reopenPhotoFile(stored)).toBeUndefined();
  });
});

describe('discardPhotoFile', () => {
  const uri = `${DIR_URI}/a.jpg`;

  it('deletes the file when it exists', async () => {
    fsMock.state.exists.set(uri, true);

    await discardPhotoFile(uri);

    expect(fsMock.state.deleted).toEqual([uri]);
  });

  it('does not call delete when the file does not exist', async () => {
    await discardPhotoFile(uri);

    expect(fsMock.state.deleted).toEqual([]);
  });

  it('swallows a throw from delete', async () => {
    fsMock.state.exists.set(uri, true);
    fsMock.state.deleteThrows = true;

    await expect(discardPhotoFile(uri)).resolves.toBeUndefined();
  });

  it('does not delete on web', async () => {
    Platform.OS = 'web';
    fsMock.state.exists.set(uri, true);

    await discardPhotoFile(uri);

    expect(fsMock.state.deleted).toEqual([]);
  });
});

describe('sweepPhotoFiles', () => {
  it('deletes a file the keep list does not name, and keeps one it does', async () => {
    fsMock.state.exists.set(DIR_URI, true);
    const kept = new File(`${DIR_URI}/kept.jpg`);
    const orphan = new File(`${DIR_URI}/orphan.jpg`);
    fsMock.state.dirListing.set(DIR_URI, [kept, orphan]);

    await sweepPhotoFiles([kept.uri]);

    expect(fsMock.state.deleted).toEqual([orphan.uri]);
  });

  it('never deletes a Directory entry, even when the keep list does not name it', async () => {
    fsMock.state.exists.set(DIR_URI, true);
    const subdir = new Directory(`${DIR_URI}/sub`);
    fsMock.state.dirListing.set(DIR_URI, [subdir]);

    await sweepPhotoFiles([]); // nothing kept, but subdir is a Directory, not a File

    expect(fsMock.state.deleted).toEqual([]);
  });

  it('does nothing when the directory does not exist', async () => {
    // No entry in fsMock.state.exists for DIR_URI, so `dir.exists` reads false.
    await sweepPhotoFiles(['anything']);

    expect(fsMock.state.deleted).toEqual([]);
  });

  it('swallows a throw from list() without propagating', async () => {
    fsMock.state.exists.set(DIR_URI, true);
    fsMock.state.dirListThrows.add(DIR_URI);

    await expect(sweepPhotoFiles([])).resolves.toBeUndefined();
  });

  it('does nothing on web', async () => {
    Platform.OS = 'web';
    fsMock.state.exists.set(DIR_URI, true);
    fsMock.state.dirListing.set(DIR_URI, [new File(`${DIR_URI}/orphan.jpg`)]);

    await sweepPhotoFiles([]);

    expect(fsMock.state.deleted).toEqual([]);
  });
});
