/**
 * A TCP proxy in front of a test container that a test can take down and bring back, to simulate an outage of a
 * shared dependency (`docker compose stop redis`) without stopping the container other test files use.
 */
import net from "node:net";

export class TcpProxy {
  private readonly sockets = new Set<net.Socket>();
  private accepting = true;

  private constructor(private readonly server: net.Server) {}

  /** Starts a proxy on a random local port that forwards to `target`. */
  static async start(target: { host: string; port: number }): Promise<TcpProxy> {
    const server = net.createServer();
    const proxy = new TcpProxy(server);
    server.on("connection", (client) => {
      proxy.track(client);
      if (!proxy.accepting) {
        client.destroy();
        return;
      }
      const upstream = net.connect(target.port, target.host);
      proxy.track(upstream);
      client.pipe(upstream).pipe(client);
      const close = () => {
        client.destroy();
        upstream.destroy();
      };
      client.on("error", close).on("close", close);
      upstream.on("error", close).on("close", close);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return proxy;
  }

  get port(): number {
    const address = this.server.address();
    if (address === null || typeof address === "string") throw new Error("proxy is not listening");
    return address.port;
  }

  /** Drops every open connection and refuses new ones. */
  down(): void {
    this.accepting = false;
    for (const socket of this.sockets) socket.destroy();
  }

  /** Accepts and forwards connections again. */
  up(): void {
    this.accepting = true;
  }

  async close(): Promise<void> {
    this.down();
    await new Promise<void>((resolve) =>
      this.server.close(() => {
        resolve();
      }),
    );
  }

  private track(socket: net.Socket): void {
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
  }
}
