import React, { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator } from 'react-native';
import { CameraView } from 'expo-camera';
import { useProductsForDisplay } from '../hooks/useProducts';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { useScanner } from '../hooks/useScanner';
import { isElectron } from '../utils/electron';
import { lightColors, spacing, borderRadius, typography, elevation } from '../utils/theme';

interface BarcodeScannerScreenProps {
  onScanSuccess: (productId: string) => void;
  onClose: () => void;
}

export const BarcodeScannerScreen: React.FC<BarcodeScannerScreenProps> = ({ onScanSuccess, onClose }) => {
  // Load scanner settings from persistent storage (set during onboarding / Settings)
  // On Electron desktop, default to 'usb' since camera is not available
  const { scannerSettings: persistedSettings, isLoading: settingsLoading } = useScanner();
  const scannerSettings = useMemo(
    () => ({
      type: (isElectron() && persistedSettings.type === 'camera' ? 'usb' : persistedSettings.type) as
        'camera' | 'bluetooth' | 'usb' | 'qr_hardware',
      enabled: persistedSettings.enabled,
      deviceId: persistedSettings.deviceId || (persistedSettings.type === 'camera' ? 'back' : ''),
    }),
    [persistedSettings.type, persistedSettings.enabled, persistedSettings.deviceId]
  );

  // Get products from the unified product service
  const { products } = useProductsForDisplay();

  // Use our custom hook for barcode scanner functionality
  const { hasPermission, scanned, connected, connecting, scanResult, connectScanner, disconnectScanner, handleBarCodeScanned } =
    useBarcodeScanner({
      scannerSettings,
      products,
      onScanSuccess,
    });

  // Set up scanner when component mounts
  useEffect(() => {
    if (scannerSettings.enabled) {
      connectScanner();
    }

    // Cleanup function to disconnect scanner when component unmounts
    return () => {
      disconnectScanner();
    };
  }, [connectScanner, disconnectScanner, scannerSettings.enabled]);

  // Wait for persistent scanner settings to load before rendering
  if (settingsLoading) {
    return (
      <View style={styles.permissionContainer}>
        <ActivityIndicator size="large" color={lightColors.primary} />
      </View>
    );
  }

  // Handle permission denied
  if (hasPermission === false) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.externalScannerTitle}>Camera Permission Required</Text>
        <Text style={styles.externalScannerText}>Please grant camera permission to use the barcode scanner.</Text>
        <TouchableOpacity style={[styles.button, styles.reconnectButton]} onPress={connectScanner}>
          <Text style={styles.buttonText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Show loading indicator while connecting
  if (connecting) {
    return (
      <View style={styles.permissionContainer}>
        <ActivityIndicator size="large" color="#2196F3" />
        <Text style={styles.externalScannerText}>Connecting to {scannerSettings.type} scanner...</Text>
      </View>
    );
  }

  // Inline scan result banner (shown over both camera and external scanner views)
  const renderScanResultBanner = () => {
    if (!scanResult) return null;
    const bannerStyle =
      scanResult.status === 'not_found'
        ? styles.bannerError
        : scanResult.status === 'searching'
          ? styles.bannerSearching
          : styles.bannerSuccess;
    const label =
      scanResult.status === 'searching'
        ? 'Searching...'
        : scanResult.status === 'not_found'
          ? 'Product not found'
          : scanResult.status === 'found_online'
            ? `\u2713 Online: ${scanResult.name}`
            : `\u2713 Added: ${scanResult.name}`;
    return (
      <View style={[styles.scanResultBanner, bannerStyle]}>
        <Text style={styles.scanResultText} numberOfLines={1}>
          {label}
        </Text>
      </View>
    );
  };

  // External scanner view (USB, Bluetooth, QR Hardware)
  if (scannerSettings.type !== 'camera') {
    return (
      <View style={styles.externalScannerContainer}>
        <View style={styles.externalScannerContent}>
          {connected ? (
            <>
              <Text style={styles.externalScannerTitle}>{scannerSettings.type.toUpperCase()} Scanner Ready</Text>
              <Text style={styles.externalScannerText}>Point scanner at a product barcode</Text>
            </>
          ) : (
            <>
              <Text style={styles.externalScannerTitle}>Scanner Not Connected</Text>
              <Text style={styles.externalScannerText}>Unable to connect to {scannerSettings.type} scanner.</Text>
              <TouchableOpacity style={[styles.button, styles.reconnectButton]} onPress={connectScanner}>
                <Text style={styles.buttonText}>Reconnect</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {renderScanResultBanner()}

        <View style={styles.footer}>
          <TouchableOpacity style={styles.button} onPress={onClose}>
            <Text style={styles.buttonText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Camera scanner view (default)
  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        barcodeScannerSettings={{
          barcodeTypes: ['ean13', 'ean8', 'code128', 'code39', 'upc_e', 'upc_a', 'qr', 'aztec', 'datamatrix', 'pdf417'],
        }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
      />

      <View style={styles.overlay}>
        <View style={styles.scanArea} />
        <Text style={styles.scanText}>Align barcode within the frame</Text>
      </View>

      {renderScanResultBanner()}

      <View style={styles.footer}>
        <TouchableOpacity style={styles.button} onPress={onClose}>
          <Text style={styles.buttonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: spacing.lg,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    backgroundColor: lightColors.overlay,
  },
  scanArea: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: lightColors.primary,
    backgroundColor: lightColors.transparent,
    marginBottom: spacing.lg,
  },
  scanText: {
    color: lightColors.textOnPrimary,
    fontSize: typography.fontSize.sm,
    textAlign: 'center' as const,
    marginTop: spacing.sm,
  },
  footer: {
    position: 'absolute',
    bottom: spacing.xl,
    left: 0,
    right: 0,
    flexDirection: 'row' as const,
    justifyContent: 'space-around' as const,
    paddingHorizontal: spacing.lg,
  },
  button: {
    backgroundColor: lightColors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.md,
    alignItems: 'center' as const,
    ...elevation.medium,
  },
  reconnectButton: {
    backgroundColor: lightColors.success,
    marginTop: spacing.lg,
  },
  buttonText: {
    color: lightColors.textOnPrimary,
    fontSize: typography.fontSize.md,
    fontWeight: typography.fontWeight.bold as 'bold',
  },
  externalScannerContainer: {
    flex: 1,
    backgroundColor: lightColors.background,
  },
  externalScannerContent: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: spacing.lg,
  },
  externalScannerTitle: {
    fontSize: typography.fontSize.xxl,
    fontWeight: typography.fontWeight.bold as 'bold',
    marginBottom: spacing.lg,
    textAlign: 'center' as const,
    color: lightColors.textPrimary,
  },
  externalScannerText: {
    fontSize: typography.fontSize.md,
    textAlign: 'center' as const,
    marginBottom: spacing.xl,
    color: lightColors.textSecondary,
  },
  scanResultBanner: {
    position: 'absolute' as const,
    bottom: 90,
    left: spacing.lg,
    right: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center' as const,
    ...elevation.high,
  },
  bannerSuccess: {
    backgroundColor: lightColors.success,
  },
  bannerError: {
    backgroundColor: lightColors.error,
  },
  bannerSearching: {
    backgroundColor: lightColors.primary,
  },
  scanResultText: {
    color: lightColors.textOnPrimary,
    fontSize: typography.fontSize.md,
    fontWeight: typography.fontWeight.bold as 'bold',
  },
});
