// Minimal ambient declarations so the project type-checks with ZERO dependencies
// (no @types/node). Only the tiny surface the tests and sim use.
declare module "node:test" {
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
}
declare module "node:assert/strict" {
  const assert: {
    (v: unknown, msg?: string): asserts v;
    ok(v: unknown, msg?: string): asserts v;
    equal(a: unknown, b: unknown, msg?: string): void;
    notEqual(a: unknown, b: unknown, msg?: string): void;
    deepEqual(a: unknown, b: unknown, msg?: string): void;
    throws(fn: () => unknown, msg?: unknown): void;
  };
  export default assert;
}
declare const console: { log(...a: unknown[]): void; error(...a: unknown[]): void };
