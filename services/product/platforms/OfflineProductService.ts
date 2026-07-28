/* eslint-disable @typescript-eslint/no-explicit-any -- raw platform API response mapping */
import { Product, ProductQueryOptions, ProductResult, SyncResult } from '../ProductServiceInterface';
import { PlatformProductServiceInterface, PlatformConfigRequirements, PlatformProductConfig } from './PlatformProductServiceInterface';
import { LoggerFactory } from '../../logger/LoggerFactory';
import { keyValueRepository } from '../../../repositories/KeyValueRepository';

const PRODUCTS_STORAGE_KEY = 'offline_local_products';

/**
 * Offline product service for local-first POS operation.
 * All operations are local-only via SQLite — no network calls.
 */
export class OfflineProductService implements PlatformProductServiceInterface {
  private initialized: boolean = false;
  private products: Product[] = [];
  private logger = LoggerFactory.getInstance().createLogger('OfflineProductService');

  constructor(_config: PlatformProductConfig = {}) {}

  /**
   * Initialize the offline product service — loads products from local storage.
   */
  async initialize(): Promise<boolean> {
    try {
      const storedProducts = await keyValueRepository.getItem(PRODUCTS_STORAGE_KEY);
      if (storedProducts) {
        this.products = JSON.parse(storedProducts);
        this.logger.info(`Loaded ${this.products.length} products from local storage`);
      }

      this.initialized = true;
      this.logger.info('Offline product service initialized (local-only mode)');
      return true;
    } catch (error) {
      this.logger.error(
        { message: 'Error initializing offline product service' },
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
   * Get configuration requirements for offline platform
   */
  getConfigRequirements(): PlatformConfigRequirements {
    return {
      required: [],
      optional: [],
      description: 'Offline local-only mode. All product data is managed locally.',
    };
  }

  /**
   * Get products from local storage
   */
  async getProducts(options: ProductQueryOptions): Promise<ProductResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    let filteredProducts = [...this.products];

    // Apply category filter
    if (options.category) {
      filteredProducts = filteredProducts.filter(p => p.productType === options.category || p.tags?.includes(options.category || ''));
    }

    // Apply search filter
    if (options.search) {
      const searchLower = options.search.toLowerCase();
      filteredProducts = filteredProducts.filter(
        p =>
          p.title.toLowerCase().includes(searchLower) ||
          p.description?.toLowerCase().includes(searchLower) ||
          p.variants.some(v => v.sku?.toLowerCase().includes(searchLower))
      );
    }

    // Apply ID filter
    if (options.ids && options.ids.length > 0) {
      filteredProducts = filteredProducts.filter(p => options.ids!.includes(p.id));
    }

    // Apply out of stock filter
    if (!options.includeOutOfStock) {
      filteredProducts = filteredProducts.filter(p => p.variants.some(v => v.inventoryQuantity > 0));
    }

    // Apply pagination
    const page = options.page || 1;
    const limit = options.limit || 50;
    const startIndex = (page - 1) * limit;
    const paginatedProducts = filteredProducts.slice(startIndex, startIndex + limit);

    return {
      products: paginatedProducts,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(filteredProducts.length / limit),
        totalItems: filteredProducts.length,
        perPage: limit,
      },
    };
  }

  /**
   * Get a single product by ID
   */
  async getProductById(productId: string): Promise<Product | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    return this.products.find(p => p.id === productId) || null;
  }

  /**
   * Create a new product (local only)
   */
  async createProduct(product: Product): Promise<Product> {
    if (!this.initialized) {
      await this.initialize();
    }

    const newProduct = {
      ...product,
      id: product.id || `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.products.push(newProduct);
    await this.saveProductsToStorage();

    this.logger.info(`Created local product: ${newProduct.title}`);
    return newProduct;
  }

  /**
   * Update an existing product (local only)
   */
  async updateProduct(productId: string, productData: Partial<Product>): Promise<Product> {
    if (!this.initialized) {
      await this.initialize();
    }

    const index = this.products.findIndex(p => p.id === productId);
    if (index === -1) {
      throw new Error(`Product not found: ${productId}`);
    }

    const updatedProduct = {
      ...this.products[index],
      ...productData,
      id: productId,
      updatedAt: new Date(),
    };

    this.products[index] = updatedProduct;
    await this.saveProductsToStorage();

    this.logger.info(`Updated local product: ${updatedProduct.title}`);
    return updatedProduct;
  }

  /**
   * Delete a product (local only)
   */
  async deleteProduct(productId: string): Promise<boolean> {
    if (!this.initialized) {
      await this.initialize();
    }

    const index = this.products.findIndex(p => p.id === productId);
    if (index === -1) {
      return false;
    }

    this.products.splice(index, 1);
    await this.saveProductsToStorage();

    this.logger.info(`Deleted local product: ${productId}`);
    return true;
  }

  /**
   * Sync products - In offline mode, this just saves to local storage
   * No online sync is performed
   */
  async syncProducts(products: Product[]): Promise<SyncResult> {
    try {
      this.products = products;
      await this.saveProductsToStorage();

      this.logger.info(`Synced ${products.length} products to local storage`);

      return {
        successful: products.length,
        failed: 0,
        errors: [],
      };
    } catch (error) {
      this.logger.error({ message: 'Error syncing products locally' }, error instanceof Error ? error : new Error(String(error)));

      return {
        successful: 0,
        failed: products.length,
        errors: products.map(p => ({
          productId: p.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        })),
      };
    }
  }

  /**
   * Save products to local storage
   */
  private async saveProductsToStorage(): Promise<void> {
    await keyValueRepository.setItem(PRODUCTS_STORAGE_KEY, JSON.stringify(this.products));
  }

  /**
   * Map external product format to standard Product format
   */
  private mapToProduct(item: any): Product {
    return {
      id: item.id?.toString() || `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title: item.title || item.name || 'Untitled Product',
      description: item.description || '',
      vendor: item.vendor || item.brand || '',
      productType: item.category || item.productType || item.type || '',
      tags: item.tags || [],
      options: item.options || [],
      variants: item.variants || [
        {
          id: item.id?.toString() || `var-${Date.now()}`,
          title: 'Default',
          sku: item.sku || '',
          barcode: item.barcode || '',
          price: parseFloat(item.price) || 0,
          compareAtPrice: item.compareAtPrice ? parseFloat(item.compareAtPrice) : undefined,
          inventoryQuantity: parseInt(item.stock) || parseInt(item.quantity) || parseInt(item.inventoryQuantity) || 999,
        },
      ],
      images:
        item.images?.map((img: any, index: number) => ({
          id: img.id || `img-${index}`,
          url: typeof img === 'string' ? img : img.url || img.src || '',
          alt: img.alt || '',
        })) ||
        (item.image
          ? [
              {
                id: 'main',
                url: typeof item.image === 'string' ? item.image : item.image.url || item.image.src || '',
                alt: '',
              },
            ]
          : []),
      createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
      updatedAt: item.updatedAt ? new Date(item.updatedAt) : new Date(),
    };
  }

  /**
   * Clear all local products
   */
  async clearLocalProducts(): Promise<void> {
    this.products = [];
    await keyValueRepository.removeItem(PRODUCTS_STORAGE_KEY);
    this.logger.info('Cleared all local products');
  }
}

export const offlineProductService = new OfflineProductService();
