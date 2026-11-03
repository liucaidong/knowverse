/**
 * Poll an asynchronous browser-side predicate from Node.
 *
 * Playwright's page.waitForFunction treats an async predicate's returned Promise
 * as a truthy value instead of waiting for its resolved boolean. Database and
 * archive assertions must therefore use page.evaluate (which awaits the Promise)
 * inside a Node-side polling loop.
 */
export async function waitForAsyncPageCondition(page, predicate, options = {}) {
  const timeout = Number.isFinite(options.timeout) ? Math.max(0, options.timeout) : 30_000;
  const polling = Number.isFinite(options.polling) ? Math.max(10, options.polling) : 50;
  const label = options.label || "asynchronous browser condition";
  const deadline = Date.now() + timeout;
  let lastValue;

  do {
    if (page.isClosed()) throw new Error("Page closed while waiting for " + label + ".");
    lastValue = await page.evaluate(predicate, options.arg);
    if (lastValue) return lastValue;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await page.waitForTimeout(Math.min(polling, remaining));
  } while (Date.now() <= deadline);

  let last;
  try { last = JSON.stringify(lastValue); }
  catch { last = String(lastValue); }
  throw new Error("Timed out waiting for " + label + ". Last resolved value: " + (last ?? String(lastValue)));
}
