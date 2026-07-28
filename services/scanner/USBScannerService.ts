import { LoggerFactory } from '../logger/LoggerFactory';
import { ScannerServiceInterface } from './ScannerServiceInterface';
import { scannerSettingsService } from './ScannerSettingsService';

/**
 * USB scanner service implementation
 * Note: USB communication in React Native requires platform-specific native modules
 */
export class USBScannerService implements ScannerServiceInterface {
  readonly driverType = 'usb' as const;
  private connected: boolean = false;
  private deviceId: string | null = null;
  private scanListeners: Map<string, (data: string) => void> = new Map();
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private inputBuffer: string = '';
  private lastKeyTime: number = 0;
  private logger: ReturnType<typeof LoggerFactory.prototype.createLogger>;

  constructor() {
    this.logger = LoggerFactory.getInstance().createLogger('USBScannerService');
  }
  /**
   * Connect to a USB scanner device
   * @param deviceId The USB device ID to connect to
   * @returns Promise resolving to true if connected successfully
   */
  async connect(deviceId: string): Promise<boolean> {
    try {
      // USB scanners generally act as HID keyboard devices
      // When connected via USB, they typically don't require special connection logic
      // as the operating system treats them as keyboard input

      // For a real implementation, you would use a native module for USB communication
      // e.g., react-native-usb for Android or IOKit for iOS

      // For demonstration purposes, we'll simulate a connection
      this.connected = true;
      this.deviceId = deviceId;

      this.logger.info('Connected to USB scanner:', deviceId);

      return true;
    } catch (error) {
      this.logger.error('Error connecting to USB device:', error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  /**
   * Disconnect from currently connected USB scanner
   */
  async disconnect(): Promise<void> {
    try {
      if (this.keydownHandler && typeof window !== 'undefined') {
        window.removeEventListener('keydown', this.keydownHandler, true);
        this.keydownHandler = null;
      }
      this.scanListeners.clear();
      this.inputBuffer = '';
      this.connected = false;
      this.deviceId = null;
      this.logger.info('Disconnected from USB scanner');
    } catch (error) {
      this.logger.error('Error disconnecting from USB device:', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Check if connected to a USB scanner
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Start listening for barcode scans from the connected USB scanner.
   * USB HID scanners emulate a keyboard — this listener captures their rapid
   * keystroke bursts (terminated by Enter) on any web-based platform.
   */
  startScanListener(callback: (data: string) => void): string {
    if (!this.connected) {
      this.logger.error('Cannot start scan listener: No device connected');
      return '';
    }

    const subscriptionId = `usb-${this.deviceId}-${Date.now()}`;
    this.scanListeners.set(subscriptionId, callback);

    if (!this.keydownHandler && typeof window !== 'undefined') {
      this.inputBuffer = '';
      this.lastKeyTime = 0;

      // Load configuration from settings service
      const config = scannerSettingsService.getUsbConfig();
      const suffixKey = config.suffixChar === 'Tab' ? 'Tab' : 'Enter';

      this.keydownHandler = (e: KeyboardEvent) => {
        const now = Date.now();
        if (now - this.lastKeyTime > config.scanIntervalMs && this.inputBuffer.length > 0) {
          this.inputBuffer = '';
        }
        this.lastKeyTime = now;

        if (e.key === suffixKey) {
          if (this.inputBuffer.length >= config.minBarcodeLength && this.inputBuffer.length <= config.maxBarcodeLength) {
            const barcode = this.inputBuffer.trim();
            this.inputBuffer = '';
            this.scanListeners.forEach(cb => cb(barcode));
            this.logger.info(`USB barcode scanned: ${barcode}`);
          } else {
            this.inputBuffer = '';
          }
          return;
        }
        if (e.key.length === 1) {
          this.inputBuffer += e.key;
        }
      };
      window.addEventListener('keydown', this.keydownHandler, true);
      this.logger.info('DOM keydown HID listener attached for USB scanner');
    }

    return subscriptionId;
  }

  /**
   * Stop listening for barcode scans
   * @param subscriptionId The subscription ID returned from startScanListener
   */
  stopScanListener(subscriptionId: string): void {
    this.scanListeners.delete(subscriptionId);
    if (this.scanListeners.size === 0 && this.keydownHandler && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.keydownHandler, true);
      this.keydownHandler = null;
      this.inputBuffer = '';
      this.logger.info('DOM keydown HID listener removed for USB scanner');
    }
  }

  /**
   * Discover available USB scanner devices.
   * USB HID scanners are identified as keyboards by the OS — no enumeration needed.
   */
  async discoverDevices(): Promise<Array<{ id: string; name: string }>> {
    return [{ id: 'usb-hid', name: 'USB HID Barcode Scanner' }];
  }

  simulateScan(barcodeData: string): void {
    if (this.connected) {
      this.scanListeners.forEach(callback => callback(barcodeData));
    }
  }
}
