# CraftyDocs — Ionic Angular

Port of the CraftyDocs Android app from Expo / React Native to **Ionic 9 + Angular 22 +
Capacitor 8**, against the specification in `REQUIREMENTS.md` (kept outside this repository).

> **Status: work in progress.** The domain logic is complete and fully tested and the edit loop
> works, but the export path is not written and nothing has run on Android yet. Read "What is done
> / what is not" before relying on it.
>
> The previous Expo / React Native implementation — which did produce a verified APK — was removed
> from the working tree to save space. It is preserved in git at the tag `expo-final-rn`:
> `git checkout expo-final-rn` brings it back in full.

---

## Folder structure

The layout separates *what the business rules are* from *how they are stored* and *how they are
shown*, which is what made this port cheap in the first place.

```
src/
├── app/
│   ├── app.ts / app.html / app.scss        root shell
│   ├── app.routes.ts                       lazy route table
│   ├── app.config.ts                       providers
│   │
│   ├── core/                     PURE domain logic. No Angular, Ionic or Capacitor.
│   │   ├── money.ts              integer paise; the ONLY decimal parser (§16.5)
│   │   ├── calc.ts               every calculation rule in §9
│   │   ├── gst.ts                GSTIN validation, CGST/SGST vs IGST (§9.4)
│   │   ├── numbering.ts          document numbers, financial year, gaps (§8)
│   │   ├── number-to-words-indian.ts   lakh/crore amount in words (§9.5)
│   │   ├── status.ts             the §6.4 state machine — derived, never stored
│   │   ├── qr.ts                 hand-written QR encoder (§7.6)
│   │   ├── dates.ts              dates as text, so timezones cannot shift them
│   │   ├── ids.ts, types.ts
│   │   └── *.spec.ts             293 tests
│   │
│   ├── data/                     persistence
│   │   ├── schema.ts             SQL + append-only migrations (§5, §16.4)
│   │   ├── sqlite.service.ts     one connection; migrations; query/run/transaction
│   │   ├── web-sqlite-setup.ts   jeep-sqlite bootstrap, browser only
│   │   ├── seed.ts               first-run data (§5.9)
│   │   ├── rows.ts               row types and defensive narrowing
│   │   └── repositories/
│   │       ├── documents.repository.ts
│   │       └── masters.repository.ts
│   │
│   ├── render/html.ts            THE single source of document output (§10.1)
│   ├── export/filename.ts        export filename rules (§10.2)
│   │
│   ├── shared/
│   │   ├── pipes/                one pipe per file
│   │   │   ├── paise.pipe.ts
│   │   │   ├── milli.pipe.ts
│   │   │   ├── basis-points.pipe.ts
│   │   │   └── iso-date.pipe.ts
│   │   └── ui/
│   │       └── status-chip/      ts + html + scss
│   │
│   ├── features/                 one folder per component, lazily routed
│   │   ├── dashboard/            dashboard.page.{ts,html,scss}
│   │   ├── documents/
│   │   │   ├── document-list/    document-list.page.{ts,html,scss}
│   │   │   ├── document-editor/  document-editor.page.{ts,html,scss}
│   │   │   └── document-editor.store.ts     signal store (not a component)
│   │   ├── clients/
│   │   │   └── client-list/      client-list.page.{ts,html,scss}
│   │   └── settings/
│   │       └── settings-hub/     settings-hub.page.{ts,html,scss}
│   │
│   └── tabs/                     tabs.page.{ts,html,scss} — the four tabs of §4
│
├── theme/variables.scss          design tokens, shared with the React Native tree
└── styles.scss                   global styles and accessibility rules
```

### Component layout convention

Every component lives in a folder named after it and holds exactly three files — `.ts`, `.html`,
`.scss`. No component uses an inline template or inline styles, so markup is always found in the
same place and a designer can edit HTML and CSS without opening TypeScript.

Files that are *not* components stay flat next to the feature they serve:
`document-editor.store.ts` is a service, and pipes have no markup, so each is simply one file.

### The rule that makes `core/` valuable

Nothing in `src/app/core/`, `src/app/render/html.ts` or `src/app/export/filename.ts` may import
Angular, Ionic or Capacitor. That is not a convention — `vitest.config.ts` runs those suites in a
plain Node environment with no framework present, so an Angular import there stops the tests
compiling. It is why this layer moved from React Native to Angular unchanged, and it is why it
would move again.

---

## Run it

```bash
npm install
```

```bash
npm start
```

Then open http://localhost:4300.

## Test it

```bash
npm test
```

379 tests: the whole financial core, the QR encoder checked against 24 reference matrices, the
HTML renderer, export filenames, and the SQL schema executed against Node's own SQLite.

```bash
npm run typecheck
```

---

## Build for Android

```bash
npm run cap:sync
```

```bash
npm run cap:apk
```

The Android platform has **not** been added yet — `npx cap add android` is the missing first step,
and it needs the Android SDK and JDK 17 installed locally.

---

## What is done / what is not

### Done and verified

| Area | State |
|---|---|
| `core/` — money, tax, numbering, words, QR, dates, status | **Complete**, 293 tests, ported verbatim |
| `render/html.ts` — the A4 document renderer, 4 templates | **Complete**, 50 tests |
| `export/filename.ts` | **Complete**, 16 tests |
| SQL schema + migrations | **Complete**, 18 tests against real SQLite |
| Seed data (§5.9) | Written |
| Repositories: documents, masters | Written |
| Ionic shell: tabs, routing, theme, pipes | Working — builds and renders |
| Dashboard, documents list, clients list, settings hub | Written and rendering |
| **The document editor** (§6.2) | Working: live totals, §7.3 price badges and write-back prompt, 400 ms debounced autosave, status transitions, manual number override |

### Dependencies

The tree carries only what the app currently uses. Packages for unwritten features were removed
rather than left installed, so `node_modules` reflects working code and not intentions.

Re-add them as each feature is built:

| Feature | Reinstall |
|---|---|
| DOCX export (§10.3) | `npm i docx buffer` — and restore the `Buffer` polyfill at the top of `src/main.ts`; `docx` fails obscurely without it |
| PDF / share / save (§10.2, §10.5) | `npm i @capacitor/filesystem @capacitor/share` |
| Logo and signature capture (§7.1, §7.2) | `npm i @capacitor/camera` |
| Android build (§12) | `npm i @capacitor/android` then `npx cap add android` |
| Splash and status bar polish | `npm i @capacitor/splash-screen @capacitor/status-bar` |

Kept deliberately even though nothing imports them directly:

- **`sql.js`** — pinned to exactly `1.11.0`. Its `sql-wasm.wasm` is copied to `/assets` by an
  `angular.json` rule and must match jeep-sqlite's bundled glue; a newer build fails with
  `LinkError` from `WebAssembly.instantiate`.
- **`rxjs`, `tslib`, `@angular/common`, `@angular/compiler`** — required by Angular itself.
- **`@capacitor/cli`** — the tool that will run `cap add android` and `cap sync`.

---

### Not yet written

- **Preview and export** (§10) — PDF, DOCX and PNG all need Capacitor equivalents of
  `expo-print`, `expo-sharing` and `react-native-view-shot`. The renderer they consume is done;
  only the platform plumbing is missing.
- **Detail screens**: client editor, catalogue item editor, onboarding, and the nine settings
  pages behind the hub.
- **Backup and restore** (§11).
- **Font embedding** — `src/app/export/fonts.ts` has no Ionic equivalent yet. Until it exists,
  exported documents will not reliably render ₹.
- **`npx cap add android`** and a real device build.

### Verified working in the browser

Migrations, seed, and the full edit loop: creating a quotation, adding a line, typing
`1.5` × `7,500.50` and getting **₹11,251.00** (round-off applied), autosaving, and reading the same
figure back on the dashboard after a full page reload.

Three browser-only traps are documented in `data/web-sqlite-setup.ts` — all three failed silently,
which is why the comments there are so emphatic.

### Still unverified

Nothing has run on Android. `npx cap add android` has not been done, so the native SQLite path,
the export path and font embedding are all untested on a device.

The Noto fonts needed for §10.1's rupee-glyph embedding are preserved in `src/assets/fonts/`, and
the launcher-icon generator in `scripts/generate-icons.mjs` still works — both were carried over
from the Expo tree so the export work has what it needs.
