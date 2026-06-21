import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { submitProofOfWork } from '../../../lib/proofs';
import { colors, fonts, radius, spacing } from '../../../lib/theme';

type PickedImage = {
  uri: string;
  base64: string;
  contentType: string;
};

// PROOF OF WORK upload (Step 8). The worker picks or takes a photo, then submits.
// The submit handler uploads to private storage and calls submit_proof, which
// re-opens the QR session for the client's final confirmation scan.
export default function SubmitProof() {
  const { hireId } = useLocalSearchParams<{ hireId: string }>();
  const router = useRouter();

  const [image, setImage] = useState<PickedImage | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Turn an ImagePicker asset into the small shape we need, guessing the content
  // type from the file extension (ImagePicker doesn't always set mimeType).
  function toPickedImage(asset: ImagePicker.ImagePickerAsset): PickedImage | null {
    // Guard: we requested base64, but bail clearly if it's somehow missing.
    if (!asset.base64) return null;
    const isPng = asset.uri.toLowerCase().endsWith('.png');
    return {
      uri: asset.uri,
      base64: asset.base64,
      contentType: isPng ? 'image/png' : 'image/jpeg',
    };
  }

  async function pickFromLibrary() {
    setError('');
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    // Guard: no permission -> tell the user instead of failing silently.
    if (!permission.granted) {
      return setError('Photo library permission is required to choose a photo.');
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.6,
    });
    if (result.canceled) return;
    const picked = toPickedImage(result.assets[0]);
    if (!picked) return setError('Could not read that image. Please try another.');
    setImage(picked);
  }

  async function takePhoto() {
    setError('');
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    // Guard: no camera permission -> clear message.
    if (!permission.granted) {
      return setError('Camera permission is required to take a photo.');
    }
    const result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.6 });
    if (result.canceled) return;
    const picked = toPickedImage(result.assets[0]);
    if (!picked) return setError('Could not read that photo. Please try again.');
    setImage(picked);
  }

  async function handleSubmit() {
    setError('');
    // Guard: a hire id and a chosen image are both required.
    if (!hireId) return setError('This job could not be found.');
    if (!image) return setError('Please choose or take a photo first.');

    setSubmitting(true);
    const result = await submitProofOfWork(hireId, image.base64, image.contentType, note);
    setSubmitting(false);

    if (!result.success) return setError(result.message);
    router.back();
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Submit Proof of Work' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="bodyMedium" style={styles.note}>
          Upload a photo showing the completed work. The client confirms
          completion after you submit.
        </Text>

        <View style={styles.pickRow}>
          <Button mode="outlined" icon="image" onPress={pickFromLibrary} style={styles.pickButton}>
            Choose Photo
          </Button>
          <Button mode="outlined" icon="camera" onPress={takePhoto} style={styles.pickButton}>
            Take Photo
          </Button>
        </View>

        {image ? (
          <Image source={{ uri: image.uri }} style={styles.preview} contentFit="cover" />
        ) : null}

        <TextInput
          label="Note (optional)"
          mode="outlined"
          value={note}
          onChangeText={setNote}
          multiline
          style={styles.input}
          outlineStyle={styles.inputOutline}
        />

        <HelperText type="error" visible={!!error}>
          {error}
        </HelperText>

        <Button
          mode="contained"
          onPress={handleSubmit}
          loading={submitting}
          disabled={submitting || !image}
          style={styles.button}
          contentStyle={styles.buttonContent}
          labelStyle={styles.buttonLabel}
        >
          Submit Proof
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg },
  note: { color: colors.textMuted, marginBottom: spacing.lg },
  pickRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  pickButton: { flex: 1, borderRadius: radius.pill },
  preview: { width: '100%', height: 240, borderRadius: radius.lg, marginBottom: spacing.lg },
  input: { marginBottom: spacing.sm, backgroundColor: colors.surface },
  inputOutline: { borderRadius: radius.md },
  button: { borderRadius: radius.pill, marginTop: spacing.md },
  buttonContent: { paddingVertical: spacing.sm },
  buttonLabel: { fontFamily: fonts.bodyBold, fontSize: 16 },
});
