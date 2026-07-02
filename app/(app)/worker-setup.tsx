import { Stack, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import KeyboardAvoider from '../../components/ui/KeyboardAvoider';
import { getReadableLocation } from '../../lib/location';
import { useRole } from '../../lib/role-context';
import { saveWorkerProfile } from '../../lib/workerProfile';
import { colors, fonts, radius, spacing } from '../../lib/theme';

const MIN_BIO_CHARS = 50;
const BIO_LIMIT = 500;

// Worker setup form — manual only (no AI). Collects a bio + location, saves the
// worker_profiles row, then continues straight into creating the first skill
// post. The GPS icon is a convenience: the location field is always editable.
export default function WorkerSetup() {
  const router = useRouter();
  const { refreshWorkerProfile } = useRole();

  const [bio, setBio] = useState('');
  const [location, setLocation] = useState('');
  // Inline note shown when the user denies the location permission (non-blocking).
  const [locationNote, setLocationNote] = useState('');
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const bioCount = bio.trim().length;

  // GPS icon handler: request permission, capture + reverse-geocode, auto-fill.
  async function handleUseGps() {
    setError('');
    setLocationNote('');
    setLocating(true);
    const result = await getReadableLocation();
    setLocating(false);

    // Guard: permission denied — do NOT block setup; leave the field manual.
    if (!result.granted) {
      setLocationNote('Location access denied — you can type your location manually.');
      return;
    }
    // On success (a real address OR a raw-coordinates fallback) fill the field.
    setLocation(result.address);
  }

  async function handleContinue() {
    setError('');

    // Guard: bio must meet the minimum so the worker says something meaningful.
    if (bioCount < MIN_BIO_CHARS) {
      return setError(`Tell us a bit more — at least ${MIN_BIO_CHARS} characters.`);
    }
    // Guard: bio must fit the maximum length.
    if (bio.length > BIO_LIMIT) {
      return setError(`Your bio must be under ${BIO_LIMIT} characters.`);
    }
    // Guard: location is required (typed manually or captured via GPS).
    if (!location.trim()) return setError('Please enter your location.');

    setSaving(true);
    const result = await saveWorkerProfile({ bio, location });
    if (!result.success) {
      setSaving(false);
      return setError(result.message);
    }

    // Refresh + switch into the worker view, then land on the Job screen (the
    // worker's home). They can create their first skill post from there.
    await refreshWorkerProfile(true);
    setSaving(false);
    router.replace('/feed');
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Service Provider Setup' }} />
      <KeyboardAvoider style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text variant="bodyMedium" style={styles.note}>
          Tell us about yourself and where you&apos;re based. You&apos;ll add the
          skills you offer in the next step.
        </Text>

        <TextInput
          label="Tell me about yourself"
          mode="outlined"
          value={bio}
          onChangeText={setBio}
          multiline
          numberOfLines={6}
          maxLength={BIO_LIMIT}
          placeholder={`Write at least ${MIN_BIO_CHARS} characters about who you are and the work you do.`}
          style={styles.input}
          outlineStyle={styles.inputOutline}
        />
        <Text variant="bodySmall" style={styles.counter}>
          {bio.length}/{BIO_LIMIT} chars (min {MIN_BIO_CHARS})
        </Text>

        <TextInput
          label="Location"
          mode="outlined"
          value={location}
          onChangeText={setLocation}
          placeholder="e.g. Lahug, Cebu City"
          style={styles.input}
          outlineStyle={styles.inputOutline}
          right={
            <TextInput.Icon
              icon={locating ? 'loading' : 'crosshairs-gps'}
              onPress={handleUseGps}
              disabled={locating}
              accessibilityLabel="Use my current location"
            />
          }
        />
        {/* Permission-denied hint (non-blocking) shown beside the field. */}
        <HelperText type="info" visible={!!locationNote}>
          {locationNote}
        </HelperText>

        <HelperText type="error" visible={!!error}>
          {error}
        </HelperText>

        <Button
          mode="contained"
          onPress={handleContinue}
          loading={saving}
          disabled={saving}
          style={styles.button}
          contentStyle={styles.buttonContent}
          labelStyle={styles.buttonLabel}
        >
          Continue
        </Button>
      </ScrollView>
      </KeyboardAvoider>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  note: { color: colors.textMuted, marginBottom: spacing.lg },
  input: { marginBottom: spacing.xs, backgroundColor: colors.surface },
  inputOutline: { borderRadius: radius.md },
  counter: { color: colors.textFaint, textAlign: 'right', marginBottom: spacing.sm },
  button: { borderRadius: radius.pill, marginTop: spacing.md },
  buttonContent: { paddingVertical: spacing.sm },
  buttonLabel: { fontFamily: fonts.bodyBold, fontSize: 16 },
});
