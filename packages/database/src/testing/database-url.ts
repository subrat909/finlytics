/**
 * The guard every test helper applies before it touches a database: only the Testcontainers database, never the dev
 * database or a local PostgreSQL that belongs to something else.
 */

/**
 * Host ports the helpers never touch. 5432 is the compose default and often a local PostgreSQL that belongs to
 * something else; 5433 is the dev database's port when 5432 is taken. Testcontainers maps the container to a random
 * high port, so a URL on either of these did not come from the container.
 */
const PROTECTED_PORTS: ReadonlySet<string> = new Set(["5432", "5433"]);

/** "host:port/database", for messages. Never the whole URL: it carries the password. */
export function describeTestDatabaseUrl(url: URL): string {
  return `${url.hostname}:${url.port}${url.pathname}`;
}

/** The database name in a PostgreSQL URL's path. */
export function databaseNameOf(url: URL): string {
  return decodeURIComponent(url.pathname.slice(1));
}

/**
 * Parses a URL a helper is about to use and rejects anything that can't be the test container: other protocols, a
 * missing port (pg would default to 5432), the protected ports and a missing database name.
 *
 * @throws {Error} naming the host, port and database, never the password.
 */
export function parseTestDatabaseUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(`Not a PostgreSQL URL: ${url.protocol}`);
  }
  if (url.port === "" || PROTECTED_PORTS.has(url.port)) {
    throw new Error(
      `Refusing to use ${describeTestDatabaseUrl(url)}: test helpers run only against the Testcontainers database, ` +
        `never on port 5432 or 5433 and never without an explicit port`,
    );
  }
  if (databaseNameOf(url) === "") throw new Error(`No database name in ${describeTestDatabaseUrl(url)}`);
  return url;
}
