# Show the running build's version in the app

**Status:** approved 2026-08-02, not yet implemented.

**Goal:** let anyone holding the app, or looking at the deployed web build, say
which build it is, without guessing.

## Why

Nothing in Budkin displays a version today. This has cost real time twice:

- During the 0.14.x photo investigation, neither the user nor the assistant
  could confirm which build was installed on the phone.
- On 2026-08-02, immediately after the 0.15.0 release, the deployed web app did
  not show the new History household view. The cause was that `budkin_web` was
  still running `git.karellievens.dev/karel/budkin:0.12.0`, three releases
  behind. Nothing in the UI could have revealed that, so the first hypotheses
  were about the feature's own gating rather than about the deployment.

The second case is the sharper one: a stale container is invisible, and every
minute spent on it is spent looking in the wrong place.

## The constraint that shapes everything

Budkin's release version is NOT in `package.json` or `app.json`. Both stay at
`1.0.0` permanently. The version is a lightweight git tag placed on a
`Merge branch '<feat>' into main (release X.Y.Z)` commit on `main`.

So the version has to come from git, and **git is not reachable from either
build**:

- `.dockerignore` excludes `.git`.
- `.easignore` excludes `.git/`.
- Worse, when building from a git worktree (which is how this work is done),
  `.git` is not a directory at all but a 4K file holding a pointer to the real
  repository elsewhere on disk. Shipping it would ship a dangling reference.
  The real `.git` in the primary checkout is 44M.

Reading git inside the build was therefore rejected outright, not merely
avoided. `git describe` DOES work on the host during `expo start`, and that is
the only place it is used.

## Approach

A single build-time environment variable, `BUDKIN_VERSION`, carrying the whole
display string (for example `0.15.0 (447f1a7)`). One variable rather than a tag
plus a separate short sha, so there is one concept to set and nothing to
recompose at the far end.

### Resolution order

`app.config.js` resolves it once, at config-evaluation time:

1. `process.env.BUDKIN_VERSION`, trimmed. Set by the release builds.
2. `git describe --tags --always --dirty`, in a `try`/`catch` with stderr
   suppressed. Succeeds on a host dev server; fails harmlessly in a container,
   where the git binary is not installed at all (`node:20-alpine`).
3. `undefined`, which the UI renders as `dev`.

It is published as `extra.version`, and read at runtime through
`Constants.expoConfig?.extra?.version`. That is the channel
`src/widgets/StatusWidget.tsx` already uses to read `scheme` back out of the
config, so this introduces no new mechanism.

### Why Docker can never lie

`docker-compose.yml` passes:

```yaml
args:
  BUDKIN_VERSION: ${BUDKIN_VERSION:-${TAG:?TAG is required}}
```

`TAG` is ALREADY mandatory for a compose build (the image name interpolates it
with `:?`). So a web build with no `BUDKIN_VERSION` set degrades to the tag it
is being published under, and a Docker build can never display `dev`. The exact
failure that motivated this spec, a container quietly serving an old version,
stops being silent.

In `Dockerfile.web` the `ARG`/`ENV` pair goes immediately before
`RUN npx expo export --platform web`, not near the top: an `ENV` invalidates
every layer after it, and putting it above `RUN npm ci` would rebuild the
dependency layer on every release.

### The APK path, and its accepted weakness

Release-flow step 5 gains `BUDKIN_VERSION` on the `eas build` command. There is
no equivalent of compose's mandatory `TAG` to fall back on, so forgetting it
yields a build labelled `Budkin dev`.

That is accepted deliberately. The alternative failure, a build confidently
displaying a version it is not, is worse than one that visibly says it does not
know. The mitigation is documentation, not code: the saved release-flow memory
carries the variable in the command.

## Components

### `src/lib/appVersion.ts` (new)

```
versionLabel(raw: string | undefined): string
```

Returns the COMPLETE drawn line, not a fragment, so the two screens that show
it cannot drift apart:

| `raw`                  | result                       |
| ---------------------- | ---------------------------- |
| `undefined`            | `Budkin dev`                 |
| `''` or whitespace     | `Budkin dev`                 |
| `0.15.0 (447f1a7)`     | `Budkin 0.15.0 (447f1a7)`    |
| `experimental (a9781a4)` | `Budkin experimental (a9781a4)` |

This module exists for one reason: `vitest.config.ts` matches
`src/**/*.test.ts` and never `.tsx`, so a rule left inside a screen cannot be
tested at all. Same precedent as `src/lib/logTargets.ts`,
`src/features/queue/queueView.ts` and `src/features/activity/queuedMarker.ts`.

### Screens

- `src/app/settings/index.tsx`: a dimmed, centred line at the foot of `body`,
  below the Baby Buddy section.
- `src/app/onboarding.tsx`: the same line.

Onboarding is included because Settings sits behind the connection gate: a
disconnected or fresh install routes to onboarding, so Settings would be
unreachable exactly when something is badly enough wrong to want the version.

Both call `versionLabel` on the constant. The line is static text, so it is
announced by a screen reader without any extra accessibility work.

## Testing

`src/lib/appVersion.test.ts` covers the four rows of the table above.

The two screens get browser verification (Expo web plus headless Playwright),
because nothing automated can reach a `.tsx` in this repo. Checking the web
build also exercises the compose wiring end to end: the line should read
`Budkin <tag>` when built through compose.

## Out of scope

- `package.json` and `app.json` stay at `1.0.0`. The version remains a git tag.
- No update check, no "a new version is available" prompt, no changelog link.
- No clipboard copy on the version line. `expo-clipboard` is not currently a
  dependency and this does not justify adding one.

## Follow-up this creates

The saved release-flow memory (`budkin-release-docker-flow`) must gain
`BUDKIN_VERSION` in steps 3 and 5, or the first release after this ships will
produce an APK labelled `dev`.
