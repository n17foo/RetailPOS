import React from 'react';
import { View, StyleSheet, ActivityIndicator, Text, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { lightColors, spacing, typography, borderRadius } from '../utils/theme';
import { Basket } from './sale/Basket';
import { ProductGrid } from './sale/ProductGrid';
import { Header } from './sale/Header';
import { Category } from './sale/Category';
import { CategoryList } from './sale/CategoryList';
import { BasketContent } from './sale/BasketContent';
import { SearchBar } from '../components/SearchBar';
import { SalesStatusHeader } from '../components/SalesStatusHeader';
import { InterruptionBanner } from '../components/InterruptionBanner';
import { useSaleScreen } from '../hooks/useSaleScreen';
import { useInterruptionRecovery } from '../hooks/useInterruptionRecovery';
import { useAuthContext } from '../contexts/AuthProvider';
import { useCheckoutContext } from '../contexts/CheckoutProvider';

interface SaleScreenProps {
  username?: string;
}

const SaleScreen: React.FC<SaleScreenProps> = ({ username = 'User' }) => {
  const { user } = useAuthContext();
  const { syncAllPendingOrders, isSyncing } = useCheckoutContext();
  const {
    currentPlatform,
    filteredProducts,
    isProductLoading,
    loadMore,
    searchQuery,
    setSearchQuery,
    selectedCategoryName,
    setSelectedCategory,
    setSelectedCategoryName,
    clearCategoryFilter,
    basketItemsMap,
    itemCount,
    total,
    handleAddToCart,
    isTabletOrDesktop,
    numColumns,
    sidebarWidths,
    // UX State
    saleState,
    unsyncedOrdersCount,
  } = useSaleScreen();

  const {
    interruptionState,
    resumeDraftSale,
    resumeCheckout,
    recoverPayment,
    clearAndDismiss,
    cancelAndDismiss,
    retrySync,
    dismissBanner,
  } = useInterruptionRecovery();

  // Build interruption banner actions
  const getInterruptionActions = () => {
    switch (interruptionState.type) {
      case 'draft-sale':
        return [
          { label: 'Resume Sale', onPress: resumeDraftSale, variant: 'primary' as const },
          { label: 'Clear Basket', onPress: clearAndDismiss, variant: 'secondary' as const },
        ];
      case 'interrupted-checkout':
        return [
          { label: 'Resume Checkout', onPress: resumeCheckout, variant: 'primary' as const },
          { label: 'Cancel Order', onPress: cancelAndDismiss, variant: 'secondary' as const },
        ];
      case 'interrupted-payment':
        return [
          { label: 'Recover Payment', onPress: recoverPayment, variant: 'primary' as const },
          { label: 'Cancel Order', onPress: cancelAndDismiss, variant: 'secondary' as const },
        ];
      case 'unsynced':
        return [
          { label: 'Retry Sync', onPress: retrySync, variant: 'primary' as const },
          { label: 'Continue', onPress: dismissBanner, variant: 'secondary' as const },
        ];
      default:
        return [];
    }
  };

  const getInterruptionMessage = () => {
    switch (interruptionState.type) {
      case 'draft-sale':
        return `You have a draft sale in progress (${interruptionState.itemCount} items)`;
      case 'interrupted-checkout':
        return `Checkout was interrupted. Order #${interruptionState.orderId?.slice(-8)} · ${interruptionState.itemCount} items`;
      case 'interrupted-payment':
        return `Payment was interrupted. Order #${interruptionState.orderId?.slice(-8)} · Processing state`;
      case 'unsynced':
        return `${unsyncedOrdersCount} ${unsyncedOrdersCount === 1 ? 'order' : 'orders'} pending sync`;
      default:
        return '';
    }
  };

  const renderProductArea = () => (
    <View style={styles.productArea}>
      <View style={styles.searchContainer}>
        <SearchBar placeholder="Search products..." onSearch={setSearchQuery} value={searchQuery} />
      </View>

      {selectedCategoryName && (
        <View style={styles.activeCategoryBar}>
          <MaterialIcons name="folder" size={14} color={lightColors.primary} />
          <Text style={styles.activeCategoryText} numberOfLines={1}>
            {selectedCategoryName}
          </Text>
          <TouchableOpacity
            onPress={() => {
              setSelectedCategory(null);
              setSelectedCategoryName(null);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Clear category filter"
            accessibilityRole="button"
          >
            <MaterialIcons name="close" size={14} color={lightColors.textSecondary} />
          </TouchableOpacity>
        </View>
      )}

      {isProductLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={lightColors.primary} />
          <Text style={styles.loadingText}>Loading products...</Text>
        </View>
      ) : filteredProducts.length === 0 ? (
        <View style={styles.emptyContainer}>
          <MaterialIcons name="search-off" size={56} color={lightColors.textSecondary} />
          <Text style={styles.emptyTitle}>{searchQuery ? 'No results found' : 'No products'}</Text>
          <Text style={styles.emptySubtitle}>
            {searchQuery
              ? `No products match "${searchQuery}"`
              : selectedCategoryName
                ? `No products in "${selectedCategoryName}"`
                : 'Add products to your catalogue to get started'}
          </Text>
          {(searchQuery || selectedCategoryName) && (
            <TouchableOpacity style={styles.clearFilterButton} onPress={clearCategoryFilter}>
              <Text style={styles.clearFilterText}>Clear filters</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <ProductGrid
          products={filteredProducts}
          onAddToCart={handleAddToCart}
          basketItems={basketItemsMap}
          numColumns={numColumns}
          onLoadMore={loadMore}
        />
      )}
    </View>
  );

  // ── Tablet / Desktop: 3-panel layout ──────────────────────────────────
  if (isTabletOrDesktop) {
    return (
      <View style={styles.container}>
        <Header username={username} cartItemTotal={itemCount} />
        <SalesStatusHeader
          registerName="Register 1"
          cashierName={user?.username || username}
          saleState={saleState}
          itemCount={itemCount}
          total={total}
          unsyncedCount={unsyncedOrdersCount}
          isSyncing={isSyncing}
          onSyncPress={syncAllPendingOrders}
        />
        {interruptionState.type !== 'none' && (
          <InterruptionBanner
            type={interruptionState.type}
            message={getInterruptionMessage()}
            actions={getInterruptionActions()}
            onDismiss={dismissBanner}
          />
        )}
        <View style={styles.desktopLayout}>
          <View style={[styles.sidebar, styles.categorySidebar, { width: sidebarWidths.category }]}>
            <Text style={styles.sidebarTitle}>Categories</Text>
            <CategoryList showBreadcrumb />
          </View>
          <View style={styles.mainContent}>{renderProductArea()}</View>
          <View style={[styles.sidebar, styles.basketSidebar, { width: sidebarWidths.basket }]}>
            <View style={styles.sidebarTitleRow}>
              <Text style={styles.sidebarTitle}>Cart</Text>
              {itemCount > 0 && (
                <View style={styles.sidebarBadge}>
                  <Text style={styles.sidebarBadgeText}>{itemCount}</Text>
                </View>
              )}
            </View>
            <BasketContent platform={currentPlatform ?? undefined} />
          </View>
        </View>
      </View>
    );
  }

  // ── Mobile: sliding panels ─────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <Header username={username} cartItemTotal={itemCount} />
      <SalesStatusHeader
        registerName="Register 1"
        cashierName={user?.username || username}
        saleState={saleState}
        itemCount={itemCount}
        total={total}
        unsyncedCount={unsyncedOrdersCount}
        isSyncing={isSyncing}
        onSyncPress={syncAllPendingOrders}
      />
      {interruptionState.type !== 'none' && (
        <InterruptionBanner
          type={interruptionState.type}
          message={getInterruptionMessage()}
          actions={getInterruptionActions()}
          onDismiss={dismissBanner}
        />
      )}
      <View style={styles.content}>{renderProductArea()}</View>
      <Category />
      <Basket platform={currentPlatform || undefined} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: lightColors.background },
  desktopLayout: { flex: 1, flexDirection: 'row' },
  sidebar: { backgroundColor: lightColors.surface, borderColor: lightColors.border },
  categorySidebar: { borderRightWidth: 1 },
  basketSidebar: { borderLeftWidth: 1 },
  sidebarTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: lightColors.border,
    gap: spacing.xs,
  },
  sidebarTitle: { fontSize: typography.fontSize.md, fontWeight: '700', color: lightColors.textPrimary },
  sidebarBadge: {
    backgroundColor: lightColors.primary,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  sidebarBadgeText: { color: lightColors.textOnPrimary, fontSize: 11, fontWeight: '700' },
  mainContent: { flex: 1, backgroundColor: lightColors.background },
  content: { flex: 1 },
  productArea: { flex: 1 },
  searchContainer: { padding: spacing.sm, paddingBottom: spacing.xs },
  activeCategoryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: lightColors.primary + '12',
    borderBottomWidth: 1,
    borderBottomColor: lightColors.primary + '25',
  },
  activeCategoryText: { flex: 1, fontSize: typography.fontSize.sm, fontWeight: '600', color: lightColors.primary },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: lightColors.surface },
  loadingText: { marginTop: spacing.sm, fontSize: typography.fontSize.md, color: lightColors.textSecondary },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl, backgroundColor: lightColors.background },
  emptyTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: '600',
    color: lightColors.textPrimary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  emptySubtitle: { fontSize: typography.fontSize.md, color: lightColors.textSecondary, textAlign: 'center', lineHeight: 22 },
  clearFilterButton: {
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: lightColors.primary,
    borderRadius: borderRadius.md,
  },
  clearFilterText: { color: lightColors.textOnPrimary, fontWeight: '600', fontSize: typography.fontSize.md },
});

export default SaleScreen;
