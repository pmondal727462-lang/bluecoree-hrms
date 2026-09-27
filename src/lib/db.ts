import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaClient } from "@prisma/client";

// Database access runs in an explicit scope. Tenant scope uses the restricted
// application role and sets app.company_id inside every transaction, so
// PostgreSQL row-level security limits rows to that company. System scope
// uses the RLS-bypassing role and is reserved for pre-authentication lookups,
// platform administration and background jobs. Unscoped access is refused.
type Scope = { companyId: string } | { system: true };
const scope = new AsyncLocalStorage<Scope>();

export function withTenant<T>(companyId: string, fn: () => T): T {
  if (!companyId) throw new Error("A company is required for tenant scope.");
  return scope.run({ companyId }, fn);
}
export function withSystem<T>(fn: () => T): T {
  return scope.run({ system: true }, fn);
}
export function currentCompanyId() {
  const s = scope.getStore();
  return s && "companyId" in s ? s.companyId : null;
}

type Clients = { app?: PrismaClient; system?: PrismaClient; warned?: boolean };
const globalDb = globalThis as unknown as { prismaClients?: Clients };
const clients: Clients = globalDb.prismaClients ?? {};
if (process.env.NODE_ENV !== "production") globalDb.prismaClients = clients;

function connection(name: "APP_DATABASE_URL" | "SYSTEM_DATABASE_URL") {
  const url = process.env[name];
  if (url) return url;
  if (process.env.NODE_ENV === "production")
    throw new Error(`${name} is required in production.`);
  if (!clients.warned) {
    clients.warned = true;
    console.warn(
      "APP_DATABASE_URL/SYSTEM_DATABASE_URL are not set; using DATABASE_URL. Row-level security is not enforced for this process.",
    );
  }
  return process.env.DATABASE_URL;
}
function appClient() {
  clients.app ??= new PrismaClient({
    datasourceUrl: connection("APP_DATABASE_URL"),
  });
  return clients.app;
}
function systemClient() {
  clients.system ??= new PrismaClient({
    datasourceUrl: connection("SYSTEM_DATABASE_URL"),
  });
  return clients.system;
}

type Target = { client: PrismaClient; companyId: string | null };
function target(): Target {
  const s = scope.getStore();
  if (!s)
    throw new Error(
      "Database access outside a tenant or system scope. Wrap the call in withTenant() or withSystem().",
    );
  return "system" in s
    ? { client: systemClient(), companyId: null }
    : { client: appClient(), companyId: s.companyId };
}
// biome-ignore lint/suspicious/noExplicitAny: forwards arbitrary Prisma calls
type Any = any;
const tenantSetting = (c: Any, companyId: string) =>
  c.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;

// A deferred query, like a PrismaPromise: it runs when awaited, or as part of
// an array transaction, against the client chosen when it was created.
class Query<T> implements PromiseLike<T> {
  private running?: Promise<T>;
  constructor(
    readonly t: Target,
    readonly make: (c: Any) => Any,
  ) {}
  private run() {
    this.running ??= this.t.companyId
      ? this.t.client
          .$transaction([
            tenantSetting(this.t.client, this.t.companyId),
            this.make(this.t.client),
          ])
          .then((r: unknown[]) => r[1] as T)
      : Promise.resolve(this.make(this.t.client));
    return this.running;
  }
  then<A = T, B = never>(
    ok?: ((v: T) => A | PromiseLike<A>) | null,
    fail?: ((e: unknown) => B | PromiseLike<B>) | null,
  ) {
    return this.run().then(ok, fail);
  }
  catch<B = never>(fail?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return this.run().catch(fail);
  }
  finally(done?: (() => void) | null) {
    return this.run().finally(done);
  }
  get [Symbol.toStringTag]() {
    return "PrismaPromise";
  }
}

async function transaction(t: Target, arg: Any, options?: Any) {
  if (Array.isArray(arg)) {
    const queries = arg.map((q) => {
      if (!(q instanceof Query) || q.t.client !== t.client)
        throw new Error("Array transactions accept queries from this client.");
      return q.make(t.client);
    });
    if (!t.companyId) return t.client.$transaction(queries, options);
    const results = await t.client.$transaction(
      [tenantSetting(t.client, t.companyId), ...queries],
      options,
    );
    return results.slice(1);
  }
  return t.client.$transaction(async (tx: Any) => {
    if (t.companyId) await tenantSetting(tx, t.companyId);
    return arg(tx);
  }, options);
}

const raw = new Set([
  "$queryRaw",
  "$executeRaw",
  "$queryRawUnsafe",
  "$executeRawUnsafe",
]);
function scoped(pick: () => Target): PrismaClient {
  const models = new Map<string, unknown>();
  return new Proxy({} as PrismaClient, {
    get(_, key) {
      if (typeof key !== "string") return undefined;
      if (key === "then") return undefined;
      if (key === "$transaction")
        return (arg: Any, options?: Any) => transaction(pick(), arg, options);
      if (raw.has(key))
        return (...args: Any[]) => new Query(pick(), (c) => c[key](...args));
      if (key === "$disconnect")
        return async () => {
          await Promise.all(
            [clients.app, clients.system].map((c) => c?.$disconnect()),
          );
        };
      if (key.startsWith("$")) {
        const t = pick();
        const value = (t.client as Any)[key];
        return typeof value === "function" ? value.bind(t.client) : value;
      }
      if (!models.has(key))
        models.set(
          key,
          new Proxy(
            {},
            {
              get(_m, op) {
                if (typeof op !== "string") return undefined;
                return (...args: Any[]) =>
                  new Query(pick(), (c) => c[key][op](...args));
              },
            },
          ),
        );
      return models.get(key);
    },
  });
}

// The scoped client for application code.
export const db = scoped(target);
// Always the RLS-bypassing role: scripts, seeds and test fixtures only.
export const systemDb = scoped(() => ({
  client: systemClient(),
  companyId: null,
}));
// Scheduled and background jobs span companies: they keep an active scope
// (such as a tenant request), and otherwise run in system scope.
export function jobScope<T>(fn: () => T): T {
  return scope.getStore() ? fn() : withSystem(fn);
}
