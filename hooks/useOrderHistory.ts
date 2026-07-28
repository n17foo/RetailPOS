import { useState, useCallback, useEffect } from 'react';
import { Alert } from 'react-native';
import { LocalOrder } from '../services/basket/BasketServiceInterface';
import { orderRepository } from '../repositories/OrderRepository';
import { useAuthContext } from '../contexts/AuthProvider';
import { useLogger } from './useLogger';
import { getDayStart, getDayEnd, filterAndSortOrders, canNavigateNext, canNavigatePrev } from '../utils/orderHistory.utils';
import { useCheckoutContext } from '../contexts/CheckoutProvider';

interface UseOrderHistoryReturn {
  orders: LocalOrder[];
  isLoading: boolean;
  refreshing: boolean;
  dayOffset: number;
  isToday: boolean;
  isCashier: boolean;
  isAdmin: boolean;
  syncingOrderId: string | null;
  loadOrders: () => Promise<void>;
  onRefresh: () => Promise<void>;
  handlePreviousDay: () => void;
  handleNextDay: () => void;
  handleResyncOrder: (orderId: string) => Promise<void>;
  handleDeleteOrder: (orderId: string) => void;
  getDayStart: (offset?: number) => number;
}

export function useOrderHistory(): UseOrderHistoryReturn {
  const { getLocalOrders, syncOrderToPlatform } = useCheckoutContext();
  const { user } = useAuthContext();
  const logger = useLogger('useOrderHistory');

  const userRole = user?.role || 'cashier';
  const isAdmin = userRole === 'admin';
  const isCashier = userRole === 'cashier';

  const [orders, setOrders] = useState<LocalOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dayOffset, setDayOffset] = useState(0);
  const [syncingOrderId, setSyncingOrderId] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    try {
      setIsLoading(true);
      const fromTs = getDayStart(dayOffset);
      const toTs = getDayEnd(dayOffset);
      const cashierFilter = isCashier ? user?.id : undefined;
      const rows = await orderRepository.findByDateRange(fromTs, toTs, cashierFilter);
      const allOrders = await getLocalOrders();
      const rowIds = new Set(rows.map(r => r.id));
      const filtered = filterAndSortOrders(allOrders, rowIds);
      setOrders(filtered);
    } catch (error) {
      logger.error('Failed to load orders:', error instanceof Error ? error : new Error(String(error)));
      Alert.alert('Error', 'Failed to load orders');
    } finally {
      setIsLoading(false);
    }
  }, [dayOffset, isCashier, user?.id, getLocalOrders, logger]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadOrders();
    setRefreshing(false);
  }, [loadOrders]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const handlePreviousDay = useCallback(() => {
    if (canNavigatePrev(isCashier)) setDayOffset(prev => prev - 1);
  }, [isCashier]);

  const handleNextDay = useCallback(() => {
    if (canNavigateNext(isCashier, dayOffset)) setDayOffset(prev => prev + 1);
  }, [isCashier, dayOffset]);

  const handleResyncOrder = useCallback(
    async (orderId: string) => {
      try {
        setSyncingOrderId(orderId);
        const result = await syncOrderToPlatform(orderId);
        if (result.success) {
          Alert.alert('Success', 'Order synced successfully!');
          await loadOrders();
        } else {
          Alert.alert('Sync Failed', result.error || 'Unknown error occurred');
        }
      } catch (error) {
        logger.error('Failed to resync order:', error instanceof Error ? error : new Error(String(error)));
        Alert.alert('Error', 'Failed to resync order');
      } finally {
        setSyncingOrderId(null);
      }
    },
    [syncOrderToPlatform, loadOrders, logger]
  );

  const handleDeleteOrder = useCallback(
    (orderId: string) => {
      Alert.alert('Delete Order', 'Are you sure you want to delete this order? This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await orderRepository.delete(orderId);
              await loadOrders();
              Alert.alert('Deleted', 'Order removed successfully');
            } catch (error) {
              logger.error('Failed to delete order:', error instanceof Error ? error : new Error(String(error)));
              Alert.alert('Error', 'Failed to delete order');
            }
          },
        },
      ]);
    },
    [loadOrders, logger]
  );

  return {
    orders,
    isLoading,
    refreshing,
    dayOffset,
    isToday: dayOffset === 0,
    isCashier,
    isAdmin,
    syncingOrderId,
    loadOrders,
    onRefresh,
    handlePreviousDay,
    handleNextDay,
    handleResyncOrder,
    handleDeleteOrder,
    getDayStart,
  };
}
