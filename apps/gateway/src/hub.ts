import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { WsServerMessage, WsClientMessage } from "@jarvis/schemas";
import { logger } from "@jarvis/core";

// ── WebSocket hub: gateway ⇄ desktop UI (§45, realtime transport) ─────────
// One socket carries server events and client commands (chat.send).

export class WsHub {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  /** Handler for client commands (chat.send). Set by the gateway. */
  onClientMessage: ((msg: WsClientMessage) => void) | null = null;

  constructor() {
    this.wss = new WebSocketServer({ noServer: true });
  }

  /** Attach to an upgraded HTTP connection. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.clients.add(ws);
      logger.info("ws.connected", { clients: this.clients.size });
      this.send(ws, { type: "hello", ts: new Date().toISOString() });
      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(String(raw)) as WsClientMessage;
          this.onClientMessage?.(msg);
        } catch {
          // ignore malformed frames
        }
      });
      ws.on("close", () => {
        this.clients.delete(ws);
        logger.info("ws.disconnected", { clients: this.clients.size });
      });
      ws.on("error", () => this.clients.delete(ws));
    });
  }

  broadcast(msg: WsServerMessage): void {
    const data = JSON.stringify(msg);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }

  private send(ws: WebSocket, msg: WsServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }
}
