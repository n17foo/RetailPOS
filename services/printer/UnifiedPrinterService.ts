import { LoggerFactory } from '../logger/LoggerFactory';
import { AbstractPrinterService } from './BasePrinterService';
import { PrinterStatus, ReceiptData } from './PrinterTypes';
import { receiptConfigService } from './ReceiptConfigService';

// We'll use dynamic imports for these native modules to avoid initialization issues
// These variables will hold the imported modules when needed
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- third-party native printer SDK with no type definitions
type PrinterSDKModule = any;
let USBPrinter: PrinterSDKModule = null;
let BLEPrinter: PrinterSDKModule = null;
let NetPrinter: PrinterSDKModule = null;

/**
 * Printer connection types supported by the unified printer service
 */
export enum PrinterConnectionType {
  USB = 'usb',
  BLUETOOTH = 'bluetooth',
  NETWORK = 'network',
}

/**
 * Base printer configuration
 */
export interface BasePrinterConfig {
  printerName: string;
  printerType: PrinterConnectionType;
  paperWidth?: number;
}

/**
 * USB printer configuration
 */
export interface USBPrinterConfig extends BasePrinterConfig {
  printerType: PrinterConnectionType.USB;
  vendorId: string;
  productId: string;
}

/**
 * Bluetooth printer configuration
 */
export interface BluetoothPrinterConfig extends BasePrinterConfig {
  printerType: PrinterConnectionType.BLUETOOTH;
  deviceId: string;
  macAddress: string;
}

/**
 * Network printer configuration
 */
export interface NetworkPrinterConfig extends BasePrinterConfig {
  printerType: PrinterConnectionType.NETWORK;
  host: string;
  port: number;
}

/**
 * Unified printer configuration type
 */
export type PrinterConfig = USBPrinterConfig | BluetoothPrinterConfig | NetworkPrinterConfig;

/**
 * Unified printer service that supports USB, Bluetooth, and Network printers
 * using the @tillpos/rn-receipt-printer-utils library
 */
export class UnifiedPrinterService extends AbstractPrinterService {
  private printerInstance: PrinterSDKModule = null;
  private printerType: PrinterConnectionType | null = null;
  private logger = LoggerFactory.getInstance().createLogger('UnifiedPrinterService');

  /**
   * Connect to a printer
   * @param config Printer configuration
   */
  async connect(config: PrinterConfig): Promise<boolean> {
    try {
      // Ensure config has the expected properties with a type guard
      if (!config || !('printerType' in config) || !('printerName' in config)) {
        throw new Error('Invalid printer configuration');
      }

      this.logger.info(`Connecting to ${config.printerType} printer: ${config.printerName}`);

      this.printerType = config.printerType;

      // Dynamically import the required printer modules
      try {
        if (!USBPrinter || !BLEPrinter || !NetPrinter) {
          this.logger.info('Dynamically importing printer modules');
          const printerUtils = require('@tillpos/rn-receipt-printer-utils');
          USBPrinter = printerUtils.USBPrinter;
          BLEPrinter = printerUtils.BLEPrinter;
          NetPrinter = printerUtils.NetPrinter;
        }
      } catch (importError) {
        this.logger.warn('Failed to import printer modules:', importError);
        throw new Error(
          'Failed to initialize printer modules: ' + (importError instanceof Error ? importError.message : String(importError)),
          { cause: importError }
        );
      }

      switch (config.printerType) {
        case PrinterConnectionType.USB: {
          const usbConfig = config as USBPrinterConfig;

          // Use USBPrinter methods directly (it's an object with static methods)
          this.printerInstance = USBPrinter;

          // For USB printers, we'll connect when sending data
          // Just store the connection info for later use
          this._isConnected = true;
          this._connectionConfig = usbConfig;

          return true;
        }

        case PrinterConnectionType.BLUETOOTH: {
          const bleConfig = config as BluetoothPrinterConfig;

          // Use BLEPrinter methods directly (it only has connectAndSend method)
          this.printerInstance = BLEPrinter;

          // Check if we have a valid MAC address for connection
          if (!bleConfig.macAddress) {
            this.logger.error('MAC address is required for Bluetooth printer connection');
            return false;
          }

          // For BLEPrinter, we don't need to scan for devices
          // Just store the MAC address for later use in printing

          // Connect to the printer
          const connected = await this.printerInstance.connectPrinter(bleConfig.deviceId, bleConfig.macAddress);

          this._isConnected = connected;
          this._connectionConfig = bleConfig;

          return connected;
        }

        case PrinterConnectionType.NETWORK: {
          const netConfig = config as NetworkPrinterConfig;

          // Use NetPrinter methods directly (it's an object with static methods)
          this.printerInstance = NetPrinter;

          // For network printers, we don't actually connect until we send data
          // Just store the connection info for later use
          this._isConnected = true;
          this._connectionConfig = netConfig;

          return true;
        }

        default:
          throw new Error(`Unsupported printer type.`);
      }
    } catch (error) {
      // Safely access the printer type using a type guard
      const printerTypeName = config && 'printerType' in config ? String(config.printerType) : 'unknown';

      this.logger.error(`Failed to connect to ${printerTypeName} printer:`, error instanceof Error ? error : new Error(String(error)));
      this._isConnected = false;
      this.printerInstance = null;
      return false;
    }
  }

  /**
   * Print receipt on the printer
   * @param data Receipt data
   */
  async printReceipt(data: ReceiptData): Promise<boolean> {
    if (!this._isConnected || !this.printerInstance) {
      throw new Error('Not connected to a printer');
    }

    try {
      this.logger.info(`Printing receipt for order ${data.orderId}`);

      const config = receiptConfigService.getConfig();
      const cs = data.currencySymbol || '£';
      const divider = receiptConfigService.getDividerLine();
      const doubleDivider = receiptConfigService.getDoubleDividerLine();

      // Initialize the printer
      await this.printerInstance.init();

      // Header — driven by ReceiptConfigService
      await this.printerInstance.alignCenter();
      await this.printerInstance.setBold(true);
      await this.printerInstance.printText(`${config.header.businessName}\n`);
      await this.printerInstance.setBold(false);

      if (config.header.addressLine1) {
        await this.printerInstance.printText(`${config.header.addressLine1}\n`);
      }
      if (config.header.addressLine2) {
        await this.printerInstance.printText(`${config.header.addressLine2}\n`);
      }
      if (config.header.phone) {
        await this.printerInstance.printText(`Tel: ${config.header.phone}\n`);
      }
      if (config.header.taxId) {
        await this.printerInstance.printText(`Tax ID: ${config.header.taxId}\n`);
      }

      // Divider
      await this.printerInstance.alignLeft();
      await this.printerInstance.printText(`${divider}\n`);

      // Order info
      await this.printerInstance.printText(`Order #: ${data.orderId}\n`);
      await this.printerInstance.printText(`Date: ${data.date.toLocaleString()}\n`);
      await this.printerInstance.printText(`Cashier: ${data.cashierName}\n`);

      if (data.customerName) {
        await this.printerInstance.printText(`Customer: ${data.customerName}\n`);
      }

      // Divider
      await this.printerInstance.printText(`${divider}\n`);

      // Items
      for (const item of data.items) {
        const itemTotal = item.quantity * item.price;
        if (item.quantity > 1) {
          await this.printerInstance.printText(`${item.name}\n`);
          await this.printerInstance.printText(
            `${receiptConfigService.formatLine(`  ${item.quantity} x ${cs}${item.price.toFixed(2)}`, `${cs}${itemTotal.toFixed(2)}`)}\n`
          );
        } else {
          await this.printerInstance.printText(`${receiptConfigService.formatLine(item.name, `${cs}${itemTotal.toFixed(2)}`)}\n`);
        }
      }

      // Divider
      await this.printerInstance.printText(`${divider}\n`);

      // Totals
      await this.printerInstance.alignRight();
      const subtotal = data.subtotal;
      await this.printerInstance.printText(`Subtotal: ${cs}${subtotal.toFixed(2)}\n`);
      await this.printerInstance.printText(`Tax: ${cs}${data.tax.toFixed(2)}\n`);

      // Total — bold
      await this.printerInstance.setBold(true);
      await this.printerInstance.printText(`${doubleDivider}\n`);
      await this.printerInstance.printText(`Total: ${cs}${data.total.toFixed(2)}\n`);
      await this.printerInstance.setBold(false);
      await this.printerInstance.printText(`${doubleDivider}\n`);

      // Payment method
      await this.printerInstance.alignLeft();

      // Split tender: show payment breakdown
      if (data.paymentMethod === 'split' && data.paymentLines && data.paymentLines.length > 0) {
        await this.printerInstance.printText(`Payment Method: Split Tender\n`);
        await this.printerInstance.printText(`${divider}\n`);
        for (const line of data.paymentLines) {
          let methodLabel = line.method;
          if (line.method === 'card' || line.method === 'card_terminal') {
            methodLabel = line.cardBrand ? `${line.cardBrand} ····${line.last4}` : 'Card';
          } else if (line.method === 'cash') {
            methodLabel = 'Cash';
          } else if (line.method === 'store_credit') {
            methodLabel = 'Store Credit';
          } else if (line.method === 'loyalty') {
            methodLabel = 'Loyalty Points';
          }
          await this.printerInstance.printText(`${receiptConfigService.formatLine(methodLabel, `${cs}${line.amount.toFixed(2)}`)}\n`);
        }
        await this.printerInstance.printText(`${divider}\n\n`);
      } else {
        // Single payment method
        await this.printerInstance.printText(`Payment Method: ${data.paymentMethod}\n\n`);
      }

      // Footer — driven by ReceiptConfigService
      await this.printerInstance.alignCenter();
      if (config.footer.line1) {
        await this.printerInstance.printText(`${config.footer.line1}\n`);
      }
      if (config.footer.line2) {
        await this.printerInstance.printText(`${config.footer.line2}\n`);
      }
      if (config.footer.line3) {
        await this.printerInstance.printText(`${config.footer.line3}\n`);
      }
      await this.printerInstance.printText('\n\n');

      // Cut paper (if supported)
      if (config.options.cutPaper) {
        await this.printerInstance.cutPaper();
      }

      this.logger.info('Receipt printed successfully');
      return true;
    } catch (error) {
      this.logger.error({ message: 'Failed to print receipt' }, error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  /**
   * Get printer status
   */
  async getStatus(): Promise<PrinterStatus> {
    if (!this._isConnected || !this.printerInstance) {
      return {
        isOnline: false,
        hasPaper: false,
        errorMessage: 'Printer not connected',
      };
    }

    try {
      // Check connection status
      // Note: The @tillpos/rn-receipt-printer-utils library doesn't provide a direct method
      // to check printer status, so we'll attempt a simple operation to verify connectivity

      // Use a type guard to safely access printerType property
      const config = this._connectionConfig as PrinterConfig;
      if (!config || !('printerType' in config)) {
        throw new Error('Invalid printer configuration');
      }

      switch (config.printerType) {
        case PrinterConnectionType.USB: {
          const usbConfig = config as USBPrinterConfig;
          const connected = await this.printerInstance.connectPrinter(usbConfig.vendorId, usbConfig.productId);

          if (connected) {
            return {
              isOnline: true,
              hasPaper: true, // Cannot determine paper status with this library
              drawerOpen: false,
            };
          }
          break;
        }

        case PrinterConnectionType.BLUETOOTH: {
          const bleConfig = config as BluetoothPrinterConfig;
          const connected = await this.printerInstance.connectPrinter(bleConfig.deviceId, bleConfig.macAddress);

          if (connected) {
            return {
              isOnline: true,
              hasPaper: true,
              drawerOpen: false,
            };
          }
          break;
        }

        case PrinterConnectionType.NETWORK: {
          const netConfig = config as NetworkPrinterConfig;
          const connected = await this.printerInstance.connectPrinter(netConfig.host, netConfig.port);

          if (connected) {
            return {
              isOnline: true,
              hasPaper: true,
              drawerOpen: false,
            };
          }
          break;
        }
      }

      // If we reach here, connection check failed
      this._isConnected = false;
      return {
        isOnline: false,
        hasPaper: false,
        errorMessage: 'Printer connection lost',
      };
    } catch (error) {
      this.logger.error('Failed to get printer status:', error instanceof Error ? error : new Error(String(error)));
      return {
        isOnline: false,
        hasPaper: false,
        errorMessage: 'Failed to get printer status',
      };
    }
  }

  /**
   * Override sendBytes to dispatch raw ESC/POS bytes through the active printer SDK.
   * This powers openDrawer() and any caller using formatReceiptBuffer().
   */
  protected async sendBytes(data: Uint8Array): Promise<boolean> {
    if (!this._isConnected || !this.printerInstance) return false;

    try {
      const config = this._connectionConfig as PrinterConfig;
      if (!config || !('printerType' in config)) return false;

      // Convert Uint8Array to base64 — works in React Native without Node.js Buffer polyfill
      const binary = Array.from(data)
        .map(b => String.fromCharCode(b))
        .join('');
      const base64 = btoa(binary);

      switch (config.printerType) {
        case PrinterConnectionType.USB: {
          const usbConfig = config as USBPrinterConfig;
          await this.printerInstance.printRawData(base64, usbConfig.vendorId, usbConfig.productId);
          return true;
        }
        case PrinterConnectionType.BLUETOOTH: {
          const bleConfig = config as BluetoothPrinterConfig;
          await this.printerInstance.printRawData(base64, bleConfig.deviceId, bleConfig.macAddress);
          return true;
        }
        case PrinterConnectionType.NETWORK: {
          const netConfig = config as NetworkPrinterConfig;
          await this.printerInstance.printRawData(base64, netConfig.host, netConfig.port);
          return true;
        }
        default:
          return false;
      }
    } catch (error) {
      this.logger.error({ message: 'sendBytes failed' }, error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  /**
   * Disconnect from the printer
   */
  async disconnect(): Promise<void> {
    if (this._isConnected && this.printerInstance) {
      try {
        // Close the printer connection
        await this.printerInstance.closeConn();
        this.printerInstance = null;
        this.printerType = null;
      } catch (error) {
        this.logger.error('Error disconnecting from printer:', error instanceof Error ? error : new Error(String(error)));
      }
    }

    await super.disconnect();
    this.logger.info('Disconnected from printer');
  }
}
