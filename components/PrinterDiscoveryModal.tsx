import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, FlatList, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeProvider';
import { Button } from './Button';
import { Input } from './Input';
import { Card } from './Card';
import { mobilePrinterDiscovery } from '../services/printer/MobilePrinterDiscovery';
import { PrinterConfig } from '../services/printer/PrinterTypes';
import { spacing, typography } from '../utils/theme';

interface PrinterDiscoveryModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectPrinter: (printer: PrinterConfig) => void;
}

/**
 * Modal for discovering network printers on mobile devices
 */
export function PrinterDiscoveryModal({ visible, onClose, onSelectPrinter }: PrinterDiscoveryModalProps) {
  const { colors } = useTheme();
  const [discovering, setDiscovering] = useState(false);
  const [printers, setPrinters] = useState<PrinterConfig[]>([]);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualHost, setManualHost] = useState('');
  const [manualPort, setManualPort] = useState('9100');
  const [manualName, setManualName] = useState('');

  const handleDiscover = async () => {
    setDiscovering(true);
    try {
      const discovered = await mobilePrinterDiscovery.discover(10000);
      setPrinters(discovered);

      if (discovered.length === 0) {
        Alert.alert(
          'No Printers Found',
          'No network printers were discovered. You can add a printer manually by entering its IP address.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Add Manually', onPress: () => setShowManualEntry(true) },
          ]
        );
      }
    } catch {
      Alert.alert('Discovery Failed', 'Failed to discover printers. Please try again or add manually.');
    } finally {
      setDiscovering(false);
    }
  };

  const handleAddManual = async () => {
    if (!manualHost) {
      Alert.alert('Error', 'Please enter a printer IP address');
      return;
    }

    const port = parseInt(manualPort, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      Alert.alert('Error', 'Please enter a valid port number (1-65535)');
      return;
    }

    try {
      const printer = await mobilePrinterDiscovery.addManualPrinter(manualHost, port, manualName || undefined);
      setPrinters([...printers, printer]);
      setShowManualEntry(false);
      setManualHost('');
      setManualPort('9100');
      setManualName('');
      Alert.alert('Success', 'Printer added successfully');
    } catch {
      Alert.alert('Error', 'Failed to add printer');
    }
  };

  const handleTestConnection = async (printer: PrinterConfig) => {
    try {
      const success = await mobilePrinterDiscovery.testConnection(printer);
      if (success) {
        Alert.alert('Success', `Successfully connected to ${printer.name}`);
      } else {
        Alert.alert('Failed', `Could not connect to ${printer.name}`);
      }
    } catch {
      Alert.alert('Error', 'Connection test failed');
    }
  };

  const renderPrinterItem = ({ item }: { item: PrinterConfig }) => (
    <Card style={styles.printerCard}>
      <View style={styles.printerInfo}>
        <MaterialIcons name="print" size={32} color={colors.primary} />
        <View style={styles.printerDetails}>
          <Text style={[styles.printerName, { color: colors.textPrimary }]}>{item.name}</Text>
          <Text style={[styles.printerAddress, { color: colors.textSecondary }]}>
            {item.host}:{item.port}
          </Text>
          <Text style={[styles.printerModel, { color: colors.textSecondary }]}>Model: {item.model}</Text>
        </View>
      </View>
      <View style={styles.printerActions}>
        <Button title="Test" onPress={() => handleTestConnection(item)} variant="secondary" style={styles.actionButton} />
        <Button
          title="Select"
          onPress={() => {
            onSelectPrinter(item);
            onClose();
          }}
          variant="primary"
          style={styles.actionButton}
        />
      </View>
    </Card>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Discover Printers</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <MaterialIcons name="close" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        {/* Manual Entry Form */}
        {showManualEntry ? (
          <View style={styles.manualEntry}>
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Add Printer Manually</Text>
            <Input
              label="Printer IP Address"
              value={manualHost}
              onChangeText={setManualHost}
              placeholder="192.168.1.100"
              keyboardType="numeric"
            />
            <Input label="Port" value={manualPort} onChangeText={setManualPort} placeholder="9100" keyboardType="numeric" />
            <Input label="Printer Name (Optional)" value={manualName} onChangeText={setManualName} placeholder="My Printer" />
            <View style={styles.manualActions}>
              <Button title="Cancel" onPress={() => setShowManualEntry(false)} variant="secondary" style={styles.manualButton} />
              <Button title="Add Printer" onPress={handleAddManual} variant="primary" style={styles.manualButton} />
            </View>
          </View>
        ) : (
          <>
            {/* Discovery Controls */}
            <View style={styles.controls}>
              <Button
                title={discovering ? 'Discovering...' : 'Start Discovery'}
                onPress={handleDiscover}
                disabled={discovering}
                variant="primary"
                style={styles.discoverButton}
              />
              <Button title="Add Manually" onPress={() => setShowManualEntry(true)} variant="secondary" style={styles.manualButton} />
            </View>

            {/* Discovery Status */}
            {discovering && (
              <View style={styles.statusContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[styles.statusText, { color: colors.textSecondary }]}>Scanning network for printers...</Text>
              </View>
            )}

            {/* Printer List */}
            {printers.length > 0 && (
              <FlatList
                data={printers}
                renderItem={renderPrinterItem}
                keyExtractor={item => item.id || item.printerName}
                contentContainerStyle={styles.listContent}
                ListHeaderComponent={
                  <Text style={[styles.listHeader, { color: colors.textSecondary }]}>
                    Found {printers.length} printer{printers.length !== 1 ? 's' : ''}
                  </Text>
                }
              />
            )}

            {/* Empty State */}
            {!discovering && printers.length === 0 && (
              <View style={styles.emptyState}>
                <MaterialIcons name="print-disabled" size={64} color={colors.textSecondary} />
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No printers discovered yet</Text>
                <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>Tap "Start Discovery" to scan for network printers</Text>
              </View>
            )}
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: typography.fontSize.xl,
    fontWeight: '700',
  },
  closeButton: {
    padding: spacing.xs,
  },
  controls: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  discoverButton: {
    flex: 2,
  },
  manualButton: {
    flex: 1,
  },
  statusContainer: {
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  statusText: {
    fontSize: typography.fontSize.sm,
  },
  listContent: {
    padding: spacing.md,
    gap: spacing.md,
  },
  listHeader: {
    fontSize: typography.fontSize.sm,
    marginBottom: spacing.sm,
  },
  printerCard: {
    padding: spacing.md,
    gap: spacing.md,
  },
  printerInfo: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  printerDetails: {
    flex: 1,
    gap: 4,
  },
  printerName: {
    fontSize: typography.fontSize.md,
    fontWeight: '600',
  },
  printerAddress: {
    fontSize: typography.fontSize.sm,
  },
  printerModel: {
    fontSize: typography.fontSize.xs,
  },
  printerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  emptyText: {
    fontSize: typography.fontSize.md,
    fontWeight: '600',
  },
  emptyHint: {
    fontSize: typography.fontSize.sm,
    textAlign: 'center',
  },
  manualEntry: {
    padding: spacing.md,
    gap: spacing.md,
  },
  sectionTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  manualActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});
