import { PrinterConfig, PrinterStatus, ReceiptData } from './PrinterTypes';
import { BasePrinterService } from './BasePrinterService';
import { USE_MOCK_PRINTERS } from '@env';
import { UnifiedPrinterServiceMock } from './UnifiedPrinterServiceMock';
import { ElectronPrinterService } from './ElectronPrinterService';
import { LoggerFactory } from '../logger/LoggerFactory';
import { keyValueRepository } from '../../repositories/KeyValueRepository';
import { isElectron } from '../../utils/electron';

// Define the connection type for the factory
type PrinterConnectionType = 'network' | 'usb' | 'bluetooth';

const PRINTER_SETTINGS_KEY = 'printerSettings';

/**
 * Factory service that provides access to different printer types
 * This is the main entry point for printer functionality
 */
export class PrinterServiceFactory {
  private static instance: PrinterServiceFactory;
  private logger = LoggerFactory.getInstance().createLogger('PrinterServiceFactory');

  // Available printers — loaded from KV store, never hardcoded
  private availablePrinters: PrinterConfig[] = [];
  private printersLoaded = false;

  // Single unified printer service instance for all printer types
  private unifiedPrinterService!: BasePrinterService;

  // Currently active printer service and config
  private activePrinterService: BasePrinterService | null = null;
  private activePrinterConfig: PrinterConfig | null = null;

  private constructor() {
    // The printer service will be initialized in getInstance()
    // to allow for dynamic loading of the mock or real implementation
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): PrinterServiceFactory {
    if (!PrinterServiceFactory.instance) {
      const factoryLogger = LoggerFactory.getInstance().createLogger('PrinterServiceFactory');
      factoryLogger.info(`Initializing printer service factory (mock=${USE_MOCK_PRINTERS})`);
      const instance = new PrinterServiceFactory();

      try {
        if (USE_MOCK_PRINTERS === 'true') {
          factoryLogger.info('Using mock printer service');
          instance.unifiedPrinterService = new UnifiedPrinterServiceMock();
        } else if (isElectron()) {
          factoryLogger.info('Using Electron printer service (IPC-based)');
          instance.unifiedPrinterService = new ElectronPrinterService();
        } else {
          const { UnifiedPrinterService } = require('./UnifiedPrinterService');
          instance.unifiedPrinterService = new UnifiedPrinterService();
          factoryLogger.info('Using real printer service');
        }

        PrinterServiceFactory.instance = instance;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        factoryLogger.error({ message: 'Critical error initializing printer service' }, error instanceof Error ? error : new Error(msg));
        throw new Error('Failed to initialize printer service: ' + msg, { cause: error });
      }
    }

    return PrinterServiceFactory.instance;
  }

  /**
   * Load printer configurations from persistent storage.
   * Idempotent — does nothing if already loaded.
   */
  public async loadPrinters(): Promise<void> {
    if (this.printersLoaded) return;
    try {
      const saved = await keyValueRepository.getObject<PrinterConfig[]>(PRINTER_SETTINGS_KEY);
      this.availablePrinters = saved ?? [];
      this.printersLoaded = true;
      this.logger.info(`Loaded ${this.availablePrinters.length} printer(s) from storage`);
    } catch (error) {
      this.logger.error({ message: 'Failed to load printer settings' }, error instanceof Error ? error : new Error(String(error)));
      this.availablePrinters = [];
      this.printersLoaded = true;
    }
  }

  /**
   * Persist the current printer list to storage.
   */
  private async savePrinters(): Promise<void> {
    try {
      await keyValueRepository.setObject(PRINTER_SETTINGS_KEY, this.availablePrinters);
    } catch (error) {
      this.logger.error({ message: 'Failed to save printer settings' }, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Get list of available printers.
   * Call loadPrinters() at app startup to ensure this is populated.
   */
  public getAvailablePrinters(): PrinterConfig[] {
    return this.availablePrinters;
  }

  /**
   * Get currently active printer configuration
   */
  public getActivePrinter(): PrinterConfig | null {
    return this.activePrinterConfig;
  }

  /**
   * Check if connected to any printer
   */
  public isConnectedToPrinter(): boolean {
    return this.activePrinterService?.isConnected() || false;
  }

  /**
   * Connect to a printer by name
   * @param printerName Name of the printer to connect to
   */
  public async connectToPrinter(printerName: string): Promise<boolean> {
    try {
      this.logger.info(`Connecting to printer: ${printerName}`);

      // Find printer in available printers
      const printer = this.availablePrinters.find(p => p.printerName === printerName);

      if (!printer) {
        throw new Error(`Printer "${printerName}" not found`);
      }

      // Disconnect from any active printer first
      await this.disconnect();

      // Use the unified printer service for all printer types
      const printerService = this.unifiedPrinterService;

      // Map the PrinterConfig to the format expected by UnifiedPrinterService
      const unifiedConfig = {
        printerName: printer.printerName,
        printerType: this.mapConnectionTypeToPrinterType(printer.connectionType),
        paperWidth: printer.paperWidth,
        // Add specific properties based on connection type
        ...(printer.connectionType === 'usb'
          ? {
              vendorId: printer.vendorId?.toString(16) || '',
              productId: printer.productId?.toString(16) || '',
            }
          : {}),
        ...(printer.connectionType === 'bluetooth'
          ? {
              deviceId: printer.macAddress || '',
              macAddress: printer.macAddress || '',
            }
          : {}),
        ...(printer.connectionType === 'network'
          ? {
              host: printer.ipAddress || '',
              port: printer.port || 9100,
            }
          : {}),
      };

      // Connect to the printer
      const connected = await printerService.connect(unifiedConfig);

      if (connected) {
        this.activePrinterService = printerService;
        this.activePrinterConfig = printer;
        this.logger.info(`Connected to printer: ${printerName}`);
      } else {
        throw new Error(`Failed to connect to printer: ${printerName}`);
      }

      return connected;
    } catch (error) {
      this.logger.error({ message: 'Error connecting to printer' }, error instanceof Error ? error : new Error(String(error)));
      this.activePrinterService = null;
      this.activePrinterConfig = null;
      return false;
    }
  }

  /**
   * Map connection type from PrinterConfig to PrinterConnectionType for UnifiedPrinterService
   */
  private mapConnectionTypeToPrinterType(connectionType: string): PrinterConnectionType {
    switch (connectionType) {
      case 'usb':
        return 'usb';
      case 'bluetooth':
        return 'bluetooth';
      case 'network':
        return 'network';
      default:
        throw new Error(`Unsupported connection type: ${connectionType}`);
    }
  }

  /**
   * Add or update a printer configuration and persist to storage.
   * @param printerName Name of the printer to update
   * @param config Printer configuration
   */
  public async updatePrinterConfig(printerName: string, config: PrinterConfig): Promise<void> {
    const existingIndex = this.availablePrinters.findIndex(p => p.printerName === printerName);

    if (existingIndex >= 0) {
      this.availablePrinters[existingIndex] = {
        ...this.availablePrinters[existingIndex],
        ...config,
      };
      this.logger.info(`Updated configuration for printer: ${printerName}`);
    } else {
      this.availablePrinters.push(config);
      this.logger.info(`Added new printer configuration: ${printerName}`);
    }

    // Update active printer config if this is the active printer
    if (this.activePrinterConfig?.printerName === printerName) {
      this.activePrinterConfig = {
        ...this.activePrinterConfig,
        ...config,
      };
    }

    await this.savePrinters();
  }

  /**
   * Remove a printer configuration and persist to storage.
   * @param printerName Name of the printer to remove
   */
  public async removePrinterConfig(printerName: string): Promise<void> {
    this.availablePrinters = this.availablePrinters.filter(p => p.printerName !== printerName);
    this.logger.info(`Removed printer configuration: ${printerName}`);
    await this.savePrinters();
  }

  /**
   * Print a receipt on the active printer
   * @param data Receipt data to print
   */
  public async printReceipt(data: ReceiptData): Promise<boolean> {
    if (!this.activePrinterService) {
      throw new Error('Not connected to a printer');
    }

    try {
      this.logger.info(`Printing receipt for order ${data.orderId}`);
      return await this.activePrinterService.printReceipt(data);
    } catch (error) {
      this.logger.error({ message: 'Failed to print receipt' }, error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  /**
   * Print raw ESC/POS commands to the active printer
   * @param commands Raw ESC/POS command string
   */
  public async printRaw(commands: string): Promise<boolean> {
    if (!this.activePrinterService) {
      throw new Error('Not connected to a printer');
    }

    try {
      this.logger.info('Printing raw ESC/POS commands');
      return await this.activePrinterService.printRaw(commands);
    } catch (error) {
      this.logger.error({ message: 'Failed to print raw commands' }, error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  /**
   * Get status of the active printer
   */
  public async getPrinterStatus(): Promise<PrinterStatus> {
    if (!this.activePrinterService) {
      return {
        isOnline: false,
        hasPaper: false,
        errorMessage: 'No printer connected',
      };
    }

    try {
      return await this.activePrinterService.getStatus();
    } catch (error) {
      this.logger.error({ message: 'Failed to get printer status' }, error instanceof Error ? error : new Error(String(error)));
      return {
        isOnline: false,
        hasPaper: false,
        errorMessage: 'Failed to get printer status',
      };
    }
  }

  /**
   * Discover printers available on the network / USB bus.
   * On Electron, delegates to the main process via IPC for real mDNS/USB discovery.
   * On mobile/tablet, returns the persisted printer list.
   */
  public async discoverPrinters(): Promise<PrinterConfig[]> {
    if (isElectron() && this.unifiedPrinterService instanceof ElectronPrinterService) {
      try {
        const discovered = await this.unifiedPrinterService.discoverPrinters();
        // Merge discovered with persisted (avoid duplicates by name)
        const existingNames = new Set(this.availablePrinters.map(p => p.printerName));
        for (const d of discovered) {
          if (!existingNames.has(d.printerName)) {
            this.availablePrinters.push(d);
          }
        }
        return this.availablePrinters;
      } catch (error) {
        this.logger.warn(
          'Electron printer discovery failed, returning persisted list',
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
    return this.availablePrinters;
  }

  /**
   * Test connectivity to a printer without persisting or activating it.
   * Temporarily connects via UnifiedPrinterService and immediately disconnects.
   * @param config Partial printer config (enough to attempt a connection)
   * @returns true if connection succeeded
   */
  public async testConnection(config: Partial<PrinterConfig> & { connectionType: PrinterConfig['connectionType'] }): Promise<boolean> {
    try {
      const unifiedConfig = {
        printerName: config.printerName ?? 'test',
        printerType: this.mapConnectionTypeToPrinterType(config.connectionType),
        macAddress: config.macAddress,
        host: config.ipAddress,
        port: config.port,
        vendorId: config.vendorId?.toString(16),
        productId: config.productId?.toString(16),
      };
      const connected = await this.unifiedPrinterService.connect(unifiedConfig);
      if (connected) {
        await this.unifiedPrinterService.disconnect();
      }
      return connected;
    } catch (error) {
      this.logger.error({ message: 'Printer test connection failed' }, error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  /**
   * Disconnect from the active printer
   */
  public async disconnect(): Promise<void> {
    if (this.activePrinterService) {
      await this.activePrinterService.disconnect();
      this.activePrinterService = null;
      this.activePrinterConfig = null;
    }
  }
}
