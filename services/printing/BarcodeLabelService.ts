/**
 * BarcodeLabelService
 *
 * Handles barcode label printing using ESC/POS commands for label printers.
 * Supports various label formats and provides CSV export fallback.
 *
 * See: docs/specs/inventory/inventory.md §7.6
 */

import { PrinterServiceFactory } from '../printer/PrinterServiceFactory';
import { LoggerFactory } from '../logger/LoggerFactory';
import { auditLogService } from '../audit/AuditLogService';

export interface LabelData {
  productId: string;
  variantId?: string;
  name: string;
  sku?: string;
  price?: number;
  barcode?: string;
  quantity: number; // Number of labels to print
}

export interface LabelFormat {
  width: number; // Label width in mm
  height: number; // Label height in mm
  fontSize: 'small' | 'medium' | 'large';
  includePrice: boolean;
  includeName: boolean;
  includeSku: boolean;
}

export interface PrintResult {
  success: boolean;
  printed: number;
  failed: number;
  error?: string;
}

export class BarcodeLabelService {
  private static instance: BarcodeLabelService;
  private logger = LoggerFactory.getInstance().createLogger('BarcodeLabelService');

  private constructor() {}

  static getInstance(): BarcodeLabelService {
    if (!BarcodeLabelService.instance) {
      BarcodeLabelService.instance = new BarcodeLabelService();
    }
    return BarcodeLabelService.instance;
  }

  /**
   * Print barcode labels for products
   */
  async printLabels(labels: LabelData[], format: LabelFormat, printedBy?: string): Promise<PrintResult> {
    try {
      const printerFactory = PrinterServiceFactory.getInstance();

      // Check if printer is connected
      const isConnected = printerFactory.isConnectedToPrinter();
      if (!isConnected) {
        throw new Error('Printer not connected');
      }

      let printed = 0;
      let failed = 0;

      for (const label of labels) {
        try {
          const escPosCommands = this.generateLabelCommands(label, format);

          // Print the specified quantity
          for (let i = 0; i < label.quantity; i++) {
            const success = await printerFactory.printRaw(escPosCommands);
            if (success) {
              printed++;
            } else {
              failed++;
            }
          }
        } catch (err) {
          this.logger.warn(`Failed to print label for ${label.name}:`, err);
          failed += label.quantity;
        }
      }

      await auditLogService.log('barcode_labels:printed', {
        userId: printedBy,
        details: `Printed ${printed} barcode labels (${failed} failed)`,
        metadata: { printed, failed, labelCount: labels.length },
      });

      return { success: true, printed, failed };
    } catch (err) {
      this.logger.error('Failed to print barcode labels:', err instanceof Error ? err : new Error(String(err)));
      return {
        success: false,
        printed: 0,
        failed: labels.reduce((sum, l) => sum + l.quantity, 0),
        error: err instanceof Error ? err.message : 'Print failed',
      };
    }
  }

  /**
   * Export label data to CSV as fallback when printer unavailable
   */
  async exportToCsv(labels: LabelData[]): Promise<string> {
    const headers = ['Product Name', 'SKU', 'Barcode', 'Price', 'Quantity'];
    const rows = labels.map(label => [
      label.name,
      label.sku || '',
      label.barcode || label.sku || label.productId,
      label.price ? `$${label.price.toFixed(2)}` : '',
      label.quantity.toString(),
    ]);

    const csvContent = [headers, ...rows].map(row => row.map(field => `"${field.replace(/"/g, '""')}"`).join(',')).join('\n');

    await auditLogService.log('barcode_labels:exported', {
      details: `Exported ${labels.length} barcode labels to CSV`,
      metadata: { labelCount: labels.length },
    });

    return csvContent;
  }

  /**
   * Generate ESC/POS commands for a single label
   */
  private generateLabelCommands(label: LabelData, format: LabelFormat): string {
    const ESC = '\x1B';
    const GS = '\x1D';

    let commands = '';

    // Initialize printer
    commands += ESC + '@'; // Initialize
    commands += ESC + 'a' + '\x01'; // Center align

    // Set font size based on format
    switch (format.fontSize) {
      case 'small':
        commands += GS + '!' + '\x00'; // Normal size
        break;
      case 'medium':
        commands += GS + '!' + '\x11'; // Double height and width
        break;
      case 'large':
        commands += GS + '!' + '\x22'; // Triple height and width
        break;
    }

    // Product name (if enabled)
    if (format.includeName) {
      commands += label.name + '\n';
    }

    // SKU (if enabled and available)
    if (format.includeSku && label.sku) {
      commands += GS + '!' + '\x00'; // Reset to normal size for SKU
      commands += 'SKU: ' + label.sku + '\n';
    }

    // Barcode (use SKU, barcode field, or productId as fallback)
    const barcodeData = label.barcode || label.sku || label.productId;
    if (barcodeData) {
      // Set barcode parameters
      commands += GS + 'h' + '\x40'; // Barcode height (64 dots)
      commands += GS + 'w' + '\x02'; // Barcode width (2 dots)
      commands += GS + 'H' + '\x02'; // Print HRI below barcode
      commands += GS + 'f' + '\x00'; // Font for HRI

      // Print Code 128 barcode
      commands += GS + 'k' + '\x49'; // Code 128
      commands += String.fromCharCode(barcodeData.length); // Length
      commands += barcodeData; // Data
    }

    // Price (if enabled and available)
    if (format.includePrice && label.price !== undefined) {
      commands += '\n';
      commands += GS + '!' + '\x11'; // Double size for price
      commands += '$' + label.price.toFixed(2) + '\n';
    }

    // Cut paper (if supported)
    commands += '\n\n';
    commands += GS + 'V' + '\x41' + '\x03'; // Partial cut

    return commands;
  }

  /**
   * Get default label format
   */
  getDefaultFormat(): LabelFormat {
    return {
      width: 50, // 50mm width
      height: 30, // 30mm height
      fontSize: 'medium',
      includePrice: true,
      includeName: true,
      includeSku: true,
    };
  }

  /**
   * Validate label data
   */
  validateLabelData(labels: LabelData[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (labels.length === 0) {
      errors.push('No labels to print');
    }

    for (const label of labels) {
      if (!label.name.trim()) {
        errors.push(`Product ${label.productId} has no name`);
      }
      if (label.quantity < 1) {
        errors.push(`Product ${label.name} has invalid quantity: ${label.quantity}`);
      }
      if (label.quantity > 100) {
        errors.push(`Product ${label.name} quantity too high: ${label.quantity} (max 100)`);
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

export const barcodeLabelService = BarcodeLabelService.getInstance();
