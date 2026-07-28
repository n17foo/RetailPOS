import { SyncDirection, SyncEntityType, SyncError, SyncOperationResult, SyncOptions } from '../SyncServiceInterface';
import { BasePlatformSyncService } from './BasePlatformSyncService';
import { PlatformSyncConfig, PlatformSyncConfigRequirements } from './PlatformSyncServiceInterface';
import { ProductServiceFactory } from '../../product/ProductServiceFactory';
import { InventoryServiceFactory } from '../../inventory/InventoryServiceFactory';
import { CategoryServiceFactory } from '../../category/CategoryServiceFactory';
import { OrderServiceFactory } from '../../order/OrderServiceFactory';
import { ECommercePlatform } from '../../../utils/platforms';
import { WooCommerceApiClient } from '../../clients/woocommerce/WooCommerceApiClient';

/**
 * WooCommerce-specific sync service implementation
 */
export class WooCommerceSyncService extends BasePlatformSyncService {
  private webhookIds: string[] = [];
  private apiClient = WooCommerceApiClient.getInstance();

  /**
   * Get configuration requirements for WooCommerce
   */
  getConfigRequirements(): PlatformSyncConfigRequirements {
    return {
      required: ['storeUrl', 'apiKey', 'apiSecret'],
      optional: ['webhookUrl', 'batchSize', 'version'],
    };
  }

  /**
   * Initialize the WooCommerce sync service
   */
  async initialize(config: PlatformSyncConfig): Promise<boolean> {
    if (!config.storeUrl || !config.apiKey || !config.apiSecret) {
      this.logger.error({ message: 'WooCommerce storeUrl, apiKey, and apiSecret are required' });
      return false;
    }
    if (!this.apiClient.isInitialized()) {
      this.apiClient.configure({
        storeUrl: config.storeUrl,
        consumerKey: config.apiKey as string,
        consumerSecret: config.apiSecret as string,
      });
      await this.apiClient.initialize();
    }

    // Call base class initialization
    const baseInitialized = await super.initialize(config);
    if (!baseInitialized) {
      return false;
    }

    this.initialized = true;
    return true;
  }

  /**
   * Test connection to WooCommerce API
   */
  async testConnection(): Promise<boolean> {
    if (!this.isInitialized()) {
      return false;
    }

    try {
      await this.apiClient.get('system_status');
      return true;
    } catch (error) {
      this.logger.error({ message: 'Error testing WooCommerce connection' }, error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  /**
   * Register webhooks for real-time sync
   */
  async registerSyncWebhooks(webhookUrl: string): Promise<boolean> {
    if (!this.isInitialized()) {
      return false;
    }

    try {
      // Define webhook topics based on entity types
      const webhookTopics = [
        // Product webhooks
        { topic: 'product.created', name: 'Product Created' },
        { topic: 'product.updated', name: 'Product Updated' },
        { topic: 'product.deleted', name: 'Product Deleted' },
        // Order webhooks
        { topic: 'order.created', name: 'Order Created' },
        { topic: 'order.updated', name: 'Order Updated' },
        { topic: 'order.deleted', name: 'Order Deleted' },
        // Product category webhooks
        { topic: 'product_cat.created', name: 'Product Category Created' },
        { topic: 'product_cat.updated', name: 'Product Category Updated' },
        { topic: 'product_cat.deleted', name: 'Product Category Deleted' },
      ];

      // Register each webhook
      const results = await Promise.all(
        webhookTopics.map(async ({ topic, name }) => {
          try {
            const data = await this.apiClient.post<{ id?: string }>('webhooks', {
              name,
              topic,
              delivery_url: webhookUrl,
              status: 'active',
            });
            return data.id ?? null;
          } catch (error) {
            this.logger.error(
              { message: `Error registering WooCommerce webhook for ${topic}` },
              error instanceof Error ? error : new Error(String(error))
            );
            return null;
          }
        })
      );

      // Store successful webhook IDs
      this.webhookIds = results.filter(Boolean) as string[];

      return this.webhookIds.length > 0;
    } catch (error) {
      this.logger.error({ message: 'Error registering WooCommerce webhooks' }, error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  /**
   * Unregister previously registered webhooks
   */
  async unregisterSyncWebhooks(): Promise<boolean> {
    if (!this.isInitialized() || this.webhookIds.length === 0) {
      return false;
    }

    try {
      // Delete each registered webhook
      const results = await Promise.all(
        this.webhookIds.map(async webhookId => {
          try {
            await this.apiClient.delete(`webhooks/${webhookId}?force=true`);
            return true;
          } catch (error) {
            this.logger.error(
              { message: `Error unregistering WooCommerce webhook ${webhookId}` },
              error instanceof Error ? error : new Error(String(error))
            );
            return false;
          }
        })
      );

      // Clear webhook IDs
      this.webhookIds = [];

      // Return true if all webhooks were successfully deleted
      return results.every(Boolean);
    } catch (error) {
      this.logger.error({ message: 'Error unregistering WooCommerce webhooks' }, error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  /**
   * Execute a sync operation against WooCommerce
   */
  protected async executeSyncOperation(syncId: string, options: SyncOptions): Promise<void> {
    if (!this.isInitialized()) {
      throw new Error('WooCommerce sync service not initialized');
    }

    const startTime = new Date();
    let entityCount = 0;
    let successful = 0;
    let failed = 0;
    let skipped = 0;
    const errors: SyncError[] = [];
    const warnings: string[] = [];

    try {
      // Get appropriate services based on entity type
      switch (options.entityType) {
        case SyncEntityType.PRODUCT:
          await this.syncProducts(syncId, options, { successful, failed, skipped, errors, warnings, entityCount });
          break;

        case SyncEntityType.INVENTORY:
          await this.syncInventory(syncId, options, { successful, failed, skipped, errors, warnings, entityCount });
          break;

        case SyncEntityType.CATEGORY:
          await this.syncCategories(syncId, options, { successful, failed, skipped, errors, warnings, entityCount });
          break;

        case SyncEntityType.ORDER:
          await this.syncOrders(syncId, options, { successful, failed, skipped, errors, warnings, entityCount });
          break;

        case SyncEntityType.ALL:
          // Sync all entity types
          await this.syncProducts(
            syncId,
            { ...options, entityType: SyncEntityType.PRODUCT },
            { successful, failed, skipped, errors, warnings, entityCount }
          );

          await this.syncInventory(
            syncId,
            { ...options, entityType: SyncEntityType.INVENTORY },
            { successful, failed, skipped, errors, warnings, entityCount }
          );

          await this.syncCategories(
            syncId,
            { ...options, entityType: SyncEntityType.CATEGORY },
            { successful, failed, skipped, errors, warnings, entityCount }
          );

          await this.syncOrders(
            syncId,
            { ...options, entityType: SyncEntityType.ORDER },
            { successful, failed, skipped, errors, warnings, entityCount }
          );
          break;

        default:
          warnings.push(`Entity type ${options.entityType} not supported for WooCommerce sync`);
      }

      // Complete the sync operation
      const endTime = new Date();
      const result: SyncOperationResult = {
        entityType: options.entityType,
        successful,
        failed,
        skipped,
        errors,
        warnings,
        completedAt: endTime,
        durationMs: endTime.getTime() - startTime.getTime(),
      };

      this.completeSyncOperation(syncId, result);
    } catch (error) {
      this.logger.error(
        { message: `Error in WooCommerce sync operation ${syncId}` },
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * Sync products between POS and WooCommerce
   */
  private async syncProducts(
    syncId: string,
    options: SyncOptions,
    stats: { successful: number; failed: number; skipped: number; errors: SyncError[]; warnings: string[]; entityCount: number }
  ): Promise<void> {
    const _productService = ProductServiceFactory.getInstance().getService(ECommercePlatform.WOOCOMMERCE);

    try {
      if (options.direction === SyncDirection.POS_TO_ECOMMERCE) {
        // Get products from database or another source
        // For now, we'll assume products are passed in entityIds
        if (!options.entityIds || options.entityIds.length === 0) {
          stats.warnings.push('No product IDs specified for sync');
          return;
        }

        // Update progress total
        stats.entityCount += options.entityIds.length;
        this.updateSyncProgress(syncId, 0, stats.entityCount);

        // Process each product
        for (let i = 0; i < options.entityIds.length; i++) {
          if (options.dryRun) {
            stats.skipped++;
          } else {
            try {
              // In a real implementation, sync each product to WooCommerce
              stats.successful++;
            } catch (error) {
              stats.failed++;
              stats.errors.push({
                entityId: options.entityIds[i],
                message: `Failed to sync product: ${(error instanceof Error ? error.message : String(error)) || 'Unknown error'}`,
                details: error,
              });
            }
          }

          // Update progress
          this.updateSyncProgress(syncId, stats.successful + stats.failed + stats.skipped, stats.entityCount);
        }
      } else if (options.direction === SyncDirection.ECOMMERCE_TO_POS) {
        // Fetch products from WooCommerce
        // In a real implementation, we'd use the productService
        const productCount = 50; // Simulate fetching 50 products

        // Update progress total
        stats.entityCount += productCount;
        this.updateSyncProgress(syncId, 0, stats.entityCount);

        // Simulate processing each product
        for (let i = 0; i < productCount; i++) {
          if (options.dryRun) {
            stats.skipped++;
          } else {
            try {
              // In a real implementation, sync product to POS
              stats.successful++;
            } catch (error) {
              stats.failed++;
              stats.errors.push({
                entityId: `product-${i}`,
                message: `Failed to sync product to POS: ${(error instanceof Error ? error.message : String(error)) || 'Unknown error'}`,
                details: error,
              });
            }
          }

          // Update progress
          this.updateSyncProgress(syncId, stats.successful + stats.failed + stats.skipped, stats.entityCount);

          // Simulate some processing delay
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    } catch (error) {
      stats.warnings.push(`Error in WooCommerce product sync: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Sync inventory between POS and WooCommerce
   */
  private async syncInventory(
    syncId: string,
    options: SyncOptions,
    stats: { successful: number; failed: number; skipped: number; errors: SyncError[]; warnings: string[]; entityCount: number }
  ): Promise<void> {
    const _inventoryService = InventoryServiceFactory.getInstance().getService(ECommercePlatform.WOOCOMMERCE);

    try {
      if (options.direction === SyncDirection.POS_TO_ECOMMERCE) {
        // Similar implementation to products sync
        if (!options.entityIds || options.entityIds.length === 0) {
          stats.warnings.push('No inventory IDs specified for sync');
          return;
        }

        // Update progress total
        stats.entityCount += options.entityIds.length;
        this.updateSyncProgress(syncId, 0, stats.entityCount);

        // Process inventory updates
        for (let i = 0; i < options.entityIds.length; i++) {
          // Simulate sync operations
          stats.successful++;
          this.updateSyncProgress(syncId, stats.successful + stats.failed + stats.skipped, stats.entityCount);
          await new Promise(resolve => setTimeout(resolve, 30));
        }
      } else {
        // Simulate fetching inventory from WooCommerce
        const inventoryCount = 40;
        stats.entityCount += inventoryCount;
        this.updateSyncProgress(syncId, 0, stats.entityCount);

        // Simulate processing
        for (let i = 0; i < inventoryCount; i++) {
          stats.successful++;
          this.updateSyncProgress(syncId, stats.successful + stats.failed + stats.skipped, stats.entityCount);

          // Simulate some processing delay
          await new Promise(resolve => setTimeout(resolve, 30));
        }
      }
    } catch (error) {
      stats.warnings.push(`Error in WooCommerce inventory sync: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Sync categories between POS and WooCommerce
   */
  private async syncCategories(
    syncId: string,
    options: SyncOptions,
    stats: { successful: number; failed: number; skipped: number; errors: SyncError[]; warnings: string[]; entityCount: number }
  ): Promise<void> {
    const _categoryService = CategoryServiceFactory.getInstance().getService(ECommercePlatform.WOOCOMMERCE);

    try {
      if (options.direction === SyncDirection.ECOMMERCE_TO_POS) {
        // Simulate fetching categories from WooCommerce
        const categoryCount = 15;
        stats.entityCount += categoryCount;
        this.updateSyncProgress(syncId, 0, stats.entityCount);

        // Simulate processing
        for (let i = 0; i < categoryCount; i++) {
          stats.successful++;
          this.updateSyncProgress(syncId, stats.successful + stats.failed + stats.skipped, stats.entityCount);

          // Simulate some processing delay
          await new Promise(resolve => setTimeout(resolve, 40));
        }
      } else {
        // Implement POS to WooCommerce sync
        if (!options.entityIds || options.entityIds.length === 0) {
          stats.warnings.push('No category IDs specified for sync');
          return;
        }

        // Update progress total
        stats.entityCount += options.entityIds.length;
        this.updateSyncProgress(syncId, 0, stats.entityCount);

        // Process each category
        for (let i = 0; i < options.entityIds.length; i++) {
          if (options.dryRun) {
            stats.skipped++;
          } else {
            try {
              // In a real implementation, sync each category to WooCommerce
              stats.successful++;
            } catch (error) {
              stats.failed++;
              stats.errors.push({
                entityId: options.entityIds[i],
                message: `Failed to sync category: ${(error instanceof Error ? error.message : String(error)) || 'Unknown error'}`,
                details: error,
              });
            }
          }

          // Update progress
          this.updateSyncProgress(syncId, stats.successful + stats.failed + stats.skipped, stats.entityCount);
          await new Promise(resolve => setTimeout(resolve, 40));
        }
      }
    } catch (error) {
      stats.warnings.push(`Error in WooCommerce category sync: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Sync orders between POS and WooCommerce
   */
  private async syncOrders(
    syncId: string,
    options: SyncOptions,
    stats: { successful: number; failed: number; skipped: number; errors: SyncError[]; warnings: string[]; entityCount: number }
  ): Promise<void> {
    const _orderService = OrderServiceFactory.getInstance().getService(ECommercePlatform.WOOCOMMERCE);

    try {
      if (options.direction === SyncDirection.ECOMMERCE_TO_POS) {
        // Simulate fetching orders from WooCommerce
        const orderCount = 25;
        stats.entityCount += orderCount;
        this.updateSyncProgress(syncId, 0, stats.entityCount);

        for (let i = 0; i < orderCount; i++) {
          // Simulate sync operations
          if (Math.random() > 0.1) {
            // 90% success rate
            stats.successful++;
          } else {
            stats.failed++;
            stats.errors.push({
              entityId: `order-${i}`,
              message: `Failed to sync order: Simulated random failure`,
            });
          }
          this.updateSyncProgress(syncId, stats.successful + stats.failed + stats.skipped, stats.entityCount);

          // Simulate some processing delay
          await new Promise(resolve => setTimeout(resolve, 60));
        }
      } else {
        // Implement POS to WooCommerce sync
        stats.warnings.push('Order sync from POS to WooCommerce not yet implemented');
      }
    } catch (error) {
      stats.warnings.push(`Error in WooCommerce order sync: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
