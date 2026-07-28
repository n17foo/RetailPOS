/* eslint-disable @typescript-eslint/no-explicit-any -- raw platform API response mapping */
import { Category } from '../CategoryServiceInterface';
import { BaseCategoryService } from './BaseCategoryService';
import { PlatformConfigRequirements } from './PlatformCategoryServiceInterface';
import { ShopifyApiClient } from '../../clients/shopify/ShopifyApiClient';

/**
 * Shopify-specific category service implementation
 * In Shopify, categories are called "collections"
 */
export class ShopifyCategoryService extends BaseCategoryService {
  private apiClient = ShopifyApiClient.getInstance();

  /**
   * Get configuration requirements for Shopify
   */
  getConfigRequirements(): PlatformConfigRequirements {
    return {
      required: ['storeUrl', 'accessToken'],
      optional: ['apiVersion'],
    };
  }

  /**
   * Get all categories (collections) from Shopify
   */
  async getCategories(): Promise<Category[]> {
    if (!this.isInitialized()) {
      throw new Error('Shopify category service not initialized');
    }

    try {
      // Shopify uses collections for categorization
      // First, get custom collections
      const customData = await this.apiClient.get<{ custom_collections: any[] }>('custom_collections.json');

      // Then get smart collections
      const smartData = await this.apiClient.get<{ smart_collections: any[] }>('smart_collections.json');

      // Map collections to our category format
      const customCategories = customData.custom_collections?.map(this.mapCollectionToCategory) || [];
      const smartCategories = smartData.smart_collections?.map(this.mapCollectionToCategory) || [];

      // Combine both collection types
      return [...customCategories, ...smartCategories];
    } catch (error) {
      this.logger.error({ message: 'Error fetching Shopify categories:' }, error instanceof Error ? error : new Error(String(error)));
      return [];
    }
  }

  /**
   * Get a specific category by ID from Shopify
   */
  async getCategoryById(categoryId: string): Promise<Category | undefined> {
    if (!this.isInitialized()) {
      throw new Error('Shopify category service not initialized');
    }

    try {
      // Try to get as custom collection first
      try {
        const customData = await this.apiClient.get<{ custom_collection: any }>(`custom_collections/${categoryId}.json`);
        if (customData.custom_collection) {
          return this.mapCollectionToCategory(customData.custom_collection);
        }
      } catch {
        // Not a custom collection, try smart
      }

      // If not found as custom, try as smart collection
      try {
        const smartData = await this.apiClient.get<{ smart_collection: any }>(`smart_collections/${categoryId}.json`);
        if (smartData.smart_collection) {
          return this.mapCollectionToCategory(smartData.smart_collection);
        }
      } catch {
        // Not found in either
      }

      // Not found as either type
      return undefined;
    } catch (error) {
      this.logger.error(
        { message: `Error fetching Shopify category ${categoryId}:` },
        error instanceof Error ? error : new Error(String(error))
      );
      return undefined;
    }
  }

  /**
   * Create a new category in Shopify
   */
  async createCategory(category: Omit<Category, 'id'>): Promise<Category> {
    if (!this.isInitialized()) {
      throw new Error('Shopify category service not initialized');
    }

    try {
      // Format category data for Shopify
      const requestData = {
        custom_collection: {
          title: category.name,
          body_html: category.description || '',
          image: category.image ? { src: category.image } : undefined,
        },
      };

      const data = await this.apiClient.post<{ custom_collection: any }>('custom_collections.json', requestData);
      return this.mapCollectionToCategory(data.custom_collection);
    } catch (error) {
      this.logger.error({ message: 'Error creating Shopify category:' }, error instanceof Error ? error : new Error(String(error)));
      throw new Error(`Failed to create category: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
    }
  }

  /**
   * Update an existing category in Shopify
   */
  async updateCategory(categoryId: string, categoryData: Partial<Category>): Promise<Category> {
    if (!this.isInitialized()) {
      throw new Error('Shopify category service not initialized');
    }

    try {
      // We need to determine if this is a custom or smart collection
      const category = await this.getCategoryById(categoryId);
      if (!category) {
        throw new Error(`Category with ID ${categoryId} not found`);
      }

      // Smart collections can't be updated through the API in the same way
      // For this example, we'll focus on custom collections

      // Format category data for Shopify
      const requestData: any = {
        custom_collection: {
          id: categoryId,
          title: categoryData.name,
          body_html: categoryData.description,
          image: categoryData.image ? { src: categoryData.image } : undefined,
        },
      };

      // Remove undefined properties
      Object.entries(requestData.custom_collection).forEach(([key, value]) => {
        if (value === undefined) {
          delete requestData.custom_collection[key];
        }
      });

      const data = await this.apiClient.put<{ custom_collection: any }>(`custom_collections/${categoryId}.json`, requestData);
      return this.mapCollectionToCategory(data.custom_collection);
    } catch (error) {
      this.logger.error(
        { message: `Error updating Shopify category ${categoryId}:` },
        error instanceof Error ? error : new Error(String(error))
      );
      throw new Error(`Failed to update category: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
    }
  }

  /**
   * Delete a category from Shopify
   */
  async deleteCategory(categoryId: string): Promise<boolean> {
    if (!this.isInitialized()) {
      throw new Error('Shopify category service not initialized');
    }

    // Try to delete as custom collection first
    try {
      await this.apiClient.delete(`custom_collections/${categoryId}.json`);
      return true;
    } catch {
      // Not a custom collection, try smart
    }

    // If that fails, try to delete as smart collection
    try {
      await this.apiClient.delete(`smart_collections/${categoryId}.json`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Map a Shopify collection to our Category interface
   */
  private mapCollectionToCategory(collection: any): Category {
    return {
      id: collection.id.toString(),
      name: collection.title || '',
      description: collection.body_html || '',
      image: collection.image?.src,
      // Shopify doesn't have a direct parent-child hierarchy for collections
      // So parentId is not available here
    };
  }
}
