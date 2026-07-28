/* eslint-disable @typescript-eslint/no-explicit-any -- raw platform API response mapping */
import { Product, ProductQueryOptions, ProductResult, SyncResult } from '../ProductServiceInterface';
import { PlatformProductConfig, PlatformConfigRequirements } from './PlatformProductServiceInterface';
import { BaseProductService } from './BaseProductService';
import { ECommercePlatform } from '../../../utils/platforms';
import { withTokenRefresh } from '../../token/TokenUtils';
import { LoggerFactory } from '../../logger/LoggerFactory';
import { WooCommerceApiClient } from '../../clients/woocommerce/WooCommerceApiClient';

/**
 * WooCommerce-specific implementation of the product service
 */
export class WooCommerceProductService extends BaseProductService {
  private apiClient = WooCommerceApiClient.getInstance();
  protected logger = LoggerFactory.getInstance().createLogger('WooCommerceProductService');

  /**
   * Create a new WooCommerce product service
   * @param config Configuration for WooCommerce API
   */
  constructor(config: PlatformProductConfig = {}) {
    super(config);
    this.logger = LoggerFactory.getInstance().createLogger('WooCommerceProductService');
  }

  /**
   * Initialize the WooCommerce product service
   */
  async initialize(): Promise<boolean> {
    try {
      // Set up configuration from constructor or environment variables
      this.config.consumerKey = this.config.consumerKey || process.env.WOOCOMMERCE_CONSUMER_KEY || '';
      this.config.consumerSecret = this.config.consumerSecret || process.env.WOOCOMMERCE_CONSUMER_SECRET || '';
      this.config.storeUrl = this.config.storeUrl || process.env.WOOCOMMERCE_URL || '';
      this.config.apiVersion = this.config.apiVersion || process.env.WOOCOMMERCE_API_VERSION || '';

      if (!this.config.consumerKey || !this.config.consumerSecret || !this.config.storeUrl) {
        this.logger.warn('Missing WooCommerce API configuration');
        return false;
      }

      // Configure and initialize the shared WooCommerce client
      if (!this.apiClient.isInitialized()) {
        this.apiClient.configure({
          storeUrl: this.config.storeUrl,
          consumerKey: this.config.consumerKey as string,
          consumerSecret: this.config.consumerSecret as string,
          apiVersion: this.config.apiVersion as string,
        });
        await this.apiClient.initialize();
      }
      this.config.storeUrl = this.apiClient.getBaseUrl();

      // Test connection with a simple API call
      try {
        await this.apiClient.get('products');
        this.initialized = true;
        return true;
      } catch (error) {
        this.logger.error({ message: 'Error connecting to WooCommerce API' }, error instanceof Error ? error : new Error(String(error)));
        return false;
      }
    } catch (error) {
      this.logger.error(
        { message: 'Failed to initialize WooCommerce product service' },
        error instanceof Error ? error : new Error(String(error))
      );
      return false;
    }
  }

  /**
   * Get configuration requirements for WooCommerce
   */
  getConfigRequirements(): PlatformConfigRequirements {
    return {
      required: ['consumerKey', 'consumerSecret', 'storeUrl'],
      optional: ['apiVersion'],
      description: 'WooCommerce product service requires consumer key, consumer secret, and store URL',
    };
  }

  /**
   * Get products from WooCommerce with filtering options
   */
  async getProducts(options: ProductQueryOptions): Promise<ProductResult> {
    if (!this.isInitialized()) {
      throw new Error('WooCommerce product service not initialized');
    }

    return withTokenRefresh(ECommercePlatform.WOOCOMMERCE, async () => {
      try {
        const params = new URLSearchParams();

        // Set pagination
        params.append('per_page', String(options.limit || 10));
        params.append('page', String(options.page || 1));

        // Set search if provided
        if (options.search) {
          params.append('search', options.search);
        }

        // Set category if provided
        if (options.category) {
          params.append('category', options.category);
        }

        // Set specific IDs if provided
        if (options.ids && options.ids.length > 0) {
          params.append('include', options.ids.join(','));
        }

        // Set stock status if provided
        if (options.includeOutOfStock === false) {
          params.append('stock_status', 'instock');
        }

        const products = await this.apiClient.get<any[]>(`products?${params.toString()}`);

        const mappedProducts = products.map((wooProduct: any) => this.mapToProduct(wooProduct));

        return {
          products: mappedProducts,
          pagination: {
            currentPage: options.page || 1,
            totalPages: 1,
            totalItems: mappedProducts.length,
            perPage: options.limit || 10,
          },
        };
      } catch (error) {
        this.logger.error('Error fetching products from WooCommerce', error instanceof Error ? error : new Error(String(error)));
        return {
          products: [],
          pagination: {
            currentPage: options.page || 1,
            totalPages: 0,
            totalItems: 0,
            perPage: options.limit || 10,
          },
        };
      }
    });
  }

  /**
   * Get a single product by ID
   */
  async getProductById(productId: string): Promise<Product | null> {
    if (!this.isInitialized()) {
      throw new Error('WooCommerce product service not initialized');
    }

    return withTokenRefresh(ECommercePlatform.WOOCOMMERCE, async () => {
      try {
        const wooProduct = await this.apiClient.get<any>(`products/${productId}`);
        return this.mapToProduct(wooProduct);
      } catch (error) {
        this.logger.error(
          `Error fetching product ${productId} from WooCommerce`,
          error instanceof Error ? error : new Error(String(error))
        );
        return null;
      }
    });
  }

  /**
   * Create a new product on WooCommerce
   */
  async createProduct(product: Product): Promise<Product> {
    if (!this.isInitialized()) {
      throw new Error('WooCommerce product service not initialized');
    }

    return withTokenRefresh(ECommercePlatform.WOOCOMMERCE, async () => {
      try {
        const wooProduct = this.mapToWooCommerceProduct(product);
        const createdProduct = await this.apiClient.post<any>('products', wooProduct);
        return this.mapToProduct(createdProduct);
      } catch (error) {
        this.logger.error(`Error creating product in WooCommerce`, error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    });
  }

  /**
   * Update an existing product in WooCommerce
   */
  async updateProduct(productId: string, productData: Partial<Product>): Promise<Product> {
    if (!this.isInitialized()) {
      throw new Error('WooCommerce product service not initialized');
    }

    return withTokenRefresh(ECommercePlatform.WOOCOMMERCE, async () => {
      try {
        const wooProductData = this.mapToWooCommerceProduct(productData as Product);
        const updatedProduct = await this.apiClient.put<any>(`products/${productId}`, wooProductData);
        return this.mapToProduct(updatedProduct);
      } catch (error) {
        this.logger.error(`Error updating product ${productId} in WooCommerce`, error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    });
  }

  /**
   * Delete a product from WooCommerce
   */
  async deleteProduct(productId: string): Promise<boolean> {
    if (!this.isInitialized()) {
      throw new Error('WooCommerce product service not initialized');
    }

    return withTokenRefresh(ECommercePlatform.WOOCOMMERCE, async () => {
      try {
        await this.apiClient.delete(`products/${productId}?force=true`);
        return true;
      } catch (error) {
        this.logger.error(
          `Error deleting product ${productId} from WooCommerce`,
          error instanceof Error ? error : new Error(String(error))
        );
        return false;
      }
    });
  }

  /**
   * Sync products with WooCommerce
   */
  async syncProducts(products: Product[]): Promise<SyncResult> {
    if (!this.isInitialized()) {
      throw new Error('WooCommerce product service not initialized');
    }

    const result: SyncResult = {
      successful: 0,
      failed: 0,
      errors: [],
    };

    return withTokenRefresh(ECommercePlatform.WOOCOMMERCE, async () => {
      try {
        // Process products one by one
        for (const product of products) {
          try {
            // Try to find if product already exists
            const existingProduct = await this.getProductById(product.id);

            if (existingProduct) {
              // Update existing product
              await this.updateProduct(product.id, product);
            } else {
              // Create new product
              await this.createProduct(product);
            }

            result.successful++;
          } catch (error) {
            result.failed++;
            result.errors.push({
              productId: product.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        return result;
      } catch (error) {
        this.logger.error('Error syncing products to WooCommerce', error instanceof Error ? error : new Error(String(error)));
        return {
          successful: 0,
          failed: products.length,
          errors: products.map(product => ({
            productId: product.id,
            error: error instanceof Error ? error.message : String(error),
          })),
        };
      }
    });
  }

  /**
   * Map a WooCommerce product to our standard product format
   */
  protected mapToProduct(wooProduct: any): Product {
    // Extract images
    const images = wooProduct.images
      ? wooProduct.images.map((img: any) => ({
          id: img.id || '',
          url: img.src || '',
          alt: img.alt || '',
        }))
      : [];

    // Extract variants (WooCommerce calls them variations)
    const variants = wooProduct.variations
      ? wooProduct.variations.map((variant: any) => ({
          id: variant.id || '',
          title: variant.name || 'Default',
          price: parseFloat(variant.price || 0),
          sku: variant.sku || '',
          inventoryQuantity: variant.stock_quantity || 0,
        }))
      : [
          {
            id: wooProduct.id || '',
            title: 'Default',
            price: parseFloat(wooProduct.price || 0),
            sku: wooProduct.sku || '',
            inventoryQuantity: wooProduct.stock_quantity || 0,
          },
        ];

    // Extract categories as tags
    const tags = wooProduct.categories ? wooProduct.categories.map((category: any) => category.name) : [];

    return {
      id: String(wooProduct.id) || '',
      title: wooProduct.name || '',
      description: wooProduct.description || '',
      vendor: wooProduct.vendor || '',
      productType: wooProduct.type || '',
      tags,
      options: [],
      variants,
      images,
      createdAt: wooProduct.date_created ? new Date(wooProduct.date_created) : new Date(),
      updatedAt: wooProduct.date_modified ? new Date(wooProduct.date_modified) : new Date(),
    };
  }

  /**
   * Map our standard product format to WooCommerce's format
   */
  protected mapToWooCommerceProduct(product: Product): any {
    // Extract the primary variant
    const primaryVariant = product.variants[0] || {
      price: 0,
      sku: '',
      inventoryQuantity: 0,
    };

    // Map images
    const images = (product.images || []).map(img => ({
      src: img.url,
      alt: img.alt,
    }));

    // Map categories from tags
    const categories = (product.tags || []).map(tag => ({
      name: tag,
    }));

    return {
      name: product.title,
      type: product.productType || 'simple',
      description: product.description,
      short_description: product.description?.substring(0, 300) || '',
      sku: primaryVariant.sku,
      regular_price: String(primaryVariant.price),
      manage_stock: true,
      stock_quantity: primaryVariant.inventoryQuantity,
      categories,
      images,
    };
  }
}
