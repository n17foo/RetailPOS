import { InventoryResult, InventoryUpdate, InventoryUpdateResult } from '../InventoryServiceInterface';
import { PlatformConfigRequirements } from './PlatformInventoryServiceInterface';
import { BaseInventoryService } from './BaseInventoryService';
import { BigCommerceApiClient } from '../../clients/bigcommerce/BigCommerceApiClient';

interface BigCommerceVariantInventory {
  id: number | string;
  inventory_level?: number;
  sku?: string;
  date_modified?: string;
}

interface BigCommerceProductInventory {
  id: number | string;
  inventory_level?: number;
  sku?: string;
  date_modified?: string;
  variants?: BigCommerceVariantInventory[];
}

interface BigCommerceProductInventoryResponse {
  data?: BigCommerceProductInventory;
}

/**
 * BigCommerce-specific inventory service implementation
 * Handles BigCommerce inventory API interactions
 */
export class BigCommerceInventoryService extends BaseInventoryService {
  private apiClient = BigCommerceApiClient.getInstance();

  /**
   * Configuration requirements for BigCommerce
   */
  getConfigRequirements(): PlatformConfigRequirements {
    return {
      required: ['storeHash', 'accessToken', 'clientId'],
      optional: [],
    };
  }

  /**
   * Get inventory levels for products from BigCommerce
   */
  async getInventory(productIds: string[]): Promise<InventoryResult> {
    if (!this.isInitialized()) {
      throw new Error('BigCommerce inventory service not initialized');
    }

    try {
      const items: InventoryResult['items'] = [];

      // BigCommerce requires us to fetch products one by one
      for (const productId of productIds) {
        let data: BigCommerceProductInventoryResponse;
        try {
          data = await this.apiClient.get<BigCommerceProductInventoryResponse>(`catalog/products/${productId}?include=variants`);
        } catch (err) {
          this.logger.error(
            { message: `Failed to fetch BigCommerce product ${productId}` },
            err instanceof Error ? err : new Error(String(err))
          );
          continue;
        }
        const product = data.data;

        if (!product) continue;

        // Handle simple products
        if (!product.variants || product.variants.length === 0) {
          items.push({
            productId: product.id.toString(),
            quantity: product.inventory_level || 0,
            sku: product.sku,
            updatedAt: new Date(product.date_modified || Date.now()),
          });
        }
        // Handle products with variants
        else {
          for (const variant of product.variants) {
            items.push({
              productId: product.id.toString(),
              variantId: variant.id.toString(),
              quantity: variant.inventory_level || 0,
              sku: variant.sku,
              updatedAt: new Date(variant.date_modified || product.date_modified || Date.now()),
            });
          }
        }
      }

      return { items };
    } catch (error) {
      this.logger.error({ message: 'Error fetching BigCommerce inventory:' }, error instanceof Error ? error : new Error(String(error)));
      return { items: [] };
    }
  }

  /**
   * Update inventory levels in BigCommerce
   */
  async updateInventory(updates: InventoryUpdate[]): Promise<InventoryUpdateResult> {
    if (!this.isInitialized()) {
      throw new Error('BigCommerce inventory service not initialized');
    }

    const result: InventoryUpdateResult = {
      successful: 0,
      failed: 0,
      errors: [],
    };

    try {
      for (const update of updates) {
        let currentInventory = 0;

        // If this is an adjustment, we need to get the current inventory level first
        if (update.adjustment) {
          const inventory = await this.getInventory([update.productId]);
          const item = inventory.items.find(
            i => i.productId === update.productId && (!update.variantId || i.variantId === update.variantId)
          );

          if (item) {
            currentInventory = item.quantity;
          }
        }

        // Calculate the new inventory level
        const newInventory = update.adjustment
          ? Math.max(0, currentInventory + update.quantity) // Prevent negative inventory
          : update.quantity;

        // Determine if we're updating a variant or main product
        if (update.variantId) {
          await this.apiClient.put(`catalog/products/${update.productId}/variants/${update.variantId}`, { inventory_level: newInventory });
        } else {
          await this.apiClient.put(`catalog/products/${update.productId}`, {
            inventory_level: newInventory,
            inventory_tracking: 'product',
          });
        }
        result.successful++;
      }

      return result;
    } catch (error) {
      this.logger.error({ message: 'Error updating BigCommerce inventory:' }, error instanceof Error ? error : new Error(String(error)));
      return {
        successful: result.successful,
        failed: updates.length - result.successful,
        errors: [
          ...result.errors,
          {
            productId: 'general',
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        ],
      };
    }
  }
}
