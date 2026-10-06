/**
 * Socket.IO namespace `/rt` on path `/rt/socket.io` (phase 1 plan "WebSocket"). Thin: the handshake middleware and the
 * `sub`/`unsub` handlers delegate to RealtimeService. Handlers are bound per socket instead of `@SubscribeMessage`,
 * so no HTTP guard, pipe or interceptor runs on WebSocket messages; payloads are validated with the shared Zod schemas
 * in the engine.
 *
 * The server itself (parser, CORS, Origin check at the Engine.IO level, Redis adapter) comes from RealtimeIoAdapter.
 */
import { RT_EVENTS, RT_NAMESPACE, RT_PATH } from "@finlytics/shared";
import { WebSocketGateway } from "@nestjs/websockets";
import type { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit } from "@nestjs/websockets";
import type { Namespace, Socket } from "socket.io";

import type { AuthIdentity } from "../auth/auth-identity";

import type { RtNamespace } from "./realtime.engine";
import { RealtimeService } from "./realtime.service";

/** Calls `ack` when the client passed one; a throwing ack (a closed socket) is ignored. */
function reply(ack: unknown, payload: unknown): void {
  if (typeof ack !== "function") return;
  try {
    (ack as (value: unknown) => void)(payload);
  } catch {
    // The client is gone.
  }
}

/** What the namespace middleware stored on `socket.data`. */
function handshakeOf(socket: Socket): { identity: AuthIdentity; maxSubscriptions: number } | undefined {
  const data: unknown = socket.data;
  if (typeof data !== "object" || data === null) return undefined;
  const { identity, maxSubscriptions } = data as { identity?: AuthIdentity; maxSubscriptions?: number };
  return identity === undefined || maxSubscriptions === undefined ? undefined : { identity, maxSubscriptions };
}

/** The engine's view of a namespace: this pod's sockets and rooms only. */
export function namespaceView(namespace: Namespace): RtNamespace {
  return {
    roomMembers: (room) => namespace.adapter.rooms.get(room),
    socket: (id) => namespace.sockets.get(id),
    broadcastLocal: (event, payload) => {
      namespace.local.emit(event, payload);
    },
    backedUp: (id, limit) => {
      // Engine.IO keeps `writeBuffer` private; it is the only signal of a client that can't keep up.
      const conn: unknown = namespace.sockets.get(id)?.conn;
      const buffer: unknown = typeof conn === "object" && conn !== null ? Reflect.get(conn, "writeBuffer") : undefined;
      return Array.isArray(buffer) && buffer.length > limit;
    },
  };
}

@WebSocketGateway({ namespace: RT_NAMESPACE, path: RT_PATH })
export class RealtimeGateway
  implements OnGatewayInit<Namespace>, OnGatewayConnection<Socket>, OnGatewayDisconnect<Socket>
{
  constructor(private readonly realtime: RealtimeService) {}

  afterInit(namespace: Namespace): void {
    namespace.use((socket, next) => {
      void this.realtime
        .authenticate({ headers: socket.request.headers, remoteAddress: socket.request.socket.remoteAddress })
        .then((result) => {
          if (!result.ok) {
            next(new Error(result.code));
            return;
          }
          Object.assign(socket.data as object, {
            identity: result.identity,
            maxSubscriptions: result.maxSubscriptions,
          });
          next();
        });
    });
    this.realtime.engine.attach(namespaceView(namespace));
  }

  handleConnection(socket: Socket): void {
    const handshake = handshakeOf(socket);
    if (handshake === undefined) {
      socket.disconnect(true);
      return;
    }
    // Registered before any await, so a `sub` sent right after connecting always finds the socket.
    this.realtime.engine.register(socket, handshake.identity, handshake.maxSubscriptions);
    socket.on(RT_EVENTS.subscribe, (payload: unknown, ack: unknown) => {
      void this.realtime.engine.subscribe(socket.id, payload).then((result) => {
        reply(ack, result);
      });
    });
    socket.on(RT_EVENTS.unsubscribe, (payload: unknown, ack: unknown) => {
      void this.realtime.engine.unsubscribe(socket.id, payload).then((result) => {
        reply(ack, result);
      });
    });
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    await this.realtime.engine.unregister(socket.id);
  }
}
