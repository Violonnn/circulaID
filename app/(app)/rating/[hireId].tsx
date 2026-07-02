import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, HelperText, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getRatingForHire, submitRating } from '../../../lib/ratings';
import { supabase } from '../../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../../lib/theme';

const COMMENT_LIMIT = 200;

// RATING SCREEN (Part 3). Shown to the client right after the finish-scan
// releases payment. Rating is OPTIONAL — "Skip for now" leaves the hire done.
// Validation + the one-rating-per-hire guard live in lib/ratings; this screen
// only collects the stars + an optional short comment.
export default function RatingScreen() {
  const { hireId } = useLocalSearchParams<{ hireId: string }>();
  const router = useRouter();

  const [workerId, setWorkerId] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [alreadyRated, setAlreadyRated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    // Guard: no hire id means there is nothing to rate.
    if (!hireId) {
      setError('This job could not be found.');
      setLoading(false);
      return;
    }
    // Guard: a client can only rate a hire once — check before showing the form.
    const existing = await getRatingForHire(hireId);
    if (existing) setAlreadyRated(true);

    const { data } = await supabase
      .from('hire_requests')
      .select('worker_id')
      .eq('id', hireId)
      .maybeSingle();
    setWorkerId(data?.worker_id ?? null);
    setLoading(false);
  }, [hireId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit() {
    setError('');
    // Guard: a hire + worker must be resolved, and a star must be chosen.
    if (!hireId || !workerId) return setError('This job could not be found.');
    if (rating < 1) return setError('Please tap a star from 1 to 5.');

    setSubmitting(true);
    const result = await submitRating(hireId, workerId, rating, comment);
    setSubmitting(false);
    if (!result.success) return setError(result.message);
    router.back();
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Rate service provider' }} />
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Rate service provider' }} />
      <View style={styles.content}>
        <Text variant="headlineSmall" style={styles.title}>
          {alreadyRated ? 'Already rated' : 'How did it go?'}
        </Text>

        {alreadyRated ? (
          <Text variant="bodyMedium" style={styles.subtitle}>
            You&apos;ve already reviewed this job. Thanks for the feedback!
          </Text>
        ) : (
          <>
            <Text variant="bodyMedium" style={styles.subtitle}>
              Rate the service provider so other clients know what to expect.
            </Text>

            <View style={styles.stars}>
              {[1, 2, 3, 4, 5].map((value) => (
                <Pressable key={value} onPress={() => setRating(value)} accessibilityRole="button">
                  <MaterialCommunityIcons
                    name={value <= rating ? 'star' : 'star-outline'}
                    size={44}
                    color={colors.star}
                  />
                </Pressable>
              ))}
            </View>

            <TextInput
              label="Comment (optional)"
              mode="outlined"
              value={comment}
              onChangeText={setComment}
              maxLength={COMMENT_LIMIT}
              multiline
              style={styles.input}
              outlineStyle={styles.inputOutline}
            />
            <Text variant="bodySmall" style={styles.counter}>
              {comment.length}/{COMMENT_LIMIT}
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
            >
              Submit rating
            </Button>
          </>
        )}

        <Button onPress={() => router.back()} disabled={submitting} style={styles.skip}>
          {alreadyRated ? 'Done' : 'Skip for now'}
        </Button>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg },
  title: { fontFamily: fonts.display, color: colors.text },
  subtitle: { color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.lg },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  input: { backgroundColor: colors.surface },
  inputOutline: { borderRadius: radius.md },
  counter: { color: colors.textFaint, textAlign: 'right', marginTop: spacing.xs },
  button: { borderRadius: radius.pill, marginTop: spacing.md },
  buttonContent: { paddingVertical: spacing.sm },
  skip: { marginTop: spacing.sm },
});
