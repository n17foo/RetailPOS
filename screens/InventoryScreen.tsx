import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { MaterialIcons } from '@expo/vector-icons';
import { lightColors, spacing, typography, borderRadius } from '../utils/theme';
import { Input } from '../components/Input';
import { useInventory } from '../hooks/useInventory';
import { useProductsForDisplay } from '../hooks/useProducts';
import { useEcommerceSettings } from '../hooks/useEcommerceSettings';
import InventoryItemCard, { InventoryItem } from './inventory/InventoryItemCard';
import InventoryFilterTabs from './inventory/InventoryFilterTabs';
import InventorySummaryFooter from './inventory/InventorySummaryFooter';
import { useLogger } from '../hooks/useLogger';
import { useInventoryScanner } from '../hooks/useInventoryScanner';
import { procurementService } from '../services/procurement/ProcurementService';
import { useNavigation } from '@react-navigation/native';
import type { MainTabScreenProps } from '../navigation/types';

interface InventoryScreenProps {
  onGoBack?: () => void;
}

const LOW_STOCK_THRESHOLD = 10;

const InventoryScreen: React.FC<InventoryScreenProps> = ({ onGoBack }) => {
  const { products, isLoading: productsLoading, refresh: fetchProducts } = useProductsForDisplay();
  const { isInitialized: ecommerceInitialized } = useEcommerceSettings();
  const { isLoading: inventoryLoading, error, getInventory, adjustInventory, setInventoryQuantity } = useInventory();
  const navigation = useNavigation<MainTabScreenProps<'Inventory'>['navigation']>();

  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editQuantity, setEditQuantity] = useState('');
  const [inlineError, setInlineError] = useState<string | null>(null);
  const logger = useLogger('InventoryScreen');

  const { scanModeActive, toggleScanMode } = useInventoryScanner(inventoryItems, (itemKey, itemName, qty) => {
    setSearchQuery(itemName);
    setEditingItem(itemKey);
    setEditQuantity(qty.toString());
  });

  // Load inventory data
  const loadInventory = useCallback(async () => {
    if (!ecommerceInitialized || products.length === 0) return;

    try {
      const productIds = products.map(p => p.id);
      const result = await getInventory(productIds);

      if (result) {
        // Load reorder point configurations
        const reorderConfigs = await procurementService.getAllReorderConfigs();
        const reorderMap = new Map(reorderConfigs.map(config => [`${config.product_id}-${config.variant_id || ''}`, config]));

        // Map inventory data with product info and reorder points
        const items: InventoryItem[] = result.items.map(item => {
          const product = products.find(p => p.id === item.productId);
          const reorderKey = `${item.productId}-${item.variantId || ''}`;
          const reorderConfig = reorderMap.get(reorderKey);

          return {
            productId: item.productId,
            variantId: item.variantId || undefined,
            name: product?.name || 'Unknown Product',
            sku: item.sku || product?.sku,
            quantity: item.quantity,
            lowStockThreshold: LOW_STOCK_THRESHOLD,
            reorderPoint: reorderConfig?.reorder_point,
            reorderQty: reorderConfig?.reorder_qty,
            defaultVendorId: reorderConfig?.default_vendor_id || undefined,
          };
        });
        setInventoryItems(items);
      }
    } catch (err) {
      logger.error('Error loading inventory:', err instanceof Error ? err : new Error(String(err)));
    }
  }, [ecommerceInitialized, products, getInventory, logger]);

  // Load products and inventory on mount
  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  useEffect(() => {
    if (products.length > 0) {
      loadInventory();
    }
  }, [products, loadInventory]);

  // Handle refresh
  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchProducts();
    await loadInventory();
    setRefreshing(false);
  };

  // Filter inventory items
  const filteredItems = inventoryItems.filter(item => {
    // Apply search filter
    const matchesSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.sku && item.sku.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;

    // Apply stock filter
    switch (filter) {
      case 'low':
        return item.quantity > 0 && item.quantity <= (item.lowStockThreshold || LOW_STOCK_THRESHOLD);
      case 'out':
        return item.quantity === 0;
      case 'all':
      default:
        return true;
    }
  });

  // Handle quantity adjustment
  const handleAdjustQuantity = async (productId: string, adjustment: number, variantId?: string) => {
    setInlineError(null);
    const success = await adjustInventory(productId, adjustment, variantId);
    if (success) {
      setInventoryItems(prev =>
        prev.map(item =>
          item.productId === productId && item.variantId === variantId
            ? { ...item, quantity: Math.max(0, item.quantity + adjustment) }
            : item
        )
      );
    } else {
      setInlineError('Failed to update inventory. Please try again.');
    }
  };

  // Handle set quantity
  const handleSetQuantity = async (productId: string, variantId?: string) => {
    const quantity = parseInt(editQuantity, 10);
    if (isNaN(quantity) || quantity < 0) {
      setInlineError('Please enter a valid quantity.');
      return;
    }

    const success = await setInventoryQuantity(productId, quantity, variantId);
    if (success) {
      setInventoryItems(prev =>
        prev.map(item => (item.productId === productId && item.variantId === variantId ? { ...item, quantity } : item))
      );
      setEditingItem(null);
      setEditQuantity('');
      setInlineError(null);
    } else {
      setInlineError('Failed to update inventory. Please try again.');
    }
  };

  const handleStartEdit = (itemKey: string, currentQuantity: number) => {
    setEditingItem(itemKey);
    setEditQuantity(currentQuantity.toString());
  };

  const handleCancelEdit = () => {
    setEditingItem(null);
    setEditQuantity('');
  };

  // Handle Create PO for reorder
  const handleCreatePO = async (productId: string, _variantId?: string, reorderQty?: number, _vendorId?: string) => {
    try {
      const product = products.find(p => p.id === productId);
      if (!product) {
        Alert.alert('Error', 'Product not found');
        return;
      }

      // Navigate to PurchaseOrders screen with pre-filled data
      navigation.navigate('More', { screen: 'PurchaseOrders' });

      // Show success message
      Alert.alert(
        'Navigate to Purchase Orders',
        `Create a purchase order for ${product.name}${reorderQty ? ` (suggested qty: ${reorderQty})` : ''}`
      );
    } catch (err) {
      Alert.alert('Error', 'Failed to create purchase order');
      logger.error('Error creating PO:', err instanceof Error ? err : new Error(String(err)));
    }
  };

  // Render inventory item
  const renderInventoryItem = ({ item }: { item: InventoryItem }) => (
    <InventoryItemCard
      item={item}
      isEditing={editingItem === `${item.productId}-${item.variantId || ''}`}
      editQuantity={editQuantity}
      inventoryLoading={inventoryLoading}
      onEditQuantityChange={setEditQuantity}
      onStartEdit={handleStartEdit}
      onCancelEdit={handleCancelEdit}
      onSaveQuantity={handleSetQuantity}
      onAdjustQuantity={handleAdjustQuantity}
      onCreatePO={handleCreatePO}
    />
  );

  // Render empty state
  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Text style={styles.emptyStateTitle}>
        {!ecommerceInitialized ? 'E-Commerce Not Configured' : productsLoading ? 'Loading Products...' : 'No Products Found'}
      </Text>
      <Text style={styles.emptyStateText}>
        {!ecommerceInitialized
          ? 'Configure your e-commerce platform in Settings to manage inventory.'
          : 'Add products to your store to start tracking inventory.'}
      </Text>
    </View>
  );

  const isLoading = productsLoading || inventoryLoading;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        {onGoBack && (
          <TouchableOpacity onPress={onGoBack} style={styles.backButton} accessibilityLabel="Go back" accessibilityRole="button">
            <MaterialIcons name="arrow-back" size={24} color={lightColors.primary} />
          </TouchableOpacity>
        )}
        <View style={styles.headerTitleGroup}>
          <Text style={styles.title}>Inventory</Text>
          {inventoryItems.length > 0 && <Text style={styles.headerSubtitle}>{inventoryItems.length} items</Text>}
        </View>
        <TouchableOpacity
          onPress={toggleScanMode}
          style={[styles.scanButton, scanModeActive && styles.scanButtonActive]}
          accessibilityLabel={scanModeActive ? 'Stop scanning' : 'Scan barcode'}
          accessibilityRole="button"
        >
          <MaterialIcons name="qr-code-scanner" size={22} color={scanModeActive ? lightColors.textOnPrimary : lightColors.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => navigation.navigate('More', { screen: 'ReorderPointConfig' })}
          style={styles.configButton}
          accessibilityLabel="Configure reorder points"
          accessibilityRole="button"
        >
          <MaterialIcons name="settings" size={22} color={lightColors.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => navigation.navigate('More', { screen: 'BarcodeLabelPrint' })}
          style={styles.labelButton}
          accessibilityLabel="Print barcode labels"
          accessibilityRole="button"
        >
          <MaterialIcons name="label" size={22} color={lightColors.primary} />
        </TouchableOpacity>
      </View>

      {/* Search and Filter */}
      <View style={styles.searchContainer}>
        <Input
          placeholder="Search by name or SKU..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          showClearButton
          containerStyle={styles.searchInput}
        />
      </View>

      {/* Filter Tabs */}
      <InventoryFilterTabs filter={filter} items={inventoryItems} onFilterChange={setFilter} />

      {/* Error Display */}
      {(error || inlineError) && (
        <View style={styles.errorContainer}>
          <MaterialIcons name="error-outline" size={16} color={lightColors.error} />
          <Text style={styles.errorText}>{inlineError || error}</Text>
          <TouchableOpacity onPress={() => setInlineError(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialIcons name="close" size={16} color={lightColors.error} />
          </TouchableOpacity>
        </View>
      )}

      {/* Inventory List */}
      {isLoading && inventoryItems.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={lightColors.primary} />
          <Text style={styles.loadingText}>Loading inventory...</Text>
        </View>
      ) : (
        <FlashList
          data={filteredItems}
          renderItem={renderInventoryItem}
          keyExtractor={item => `${item.productId}-${item.variantId || ''}`}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={renderEmptyState}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        />
      )}

      {/* Summary Footer */}
      <InventorySummaryFooter items={inventoryItems} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: lightColors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: lightColors.surface,
    borderBottomWidth: 1,
    borderBottomColor: lightColors.border,
    gap: spacing.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleGroup: {
    flex: 1,
  },
  title: {
    fontSize: typography.fontSize.xl,
    fontWeight: '700',
    color: lightColors.textPrimary,
  },
  headerSubtitle: {
    fontSize: typography.fontSize.sm,
    color: lightColors.textSecondary,
    marginTop: 1,
  },
  scanButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: lightColors.primary,
  },
  scanButtonActive: {
    backgroundColor: lightColors.primary,
    borderColor: lightColors.primary,
  },
  configButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: lightColors.primary,
  },
  labelButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: lightColors.primary,
  },
  searchContainer: {
    padding: spacing.md,
    backgroundColor: lightColors.surface,
  },
  searchInput: {
    marginBottom: 0,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    margin: spacing.md,
    padding: spacing.sm,
    backgroundColor: lightColors.error + '15',
    borderRadius: borderRadius.md,
  },
  errorText: {
    flex: 1,
    color: lightColors.error,
    fontSize: typography.fontSize.sm,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: spacing.md,
    color: lightColors.textSecondary,
  },
  listContent: {
    padding: spacing.md,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyStateTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: '600',
    color: lightColors.textPrimary,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emptyStateText: {
    fontSize: typography.fontSize.md,
    color: lightColors.textSecondary,
    textAlign: 'center',
  },
});

export default InventoryScreen;
