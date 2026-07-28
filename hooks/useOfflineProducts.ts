import { useState, useCallback, useEffect } from 'react';
import { Product } from '../services/product/ProductServiceInterface';
import { offlineProductService } from '../services/product/platforms/OfflineProductService';
import { useLogger } from './useLogger';

interface UseOfflineProductsReturn {
  products: Product[];
  isLoading: boolean;
  error: string | null;
  loadProducts: () => Promise<void>;
  createProduct: (product: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Product>;
  updateProduct: (id: string, data: Partial<Product>) => Promise<Product>;
  deleteProduct: (id: string) => Promise<boolean>;
  getProductById: (id: string) => Promise<Product | null>;
  clearAllProducts: () => Promise<void>;
}

export const useOfflineProducts = (): UseOfflineProductsReturn => {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logger = useLogger('useOfflineProducts');

  const loadProducts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await offlineProductService.getProducts({ limit: 1000 });
      setProducts(result.products);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load products');
      logger.error({ message: 'Error loading products' }, err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [logger]);

  const createProduct = useCallback(
    async (productData: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>): Promise<Product> => {
      setIsLoading(true);
      setError(null);
      try {
        const newProduct = await offlineProductService.createProduct(productData as Product);
        await loadProducts();
        return newProduct;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create product';
        setError(message);
        throw new Error(message, { cause: err });
      } finally {
        setIsLoading(false);
      }
    },
    [loadProducts]
  );

  const updateProduct = useCallback(
    async (id: string, data: Partial<Product>): Promise<Product> => {
      setIsLoading(true);
      setError(null);
      try {
        const updated = await offlineProductService.updateProduct(id, data);
        await loadProducts();
        return updated;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update product';
        setError(message);
        throw new Error(message, { cause: err });
      } finally {
        setIsLoading(false);
      }
    },
    [loadProducts]
  );

  const deleteProduct = useCallback(
    async (id: string): Promise<boolean> => {
      setIsLoading(true);
      setError(null);
      try {
        await offlineProductService.deleteProduct(id);
        await loadProducts();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete product');
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [loadProducts]
  );

  const getProductById = useCallback(
    async (id: string): Promise<Product | null> => {
      try {
        return await offlineProductService.getProductById(id);
      } catch (err) {
        logger.error({ message: 'Error getting product' }, err instanceof Error ? err : new Error(String(err)));
        return null;
      }
    },
    [logger]
  );

  const clearAllProducts = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    try {
      await offlineProductService.clearLocalProducts();
      setProducts([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear products');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  return {
    products,
    isLoading,
    error,
    loadProducts,
    createProduct,
    updateProduct,
    deleteProduct,
    getProductById,
    clearAllProducts,
  };
};

export type { Product };
