# Shipping Budkin to Google Play

Everything still outstanding between the current `main` and a public Play
listing. Written 2026-07-28 against Expo SDK 56 / EAS CLI 20.3.0.

## Already done

Nothing here needs revisiting.

- `eas.json` production profile builds an **`.aab`**, not an APK. Play refuses
  APKs for new apps, and this profile used to be pinned to `buildType: "apk"`.
- `cli.appVersionSource` is `remote`, so `autoIncrement` bumps `versionCode`
  server-side without a commit. Local `versionCode: 3` seeds it, so the first
  production build lands on **4**.
- `submit.production.android` is filled in (`track: internal`,
  `releaseStatus: draft`).
- Package name is **`dev.karellievens.budkin`**, locked in before first upload.
  This can never change once published.
- Deep-link scheme is `budkin://`, storage keys are `budkin.*.v1`.
- `targetSdk` is **36** via React Native 0.85's Gradle version catalog, which
  satisfies the 31 August 2026 requirement. Do not override it downward in
  `expo-build-properties`.
- Every icon is Budkin's own artwork, generated from `assets/brand/budkin-mark.svg`
  by `assets/brand/build-icons.py`: the 1024x1024 `icon.png`, the three Android
  adaptive layers, both splash marks, the favicon, and the 512x512
  `assets/brand/play-store-icon.png` for the listing. Re-run that script after any
  edit to the mark rather than touching the PNGs by hand.
- Splash is cream `#F6EDE3` with a dark-theme variant on `#16110E`. It was Expo
  blue `#208AEF` with Expo's own logo until the mark landed.
- Every Expo and React template asset has been deleted: the "Powered by Expo"
  badges, the Expo chevron, `logo-glow.png`, the three `react-logo*.png` files,
  the "Welcome to Expo" tutorial screenshot, `tabIcons/` (icons for the template's
  Home and Explore tabs, neither of which this app has), and `assets/expo.icon/`,
  which was Expo's Apple Icon Composer bundle. Nothing in `src/` loads an image at
  all, so every surviving asset is one `app.json` names. A web export was run
  afterwards to confirm the bundle still builds.

> **iOS icon note.** `app.json` no longer sets `ios.icon`, so iOS derives its icon
> from `icon.png`. If you ever ship on iOS and want the layered iOS 26 treatment,
> build a fresh `.icon` bundle in Apple's Icon Composer and point `ios.icon` at it.

## Monetisation: 2.00 EUR upfront

Decided 2026-07-30. Budkin ships as a **paid app at 2.00 EUR**: one purchase, no
subscription, no in-app purchase, no free tier. This needs no code. The binary is
identical either way, there is no billing library, and nothing in `src/` changes.

Play displays and collects VAT-inclusive prices in the EU, so a buyer sees 2.00
EUR flat and Google remits the VAT. The service fee is 15% on the first $1M per
year. Net is roughly **1.40 EUR** a sale, so the $25 registration fee is
recovered at about **18 sales**.

The goal is break-even, not income. That is what rules out the alternatives, both
of which were considered and rejected:

- **Free with a tip-jar in-app purchase**, which is what the iOS client Baby
  Buddy Companion does. Expo SDK 56 ships no in-app purchase module, so this
  needs RevenueCat or `react-native-iap`, a new custom dev client build, a Play
  Console product, and a restore-purchases path. Days of work and a permanent
  third-party dependency, to recover $25.
- **A hosted Baby Buddy service with per-seat tiers.** Baby Buddy is
  BSD-2-Clause, so hosting it commercially is legally clean, and nobody offers it
  today. It still fails, and the reason is distribution, not compliance:
  non-technical parents have never heard of Baby Buddy and do not search for it,
  so there is no organic demand channel, while everyone who knows the name can
  already self-host. Seat tiers have no cost basis either, because the cost
  driver is instances, not users. Beyond that it would make you a GDPR
  controller for Article 9 health data about children, with breach notification,
  erasure duties and VAT OSS filings, and it contradicts the "your data only
  goes to a server you control" line that carries the Data Safety form in step 6.

Two consequences to keep in view:

- **The private repo is load-bearing.** `LICENSE` is MIT, so publishing the
  source lets anyone build the APK and undercut the listing. Opening it up later
  is fine, but make that a deliberate choice rather than a side effect of a tidy-up.
- Play gives buyers a short self-service refund window, about two hours. Expect a
  little churn and do not read it as a signal.

## 1. Play Console account

- [ ] Register at https://play.google.com/console/signup. One-time **$25**.
- [ ] Complete identity verification. Personal accounts need a government ID and
      address; organisation accounts need a **D-U-N-S number**, which takes
      noticeably longer to obtain.
- [ ] Create the app. Package name must be exactly `dev.karellievens.budkin`.
      The creation flow asks free or paid: answer **paid**.
- [ ] Set up a **payments profile** (Setup > Payments profile). Selling a paid app
      is impossible without one, it wants bank and tax details, and verification is
      not instant. Start it early so it is not what holds up the launch.
- [ ] Set the price to **2.00 EUR** under **Monetize > Pricing** (the console
      spells it the American way), before the first upload creates a listing on
      any track.
- [ ] Add your own Google account to **Setup > License testing** while you are
      here. Everything downstream assumes it.

> **Free to paid is a one-way door.** Once the app has been offered free it can
> never carry an upfront price again. Only paid to free is reversible, and only
> in-app purchase stays available afterwards. Recovering from a free launch means
> a new package name, so a new listing with no install base and no reviews. This
> is why pricing sits here in step 1 and not with the store listing in step 6.

> **Account type decides your timeline.** If this is a *personal* account created
> after 13 November 2023, the closed-testing gate in step 7 applies and adds
> roughly three weeks. Organisation accounts and older personal accounts skip it.

## 2. Google service account key

Needed for `eas submit` to upload on your behalf.

- [ ] Create a project at https://console.cloud.google.com/projectcreate
- [ ] **IAM & Admin > Service Accounts > Create Service Account**. Copy its email.
- [ ] **Manage keys > Create new key > JSON**. Download it.
- [ ] Enable the
      [Google Play Android Developer API](https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com).
- [ ] Play Console > **Users and permissions > Invite new users**, paste the
      service account email, and grant:
      - App access: *View app information (read-only)*
      - Draft apps: *Edit and delete draft apps*
      - Releases: *Release to production*, *Release apps to testing tracks*,
        *Manage testing tracks*
      - Store presence: *Manage store presence*
- [ ] Save the JSON to `../play-service-account.json`, that is **outside** this
      repo, matching `serviceAccountKeyPath` in `eas.json`. `.gitignore` also
      covers `play-service-account.json` as a safety net.

## 3. Pre-flight before anyone reinstalls

The package rename means existing installs are treated as a **different app**.
Data does not migrate.

- [ ] Get the existing phone online and let the offline queue drain fully.
      `budkin.queue.v1` and `budkin.pendingOps.v1` are the only data with no
      server-side copy. Everything else (children, entries, measurements,
      timers, cures) re-syncs.
- [ ] Expect the **web** app to need a re-login plus re-setting theme/units and
      the saved server list. The storage keys moved but the origin did not, so
      its `localStorage` is orphaned in place. No data loss once the queue drained.

## 4. Build

```sh
eas build --platform android --profile production
```

Produces an `.aab` at `versionCode 4`. Verify in the build log that the artifact
is `.aab` and the applicationId is `dev.karellievens.budkin`.

## 5. First upload

```sh
eas submit --platform android --profile production
```

EAS Submit can create the very first release itself, so no manual upload is
required. It goes to the `internal` track as a `draft` per `eas.json`.

- [ ] Install from the internal track on a real device and confirm it runs,
      the widgets work, and `budkin://` deep links resolve. The listing is paid,
      so do this from an account on the **License testing** list or Play asks you
      to buy your own app.

## 6. Store listing

Assets:

- [x] App icon, 512x512 PNG. Already built at `assets/brand/play-store-icon.png`,
      with no alpha channel, which Play requires.
- [ ] Feature graphic, 1024x500.
- [ ] At least 2 phone screenshots. Add 7-inch and 10-inch tablet sets if you
      want tablet visibility.
- [ ] Short description, max 80 characters.
- [ ] Full description, max 4000 characters.

Four that are specific to Budkin and easy to get rejected on:

- [ ] **Privacy policy URL.** Mandatory and must be publicly reachable. Host it
      on the existing web deploy (Caddy to the nginx container, see
      `docker-compose.yml`), for example at `/privacy`.
- [ ] **App access.** Budkin normally talks to a self-hosted Baby Buddy server,
      which a reviewer does not have. State explicitly that **Local mode needs no
      account and no server**, and give the exact tap path to reach it. Skipping
      this earns a "login required, no credentials supplied" rejection.
- [ ] **Data safety form.** Declare the photo picker, camera and notifications.
      Be precise that child data is stored on-device and synced only to a
      **user-supplied** server, never to you. Child and health data draw extra
      scrutiny. Run `npx expo prebuild -p android` once and read the generated
      `android/app/src/main/AndroidManifest.xml` so the permissions you declare
      match what actually ships.
- [ ] **Naming.** Do not imply official Baby Buddy affiliation anywhere in the
      title, description or graphics. "Unofficial client for Baby Buddy" is the
      safe phrasing.

Also required before you can publish:

- [ ] Content rating questionnaire.
- [ ] Target audience. Declaring a child audience pulls you into the Families
      policy programme, which is a much heavier compliance burden. The app is
      used by parents, so declare adults.
- [ ] Ads declaration (none).
- [ ] Government apps declaration (no).

## 7. Closed testing gate

Only if the account-type condition in step 1 applies.

- [ ] Promote a build to a **closed** testing track.
- [ ] **Add every tester to Setup > License testing before you invite them.** The
      app is paid, so a tester who is not on that list is asked to pay 2.00 EUR to
      help you. Confirm one tester can install without being charged before the
      14-day count starts.
- [ ] Recruit **at least 12 testers** who opt in and stay opted in for **14
      continuous days**. Continuous, not cumulative. Losing testers resets you.
- [ ] After 14 days, Dashboard > **Apply for production**. You answer three
      sections: how you recruited testers and what feedback you got, who the app
      is for and its value, and what changed as a result of testing.
- [ ] Wait for review, typically up to 7 days.

## 8. Production

- [ ] Change `track` to `production` in `eas.json`, or promote the release in
      the console.
- [ ] Consider `releaseStatus: "inProgress"` with a `rollout` fraction (0 to 1)
      for a staged rollout instead of going straight to 100%.
- [ ] First production review is usually slower than later updates. Budget days,
      not hours.

## Optional: the EAS slug

`app.json` still has `"slug": "babybuddy-mobile"`. It is an expo.dev-internal
name that never reaches users, so this is cosmetic.

If you do want it renamed, **order matters**: rename the project on expo.dev
first, then update `app.json` to match. Reversing that hard-errors every build
with *"Slug for project identified by extra.eas.projectId does not match the slug
field"*. The `projectId` and build history survive a rename, and push
notifications key off `originalFullName`, which does not change.

## Gotchas worth remembering

- **Free to paid is irreversible.** The third permanent decision here, alongside
  the package name and `versionCode`. A free launch can never be given an upfront
  price later. See *Monetisation* at the top.
- **`versionCode` only ever goes up.** Play rejects a re-used or lower one.
  `appVersionSource: remote` handles this, but do not hand-edit it back down.
- **The upload key is permanent-ish.** Enrol in Play App Signing on first upload
  so a lost upload key can be reset by Google.
- **`usesCleartextTraffic: true`** stays for LAN Baby Buddy servers. Legitimate,
  but expect a pre-launch report warning. Not a blocker.
- **Docker tags and git tags now disagree by one major version.** Images
  `git.karellievens.dev/karel/budkin:1.5.x` correspond to git tags `0.5.x` after
  the pre-production retag. `1.0.0` is the first version where both agree.
- **Releases are git tags on main-merge commits**, not `package.json`. Tag after
  merging, and `TAG=<version> docker compose build` builds the working tree.
