import { Stack, useLocalSearchParams } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Snackbar, Surface, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRDisplay from '../../../components/QRDisplay';
import BrandHeaderTitle from '../../../components/ui/BrandHeaderTitle';
import { formatDateTime, formatPeso } from '../../../lib/format';
import { getReceiptForHire, type ReceiptView } from '../../../lib/receipts';
import { colors, fonts, radius, shadow, spacing } from '../../../lib/theme';

// RECEIPT SCREEN. A read-only, themed digital receipt for a completed hire, with
// a "Download PDF" export. The data comes from the RLS-scoped receipts read in
// lib/receipts (no schema/escrow writes happen here).
export default function ReceiptScreen() {
  const { hireId } = useLocalSearchParams<{ hireId: string }>();
  const [receipt, setReceipt] = useState<ReceiptView | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [snack, setSnack] = useState('');

  const load = useCallback(async () => {
    // Guard: no hire id means nothing to load.
    if (!hireId) {
      setLoading(false);
      return;
    }
    setReceipt(await getReceiptForHire(hireId));
    setLoading(false);
  }, [hireId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDownload() {
    // Guard: nothing to export without a loaded receipt.
    if (!receipt) return;
    setExporting(true);
    try {
      const { uri } = await Print.printToFileAsync({ html: buildHtml(receipt) });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Receipt' });
      } else {
        setSnack('Sharing is not available on this device.');
      }
    } catch {
      // Guard: a failed export shows a message and never leaves a stuck spinner.
      setSnack('Could not generate the receipt.');
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Receipt' }} />
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  // Guard: not a party / not completed yet -> a friendly message, never blank.
  if (!receipt) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Receipt' }} />
        <Text variant="bodyMedium">Receipt not available.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Receipt' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Surface style={styles.card} elevation={1}>
          <View style={styles.brand}>
            <BrandHeaderTitle />
          </View>
          <Text variant="titleMedium" style={styles.heading}>
            Official Transaction Receipt
          </Text>

          <Row label="Receipt No." value={receipt.id} />
          <Row label="Job" value={receipt.postTitle ?? '—'} />
          <Row label="Service Provider" value={receipt.workerName} />
          <Row label="Client" value={receipt.clientName} />
          <Row label="Amount" value={`${formatPeso(receipt.amount)} (simulated)`} />
          <Row label="Started" value={formatDateTime(receipt.startedAt) || '—'} />
          <Row label="Completed" value={formatDateTime(receipt.completedAt) || '—'} />

          <View style={styles.qr}>
            <QRDisplay value={receipt.id} label="Verification code" caption="Scan to look up this receipt." />
          </View>
          <Text variant="bodySmall" style={styles.verified}>
            Verified by CirculaID
          </Text>
        </Surface>

        <Button
          mode="contained"
          icon="download"
          onPress={handleDownload}
          loading={exporting}
          disabled={exporting}
          style={styles.button}
          contentStyle={styles.buttonContent}
        >
          Download PDF
        </Button>
      </ScrollView>

      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={3000}>
        {snack}
      </Snackbar>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text variant="bodySmall" style={styles.rowLabel}>
        {label}
      </Text>
      <Text variant="bodyMedium" style={styles.rowValue} selectable>
        {value}
      </Text>
    </View>
  );
}

// Build the printable HTML from the same data shown on screen. User-derived text
// (names, job title) is escaped so it can never break or inject into the markup.
function buildHtml(r: ReceiptView): string {
  const generated = new Date().toLocaleString();
  const rows =
    htmlRow('Receipt No.', r.id) +
    htmlRow('Job', r.postTitle ?? '—') +
    htmlRow('Service Provider', r.workerName) +
    htmlRow('Client', r.clientName) +
    htmlRow('Amount', `${formatPeso(r.amount)} (simulated)`) +
    htmlRow('Started', formatDateTime(r.startedAt) || '—') +
    htmlRow('Completed', formatDateTime(r.completedAt) || '—');
  return `<html><body style="font-family:-apple-system,Roboto,Helvetica,sans-serif;color:#1a1a1a;padding:28px">
    <h1 style="color:#aa0cbe;margin:0">circulaID</h1>
    <h2 style="margin:4px 0 16px">Official Transaction Receipt</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>
    <hr style="margin:20px 0;border:none;border-top:1px solid #eee"/>
    <p style="font-size:11px;color:#777">Generated ${escapeHtml(generated)} · Verified by CirculaID</p>
  </body></html>`;
}

function htmlRow(label: string, value: string): string {
  return `<tr><td style="padding:6px 8px;color:#777;width:40%">${escapeHtml(label)}</td><td style="padding:6px 8px;font-weight:600">${escapeHtml(value)}</td></tr>`;
}

// Escape any text before placing it into the PDF HTML.
function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  card: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadow.card,
  },
  brand: { alignItems: 'center', marginBottom: spacing.xs },
  heading: { fontFamily: fonts.displaySemi, color: colors.text, textAlign: 'center', marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  rowLabel: { color: colors.textMuted, width: 110 },
  rowValue: { flex: 1, color: colors.text },
  qr: { marginTop: spacing.md },
  verified: { color: colors.textFaint, textAlign: 'center', marginTop: spacing.sm },
  button: { borderRadius: radius.pill, marginTop: spacing.lg },
  buttonContent: { paddingVertical: spacing.sm },
});
