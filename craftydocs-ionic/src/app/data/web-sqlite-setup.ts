/**
 * Browser setup for `@capacitor-community/sqlite`.
 *
 * On Android the plugin talks to native SQLite and none of this runs. In a browser it needs
 * `jeep-sqlite` — a custom element wrapping sql.js/WASM, backed by IndexedDB — and the element
 * has to be *defined and in the DOM* before `initWebStore()` is called.
 *
 * Getting this wrong does not raise: `initWebStore()` simply never settles, so the app sits on a
 * spinner with a clean console. That is exactly what happened during the port, hence this file
 * and its rather emphatic comments.
 *
 * The `sql-wasm.wasm` binary is copied into `/assets` by an `angular.json` asset rule; without
 * it the element defines but cannot open a database.
 */

let setupPromise: Promise<void> | null = null;

/**
 * Define `<jeep-sqlite>` and attach it to the document. Idempotent, and safe to call from
 * several places — the work happens once.
 */
export function prepareWebSqlite(): Promise<void> {
  if (setupPromise) return setupPromise;

  setupPromise = (async () => {
    // Imported dynamically so the dependency never reaches an Android bundle.
    const { defineCustomElements } = await import('jeep-sqlite/loader');
    defineCustomElements(window);

    await customElements.whenDefined('jeep-sqlite');

    let element = document.querySelector('jeep-sqlite');
    if (!element) {
      element = document.createElement('jeep-sqlite');
      document.body.appendChild(element);
    }

    // The element reports readiness through Stencil's lifecycle hook. Waiting on it is what
    // stops `initWebStore` racing an element that has not booted its WASM yet.
    const stencilElement = element as HTMLElement & { componentOnReady?: () => Promise<unknown> };
    if (typeof stencilElement.componentOnReady === 'function') {
      await stencilElement.componentOnReady();
    }
  })();

  return setupPromise;
}
