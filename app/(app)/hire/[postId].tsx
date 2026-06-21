import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import CalendarField from '../../../components/ui/CalendarField';
import KeyboardAvoider from '../../../components/ui/KeyboardAvoider';
import TimeField from '../../../components/ui/TimeField';
import { createHireRequest } from '../../../lib/hireRequests';
import { getReadableLocation } from '../../../lib/location';
import { getWorkerProfile } from '../../../lib/worker';
import { colors, fonts, radius, spacing } from '../../../lib/theme';

const DETAILS_LIMIT = 300;

// HIRE REQUEST FORM (Part 2). The client confirms the WORK-SITE location (their
// place — the worker travels there), picks a future date + time, and can add
// optional details. Date/time use the project's Dropdown (no native picker
// dependency); only future options are offered and the future check is also
// enforced on submit. The post + worker ids are derived server-side, never
// trusted from params beyond the post being hired.
export default function HireRequestForm() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();

  const [location, setLocation] = useState('');
  const [locationNote, setLocationNote] = useState('');
  const [locating, setLocating] = useState(false);
  const [dateValue, setDateValue] = useState('');
  const [timeValue, setTimeValue] = useState('');
  const [details, setDetails] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  // Pre-fill the work site from the user's saved profile location, if any.
  useEffect(() => {
    let active = true;
    (async () => {
      const profile = await getWorkerProfile();
      if (active && profile?.location) setLocation(profile.location);
    })();
    return () => {
      active = false;
    };
  }, []);

  // GPS icon handler: request permission, capture + reverse-geocode, auto-fill.
  async function handleUseGps() {
    setError('');
    setLocationNote('');
    setLocating(true);
    const result = await getReadableLocation();
    setLocating(false);
    // Guard: permission denied — keep the field manual, don't block.
    if (!result.granted) {
      setLocationNote('Location access denied — you can type the work site manually.');
      return;
    }
    setLocation(result.address);
  }

  async function handleSubmit() {
    setError('');

    // Guard: the work site must not be empty.
    if (!location.trim()) return setError('Please enter the work-site location.');
    // Guard: both a date and a time must be chosen.
    if (!dateValue || !timeValue) return setError('Please choose a date and time.');

    // Build the chosen moment in LOCAL time, then re-check it is in the future.
    const scheduledAt = new Date(`${dateValue}T${timeValue}:00`);
    if (Number.isNaN(scheduledAt.getTime())) return setError('Please choose a valid date and time.');
    if (scheduledAt.getTime() <= Date.now()) {
      return setError('Please choose a date and time in the future.');
    }

    setSubmitting(true);
    const result = await createHireRequest({
      workerPostId: String(postId),
      clientLocation: location,
      scheduledAt,
      details,
    });
    setSubmitting(false);

    // Guard: show the failure inline and stay on the form.
    if (!result.success) return setError(result.message);
    setSent(true);
  }

  // Confirmation state once the request is sent.
  if (sent) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Request Sent' }} />
        <Ionicons name="checkmark-circle" size={64} color={colors.primary} />
        <Text variant="titleMedium" style={styles.sentTitle}>
          Request sent
        </Text>
        <Text variant="bodyMedium" style={styles.sentBody}>
          Waiting for the worker to respond. You&apos;ll get a chat for this job once
          they accept.
        </Text>
        <Button
          mode="contained"
          onPress={() => router.back()}
          style={styles.button}
          contentStyle={styles.buttonContent}
          labelStyle={styles.buttonLabel}
        >
          Done
        </Button>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Request a Hire' }} />
      <KeyboardAvoider style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextInput
          label="Work-site location"
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
        <HelperText type="info" visible>
          This will be the work site — the worker will travel here.
        </HelperText>
        {/* Work-site confirmation (static info, not an input). */}
        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
          <Text variant="bodySmall" style={styles.infoText}>
            The location above will be used as the work site for this job.
          </Text>
        </View>
        <HelperText type="info" visible={!!locationNote}>
          {locationNote}
        </HelperText>

        <CalendarField
          label="Date required"
          value={dateValue}
          onChange={(next) => {
            setDateValue(next);
            // Clear a now-invalid time when the date changes (e.g. today's past slots).
            setTimeValue('');
          }}
          style={styles.field}
        />
        <TimeField
          label="Time required"
          value={timeValue}
          onChange={setTimeValue}
          date={dateValue}
          style={styles.field}
        />

        <TextInput
          label="Extra details (optional)"
          mode="outlined"
          value={details}
          onChangeText={setDetails}
          multiline
          numberOfLines={4}
          maxLength={DETAILS_LIMIT}
          placeholder="Anything the worker should know about the job."
          style={styles.input}
          outlineStyle={styles.inputOutline}
        />
        <Text variant="bodySmall" style={styles.counter}>
          {details.length}/{DETAILS_LIMIT} chars
        </Text>

        <HelperText type="error" visible={!!error}>
          {error}
        </HelperText>

        <Button
          mode="contained"
          onPress={handleSubmit}
          loading={submitting}
          disabled={submitting}
          style={styles.button}
          contentStyle={styles.buttonContent}
          labelStyle={styles.buttonLabel}
        >
          {submitting ? 'Sending request…' : 'Send Hire Request'}
        </Button>
      </ScrollView>
      </KeyboardAvoider>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.md },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  input: { marginBottom: spacing.xs, backgroundColor: colors.surface },
  inputOutline: { borderRadius: radius.md },
  field: { marginBottom: spacing.md },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primarySofter,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  infoText: { flex: 1, color: colors.textMuted },
  counter: { color: colors.textFaint, textAlign: 'right', marginBottom: spacing.sm },
  sentTitle: { color: colors.text, fontFamily: fonts.displaySemi },
  sentBody: { color: colors.textMuted, textAlign: 'center' },
  button: { borderRadius: radius.pill, marginTop: spacing.md, alignSelf: 'stretch' },
  buttonContent: { paddingVertical: spacing.sm },
  buttonLabel: { fontFamily: fonts.bodyBold, fontSize: 16 },
});
