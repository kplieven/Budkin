# In-App Version Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show which build is running, at the foot of Settings and on the onboarding screen, so a stale install or a stale container can be identified at a glance.

**Architecture:** A single build-time environment variable `BUDKIN_VERSION` carries the whole display string. `app.config.js` resolves it (env var, then `git describe` on a host dev server, then nothing) and publishes it as `extra.version`. A pure module turns that into the drawn line so the rule is testable, since vitest cannot load a `.tsx`. `docker-compose.yml` feeds the variable from the `TAG` it already requires, which is what makes a silently mislabelled web build impossible.

**Tech Stack:** React Native 0.85 + Expo SDK 56, expo-router, expo-constants, vitest (node env), Docker + compose, EAS local builds.

Spec: `docs/superpowers/specs/2026-08-02-app-version-display-design.md`.

## Global Constraints

- **Branch:** `feat/app-version-display`, already created off the 0.15.0 release merge `447f1a7`. Never commit to `main`.
- **Verification Gate** (all three, at the end of every task):
  - `npm test`
  - `npx tsc --noEmit`
  - `npm run lint`
  Note `npm test` does NOT typecheck, and `npm run lint` exits 0 even with warnings. Check all three. A pre-existing unused-import warning in `src/api/client.test.ts` is expected and is not yours.
- **`vitest.config.ts` matches `src/**/*.test.ts` ONLY, never `.tsx`.** Any rule you want tested must live in a pure `.ts` module.
- **zustand v5:** never return a NEW reference from a `useAppStore` selector. Not expected to come up here (nothing in this feature reads the store), but it blanks the web routes at runtime with no test catching it.
- **No em-dashes** in comments, commit messages or UI copy.
- **`package.json` and `app.json` stay at `1.0.0`.** The release version is a git tag; do not "fix" those files.
- **Baseline:** `feat/app-version-display` @ `54357e9`, 69 test files, 1958 tests green.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/appVersion.ts` (create) | The one rule: raw config value to drawn line. Pure, no imports from the app. |
| `src/lib/appVersion.test.ts` (create) | Covers that rule, including the absent/blank cases. |
| `app.config.js` (modify) | Resolve the version once at config-evaluation time, publish as `extra.version`. |
| `Dockerfile.web` (modify) | Accept `ARG BUDKIN_VERSION`, expose as `ENV` for the export step. |
| `docker-compose.yml` (modify) | Pass the arg, defaulting to the already-mandatory `TAG`. |
| `src/app/settings/index.tsx` (modify) | Draw the line at the foot of `body`. |
| `src/app/onboarding.tsx` (modify) | Draw the same line. |

---

## Task 1: The version label rule

**Files:**
- Create: `src/lib/appVersion.ts`
- Test: `src/lib/appVersion.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `versionLabel(raw: string | undefined): string`, used by Tasks 4 and 5.

- [ ] **Step 1: Write the failing test**

Create `src/lib/appVersion.test.ts`:

```ts
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
    // A dev server with no git, or a build whose env var was never set. Saying
    // "dev" is the point: it reads as obviously unknown rather than quietly
    // claiming a version this build is not.
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
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/lib/appVersion.test.ts`

Expected: FAIL, cannot resolve `@/lib/appVersion`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/appVersion.ts`:

```ts
/**
 * The build's version, as the single line both screens draw.
 *
 * Returns the COMPLETE line rather than a fragment, so Settings and onboarding
 * cannot drift apart: there is one string, built once, and neither screen
 * decides anything about it.
 *
 * Kept out of the `.tsx` files because `vitest.config.ts` only matches
 * `.test.ts`: a rule living in a component is untestable by convention here
 * (same reason `src/lib/logTargets.ts` and
 * `src/features/activity/queuedMarker.ts` exist).
 *
 * `raw` is whatever `app.config.js` resolved into `extra.version`: the
 * `BUDKIN_VERSION` the build was given, else a host `git describe`, else
 * nothing. Absent, empty and whitespace all mean the same thing and all render
 * as "dev", which is deliberate. A build that cannot say what it is should look
 * obviously unknown rather than quietly claim a version it is not, because the
 * whole point of showing a version is to be believed.
 */
export function versionLabel(raw: string | undefined): string {
  const version = raw?.trim();
  return `Budkin ${version ? version : 'dev'}`;
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/lib/appVersion.test.ts`

Expected: PASS, 5 tests.

- [ ] **Step 5: Run the full verification gate**

```bash
npm test && npx tsc --noEmit && npm run lint
```

Expected: 69+ files pass with 1963 tests, tsc silent (exit 0), lint 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/appVersion.ts src/lib/appVersion.test.ts
git commit -m "feat(version): the one rule turning a build's version into its drawn line"
```

---

## Task 2: Resolve the version in `app.config.js`

**Files:**
- Modify: `app.config.js`

**Interfaces:**
- Consumes: `versionLabel` is NOT used here. This task only produces the raw string.
- Produces: `extra.version` on the Expo config, a `string | undefined`, read at runtime by Tasks 4 and 5 via `Constants.expoConfig?.extra?.version`.

There is no unit test for this step: `app.config.js` is build tooling, outside `src/`, and `vitest.config.ts` does not match it. It is verified by observation in Step 3 and end to end in Task 6.

- [ ] **Step 1: Add the resolver**

Modify `app.config.js`. Add at the top, after the existing `IS_DEV` const:

```js
/**
 * The build's version, resolved once here and published as `extra.version` for
 * `versionLabel` (src/lib/appVersion.ts) to draw.
 *
 * It cannot come from `package.json` or `app.json`: both stay at 1.0.0
 * permanently, because Budkin's release version is a lightweight git tag on a
 * merge commit on `main`.
 *
 * It cannot be read from git inside a build either. `.dockerignore` and
 * `.easignore` both exclude `.git`, and when building from a git WORKTREE
 * `.git` is not a directory at all but a small file pointing at the real
 * repository elsewhere on disk, so shipping it would ship a dangling
 * reference. Hence the environment variable, which the build sets: see
 * `docker-compose.yml`, where it defaults to the TAG that a compose build
 * already cannot omit.
 *
 * The `git describe` below is therefore ONLY for a dev server running on a
 * host that has the repository. It fails harmlessly everywhere else: in the
 * web image the git binary is not even installed (node:20-alpine).
 */
const gitDescribe = () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('node:child_process')
      .execSync('git describe --tags --always --dirty', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
};

const VERSION = process.env.BUDKIN_VERSION?.trim() || gitDescribe() || undefined;
```

- [ ] **Step 2: Publish it on the config**

In the same file, inside the returned object, add an `extra` key. The existing
return already spreads `config`, so `extra` must spread `config.extra` first or
any other extra key (expo-router and EAS both write there) is dropped:

```js
export default ({ config }) => ({
  ...config,
  // ... existing name / scheme / android keys stay exactly as they are ...
  extra: {
    ...config.extra,
    // Read back at runtime with `Constants.expoConfig?.extra?.version`, the
    // same channel StatusWidget.tsx uses to read `scheme`.
    version: VERSION,
  },
});
```

- [ ] **Step 3: Verify the resolver by observation**

Run, from the repo root:

```bash
node -e "const c=require('./app.json').expo; import('./app.config.js').then(m=>console.log(JSON.stringify(m.default({config:c}).extra)))"
```

Expected: an object whose `version` is the current `git describe --tags --always --dirty` output (something like `0.15.0-1-g54357e9`), because no `BUDKIN_VERSION` is set in this shell.

Then confirm the env var wins:

```bash
BUDKIN_VERSION="9.9.9 (deadbee)" node -e "const c=require('./app.json').expo; import('./app.config.js').then(m=>console.log(JSON.stringify(m.default({config:c}).extra)))"
```

Expected: `version` is exactly `9.9.9 (deadbee)`.

If the first command errors on ESM/CJS interop, fall back to checking the value through the running dev server in Task 6 and note it; do not change the config's module format to work around it.

- [ ] **Step 4: Run the full verification gate**

```bash
npm test && npx tsc --noEmit && npm run lint
```

Expected: unchanged from Task 1 (1963 tests), tsc silent, lint 0 errors.

- [ ] **Step 5: Commit**

```bash
git add app.config.js
git commit -m "feat(version): resolve the build version into the Expo config"
```

---

## Task 3: Wire the version through the web build

**Files:**
- Modify: `Dockerfile.web`
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: `BUDKIN_VERSION`, read by `app.config.js` from Task 2.
- Produces: nothing for later tasks. Verified in Task 6.

- [ ] **Step 1: Accept the arg in the Dockerfile**

Modify `Dockerfile.web`. The `ARG`/`ENV` pair goes immediately before the export
step, NOT near the top: an `ENV` invalidates every layer below it, so placing it
above `RUN npm ci` would rebuild the dependency layer on every release.

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# The version this image will be published under, read by app.config.js. Set
# from compose, which defaults it to the mandatory TAG, so a web build can
# never label itself "dev". Declared here rather than above `npm ci` because an
# ENV invalidates every layer below it and the dependency layer must not rebuild
# on every release.
ARG BUDKIN_VERSION
ENV BUDKIN_VERSION=$BUDKIN_VERSION
RUN npx expo export --platform web
```

- [ ] **Step 2: Pass it from compose**

Modify `docker-compose.yml`:

```yaml
services:
  budkin:
    build:
      context: .
      dockerfile: Dockerfile.web
      args:
        # Falls back to the TAG this image is published under, which compose
        # already refuses to build without (see `image:` below). That fallback
        # is the point: a web build cannot label itself "dev", so a container
        # left running an old image says so on screen. Set BUDKIN_VERSION
        # explicitly to add the short sha, e.g. "0.15.1 (abc1234)".
        BUDKIN_VERSION: ${BUDKIN_VERSION:-${TAG:?TAG is required}}
    image: git.karellievens.dev/karel/budkin:${TAG:?TAG is required}
    container_name: budkin_web
    ports:
      - "1235:80"
    restart: unless-stopped
```

- [ ] **Step 3: Verify compose still resolves and still refuses without TAG**

```bash
TAG=0.0.0-test docker compose config | grep -A3 args
```

Expected: `BUDKIN_VERSION: 0.0.0-test`.

```bash
BUDKIN_VERSION="0.0.0 (test123)" TAG=0.0.0-test docker compose config | grep -A3 args
```

Expected: `BUDKIN_VERSION: 0.0.0 (test123)`, the explicit value winning.

```bash
docker compose config >/dev/null 2>&1; echo "exit=$?"
```

Expected: non-zero. With no `TAG`, compose must still fail. If this exits 0 the
mandatory-TAG guarantee is broken and the fallback is worthless.

- [ ] **Step 4: Run the full verification gate**

```bash
npm test && npx tsc --noEmit && npm run lint
```

Expected: unchanged, tsc silent, lint 0 errors.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile.web docker-compose.yml
git commit -m "feat(version): feed the web build its version from the tag it ships under"
```

---

## Task 4: Draw the version at the foot of Settings

**Files:**
- Modify: `src/app/settings/index.tsx`

**Interfaces:**
- Consumes: `versionLabel` from Task 1, `extra.version` from Task 2.
- Produces: nothing.

No unit test is possible: `vitest.config.ts` never loads a `.tsx`. Task 6 covers both screens in a browser.

- [ ] **Step 1: Add the imports**

In `src/app/settings/index.tsx`, add alongside the existing imports:

```ts
import Constants from 'expo-constants';

import { versionLabel } from '@/lib/appVersion';
```

- [ ] **Step 2: Draw the line at the end of `body`**

Find the end of the `body` JSX. It currently closes with the "How Budkin works"
group followed by `</>`:

```tsx
      </View>
    </>
  );
```

Change it to:

```tsx
      </View>

      {/* Which build this is. Last thing on the screen, dimmed and centred, so
          it reads as a footer rather than as a setting. It exists because
          nothing else in the app can answer the question: a stale install and a
          container left on an old image are both completely invisible
          otherwise, and both have cost real time. See src/lib/appVersion.ts. */}
      <Txt weight={500} size={12.5} color={t.faint} style={{ textAlign: 'center', marginTop: 18, marginBottom: 4 }}>
        {versionLabel(Constants.expoConfig?.extra?.version)}
      </Txt>
    </>
  );
```

- [ ] **Step 3: Run the full verification gate**

```bash
npm test && npx tsc --noEmit && npm run lint
```

Expected: unchanged, tsc silent, lint 0 errors.

If tsc complains that `extra` is of type `unknown` or that the index signature
is implicit, cast at the read site rather than widening the config types:
`Constants.expoConfig?.extra?.version as string | undefined`.

- [ ] **Step 4: Commit**

```bash
git add src/app/settings/index.tsx
git commit -m "feat(version): show the running build at the foot of Settings"
```

---

## Task 5: Draw the version on onboarding

**Files:**
- Modify: `src/app/onboarding.tsx`

**Interfaces:**
- Consumes: `versionLabel` from Task 1, `extra.version` from Task 2.
- Produces: nothing.

- [ ] **Step 1: Add the imports**

In `src/app/onboarding.tsx`, add alongside the existing imports:

```ts
import Constants from 'expo-constants';

import { versionLabel } from '@/lib/appVersion';
```

- [ ] **Step 2: Draw the line below the "Learn how to host one" text**

The screen currently ends with the "Don't have a server?" paragraph and then
closes the `ScrollView`:

```tsx
          Learn how to host one
        </Txt>
      </Txt>
    </ScrollView>
  );
}
```

Change it to:

```tsx
          Learn how to host one
        </Txt>
      </Txt>

      {/* Repeated from Settings deliberately. Settings sits behind the
          connection gate, so a disconnected or fresh install routes here and
          can never reach it, which is exactly the state in which someone needs
          to know what they are running. */}
      <Txt weight={500} size={12.5} color={t.faint} style={{ textAlign: 'center', marginTop: 22 }}>
        {versionLabel(Constants.expoConfig?.extra?.version)}
      </Txt>
    </ScrollView>
  );
}
```

- [ ] **Step 3: Run the full verification gate**

```bash
npm test && npx tsc --noEmit && npm run lint
```

Expected: unchanged, tsc silent, lint 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/onboarding.tsx
git commit -m "feat(version): show the running build on the connect screen too"
```

---

## Task 6: Verify both screens in a browser

**Files:** none modified. This task is verification only.

Nothing automated can reach a `.tsx` in this repo, so this is the only coverage
these two screens get. It also exercises Task 2's resolver end to end.

**Critical setup note:** a stale `expo start` holding the port makes a new one
print `Skipping dev server` and silently serve the OLD bundle, which produces
confident and wrong results. Always confirm the port is free first and grep the
log for that string.

- [ ] **Step 1: Confirm nothing is holding the port**

```bash
ss -lptnH 2>/dev/null | grep 8099 && echo "STILL HELD, kill the pid above" || echo "port free"
```

- [ ] **Step 2: Start the dev server with a known version**

```bash
BUDKIN_VERSION="0.0.0 (probe123)" CI=1 npx expo start --web --port 8099 --clear > /tmp/expo-version.log 2>&1 &
sleep 40
grep -c "Skipping dev server" /tmp/expo-version.log
```

Expected: `0`. Anything else means the server did not start and every later
observation is stale.

- [ ] **Step 3: Read the version off the onboarding screen**

With no connection stored, `/` routes to onboarding. Using headless Playwright
(`--no-sandbox`), load `http://localhost:8099/onboarding` and read
`document.body.innerText`.

Expected: it contains `Budkin 0.0.0 (probe123)`.

This simultaneously proves that `BUDKIN_VERSION` reaches `extra.version`
(Task 2) and that `versionLabel` draws it (Tasks 1 and 5).

- [ ] **Step 4: Read the version off Settings**

Load `http://localhost:8099/settings`, scroll to the bottom, read
`document.body.innerText`.

Expected: it contains `Budkin 0.0.0 (probe123)`.

- [ ] **Step 5: Confirm the "dev" fallback renders**

Stop the server (kill the PID listening on 8099, do NOT use
`pkill -f "expo start"`: that pattern matches the invoking shell's own command
line and kills it). Restart WITHOUT the variable, in a directory where
`git describe` also fails, or simply confirm that the label shows the git
description rather than a blank:

```bash
BUDKIN_VERSION="" CI=1 npx expo start --web --port 8099 --clear > /tmp/expo-version2.log 2>&1 &
```

Expected on screen: `Budkin <git describe output>`, e.g. `Budkin 0.15.0-4-gXXXXXXX`.
Never a bare `Budkin` with a dangling space, which is the blank-string case
Task 1 pins.

- [ ] **Step 6: Stop the server**

Kill by PID (from `ss -lptnH | grep 8099`), never by `pkill -f "expo start"`.

- [ ] **Step 7: Commit nothing, report findings**

This task produces no diff. Report what the two screens showed.

---

## Task 7: Update the saved release flow

**Files:**
- Modify: `/home/karlie/.claude/projects/-home-karlie-Repositories-budkin/memory/budkin-release-docker-flow.md`

This is outside the repo and is NOT committed to git. It is the last task
because the spec names it as the follow-up this feature creates: without it, the
first release after this ships produces an APK labelled `dev`.

- [ ] **Step 1: Add the variable to step 5**

In the memory file, change the step 5 command so it carries the version:

```
BUDKIN_VERSION="X.Y.Z (<mergeShortSha>)" ANDROID_HOME=/home/karlie/Android/Sdk
JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 npx eas build --platform android
--profile preview --local
--output /home/karlie/Downloads/budkin-builds/budkin-preview-<mergeShortSha>.apk
```

- [ ] **Step 2: Note what step 3 does automatically**

Add to step 3, so nobody adds a variable that is already handled:

```
3. `TAG=X.Y.Z docker compose build`. The image labels itself from TAG
   automatically (compose passes it as BUDKIN_VERSION), so the web build can
   never show "dev". Export BUDKIN_VERSION="X.Y.Z (<sha>)" first if you want
   the sha on screen too.
```

- [ ] **Step 3: Add the deploy step that this release exposed**

The flow's six steps build and push the image but never restart the container,
which is how a container sat on 0.12.0 for three releases. Add:

```
7. Deploy the web image: `TAG=X.Y.Z docker compose up -d`, then confirm the
   running image with
   `docker ps --format '{{.Names}}\t{{.Image}}' | grep budkin`.
   Steps 1-6 only PUBLISH the image; nothing restarts the container on its own.
```

- [ ] **Step 4: Report the change**

No git commit. Report that the memory was updated.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
| --- | --- |
| `BUDKIN_VERSION` env var carrying the whole string | 2 |
| Resolution order: env var, `git describe`, undefined | 2 |
| Published as `extra.version`, read via `expo-constants` | 2, 4, 5 |
| Docker can never show `dev` (compose defaults to `TAG`) | 3 (Step 3 asserts it) |
| `ARG`/`ENV` placed so `npm ci` is not invalidated | 3 |
| APK path gains the variable, may show `dev` if forgotten | 7 |
| `versionLabel` returns the complete line | 1 |
| Table of four cases (undefined, empty, real, rolling tag) | 1 (five tests, blank added) |
| Module exists because vitest cannot load `.tsx` | 1 (stated in its doc comment) |
| Settings foot, dimmed and centred | 4 |
| Onboarding, because Settings is behind the connection gate | 5 |
| Browser verification of both screens | 6 |
| `package.json`/`app.json` stay at 1.0.0 | Global Constraints |
| Release-flow memory updated | 7 |

**Placeholder scan:** no TBD/TODO, no "add error handling", no "similar to Task N". Every code step carries the literal code.

**Type consistency:** `versionLabel(raw: string | undefined): string` is defined in Task 1 and called with exactly that type in Tasks 4 and 5. `extra.version` is written in Task 2 and read at that path in Tasks 4 and 5. `BUDKIN_VERSION` is spelled identically in Tasks 2, 3, 6 and 7.

**One addition beyond the spec:** Task 7 Step 3 adds a deploy step to the release flow. The spec's follow-up section names only the `BUDKIN_VERSION` gap, but the incident that motivated the whole feature was an undeployed image, and a version label that correctly reports 0.12.0 still leaves the container un-restarted. Flagged here rather than done silently.
