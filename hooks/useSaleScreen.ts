/**
 * useSaleScreen
 *
 * Encapsulates all product-loading, search, category-filter, barcode-scan,
 * and UX state management logic. Implements Sales UX spec requirements.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useCategoryContext } from '../contexts/CategoryProvider';
import { useEcommerceSettings } from './useEcommerceSettings';
import { useProductsForDisplay } from './useProducts';
import { useResponsive, getProductColumns, getSidebarWidths } from './useResponsive';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { ProductServiceFactory } from '../services/product/ProductServiceFactory';
import { ECommercePlatform } from '../utils/platforms';
import type { MainTabParamList } from '../navigation/types';
import { useBasketState } from '../contexts/BasketStateProvider';
import { BasketProduct, useBasketActions } from '../contexts/BasketActionsProvider';
import { useCheckoutContext } from '../contexts/CheckoutProvider';
import { getUserFacingSaleState, type UserFacingSaleState } from '../utils/orderStateMapper';
import type { BasketBlocker } from '../components/BasketBlockers';
import type { BasketItem } from '../services/basket/basket';

export function useSaleScreen() {
  const { selectedCategory, selectedCategoryName, setSelectedCategory, setSelectedCategoryName } = useCategoryContext();
  const { basketItems, basketItemsMap, itemCount, total, basket } = useBasketState();
  const { addToBasket, updateQuantity } = useBasketActions();
  const { currentOrder, unsyncedOrdersCount, isProcessing } = useCheckoutContext();
  const { isTabletOrDesktop, width } = useResponsive();
  const [searchQuery, setSearchQuery] = useState('');

  const route = useRoute<RouteProp<MainTabParamList, 'Sale'>>();
  const handledScanRef = useRef<string | null>(null);

  const { currentPlatform } = useEcommerceSettings();
  const {
    products,
    isLoading: isProductLoading,
    loadMore,
  } = useProductsForDisplay(currentPlatform || undefined, selectedCategory, selectedCategoryName);

  const filteredProducts = searchQuery ? products.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase())) : products;

  const numColumns = getProductColumns(width);
  const sidebarWidths = getSidebarWidths(width);

  // ── UX State Management (Sales UX spec §2.2, §2.3) ────────────────────

  // Validate basket and compute blockers
  const blockers = useMemo((): BasketBlocker[] => {
    const result: BasketBlocker[] = [];

    // Blocker: Discount requires customer email (spec §2.3.2)
    if (basket && basket.discountCode && !basket.customerEmail) {
      result.push({
        type: 'warning',
        message: 'Customer email required for discount',
        action: {
          label: 'Add Customer',
          onPress: () => {
            // This will be handled by the parent component
            // by opening the customer modal
          },
        },
      });
    }

    // Blocker: Product missing required variant
    // Check if any basket items have products with multiple variants but no variantId selected
    const itemsNeedingVariant = basketItems.filter(item => {
      const product = products.find(p => p.id === item.productId);
      return product && product.variants && product.variants.length > 1 && !item.variantId;
    });

    if (itemsNeedingVariant.length > 0) {
      itemsNeedingVariant.forEach(item => {
        result.push({
          type: 'error',
          message: `Variant selection required for ${item.name}`,
          action: {
            label: 'Select Variant',
            onPress: () => {
              // This will be handled by the parent component
              // by opening the variant picker
            },
          },
        });
      });
    }

    // Blocker: Unsynced orders (info level - doesn't prevent checkout)
    if (unsyncedOrdersCount > 0) {
      result.push({
        type: 'info',
        message: `${unsyncedOrdersCount} ${unsyncedOrdersCount === 1 ? 'order' : 'orders'} pending sync`,
        action: {
          label: 'Retry Sync',
          onPress: () => {
            // This will be handled by the parent component
            // by calling syncAllPendingOrders
          },
        },
      });
    }

    return result;
  }, [basket, basketItems, products, unsyncedOrdersCount]);

  // Compute user-facing sale state
  const saleState: UserFacingSaleState = useMemo(() => {
    // Convert context BasketItems to service BasketItems for state computation
    const serviceBasketItems: BasketItem[] = basketItems.map(item => ({
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      sku: item.sku,
      image: typeof item.image === 'string' ? item.image : '',
    }));
    return getUserFacingSaleState(serviceBasketItems, currentOrder, blockers, isProcessing);
  }, [basketItems, currentOrder, blockers, isProcessing]);

  // Keyboard shortcut: Cmd+K to focus search (desktop)
  useKeyboardShortcuts([{ key: 'k', meta: true, handler: () => {}, description: 'Focus search' }], isTabletOrDesktop);

  // Auto-add product when arriving from a barcode scan
  useEffect(() => {
    const scannedId = route.params?.scannedProductId;
    if (!scannedId || scannedId === handledScanRef.current) return;
    handledScanRef.current = scannedId;

    const tryAdd = async () => {
      let product = products.find(p => p.id === scannedId);

      if (!product) {
        try {
          const service = ProductServiceFactory.getInstance().getService(currentPlatform || ECommercePlatform.OFFLINE);
          const result = await service?.getProducts({ ids: [scannedId], limit: 1 }).then(r => r.products[0]);
          if (result) {
            const { getDefaultVariant } = await import('../services/product/types');
            const { mapToUnifiedProducts } = await import('../services/product/mappers');
            const unified = mapToUnifiedProducts([result], currentPlatform || ECommercePlatform.OFFLINE);
            const u = unified[0];
            if (u) {
              const dv = getDefaultVariant(u);
              const img = u.images.find(i => i.isPrimary) || u.images[0];
              product = {
                id: u.id,
                platformId: u.platformId,
                name: u.title,
                price: dv?.price || 0,
                image: img?.url ? { uri: img.url } : null,
                categoryId: u.categoryIds[0] || u.productType || '',
                categoryName: u.productType,
                description: u.description,
                sku: dv?.sku,
                barcode: dv?.barcode,
                stock: dv?.inventoryQuantity || 0,
                isEcommerceProduct: u.platform !== ECommercePlatform.OFFLINE,
                variantId: dv?.id,
                platform: u.platform,
                variants: u.variants.length > 1 ? u.variants : undefined,
                options: u.options.length > 0 ? u.options : undefined,
                taxProfileId: u.taxProfileId,
                taxCode: u.taxCode ?? dv?.taxCode,
              };
            }
          }
        } catch {
          // fall through
        }
      }

      if (!product) return;

      const basketProduct: BasketProduct = {
        id: product.id,
        name: product.name,
        price: product.price,
        image: product.image,
        isEcommerceProduct: product.isEcommerceProduct,
        variantId: product.variantId,
        sku: product.sku,
        platformId: product.platformId,
        platform: product.platform,
        taxProfileId: product.taxProfileId,
        taxCode: product.taxCode,
      };
      addToBasket(basketProduct, 1).catch(() => {});
    };

    tryAdd();
  }, [route.params?.scannedProductId, products, addToBasket, currentPlatform]);

  const handleAddToCart = useCallback(
    async (id: string, quantity: number, variantId?: string) => {
      const product = products.find(p => p.id === id);
      if (!product) return;

      const cartItem = basketItems.find(item => item.productId === id);

      if (quantity <= 0 && cartItem) {
        await updateQuantity(cartItem.id, 0);
      } else if (cartItem) {
        await updateQuantity(cartItem.id, quantity);
      } else if (quantity > 0) {
        const basketProduct: BasketProduct = {
          id: product.id,
          name: product.name,
          price: product.price,
          image: product.image,
          isEcommerceProduct: product.isEcommerceProduct,
          variantId: variantId ?? product.variantId,
          sku: product.sku,
          platformId: product.platformId,
          platform: product.platform,
          taxProfileId: product.taxProfileId,
          taxCode: product.taxCode,
        };
        await addToBasket(basketProduct, quantity);
      }
    },
    [products, basketItems, updateQuantity, addToBasket]
  );

  const clearCategoryFilter = useCallback(() => {
    setSearchQuery('');
    setSelectedCategory(null);
    setSelectedCategoryName(null);
  }, [setSelectedCategory, setSelectedCategoryName]);

  return {
    // Platform
    currentPlatform,
    // Products
    products,
    filteredProducts,
    isProductLoading,
    loadMore,
    // Search
    searchQuery,
    setSearchQuery,
    // Category
    selectedCategory,
    selectedCategoryName,
    setSelectedCategory,
    setSelectedCategoryName,
    clearCategoryFilter,
    // Cart
    basketItemsMap,
    itemCount,
    total,
    handleAddToCart,
    // Layout
    isTabletOrDesktop,
    numColumns,
    sidebarWidths,
    // UX State (Sales UX spec)
    saleState,
    blockers,
    unsyncedOrdersCount,
  };
}
