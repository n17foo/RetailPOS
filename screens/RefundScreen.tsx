import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, ScrollView } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { lightColors, spacing, typography, borderRadius, elevation } from '../utils/theme';
import { formatMoney } from '../utils/money';
import { useRefund } from '../hooks/useRefund';
import { RefundRecord } from '../services/refunds/RefundService';
import { Button } from '../components/Button';
import Input from '../components/Input';
import { useCurrency } from '../hooks/useCurrency';
import { useLogger } from '../hooks/useLogger';
import { useManagerApproval } from '../hooks/useManagerApproval';

interface ReturnsScreenProps {
  onGoBack?: () => void;
}

interface ReturnItemInput {
  orderItemId?: string;
  productId: string;
  variantId?: string;
  productName: string;
  quantity: number;
  refundAmount: number;
  reason?: string;
  restock?: boolean;
}

const RefundScreen: React.FC<ReturnsScreenProps> = ({ onGoBack }) => {
  const currency = useCurrency();
  const {
    isInitialized,
    isLoading,
    error,
    processPaymentRefund,
    processEcommerceRefund,
    processReturn,
    getRefundHistory,
    getReturnableItems,
  } = useRefund();
  const { requestApproval, isApproving } = useManagerApproval();
  const [refundType, setRefundType] = useState<'payment' | 'ecommerce' | 'return'>('payment');
  const [orderId, setOrderId] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [refundHistory, setRefundHistory] = useState<RefundRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const logger = useLogger('ReturnsScreen');

  // Return-specific state
  const [returnItems, setReturnItems] = useState<ReturnItemInput[]>([]);
  const [issueRefund, setIssueRefund] = useState(true);
  const [returnableItems, setReturnableItems] = useState<
    Array<{
      orderItemId: string;
      productId: string;
      variantId: string | null;
      name: string;
      price: number;
      originalQuantity: number;
      returnedQuantity: number;
      returnableQuantity: number;
    }>
  >([]);
  const [loadingReturnableItems, setLoadingReturnableItems] = useState(false);

  // Fetch refund history when order/transaction ID changes
  useEffect(() => {
    async function fetchRefundHistory() {
      if (!orderId && !transactionId) return;

      try {
        setHistoryLoading(true);
        const id = refundType === 'ecommerce' || refundType === 'return' ? orderId : transactionId;
        if (id) {
          const history = await getRefundHistory(id);
          setRefundHistory(history);
        }
      } catch (err) {
        logger.error('Failed to fetch refund history:', err instanceof Error ? err : new Error(String(err)));
      } finally {
        setHistoryLoading(false);
      }
    }

    fetchRefundHistory();
  }, [orderId, transactionId, refundType, getRefundHistory, logger]);

  // Fetch returnable items when order ID changes and return type is selected
  useEffect(() => {
    async function fetchReturnableItems() {
      if (refundType !== 'return' || !orderId) {
        setReturnableItems([]);
        return;
      }

      try {
        setLoadingReturnableItems(true);
        const items = await getReturnableItems(orderId);
        setReturnableItems(items);
      } catch (err) {
        logger.error('Failed to fetch returnable items:', err instanceof Error ? err : new Error(String(err)));
      } finally {
        setLoadingReturnableItems(false);
      }
    }

    fetchReturnableItems();
  }, [orderId, refundType, getReturnableItems, logger]);

  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleProcessRefund = async () => {
    setFormError(null);
    setSuccessMsg(null);

    if (!isInitialized) {
      setFormError('Returns service is not initialized.');
      return;
    }

    // Spec requirement 2.2: Request manager approval for refund:process action
    const approved = await requestApproval('refund:process');
    if (!approved) {
      setFormError('Manager approval required to process refunds.');
      return;
    }

    if (refundType === 'payment') {
      if (!transactionId || !amount) {
        setFormError('Transaction ID and amount are required.');
        return;
      }

      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        setFormError('Amount must be a positive number.');
        return;
      }

      const result = await processPaymentRefund(transactionId, parsedAmount, reason);

      if (result.success) {
        setSuccessMsg(`Refund of ${formatMoney(parsedAmount, currency.code)} processed successfully.`);
        const history = await getRefundHistory(transactionId);
        setRefundHistory(history);
        setAmount('');
        setReason('');
      } else {
        setFormError(result.error || 'Failed to process refund.');
      }
    } else if (refundType === 'ecommerce') {
      if (!orderId || !amount) {
        setFormError('Order ID and amount are required.');
        return;
      }

      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        setFormError('Amount must be a positive number.');
        return;
      }

      const result = await processEcommerceRefund(orderId, {
        amount: parsedAmount,
        reason: reason,
      });

      if (result.success) {
        setSuccessMsg(`E-commerce refund of ${formatMoney(parsedAmount, currency.code)} processed successfully.`);
        const history = await getRefundHistory(orderId);
        setRefundHistory(history);
        setAmount('');
        setReason('');
      } else {
        setFormError(result.error || 'Failed to process e-commerce refund.');
      }
    } else {
      // Return processing
      if (!orderId) {
        setFormError('Order ID is required.');
        return;
      }

      if (returnItems.length === 0) {
        setFormError('Please add at least one item to return.');
        return;
      }

      const result = await processReturn({
        orderId,
        items: returnItems,
        issueRefund,
      });

      if (result.success) {
        setSuccessMsg(
          `Return processed. ${result.returnIds.length} item(s) returned${issueRefund ? ` with refund of ${formatMoney(result.totalRefund, currency.code)}` : ''}.`
        );
        const history = await getRefundHistory(orderId);
        setRefundHistory(history);
        setReturnItems([]);
        setReason('');
      } else {
        setFormError(result.error || 'Failed to process return.');
      }
    }
  };

  const addReturnItem = (item: {
    orderItemId: string;
    productId: string;
    variantId: string | null;
    name: string;
    price: number;
    returnableQuantity: number;
  }) => {
    setReturnItems([
      ...returnItems,
      {
        orderItemId: item.orderItemId,
        productId: item.productId,
        variantId: item.variantId || undefined,
        productName: item.name,
        quantity: 1,
        refundAmount: item.price,
        reason: reason || undefined,
        restock: true,
      },
    ]);
  };

  const removeReturnItem = (index: number) => {
    setReturnItems(returnItems.filter((_, i) => i !== index));
  };

  const updateReturnItemQuantity = (index: number, quantity: number) => {
    const newItems = [...returnItems];
    const item = returnItems[index];
    const returnableItem = returnableItems.find(ri => ri.orderItemId === item.orderItemId);
    const maxQuantity = returnableItem?.returnableQuantity || 1;

    newItems[index] = {
      ...item,
      quantity: Math.min(Math.max(1, quantity), maxQuantity),
      refundAmount: (item.refundAmount / item.quantity) * Math.min(Math.max(1, quantity), maxQuantity),
    };
    setReturnItems(newItems);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return lightColors.success;
      case 'failed':
        return lightColors.error;
      default:
        return lightColors.warning;
    }
  };

  const renderRefundHistoryItem = ({ item }: { item: RefundRecord }) => {
    const statusColor = getStatusColor(item.status);
    return (
      <View style={styles.historyItem}>
        <View style={styles.historyHeader}>
          <Text style={styles.historyId}>#{item.id.slice(-8)}</Text>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>{item.status}</Text>
          </View>
        </View>
        <Text style={styles.historyAmount}>{formatMoney(item.amount, currency.code)}</Text>
        <Text style={styles.historyMeta}>
          {item.timestamp.toLocaleString()} · {item.source}
        </Text>
        {item.reason && <Text style={styles.historyReason}>{item.reason}</Text>}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {onGoBack && (
          <TouchableOpacity onPress={onGoBack} style={styles.backButton} accessibilityLabel="Go back" accessibilityRole="button">
            <MaterialIcons name="arrow-back" size={24} color={lightColors.primary} />
          </TouchableOpacity>
        )}
        <Text style={styles.title}>Returns & Refunds</Text>
      </View>

      {(error || formError) && (
        <View style={styles.errorContainer}>
          <MaterialIcons name="error-outline" size={16} color={lightColors.error} />
          <Text style={styles.errorText}>{formError || error}</Text>
          <TouchableOpacity onPress={() => setFormError(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialIcons name="close" size={16} color={lightColors.error} />
          </TouchableOpacity>
        </View>
      )}

      {successMsg && (
        <View style={styles.successContainer}>
          <MaterialIcons name="check-circle" size={16} color={lightColors.success} />
          <Text style={styles.successText}>{successMsg}</Text>
        </View>
      )}

      <View style={styles.refundTypeSelector}>
        <Button
          title="Payment Refund"
          variant={refundType === 'payment' ? 'primary' : 'outline'}
          onPress={() => setRefundType('payment')}
          style={styles.typeButton}
        />
        <Button
          title="E-commerce Refund"
          variant={refundType === 'ecommerce' ? 'primary' : 'outline'}
          onPress={() => setRefundType('ecommerce')}
          style={styles.typeButton}
        />
        <Button
          title="Return with Refund"
          variant={refundType === 'return' ? 'primary' : 'outline'}
          onPress={() => setRefundType('return')}
          style={styles.typeButton}
        />
      </View>

      <ScrollView style={styles.formScrollContainer}>
        <View style={styles.formContainer}>
          {refundType === 'payment' ? (
            <>
              <Input
                label="Transaction ID"
                placeholder="Enter transaction ID"
                value={transactionId}
                onChangeText={setTransactionId}
                required
              />
              <Input
                label="Amount"
                placeholder="Enter refund amount"
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                required
              />
              <Input
                label="Reason"
                placeholder="Reason for refund (optional)"
                value={reason}
                onChangeText={setReason}
                multiline
                numberOfLines={3}
              />
            </>
          ) : refundType === 'ecommerce' ? (
            <>
              <Input label="Order ID" placeholder="Enter order ID" value={orderId} onChangeText={setOrderId} required />
              <Input
                label="Amount"
                placeholder="Enter refund amount"
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                required
              />
              <Input
                label="Reason"
                placeholder="Reason for refund (optional)"
                value={reason}
                onChangeText={setReason}
                multiline
                numberOfLines={3}
              />
            </>
          ) : (
            <>
              <Input label="Order ID" placeholder="Enter order ID" value={orderId} onChangeText={setOrderId} required />

              {loadingReturnableItems ? (
                <ActivityIndicator style={styles.returnableLoader} />
              ) : returnableItems.length > 0 ? (
                <>
                  <Text style={styles.sectionSubtitle}>Available Items to Return</Text>
                  {returnableItems.map(item => (
                    <View key={item.orderItemId} style={styles.returnableItem}>
                      <View style={styles.returnableItemInfo}>
                        <Text style={styles.returnableItemName}>{item.name}</Text>
                        <Text style={styles.returnableItemMeta}>
                          {item.returnableQuantity} available · {formatMoney(item.price, currency.code)} each
                        </Text>
                      </View>
                      <Button
                        title="Add"
                        variant="outline"
                        size="sm"
                        onPress={() => addReturnItem(item)}
                        disabled={returnItems.some(ri => ri.orderItemId === item.orderItemId)}
                      />
                    </View>
                  ))}
                </>
              ) : orderId ? (
                <Text style={styles.emptyReturnableText}>No returnable items found for this order</Text>
              ) : null}

              {returnItems.length > 0 && (
                <>
                  <Text style={styles.sectionSubtitle}>Items to Return</Text>
                  {returnItems.map((item, index) => (
                    <View key={index} style={styles.returnItem}>
                      <View style={styles.returnItemHeader}>
                        <Text style={styles.returnItemName}>{item.productName}</Text>
                        <TouchableOpacity onPress={() => removeReturnItem(index)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <MaterialIcons name="close" size={20} color={lightColors.error} />
                        </TouchableOpacity>
                      </View>
                      <View style={styles.returnItemControls}>
                        <View style={styles.quantityControl}>
                          <TouchableOpacity
                            onPress={() => updateReturnItemQuantity(index, item.quantity - 1)}
                            disabled={item.quantity <= 1}
                            style={styles.quantityButton}
                          >
                            <MaterialIcons
                              name="remove"
                              size={20}
                              color={item.quantity <= 1 ? lightColors.textSecondary : lightColors.primary}
                            />
                          </TouchableOpacity>
                          <Text style={styles.quantityText}>{item.quantity}</Text>
                          <TouchableOpacity
                            onPress={() => updateReturnItemQuantity(index, item.quantity + 1)}
                            style={styles.quantityButton}
                          >
                            <MaterialIcons name="add" size={20} color={lightColors.primary} />
                          </TouchableOpacity>
                        </View>
                        <Text style={styles.returnItemAmount}>{formatMoney(item.refundAmount, currency.code)}</Text>
                      </View>
                    </View>
                  ))}

                  <View style={styles.returnOptionsContainer}>
                    <TouchableOpacity
                      style={styles.checkboxRow}
                      onPress={() => setIssueRefund(!issueRefund)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: issueRefund }}
                    >
                      <MaterialIcons
                        name={issueRefund ? 'check-box' : 'check-box-outline-blank'}
                        size={24}
                        color={issueRefund ? lightColors.primary : lightColors.textSecondary}
                      />
                      <Text style={styles.checkboxLabel}>Issue monetary refund</Text>
                    </TouchableOpacity>
                  </View>

                  <Input
                    label="Reason"
                    placeholder="Reason for return (optional)"
                    value={reason}
                    onChangeText={setReason}
                    multiline
                    numberOfLines={3}
                  />
                </>
              )}
            </>
          )}

          <Button
            title={refundType === 'return' ? 'Process Return' : 'Process Refund'}
            variant="danger"
            fullWidth
            loading={isLoading || isApproving}
            disabled={!isInitialized || isApproving}
            onPress={handleProcessRefund}
          />
        </View>
      </ScrollView>

      <View style={styles.historyContainer}>
        <Text style={styles.sectionTitle}>Refund History</Text>
        {historyLoading ? (
          <ActivityIndicator style={styles.historyLoader} />
        ) : refundHistory.length > 0 ? (
          <FlatList data={refundHistory} renderItem={renderRefundHistoryItem} keyExtractor={item => item.id} />
        ) : (
          <Text style={styles.emptyHistoryText}>No refund history available</Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: lightColors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: lightColors.surface,
    borderBottomWidth: 1,
    borderBottomColor: lightColors.border,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: typography.fontSize.xl,
    fontWeight: '700',
    color: lightColors.textPrimary,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    margin: spacing.md,
    marginBottom: 0,
    padding: spacing.sm,
    backgroundColor: lightColors.error + '15',
    borderRadius: borderRadius.sm,
  },
  errorText: {
    flex: 1,
    color: lightColors.error,
    fontSize: typography.fontSize.sm,
  },
  successContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    margin: spacing.md,
    marginBottom: 0,
    padding: spacing.sm,
    backgroundColor: lightColors.success + '15',
    borderRadius: borderRadius.sm,
  },
  successText: {
    flex: 1,
    color: lightColors.success,
    fontSize: typography.fontSize.sm,
  },
  refundTypeSelector: {
    flexDirection: 'row',
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  typeButton: {
    flex: 1,
  },
  formScrollContainer: {
    flex: 1,
    marginBottom: spacing.md,
  },
  formContainer: {
    backgroundColor: lightColors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    ...elevation.low,
    marginBottom: spacing.md,
  },
  sectionSubtitle: {
    fontSize: typography.fontSize.md,
    fontWeight: '600',
    color: lightColors.textPrimary,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  returnableLoader: {
    marginVertical: spacing.lg,
  },
  emptyReturnableText: {
    textAlign: 'center',
    marginVertical: spacing.lg,
    color: lightColors.textSecondary,
    fontSize: typography.fontSize.sm,
  },
  returnableItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.sm,
    backgroundColor: lightColors.background,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.xs,
  },
  returnableItemInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  returnableItemName: {
    fontSize: typography.fontSize.md,
    fontWeight: '500',
    color: lightColors.textPrimary,
    marginBottom: 2,
  },
  returnableItemMeta: {
    fontSize: typography.fontSize.xs,
    color: lightColors.textSecondary,
  },
  returnItem: {
    padding: spacing.sm,
    backgroundColor: lightColors.background,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.xs,
  },
  returnItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  returnItemName: {
    fontSize: typography.fontSize.md,
    fontWeight: '500',
    color: lightColors.textPrimary,
    flex: 1,
  },
  returnItemControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  quantityControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  quantityButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: lightColors.surface,
    borderRadius: borderRadius.sm,
  },
  quantityText: {
    fontSize: typography.fontSize.md,
    fontWeight: '600',
    color: lightColors.textPrimary,
    minWidth: 30,
    textAlign: 'center',
  },
  returnItemAmount: {
    fontSize: typography.fontSize.md,
    fontWeight: '600',
    color: lightColors.textPrimary,
  },
  returnOptionsContainer: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  checkboxLabel: {
    fontSize: typography.fontSize.md,
    color: lightColors.textPrimary,
  },
  historyContainer: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: '500',
    marginBottom: spacing.xs,
    color: lightColors.textPrimary,
  },
  historyLoader: {
    marginTop: spacing.lg,
  },
  emptyHistoryText: {
    textAlign: 'center',
    marginTop: spacing.lg,
    color: lightColors.textSecondary,
  },
  historyItem: {
    backgroundColor: lightColors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.xs,
    ...elevation.low,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  historyId: {
    fontSize: typography.fontSize.sm,
    color: lightColors.textSecondary,
    fontWeight: '600',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  statusText: {
    fontSize: typography.fontSize.xs,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  historyAmount: {
    fontSize: typography.fontSize.lg,
    fontWeight: '700',
    color: lightColors.error,
    marginBottom: spacing.xs,
  },
  historyMeta: {
    fontSize: typography.fontSize.xs,
    color: lightColors.textSecondary,
  },
  historyReason: {
    fontSize: typography.fontSize.sm,
    color: lightColors.textSecondary,
    fontStyle: 'italic',
    marginTop: spacing.xs,
  },
});

export default RefundScreen;
