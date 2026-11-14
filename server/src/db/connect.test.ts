import { describe, expect, it } from "vitest";
import { connectionConfig, SESSION_SQL_MODE } from "./connect";

const pem = "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----\n";
const ca = Buffer.from(pem).toString("base64");

describe("connectionConfig", () => {
  it("reads the URL and verifies TLS with the decoded CA", () => {
    const c = connectionConfig("mysql://avnadmin:p%40ss@db.example.com:27053/faraday?ssl-mode=REQUIRED", { ca });
    expect(c).toMatchObject({ host: "db.example.com", port: 27053, user: "avnadmin", password: "p@ss", database: "faraday" });
    expect(c.ssl).toEqual({ ca: pem, rejectUnauthorized: true });
    expect(c.initSql).toBe(`SET SESSION sql_mode='${SESSION_SQL_MODE}'`);
  });

  it("refuses ssl-mode=REQUIRED without a CA", () => {
    expect(() => connectionConfig("mysql://u:p@h:1/d?ssl-mode=REQUIRED", { ca: undefined })).toThrow(/DATABASE_CA/);
  });

  it("connects without TLS or a database when asked", () => {
    const c = connectionConfig("mariadb://u:p@127.0.0.1/faraday", { ca: undefined, database: null });
    expect(c.ssl).toBeUndefined();
    expect(c.database).toBeUndefined();
    expect(c.port).toBe(3306);
  });
});
