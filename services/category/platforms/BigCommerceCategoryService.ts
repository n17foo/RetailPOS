/* eslint-disable @typescript-eslint/no-explicit-any -- raw platform API response mapping */
import { Category } from '../CategoryServiceInterface';
import { BaseCategoryService } from './BaseCategoryService';
import { PlatformConfigRequirements } from './PlatformCategoryServiceInterface';
import { BigCommerceApiClient } from '../../clients/bigcommerce/BigCommerceApiClient';

/**
 * BigCommerce-specific category service implementation
 * Handles category operations for BigCommerce platform
 */
export class BigCommerceCategoryService extends BaseCategoryService {
  private apiClient = BigCommerceApiClient.getInstance();
  /**
   * Get configuration requirements for BigCommerce
   */
  getConfigRequirements(): PlatformConfigRequirements {
    return {
      required: ['storeHash', 'accessToken', 'clientId'],
      optional: [],
    };
  }

  /**
   * Get all categories from BigCommerce
   */
  async getCategories(): Promise<Category[]> {
    if (!this.isInitialized()) {
      throw new Error('BigCommerce category service not initialized');
    }

    try {
      const data = await this.apiClient.get<{ data: any[] }>('catalog/categories?limit=250');

      if (!data.data || !Array.isArray(data.data)) {
        return [];
      }

      // Map BigCommerce categories to our format and build category tree
      return this.mapCategories(data.data);
    } catch (error) {
      this.logger.error({ message: 'Error fetching BigCommerce categories:' }, error instanceof Error ? error : new Error(String(error)));
      return [];
    }
  }

  /**
   * Get a specific category by ID from BigCommerce
   */
  async getCategoryById(categoryId: string): Promise<Category | undefined> {
    if (!this.isInitialized()) {
      throw new Error('BigCommerce category service not initialized');
    }

    try {
      const data = await this.apiClient.get<{ data: any }>(`catalog/categories/${categoryId}`);

      if (!data.data) {
        return undefined;
      }

      return this.mapCategory(data.data);
    } catch (error) {
      this.logger.error(
        { message: `Error fetching BigCommerce category ${categoryId}:` },
        error instanceof Error ? error : new Error(String(error))
      );
      return undefined;
    }
  }

  /**
   * Create a new category in BigCommerce
   */
  async createCategory(category: Omit<Category, 'id'>): Promise<Category> {
    if (!this.isInitialized()) {
      throw new Error('BigCommerce category service not initialized');
    }

    try {
      // Format category data for BigCommerce
      const requestData: any = {
        name: category.name,
        description: category.description || '',
        is_visible: true,
        parent_id: category.parentId ? parseInt(category.parentId, 10) : 0,
        image_url: category.image,
      };

      const data = await this.apiClient.post<{ data: any }>('catalog/categories', requestData);

      if (!data.data) {
        throw new Error('Failed to create category: No data returned');
      }

      return this.mapCategory(data.data);
    } catch (error) {
      this.logger.error({ message: 'Error creating BigCommerce category:' }, error instanceof Error ? error : new Error(String(error)));
      throw new Error(`Failed to create category: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
    }
  }

  /**
   * Update an existing category in BigCommerce
   */
  async updateCategory(categoryId: string, categoryData: Partial<Category>): Promise<Category> {
    if (!this.isInitialized()) {
      throw new Error('BigCommerce category service not initialized');
    }

    try {
      // Format category data for BigCommerce
      const requestData: any = {};

      if (categoryData.name !== undefined) requestData.name = categoryData.name;
      if (categoryData.description !== undefined) requestData.description = categoryData.description;
      if (categoryData.parentId !== undefined) requestData.parent_id = parseInt(categoryData.parentId, 10);
      if (categoryData.image !== undefined) requestData.image_url = categoryData.image;

      const data = await this.apiClient.put<{ data: any }>(`catalog/categories/${categoryId}`, requestData);

      if (!data.data) {
        throw new Error('Failed to update category: No data returned');
      }

      return this.mapCategory(data.data);
    } catch (error) {
      this.logger.error(
        { message: `Error updating BigCommerce category ${categoryId}:` },
        error instanceof Error ? error : new Error(String(error))
      );
      throw new Error(`Failed to update category: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
    }
  }

  /**
   * Delete a category from BigCommerce
   */
  async deleteCategory(categoryId: string): Promise<boolean> {
    if (!this.isInitialized()) {
      throw new Error('BigCommerce category service not initialized');
    }

    try {
      await this.apiClient.delete(`catalog/categories/${categoryId}`);
      return true;
    } catch (error) {
      this.logger.error(
        { message: `Error deleting BigCommerce category ${categoryId}:` },
        error instanceof Error ? error : new Error(String(error))
      );
      return false;
    }
  }

  /**
   * Map a BigCommerce category to our Category interface
   */
  private mapCategory(category: any): Category {
    return {
      id: category.id.toString(),
      name: category.name || '',
      description: category.description || '',
      parentId: category.parent_id > 0 ? category.parent_id.toString() : undefined,
      image: category.image_url,
    };
  }

  /**
   * Map BigCommerce categories and build proper hierarchy
   */
  private mapCategories(categories: any[]): Category[] {
    // First map all categories
    return categories.map(category => this.mapCategory(category));
  }

  /**
   * Create authorization headers for BigCommerce API
   */
  private getAuthHeaders(): Record<string, string> {
    return this.apiClient['buildHeaders']();
  }
}
