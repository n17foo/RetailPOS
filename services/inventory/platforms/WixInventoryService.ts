import { InventoryResult, InventoryUpdate, InventoryUpdateResult } from '../InventoryServiceInterface';
import { PlatformInventoryConfig, PlatformConfigRequirements } from './PlatformInventoryServiceInterface';
import { BaseInventoryService } from './BaseInventoryService';
import { WixApiClient } from '../../clients/wix/WixApiClient';

interface WixInventoryVariant {
  id: string;
  sku?: string;
  stock?: {
    quantity?: number;
  };
  variant?: {
    sku?: string;
  };
}

interface WixInventoryProductRecord {
  sku?: string;
  stock?: {
    quantity?: number;
  };
  variants?: WixInventoryVariant[];
}

interface WixInventoryProductResponse {
  product?: WixInventoryProductRecord;
}

interface WixInventoryItemResponse {
  inventoryItem?: {
    quantity?: number;
  };
}

/**
 * Wix-specific inventory service implementation
 * Uses Wix Stores Inventory API
 */
export class WixInventoryService extends BaseInventoryService {
  private apiClient = WixApiClient.getInstance();
  getConfigRequirements(): PlatformConfigRequirements {
    return {
      required: ['apiKey', 'siteId'],
      optional: ['accountId', 'apiVersion'],
    };
  }

  async initialize(config?: PlatformInventoryConfig): Promise<boolean> {
    if (config) {
      this.config = { ...this.config, ...config };
    }

    try {
      this.config.apiKey = this.config.apiKey || process.env.WIX_API_KEY || '';
      this.config.siteId = this.config.siteId || process.env.WIX_SITE_ID || '';
      this.config.accountId = this.config.accountId || process.env.WIX_ACCOUNT_ID || '';
      this.config.apiVersion = this.config.apiVersion || process.env.WIX_API_VERSION || '';

      if (!this.config.apiKey || !this.config.siteId) {
        this.logger.warn({ message: 'Missing Wix API configuration' });
        return false;
      }

      this.initialized = true;
      return true;
    } catch (error) {
      this.logger.error(
        { message: 'Failed to initialize Wix inventory service' },
        error instanceof Error ? error : new Error(String(error))
      );
      return false;
    }
  }

  async getInventory(productIds: string[]): Promise<InventoryResult> {
    if (!this.isInitialized()) {
      throw new Error('Wix inventory service not initialized');
    }

    const items: InventoryResult['items'] = [];

    try {
      for (const productId of productIds) {
        try {
          const data = await this.apiClient.get<WixInventoryProductResponse>(`stores/v1/products/${productId}`);
          const product = data.product;
          if (product && product.variants && product.variants.length > 0) {
            for (const variant of product.variants) {
              items.push({
                productId,
                variantId: variant.id,
                sku: variant.variant?.sku || variant.sku,
                quantity: variant.stock?.quantity || 0,
              });
            }
          } else {
            items.push({ productId, variantId: productId, sku: product?.sku, quantity: product?.stock?.quantity || 0 });
          }
        } catch (error) {
          this.logger.error(
            { message: `Error fetching inventory for product ${productId}:` },
            error instanceof Error ? error : new Error(String(error))
          );
        }
      }

      return { items };
    } catch (error) {
      this.logger.error({ message: 'Error fetching inventory from Wix:' }, error instanceof Error ? error : new Error(String(error)));
      return { items };
    }
  }

  async updateInventory(updates: InventoryUpdate[]): Promise<InventoryUpdateResult> {
    if (!this.isInitialized()) {
      throw new Error('Wix inventory service not initialized');
    }

    const result: InventoryUpdateResult = {
      successful: 0,
      failed: 0,
      errors: [],
    };

    for (const update of updates) {
      try {
        const invItemId = update.variantId || update.productId;

        let newQuantity = update.quantity;
        if (update.adjustment === true) {
          try {
            const current = await this.apiClient.get<WixInventoryItemResponse>(`stores/v1/inventoryItems/${invItemId}`);
            newQuantity = (current.inventoryItem?.quantity || 0) + update.quantity;
          } catch {
            /* keep update.quantity */
          }
        }

        try {
          await this.apiClient.post(`stores/v1/inventoryItems/${invItemId}/updateQuantity`, {
            inventoryItem: { trackQuantity: true, quantity: newQuantity, inStock: newQuantity > 0 },
          });
          result.successful++;
        } catch {
          // Try alternative product update endpoint
          await this.apiClient.put(`stores/v1/products/${update.productId}`, {
            product: { stock: { trackInventory: true, quantity: newQuantity, inStock: newQuantity > 0 } },
          });
          result.successful++;
        }
      } catch (error) {
        result.failed++;
        result.errors.push({
          productId: update.productId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }
}
