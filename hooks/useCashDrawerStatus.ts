import { useState, useEffect, useCallback } from 'react';
import { CashDrawerServiceInterface } from '../services/drawer/CashDrawerServiceInterface';
import { useLogger } from './useLogger';

/**
 * Hook to monitor cash drawer status
 * Polls the drawer status at regular intervals
 */
export function useCashDrawerStatus(drawerService: CashDrawerServiceInterface | null, pollIntervalMs: number = 5000) {
  const [isOpen, setIsOpen] = useState<boolean | undefined>(undefined);
  const [isPolling, setIsPolling] = useState(false);
  const logger = useLogger('useCashDrawerStatus');

  const checkStatus = useCallback(async () => {
    if (!drawerService || drawerService.driverType === 'none') {
      setIsOpen(undefined);
      return;
    }

    try {
      const status = await drawerService.isOpen();
      setIsOpen(status);
    } catch (error) {
      logger.error('Failed to check drawer status:', error instanceof Error ? error : new Error(String(error)));
      setIsOpen(undefined);
    }
  }, [drawerService, logger]);

  useEffect(() => {
    if (!drawerService || drawerService.driverType === 'none') {
      setIsOpen(undefined);
      setIsPolling(false);
      return;
    }

    setIsPolling(true);
    checkStatus(); // Check immediately

    const intervalId = setInterval(checkStatus, pollIntervalMs);

    return () => {
      clearInterval(intervalId);
      setIsPolling(false);
    };
  }, [drawerService, pollIntervalMs, checkStatus]);

  return {
    isOpen,
    isPolling,
    refresh: checkStatus,
  };
}
