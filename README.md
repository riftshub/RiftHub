# THE BACKROOMS — Co-op Horror

A first-person Backrooms horror game for web and Android, with online co-op through a server you host on Render.

- **26 levels** (Level 0 "The Lobby" through Level 25 "Run For Your Life"), each with its own look, lighting, sound mood and danger.
- **Random map generation**: 12 generator types (mazes, office rooms, hotel halls, caves, warehouse pillars, city blocks, wheat fields, stockroom aisles, pool rooms…). Every visit builds a brand-new layout. Co-op players share the seed, so everyone sees the same map.
- **14 entities, none tied to a level** — any of them can spawn anywhere, and the roster rotates while you play:
  | Entity | Rule |
  |---|---|
  | Smiler | Lives in the dark. Comes *to* flashlights. Shine it too long and it charges. |
  | Hound | Hunts by sight and sound. Hears you sprint from far away. Sometimes peeks first. |
  | Howler | Only moves when nobody is looking at it. |
  | Partygoer | Peeks around corners, giggles, then either vanishes or charges. |
  | Skin-Stealer | Looks like a lost wanderer until you get close. |
  | Faceling | Harmless… unless you stare at it too long. |
  | Clump | Slow, but never stops following. |
  | Deathmoth | Hangs near the ceiling, dives at lights and noise. |
  | Wretch | Hunched hunter that tracks by sight. |
  | Pale Man | Appears at the edge of your view. Ignore him and he comes closer. Stare him down. |
  | Crawler | Waits on the ceiling and drops on you. |
  | Shadow | Peeks, whispers, drains sanity — and occasionally attacks. |
  | Hollow | A mannequin that moves only in darkness. Keep a light on it. |
  | Screamer | Appears right in front of you and screams. Shreds sanity. |
- **Jumpscares**, peeking around corners, chases with adaptive music, light flicker when something is close, random blackouts, and **hallucinations** at low sanity.
- **Infinite flashlight**, stamina, sanity, almond water, lore notes, crouching, head-bob, a secret noclip.
- **All audio is generated live** with Web Audio: fluorescent hum, footsteps per surface (carpet/concrete/metal/tile/wood/dirt/water), breathing and heartbeat that react to fear, 3D HRTF entity voices with wall muffling, per-level reverb, drips, distant knocks, chase music, jumpscare stingers.
- **All graphics are generated too**: a custom WebGL2 renderer with baked lighting, ambient occlusion and light-blocking by walls, per-pixel flashlights (yours and your friends'), animated water, procedural textures and entity sprites, and a found-footage post effect (grain, chromatic aberration, vignette, VHS tearing).
- **Zero dependencies.** No npm packages are needed to run the server or the game.

---

## 1. Run it on your computer

```bash
node server/server.js
```
Open http://localhost:10000. Co-op works between browsers on the same machine.

Controls: WASD move · mouse look · Shift run · C/Ctrl crouch · F or left-click flashlight · E or right-click use · Q drink almond water · Esc pause. On phones there's a virtual joystick and buttons.

## 2. Put the co-op server on Render

1. Push this folder to a GitHub repo.
2. On https://render.com: **New → Blueprint**, pick the repo (it reads `render.yaml`).
   Or **New → Web Service** with Start Command `node server/server.js` and Health Check Path `/health`.
3. When it's live you get a URL like `https://backrooms-coop.onrender.com`. Opening that URL in a browser plays the game and co-op works right away.

Free Render instances sleep after ~15 minutes idle. The game wakes the server automatically and shows "Waking the co-op server…" — the first connection can take up to a minute.

## 3. Make the APK

**First**, put your Render URL in `www/js/config.js`:
```js
export const DEFAULT_SERVER = 'https://backrooms-coop.onrender.com';
```
(Players can also change it in Settings → Co-op server URL.)

### Easiest: GitHub builds it for you
The workflow in `.github/workflows/build-apk.yml` runs on every push. Go to your repo → **Actions** → **Build Android APK** → the latest run → download **backrooms-coop-apk**. Unzip, copy `app-debug.apk` to your phone and install it (allow "install unknown apps").

### Or build locally
Needs Node 20+, JDK 21 and the Android SDK (Android Studio installs it).
```bash
bash tools/android-setup.sh
cd android && ./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```
The setup script locks the app to landscape, fullscreen, and keeps the screen on.

## 4. Playing co-op
- **Host Co-op** → pick a starting level → you get a 5-letter room code (shown top-right in-game).
- Friends choose **Join Co-op** and type the code. Up to 8 players; people can join mid-run.
- The host's game simulates the entities; if the host leaves, someone else takes over automatically.
- When you die in co-op you respawn after 10 seconds. If everyone dies, the level reshuffles.
- Anyone can use the exit; the whole group moves to the next level together.

## Project layout
```
www/                 the game (static files — also what goes into the APK)
  js/levels.js       26 level definitions
  js/mapgen.js       procedural map generators, line of sight, pathfinding
  js/entities.js     14 entity types and their AI
  js/renderer.js     WebGL2 renderer, baked lighting, post effects
  js/textures.js     procedural textures
  js/sprites.js      procedural entity sprites + jumpscare faces
  js/audio.js        synthesized audio engine
  js/main.js         game loop, player, co-op, UI
server/              zero-dependency HTTP + WebSocket co-op server
tools/               tests and the Android setup script
```

`npm test` runs the map-generation checks (every level, connectivity, exit distance, determinism) and an end-to-end server test.
