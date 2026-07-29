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
});
