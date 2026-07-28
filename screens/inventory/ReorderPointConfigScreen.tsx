/**
 * ReorderPointConfigScreen
 *
 * Configure reorder points for products. Allows setting reorder point,
 * reorder quantity, and default vendor per product/variant.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Alert, ActivityIndicator } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { lightColors, spacing, borderRadius, typography, elevation } from '../../utils/theme';
import { Button } from '../../components/Button';
import { procurementService } from '../../services/procurement/ProcurementService';
import { vendorService } from '../../services/procurement/VendorService';
import { useProductsForDisplay } from '../../hooks/useProducts';
import { VendorRow } from '../../repositories/ProcurementRepository';

interface ProductWithConfig {
  productId: string;
  variantId?: string;
  name: string;
  sku?: string;
  reorderPoint?: number;
  reorderQty?: number;
  defaultVendorId?: string;
}

const ReorderPointConfigScreen: React.FC = () => {
  const { products } = useProductsForDisplay();
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [productConfigs, setProductConfigs] = useState<ProductWithConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingProduct, setEditingProduct] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{
    reorderPoint: string;
    reorderQty: string;
    vendorId: string;
  }>({ reorderPoint: '', reorderQty: '', vendorId: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [allVendors, allConfigs] = await Promise.all([vendorService.findAll(), procurementService.getAllReorderConfigs()]);

      setVendors(allVendors);

      // Create config map
      const configMap = new Map(allConfigs.map(config => [`${config.product_id}-${config.variant_id || ''}`, config]));

      // Map products with their configs
      const productWithConfigs: ProductWithConfig[] = products.map(product => {
        const configKey = `${product.id}-`;
        const config = configMap.get(configKey);

        return {
          productId: product.id,
          name: product.name,
          sku: product.sku,
          reorderPoint: config?.reorder_point,
          reorderQty: config?.reorder_qty,
          defaultVendorId: config?.default_vendor_id || undefined,
        };
      });

      setProductConfigs(productWithConfigs);
    } catch {
      Alert.alert('Error', 'Failed to load reorder point configurations');
    } finally {
      setLoading(false);
    }
  }, [products]);

  useEffect(() => {
    if (products.length > 0) {
      loadData();
    }
  }, [loadData, products.length]);

  const startEdit = (product: ProductWithConfig) => {
    setEditingProduct(product.productId);
    setEditValues({
      reorderPoint: product.reorderPoint?.toString() || '',
      reorderQty: product.reorderQty?.toString() || '',
      vendorId: product.defaultVendorId || '',
    });
  };

  const cancelEdit = () => {
    setEditingProduct(null);
    setEditValues({ reorderPoint: '', reorderQty: '', vendorId: '' });
  };

  const saveConfig = async (productId: string) => {
    const reorderPoint = parseInt(editValues.reorderPoint, 10);
    const reorderQty = parseInt(editValues.reorderQty, 10);

    if (isNaN(reorderPoint) || reorderPoint < 0) {
      Alert.alert('Validation Error', 'Please enter a valid reorder point (0 or greater)');
      return;
    }

    if (isNaN(reorderQty) || reorderQty < 1) {
      Alert.alert('Validation Error', 'Please enter a valid reorder quantity (1 or greater)');
      return;
    }

    setSaving(true);
    try {
      await procurementService.setReorderPoint(
        productId,
        null, // variantId - for now we only support product-level configs
        reorderPoint,
        reorderQty,
        editValues.vendorId || null
      );

      // Update local state
      setProductConfigs(prev =>
        prev.map(p =>
          p.productId === productId
            ? {
                ...p,
                reorderPoint,
                reorderQty,
                defaultVendorId: editValues.vendorId || undefined,
              }
            : p
        )
      );

      setEditingProduct(null);
      Alert.alert('Success', 'Reorder point configuration saved');
    } catch {
      Alert.alert('Error', 'Failed to save reorder point configuration');
    } finally {
      setSaving(false);
    }
  };

  const renderProduct = ({ item }: { item: ProductWithConfig }) => {
    const isEditing = editingProduct === item.productId;
    const vendor = vendors.find(v => v.id === item.defaultVendorId);

    return (
      <View style={styles.productCard}>
        <View style={styles.productHeader}>
          <View style={styles.productInfo}>
            <Text style={styles.productName}>{item.name}</Text>
            {item.sku && <Text style={styles.productSku}>SKU: {item.sku}</Text>}
          </View>
          {!isEditing && (
            <TouchableOpacity onPress={() => startEdit(item)} style={styles.editButton}>
              <MaterialIcons name="edit" size={20} color={lightColors.primary} />
            </TouchableOpacity>
          )}
        </View>

        {isEditing ? (
          <View style={styles.editForm}>
            <View style={styles.formRow}>
              <Text style={styles.label}>Reorder Point *</Text>
              <TextInput
                style={styles.input}
                value={editValues.reorderPoint}
                onChangeText={val => setEditValues(prev => ({ ...prev, reorderPoint: val }))}
                keyboardType="number-pad"
                placeholder="e.g., 10"
                placeholderTextColor={lightColors.textHint}
              />
            </View>

            <View style={styles.formRow}>
              <Text style={styles.label}>Reorder Quantity *</Text>
              <TextInput
                style={styles.input}
                value={editValues.reorderQty}
                onChangeText={val => setEditValues(prev => ({ ...prev, reorderQty: val }))}
                keyboardType="number-pad"
                placeholder="e.g., 50"
                placeholderTextColor={lightColors.textHint}
              />
            </View>

            <View style={styles.formRow}>
              <Text style={styles.label}>Default Vendor</Text>
              <TouchableOpacity
                style={styles.vendorPicker}
                onPress={() => {
                  Alert.alert('Select Vendor', 'Choose a default vendor for this product', [
                    { text: 'None', onPress: () => setEditValues(prev => ({ ...prev, vendorId: '' })) },
                    ...vendors.map(vendor => ({
                      text: vendor.name,
                      onPress: () => setEditValues(prev => ({ ...prev, vendorId: vendor.id })),
                    })),
                    { text: 'Cancel', style: 'cancel' },
                  ]);
                }}
              >
                <Text style={editValues.vendorId ? styles.vendorText : styles.vendorPlaceholder}>
                  {editValues.vendorId
                    ? vendors.find(v => v.id === editValues.vendorId)?.name || 'Unknown Vendor'
                    : 'Select vendor (optional)'}
                </Text>
                <MaterialIcons name="arrow-drop-down" size={24} color={lightColors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.formActions}>
              <Button title="Save" variant="success" onPress={() => saveConfig(item.productId)} loading={saving} disabled={saving} />
              <Button title="Cancel" variant="ghost" onPress={cancelEdit} disabled={saving} />
            </View>
          </View>
        ) : (
          <View style={styles.configDisplay}>
            {item.reorderPoint !== undefined ? (
              <>
                <Text style={styles.configText}>
                  Reorder at: <Text style={styles.configValue}>{item.reorderPoint}</Text>
                </Text>
                <Text style={styles.configText}>
                  Reorder qty: <Text style={styles.configValue}>{item.reorderQty}</Text>
                </Text>
                {vendor && (
                  <Text style={styles.configText}>
                    Vendor: <Text style={styles.configValue}>{vendor.name}</Text>
                  </Text>
                )}
              </>
            ) : (
              <Text style={styles.noConfigText}>No reorder point configured</Text>
            )}
          </View>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={lightColors.primary} />
        <Text style={styles.loadingText}>Loading configurations...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Reorder Point Configuration</Text>
        <Text style={styles.subtitle}>Set automatic reorder points for products</Text>
      </View>

      <FlatList
        data={productConfigs}
        keyExtractor={item => item.productId}
        renderItem={renderProduct}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialIcons name="inventory" size={64} color={lightColors.textHint} />
            <Text style={styles.emptyText}>No products found</Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: lightColors.background,
  },
  header: {
    padding: spacing.md,
    backgroundColor: lightColors.surface,
    borderBottomWidth: 1,
    borderBottomColor: lightColors.border,
  },
  title: {
    fontSize: typography.fontSize.xl,
    fontWeight: '700',
    color: lightColors.textPrimary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: typography.fontSize.sm,
    color: lightColors.textSecondary,
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
  productCard: {
    backgroundColor: lightColors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...elevation.low,
  },
  productHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    fontSize: typography.fontSize.md,
    fontWeight: '600',
    color: lightColors.textPrimary,
    marginBottom: spacing.xs,
  },
  productSku: {
    fontSize: typography.fontSize.sm,
    color: lightColors.textSecondary,
  },
  editButton: {
    padding: spacing.xs,
  },
  configDisplay: {
    gap: spacing.xs,
  },
  configText: {
    fontSize: typography.fontSize.sm,
    color: lightColors.textSecondary,
  },
  configValue: {
    fontWeight: '600',
    color: lightColors.textPrimary,
  },
  noConfigText: {
    fontSize: typography.fontSize.sm,
    color: lightColors.textHint,
    fontStyle: 'italic',
  },
  editForm: {
    gap: spacing.md,
  },
  formRow: {
    gap: spacing.xs,
  },
  label: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600',
    color: lightColors.textPrimary,
  },
  input: {
    borderWidth: 1,
    borderColor: lightColors.border,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    fontSize: typography.fontSize.md,
    color: lightColors.textPrimary,
    backgroundColor: lightColors.inputBackground,
  },
  vendorPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: lightColors.border,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    backgroundColor: lightColors.inputBackground,
  },
  vendorText: {
    fontSize: typography.fontSize.md,
    color: lightColors.textPrimary,
  },
  vendorPlaceholder: {
    fontSize: typography.fontSize.md,
    color: lightColors.textHint,
  },
  formActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyText: {
    fontSize: typography.fontSize.md,
    color: lightColors.textSecondary,
    marginTop: spacing.md,
  },
});

export default ReorderPointConfigScreen;
