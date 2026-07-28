import { OrderServiceFactory } from '../order/OrderServiceFactory';
import { Order, OrderLineItem } from '../order/OrderServiceInterface';
import { BasketItem } from '../basket/basket';
import { CheckoutResult, SyncResult } from '../order/order';
import { CheckoutServiceInterface } from '../checkout/CheckoutServiceInterface';
import { OrderSyncServiceInterface } from './OrderSyncServiceInterface';
import { OrderRepository } from '../../repositories/OrderRepository';
import { LoggerInterface } from '../logger/LoggerInterface';
import { MAX_SYNC_RETRIES, posConfig } from '../config/POSConfigService';
import { isOnlinePlatform } from '../../utils/platforms';
import { kdsServiceFactory } from '../kds/KdsServiceFactory';

/**
 * Handles syncing paid orders to e-commerce platforms.
 * Depends on CheckoutService for order queries.
 */
export class OrderSyncService implements OrderSyncServiceInterface {
  /** Tracks retry attempts per order (in-memory, resets on app restart) */
  private retryCounts = new Map<string, number>();

  constructor(
    private checkoutService: CheckoutServiceInterface,
    private orderRepo: OrderRepository,
    private orderServiceFactory: OrderServiceFactory,
    private logger: LoggerInterface
  ) {}

  async syncOrderToPlatform(orderId: string): Promise<CheckoutResult> {
    const localOrder = await this.checkoutService.getLocalOrder(orderId);

    if (!localOrder) {
      return { success: false, orderId, error: 'Order not found' };
    }

    if (localOrder.status !== 'paid') {
      return { success: false, orderId, error: 'Order must be paid before syncing' };
    }

    if (localOrder.syncStatus === 'synced') {
      return { success: true, orderId, platformOrderId: localOrder.platformOrderId };
    }

    // Offline orders have no platform to sync to — mark as synced immediately (spec requirement: sync.md §5.8)
    if (!localOrder.platform || !isOnlinePlatform(localOrder.platform)) {
      this.logger.info(`Offline order ${orderId} - marking as synced (fast-path)`);
      await this.orderRepo.updateSyncSuccess(orderId, orderId);
      this.dispatchKdsTicket(localOrder);
      return { success: true, orderId };
    }

    try {
      const orderService = this.orderServiceFactory.getService(localOrder.platform);

      // If a draft was created at checkout time, complete it rather than creating a duplicate
      if (localOrder.platformOrderId) {
        const completed = await orderService.completeOrder(
          localOrder.platformOrderId,
          localOrder.paymentMethod ?? 'unknown',
          localOrder.paymentTransactionId
        );
        const platformOrderId = completed?.platformOrderId ?? completed?.id ?? localOrder.platformOrderId;
        await this.orderRepo.updateSyncSuccess(orderId, platformOrderId);
        this.dispatchKdsTicket(localOrder);
        return { success: true, orderId, platformOrderId };
      }

      const platformOrder: Order = {
        customerEmail: localOrder.customerEmail,
        customerName: localOrder.customerName,
        lineItems: this.basketItemsToLineItems(localOrder.items),
        subtotal: localOrder.subtotal,
        tax: localOrder.tax,
        total: localOrder.total,
        discounts: localOrder.discountCode
          ? [{ code: localOrder.discountCode, amount: localOrder.discountAmount ?? 0, type: 'fixed_amount' }]
          : undefined,
        paymentStatus: 'paid',
        note:
          [
            localOrder.note,
            localOrder.payments && localOrder.payments.length > 1
              ? `Split payment: ${localOrder.payments.map(p => `${p.method} ${p.amount.toFixed(2)}`).join(', ')}`
              : undefined,
          ]
            .filter(Boolean)
            .join(' | ') || undefined,
        createdAt: localOrder.createdAt,
      };

      const createdOrder = await orderService.createOrder(platformOrder);
      await this.orderRepo.updateSyncSuccess(orderId, createdOrder.id ?? createdOrder.platformOrderId ?? '');
      this.dispatchKdsTicket(localOrder);

      return {
        success: true,
        orderId,
        platformOrderId: createdOrder.id ?? createdOrder.platformOrderId,
      };
    } catch (error) {
      const errorMessage = (error as Error).message;
      this.logger.error({ message: `Failed to sync order ${orderId} to platform` }, error as Error);

      const retries = (this.retryCounts.get(orderId) ?? 0) + 1;
      this.retryCounts.set(orderId, retries);

      if (this.isRetryable(error) && retries < MAX_SYNC_RETRIES()) {
        await this.orderRepo.updateSyncError(orderId, 'pending', errorMessage);
        this.logger.info(`Order ${orderId} queued for retry (${retries}/${MAX_SYNC_RETRIES()})`);
        return { success: false, orderId, error: `Order queued for retry (${retries}/${MAX_SYNC_RETRIES()}): ${errorMessage}` };
      } else {
        await this.orderRepo.updateSyncError(orderId, 'failed', errorMessage);
        this.retryCounts.delete(orderId);
        return { success: false, orderId, error: errorMessage };
      }
    }
  }

  async retrySingleOrder(orderId: string): Promise<CheckoutResult> {
    // Reset retry count so the order gets a fresh set of attempts
    this.retryCounts.delete(orderId);
    // Reset sync status back to pending so it's eligible for sync
    await this.orderRepo.updateSyncError(orderId, 'pending', '');
    return this.syncOrderToPlatform(orderId);
  }

  async discardFailedOrder(orderId: string): Promise<boolean> {
    try {
      // Validate order is in failed state (spec requirement: sync.md §5.7)
      const order = await this.orderRepo.findById(orderId);
      if (!order || order.sync_status !== 'failed') {
        this.logger.warn(`Cannot discard order ${orderId}: not in failed state`);
        return false;
      }

      await this.orderRepo.updateStatus(orderId, 'cancelled');
      await this.orderRepo.updateSyncError(orderId, 'failed', 'Manually discarded by user');
      this.retryCounts.delete(orderId);
      this.logger.info(`Discarded failed order: ${orderId}`);
      return true;
    } catch (error) {
      this.logger.error({ message: `Failed to discard order ${orderId}` }, error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  async syncAllPendingOrders(): Promise<SyncResult> {
    const unsyncedOrders = await this.checkoutService.getUnsyncedOrders();

    const result: SyncResult = { synced: 0, failed: 0, errors: [] };

    for (const order of unsyncedOrders) {
      const syncResult = await this.syncOrderToPlatform(order.id);

      if (syncResult.success) {
        result.synced++;
      } else {
        result.failed++;
        result.errors.push({ orderId: order.id, error: syncResult.error ?? 'Unknown error' });
      }
    }

    return result;
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof Error) {
      // Network errors are retryable
      if (error.name === 'TypeError' && error.message.includes('fetch')) return true;

      // Check HTTP status code
      const statusMatch = error.message.match(/status (\d+)/);
      if (statusMatch) {
        const status = parseInt(statusMatch[1], 10);
        // 5xx errors are retryable, 4xx are not
        return status >= 500;
      }
    }

    // Default to non-retryable for unknown errors (spec requirement: sync.md §1.7)
    return false;
  }

  private dispatchKdsTicket(order: { id: string; items: BasketItem[] }): void {
    kdsServiceFactory
      .getService()
      .sendOrder({
        orderId: order.id,
        orderRef: order.id.slice(-4),
        items: order.items.map(i => ({ id: i.productId, name: i.name, quantity: i.quantity })),
        placedAt: Date.now(),
      })
      .catch(err => {
        this.logger.warn({
          message: `KDS ticket dispatch failed for order ${order.id}: ${err instanceof Error ? err.message : String(err)}`,
        });
      });
  }

  private basketItemsToLineItems(items: BasketItem[]): OrderLineItem[] {
    // Fallback tax rate if item doesn't have one (spec requirement: sync.md §6.3)
    const DEFAULT_TAX_RATE = posConfig.values.taxRate ?? 0.2;

    return items.map(item => {
      const lineTotal = item.price * item.quantity;
      const taxRate = item.taxRate ?? DEFAULT_TAX_RATE;

      return {
        productId: item.originalId ?? item.productId,
        variantId: item.variantId,
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        total: lineTotal,
        taxRate,
        taxAmount: lineTotal * taxRate,
        taxCode: item.taxCode,
        properties: item.properties,
      };
    });
  }
}
