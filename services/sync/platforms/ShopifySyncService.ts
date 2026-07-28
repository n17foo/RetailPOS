import { SyncDirection, SyncEntityType, SyncError, SyncOperationResult, SyncOptions } from '../SyncServiceInterface';
import { BasePlatformSyncService } from './BasePlatformSyncService';
import { PlatformSyncConfig, PlatformSyncConfigRequirements } from './PlatformSyncServiceInterface';

import { ProductServiceFactory } from '../../product/ProductServiceFactory';
import { CategoryServiceFactory } from '../../category/CategoryServiceFactory';
import { ECommercePlatform } from '../../../utils/platforms';
import { ShopifyApiClient } from '../../clients/shopify/ShopifyApiClient';

interface ShopifyShopResponse {
  shop?: Record<string, unknown>;
}

/**
 * Shopify-specific sync service implementation
 */
export class ShopifySyncService extends BasePlatformSyncService {
  private webhookIds: string[] = [];
  private apiClient = ShopifyApiClient.getInstance();

  /**
   * Get configuration requirements for Shopify
   */
  getConfigRequirements(): PlatformSyncConfigRequirements {
    return {
      required: ['storeUrl', 'accessToken'],
      optional: ['apiVersion', 'webhookUrl', 'batchSize'],
    };
  }

  /**
   * Initialize the Shopify sync service
   */
  async initialize(config: PlatformSyncConfig): Promise<boolean> {
    if (!config.storeUrl || !config.accessToken) {
      this.logger.error({ message: 'Shopify storeUrl and accessToken are required' });
      return false;
    }
    if (!this.apiClient.isInitialized()) {
      this.apiClient.configure({
        storeUrl: config.storeUrl,
        accessToken: config.accessToken,
        apiVersion: config.apiVersion,
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
   * Test connection to Shopify API
   */
  async testConnection(): Promise<boolean> {
    if (!this.isInitialized()) {
      return false;
    }

    try {
      const data = await this.apiClient.get<ShopifyShopResponse>('shop.json');
      return !!data.shop;
    } catch (error) {
      this.logger.error({ message: 'Error testing Shopify connection' }, error instanceof Error ? error : new Error(String(error)));
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
        'products/create',
        'products/update',
        'products/delete',
        // Inventory webhooks
        'inventory_levels/update',
        // Order webhooks
        'orders/create',
        'orders/updated',
        'orders/cancelled',
        'orders/fulfilled',
        'orders/paid',
        // Collection (category) webhooks
        'collections/create',
        'collections/update',
        'collections/delete',
        // Customer webhooks if needed
        'customers/create',
        'customers/update',
        'customers/delete',
      ];

      // Register each webhook
      const results = await Promise.all(
        webhookTopics.map(async topic => {
          try {
            const data = await this.apiClient.post<{ webhook?: { id?: string } }>('webhooks.json', {
              webhook: { topic, address: webhookUrl, format: 'json' },
            });
            return data.webhook?.id ?? null;
          } catch (error) {
            this.logger.error(
              { message: `Error registering Shopify webhook for ${topic}` },
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
      this.logger.error({ message: 'Error registering Shopify webhooks' }, error instanceof Error ? error : new Error(String(error)));
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
            await this.apiClient.delete(`webhooks/${webhookId}.json`);
            return true;
          } catch (error) {
            this.logger.error(
              { message: `Error unregistering Shopify webhook ${webhookId}` },
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
      this.logger.error({ message: 'Error unregistering Shopify webhooks' }, error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  /**
   * Execute a sync operation against Shopify
   */
  protected async executeSyncOperation(syncId: string, options: SyncOptions): Promise<void> {
    if (!this.isInitialized()) {
      throw new Error('Shopify sync service not initialized');
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
          warnings.push(`Entity type ${options.entityType} not supported for Shopify sync`);
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
        { message: `Error in Shopify sync operation ${syncId}` },
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * Sync products between POS and Shopify
   */
  private async syncProducts(
    syncId: string,
    options: SyncOptions,
    stats: { successful: number; failed: number; skipped: number; errors: SyncError[]; warnings: string[]; entityCount: number }
  ): Promise<void> {
    const productService = ProductServiceFactory.getInstance().getService(ECommercePlatform.SHOPIFY);

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

        // Fetch products from database
        const { ProductRepository } = await import('../../../repositories/ProductRepository');
        const productRepo = new ProductRepository();
        const dbProducts = await productRepo.findByIds(options.entityIds);

        if (dbProducts.length === 0) {
          stats.warnings.push('No products found in database for the specified IDs');
          return;
        }

        // Sync each product to Shopify
        for (let i = 0; i < dbProducts.length; i++) {
          const dbProduct = dbProducts[i];

          if (options.dryRun) {
            stats.skipped++;
            this.logger.info({ message: `[Dry run] Would sync product: ${dbProduct.id} (${dbProduct.name})` });
          } else {
            try {
              // Convert database product to platform product format
              const platformProduct = {
                id: dbProduct.id,
                title: dbProduct.name,
                description: dbProduct.description || undefined,
                variants: [
                  {
                    id: dbProduct.id,
                    title: 'Default',
                    sku: dbProduct.sku || undefined,
                    barcode: dbProduct.barcode || undefined,
                    price: dbProduct.price,
                    inventoryQuantity: dbProduct.stock,
                    taxable: true,
                  },
                ],
              };

              // Sync product to Shopify
              await productService.syncProducts([platformProduct]);
              stats.successful++;
              this.logger.info({ message: `Synced product to Shopify: ${dbProduct.id} (${dbProduct.name})` });
            } catch (error) {
              stats.failed++;
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
              stats.errors.push({
                entityId: dbProduct.id,
                message: `Failed to sync product: ${errorMessage}`,
                details: error,
              });
              this.logger.error(
                { message: `Failed to sync product ${dbProduct.id} to Shopify` },
                error instanceof Error ? error : new Error(String(error))
              );
            }
          }

          // Update progress
          this.updateSyncProgress(syncId, stats.successful + stats.failed + stats.skipped, stats.entityCount);
        }
      } else if (options.direction === SyncDirection.ECOMMERCE_TO_POS) {
        // Fetch products from Shopify
        const result = await productService.getProducts({ limit: options.batchSize || 50 });

        // Update progress total
        stats.entityCount += result.products.length;
        this.updateSyncProgress(syncId, 0, stats.entityCount);

        // Process each product
        for (let i = 0; i < result.products.length; i++) {
          const product = result.products[i];

          if (options.dryRun) {
            stats.skipped++;
          } else {
            try {
              // In a real implementation, sync product to POS
              // await syncProductToPOS(product);
              stats.successful++;
            } catch (error) {
              stats.failed++;
              stats.errors.push({
                entityId: product.id,
                message: `Failed to sync product to POS: ${(error instanceof Error ? error.message : String(error)) || 'Unknown error'}`,
                details: error,
              });
            }
          }

          // Update progress
          this.updateSyncProgress(syncId, stats.successful + stats.failed + stats.skipped, stats.entityCount);
        }
      }
    } catch (error) {
      stats.warnings.push(`Error in product sync: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Sync inventory between POS and Shopify
   */
  private async syncInventory(
    syncId: string,
    options: SyncOptions,
    stats: { successful: number; failed: number; skipped: number; errors: SyncError[]; warnings: string[]; entityCount: number }
  ): Promise<void> {
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
        }
      } else {
        // Simulate fetching inventory from Shopify
        const inventoryCount = 25;
        stats.entityCount += inventoryCount;
        this.updateSyncProgress(syncId, 0, stats.entityCount);

        // Simulate processing
        for (let i = 0; i < inventoryCount; i++) {
          stats.successful++;
          this.updateSyncProgress(syncId, stats.successful + stats.failed + stats.skipped, stats.entityCount);

          // Simulate some processing delay
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    } catch (error) {
      stats.warnings.push(`Error in inventory sync: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Sync categories between POS and Shopify
   */
  private async syncCategories(
    syncId: string,
    options: SyncOptions,
    stats: { successful: number; failed: number; skipped: number; errors: SyncError[]; warnings: string[]; entityCount: number }
  ): Promise<void> {
    const categoryService = CategoryServiceFactory.getInstance().getService(ECommercePlatform.SHOPIFY);

    try {
      // Similar implementation to products sync
      if (options.direction === SyncDirection.ECOMMERCE_TO_POS) {
        const categories = await categoryService.getCategories();

        // Update progress total
        stats.entityCount += categories.length;
        this.updateSyncProgress(syncId, 0, stats.entityCount);

        for (let i = 0; i < categories.length; i++) {
          // Simulate sync operations
          stats.successful++;
          this.updateSyncProgress(syncId, stats.successful + stats.failed + stats.skipped, stats.entityCount);

          // Simulate some processing delay
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      } else {
        // Implement POS to Shopify sync
        stats.warnings.push('Category sync from POS to Shopify not yet implemented');
      }
    } catch (error) {
      stats.warnings.push(`Error in category sync: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Sync orders between POS and Shopify
   */
  private async syncOrders(
    syncId: string,
    options: SyncOptions,
    stats: { successful: number; failed: number; skipped: number; errors: SyncError[]; warnings: string[]; entityCount: number }
  ): Promise<void> {
    try {
      // Similar implementation to products sync
      if (options.direction === SyncDirection.ECOMMERCE_TO_POS) {
        // Simulate fetching orders from Shopify
        const orderCount = 10;
        stats.entityCount += orderCount;
        this.updateSyncProgress(syncId, 0, stats.entityCount);

        for (let i = 0; i < orderCount; i++) {
          // Simulate sync operations
          stats.successful++;
          this.updateSyncProgress(syncId, stats.successful + stats.failed + stats.skipped, stats.entityCount);

          // Simulate some processing delay
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } else {
        // Implement POS to Shopify sync
        stats.warnings.push('Order sync from POS to Shopify not yet implemented');
      }
    } catch (error) {
      stats.warnings.push(`Error in order sync: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
