/* eslint-disable @typescript-eslint/no-explicit-any -- raw platform API response mapping */
import { Category } from '../CategoryServiceInterface';
import { BaseCategoryService } from './BaseCategoryService';
import { PlatformConfigRequirements } from './PlatformCategoryServiceInterface';
import { WooCommerceApiClient } from '../../clients/woocommerce/WooCommerceApiClient';

/**
 * WooCommerce-specific category service implementation
 * In WooCommerce, categories are called "product_cat" taxonomy terms
 */
export class WooCommerceCategoryService extends BaseCategoryService {
  private apiClient = WooCommerceApiClient.getInstance();
  /**
   * Get configuration requirements for WooCommerce
   */
  getConfigRequirements(): PlatformConfigRequirements {
    return {
      required: ['storeUrl', 'apiKey', 'apiSecret'],
      optional: [],
    };
  }

  /**
   * Get all categories from WooCommerce
   */
  async getCategories(): Promise<Category[]> {
    if (!this.isInitialized()) {
      throw new Error('WooCommerce category service not initialized');
    }

    try {
      const categories = await this.apiClient.get<any[]>('products/categories', { per_page: '100' });

      // Convert WooCommerce categories to our format
      return this.buildCategoryTree(categories);
    } catch (error) {
      this.logger.error({ message: 'Error fetching WooCommerce categories:' }, error instanceof Error ? error : new Error(String(error)));
      return [];
    }
  }

  /**
   * Get a specific category by ID from WooCommerce
   */
  async getCategoryById(categoryId: string): Promise<Category | undefined> {
    if (!this.isInitialized()) {
      throw new Error('WooCommerce category service not initialized');
    }

    try {
      const category = await this.apiClient.get<any>(`products/categories/${categoryId}`);
      return this.mapWooCommerceCategory(category);
    } catch (error) {
      this.logger.error(
        { message: `Error fetching WooCommerce category ${categoryId}:` },
        error instanceof Error ? error : new Error(String(error))
      );
      return undefined;
    }
  }

  /**
   * Create a new category in WooCommerce
   */
  async createCategory(category: Omit<Category, 'id'>): Promise<Category> {
    if (!this.isInitialized()) {
      throw new Error('WooCommerce category service not initialized');
    }

    try {
      // Format category data for WooCommerce
      const requestData = {
        name: category.name,
        description: category.description || '',
        parent: category.parentId ? parseInt(category.parentId, 10) : 0,
        image: category.image ? { src: category.image } : undefined,
      };

      const newCategory = await this.apiClient.post<any>('products/categories', requestData);
      return this.mapWooCommerceCategory(newCategory);
    } catch (error) {
      this.logger.error({ message: 'Error creating WooCommerce category:' }, error instanceof Error ? error : new Error(String(error)));
      throw new Error(`Failed to create category: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
    }
  }

  /**
   * Update an existing category in WooCommerce
   */
  async updateCategory(categoryId: string, categoryData: Partial<Category>): Promise<Category> {
    if (!this.isInitialized()) {
      throw new Error('WooCommerce category service not initialized');
    }

    try {
      // Format category data for WooCommerce
      const requestData: Record<string, any> = {};

      if (categoryData.name !== undefined) requestData.name = categoryData.name;
      if (categoryData.description !== undefined) requestData.description = categoryData.description;
      if (categoryData.parentId !== undefined) requestData.parent = parseInt(categoryData.parentId, 10);
      if (categoryData.image !== undefined) requestData.image = { src: categoryData.image };

      const updatedCategory = await this.apiClient.put<any>(`products/categories/${categoryId}`, requestData);
      return this.mapWooCommerceCategory(updatedCategory);
    } catch (error) {
      this.logger.error(
        { message: `Error updating WooCommerce category ${categoryId}:` },
        error instanceof Error ? error : new Error(String(error))
      );
      throw new Error(`Failed to update category: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
    }
  }

  /**
   * Delete a category from WooCommerce
   */
  async deleteCategory(categoryId: string): Promise<boolean> {
    if (!this.isInitialized()) {
      throw new Error('WooCommerce category service not initialized');
    }

    try {
      await this.apiClient.delete(`products/categories/${categoryId}?force=true`);
      return true;
    } catch (error) {
      this.logger.error(
        { message: `Error deleting WooCommerce category ${categoryId}:` },
        error instanceof Error ? error : new Error(String(error))
      );
      return false;
    }
  }

  /**
   * Map a WooCommerce category to our Category interface
   */
  private mapWooCommerceCategory(category: any): Category {
    return {
      id: category.id.toString(),
      name: category.name || '',
      description: category.description || '',
      parentId: category.parent ? category.parent.toString() : undefined,
      image: category.image?.src,
    };
  }

  /**
   * Build a category tree from WooCommerce categories
   */
  private buildCategoryTree(categories: any[]): Category[] {
    // First map all categories
    const mappedCategories = categories.map(cat => this.mapWooCommerceCategory(cat));

    // Create a flat list of all categories
    return mappedCategories;
  }
}
