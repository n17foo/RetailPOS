import React, { useCallback, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { PaymentProvider } from '../../services/payment/PaymentServiceFactory';
import { usePaymentSettings, PaymentSettings } from '../../hooks/usePaymentSettings';
import { lightColors, spacing, borderRadius, typography, elevation } from '../../utils/theme';
import { useTranslate } from '../../hooks/useTranslate';
import { useLogger } from '../../hooks/useLogger';
import { auditLogService } from '../../services/audit/AuditLogService';
import { useAuthContext } from '../../contexts/AuthProvider';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProviderSettingKey<T extends keyof PaymentSettings> = keyof PaymentSettings[T];

// Human-readable labels for each provider
const PROVIDER_LABELS: Record<PaymentProvider, string> = {
  [PaymentProvider.STRIPE_NFC]: 'Stripe NFC (Tap to Pay)',
  [PaymentProvider.STRIPE]: 'Stripe Terminal',
  [PaymentProvider.SQUARE]: 'Square',
  [PaymentProvider.ADYEN]: 'Adyen',
  [PaymentProvider.TAP_PAYMENTS]: 'Tap Payments',
  [PaymentProvider.INSTORE_API]: 'Instore PED',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const PaymentSettingsTab = () => {
  const { t } = useTranslate();
  const { user } = useAuthContext();
  const { paymentSettings, handlePaymentSettingsChange, saveSettings, testConnection, error, saveStatus, isLoading, loadSettings } =
    usePaymentSettings();
  const logger = useLogger('PaymentSettingsTab');
  const isMounted = useRef(true);

  const hasUnsavedChanges = saveStatus === 'unsaved';

  useEffect(() => {
    loadSettings().catch(err => logger.error('Failed to load payment settings:', err));
    return () => {
      isMounted.current = false;
    };
  }, [loadSettings, logger]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleProviderChange = useCallback(
    (provider: PaymentProvider) => {
      handlePaymentSettingsChange({ provider });
    },
    [handlePaymentSettingsChange]
  );

  const handleProviderSettingChange = useCallback(
    <T extends keyof PaymentSettings>(provider: T, field: ProviderSettingKey<T>, value: string | boolean) => {
      handlePaymentSettingsChange({
        [provider]: {
          ...(paymentSettings[provider] as object),
          [field]: value,
        },
      } as Partial<PaymentSettings>);
    },
    [handlePaymentSettingsChange, paymentSettings]
  );

  const handleSave = useCallback(async () => {
    // Validate required fields per provider
    const { provider, stripe_nfc, stripe, square, adyen, tap_payments } = paymentSettings;

    if (provider === PaymentProvider.STRIPE_NFC && !stripe_nfc.apiKey) {
      Alert.alert(t('common.error'), t('settings.payment.stripeNfcKeyRequired', { defaultValue: 'API Key is required for Stripe NFC' }));
      return;
    }
    if (provider === PaymentProvider.STRIPE && (!stripe.publishableKey || !stripe.secretKey)) {
      Alert.alert(
        t('common.error'),
        t('settings.payment.stripeKeysRequired', { defaultValue: 'Publishable Key and Secret Key are required for Stripe' })
      );
      return;
    }
    if (provider === PaymentProvider.SQUARE && (!square.accessToken || !square.applicationId)) {
      Alert.alert(
        t('common.error'),
        t('settings.payment.squareKeysRequired', { defaultValue: 'Access Token and Application ID are required for Square' })
      );
      return;
    }
    if (provider === PaymentProvider.ADYEN && (!adyen.apiKey || !adyen.merchantAccount)) {
      Alert.alert(
        t('common.error'),
        t('settings.payment.adyenKeysRequired', { defaultValue: 'API Key and Merchant Account are required for Adyen' })
      );
      return;
    }
    if (provider === PaymentProvider.TAP_PAYMENTS && (!tap_payments.apiKey || !tap_payments.merchantId)) {
      Alert.alert(
        t('common.error'),
        t('settings.payment.tapPaymentsKeysRequired', { defaultValue: 'API Key and Merchant ID are required for Tap Payments' })
      );
      return;
    }

    try {
      await saveSettings(paymentSettings);
      await auditLogService.log('settings:changed', {
        userId: user?.id,
        userName: user?.username,
        details: 'Payment settings updated',
        metadata: { settingName: 'payment', provider: paymentSettings.provider },
      });
    } catch (err) {
      logger.error('Failed to save payment settings:', err instanceof Error ? err : new Error(String(err)));
    }
  }, [saveSettings, paymentSettings, user, logger, t]);

  const handleCancel = useCallback(() => {
    loadSettings().catch(err => logger.error('Failed to reload payment settings on cancel:', err));
  }, [loadSettings, logger]);

  const testPaymentConnection = useCallback(async () => {
    try {
      const success = await testConnection(paymentSettings.provider);
      Alert.alert(
        success ? t('common.success') : t('common.error'),
        success ? t('settings.payment.connectionSuccess') : t('settings.payment.connectionError')
      );
    } catch (err) {
      logger.error('Connection test failed:', err instanceof Error ? err : new Error(String(err)));
      Alert.alert(t('common.error'), t('settings.payment.connectionTestFailed'));
    }
  }, [testConnection, paymentSettings.provider, t, logger]);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderProviderSelection = () => (
    <View style={styles.settingGroup}>
      <Text style={styles.settingLabel}>{t('settings.payment.provider')}</Text>
      <View style={styles.radioGroup}>
        {Object.values(PaymentProvider).map(provider => (
          <TouchableOpacity
            key={provider}
            style={[styles.radioButton, paymentSettings.provider === provider && styles.radioButtonSelected]}
            onPress={() => handleProviderChange(provider)}
            disabled={isLoading}
          >
            <View style={[styles.radioButtonOuter, paymentSettings.provider === provider && styles.radioButtonOuterSelected]}>
              {paymentSettings.provider === provider && <View style={styles.radioButtonInner} />}
            </View>
            <Text style={styles.radioButtonLabel}>{PROVIDER_LABELS[provider]}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const renderStripeNfcForm = () => {
    if (paymentSettings.provider !== PaymentProvider.STRIPE_NFC) return null;
    const s = paymentSettings.stripe_nfc;
    return (
      <View style={styles.settingGroup}>
        <Text style={styles.settingLabel}>{t('settings.payment.stripeNfcSettings')}</Text>

        <View style={styles.inputGroup}>
          <Text>{t('settings.payment.apiKey')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('settings.payment.stripeApiKeyNfcPlaceholder')}
            value={s.apiKey}
            onChangeText={v => handleProviderSettingChange('stripe_nfc', 'apiKey', v)}
            editable={!isLoading}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text>{t('settings.payment.publishableKey')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('settings.payment.publishableKeyPlaceholder')}
            value={s.publishableKey ?? ''}
            onChangeText={v => handleProviderSettingChange('stripe_nfc', 'publishableKey', v)}
            editable={!isLoading}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text>{t('settings.payment.locationId')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('settings.payment.stripeLocationPlaceholder')}
            value={s.merchantId}
            onChangeText={v => handleProviderSettingChange('stripe_nfc', 'merchantId', v)}
            editable={!isLoading}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text>{t('settings.payment.backendUrl')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('settings.payment.backendUrlPlaceholder')}
            value={s.backendUrl}
            onChangeText={v => handleProviderSettingChange('stripe_nfc', 'backendUrl', v)}
            editable={!isLoading}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View style={styles.optionRow}>
          <Text style={styles.label}>{t('settings.payment.enableNfcReader')}</Text>
          <TouchableOpacity
            style={[styles.toggleButton, s.enableNfc ? styles.toggleActive : styles.toggleInactive, isLoading && styles.disabled]}
            onPress={() => handleProviderSettingChange('stripe_nfc', 'enableNfc', !s.enableNfc)}
            disabled={isLoading}
          >
            <Text style={styles.toggleText}>{s.enableNfc ? t('settings.payment.on') : t('settings.payment.off')}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.optionRow}>
          <Text style={styles.label}>{t('settings.payment.useSimulatedReader')}</Text>
          <TouchableOpacity
            style={[styles.toggleButton, s.useSimulatedReader ? styles.toggleActive : styles.toggleInactive, isLoading && styles.disabled]}
            onPress={() => handleProviderSettingChange('stripe_nfc', 'useSimulatedReader', !s.useSimulatedReader)}
            disabled={isLoading}
          >
            <Text style={styles.toggleText}>{s.useSimulatedReader ? t('settings.payment.on') : t('settings.payment.off')}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.verticalButton, styles.testButton, isLoading && styles.buttonDisabled, { marginTop: spacing.md }]}
          onPress={async () => {
            await saveSettings(paymentSettings);
            await testPaymentConnection();
          }}
          disabled={isLoading}
        >
          <Text style={styles.buttonText}>{t('settings.payment.testTerminalConnection')}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderStripeForm = () => {
    if (paymentSettings.provider !== PaymentProvider.STRIPE) return null;
    const s = paymentSettings.stripe;
    return (
      <View style={styles.settingGroup}>
        <Text style={styles.settingLabel}>{t('settings.payment.stripeSettings')}</Text>
        <View style={styles.inputGroup}>
          <Text>{t('settings.payment.apiKey')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('settings.payment.stripeApiKeyPlaceholder')}
            value={s.apiKey ?? ''}
            onChangeText={v => handleProviderSettingChange('stripe', 'apiKey', v)}
            editable={!isLoading}
            secureTextEntry
            autoCapitalize="none"
          />
        </View>
        <View style={styles.inputGroup}>
          <Text>{t('settings.payment.locationId')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('settings.payment.stripeLocationPlaceholder')}
            value={s.locationId ?? ''}
            onChangeText={v => handleProviderSettingChange('stripe', 'locationId', v)}
            editable={!isLoading}
            autoCapitalize="none"
          />
        </View>
      </View>
    );
  };

  const renderSquareForm = () => {
    if (paymentSettings.provider !== PaymentProvider.SQUARE) return null;
    const s = paymentSettings.square;
    return (
      <View style={styles.settingGroup}>
        <Text style={styles.settingLabel}>{t('settings.payment.squareSettings')}</Text>
        <View style={styles.inputGroup}>
          <TextInput
            style={styles.input}
            value={s.applicationId}
            onChangeText={v => handleProviderSettingChange('square', 'applicationId', v)}
            placeholder={t('settings.payment.applicationId')}
            editable={!isLoading}
          />
        </View>
        <View style={styles.inputGroup}>
          <TextInput
            style={styles.input}
            value={s.locationId}
            onChangeText={v => handleProviderSettingChange('square', 'locationId', v)}
            placeholder={t('settings.payment.locationId')}
            editable={!isLoading}
          />
        </View>
        <View style={styles.inputGroup}>
          <TextInput
            style={styles.input}
            value={s.accessToken}
            onChangeText={v => handleProviderSettingChange('square', 'accessToken', v)}
            placeholder={t('settings.payment.accessToken')}
            secureTextEntry
            editable={!isLoading}
          />
        </View>
      </View>
    );
  };

  const renderAdyenForm = () => {
    if (paymentSettings.provider !== PaymentProvider.ADYEN) return null;
    const s = paymentSettings.adyen;
    return (
      <View style={styles.settingGroup}>
        <Text style={styles.settingLabel}>{t('settings.payment.adyenSettings', { defaultValue: 'Adyen Settings' })}</Text>
        <View style={styles.inputGroup}>
          <Text>{t('settings.payment.apiKey')}</Text>
          <TextInput
            style={styles.input}
            value={s.apiKey}
            onChangeText={v => handleProviderSettingChange('adyen', 'apiKey', v)}
            placeholder="AQE..."
            secureTextEntry
            editable={!isLoading}
            autoCapitalize="none"
          />
        </View>
        <View style={styles.inputGroup}>
          <Text>{t('settings.payment.publishableKey', { defaultValue: 'Client Key' })}</Text>
          <TextInput
            style={styles.input}
            value={s.clientKey}
            onChangeText={v => handleProviderSettingChange('adyen', 'clientKey', v)}
            placeholder="test_..."
            editable={!isLoading}
            autoCapitalize="none"
          />
        </View>
        <View style={styles.inputGroup}>
          <Text>{t('settings.payment.merchantAccount', { defaultValue: 'Merchant Account' })}</Text>
          <TextInput
            style={styles.input}
            value={s.merchantAccount}
            onChangeText={v => handleProviderSettingChange('adyen', 'merchantAccount', v)}
            placeholder="YourMerchantAccount"
            editable={!isLoading}
            autoCapitalize="none"
          />
        </View>
        <View style={styles.optionRow}>
          <Text style={styles.label}>{t('settings.payment.environment', { defaultValue: 'Environment' })}</Text>
          <View style={styles.radioGroup}>
            {(['test', 'live'] as const).map(env => (
              <TouchableOpacity
                key={env}
                style={[styles.radioButton, s.environment === env && styles.radioButtonSelected]}
                onPress={() => handleProviderSettingChange('adyen', 'environment', env)}
                disabled={isLoading}
              >
                <View style={[styles.radioButtonOuter, s.environment === env && styles.radioButtonOuterSelected]}>
                  {s.environment === env && <View style={styles.radioButtonInner} />}
                </View>
                <Text style={styles.radioButtonLabel}>{env.charAt(0).toUpperCase() + env.slice(1)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    );
  };

  const renderTapPaymentsForm = () => {
    if (paymentSettings.provider !== PaymentProvider.TAP_PAYMENTS) return null;
    const s = paymentSettings.tap_payments;
    return (
      <View style={styles.settingGroup}>
        <Text style={styles.settingLabel}>{t('settings.payment.tapPaymentsSettings', { defaultValue: 'Tap Payments Settings' })}</Text>
        <View style={styles.inputGroup}>
          <Text>{t('settings.payment.apiKey')}</Text>
          <TextInput
            style={styles.input}
            value={s.apiKey}
            onChangeText={v => handleProviderSettingChange('tap_payments', 'apiKey', v)}
            placeholder="sk_..."
            secureTextEntry
            editable={!isLoading}
            autoCapitalize="none"
          />
        </View>
        <View style={styles.inputGroup}>
          <Text>{t('settings.payment.publishableKey')}</Text>
          <TextInput
            style={styles.input}
            value={s.publishableKey}
            onChangeText={v => handleProviderSettingChange('tap_payments', 'publishableKey', v)}
            placeholder="pk_..."
            editable={!isLoading}
            autoCapitalize="none"
          />
        </View>
        <View style={styles.inputGroup}>
          <Text>{t('settings.payment.merchantId', { defaultValue: 'Merchant ID' })}</Text>
          <TextInput
            style={styles.input}
            value={s.merchantId}
            onChangeText={v => handleProviderSettingChange('tap_payments', 'merchantId', v)}
            placeholder="merchant_..."
            editable={!isLoading}
            autoCapitalize="none"
          />
        </View>
      </View>
    );
  };

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  if (isLoading && !paymentSettings.provider) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={lightColors.primary} />
        <Text style={styles.loadingText}>{t('settings.payment.loadingPayment')}</Text>
      </View>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.sectionTitle}>{t('settings.payment.title')}</Text>

      {renderProviderSelection()}
      {renderStripeNfcForm()}
      {renderStripeForm()}
      {renderSquareForm()}
      {renderAdyenForm()}
      {renderTapPaymentsForm()}

      <View style={styles.optionRow}>
        <Text style={styles.label}>{t('settings.payment.syncInventory')}</Text>
        <TouchableOpacity
          style={[
            styles.toggleButton,
            paymentSettings.syncInventory ? styles.toggleActive : styles.toggleInactive,
            isLoading && styles.disabled,
          ]}
          onPress={() => !isLoading && handlePaymentSettingsChange({ syncInventory: !paymentSettings.syncInventory })}
          disabled={isLoading}
        >
          <Text style={styles.toggleText}>{paymentSettings.syncInventory ? 'ON' : 'OFF'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.verticalButtonGroup}>
        <TouchableOpacity
          style={[styles.verticalButton, styles.testButton, isLoading && styles.buttonDisabled]}
          onPress={testPaymentConnection}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.buttonText}>{t('settings.payment.testConnection')}</Text>
          )}
        </TouchableOpacity>

        <View style={styles.horizontalButtonGroup}>
          <TouchableOpacity
            style={[styles.halfButton, styles.cancelButton, (!hasUnsavedChanges || isLoading) && styles.buttonDisabled]}
            onPress={handleCancel}
            disabled={!hasUnsavedChanges || isLoading}
          >
            <Text style={styles.buttonText}>{t('common.cancel')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.halfButton, styles.saveButton, (!hasUnsavedChanges || isLoading) && styles.buttonDisabled]}
            onPress={handleSave}
            disabled={!hasUnsavedChanges || isLoading}
          >
            {isLoading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.buttonText}>{t('common.save')}</Text>}
          </TouchableOpacity>
        </View>
      </View>

      {(error || saveStatus === 'saved') && (
        <View style={styles.statusContainer}>
          {error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : saveStatus === 'saved' ? (
            <Text style={styles.successText}>{t('settings.payment.settingsSaved')}</Text>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.md, backgroundColor: lightColors.background },
  sectionTitle: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.semiBold as '600',
    marginBottom: spacing.lg,
    color: lightColors.textPrimary,
  },
  settingGroup: {
    marginBottom: spacing.lg,
    backgroundColor: lightColors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    ...elevation.low,
  },
  settingLabel: {
    fontSize: typography.fontSize.md,
    fontWeight: typography.fontWeight.medium as '500',
    color: lightColors.textPrimary,
    marginBottom: spacing.md,
  },
  radioGroup: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.xs },
  radioButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  radioButtonSelected: { backgroundColor: `${lightColors.primary}20` },
  radioButtonOuter: {
    width: 22,
    height: 22,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: lightColors.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  radioButtonOuterSelected: { borderColor: lightColors.primary },
  radioButtonInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: lightColors.primary },
  radioButtonLabel: { fontSize: typography.fontSize.md, color: lightColors.textPrimary },
  inputGroup: { marginBottom: spacing.md },
  input: {
    borderWidth: 1,
    borderColor: lightColors.border,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    fontSize: typography.fontSize.md,
    backgroundColor: lightColors.surface,
    color: lightColors.textPrimary,
  },
  toggleButton: {
    width: 60,
    height: 30,
    borderRadius: borderRadius.round,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
  },
  toggleActive: { backgroundColor: lightColors.primary },
  toggleInactive: { backgroundColor: lightColors.divider },
  toggleText: { color: lightColors.textOnPrimary, fontWeight: typography.fontWeight.bold as '700', fontSize: typography.fontSize.xs },
  disabled: { opacity: 0.5 },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  label: { fontSize: typography.fontSize.md, color: lightColors.textPrimary, flex: 1, marginRight: spacing.md },
  verticalButtonGroup: { width: '100%', paddingHorizontal: spacing.md, marginTop: spacing.md, marginBottom: spacing.xs, gap: spacing.sm },
  horizontalButtonGroup: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', gap: spacing.sm },
  verticalButton: {
    width: '100%',
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    ...elevation.low,
  },
  halfButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    ...elevation.low,
  },
  statusContainer: {
    width: '100%',
    padding: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    backgroundColor: `${lightColors.info}10`,
    borderRadius: borderRadius.md,
    borderLeftWidth: 4,
    borderLeftColor: lightColors.primary,
  },
  saveButton: { backgroundColor: lightColors.primary },
  testButton: { backgroundColor: lightColors.success },
  cancelButton: { backgroundColor: lightColors.textSecondary },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: lightColors.textOnPrimary, fontSize: typography.fontSize.md, fontWeight: typography.fontWeight.semiBold as '600' },
  errorText: { color: lightColors.error, fontSize: typography.fontSize.md, fontWeight: typography.fontWeight.medium as '500' },
  successText: { color: lightColors.success, fontSize: typography.fontSize.md, fontWeight: typography.fontWeight.medium as '500' },
  loadingText: { marginTop: spacing.md, color: lightColors.textSecondary, fontSize: typography.fontSize.md, textAlign: 'center' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
});

export default PaymentSettingsTab;
