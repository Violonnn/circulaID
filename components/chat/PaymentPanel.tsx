import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Image, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Dialog, Portal, Snackbar, Surface, Text, TextInput } from 'react-native-paper';
import {
  buildPayQr,
  cancelHire,
  confirmSatisfied,
  getChatPayment,
  markJobDone,
  parsePayQr,
  payForHire,
  sendFinalPrice,
  type ChatPayment,
} from '../../lib/payment';
import { HIRE_STATUS } from '../../lib/constants';
import { formatPeso } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../lib/theme';
import QRDisplay from '../QRDisplay';
import QRScanner from '../QRScanner';

type Props = {
  threadId: string;
  // Called after the client's confirmation releases payment, so the chat screen
  // can send the client on to the rating screen.
  onReleased: (hireRequestId: string) => void;
};

// The negotiated payment brain embedded in the locked job chat. It picks the one
// correct action for the current side + phase. All money moves live in
// lib/payment; this component is only UI orchestration.
export default function PaymentPanel({ threadId, onReleased }: Props) {
  const router = useRouter();
  const [info, setInfo] = useState<ChatPayment | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pricing, setPricing] = useState(false);
  const [amount, setAmount] = useState('');
  const [photo, setPhoto] = useState<{ base64: string; mime: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [snack, setSnack] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);

  const load = useCallback(async () => {
    setInfo(await getChatPayment(threadId));
    setLoading(false);
  }, [threadId]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime: any change to this hire (price set, paid, done, released) reloads
  // so both devices stay in sync. Unique topic per mount avoids re-subscribe errors.
  useEffect(() => {
    if (!info?.hireRequestId) return;
    const channel = supabase
      .channel(`chat-payment-${info.hireRequestId}-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'hire_requests', filter: `id=eq.${info.hireRequestId}` },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [info?.hireRequestId, load]);

  async function run(action: () => Promise<{ success: boolean; message: string }>) {
    setBusy(true);
    const result = await action();
    setBusy(false);
    setSnack(result.message);
    if (result.success) await load();
    return result.success;
  }

  async function handleSendPrice() {
    const ok = await run(() => sendFinalPrice(info!.hireRequestId, Number(amount)));
    if (ok) {
      setPricing(false);
      setAmount('');
    }
  }

  async function attachPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo access to attach a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.5,
      base64: true,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset?.base64) {
      Alert.alert('Could not read image', 'Please try a different photo.');
      return;
    }
    setPhoto({ base64: asset.base64, mime: asset.mimeType ?? 'image/jpeg' });
  }

  async function handleMarkDone() {
    if (!photo) return;
    const ok = await run(() => markJobDone(info!.hireRequestId, photo.base64, photo.mime));
    if (ok) setPhoto(null);
  }

  async function handleScan(data: string) {
    setScanning(false);
    const scannedHire = parsePayQr(data);
    // Guard: not one of our payment codes, or for a different job.
    if (!scannedHire) return setSnack('That QR code is not recognized.');
    if (scannedHire !== info!.hireRequestId) return setSnack('This code is for a different job.');
    await run(() => payForHire(info!.hireRequestId));
  }

  // Cancel is offered to BOTH parties during the pre-payment ('accepted') phase.
  // The confirmation uses the app's themed Dialog (see the return below), not a
  // native Alert, so it stays bubbly/soft and on-font with the rest of the app.
  async function handleCancelHire() {
    const ok = await run(() => cancelHire(info!.hireRequestId));
    if (ok) setCancelOpen(false);
  }

  if (loading) return <ActivityIndicator style={styles.loader} />;
  if (!info) return null;

  // Pre-payment phase: accepted and nothing held yet -> either side may cancel.
  const cancellable = info.status === HIRE_STATUS.ACCEPTED && info.heldAmount === null;
  const cancelLabel = info.isWorker ? 'Cancel request' : 'Cancel hire';

  return (
    <Surface style={styles.panel} elevation={1}>
      {renderBody()}
      {cancellable ? (
        <Button
          onPress={() => setCancelOpen(true)}
          disabled={busy}
          textColor={colors.danger}
          icon="close-circle-outline"
        >
          {cancelLabel}
        </Button>
      ) : null}

      {/* Themed confirmation (matches the app's other dialogs) instead of a
          native Alert. */}
      <Portal>
        <Dialog visible={cancelOpen} onDismiss={() => !busy && setCancelOpen(false)}>
          <Dialog.Title>{cancelLabel}?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              This cancels the job before any payment. This cannot be undone.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setCancelOpen(false)} disabled={busy}>
              Keep
            </Button>
            <Button
              mode="contained"
              buttonColor={colors.danger}
              onPress={handleCancelHire}
              loading={busy}
              disabled={busy}
            >
              {cancelLabel}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <QRScanner
        visible={scanning}
        title="Scan payment code"
        onScanned={handleScan}
        onClose={() => setScanning(false)}
      />
      <Snackbar visible={!!snack} onDismiss={() => setSnack('')} duration={3000}>
        {snack}
      </Snackbar>
    </Surface>
  );

  function renderBody() {
    const { status, isClient, isWorker, finalAmount, workDone, heldAmount, walletBalance } = info!;

    // Terminal: funds released ('paid' = job completed + paid out). A receipt row
    // was generated server-side at this point, so offer to view/export it.
    if (status === HIRE_STATUS.PAID || status === HIRE_STATUS.COMPLETED) {
      return (
        <View style={styles.col}>
          <Info tone="success" text="Job completed — payment released." />
          <Button
            mode="contained"
            icon="receipt"
            onPress={() =>
              router.push({
                pathname: '/receipt/[hireId]',
                params: { hireId: info!.hireRequestId },
              })
            }
            style={styles.fullBtn}
            contentStyle={styles.fullBtnContent}
          >
            View receipt
          </Button>
        </View>
      );
    }

    // Terminal: the hire was cancelled (before payment) or declined.
    if (status === HIRE_STATUS.CANCELLED || status === HIRE_STATUS.REJECTED) {
      return <Info text="This hire was cancelled." />;
    }

    // PHASE: awaiting payment (accepted + price set, nothing held yet).
    const awaitingPayment = status === HIRE_STATUS.ACCEPTED && finalAmount != null && heldAmount === null;
    // PHASE: awaiting the client's confirmation (in progress + worker marked done).
    const awaitingConfirm = status === HIRE_STATUS.IN_PROGRESS && workDone;

    if (isWorker) {
      // PART 1: set the negotiated price.
      if (status === HIRE_STATUS.ACCEPTED && finalAmount == null) {
        if (pricing) {
          return (
            <View style={styles.col}>
              <TextInput
                mode="outlined"
                label="Final price (₱)"
                value={amount}
                onChangeText={setAmount}
                keyboardType="numeric"
                outlineStyle={styles.outline}
                style={styles.amountInput}
              />
              <View style={styles.row}>
                <Button onPress={() => setPricing(false)} disabled={busy}>Cancel</Button>
                <Button mode="contained" onPress={handleSendPrice} loading={busy} disabled={busy} style={styles.btn}>
                  Send Price
                </Button>
              </View>
            </View>
          );
        }
        return (
          <Button mode="contained" icon="cash" onPress={() => setPricing(true)} style={styles.btn}>
            Send Final Price
          </Button>
        );
      }
      // PART 2 (worker side): show a QR the client can scan in person to pay.
      if (awaitingPayment) {
        return (
          <View style={styles.col}>
            <QRDisplay
              value={buildPayQr(info!.hireRequestId)}
              label="Payment code"
              caption={`Ask the client to scan this to pay ${formatPeso(finalAmount)}, or they can tap "Pay Now".`}
            />
          </View>
        );
      }
      // PART 3: mark done with a required photo.
      if (status === HIRE_STATUS.IN_PROGRESS && !workDone) {
        return (
          <View style={styles.col}>
            {photo ? (
              <Image source={{ uri: `data:${photo.mime};base64,${photo.base64}` }} style={styles.preview} />
            ) : (
              <Text style={styles.note}>Attach at least 1 photo to mark as done.</Text>
            )}
            <Button onPress={attachPhoto} disabled={busy} icon="camera">
              {photo ? 'Change photo' : 'Attach photo'}
            </Button>
            <Button
              mode="contained"
              icon="check"
              onPress={handleMarkDone}
              loading={busy}
              disabled={busy || !photo}
              style={styles.fullBtn}
              contentStyle={styles.fullBtnContent}
            >
              Mark as Done
            </Button>
          </View>
        );
      }
      if (awaitingConfirm) {
        return <Info text="Waiting for the client to confirm completion…" />;
      }
      return <Info text="Waiting for the client to pay." />;
    }

    if (isClient) {
      if (status === HIRE_STATUS.ACCEPTED && finalAmount == null) {
        return <Info text="Waiting for the worker to send a final price." />;
      }
      // PART 2 (client side): Pay Now button + scan-the-QR — both call payForHire.
      if (awaitingPayment) {
        return (
          <View style={styles.col}>
            <Text style={styles.amountLabel}>Amount due: {formatPeso(finalAmount)}</Text>
            {walletBalance !== null ? (
              <Text style={styles.muted}>Your balance: {formatPeso(walletBalance)}</Text>
            ) : null}
            <Button
              mode="contained"
              icon="cash"
              onPress={() => run(() => payForHire(info!.hireRequestId))}
              loading={busy}
              disabled={busy}
              style={styles.fullBtn}
              contentStyle={styles.fullBtnContent}
            >
              Pay Now
            </Button>
            <Button onPress={() => setScanning(true)} disabled={busy} icon="qrcode-scan">
              Scan QR instead
            </Button>
          </View>
        );
      }
      if (status === HIRE_STATUS.IN_PROGRESS && !workDone) {
        return (
          <Info
            text={`Payment${heldAmount !== null ? ` of ${formatPeso(heldAmount)}` : ''} is held in escrow. Waiting for the worker to finish.`}
          />
        );
      }
      // PART 4: confirm satisfaction → release.
      if (awaitingConfirm) {
        return (
          <Button
            mode="contained"
            icon="check-decagram"
            onPress={async () => {
              const ok = await run(() => confirmSatisfied(info!.hireRequestId));
              if (ok) onReleased(info!.hireRequestId);
            }}
            loading={busy}
            disabled={busy}
            style={styles.btn}
          >
            Confirm Satisfied
          </Button>
        );
      }
    }

    return <Info text="This job's payment steps will appear here." />;
  }
}

function Info({ text, tone }: { text: string; tone?: 'success' }) {
  return (
    <Text variant="bodyMedium" style={[styles.info, tone === 'success' && styles.infoSuccess]}>
      {tone === 'success' ? '✓ ' : ''}
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  loader: { marginVertical: spacing.md },
  panel: {
    margin: spacing.md,
    marginBottom: 0,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
    gap: spacing.sm,
  },
  col: { gap: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.sm },
  btn: { borderRadius: radius.pill },
  fullBtn: { borderRadius: radius.pill, alignSelf: 'stretch' },
  fullBtnContent: { paddingVertical: spacing.xs },
  outline: { borderRadius: radius.md },
  amountInput: { backgroundColor: colors.surface },
  amountLabel: { fontFamily: fonts.bodyBold, color: colors.text, textAlign: 'center' },
  muted: { color: colors.textMuted, textAlign: 'center' },
  note: { color: colors.textMuted, textAlign: 'center', fontFamily: fonts.bodyMedium },
  preview: { width: '100%', height: 160, borderRadius: radius.md, backgroundColor: colors.surface },
  info: { color: colors.textMuted, textAlign: 'center', fontFamily: fonts.bodyMedium },
  infoSuccess: { color: colors.success },
});
