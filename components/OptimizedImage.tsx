import React from 'react';
import { Image as ExpoImage, ImageSource, ImageContentFit } from 'expo-image';
import { StyleProp, ImageStyle, ImageSourcePropType } from 'react-native';

interface OptimizedImageProps {
  source: ImageSourcePropType | null;
  priority?: 'low' | 'normal' | 'high';
  resizeMode?: 'contain' | 'cover' | 'stretch' | 'center';
  style?: StyleProp<ImageStyle>;
  testID?: string;
  accessible?: boolean;
  accessibilityLabel?: string;
}

const RESIZE_MODE_MAP: Record<string, ImageContentFit> = {
  contain: 'contain',
  cover: 'cover',
  stretch: 'fill',
  center: 'scale-down',
};

/**
 * OptimizedImage — thin wrapper over expo-image.
 *
 * expo-image is the Expo-maintained, New Architecture compatible replacement
 * for react-native-fast-image. It handles both local and remote sources,
 * supports priority loading, and provides disk + memory caching.
 */
export const OptimizedImage: React.FC<OptimizedImageProps> = ({
  source,
  priority = 'normal',
  resizeMode = 'contain',
  style,
  testID,
  accessible,
  accessibilityLabel,
}) => (
  <ExpoImage
    source={source as ImageSource}
    priority={priority}
    contentFit={RESIZE_MODE_MAP[resizeMode] ?? 'contain'}
    style={style}
    testID={testID}
    accessible={accessible}
    accessibilityLabel={accessibilityLabel}
  />
);

/**
 * Preload images for better UX.
 * Call this for images that will be shown soon (e.g., next screen).
 */
export const preloadImages = (urls: string[]): void => {
  ExpoImage.prefetch(urls);
};

/**
 * Clear image cache (useful for logout or memory management).
 */
export const clearImageCache = async (): Promise<void> => {
  await ExpoImage.clearMemoryCache();
  await ExpoImage.clearDiskCache();
};
