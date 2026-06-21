import React from 'react';
import { StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Surface, Text } from 'react-native-paper';
import { colors, fonts, radius, spacing } from '../lib/theme';

type Props = {
  value: string; // the payload to encode (a reference id + token, never money)
  label?: string;
  caption?: string;
};

// Renders a scannable QR for a given payload. The payload is opaque here — this
// component knows nothing about escrow; it just draws whatever string it's given
// (see lib/escrow.buildQrPayload for what actually goes in).
export default function QRDisplay({ value, label, caption }: Props) {
  return (
    <Surface style={styles.card} elevation={1}>
      {label ? (
        <Text variant="titleSmall" style={styles.label}>
          {label}
        </Text>
      ) : null}
      <View style={styles.qrWrap}>
        <QRCode value={value} size={180} color={colors.text} backgroundColor={colors.surface} />
      </View>
      {caption ? (
        <Text variant="bodySmall" style={styles.caption}>
          {caption}
        </Text>
      ) : null}
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  label: { fontFamily: fonts.bodyBold, color: colors.text },
  qrWrap: { padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md },
  caption: { color: colors.textMuted, textAlign: 'center' },
});
