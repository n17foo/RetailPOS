import React from 'react';
import { View, Text, TouchableOpacity, Image, ImageSourcePropType, StyleSheet } from 'react-native';
import { SearchProduct } from '../../services/search/SearchServiceInterface';
import { lightColors, spacing, typography, borderRadius, elevation } from '../../utils/theme';
import { formatMoney } from '../../utils/money';
import { useCurrency } from '../../hooks/useCurrency';

interface ProductResultItemProps {
  product: SearchProduct;
  onSelect: (product: SearchProduct) => void;
}

export const ProductResultItem: React.FC<ProductResultItemProps> = ({ product, onSelect }) => {
  const currency = useCurrency();
  let imageSource: ImageSourcePropType | undefined;
  if (product.imageUrl) {
    imageSource = { uri: product.imageUrl };
  }

  return (
    <TouchableOpacity style={styles.productItem} onPress={() => onSelect(product)}>
      {imageSource && <Image source={imageSource} style={styles.productImage} />}
      <View style={styles.productInfo}>
        <Text style={styles.productName}>{product.name}</Text>
        <Text style={styles.productDescription} numberOfLines={2}>
          {product.description || 'No description available'}
        </Text>
        <View style={styles.productMetaRow}>
          <Text style={styles.productPrice}>{formatMoney(product.price, currency.code)}</Text>
          <View style={styles.badgeContainer}>
            <View
              style={[
                styles.badge,
                { backgroundColor: product.source === 'local' ? lightColors.secondary + '40' : lightColors.primary + '40' },
              ]}
            >
              <Text style={styles.badgeText}>{product.source === 'local' ? 'Local' : 'Online'}</Text>
            </View>
            {!product.inStock && (
              <View style={[styles.badge, { backgroundColor: lightColors.error + '40' }]}>
                <Text style={styles.badgeText}>Out of Stock</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  productItem: {
    flexDirection: 'row' as 'row',
    backgroundColor: lightColors.surface,
    borderRadius: borderRadius.md,
    overflow: 'hidden' as 'hidden',
    marginBottom: spacing.sm,
    ...elevation.low,
  },
  productImage: {
    width: 80,
    height: 80,
    resizeMode: 'cover' as 'cover',
  },
  productInfo: {
    flex: 1,
    padding: spacing.sm,
  },
  productName: {
    fontSize: typography.fontSize.md,
    fontWeight: '600' as '600',
    color: lightColors.textPrimary,
    marginBottom: spacing.xs,
  },
  productDescription: {
    fontSize: typography.fontSize.sm,
    color: lightColors.textSecondary,
    marginBottom: spacing.xs,
  },
  productMetaRow: {
    flexDirection: 'row' as 'row',
    justifyContent: 'space-between' as 'space-between',
    alignItems: 'center' as 'center',
  },
  productPrice: {
    fontSize: typography.fontSize.md,
    fontWeight: '700' as '700',
    color: lightColors.primary,
  },
  badgeContainer: {
    flexDirection: 'row' as 'row',
  },
  badge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs / 2,
    borderRadius: borderRadius.sm,
    marginLeft: spacing.xs,
    justifyContent: 'center' as 'center',
    alignItems: 'center' as 'center',
  },
  badgeText: {
    fontSize: typography.fontSize.xs,
    fontWeight: '600' as '600',
  },
});

export default ProductResultItem;
