import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Switch, ActivityIndicator, FlatList } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../../../contexts/ThemeProvider';
import { Card } from '../../../components/Card';
import { Button } from '../../../components/Button';
import { cardReaderDetection, DetectedCardReader } from '../../../services/auth/CardReaderDetection';

import { useLogger } from '../../../hooks/useLogger';

/**
 * Auth hardware settings tab - card reader configuration
 */
export function AuthHardwareSettingsTab() {
  const { colors } = useTheme();
  const logger = useLogger('AuthHardwareSettingsTab');
  const [autoDetect, setAutoDetect] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [readers, setReaders] = useState<DetectedCardReader[]>([]);

  const handleDetect = useCallback(async () => {
    setDetecting(true);
    try {
      const detected = await cardReaderDetection.detectReaders();
      setReaders(detected);
    } catch (error) {
      logger.error('Failed to detect card readers:', error instanceof Error ? error : new Error(String(error)));
    } finally {
      setDetecting(false);
    }
  }, [logger]);

  useEffect(() => {
    void handleDetect();
  }, [handleDetect]);

  const renderReaderItem = ({ item }: { item: DetectedCardReader }) => (
    <View style={[styles.readerItem, { borderColor: colors.border }]}>
      <MaterialIcons name="credit-card" size={32} color={colors.primary} />
      <View style={styles.readerInfo}>
        <Text style={[styles.readerName, { color: colors.textPrimary }]}>{item.vendorName}</Text>
        <Text style={[styles.readerDetails, { color: colors.textSecondary }]}>
          {item.productName || `Product ID: ${item.productId.toString(16)}`}
        </Text>
        {item.serialNumber && <Text style={[styles.readerDetails, { color: colors.textSecondary }]}>Serial: {item.serialNumber}</Text>}
      </View>
      <MaterialIcons name="check-circle" size={24} color={colors.success} />
    </View>
  );

  return (
    <View style={styles.container}>
      <Card style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Card Reader Detection</Text>
        <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
          Automatically detect USB HID card readers for employee authentication
        </Text>

        <View style={styles.switchRow}>
          <View style={styles.switchLabel}>
            <Text style={[styles.label, { color: colors.textPrimary }]}>Auto-Detect Card Readers</Text>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>Automatically detect and enable card readers when connected</Text>
          </View>
          <Switch value={autoDetect} onValueChange={setAutoDetect} />
        </View>

        <Button
          title={detecting ? 'Detecting...' : 'Detect Card Readers'}
          onPress={handleDetect}
          disabled={detecting}
          variant="secondary"
          style={styles.detectButton}
        />

        {detecting && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Scanning for USB card readers...</Text>
          </View>
        )}

        {!detecting && readers.length > 0 && (
          <View style={styles.readersContainer}>
            <Text style={[styles.readersTitle, { color: colors.textPrimary }]}>Detected Card Readers ({readers.length})</Text>
            <FlatList data={readers} renderItem={renderReaderItem} keyExtractor={item => item.deviceId} scrollEnabled={false} />
          </View>
        )}

        {!detecting && readers.length === 0 && (
          <View style={styles.emptyState}>
            <MaterialIcons name="credit-card-off" size={48} color={colors.textSecondary} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No card readers detected</Text>
            <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>Connect a USB card reader and tap "Detect Card Readers"</Text>
          </View>
        )}
      </Card>

      <Card style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Supported Card Readers</Text>
        <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
          This system supports the following USB HID card reader vendors:
        </Text>
        <View style={styles.vendorList}>
          <Text style={[styles.vendorItem, { color: colors.textSecondary }]}>• MagTek</Text>
          <Text style={[styles.vendorItem, { color: colors.textSecondary }]}>• ID TECH</Text>
          <Text style={[styles.vendorItem, { color: colors.textSecondary }]}>• Cherry</Text>
          <Text style={[styles.vendorItem, { color: colors.textSecondary }]}>• HID Global</Text>
          <Text style={[styles.vendorItem, { color: colors.textSecondary }]}>• Gemalto</Text>
          <Text style={[styles.vendorItem, { color: colors.textSecondary }]}>• Identiv</Text>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
  },
  section: {
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  sectionDescription: {
    fontSize: 14,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  switchLabel: {
    flex: 1,
    marginRight: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  hint: {
    fontSize: 12,
  },
  detectButton: {
    marginTop: 8,
  },
  loadingContainer: {
    alignItems: 'center',
    padding: 24,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
  },
  readersContainer: {
    marginTop: 16,
    gap: 12,
  },
  readersTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  readerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
    marginBottom: 8,
  },
  readerInfo: {
    flex: 1,
    gap: 4,
  },
  readerName: {
    fontSize: 14,
    fontWeight: '600',
  },
  readerDetails: {
    fontSize: 12,
  },
  emptyState: {
    alignItems: 'center',
    padding: 24,
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '600',
  },
  emptyHint: {
    fontSize: 12,
    textAlign: 'center',
  },
  vendorList: {
    gap: 8,
    marginTop: 8,
  },
  vendorItem: {
    fontSize: 14,
  },
});
