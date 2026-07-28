import React, { useState, useEffect, memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ImageSourcePropType, DimensionValue } from 'react-native';
import { lightColors, spacing, borderRadius, typography, elevation } from '../../utils/theme';
import { formatMoney } from '../../utils/money';
import { useCurrency } from '../../hooks/useCurrency';
import { OptimizedImage } from '../../components/OptimizedImage';

interface ProductCardProps {
  id: string;
  name: string;
  price: number;
  image: ImageSourcePropType | null;
  onAddToCart: (id: string, quantity: number) => void;
  inBasket?: boolean;
  initialQuantity?: number;
  stock?: number;
  widthPercent?: number;
}

const ProductCardInner: React.FC<ProductCardProps> = ({
  id,
  name,
  price: priceProp,
  image,
  onAddToCart,
  inBasket = false,
  initialQuantity = 0,
  stock,
  widthPercent,
}) => {
  const currency = useCurrency();
  const [quantity, setQuantity] = useState(initialQuantity);

  useEffect(() => {
    setQuantity(initialQuantity);
  }, [initialQuantity]);

  const handleCardPress = () => {
    const newQuantity = quantity + 1;
    setQuantity(newQuantity);
    onAddToCart(id, newQuantity);
  };

  const handleIncrement = (e: { stopPropagation?: () => void }) => {
    e.stopPropagation?.();
    const newQuantity = quantity + 1;
    setQuantity(newQuantity);
    onAddToCart(id, newQuantity);
  };

  const handleDecrement = (e: { stopPropagation?: () => void }) => {
    e.stopPropagation?.();
    if (quantity > 0) {
      const newQuantity = quantity - 1;
      setQuantity(newQuantity);
      onAddToCart(id, newQuantity);
    }
  };

  const isInBasket = inBasket || quantity > 0;
  const isOutOfStock = stock !== undefined && stock <= 0;
  const isLowStock = stock !== undefined && stock > 0 && stock <= 5;

  const cardWidth: DimensionValue = widthPercent ? (`${widthPercent}%` as DimensionValue) : '47%';

  return (
    <TouchableOpacity
      style={[styles.card, { width: cardWidth }, isInBasket && styles.cardInCart, isOutOfStock && styles.cardOutOfStock]}
      onPress={handleCardPress}
      activeOpacity={0.75}
      disabled={isOutOfStock}
      accessibilityLabel={`${name}, ${formatMoney(priceProp, currency.code)}${isOutOfStock ? ', out of stock' : ''}`}
      accessibilityRole="button"
      accessibilityState={{ disabled: isOutOfStock }}
    >
      <View style={styles.imageContainer}>
        <OptimizedImage source={image} style={styles.image} resizeMode="cover" priority="normal" />

        {/* Quantity badge — top-right corner */}
        {isInBasket && (
          <View style={styles.quantityBadge}>
            <Text style={styles.quantityBadgeText}>{quantity}</Text>
          </View>
        )}

        {/* Stock indicators */}
        {isOutOfStock && (
          <View style={styles.outOfStockOverlay}>
            <Text style={styles.outOfStockText}>Out of Stock</Text>
          </View>
        )}
        {isLowStock && !isOutOfStock && (
          <View style={styles.lowStockBadge}>
            <Text style={styles.lowStockText}>{stock} left</Text>
          </View>
        )}
      </View>

      <View style={styles.infoContainer}>
        <Text style={styles.name} numberOfLines={2} ellipsizeMode="tail">
          {name}
        </Text>
        <Text style={styles.price}>{formatMoney(priceProp, currency.code)}</Text>
      </View>

      {/* Quantity controls — always below info, never overlapping */}
      {isInBasket && (
        <View style={styles.quantityBar}>
          <TouchableOpacity
            style={styles.quantityButton}
            onPress={handleDecrement}
            activeOpacity={0.8}
            accessibilityLabel={`Decrease quantity of ${name}`}
            accessibilityRole="button"
          >
            <Text style={styles.quantityButtonText}>−</Text>
          </TouchableOpacity>
          <Text style={styles.quantityCount}>{quantity}</Text>
          <TouchableOpacity
            style={styles.quantityButton}
            onPress={handleIncrement}
            activeOpacity={0.8}
            accessibilityLabel={`Increase quantity of ${name}`}
            accessibilityRole="button"
          >
            <Text style={styles.quantityButtonText}>+</Text>
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
};

export const ProductCard = memo(ProductCardInner);

const styles = StyleSheet.create({
  card: {
    backgroundColor: lightColors.surface,
    borderRadius: borderRadius.md,
    flex: 1,
    margin: spacing.xs,
    ...elevation.medium,
    overflow: 'hidden',
  },
  cardInCart: {
    borderWidth: 2,
    borderColor: lightColors.primary,
  },
  cardOutOfStock: {
    opacity: 0.55,
  },
  imageContainer: {
    width: '100%',
    height: 130,
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  quantityBadge: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    backgroundColor: lightColors.primary,
    borderRadius: borderRadius.round,
    minWidth: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  quantityBadgeText: {
    color: lightColors.textOnPrimary,
    fontSize: typography.fontSize.sm,
    fontWeight: '700',
  },
  outOfStockOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: lightColors.overlayLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outOfStockText: {
    color: lightColors.textOnPrimary,
    fontSize: typography.fontSize.sm,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  lowStockBadge: {
    position: 'absolute',
    bottom: spacing.xs,
    left: spacing.xs,
    backgroundColor: lightColors.warning,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  lowStockText: {
    fontSize: 10,
    fontWeight: '700',
    color: lightColors.textPrimary,
  },
  infoContainer: {
    padding: spacing.sm,
    paddingBottom: spacing.xs,
    alignItems: 'center',
  },
  name: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: spacing.xs,
    color: lightColors.textPrimary,
    minHeight: 34,
  },
  price: {
    fontSize: typography.fontSize.md,
    fontWeight: '700',
    color: lightColors.primary,
  },
  /* Quantity controls — a dedicated bar below the info section */
  quantityBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: lightColors.primary + '12',
    borderTopWidth: 1,
    borderTopColor: lightColors.primary + '30',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  quantityButton: {
    backgroundColor: lightColors.primary,
    width: 34,
    height: 34,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityButtonText: {
    fontSize: typography.fontSize.lg,
    fontWeight: '700',
    color: lightColors.textOnPrimary,
    lineHeight: 22,
  },
  quantityCount: {
    fontSize: typography.fontSize.md,
    fontWeight: '700',
    color: lightColors.primary,
    minWidth: 28,
    textAlign: 'center',
  },
});
