import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { ActivityIndicator, Button, HelperText, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import Dropdown, { type DropdownOption } from '../../components/Dropdown';
import KeyboardAvoider from '../../components/ui/KeyboardAvoider';
import {
  countActiveWorkerPosts,
  MAX_ACTIVE_POSTS,
  MAX_POSTS_MESSAGE,
  saveSkillPost,
} from '../../lib/workerPosts';
import { colors, fonts, radius, spacing } from '../../lib/theme';

const DESCRIPTION_LIMIT = 500;

// Slots are 1..5 per post (independent of the 3-active-posts cap).
const SLOT_OPTIONS: DropdownOption[] = Array.from({ length: 5 }, (_, i) => ({
  label: String(i + 1),
  value: String(i + 1),
}));

// Fixed experience bands (stored as-is and used in the AI prompt).
const EXPERIENCE_OPTIONS: DropdownOption[] = [
  { label: 'Less than 3 months', value: 'Less than 3 months' },
  { label: '3-6 months', value: '3-6 months' },
  { label: '6 months - 1 year', value: '6 months - 1 year' },
  { label: '1-3 years', value: '1-3 years' },
  { label: '3-5 years', value: '3-5 years' },
  { label: '5+ years', value: '5+ years' },
];

// Skill post creation form (Part 2). Each post is AI-summarized into a feed card
// on submit, with a non-AI fallback so posting never depends on Gemini.
export default function SkillPostCreate() {
  const router = useRouter();

  const [slots, setSlots] = useState('');
  const [description, setDescription] = useState('');
  const [experience, setExperience] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Gate the form behind the 3-active-posts cap, checked on mount.
  const [checking, setChecking] = useState(true);
  const [atLimit, setAtLimit] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const { count } = await countActiveWorkerPosts();
      if (!active) return;
      setAtLimit(count >= MAX_ACTIVE_POSTS);
      setChecking(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  async function handleCreate() {
    setError('');

    // Guard: a slot count must be chosen.
    if (!slots) return setError('Please choose how many slots this post has.');
    // Guard: description is required and must fit the limit.
    if (!description.trim()) return setError('Please describe your skill.');
    if (description.length > DESCRIPTION_LIMIT) {
      return setError(`Description must be under ${DESCRIPTION_LIMIT} characters.`);
    }
    // Guard: an experience length must be chosen.
    if (!experience) return setError('Please choose your experience length.');
    // Guard: pricing must be a valid positive number (simulated test money).
    const priceValue = Number(price);
    if (price.trim() === '' || Number.isNaN(priceValue) || priceValue <= 0) {
      return setError('Pricing rate must be a number above 0.');
    }

    setSubmitting(true);
    const result = await saveSkillPost({
      totalSlots: Number(slots),
      description,
      experienceLength: experience,
      pricingRate: priceValue,
    });
    setSubmitting(false);

    // Guard: show the failure inline and stay on the form.
    if (!result.success) return setError(result.message);
    // Back to the Job screen, which will show the newly created post.
    router.dismissAll();
  }

  if (checking) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]} edges={['bottom']}>
        <Stack.Screen options={{ title: 'New Skill Post' }} />
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  // Guard: at the cap, show a message instead of the form (archiving is future).
  if (atLimit) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]} edges={['bottom']}>
        <Stack.Screen options={{ title: 'New Skill Post' }} />
        <Text variant="bodyLarge" style={styles.limitText}>
          {MAX_POSTS_MESSAGE}
        </Text>
        <Button mode="contained" onPress={() => router.dismissAll()} style={styles.button}>
          Back to my posts
        </Button>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: 'New Skill Post' }} />
      <KeyboardAvoider style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Dropdown
          label="Slots (people you can take on)"
          value={slots}
          options={SLOT_OPTIONS}
          onSelect={setSlots}
          style={styles.field}
        />

        <TextInput
          label="Describe your skill"
          mode="outlined"
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={5}
          maxLength={DESCRIPTION_LIMIT}
          placeholder="Marunong akong maglinis ng bahay · Maayo ko manglimpyo og balay · I clean houses reliably"
          style={styles.input}
          outlineStyle={styles.inputOutline}
        />
        {/* Workers can write in any local language — the AI summarizes the card
            in English. The short hint makes that clear. */}
        <Text variant="bodySmall" style={styles.hint}>
          Write in Tagalog, Bisaya, or English.
        </Text>
        <Text variant="bodySmall" style={styles.counter}>
          {description.length}/{DESCRIPTION_LIMIT} chars
        </Text>

        <Dropdown
          label="Experience length"
          value={experience}
          options={EXPERIENCE_OPTIONS}
          onSelect={setExperience}
          style={styles.field}
        />

        <TextInput
          label="Pricing rate (₱)"
          mode="outlined"
          value={price}
          onChangeText={setPrice}
          keyboardType="decimal-pad"
          style={styles.input}
          outlineStyle={styles.inputOutline}
        />
        <Text variant="bodySmall" style={styles.helper}>
          Set the rate clients will pay for this job.
        </Text>

        <HelperText type="error" visible={!!error}>
          {error}
        </HelperText>

        <Button
          mode="contained"
          onPress={handleCreate}
          loading={submitting}
          disabled={submitting}
          style={styles.button}
          contentStyle={styles.buttonContent}
          labelStyle={styles.buttonLabel}
        >
          {submitting ? 'Creating your post…' : 'Create Post'}
        </Button>
      </ScrollView>
      </KeyboardAvoider>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.lg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  field: { marginBottom: spacing.sm },
  input: { marginBottom: spacing.xs, backgroundColor: colors.surface },
  inputOutline: { borderRadius: radius.md },
  hint: { color: colors.textFaint, marginTop: spacing.xs },
  counter: { color: colors.textFaint, textAlign: 'right', marginBottom: spacing.sm },
  helper: { color: colors.textMuted, marginBottom: spacing.xs },
  limitText: { color: colors.text, textAlign: 'center' },
  button: { borderRadius: radius.pill, marginTop: spacing.md },
  buttonContent: { paddingVertical: spacing.sm },
  buttonLabel: { fontFamily: fonts.bodyBold, fontSize: 16 },
});
