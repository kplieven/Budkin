# Budkin

A native Android baby tracker: feeds, sleep, diapers, pumping, growth and
milestones. It needs no account and no network, and it doubles as a full client
for [Baby Buddy](https://github.com/babybuddy/babybuddy) if you host one.

Budkin is an unofficial client, built independently. It is not affiliated with
or endorsed by the Baby Buddy project.

- **Android:** [Google Play](https://play.google.com/store/apps/details?id=dev.karellievens.budkin)
- **Web:** self-host the web build with Docker (see below)
- **Site:** <https://budkin.karellievens.dev/>

## What it does

- Logs feeding, sleep, diapers, pumping, tummy time, bath, temperature,
  medication, notes and milestones. The common ones sit on the launcher icon as
  long-press shortcuts.
- Timers are flexible: fill in the details first, then start the timer. You can
  nudge either end by 5 or 15 minutes, set a duration outright, edit one that is
  already running, or turn a finished entry back into a timer when the nap
  resumes.
- History puts every entry on one timeline, filtered by child, day or activity.
- Insights shows four weeks of sleep, feeds and diapers side by side, with total
  sleep, longest night stretch, average wake window and per-day counts.
- Growth plots weight, height, head circumference and BMI against the WHO
  reference percentiles.
- 27 milestones, each with the age range it usually falls in, and a prompt when
  a window passes with nothing logged.
- Several children, one tap to switch, each with their own history.
- Home-screen widgets for the last feed, diaper and nap, plus a one-tap nap
  toggle that starts or stops a sleep timer without opening the app.
- Reminders for nap suggestions as the wake window closes, pumping intervals,
  treatment doses, due date, age milestones, and a timer left running. Each one
  is switched on or off on its own.
- Everything runs from the device, so losing signal changes nothing. With a
  server connected, whatever you log offline is queued and sent on reconnect,
  and the queue is inspectable in settings.
- Night and Daylight themes, metric or imperial units, and a configurable
  "day starts at" hour.

## Using it with Baby Buddy

On the welcome screen, tap **"Yes, I have a server"** and enter:

- your Baby Buddy URL (e.g. `https://baby.example.com` or `http://192.168.1.10:8000`)
- an API token, from Baby Buddy under **Settings > User > API**

Sync is two-way and automatic, with a manual refresh when you want it. Several
devices can work at once, so you can start a timer on one and end it on another.

The phone needs to reach the server: same LAN, VPN or a public hostname. Plain
`http://` LAN servers work on Android. iOS requires HTTPS or an ATS exception.

Tapping **"Just use this device"** skips all of that and keeps everything on the
phone. You can connect a server later, and you choose what happens to the
entries you already logged.

There is no Budkin account and no Budkin server. Your entries are only ever sent
to the address you type in. The app has no analytics, telemetry or third-party
SDKs.

## Self-hosting the web build

```sh
TAG=1.4.0 docker compose up -d --build
```

Serves the Expo web export on port `1235` behind nginx. `TAG` is required. It is
both the published image tag and the version the app reports on its settings
screen. The compose file points at a private registry by default, so change
`image:` to your own or just build locally as above.

I will look into building and pushing the built container to a registry and put a
compose file here instead. For now you'll have to build it yourself from the repo.

## Development

Node 22 (pinned in `.node-version`).

```sh
npm install
npm start          # Expo dev server
npm test           # vitest
npm run lint
```

`npx expo start --go` runs it in Expo Go, which is the fastest way onto a real
phone. Widgets, launcher shortcuts and background sync need a native build:

```sh
npm run prebuild:dev
npm run android:dev
```

Android release builds go through EAS (`eas.json`). `BUDKIN_VERSION` in the
production profile is what the app reports as its version.

## License

MIT, see [LICENSE](LICENSE).
