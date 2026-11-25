// The live update stream (server-sent events) behind /api/badges/stream:
// connected clients, the per-IP and total connection caps, and broadcasts.

import { log } from './logger';

const MAX_SSE_CLIENTS = 500;
const MAX_SSE_PER_IP = 50;

export interface NewBadgeEvent {
  employeeId: string;
  name: string;
  department: string;
  title: string;
  accessLevel: string;
  accessCss: string;
  isBandMember: boolean;
}

export interface LiveStream {
  /** Opens a stream for a client, or answers 503 (server full) or 429 (too many from this address). */
  connect(clientIp: string): Response;
  /** Sends a new-badge event to every client. */
  broadcastNewBadge(badge: NewBadgeEvent): void;
  /** Sends any named event to every client. */
  broadcastSSE(event: string, data: unknown): void;
}

interface SSEClient {
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
  keepalive: ReturnType<typeof setInterval>;
  ip: string;
}

export function createLiveStream(): LiveStream {
  const clients = new Set<SSEClient>();
  const countByIp = new Map<string, number>();

  function send(event: string, data: string) {
    for (const client of clients) {
      try {
        client.controller.enqueue(client.encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
      } catch {
        clearInterval(client.keepalive);
        clients.delete(client);
      }
    }
  }

  return {
    broadcastNewBadge(badge) {
      send('new-badge', JSON.stringify(badge));
    },

    broadcastSSE(event, data) {
      send(event, JSON.stringify(data));
    },

    connect(clientIp) {
      if (clients.size >= MAX_SSE_CLIENTS) {
        return new Response(JSON.stringify({ success: false, error: 'Too many live connections. Try again later.' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '30' },
        });
      }

      const ipCount = countByIp.get(clientIp) || 0;
      if (ipCount >= MAX_SSE_PER_IP) {
        return new Response(JSON.stringify({ success: false, error: 'Too many connections from this address.' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '10' },
        });
      }
      countByIp.set(clientIp, ipCount + 1);

      const encoder = new TextEncoder();
      let clientRef: SSEClient | null = null;

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(': ok\n\nevent: connected\ndata: connected\n\n'));

          const keepalive = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(': keepalive\n\n'));
            } catch {
              clearInterval(keepalive);
            }
          }, 5_000);

          clientRef = { controller, encoder, keepalive, ip: clientIp };
          clients.add(clientRef);
          log('info', 'sse', `Client connected (${clients.size} total)`);
        },
        cancel() {
          if (clientRef) {
            clearInterval(clientRef.keepalive);
            clients.delete(clientRef);
            const remaining = (countByIp.get(clientRef.ip) || 1) - 1;
            if (remaining <= 0) countByIp.delete(clientRef.ip);
            else countByIp.set(clientRef.ip, remaining);
            clientRef = null;
            log('info', 'sse', `Client disconnected (${clients.size} total)`);
          }
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'no-referrer',
        },
      });
    },
  };
}
