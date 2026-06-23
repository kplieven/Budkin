# Running Baby Buddy mobile on your phone

> Use **Node 22 LTS** for all commands. This repo pins it via `.node-version`; with
> `fnm`/`nvm` configured for auto-switch it happens on `cd`. Otherwise: `fnm use 22`.

You have two ways to run on a real device. Both connect the app to your own
Baby Buddy server — on the onboarding screen enter the server URL and an API
token (Baby Buddy → **Settings → User → API**).

The phone must be able to reach your server (same Wi-Fi / VPN / public URL).

---

## Option A — Expo Go (fastest, no build)

Good for quick testing. Every native module this app uses ships inside Expo Go.

1. Install **Expo Go** on the phone (App Store / Google Play).
2. Start the bundler:
   ```bash
   npx expo start --go
   ```
   (Plain `npx expo start` now defaults to the dev build since `expo-dev-client`
   is installed — `--go`, or pressing `s` in the terminal, switches to Expo Go.)
3. Scan the QR code: iOS = Camera app, Android = Expo Go's scanner.
   - Not on the same Wi-Fi? Add `--tunnel` (installs `@expo/ngrok` on first use).

iPhone note: Expo Go is the easiest iOS path (a dev build on a physical iPhone
needs a paid Apple Developer account).

---

## Option B — EAS development build (recommended for ongoing use)

A standalone dev client built in Expo's cloud (no local Android Studio / Xcode).

1. Install the CLI and sign in (free Expo account):
   ```bash
   npm i -g eas-cli
   eas login
   eas init          # links the project, writes extra.eas.projectId into app.json
   ```
2. Build the dev client:
   ```bash
   # Android -> produces an installable .apk
   eas build --profile development --platform android

   # iOS (physical device) -> requires a paid Apple Developer account
   eas build --profile development --platform ios
   ```
3. Install the build on the phone (Android: download the APK link, allow
   "install unknown apps").
4. Run the bundler and open the dev build:
   ```bash
   npx expo start --dev-client
   ```

---

## Talking to a self-hosted (HTTP) server

If your Baby Buddy runs over plain **http://** on your LAN:

- **Expo Go**: works as-is (it permits cleartext traffic).
- **Dev build (Android)**: enabled here via `expo-build-properties`
  (`android.usesCleartextTraffic: true` in `app.json`). Remove it if you serve
  over HTTPS.
- **Dev build (iOS)**: iOS App Transport Security blocks plain HTTP. For a local
  HTTP server add an ATS exception under `ios.infoPlist.NSAppTransportSecurity`
  in `app.json`, or (recommended) put the server behind HTTPS.

## Config worth knowing

- Bundle id / package: `eu.steeldesignce.babybuddy` (`app.json`) — change before
  any store submission.
- New Architecture + Reanimated 4 are enabled (SDK 56 default). The splash
  screen / icons are still the Expo template defaults — rebrand when ready.
