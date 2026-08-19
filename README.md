# CraftyDocs

Quotation, invoice and receipt maker for Android. Offline-first, single-user, no accounts, no
server, no network calls of any kind.

Built for The Crafty Pixels, Kangarapady, Ernakulam, to the specification in
`REQUIREMENTS.md`.

---

## What it does

- Creates **quotations**, **invoices** and **receipts**, each exportable as **PDF**, **DOCX**
  or **PNG/JPG**.
- Pulls line-item prices from a saved catalogue, or takes them typed in per line — the choice
  is per line, and overriding a catalogue price is visible on the line and never written back
  to the catalogue without an explicit tap.
- Reuses your business details, logo and signature on every document.
- Handles Indian GST properly: CGST+SGST versus IGST inferred from state codes, HSN-wise tax
  summary, amount in words in the lakh/crore system, financial-year document numbering that
  restarts on 1 April.
- If you are not GST registered, leave the GSTIN blank and no GST field appears anywhere.

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| **Node.js** | **22.x LTS or 24.x** (developed on 24.19.0) | Node 20 works; anything below 20 does not. |
| npm | 10 or newer | Ships with the Node versions above. |
| Java JDK | 17 | Only for the local Gradle build, not for EAS. |
| Android SDK | Platform 35, build-tools 35 | Only for the local build. |
| EAS CLI | latest | `npm install -g eas-cli`. Only for the cloud build. |
| Android device | Android 8.0 (API 26) or newer | Target API 35, portrait only. |

Check your Node version before anything else:

```bash
node --version
```

---

## Install

```bash
npm install
```

---

## Run in development

```bash
npx expo start
```

Then press `a` to open on a connected Android device or emulator, or scan the QR code with
Expo Go. Note that **Expo Go cannot run the DOCX or image export** — those need the native
modules in a development or preview build. Everything else works in Expo Go.

For a development build with all native modules:

```bash
npx expo run:android
```

---

## Run the tests

```bash
npm test
```

379 tests across three suites. The `core` and `pure` projects run under plain Node without
`jest-expo`, which is deliberate: it means anything in `src/core/`, `src/render/html.ts` or
`src/export/filename.ts` that acquires a React, react-native or expo import **fails to
compile**. The specification's rule that the calculation layer stays pure is enforced by the
build rather than by review.

```bash
npm test -- --selectProjects core     # money, tax, numbering, words, QR, dates, status
npm test -- --selectProjects db       # real schema + migrations, run on node:sqlite
npm test -- --selectProjects pure     # HTML renderer, export filenames
npm run typecheck                     # tsc --noEmit, strict
```

To eyeball the four document templates in a browser:

```bash
SAMPLE_OUT=./docs/samples npx jest --selectProjects pure -t 'writes sample HTML'
```

That writes `docs/samples/sample-{classic,minimal,bold,compact}.html`. Open them in any
browser; print to PDF to check pagination.

---

## Build the APK

### Primary path — EAS Build (recommended)

```bash
eas build -p android --profile preview
```

The `preview` profile in `eas.json` produces an installable **APK**. When it finishes, EAS
gives you a download link.

The `production` profile produces an **AAB** for a future Play Store listing.

### Install the APK on a device

```bash
adb install -r Quotation-app.apk
```

`-r` reinstalls over an existing copy. If `adb` cannot see the phone, enable Developer
options → USB debugging, and accept the prompt on the phone.

### Fallback path — local Gradle build

```bash
npx expo prebuild --platform android
cd android
./gradlew assembleRelease
```

The APK lands in `android/app/build/outputs/apk/release/`.

A release build needs a signing key. Generate one **once**:

```bash
keytool -genkeypair -v -storetype PKCS12 -keystore craftydocs-release.keystore -alias craftydocs -keyalg RSA -keysize 2048 -validity 10000
```

Store `craftydocs-release.keystore` and its passwords somewhere you will not lose them — a
password manager, plus a copy on a drive that is not this computer. Reference it from
`android/gradle.properties`:

```properties
MYAPP_RELEASE_STORE_FILE=craftydocs-release.keystore
MYAPP_RELEASE_KEY_ALIAS=craftydocs
MYAPP_RELEASE_STORE_PASSWORD=…
MYAPP_RELEASE_KEY_PASSWORD=…
```

> ### ⚠️ Losing the keystore makes future updates un-installable
>
> Android identifies an app by its package name **and** its signing key. If you lose the
> keystore, a new build signed with a different key cannot install over the existing app.
> Every user — including you — would have to uninstall CraftyDocs first, **which deletes all
> its data**. Back the keystore up before you build, not after.
>
> If you use EAS Build, EAS holds the key for you (`eas credentials` to inspect it). Even
> then, export a copy: `eas credentials` → Android → download the keystore.

---

## Two things that fail obscurely if disturbed

### 1. The `buffer` polyfill (DOCX export)

The `docx` library reaches for Node's global `Buffer`, which React Native does not provide.
Without the polyfill, DOCX export dies with a `ReferenceError` from deep inside the packer,
nowhere near the actual cause.

It is installed as the **first statement** of `app/_layout.tsx`, above every other import:

```ts
import { Buffer } from 'buffer';
if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}
```

Do not move it below the other imports, and do not remove `buffer` from `package.json`.
`src/export/docx.ts` checks for it and throws a readable error if it is missing, but that is a
safety net, not a substitute.

### 2. Embedded fonts (the ₹ sign)

The rupee sign (₹, U+20B9) and Malayalam text render as blank boxes in the print engine with
the platform's default font stack. So the export HTML carries its fonts inside itself as
base64 `@font-face` sources — see `src/export/fonts.ts`.

- `assets/fonts/NotoSans-Regular.ttf` and `NotoSans-SemiBold.ttf` are always embedded.
- `NotoSansMalayalam-Regular.ttf` is embedded **only** when the document actually contains
  Malayalam characters, because it is another 113 KB on every export otherwise.
- The files are read once and cached for the process lifetime.

If you remove those font files, exports will still generate — and the rupee sign may silently
turn into a box on some devices. Check a real export on a real device after touching anything
in `src/export/fonts.ts`.

---

## How the code is arranged

```
app/                      expo-router screens (file-based routing)
  _layout.tsx             buffer polyfill, DB init, image-export host
  (tabs)/                 Home, Documents, Clients, More
  doc/[id]/               editor, preview, export sheet
  onboarding/             business profile → logo → signature
  settings/               ten settings screens
src/
  core/                   PURE. No React, no DB, no I/O. 295 tests.
    calc.ts               every money rule in §9, integer paise only
    money.ts              the only place a typed decimal is parsed
    numberToWordsIndian.ts  lakh/crore amount in words
    numbering.ts          document numbers, financial year, gap detection
    gst.ts                GSTIN validation, CGST/SGST vs IGST inference
    qr.ts                 hand-written QR encoder (no dependency, no network)
    status.ts             the §6.4 state machine, derived not stored
    dates.ts              calendar dates as strings, timezone-proof
  db/                     schema, append-only migrations, repositories, backup
  render/html.ts          THE single source of truth for document output
  export/                 PDF, DOCX, image, share/save, font embedding
  state/editor.ts         Zustand editor store with 400 ms debounced autosave
  components/             UI kit and the pickers
scripts/generate-icons.mjs  regenerates the launcher icons
docs/samples/             rendered examples of the four templates
```

### The rules the code holds itself to

- **Money is always integer paise.** No `parseFloat` on a currency value anywhere outside
  `src/core/money.ts`. Products use BigInt internally so a large document cannot lose
  precision.
- **Totals are computed once and stored** on the document, so an invoice issued last year
  keeps its numbers even if the calculation code changes.
- **Client and business details are snapshotted** onto each document at creation. Editing a
  client never rewrites a document already issued.
- **Schema changes only ever append a migration.** `src/db/schema.ts` explains why.
- **One HTML renderer** feeds the PDF, the image and the preview. If the preview and the
  export disagree, that is a bug by definition.

---

## Backup

Settings → Backup & restore writes a single JSON file holding every table plus the logo and
signature as base64, and hands it to the share sheet. Keep a copy off the phone.

Restore validates the file's format version, tells you what it contains, and asks before
overwriting. It parses everything before deleting anything, so a corrupt file cannot leave you
with neither the old data nor the new. Restart the app afterwards.

---

## Privacy

No analytics. No crash-reporting SDK. No network calls of any kind. The QR codes are generated
on the device by hand-written code rather than an image API, and the export HTML is checked by
a test to contain no `http://` or `https://` reference. Your documents never leave the phone
unless you share them yourself.
