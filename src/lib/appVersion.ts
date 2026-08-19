/**
 * `raw` is whatever `app.config.js` resolved into `extra.version`: the `BUDKIN_VERSION`
 * the build was given, else a host `git describe`, else nothing. Absent, empty and
 * whitespace all render as "dev", so a build that cannot say what it is looks obviously
 * unknown rather than quietly claiming a version it is not.
 */
export function versionLabel(raw: string | undefined): string {
  const version = raw?.trim();
  return `Budkin ${version ? version : 'dev'}`;
}
