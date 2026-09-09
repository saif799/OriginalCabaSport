import type { Executor } from "@/lib/db";

export type QueryEvent = { event: "start" | "settle"; index: number };

/**
 * Wraps a test database so that every `select()` it issues logs when the query
 * is *started* (its promise is awaited, which is when drizzle executes it) and
 * when it *settles*.
 *
 * The point is to make concurrency observable without touching the clock: two
 * reads issued together produce `start, start, settle, settle`, two reads
 * chained produce `start, settle, start, settle`. That ordering is deterministic
 * — it falls out of when `.then` is called, not out of how long a query takes —
 * so an assertion on it cannot flake the way a duration threshold would.
 */
export function recordingExec(db: unknown): { exec: Executor; log: QueryEvent[] } {
  const log: QueryEvent[] = [];
  let nextIndex = 0;

  // drizzle's builders are lazy: `.from`/`.where`/`.orderBy` return a builder
  // (sometimes the same object, sometimes a new one), and only `.then` runs the
  // query. So the proxy has to follow the chain to reach the `.then` that matters.
  const isBuilder = (value: unknown): boolean =>
    typeof value === "object" &&
    value !== null &&
    (typeof (value as { then?: unknown }).then === "function" ||
      typeof (value as { from?: unknown }).from === "function");

  function wrapBuilder<T extends object>(builder: T, index: number): T {
    return new Proxy(builder, {
      get(target, prop) {
        const value = Reflect.get(target, prop);
        if (typeof value !== "function") return value;

        if (prop === "then") {
          return (
            onFulfilled?: (rows: unknown) => unknown,
            onRejected?: (err: unknown) => unknown,
          ) => {
            log.push({ event: "start", index });
            return (value as (...a: unknown[]) => unknown).call(
              target,
              (rows: unknown) => {
                log.push({ event: "settle", index });
                return onFulfilled ? onFulfilled(rows) : rows;
              },
              (err: unknown) => {
                log.push({ event: "settle", index });
                if (onRejected) return onRejected(err);
                throw err;
              },
            );
          };
        }

        return (...args: unknown[]) => {
          const result = (value as (...a: unknown[]) => unknown).apply(target, args);
          return isBuilder(result) ? wrapBuilder(result as object, index) : result;
        };
      },
    });
  }

  const exec = new Proxy(db as object, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (prop === "select" && typeof value === "function") {
        return (...args: unknown[]) =>
          wrapBuilder((value as (...a: unknown[]) => object).apply(target, args), nextIndex++);
      }
      return typeof value === "function" ? (value as () => unknown).bind(target) : value;
    },
  }) as unknown as Executor;

  return { exec, log };
}
