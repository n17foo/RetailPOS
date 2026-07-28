import { useState, useCallback, useEffect } from 'react';
import { dailyReportService, ShiftData, DailyReportData } from '../services/printer/DailyReportService';
import { LocalOrder } from '../services/basket/BasketServiceInterface';
import { useCurrency } from './useCurrency';

interface UseDailyReportReturn {
  currentShift: ShiftData | null;
  shiftHistory: ShiftData[];
  isLoading: boolean;
  error: string | null;
  openShift: (cashierName: string, cashierId: string, openingCash: number) => Promise<ShiftData>;
  closeShift: (closingCash: number) => Promise<ShiftData>;
  generateReport: (orders: LocalOrder[], shift?: ShiftData) => Promise<DailyReportData>;
  getReportLines: (report: DailyReportData) => string[];
  getReceiptLines: (order: LocalOrder) => string[];
  loadShiftHistory: () => Promise<void>;
  reload: () => Promise<void>;
}

export const useDailyReport = (): UseDailyReportReturn => {
  const { symbol: currencySymbol } = useCurrency();
  const [currentShift, setCurrentShift] = useState<ShiftData | null>(null);
  const [shiftHistory, setShiftHistory] = useState<ShiftData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await dailyReportService.initialize();
      setCurrentShift(dailyReportService.getCurrentShift());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize daily report service');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadShiftHistory = useCallback(async () => {
    try {
      const history = await dailyReportService.getShiftHistory();
      setShiftHistory(history);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load shift history');
    }
  }, []);

  const openShift = useCallback(async (cashierName: string, cashierId: string, openingCash: number): Promise<ShiftData> => {
    setError(null);
    try {
      const shift = await dailyReportService.openShift(cashierName, cashierId, openingCash);
      setCurrentShift(shift);
      return shift;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open shift';
      setError(message);
      throw new Error(message, { cause: err });
    }
  }, []);

  const closeShift = useCallback(
    async (closingCash: number): Promise<ShiftData> => {
      setError(null);
      try {
        const shift = await dailyReportService.closeShift(closingCash);
        setCurrentShift(null);
        await loadShiftHistory();
        return shift;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to close shift';
        setError(message);
        throw new Error(message, { cause: err });
      }
    },
    [loadShiftHistory]
  );

  const generateReport = useCallback(async (orders: LocalOrder[], shift?: ShiftData): Promise<DailyReportData> => {
    setError(null);
    try {
      return await dailyReportService.generateDailyReport(orders, shift);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate report';
      setError(message);
      throw new Error(message, { cause: err });
    }
  }, []);

  const getReportLines = useCallback(
    (report: DailyReportData): string[] => {
      return dailyReportService.formatDailyReportForPrint(report, currencySymbol);
    },
    [currencySymbol]
  );

  const getReceiptLines = useCallback(
    (order: LocalOrder): string[] => {
      return dailyReportService.formatReceiptForPrint(order, currencySymbol);
    },
    [currencySymbol]
  );

  useEffect(() => {
    reload();
  }, [reload]);

  return {
    currentShift,
    shiftHistory,
    isLoading,
    error,
    openShift,
    closeShift,
    generateReport,
    getReportLines,
    getReceiptLines,
    loadShiftHistory,
    reload,
  };
};

export type { ShiftData, DailyReportData };
