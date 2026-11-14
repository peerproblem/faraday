import type { ConnectionConfig } from "mariadb";

/** Session settings for every connection. Aiven MySQL defaults to ANSI mode, which reads "..." as identifiers. */
export const SESSION_SQL_MODE = "STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION";

const TLS_MODES = new Set(["REQUIRED", "VERIFY_CA", "VERIFY_IDENTITY"]);

/**
 * Connection options from a database URL, e.g. mysql://user:pass@host:port/db?ssl-mode=REQUIRED.
 * TLS uses DATABASE_CA (the server CA PEM, base64 on one line) and always verifies the certificate.
 * `database` overrides the URL path; pass null to connect without a default database.
 */
export function connectionConfig(
  databaseUrl: string,
  opts: { database?: string | null; ca?: string | undefined } = {},
): ConnectionConfig {
  const u = new URL(databaseUrl);
  const sslMode = (u.searchParams.get("ssl-mode") ?? u.searchParams.get("sslmode") ?? "").toUpperCase();
  const caB64 = "ca" in opts ? opts.ca : process.env.DATABASE_CA;
  const wantsTls = TLS_MODES.has(sslMode);
  if (wantsTls && !caB64) throw new Error(`database URL asks for ssl-mode=${sslMode} but DATABASE_CA is not set`);
  const useTls = sslMode !== "DISABLED" && !!caB64;
  const database = opts.database === undefined ? u.pathname.replace(/^\//, "") || undefined : opts.database ?? undefined;
  return {
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database,
    timezone: "Z",
    // A managed database is remote: the TLS handshake alone can take most of the driver's 1s default.
    connectTimeout: 10_000,
    initSql: `SET SESSION sql_mode='${SESSION_SQL_MODE}'`,
    ...(useTls ? { ssl: { ca: Buffer.from(caB64!, "base64").toString("utf8"), rejectUnauthorized: true } } : {}),
  };
}
