// Imported, never `require`d: this file is ESM (see `export default` below), and
// Expo loads it through a transpiler in which `require` is not defined. A
// `require` here does not fail loudly, it throws into `gitDescribe`'s own catch
// and silently yields no version at all, which is how the dev fallback came to
// look like it worked while `expo config` reported no `extra.version` key.
import { execSync } from 'node:child_process';

/**
 * Variant overlay on top of app.json, which stays the source of truth for
 * everything shared. Expo reads app.json first and hands it here as `config`.
 *
 * A development build takes its own applicationId so it installs ALONGSIDE the
 * release app rather than colliding with it: the two are signed with different
 * keys, so Android refuses to update one with the other.
 *
 * Set by the `*:dev` package.json scripts and by eas.json's development
 * profile. Unset means release, so nothing about the shipped app changes.
 */
const IS_DEV = process.env.APP_VARIANT === 'development';

/**
 * The build's version, resolved once here and published as `extra.version` for
 * `versionLabel` (src/lib/appVersion.ts) to draw.
 *
 * It cannot come from `package.json`, which stays at 1.0.0 permanently and is
 * read by nothing. `app.json`'s `version` DOES track the release now — it is
 * the Android `versionName` and the iOS `CFBundleShortVersionString`, i.e. the
 * only one of these numbers a buyer ever sees — so bump it with each tag. It
 * still cannot be the source here, because a dev build wants the precise
 * `git describe` (`1.3.0-4-gabc123-dirty`), not the flat release number.
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
    return execSync('git describe --tags --always --dirty', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
};

const VERSION = process.env.BUDKIN_VERSION?.trim() || gitDescribe() || undefined;

export default ({ config }) => ({
  ...config,
  // Distinguishable in the launcher and the app switcher, where both variants
  // otherwise show the same icon and name.
  name: IS_DEV ? 'Budkin (dev)' : config.name,
  // Its own scheme, not just its own package. Two installed apps declaring
  // `babybuddy://` would make every widget deep link ambiguous, and Android can
  // remember the release app as the default, which would silently send the dev
  // build's widget buttons to the wrong app. StatusWidget.tsx reads the active
  // scheme back out of expo-constants rather than hardcoding it.
  scheme: IS_DEV ? 'budkindev' : config.scheme,
  android: {
    ...config.android,
    package: IS_DEV ? 'dev.karellievens.budkin.dev' : config.android.package,
  },
  extra: {
    // Spread first: expo-router and EAS both write their own keys here, and
    // replacing the object wholesale would drop them.
    ...config.extra,
    // Read back at runtime with `Constants.expoConfig?.extra?.version`, the
    // same channel StatusWidget.tsx uses to read `scheme`.
    version: VERSION,
  },
});
