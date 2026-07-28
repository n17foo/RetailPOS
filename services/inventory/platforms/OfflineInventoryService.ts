import { InventoryServiceInterface, InventoryResult, InventoryUpdate, InventoryUpdateResult } from '../InventoryServiceInterface';
import { LoggerFactory } from '../../logger/LoggerFactory';
import { keyValueRepository } from '../../../repositories/KeyValueRepository';

const INVENTORY_STORAGE_KEY = 'offline_local_inventory';

/**
 * Offline inventory service for local-first POS operation
 * Tracks inventory locally via SQLite - no online sync
 * In offline mode, inventory is maintained locally and not synced with any platform
 */
export class OfflineInventoryService implements InventoryServiceInterface {
  private initialized: boolean = false;
  private inventory: Map<string, { quantity: number; sku?: string; updatedAt: Date }> = new Map();
  private logger = LoggerFactory.getInstance().createLogger('OfflineInventoryService');

  /**
   * Initialize the offline inventory service
   * Loads inventory from local storage
   */
  async initialize(): Promise<boolean> {
    try {
      const storedInventory = await keyValueRepository.getItem(INVENTORY_STORAGE_KEY);
      if (storedInventory) {
        const parsed = JSON.parse(storedInventory);
        this.inventory = new Map(
          Object.entries(parsed).map(([key, value]: [string, unknown]) => [
            key,
            {
              ...(value as { quantity: number; sku?: string; updatedAt?: string }),
              updatedAt: (value as { updatedAt?: string })?.updatedAt ? new Date((value as { updatedAt?: string }).updatedAt!) : new Date(),
            },
          ])
        );
        this.logger.info(`Loaded ${this.inventory.size} inventory items from local storage`);
      }

      this.initialized = true;
      this.logger.info('Offline inventory service initialized (local-only mode)');
      return true;
    } catch (error) {
      this.logger.error(
        { message: 'Error initializing offline inventory service' },
        error instanceof Error ? error : new Error(String(error))
      );
      this.initialized = false;
      return false;
    }
  }

  /**
   * Check if the service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get inventory levels for products (from local storage)
   */
  async getInventory(productIds: string[]): Promise<InventoryResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const items = productIds.map(productId => {
      const item = this.inventory.get(productId);
      return {
        productId,
        quantity: item?.quantity || 0,
        sku: item?.sku || undefined,
        updatedAt: item?.updatedAt,
      };
    });

    return { items };
  }

  /**
   * Update inventory levels (stored locally only)
   */
  async updateInventory(updates: InventoryUpdate[]): Promise<InventoryUpdateResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const result: InventoryUpdateResult = {
      successful: 0,
      failed: 0,
      errors: [],
    };

    const now = new Date();

    updates.forEach(update => {
      try {
        const currentItem = this.inventory.get(update.productId) || { quantity: 0 };

        let newQuantity: number;
        if (update.adjustment) {
          newQuantity = currentItem.quantity + update.quantity;
        } else {
          newQuantity = update.quantity;
        }

        newQuantity = Math.max(0, newQuantity);

        this.inventory.set(update.productId, {
          quantity: newQuantity,
          sku: update.variantId || (currentItem as { sku?: string }).sku,
          updatedAt: now,
        });

        result.successful++;
        this.logger.info(`Updated inventory for ${update.productId}: ${newQuantity}`);
      } catch (error) {
        result.failed++;
        result.errors.push({
          productId: update.productId,
          variantId: update.variantId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    await this.saveInventoryToStorage();
    return result;
  }

  /**
   * Get all inventory items
   */
  async getAllInventory(): Promise<InventoryResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const items = Array.from(this.inventory.entries()).map(([productId, data]) => ({
      productId,
      quantity: data.quantity,
      sku: data.sku,
      updatedAt: data.updatedAt,
    }));

    return { items };
  }

  /**
   * Get low stock items (quantity <= threshold)
   */
  async getLowStockItems(threshold: number = 5): Promise<InventoryResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const items = Array.from(this.inventory.entries())
      .filter(([, data]) => data.quantity <= threshold)
      .map(([productId, data]) => ({
        productId,
        quantity: data.quantity,
        sku: data.sku,
        updatedAt: data.updatedAt,
      }));

    return { items };
  }

  /**
   * Get out of stock items (quantity = 0)
   */
  async getOutOfStockItems(): Promise<InventoryResult> {
    return this.getLowStockItems(0);
  }

  /**
   * Clear all local inventory
   */
  async clearLocalInventory(): Promise<void> {
    this.inventory.clear();
    await keyValueRepository.removeItem(INVENTORY_STORAGE_KEY);
    this.logger.info('Cleared all local inventory');
  }

  /**
   * Get inventory statistics
   */
  async getInventoryStats(): Promise<{
    totalItems: number;
    totalQuantity: number;
    lowStockItems: number;
    outOfStockItems: number;
  }> {
    if (!this.initialized) {
      await this.initialize();
    }

    const items = Array.from(this.inventory.values());
    const totalItems = items.length;
    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    const lowStockItems = items.filter(item => item.quantity <= 5 && item.quantity > 0).length;
    const outOfStockItems = items.filter(item => item.quantity === 0).length;

    return {
      totalItems,
      totalQuantity,
      lowStockItems,
      outOfStockItems,
    };
  }

  /**
   * Save inventory to local storage
   */
  private async saveInventoryToStorage(): Promise<void> {
    const obj = Object.fromEntries(this.inventory);
    await keyValueRepository.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(obj));
  }
}

export const offlineInventoryService = new OfflineInventoryService();
