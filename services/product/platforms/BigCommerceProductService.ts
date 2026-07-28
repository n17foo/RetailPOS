/* eslint-disable @typescript-eslint/no-explicit-any -- raw platform API response mapping */
import { Product, ProductQueryOptions, ProductResult, SyncResult } from '../ProductServiceInterface';
import { PlatformProductConfig, PlatformConfigRequirements } from './PlatformProductServiceInterface';
import { BaseProductService } from './BaseProductService';
import { ECommercePlatform } from '../../../utils/platforms';
import { withTokenRefresh } from '../../../services/token/TokenIntegration';
import { LoggerFactory } from '../../logger/LoggerFactory';
import { BigCommerceApiClient } from '../../clients/bigcommerce/BigCommerceApiClient';

/**
 * BigCommerce-specific implementation of the product service
 */
export class BigCommerceProductService extends BaseProductService {
  private apiClient = BigCommerceApiClient.getInstance();
  // The config property is inherited from BaseProductService

  /**
   * Create a new BigCommerce product service
   * @param config Configuration for BigCommerce API
   */
  constructor(config: PlatformProductConfig = {}) {
    super(config);
    this.logger = LoggerFactory.getInstance().createLogger('BigCommerceProductService');
  }

  /**
   * Initialize the BigCommerce product service
   */
  async initialize(): Promise<boolean> {
    try {
      // Set up configuration from constructor or environment variables
      this.config.storeHash = this.config.storeHash || process.env.BIGCOMMERCE_STORE_HASH || '';

      if (!this.config.storeHash) {
        this.logger.warn('Missing BigCommerce store hash configuration');
        return false;
      }

      // Configure and initialize the shared BigCommerce client
      if (!this.apiClient.isInitialized()) {
        this.apiClient.configure({
          storeHash: this.config.storeHash as string,
          accessToken: this.config.accessToken as string,
          clientId: this.config.clientId as string,
          apiVersion: this.config.apiVersion as string,
        });
        await this.apiClient.initialize();
      }

      // Test connection with a simple API call
      try {
        await this.apiClient.get('catalog/summary');
        this.initialized = true;
        return true;
      } catch (error) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        this.logger.error({ message: 'Error connecting to BigCommerce API' }, errorObj);
        return false;
      }
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      this.logger.error({ message: 'Failed to initialize BigCommerce product service' }, errorObj);
      return false;
    }
  }

  /**
   * Get configuration requirements for BigCommerce
   */
  getConfigRequirements(): PlatformConfigRequirements {
    return {
      required: ['storeHash', 'accessToken'],
      optional: ['clientId', 'apiVersion'],
      description: 'BigCommerce product service requires store hash and access token',
    };
  }

  /**
   * Get products from BigCommerce
   */
  async getProducts(options: ProductQueryOptions): Promise<ProductResult> {
    if (!this.isInitialized()) {
      throw new Error('BigCommerce product service not initialized');
    }

    return withTokenRefresh(ECommercePlatform.BIGCOMMERCE, async () => {
      try {
        const params = new URLSearchParams();

        // Set pagination
        params.append('limit', String(options.limit || 10));
        params.append('page', String(options.page || 1));

        // Set search if provided
        if (options.search) {
          params.append('keyword', options.search);
        }

        // Set category if provided
        if (options.category) {
          params.append('categories:in', options.category);
        }

        // Set specific IDs if provided
        if (options.ids && options.ids.length > 0) {
          params.append('id:in', options.ids.join(','));
        }

        // Include all related data
        params.append('include', 'variants,images,custom_fields,bulk_pricing_rules,primary_image');

        const data = await this.apiClient.get<{ data: any[]; meta: any }>(`catalog/products?${params.toString()}`);

        const products = data.data.map((bcProduct: any) => this.mapToProduct(bcProduct));

        return {
          products,
          pagination: {
            currentPage: data.meta.pagination.current_page,
            totalPages: data.meta.pagination.total_pages,
            totalItems: data.meta.pagination.total,
            perPage: data.meta.pagination.per_page,
          },
        };
      } catch (error) {
        this.logger.error(
          { message: 'Error fetching products from BigCommerce' },
          error instanceof Error ? error : new Error(String(error))
        );
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
      throw new Error('BigCommerce product service not initialized');
    }

    return withTokenRefresh(ECommercePlatform.BIGCOMMERCE, async () => {
      try {
        // Include all related data
        const params = new URLSearchParams();
        params.append('include', 'variants,images,custom_fields,bulk_pricing_rules,primary_image');

        const bcProduct = await this.apiClient.get<{ data: any }>(`catalog/products/${productId}?${params.toString()}`);
        return this.mapToProduct(bcProduct.data);
      } catch (error) {
        this.logger.error(
          { message: `Error fetching product ${productId} from BigCommerce` },
          error instanceof Error ? error : new Error(String(error))
        );
        return null;
      }
    });
  }

  /**
   * Create a new product on BigCommerce
   */
  async createProduct(product: Product): Promise<Product> {
    if (!this.isInitialized()) {
      throw new Error('BigCommerce product service not initialized');
    }

    return withTokenRefresh(ECommercePlatform.BIGCOMMERCE, async () => {
      try {
        const bcProduct = this.mapToBigCommerceProduct(product);
        const createdProduct = await this.apiClient.post<{ data: any }>('catalog/products', bcProduct);
        return this.mapToProduct(createdProduct.data);
      } catch (error) {
        this.logger.error({ message: 'Error creating product on BigCommerce' }, error instanceof Error ? error : new Error(String(error)));
        throw new Error(`Failed to create product: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    });
  }

  /**
   * Update a product on BigCommerce
   */
  async updateProduct(productId: string, productData: Partial<Product>): Promise<Product> {
    if (!this.isInitialized()) {
      throw new Error('BigCommerce product service not initialized');
    }

    return withTokenRefresh(ECommercePlatform.BIGCOMMERCE, async () => {
      try {
        // Get the existing product
        const existingProduct = await this.getProductById(productId);
        if (!existingProduct) {
          throw new Error(`Product with ID ${productId} not found`);
        }

        const updatedProduct = { ...existingProduct, ...productData };
        const bcProduct = this.mapToBigCommerceProduct(updatedProduct);
        const updatedBcProduct = await this.apiClient.put<{ data: any }>(`catalog/products/${productId}`, bcProduct);
        return this.mapToProduct(updatedBcProduct.data);
      } catch (error) {
        this.logger.error(
          { message: `Error updating product ${productId} on BigCommerce` },
          error instanceof Error ? error : new Error(String(error))
        );
        throw new Error(`Failed to update product: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    });
  }

  /**
   * Delete a product from BigCommerce
   */
  async deleteProduct(productId: string): Promise<boolean> {
    if (!this.isInitialized()) {
      throw new Error('BigCommerce product service not initialized');
    }

    return withTokenRefresh(ECommercePlatform.BIGCOMMERCE, async () => {
      try {
        await this.apiClient.delete(`catalog/products/${productId}`);
        return true;
      } catch (error) {
        this.logger.error(
          { message: `Error deleting product ${productId} from BigCommerce` },
          error instanceof Error ? error : new Error(String(error))
        );
        return false;
      }
    });
  }

  /**
   * Sync products with BigCommerce
   */
  async syncProducts(products: Product[]): Promise<SyncResult> {
    if (!this.isInitialized()) {
      throw new Error('BigCommerce product service not initialized');
    }

    const result: SyncResult = {
      successful: 0,
      failed: 0,
      errors: [],
    };

    for (const product of products) {
      try {
        // Check if the product already exists
        const existingProduct = await this.getProductById(product.id);

        if (existingProduct) {
          // Update the existing product
          await this.updateProduct(product.id, product);
        } else {
          // Create a new product
          await this.createProduct(product);
        }

        result.successful++;
      } catch (error) {
        result.failed++;
        result.errors.push({
          productId: product.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return result;
  }

  /**
   * Map a BigCommerce product to our standard format
   */
  protected mapToProduct(bcProduct: any): Product {
    // Map variants
    const variants =
      bcProduct.variants?.map((variant: any) => ({
        id: variant.id.toString(),
        title: variant.option_values?.map((opt: any) => `${opt.option_display_name}: ${opt.label}`).join(' / ') || 'Default',
        sku: variant.sku,
        price: parseFloat(variant.price || bcProduct.price || '0'),
        compareAtPrice: variant.calculated_price !== variant.price ? parseFloat(variant.calculated_price) : undefined,
        inventoryQuantity: variant.inventory_level || 0,
        weight: variant.weight ? parseFloat(variant.weight) : undefined,
        options: variant.option_values?.map((opt: any) => opt.label) || [],
      })) || [];

    // If no variants, create one from the main product
    if (!variants || variants.length === 0) {
      variants.push({
        id: `${bcProduct.id}-default`,
        title: 'Default',
        sku: bcProduct.sku,
        price: parseFloat(bcProduct.price || '0'),
        compareAtPrice: bcProduct.sale_price ? parseFloat(bcProduct.sale_price) : undefined,
        inventoryQuantity: bcProduct.inventory_level || 0,
        weight: bcProduct.weight ? parseFloat(bcProduct.weight) : undefined,
        options: [],
      });
    }

    // Map options
    const options =
      bcProduct.options?.map((option: any) => ({
        id: option.id.toString(),
        name: option.display_name,
        values: option.option_values?.map((val: any) => val.label) || [],
      })) || [];

    // Map images
    const images =
      bcProduct.images?.map((image: any) => ({
        id: image.id.toString(),
        url: image.url_zoom || image.url_standard || image.url,
        alt: image.description || '',
        position: image.sort_order,
      })) || [];

    return {
      id: bcProduct.id.toString(),
      title: bcProduct.name,
      description: bcProduct.description || '',
      vendor: bcProduct.brand_name || bcProduct.brand?.name || '',
      productType: bcProduct.type || bcProduct.categories?.map((cat: any) => cat.name).join(', ') || '',
      tags: [], // BigCommerce doesn't have a direct "tags" concept, using empty array
      options,
      variants,
      images,
      createdAt: bcProduct.date_created ? new Date(bcProduct.date_created) : undefined,
      updatedAt: bcProduct.date_modified ? new Date(bcProduct.date_modified) : undefined,
    };
  }

  /**
   * Map our product format to BigCommerce's format
   */
  private mapToBigCommerceProduct(product: Product): any {
    // Extract the primary variant
    const primaryVariant = product.variants[0] || {
      price: 0,
      sku: '',
      inventoryQuantity: 0,
      weight: undefined,
    };

    return {
      name: product.title,
      type: 'physical', // Could be 'digital' if needed
      description: product.description,
      sku: primaryVariant.sku,
      price: primaryVariant.price,
      weight: primaryVariant.weight || 0,
      inventory_level: primaryVariant.inventoryQuantity,
      inventory_tracking: 'product',
      is_visible: true,
      brand_name: product.vendor,
      categories: product.productType ? [1] : [], // In real implementation, you'd need to map category names to IDs
      images:
        product.images?.map((image, index) => ({
          image_url: image.url,
          description: image.alt || '',
          sort_order: image.position || index,
        })) || [],
      // For variants and options, a more complex mapping would be required
    };
  }
}
