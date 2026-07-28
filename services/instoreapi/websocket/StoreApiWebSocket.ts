/**
 * StoreApiWebSocket
 *
 * WebSocket client implementing the integration-hub's HELLO / replay / snapshot
 * reconnect state machine. Connects to the store-api's `/ws` endpoint and
 * maintains a persistent real-time link for receiving outbox messages (order
 * updates, payment events, config changes, etc.).
 *
 * Protocol:
 *   1. Client connects to ws://store-api.local:8080/ws
 *   2. Client sends a HELLO message with device_id, device_type, last acked seq
 *   3. Server responds with either:
 *      - replay (messages since last ack)
 *      - snapshot_needed (client must fetch /api/snapshot)
 *      - resume_ack (nothing missed)
 *   4. Client acks each received message with { server_seq }
 *   5. Server pings every 10s; client must respond within 30s
 */

import { instoreApiConfig } from '../InstoreApiConfig';
import { LoggerFactory } from '../../logger/LoggerFactory';
import { syncEventBus } from '../sync/SyncEventBus';
import EventEmitter from 'eventemitter3';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HelloMessage {
  device_id: string;
  device_type: string;
  protocol_version: number;
  session_nonce: string;
  last_acked_server_seq: number;
  last_seen_snapshot_version: number;
}

export interface ServerMessage {
  type: string;
  server_seq?: number;
  dedupe_key?: string;
  payload?: unknown;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'streaming' | 'reconnecting';

export type StoreApiWSEvent =
  | { type: 'connected' }
  | { type: 'disconnected' }
  | { type: 'message'; data: ServerMessage }
  | { type: 'snapshot_needed'; url: string }
  | { type: 'connection_state'; state: ConnectionState }
  | { type: 'error'; error: unknown };

// ─── Config ───────────────────────────────────────────────────────────────────

const PROTOCOL_VERSION = 1;
const HEARTBEAT_TIMEOUT_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 10;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;

// ─── StoreApiWebSocket ────────────────────────────────────────────────────────

export class StoreApiWebSocket extends EventEmitter {
  private static instance: StoreApiWebSocket;
  private logger = LoggerFactory.getInstance().createLogger('StoreApiWebSocket');

  private ws: WebSocket | null = null;
  private connectionState: ConnectionState = 'disconnected';
  private lastAckedServerSeq = 0;
  private lastSeenSnapshotVersion = 0;
  private sessionNonce = '';
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private processedDedupeKeys = new Set<string>();
  private readonly MAX_DEDUPE_CACHE = 5000;

  private constructor() {
    super();
  }

  static getInstance(): StoreApiWebSocket {
    if (!StoreApiWebSocket.instance) {
      StoreApiWebSocket.instance = new StoreApiWebSocket();
    }
    return StoreApiWebSocket.instance;
  }

  get state(): ConnectionState {
    return this.connectionState;
  }

  get lastAckedSeq(): number {
    return this.lastAckedServerSeq;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Connect to the store-api WebSocket endpoint.
   * Sends the HELLO message upon connection.
   */
  connect(): void {
    if (this.connectionState === 'connected' || this.connectionState === 'streaming') {
      this.logger.warn('Already connected');
      return;
    }

    if (!instoreApiConfig.isMultiRegister) {
      this.logger.warn('WebSocket not used in standalone mode');
      return;
    }

    this.stopped = false;
    this.sessionNonce = this.generateNonce();
    this.setConnectionState('connecting');
    this.openSocket();
  }

  /**
   * Gracefully disconnect and stop reconnection attempts.
   */
  disconnect(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.ws) {
      this.ws.onclose = null; // prevent reconnect on intentional close
      this.ws.close();
      this.ws = null;
    }
    this.setConnectionState('disconnected');
  }

  /**
   * Restore last acked seq from persistent storage (call at startup).
   */
  restoreState(lastAckedServerSeq: number, lastSeenSnapshotVersion: number): void {
    this.lastAckedServerSeq = lastAckedServerSeq;
    this.lastSeenSnapshotVersion = lastSeenSnapshotVersion;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private openSocket(): void {
    const baseUrl = instoreApiConfig.baseUrl;
    const wsUrl = baseUrl.replace(/^http/, 'ws') + '/ws';

    this.logger.info(`Connecting to ${wsUrl}`);

    try {
      this.ws = new WebSocket(wsUrl);
    } catch (err) {
      this.logger.error('Failed to create WebSocket', err instanceof Error ? err : new Error(String(err)));
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.logger.info('WebSocket connected, sending HELLO');
      this.reconnectAttempt = 0;
      this.setConnectionState('connected');
      this.sendHello();
    };

    this.ws.onmessage = event => {
      this.resetHeartbeatTimer();
      this.handleMessage(event.data);
    };

    this.ws.onerror = event => {
      this.logger.warn('WebSocket error', event);
      this.emitEvent({ type: 'error', error: event });
    };

    this.ws.onclose = () => {
      this.logger.info('WebSocket closed');
      this.clearTimers();
      this.setConnectionState('disconnected');
      this.emitEvent({ type: 'disconnected' });

      if (!this.stopped) {
        this.scheduleReconnect();
      }
    };
  }

  private sendHello(): void {
    const hello: HelloMessage = {
      device_id: instoreApiConfig.current.registerId,
      device_type: 'pos',
      protocol_version: PROTOCOL_VERSION,
      session_nonce: this.sessionNonce,
      last_acked_server_seq: this.lastAckedServerSeq,
      last_seen_snapshot_version: this.lastSeenSnapshotVersion,
    };

    this.send(hello);
    this.resetHeartbeatTimer();
  }

  private handleMessage(raw: unknown): void {
    let msg: ServerMessage;
    try {
      msg = typeof raw === 'string' ? JSON.parse(raw) : (raw as ServerMessage);
    } catch {
      this.logger.warn('Failed to parse WebSocket message');
      return;
    }

    switch (msg.type) {
      case 'ping':
        // Respond to server pings with a pong (empty ack)
        this.send({ server_seq: 0 });
        break;

      case 'resume_ack':
        this.logger.info('Server confirmed resume — no missed messages');
        this.setConnectionState('streaming');
        this.emitEvent({ type: 'connected' });
        break;

      case 'snapshot_needed': {
        const payload = msg.payload as { url?: string } | undefined;
        const url = payload?.url ?? '/api/snapshot';
        this.logger.info(`Snapshot needed — fetch from ${url}`);
        this.setConnectionState('streaming');
        this.emitEvent({ type: 'snapshot_needed', url });
        break;
      }

      case 'replay':
        // A replayed message from the outbox
        this.handleDataMessage(msg);
        break;

      default:
        // Any other message type is a live push from the dispatcher
        this.handleDataMessage(msg);
        break;
    }
  }

  private handleDataMessage(msg: ServerMessage): void {
    // Deduplicate by dedupe_key
    if (msg.dedupe_key) {
      if (this.processedDedupeKeys.has(msg.dedupe_key)) {
        // Already processed, just ack
        if (msg.server_seq) this.ack(msg.server_seq);
        return;
      }
      this.processedDedupeKeys.add(msg.dedupe_key);
      if (this.processedDedupeKeys.size > this.MAX_DEDUPE_CACHE) {
        // Evict oldest entries (Set maintains insertion order)
        const iterator = this.processedDedupeKeys.values();
        for (let i = 0; i < 1000; i++) {
          const result = iterator.next();
          if (result.done) break;
          this.processedDedupeKeys.delete(result.value);
        }
      }
    }

    // Emit the message for consumers
    this.emitEvent({ type: 'message', data: msg });

    // Route to the sync event bus for compatibility with existing polling consumers
    this.routeToSyncEventBus(msg);

    // Ack the message
    if (msg.server_seq) {
      this.ack(msg.server_seq);
    }

    // Mark as streaming after first data message
    if (this.connectionState === 'connected') {
      this.setConnectionState('streaming');
    }
  }

  /**
   * Route incoming WS messages to the existing SyncEventBus so screens and
   * services that already subscribe to sync events continue to work.
   */
  private routeToSyncEventBus(msg: ServerMessage): void {
    // The outbox payload follows the same SyncEvent shape when the msg type
    // matches a known sync event type. For other types (payment.*, etc.)
    // we emit them via the EventEmitter only.
    const payload = msg.payload as Record<string, unknown> | undefined;
    if (!payload) return;

    // If the payload looks like a SyncEvent (has type, registerId, timestamp)
    // dispatch it through the existing bus.
    if (payload.type && payload.registerId && payload.timestamp) {
      syncEventBus.receive(payload as unknown as Parameters<typeof syncEventBus.receive>[0]);
    }
  }

  private ack(serverSeq: number): void {
    this.lastAckedServerSeq = Math.max(this.lastAckedServerSeq, serverSeq);
    this.send({ server_seq: serverSeq });
  }

  private send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  private resetHeartbeatTimer(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => {
      this.logger.warn('Heartbeat timeout — closing socket');
      this.ws?.close();
    }, HEARTBEAT_TIMEOUT_MS);
  }

  // ── Reconnect ─────────────────────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.stopped) return;
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      this.logger.error(`Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached`);
      this.setConnectionState('disconnected');
      return;
    }

    this.setConnectionState('reconnecting');
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** this.reconnectAttempt, BACKOFF_CAP_MS);
    this.reconnectAttempt++;

    this.logger.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => {
      this.openSocket();
    }, delay);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    this.emitEvent({ type: 'connection_state', state });
  }

  private emitEvent(event: StoreApiWSEvent): void {
    this.emit(event.type, event);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private generateNonce(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export const storeApiWebSocket = StoreApiWebSocket.getInstance();
