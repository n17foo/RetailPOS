import { useState, useRef, useEffect, useCallback } from 'react';
import { Alert } from 'react-native';
import { type BarcodeScanningResult } from 'expo-camera';
import { ScannerType, ScannerServiceFactory } from '../services/scanner/ScannerServiceFactory';
import { ScannerServiceInterface } from '../services/scanner/ScannerServiceInterface';
import { SearchServiceFactory } from '../services/search/SearchServiceFactory';
import { productVariantRepository } from '../repositories/ProductVariantRepository';
import { useLogger } from './useLogger';

interface ScannerSettings {
  type: 'camera' | 'bluetooth' | 'usb' | 'qr_hardware';
  deviceId?: string;
}

// Import type locally to avoid circular dependencies
interface Product {
  id: string;
  name: string;
  price: number;
  barcode?: string;
}

interface UseBarcodeScannerServiceProps {
  scannerSettings: ScannerSettings;
  products: Product[];
  onScanSuccess: (productId: string) => void;
}

export interface ScanResult {
  status: 'found_local' | 'found_variant' | 'found_online' | 'not_found' | 'searching';
  name?: string;
  price?: number;
}

export const useBarcodeScanner = ({ scannerSettings, products, onScanSuccess }: UseBarcodeScannerServiceProps) => {
  const logger = useLogger('useBarcodeScanner');
  const { type: settingsType, deviceId: settingsDeviceId } = scannerSettings;
  // Scanner state
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  // Refs to avoid stale closures and manage scanner service lifecycle
  const scannerServiceRef = useRef<ScannerServiceInterface | null>(null);
  const scanListenerRef = useRef<string | null>(null);
  const scanCallbackRef = useRef<((data: string) => void) | null>(null);
  // Ref mirror of `scanned` so the external scanner callback always reads the latest value
  const scannedRef = useRef(false);

  // Get scanner factory instance
  const scannerFactory = ScannerServiceFactory.getInstance();

  /**
   * Safely execute scanner operations with error handling
   */
  const executeScannerOperation = useCallback(
    async (operation: string, action: () => Promise<void>) => {
      try {
        await action();
      } catch (error) {
        logger.error({ message: `Error ${operation}` }, error instanceof Error ? error : new Error(String(error)));
      }
    },
    [logger]
  );

  /**
   * Display scanner-related alerts
   */
  const showScannerAlert = useCallback((title: string, message: string, actions: Array<{ text: string; onPress: () => void }> = []) => {
    const defaultActions = actions.length > 0 ? actions : [{ text: 'OK', onPress: () => {} }];
    Alert.alert(title, message, defaultActions);
  }, []);

  // Disconnect the scanner
  const disconnectScanner = useCallback(async () => {
    await executeScannerOperation('disconnecting scanner', async () => {
      // Stop the scan listener if active
      if (scanListenerRef.current && scannerServiceRef.current) {
        scannerServiceRef.current.stopScanListener(scanListenerRef.current);
        scanListenerRef.current = null;
      }

      // Disconnect the scanner
      if (scannerServiceRef.current) {
        await scannerServiceRef.current.disconnect();
        scannerServiceRef.current = null;
      }

      setConnected(false);
    });
  }, [executeScannerOperation]);

  // Process barcode data from any scanner type
  // UX design: auto-add immediately on any unambiguous local match (no dialog friction).
  // Only show Alert for 'not found' (so cashier knows to check the item).
  // Online results call onScanSuccess directly — OrderScreen will auto-add when navigated.
  const processBarcodeData = useCallback(
    async (data: string) => {
      setScanResult({ status: 'searching' });

      // 1. Exact match in loaded products list (id, barcode, or SKU) — instant, no dialog
      const product = products.find(p => p.id === data || p.barcode === data || (p as unknown as { sku?: string }).sku === data);
      if (product) {
        setScanResult({ status: 'found_local', name: product.name, price: product.price });
        onScanSuccess(product.id);
        setTimeout(() => {
          scannedRef.current = false;
          setScanned(false);
          setScanResult(null);
        }, 1500);
        return;
      }

      // 2. Variant DB lookup (non-default variants not in the products array) — auto-add
      try {
        const variant = (await productVariantRepository.findByBarcode(data)) || (await productVariantRepository.findBySku(data));
        if (variant) {
          const parentProduct = products.find(p => p.id === variant.product_id);
          const displayName = parentProduct ? `${parentProduct.name} — ${variant.title}` : variant.title;
          setScanResult({ status: 'found_variant', name: displayName, price: variant.price });
          onScanSuccess(variant.product_id);
          setTimeout(() => {
            scannedRef.current = false;
            setScanned(false);
            setScanResult(null);
          }, 1500);
          return;
        }
      } catch (error) {
        logger.error({ message: 'Variant barcode lookup failed' }, error instanceof Error ? error : new Error(String(error)));
      }

      // 3. Online platform search via dedicated barcode endpoint
      try {
        const searchService = SearchServiceFactory.getInstance().getService();
        if (searchService.isInitialized()) {
          const result = await searchService.searchByBarcode(data);
          const onlineProduct = result.ecommerceResults[0];
          if (onlineProduct) {
            setScanResult({ status: 'found_online', name: onlineProduct.name, price: onlineProduct.price });
            onScanSuccess(onlineProduct.id);
            setTimeout(() => {
              scannedRef.current = false;
              setScanned(false);
              setScanResult(null);
            }, 1500);
            return;
          }
        }
      } catch (error) {
        logger.error({ message: 'Online barcode search failed' }, error instanceof Error ? error : new Error(String(error)));
      }

      // 4. Not found anywhere — brief alert so cashier knows to check the item manually
      setScanResult({ status: 'not_found' });
      showScannerAlert('Product Not Found', `No product found for barcode: ${data}`, [
        {
          text: 'Scan Again',
          onPress: () => {
            scannedRef.current = false;
            setScanned(false);
            setScanResult(null);
          },
        },
      ]);
    },
    [products, onScanSuccess, showScannerAlert, logger]
  );

  // Connect to scanner
  const connectScanner = useCallback(async () => {
    setConnecting(true);

    try {
      // First disconnect any existing scanner
      await disconnectScanner();

      // Create the scan callback and save it in a ref to avoid stale closures
      const scanCallback = (data: string) => {
        if (scannedRef.current) return;
        scannedRef.current = true;
        setScanned(true);
        processBarcodeData(data);
      };
      scanCallbackRef.current = scanCallback;

      await executeScannerOperation('initializing scanner', async () => {
        // Get the appropriate scanner type
        let scannerType: ScannerType;
        switch (settingsType) {
          case 'camera':
            scannerType = ScannerType.CAMERA;
            break;
          case 'bluetooth':
            scannerType = ScannerType.BLUETOOTH;
            break;
          case 'qr_hardware':
            scannerType = ScannerType.QR_HARDWARE;
            break;
          default:
            scannerType = ScannerType.USB;
            break;
        }

        // Get the scanner service from the factory
        const scannerService = scannerFactory.getService(scannerType);
        if (!scannerService) {
          showScannerAlert('Error', `Failed to initialize ${settingsType} scanner.`);
          throw new Error(`Failed to get scanner service for type: ${settingsType}`);
        }

        // Store the scanner service
        scannerServiceRef.current = scannerService;

        // Connect to the scanner
        const deviceId = settingsType === 'camera' ? 'back' : settingsDeviceId;
        const isConnected = await scannerService.connect(deviceId || '');
        setConnected(isConnected);

        if (!isConnected) {
          showScannerAlert('Connection Failed', `Unable to connect to ${settingsType} scanner. Please check your settings.`);
          throw new Error(`Failed to connect to ${settingsType} scanner`);
        }

        // Start listening for barcode scans
        if (settingsType === 'camera') {
          // For camera scanner, we don't need to start a listener as we'll use the CameraView component
          // But we'll store the service so we can trigger scan events
          setHasPermission(true);
        } else {
          // For external scanners, start the scan listener
          const listenerId = scannerService.startScanListener(scanCallback);
          scanListenerRef.current = listenerId;
        }
      });
    } catch {
      showScannerAlert('Error', `Failed to connect to ${settingsType} scanner.`);
    } finally {
      setConnecting(false);
    }
  }, [disconnectScanner, executeScannerOperation, processBarcodeData, settingsType, settingsDeviceId, showScannerAlert, scannerFactory]);

  // Handle camera barcode scanning
  const handleBarCodeScanned = useCallback(
    ({ data }: BarcodeScanningResult) => {
      setScanned(true);
      processBarcodeData(data);
    },
    [processBarcodeData]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnectScanner();
    };
  }, [disconnectScanner]);

  return {
    hasPermission,
    scanned,
    connected,
    connecting,
    scanResult,
    setScanned,
    connectScanner,
    disconnectScanner,
    handleBarCodeScanned,
  };
};
