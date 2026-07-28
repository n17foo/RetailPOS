/**
 * useCheckout
 *
 * Shared checkout + payment-method-change logic consumed by both
 * BasketContent (desktop sidebar) and Basket (mobile panel).
 *
 * Implements the full flow from the checkout spec:
 *  - startCheckout → creates platform draft order
 *  - cancelDraftOrder → returns to basket for editing
 *  - markPaymentProcessing → locks the order
 *  - completePayment → records payment, clears basket
 *  - cancelOrder → hard cancel after markPaymentProcessing
 *
 * Payment method change mid-checkout (spec 2.7):
 *  - Before "Pay" tapped: pure local state, no API calls
 *  - After markPaymentProcessing: cancelOrder → restart checkout
 *  - On cash tender back button: setStep('method'), no API call
 */

import { useState, useCallback, useMemo } from 'react';
import { ECommercePlatform } from '../utils/platforms';
import { usePayment } from './usePayment';
import { cashDrawerServiceFactory } from '../services/drawer/CashDrawerServiceFactory';
import { PrinterServiceFactory } from '../services/printer/PrinterServiceFactory';
import { customerDisplayServiceFactory } from '../services/display/CustomerDisplayServiceFactory';
import { keyValueRepository } from '../repositories/KeyValueRepository';
import { PaymentSelection } from '../components/CheckoutModal';
import { PaymentLine } from '../services/order/order';
import { generateUUID } from '../utils/uuid';
import { loyaltyService } from '../services/loyalty/LoyaltyService';
import { storeCreditService } from '../services/customer/StoreCreditService';
import { toCents } from '../utils/money';
import { useLogger } from './useLogger';
import { useManagerApproval } from './useManagerApproval';
import { useBasketState } from '../contexts/BasketStateProvider';
import { useCheckoutContext } from '../contexts/CheckoutProvider';

interface UseCheckoutOptions {
  platform?: ECommercePlatform;
  onSuccess?: (orderId: string) => void;
}

export function useCheckout({ platform, onSuccess }: UseCheckoutOptions = {}) {
  const logger = useLogger('useCheckout');
  const { basketItems, total, subtotal, tax, itemCount, basket } = useBasketState();
  const { currentOrder, startCheckout, markPaymentProcessing, completePayment, cancelOrder, cancelDraftOrder } = useCheckoutContext();

  const { processPayment, isTerminalConnected, getPaymentMode, getCurrentProvider } = usePayment();
  const { requestApproval } = useManagerApproval();

  const [isProcessing, setIsProcessing] = useState(false);
  const [checkoutVisible, setCheckoutVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Split tender state ───────────────────────────────────────────────
  const [splitMode, setSplitMode] = useState(false);
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  const [splitCashTenderAmount, setSplitCashTenderAmount] = useState<number | null>(null);

  // ── Start checkout — creates platform draft ──────────────────────────
  const handleStartCheckout = useCallback(async () => {
    if (basketItems.length === 0) return;
    setIsProcessing(true);
    setError(null);
    setSplitMode(false);
    setPaymentLines([]);
    setSplitCashTenderAmount(null);
    try {
      const order = await startCheckout(platform);
      if (order) {
        setCheckoutVisible(true);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsProcessing(false);
    }
  }, [basketItems.length, startCheckout, platform]);

  // ── Cancel draft — return to basket for editing ──────────────────────
  // Called when cashier closes CheckoutModal before paying
  const handleCancelCheckout = useCallback(async () => {
    setCheckoutVisible(false);
    if (!currentOrder) return;

    try {
      if (currentOrder.status === 'draft') {
        // Soft cancel: delete draft, basket stays intact
        await cancelDraftOrder();
      } else if (currentOrder.status === 'processing') {
        // Hard cancel: payment was initiated, order must be cancelled
        await cancelOrder(currentOrder.id);
      }
      // 'pending' (offline fallback) — just close, no platform call needed
    } catch (err) {
      setError((err as Error).message);
    }
  }, [currentOrder, cancelDraftOrder, cancelOrder]);

  // ── Split tender helpers ─────────────────────────────────────────────
  const addPaymentLine = useCallback(
    async (line: Omit<PaymentLine, 'id' | 'processedAt'>) => {
      if (!currentOrder) return;

      // For card/terminal in split mode, process payment first
      if (line.method === 'card' || line.method === 'card_terminal') {
        setIsProcessing(true);
        try {
          const response = await processPayment({
            amount: line.amount,
            reference: `ORDER-${Date.now()}-SPLIT`,
            orderId: currentOrder.id,
            itemCount,
          });

          if (!response.success) {
            setError(response.errorMessage || 'Card payment failed');
            return;
          }

          // Add the successful card payment line
          const full: PaymentLine = {
            ...line,
            id: generateUUID(),
            processedAt: Date.now(),
            transactionId: response.transactionId,
            cardBrand: response.cardBrand,
            last4: response.last4,
          };
          setPaymentLines(prev => [...prev, full]);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setIsProcessing(false);
        }
      } else if (line.method === 'cash') {
        // For cash in split mode, store the amount and let CheckoutModal handle tendering
        setSplitCashTenderAmount(line.amount);
      } else if (line.method === 'loyalty') {
        // Redeem loyalty points
        if (!basket?.customerEmail) {
          setError('Customer email required for loyalty redemption');
          return;
        }
        setIsProcessing(true);
        try {
          const result = await loyaltyService.redeemPoints(basket.customerEmail, currentOrder.id, Math.floor(line.amount * 100)); // Convert dollars to points
          const full: PaymentLine = {
            method: 'loyalty',
            amount: result.discountDollars,
            id: generateUUID(),
            processedAt: Date.now(),
            note: `Loyalty redemption: ${result.transactionId}`,
          };
          setPaymentLines(prev => [...prev, full]);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setIsProcessing(false);
        }
      } else if (line.method === 'store_credit') {
        // Redeem store credit
        if (!basket?.customerEmail) {
          setError('Customer email required for store credit redemption');
          return;
        }
        setIsProcessing(true);
        try {
          const result = await storeCreditService.redeem(basket.customerEmail, currentOrder.id, toCents(line.amount));
          const full: PaymentLine = {
            method: 'store_credit',
            amount: result.discountDollars,
            id: generateUUID(),
            processedAt: Date.now(),
            note: `Store credit redemption: ${result.entryId}`,
          };
          setPaymentLines(prev => [...prev, full]);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setIsProcessing(false);
        }
      } else {
        // Other methods — add directly
        const full: PaymentLine = { ...line, id: generateUUID(), processedAt: Date.now() };
        setPaymentLines(prev => [...prev, full]);
      }
    },
    [currentOrder, processPayment, itemCount, basket?.customerEmail]
  );

  const confirmSplitCashPayment = useCallback(
    (tenderedAmount: number) => {
      if (splitCashTenderAmount === null) return;
      const full: PaymentLine = {
        method: 'cash',
        amount: splitCashTenderAmount,
        id: generateUUID(),
        processedAt: Date.now(),
        note: `Tendered: ${tenderedAmount.toFixed(2)}`,
      };
      setPaymentLines(prev => [...prev, full]);
      setSplitCashTenderAmount(null);
    },
    [splitCashTenderAmount]
  );

  const removePaymentLine = useCallback(
    async (lineId: string) => {
      const line = paymentLines.find(p => p.id === lineId);
      if (!line) return;

      // Spec 2.1.9: Reverse terminal charges when removing a card payment line
      if ((line.method === 'card' || line.method === 'card_terminal') && line.transactionId) {
        // Attempt to void the transaction if the payment service supports it
        try {
          const paymentServiceInstance = (await import('../services/payment/PaymentService')).default;
          if (paymentServiceInstance.voidTransaction) {
            const result = await paymentServiceInstance.voidTransaction(line.transactionId);
            if (!result.success) {
              logger.warn(`Failed to void transaction ${line.transactionId}: ${result.errorMessage}`);
              setError(`Card payment removed but void failed. Manual reversal may be required for transaction ${line.transactionId}`);
            }
          } else {
            logger.warn(
              `Card payment line removed (txn: ${line.transactionId}). voidTransaction not supported - manual reversal may be required.`
            );
            setError(`Card payment removed. Manual reversal may be required for transaction ${line.transactionId}`);
          }
        } catch (err) {
          logger.warn('Failed to void transaction:', err);
          setError(`Card payment removed but void failed. Manual reversal may be required for transaction ${line.transactionId}`);
        }
      }

      // Reverse loyalty redemption
      if (line.method === 'loyalty' && line.note) {
        const txIdMatch = line.note.match(/Loyalty redemption: (.+)/);
        if (txIdMatch && basket?.customerEmail) {
          try {
            await loyaltyService.reverseRedemption(txIdMatch[1]);
          } catch (err) {
            logger.warn('Failed to reverse loyalty redemption:', err);
          }
        }
      }

      // Reverse store credit redemption
      if (line.method === 'store_credit' && line.note) {
        const entryIdMatch = line.note.match(/Store credit redemption: (.+)/);
        if (entryIdMatch && basket?.customerEmail) {
          try {
            await storeCreditService.reverseRedemption(entryIdMatch[1]);
          } catch (err) {
            logger.warn('Failed to reverse store credit redemption:', err);
          }
        }
      }

      setPaymentLines(prev => prev.filter(p => p.id !== lineId));
    },
    [paymentLines, basket?.customerEmail, logger]
  );

  const remainingDue = useMemo(() => {
    const collected = paymentLines.filter(p => p.amount > 0).reduce((s, p) => s + p.amount, 0);
    return Math.max(0, total - collected);
  }, [paymentLines, total]);

  const handleCompleteSplit = useCallback(async () => {
    if (!currentOrder || remainingDue > 0.01) return;
    setIsProcessing(true);
    setError(null);
    try {
      await markPaymentProcessing(currentOrder.id);
      const primaryLine = paymentLines.find(p => p.amount > 0);
      const result = await completePayment(currentOrder.id, primaryLine?.method ?? 'other', primaryLine?.transactionId, paymentLines);
      if (result.success) {
        if (result.openDrawer) {
          cashDrawerServiceFactory
            .getService()
            .open()
            .catch(() => {});
        }

        customerDisplayServiceFactory
          .getService()
          .showThankYou()
          .catch(() => {});

        // Auto-print receipt for split tender
        try {
          const printerSettings = await keyValueRepository.getObject<{ printReceipts?: boolean }>('printerSettings');
          const printerFactory = PrinterServiceFactory.getInstance();
          if (printerSettings?.printReceipts !== false && printerFactory.isConnectedToPrinter()) {
            const order = currentOrder;
            if (order) {
              printerFactory
                .printReceipt({
                  orderId: order.id.slice(-8),
                  items: order.items.map(i => ({ name: i.name, quantity: i.quantity, price: i.price })),
                  subtotal,
                  tax,
                  total,
                  paymentMethod: 'split',
                  paymentLines: paymentLines.map(p => ({
                    method: p.method,
                    amount: p.amount,
                    cardBrand: p.cardBrand,
                    last4: p.last4,
                  })),
                  date: new Date(),
                  cashierName: order.cashierName ?? 'Cashier',
                  customerName: order.customerName,
                })
                .catch(() => {});
            }
          }
        } catch (err) {
          // Receipt printing is best-effort
          logger.error(err instanceof Error ? err.message : String(err));
        }

        setSplitMode(false);
        setPaymentLines([]);
        setCheckoutVisible(false);
        onSuccess?.(result.orderId);
      } else {
        setError(result.error ?? 'Payment failed');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsProcessing(false);
    }
  }, [currentOrder, remainingDue, paymentLines, markPaymentProcessing, completePayment, onSuccess, subtotal, tax, total, logger]);

  // ── Process payment ──────────────────────────────────────────────────
  const handlePayment = useCallback(
    async (selection: PaymentSelection) => {
      if (!currentOrder) return;

      setIsProcessing(true);
      setError(null);
      try {
        // Check if manager approval is required for high-value transactions
        const settings = await keyValueRepository.getObject<{ highValueThreshold?: number }>('checkoutSettings');
        const highValueThreshold = settings?.highValueThreshold ?? 500; // Default £500

        if (total >= highValueThreshold) {
          logger.info(`High-value transaction detected (${total} >= ${highValueThreshold}), requesting manager approval`);
          const approved = await requestApproval('order:high_value');
          if (!approved) {
            setError('Manager approval required for high-value transactions');
            setIsProcessing(false);
            return;
          }
        }

        await markPaymentProcessing(currentOrder.id);

        // Show payment screen on customer display
        customerDisplayServiceFactory
          .getService()
          .showPayment(total, 'GBP')
          .catch(() => {});

        let transactionId: string | undefined;

        // Card / terminal: go through PaymentService first
        if (selection.method === 'card' || selection.method === 'terminal') {
          const response = await processPayment({
            amount: total,
            reference: `ORDER-${Date.now()}`,
            orderId: currentOrder.id,
            itemCount,
          });

          if (!response.success) {
            // Payment failed — cancel the order so cashier can retry with a
            // different method (spec 2.7.1–2.7.2)
            await cancelOrder(currentOrder.id);
            setCheckoutVisible(false);
            setError(response.errorMessage || 'Payment failed');
            return;
          }

          transactionId = response.transactionId;
        }

        const paymentMethod = selection.method === 'terminal' ? 'card_terminal' : selection.method;
        const result = await completePayment(currentOrder.id, paymentMethod, transactionId);

        if (result.success) {
          if (result.openDrawer) {
            cashDrawerServiceFactory
              .getService()
              .open()
              .catch(() => {});
          }

          // Show thank-you on customer display
          customerDisplayServiceFactory
            .getService()
            .showThankYou()
            .catch(() => {});

          // Auto-print receipt if printer is connected and printReceipts is enabled
          try {
            const printerSettings = await keyValueRepository.getObject<{ printReceipts?: boolean }>('printerSettings');
            const printerFactory = PrinterServiceFactory.getInstance();
            if (printerSettings?.printReceipts !== false && printerFactory.isConnectedToPrinter()) {
              const order = currentOrder;
              if (order) {
                printerFactory
                  .printReceipt({
                    orderId: order.id.slice(-8),
                    items: order.items.map(i => ({ name: i.name, quantity: i.quantity, price: i.price })),
                    subtotal,
                    tax,
                    total,
                    paymentMethod: paymentMethod,
                    date: new Date(),
                    cashierName: order.cashierName ?? 'Cashier',
                    customerName: order.customerName,
                  })
                  .catch(() => {});
              }
            }
          } catch {
            // Receipt printing is best-effort — never block the success path
          }

          setCheckoutVisible(false);
          onSuccess?.(result.orderId);
        } else {
          setError(result.error || 'Payment failed');
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setIsProcessing(false);
      }
    },
    [
      currentOrder,
      markPaymentProcessing,
      processPayment,
      completePayment,
      cancelOrder,
      total,
      tax,
      itemCount,
      subtotal,
      onSuccess,
      logger,
      requestApproval,
    ]
  );

  return {
    // State
    isProcessing,
    checkoutVisible,
    error,
    currentOrder,
    // Totals (from basket context — updated by draft order)
    total,
    subtotal,
    tax,
    itemCount,
    // Terminal
    terminalConnected: isTerminalConnected(),
    // Payment mode — drives which options CheckoutModal shows
    paymentMode: getPaymentMode(),
    activeProvider: getCurrentProvider(),
    // Actions
    handleStartCheckout,
    handleCancelCheckout,
    handlePayment,
    clearError: () => setError(null),
    // Split tender
    splitMode,
    setSplitMode,
    paymentLines,
    addPaymentLine,
    removePaymentLine,
    remainingDue,
    handleCompleteSplit,
    splitCashTenderAmount,
    confirmSplitCashPayment,
  };
}
