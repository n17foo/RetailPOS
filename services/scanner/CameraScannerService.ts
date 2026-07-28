import { ScannerServiceInterface } from './ScannerServiceInterface';
import { Camera } from 'expo-camera';
import EventEmitter from 'eventemitter3';
import { LoggerFactory } from '../logger/LoggerFactory';

/**
 * CameraScannerService - Implements the scanner interface for the device camera
 * Uses Expo Camera for barcode scanning
 */
export class CameraScannerService implements ScannerServiceInterface {
  private connected: boolean = false;
  private hasPermission: boolean = false;
  private eventEmitter: EventEmitter;
  private nextSubscriptionId: number = 1;
  private logger: ReturnType<typeof LoggerFactory.prototype.createLogger>;

  constructor() {
    this.eventEmitter = new EventEmitter();
    this.logger = LoggerFactory.getInstance().createLogger('CameraScannerService');
  }

  /**
   * Connect to the camera by requesting permission
   * @returns Promise resolving to true if camera permission granted
   */
  async connect(): Promise<boolean> {
    try {
      // Request camera permission
      const { status } = await Camera.requestCameraPermissionsAsync();
      this.hasPermission = status === 'granted';
      this.connected = this.hasPermission;

      this.logger.info(`Camera permission ${this.hasPermission ? 'granted' : 'denied'}`);
      return this.hasPermission;
    } catch (error) {
      this.logger.error('Error requesting camera permission:', error instanceof Error ? error : new Error(String(error)));
      this.connected = false;
      this.hasPermission = false;
      return false;
    }
  }

  /**
   * Disconnect from the camera scanner
   * Simply resets the connected state
   */
  async disconnect(): Promise<void> {
    this.connected = false;
  }

  /**
   * Check if the camera scanner is connected (has permission)
   */
  isConnected(): boolean {
    return this.connected && this.hasPermission;
  }

  /**
   * Start listening for barcode scans
   * Note: The actual scanning happens in the UI component using the Expo Camera
   * This service acts as a bridge for event handling
   * @param callback Function to call when a barcode is scanned
   */
  startScanListener(callback: (data: string) => void): string {
    const subscriptionId = `camera-${this.nextSubscriptionId++}`;

    // Register the callback with our event emitter
    this.eventEmitter.on(subscriptionId, callback);

    this.logger.info('Started camera scan listener');
    return subscriptionId;
  }

  /**
   * Stop listening for barcode scans
   * @param subscriptionId The subscription ID returned from startScanListener
   */
  stopScanListener(subscriptionId: string): void {
    // Remove all listeners for this subscription
    this.eventEmitter.removeAllListeners(subscriptionId);
    this.logger.info('Stopped camera scan listener:', subscriptionId);
  }

  /**
   * Trigger a barcode scan event
   * This should be called from the UI when a barcode is scanned
   * @param subscriptionId The subscription ID
   * @param data The barcode data
   */
  emitScanEvent(subscriptionId: string, data: string): void {
    this.eventEmitter.emit(subscriptionId, data);
  }

  /**
   * Discover available camera devices
   * For camera scanner, this is always just the device camera
   */
  async discoverDevices(): Promise<Array<{ id: string; name: string }>> {
    // Check if camera permissions are granted
    try {
      const { status } = await Camera.getCameraPermissionsAsync();
      if (status === 'granted') {
        // Since expo-camera doesn't have a method to list available camera devices,
        // we'll just return a default device
        return [
          { id: 'back', name: 'Back Camera' },
          { id: 'front', name: 'Front Camera' },
        ];
      } else {
        return [];
      }
    } catch (error) {
      this.logger.error('Error checking camera permissions:', error instanceof Error ? error : new Error(String(error)));

      // Return an empty array if there's an error
      return [];
    }
  }
}
