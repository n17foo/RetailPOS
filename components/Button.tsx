import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle, TextStyle, TouchableOpacityProps } from 'react-native';
import { lightColors, spacing, borderRadius, typography, elevation } from '../utils/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'success' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends TouchableOpacityProps {
  /** Button text content */
  title: string;
  /** Visual style variant */
  variant?: ButtonVariant;
  /** Button size */
  size?: ButtonSize;
  /** Show loading spinner */
  loading?: boolean;
  /** Disabled state */
  disabled?: boolean;
  /** Full width button */
  fullWidth?: boolean;
  /** Left icon component */
  leftIcon?: React.ReactNode;
  /** Right icon component */
  rightIcon?: React.ReactNode;
  /** Custom button style */
  style?: ViewStyle;
  /** Custom text style */
  textStyle?: TextStyle;
}

/**
 * Reusable Button component with multiple variants and sizes
 */
export const Button: React.FC<ButtonProps> = ({
  title,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  leftIcon,
  rightIcon,
  style,
  textStyle,
  onPress,
  ...rest
}) => {
  const isDisabled = disabled || loading;

  const getBackgroundColor = (): string => {
    if (isDisabled) return lightColors.textDisabled;

    switch (variant) {
      case 'primary':
        return lightColors.primary;
      case 'secondary':
        return lightColors.secondary;
      case 'danger':
        return lightColors.error;
      case 'success':
        return lightColors.success;
      case 'outline':
      case 'ghost':
        return 'transparent';
      default:
        return lightColors.primary;
    }
  };

  const getTextColor = (): string => {
    if (isDisabled && variant !== 'outline' && variant !== 'ghost') {
      return lightColors.textOnPrimary;
    }

    switch (variant) {
      case 'outline':
        return isDisabled ? lightColors.textDisabled : lightColors.primary;
      case 'ghost':
        return isDisabled ? lightColors.textDisabled : lightColors.textPrimary;
      case 'primary':
      case 'secondary':
      case 'danger':
      case 'success':
        return lightColors.textOnPrimary;
      default:
        return lightColors.textOnPrimary;
    }
  };

  const getBorderColor = (): string | undefined => {
    if (variant === 'outline') {
      return isDisabled ? lightColors.textDisabled : lightColors.primary;
    }
    return undefined;
  };

  const getPadding = (): { paddingVertical: number; paddingHorizontal: number } => {
    switch (size) {
      case 'sm':
        return { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm };
      case 'lg':
        return { paddingVertical: spacing.md, paddingHorizontal: spacing.xl };
      case 'md':
      default:
        return { paddingVertical: spacing.sm, paddingHorizontal: spacing.md };
    }
  };

  const getFontSize = (): number => {
    switch (size) {
      case 'sm':
        return typography.fontSize.sm;
      case 'lg':
        return typography.fontSize.lg;
      case 'md':
      default:
        return typography.fontSize.md;
    }
  };

  const buttonStyles: ViewStyle[] = [
    styles.button,
    {
      backgroundColor: getBackgroundColor(),
      borderColor: getBorderColor(),
      borderWidth: variant === 'outline' ? 1 : 0,
      ...getPadding(),
    },
    fullWidth ? styles.fullWidth : {},
    variant !== 'ghost' && variant !== 'outline' ? elevation.low : {},
    style || {},
  ];

  const textStyles: TextStyle[] = [
    styles.text,
    {
      color: getTextColor(),
      fontSize: getFontSize(),
    },
    textStyle || {},
  ];

  return (
    <TouchableOpacity style={buttonStyles} onPress={onPress} disabled={isDisabled} activeOpacity={0.7} {...rest}>
      {loading ? (
        <ActivityIndicator size="small" color={getTextColor()} />
      ) : (
        <>
          {leftIcon && <>{leftIcon}</>}
          <Text style={textStyles}>{title}</Text>
          {rightIcon && <>{rightIcon}</>}
        </>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.md,
    gap: spacing.xs,
  },
  fullWidth: {
    width: '100%',
  },
  text: {
    fontWeight: '600',
    textAlign: 'center',
  },
});

export default Button;
