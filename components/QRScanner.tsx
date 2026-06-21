import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useEffect, useRef } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { Button, IconButton, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radius, spacing } from '../lib/theme';

type Props = {
  visible: boolean;
  title?: string;
  onScanned: (data: string) => void;
  onClose: () => void;
};

// Camera QR scanner in a modal. Returns the decoded string to the parent; it has
// no idea what the payload means (the parent validates it). Only one camera
// preview may be active at a time, so we mount CameraView only while visible.
export default function QRScanner({ visible, title, onScanned, onClose }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  // Fire onScanned only once per open — the camera streams many frames.
  const handled = useRef(false);

  useEffect(() => {
    if (visible) handled.current = false;
  }, [visible]);

  function handleBarcode(result: { data: string }) {
    // Guard: ignore extra frames after the first successful scan.
    if (handled.current) return;
    handled.current = true;
    onScanned(result.data);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text variant="titleMedium" style={styles.title}>
            {title ?? 'Scan QR code'}
          </Text>
          <IconButton icon="close" onPress={onClose} iconColor={colors.onPrimary} />
        </View>

        {!permission ? (
          <View style={styles.center}>
            <Text style={styles.message}>Checking camera permission…</Text>
          </View>
        ) : !permission.granted ? (
          <View style={styles.center}>
            <Text style={styles.message}>
              We need camera access to scan the job code.
            </Text>
            <Button mode="contained" onPress={requestPermission} style={styles.permissionBtn}>
              Grant permission
            </Button>
          </View>
        ) : (
          <View style={styles.cameraWrap}>
            {/* Only QR codes are scanned; other barcode types are ignored. */}
            <CameraView
              style={styles.camera}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={handleBarcode}
            />
            <View style={styles.reticle} pointerEvents="none" />
            <Text style={styles.hint}>Point the camera at the worker&apos;s code</Text>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.text },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: spacing.lg,
  },
  title: { color: colors.onPrimary, fontFamily: fonts.bodyBold },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.lg },
  message: { color: colors.onPrimary, textAlign: 'center' },
  permissionBtn: { borderRadius: radius.pill },
  cameraWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  camera: { ...StyleSheet.absoluteFillObject },
  reticle: {
    width: 240,
    height: 240,
    borderWidth: 3,
    borderColor: colors.onPrimary,
    borderRadius: radius.lg,
    backgroundColor: 'transparent',
  },
  hint: { color: colors.onPrimary, marginTop: spacing.xl, fontFamily: fonts.bodyMedium },
});
