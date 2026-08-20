/**
 * Browser setup for `@capacitor-community/sqlite`.
 *
 * On Android the plugin talks to native SQLite and none of this runs. In a browser it needs
 * `jeep-sqlite` — a custom element wrapping sql.js/WASM, persisted through IndexedDB — defined and
 * attached to the document before `initWebStore()` is called.
 *
 * ## Two traps, both of which fail silently
 *
 * 1. **Use the custom-elements build, not the lazy loader.** `jeep-sqlite/loader` uses Stencil's
 *    lazy runtime, which fetches the component's implementation chunk at runtime relative to the
 *    loader's own script URL. Under Vite that URL is wrong, so the element gets *defined* with no
 *    implementation behind it: `customElements.get('jeep-sqlite')` succeeds, the tag appears in
 *    the DOM, and then every async method on it — including the one `initWebStore()` awaits —
 *    never settles. No error is logged. Importing from `jeep-sqlite/dist/components/jeep-sqlite`
 *    instead lets the bundler include the implementation directly.
 *
 * 2. **The `sql-wasm.wasm` version must match jeep-sqlite's bundled sql.js glue.** Serving a
 *    newer one produces `LinkError: ... function import requires a callable` from
 *    `WebAssembly.instantiate`. jeep-sqlite 2.8 wants sql.js 1.11.x, which is why `package.json`
 *    pins it exactly rather than taking the latest. The binary is copied to `/assets` by a rule
 *    in `angular.json`.
 *
 * 3. **`wasmPath` must be set, or the app breaks the moment it is not served from the root.**
 *    jeep-sqlite defaults it to the *absolute* `/assets`, which is right only at the domain root.
 *    Hosted under a prefix — a GitHub Pages project site at `/<repo>/`, or any app served from a
 *    sub-path — it requests `/assets/sql-wasm.wasm`, gets the host's 404, and the database never
 *    opens. The symptom is a blank screen and one failed request, with nothing to connect it to
 *    paths. So the path is derived from the document's own base URI below.
 */

/**
 * Where `sql-wasm.wasm` actually lives, as a path jeep-sqlite can use.
 *
 * Resolved against `document.baseURI` — which reflects the `<base href>` Angular was built with —
 * so the answer is `/assets` at the root and `/craftydocs/assets` under that prefix, with no
 * build-time configuration to keep in step.
 */
function resolveWasmPath(): string {
  try {
    return new URL('assets', document.baseURI).pathname.replace(/\/$/, '');
  } catch {
    return '/assets';
  }
}

let setupPromise: Promise<void> | null = null;

/**
 * Define `<jeep-sqlite>` and attach it to the document. Idempotent, and safe to call from several
 * places at once — the work happens once.
 */
export function prepareWebSqlite(): Promise<void> {
  if (setupPromise) return setupPromise;

  setupPromise = (async () => {
    // Imported dynamically so this never reaches an Android bundle.
    const { defineCustomElement } = await import('jeep-sqlite/dist/components/jeep-sqlite');
    if (!customElements.get('jeep-sqlite')) {
      defineCustomElement();
    }
    await customElements.whenDefined('jeep-sqlite');

    let element = document.querySelector('jeep-sqlite');
    if (!element) {
      element = document.createElement('jeep-sqlite');
      // Set before the element is attached: Stencil reads its props during initialisation, and the
      // component boots its WASM from `wasmPath` as soon as it connects. Setting it afterwards is
      // too late, and the attribute is set as well as the property so it survives any
      // reflection-based re-read.
      const wasmPath = resolveWasmPath();
      (element as HTMLElement & { wasmPath?: string }).wasmPath = wasmPath;
      element.setAttribute('wasm-path', wasmPath);
      document.body.appendChild(element);
    }

    // Stencil signals readiness through this hook. Waiting on it is what stops `initWebStore`
    // racing an element whose WASM has not booted.
    const stencilElement = element as HTMLElement & { componentOnReady?: () => Promise<unknown> };
    if (typeof stencilElement.componentOnReady === 'function') {
      await stencilElement.componentOnReady();
    }
  })();

  return setupPromise;
}
