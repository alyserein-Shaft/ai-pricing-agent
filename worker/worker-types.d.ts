// Backend & Codebase Consolidation Sprint, item 4: minimal, hand-written
// ambient declarations for the 5 Cloudflare Workers binding types
// worker/index.ts's Env interface references (D1Database, Fetcher,
// R2Bucket, Queue, MessageBatch) plus the "cloudflare:workers" module's
// `env` export. This is deliberately NOT the full `wrangler types`/
// @cloudflare/workers-types runtime library -- that was already tried
// (Consolidation Fix Sprint 1) and reverted because it redeclares `fetch`,
// `Response`, `Request`, `Headers` etc. globally in a way that conflicts
// with this project's `lib: ["dom", ...]` and regressed the TS baseline
// from 70 to 346 errors. These 5 names are never redeclared by `lib.dom`,
// so there is no conflict risk; every worker/*.mjs file that actually
// calls methods on these bindings is untyped JavaScript and is not
// checked by tsc regardless (only worker/index.ts and db/index.ts, the
// two .ts files in this directory, ever see these type names).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- opaque binding shapes; only the one method this codebase actually calls from a .ts file is typed precisely (Fetcher.fetch below), the rest are intentionally minimal placeholders for binding presence, not full API surfaces.
interface D1Database {
  prepare(query: string): unknown;
  batch(statements: unknown[]): Promise<unknown[]>;
  exec(query: string): Promise<unknown>;
}
interface Fetcher {
  fetch(request: Request): Promise<Response>;
}
interface R2Bucket {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown, options?: unknown): Promise<unknown>;
  delete(key: string): Promise<void>;
}
interface Queue<T = unknown> {
  send(message: T): Promise<void>;
  sendBatch(messages: T[]): Promise<void>;
}
interface MessageBatch<T = unknown> {
  readonly messages: readonly { readonly body: T }[];
  ackAll(): void;
  retryAll(): void;
}

declare module "cloudflare:workers" {
  // db/index.ts is the only .ts consumer of this module's `env` export, and
  // only ever reads `env.DB` -- typed narrowly for that, not the full
  // worker/index.ts Env shape (importing across that boundary would invert
  // the established db/ <- worker/ dependency direction).
  export const env: { DB?: D1Database };
}
