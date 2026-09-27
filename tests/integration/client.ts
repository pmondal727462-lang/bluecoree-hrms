import { randomBytes } from "node:crypto";

// Each isolated suite represents a different trusted-proxy client. Repeated
// runs must not exhaust the real localhost login bucket. Rate limiting stays
// enabled, including the account- and IP-limit tests.
export const testClientIp = `fd00:${randomBytes(14).toString("hex").match(/.{4}/g)!.join(":")}`;
