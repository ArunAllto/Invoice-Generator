# CraftyDocs — Ionic Angular

Port of the CraftyDocs Android app from Expo / React Native to **Ionic 9 + Angular 22 +
Capacitor 8**, against the same specification (`../REQUIREMENTS.md`).

> **Status: partial port.** The domain logic is complete and fully tested; a large part of the UI
> and the whole export path are not yet written. Read "What is done / what is not" before relying
> on this tree. The Expo tree in the parent directory is still the one that produces a working
> APK.

---

## Folder structure

The layout separates *what the business rules are* from *how they are stored* and *how they are
shown*, which is what made this port cheap in the first place.

```
src/
├── app/
│   ├── core/                     PURE domain logic. No Angular, no Ionic, no Capacitor.
│   │   ├── money.ts              integer paise arithmetic; the ONLY decimal parser (§16.5)
│   │   ├── calc.ts               every calculation rule in §9
│   │   ├── gst.ts                GSTIN validation, CGST/SGST vs IGST inference (§9.4)
│   │   ├── numbering.ts          document numbers, financial year, gap detection (§8)
│   │   ├── number-to-words-indian.ts   lakh/crore amount in words (§9.5)
│   │   ├── status.ts             the §6.4 state machine — derived, never stored
│   │   ├── qr.ts                 hand-written QR encoder, no dependency, no network (§7.6)
│   │   ├── dates.ts              calendar dates as text, so timezones cannot shift them
│   │   ├── ids.ts                UUIDs
│   │   ├── types.ts              the domain vocabulary
│   │   └── *.spec.ts             293 tests
│   ├── data/                     persistence
│   │   ├── schema.ts             SQL + append-only migration list (§5, §16.4)
│   │   ├── sqlite.service.ts     the one connection; migration runner; query/run/transaction
│   │   ├── web-sqlite-setup.ts   jeep-sqlite bootstrap, browser only
│   │   ├── seed.ts               first-run data (§5.9)
│   │   ├── rows.ts               row types and defensive narrowing
│   │   └── repositories/
│   │       ├── documents.repository.ts   create, save, list, numbering, dashboard
│   │       └── masters.repository.ts     profile, clients, catalogue, series, terms, settings
│   ├── render/
│   │   └── html.ts               THE single source of truth for document output (§10.1)
│   ├── export/
│   │   └── filename.ts           export filename rules (§10.2)
│   ├── shared/
│   │   ├── pipes/format.pipes.ts paise / milli / basis-points / ISO date
│   │   └── ui/                   reusable presentation components
│   ├── features/                 one folder per screen, lazily routed
│   │   ├── dashboard/
│   │   ├── documents/
│   │   ├── clients/
│   │   └── settings/
│   ├── tabs/                     the four tabs of §4
│   ├── app.routes.ts             lazy route table
│   └── app.config.ts             providers
├── theme/variables.scss          design tokens, shared with the React Native tree
└── styles.scss                   global styles and accessibility rules
```

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
the export path and font embedding are all untested on a device. The Expo tree in the parent
directory remains the working, APK-producing app until this one catches up.
