import { InventoryResult, InventoryUpdate, InventoryUpdateResult } from '../InventoryServiceInterface';
import { PlatformConfigRequirements } from './PlatformInventoryServiceInterface';
import { BaseInventoryService } from './BaseInventoryService';
import { WooCommerceApiClient } from '../../clients/woocommerce/WooCommerceApiClient';

interface WooCommerceInventoryProduct {
  id: number | string;
  type?: string;
  stock_quantity?: number;
  sku?: string;
  date_modified?: string;
  variations?: Array<number | string>;
}

interface WooCommerceInventoryVariation {
  id: number | string;
  stock_quantity?: number;
  sku?: string;
  date_modified?: string;
}

/**
 * WooCommerce-specific inventory service implementation
 * Handles WooCommerce inventory API interactions
 */
export class WooCommerceInventoryService extends BaseInventoryService {
  private apiClient = WooCommerceApiClient.getInstance();
  /**
   * Configuration requirements for WooCommerce
   */
  getConfigRequirements(): PlatformConfigRequirements {
    return {
      required: ['storeUrl', 'apiKey', 'apiSecret'],
      optional: [],
    };
  }

  /**
   * Get inventory levels for products from WooCommerce
   */
  async getInventory(productIds: string[]): Promise<InventoryResult> {
    if (!this.isInitialized()) {
      throw new Error('WooCommerce inventory service not initialized');
    }

    try {
      const items: InventoryResult['items'] = [];

      // WooCommerce API allows fetching multiple products in one request
      const idsParam = productIds.join(',');
      const products = await this.apiClient.get<WooCommerceInventoryProduct[]>(`products?include=${idsParam}`);

      // Process main products inventory
      for (const product of products) {
        if (product.type === 'simple') {
          // Simple products have direct stock management
          items.push({
            productId: product.id.toString(),
            quantity: product.stock_quantity || 0,
            sku: product.sku,
            updatedAt: new Date(product.date_modified || Date.now()),
          });
        } else if (product.type === 'variable' && product.variations && product.variations.length > 0) {
          // For variable products, we need to fetch each variation's inventory
          try {
            const variations = await this.apiClient.get<WooCommerceInventoryVariation[]>(`products/${product.id}/variations`);

            for (const variant of variations) {
              items.push({
                productId: product.id.toString(),
                variantId: variant.id.toString(),
                quantity: variant.stock_quantity || 0,
                sku: variant.sku,
                updatedAt: new Date(variant.date_modified || Date.now()),
              });
            }
          } catch {
            /* skip variations on error */
          }
        }
      }

      return { items };
    } catch (error) {
      this.logger.error({ message: 'Error fetching WooCommerce inventory:' }, error instanceof Error ? error : new Error(String(error)));
      return { items: [] };
    }
  }

  /**
   * Update inventory levels in WooCommerce
   */
  async updateInventory(updates: InventoryUpdate[]): Promise<InventoryUpdateResult> {
    if (!this.isInitialized()) {
      throw new Error('WooCommerce inventory service not initialized');
    }

    const result: InventoryUpdateResult = {
      successful: 0,
      failed: 0,
      errors: [],
    };

    try {
      for (const update of updates) {
        let newQuantity = update.quantity;

        if (update.adjustment) {
          const currentInventory = await this.getInventory([update.productId]);
          const item = currentInventory.items.find(
            i => i.productId === update.productId && (!update.variantId || i.variantId === update.variantId)
          );
          if (item) {
            newQuantity = Math.max(0, (item.quantity || 0) + update.quantity);
          }
        }

        const endpoint = update.variantId ? `products/${update.productId}/variations/${update.variantId}` : `products/${update.productId}`;

        await this.apiClient.put(endpoint, { stock_quantity: newQuantity, manage_stock: true });
        result.successful++;
      }

      return result;
    } catch (error) {
      this.logger.error({ message: 'Error updating WooCommerce inventory:' }, error instanceof Error ? error : new Error(String(error)));
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
