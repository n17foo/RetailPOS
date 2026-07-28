import React, { useRef, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity, Dimensions, PanResponder } from 'react-native';
import { lightColors, spacing, typography, elevation } from '../utils/theme';

const { width } = Dimensions.get('window');
const PANEL_WIDTH = width * 0.8; // Panel takes 80% of screen width

interface SwipeablePanelProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  backgroundColor?: string;
  position?: 'left' | 'right';
}

export const SwipeablePanel: React.FC<SwipeablePanelProps> = ({
  isOpen,
  onClose,
  children,
  title = 'Panel Title',
  backgroundColor = '#ffffff',
  position = 'left',
}) => {
  // Set up animation values with correct initial positions
  // Left panel starts off-screen to the left (-PANEL_WIDTH)
  // Right panel starts off-screen to the right (width)
  const leftPos = useRef(new Animated.Value(position === 'left' ? -PANEL_WIDTH : width)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  // Show panel animation
  const showPanel = useCallback(() => {
    Animated.parallel([
      Animated.timing(leftPos, {
        toValue: position === 'left' ? 0 : width - PANEL_WIDTH,
        duration: 300,
        useNativeDriver: false, // Using JS driver for consistency
      }),
      Animated.timing(overlayOpacity, {
        toValue: 0.5,
        duration: 300,
        useNativeDriver: false, // Using JS driver for consistency
      }),
    ]).start();
  }, [position, leftPos, overlayOpacity]);

  // Hide panel animation
  const hidePanel = useCallback(() => {
    Animated.parallel([
      Animated.timing(leftPos, {
        toValue: position === 'left' ? -PANEL_WIDTH : width,
        duration: 300,
        useNativeDriver: false, // Using JS driver for consistency
      }),
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: false, // Using JS driver for consistency
      }),
    ]).start(() => {
      if (onClose) onClose();
    });
  }, [position, leftPos, overlayOpacity, onClose]);

  // Swipe gesture handler
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 20;
      },
      onPanResponderMove: (_, gestureState) => {
        // Only allow swipe in closing direction
        if ((position === 'left' && gestureState.dx < 0) || (position === 'right' && gestureState.dx > 0)) {
          // Get current position first
          let newPosition;
          if (position === 'left') {
            newPosition = gestureState.dx; // Slide from left edge
          } else {
            newPosition = width - PANEL_WIDTH + gestureState.dx; // Slide from right edge
          }
          leftPos.setValue(newPosition);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        const swipeThreshold = 50;

        // Close if swiped far enough in closing direction
        if ((position === 'left' && gestureState.dx < -swipeThreshold) || (position === 'right' && gestureState.dx > swipeThreshold)) {
          hidePanel();
        } else {
          // Otherwise snap back to open position
          showPanel();
        }
      },
    })
  ).current;

  // Update when isOpen changes
  useEffect(() => {
    if (isOpen) {
      showPanel();
    } else {
      hidePanel();
    }
  }, [isOpen, showPanel, hidePanel]);

  // Always render to ensure animations work properly
  // The overlay opacity will keep the component hidden when closed

  return (
    <>
      {/* Backdrop overlay */}
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]} onTouchEnd={hidePanel} />

      {/* Panel */}
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.panel,
          {
            backgroundColor,
            transform: [{ translateX: leftPos }],
          },
        ]}
      >
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>{title}</Text>
          <TouchableOpacity onPress={hidePanel} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>×</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.panelContent}>{children}</View>
      </Animated.View>
    </>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: lightColors.textPrimary,
    zIndex: 10,
  },
  panel: {
    position: 'absolute',
    height: '100%', // Full height of the screen
    width: PANEL_WIDTH,
    top: 0,
    bottom: 0,
    left: 0, // All panels start at left for proper transform
    zIndex: 11,
    ...elevation.medium,
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: lightColors.border,
  },
  panelTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: '700', // Using literal value as React Native expects specific string literals
  },
  closeButton: {
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: typography.fontSize.xl,
    fontWeight: '700', // Using literal value as React Native expects specific string literals
  },
  panelContent: {
    flex: 1,
    padding: spacing.md,
  },
});
