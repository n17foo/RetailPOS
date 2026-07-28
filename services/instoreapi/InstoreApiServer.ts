import { instoreApiConfig } from './InstoreApiConfig';
import { LoggerFactory } from '../logger/LoggerFactory';
import { orderRepository, CreateOrderInput } from '../../repositories/OrderRepository';
import { OrderItemRepository, CreateOrderItemInput } from '../../repositories/OrderItemRepository';
import { ProductRepository } from '../../repositories/ProductRepository';
import { taxProfileRepository } from '../../repositories/TaxProfileRepository';
import { returnRepository, CreateReturnInput } from '../../repositories/ReturnRepository';
import { syncEventBus } from './sync/SyncEventBus';
import { CommerceFullWebhookReceiver } from '../clients/commercefull/CommerceFullWebhookReceiver';
import { offlineProductService } from '../product/platforms/OfflineProductService';
import { offlineCategoryService } from '../category/platforms/OfflineCategoryService';
import { instoreApiTransport } from './InstoreApiTransport';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface RouteHandler {
  method: HttpMethod;
  path: string;
  handler: (params: Record<string, string>, body: unknown, headers?: Record<string, string>) => Promise<{ status: number; body: unknown }>;
}

/**
 * Lightweight instoreapi API server for multi-register offline setups.
 *
 * In React Native / Expo, we can't run a traditional Express server.
 * This service provides the *logic layer* — route definitions and handlers —
 * that can be mounted on top of a transport (e.g. a polled HTTP server via
 * `react-native-http-bridge`, or a WebSocket relay).
 *
 * The actual transport binding is in `InstoreApiTransport.ts`.
 */
export class InstoreApiServer {
  private static instance: InstoreApiServer;
  private logger = LoggerFactory.getInstance().createLogger('InstoreApiServer');
  private routes: RouteHandler[] = [];
  private running = false;
  private orderItemRepo = new OrderItemRepository();
  private productRepo = new ProductRepository();

  private constructor() {
    this.registerRoutes();
  }

  static getInstance(): InstoreApiServer {
    if (!InstoreApiServer.instance) {
      InstoreApiServer.instance = new InstoreApiServer();
    }
    return InstoreApiServer.instance;
  }

  get isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (!instoreApiConfig.isServer) {
      this.logger.warn('Cannot start server — not in server mode');
      return;
    }

    this.running = true;

    try {
      // Start the HTTP transport layer
      await instoreApiTransport.start();
      this.logger.info(`Local API server started on port ${instoreApiConfig.current.port}`);
    } catch (error) {
      this.running = false;
      this.logger.error('Failed to start HTTP transport:', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.running = false;

    try {
      // Stop the HTTP transport layer
      await instoreApiTransport.stop();
      this.logger.info('Local API server stopped');
    } catch (error) {
      this.logger.error('Failed to stop HTTP transport:', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Handle an incoming request. Called by the transport layer.
   * Returns a response object with status and body.
   */
  async handleRequest(
    method: HttpMethod,
    path: string,
    body?: unknown,
    headers?: Record<string, string>
  ): Promise<{ status: number; body: unknown }> {
    if (!this.running) {
      return { status: 503, body: { error: 'Server not running' } };
    }

    // Authenticate via shared secret
    const secret = instoreApiConfig.current.sharedSecret;
    if (secret && headers?.['x-shared-secret'] !== secret) {
      return { status: 401, body: { error: 'Unauthorized' } };
    }

    // Match route
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const params = this.matchPath(route.path, path);
      if (params !== null) {
        try {
          return await route.handler(params, body, headers);
        } catch (error) {
          this.logger.error({ message: `Error handling ${method} ${path}` }, error instanceof Error ? error : new Error(String(error)));
          return { status: 500, body: { error: 'Internal server error' } };
        }
      }
    }

    return { status: 404, body: { error: 'Not found' } };
  }

  // ── Route registration ──────────────────────────────────────────────

  private registerRoutes(): void {
    // Health
    this.route('GET', '/api/health', async () => ({
      status: 200,
      body: {
        ok: true,
        registerId: instoreApiConfig.current.registerId,
        registerName: instoreApiConfig.current.registerName,
        timestamp: Date.now(),
      },
    }));

    // ── Orders ────────────────────────────────────────────────────────
    this.route('GET', '/api/orders', async (_params, body) => {
      const b = body as Record<string, unknown> | undefined;
      const status = b?.status as string | undefined;
      const rows = await orderRepository.findAll(status);
      return { status: 200, body: { orders: rows } };
    });

    this.route('GET', '/api/orders/:id', async params => {
      const row = await orderRepository.findById(params.id);
      if (!row) return { status: 404, body: { error: 'Order not found' } };
      const items = await this.orderItemRepo.findByOrderId(params.id);
      return { status: 200, body: { order: row, items } };
    });

    this.route('GET', '/api/orders/unsynced', async () => {
      const rows = await orderRepository.findUnsynced();
      return { status: 200, body: { orders: rows } };
    });

    // ── Products ──────────────────────────────────────────────────────
    this.route('GET', '/api/products', async () => {
      const rows = await this.productRepo.findAll();
      return { status: 200, body: { products: rows } };
    });

    this.route('GET', '/api/products/:id', async params => {
      const row = await this.productRepo.findById(params.id);
      if (!row) return { status: 404, body: { error: 'Product not found' } };
      return { status: 200, body: { product: row } };
    });

    // ── Tax Profiles ──────────────────────────────────────────────────
    this.route('GET', '/api/tax-profiles', async () => {
      const rows = await taxProfileRepository.findActive();
      return { status: 200, body: { taxProfiles: rows } };
    });

    // ── Returns ───────────────────────────────────────────────────────
    this.route('GET', '/api/returns', async (_params, body) => {
      const b = body as Record<string, unknown> | undefined;
      const status = b?.status as string | undefined;
      const rows = await returnRepository.findAll(status);
      return { status: 200, body: { returns: rows } };
    });

    this.route('GET', '/api/returns/order/:orderId', async params => {
      const rows = await returnRepository.findByOrderId(params.orderId);
      return { status: 200, body: { returns: rows } };
    });

    // ── Sync Events (polling endpoint for client registers) ───────────
    this.route('GET', '/api/sync/events', async (_params, body) => {
      const b = body as Record<string, unknown> | undefined;
      const since = parseInt(String(b?.since || '0'), 10) || 0;
      const events = syncEventBus.getEventsSince(since);
      return { status: 200, body: { events } };
    });

    // ── Webhook Receiver (CommerceFull real-time push) ────────────────
    this.route('POST', '/api/webhooks/commercefull', async (_params, body, headers) => {
      const receiver = CommerceFullWebhookReceiver.getInstance();
      const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
      return await receiver.handleRequest(rawBody, headers || {});
    });

    // ── Categories ────────────────────────────────────────────────────
    this.route('GET', '/api/categories', async () => {
      const rows = await offlineCategoryService.getCategories();
      return { status: 200, body: { categories: rows } };
    });

    this.route('POST', '/api/categories', async (_params, body) => {
      const data = body as Parameters<typeof offlineCategoryService.addCategory>[0];
      const category = await offlineCategoryService.addCategory(data);
      syncEventBus.emit('config:updated', { entity: 'category', action: 'created', category });
      return { status: 201, body: { category } };
    });

    this.route('PUT', '/api/categories/:id', async (params, body) => {
      const data = body as Parameters<typeof offlineCategoryService.updateCategory>[1];
      const category = await offlineCategoryService.updateCategory(params.id, data);
      syncEventBus.emit('config:updated', { entity: 'category', action: 'updated', category });
      return { status: 200, body: { category } };
    });

    this.route('DELETE', '/api/categories/:id', async params => {
      await offlineCategoryService.deleteCategory(params.id);
      syncEventBus.emit('config:updated', { entity: 'category', action: 'deleted', id: params.id });
      return { status: 200, body: { ok: true } };
    });

    // ── Orders (write) ────────────────────────────────────────────────
    this.route('POST', '/api/orders', async (_params, body) => {
      const b = body as { order: CreateOrderInput; items: CreateOrderItemInput[] };
      await orderRepository.create(b.order);
      await this.orderItemRepo.createMany(b.items);
      const row = await orderRepository.findById(b.order.id);
      syncEventBus.emit('order:created', { orderId: b.order.id });
      return { status: 201, body: { order: row } };
    });

    this.route('PUT', '/api/orders/:id/status', async (params, body) => {
      const b = body as { status: string };
      await orderRepository.updateStatus(params.id, b.status);
      const row = await orderRepository.findById(params.id);
      syncEventBus.emit('order:updated', { orderId: params.id, status: b.status });
      return { status: 200, body: { order: row } };
    });

    this.route('PUT', '/api/orders/:id/payment', async (params, body) => {
      const b = body as { paymentMethod: string; transactionId?: string };
      await orderRepository.updatePayment(params.id, b.paymentMethod, b.transactionId ?? null);
      const row = await orderRepository.findById(params.id);
      syncEventBus.emit('order:paid', { orderId: params.id });
      return { status: 200, body: { order: row } };
    });

    // ── Products (write) ──────────────────────────────────────────────
    this.route('POST', '/api/products', async (_params, body) => {
      const data = body as Parameters<typeof offlineProductService.createProduct>[0];
      const product = await offlineProductService.createProduct(data);
      syncEventBus.emit('product:updated', { action: 'created', product });
      return { status: 201, body: { product } };
    });

    this.route('PUT', '/api/products/:id', async (params, body) => {
      const data = body as Parameters<typeof offlineProductService.updateProduct>[1];
      const product = await offlineProductService.updateProduct(params.id, data);
      syncEventBus.emit('product:updated', { action: 'updated', product });
      return { status: 200, body: { product } };
    });

    this.route('DELETE', '/api/products/:id', async params => {
      await offlineProductService.deleteProduct(params.id);
      syncEventBus.emit('product:updated', { action: 'deleted', id: params.id });
      return { status: 200, body: { ok: true } };
    });

    // ── Returns (write) ───────────────────────────────────────────────
    this.route('POST', '/api/returns', async (_params, body) => {
      const b = body as { input: CreateReturnInput; processedBy?: string };
      const id = await returnRepository.create(b.input);
      await returnRepository.updateStatus(id, 'completed', b.processedBy);
      syncEventBus.emit('return:created', { returnId: id, orderId: b.input.orderId });
      return { status: 201, body: { returnId: id } };
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private route(method: HttpMethod, path: string, handler: RouteHandler['handler']): void {
    this.routes.push({ method, path, handler });
  }

  /**
   * Simple path matcher supporting `:param` segments.
   * Returns params map or null if no match.
   */
  private matchPath(pattern: string, actual: string): Record<string, string> | null {
    const patternParts = pattern.split('/').filter(Boolean);
    const actualParts = actual.split('?')[0].split('/').filter(Boolean);

    if (patternParts.length !== actualParts.length) return null;

    const params: Record<string, string> = {};
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        params[patternParts[i].slice(1)] = actualParts[i];
      } else if (patternParts[i] !== actualParts[i]) {
        return null;
      }
    }
    return params;
  }
}

export const instoreApiServer = InstoreApiServer.getInstance();
