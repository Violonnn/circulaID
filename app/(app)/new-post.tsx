import { Stack, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createPost } from '../../lib/posts';
import { useRole } from '../../lib/role-context';
import { colors, fonts, radius, spacing } from '../../lib/theme';

// NEW POST form (Step 4). All inputs are validated here BEFORE we send anything
// to Supabase, even though the database has its own constraints. This is the one
// place a worker sets the (simulated) price.
export default function NewPost() {
  const router = useRouter();
  const { hasActiveWorkerProfile, isWorkerSuspended } = useRole();

  const [caption, setCaption] = useState('');
  const [totalSlots, setTotalSlots] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate() {
    setError('');

    // Guard: only an active worker may post (UX check; RLS enforces the truth).
    if (!hasActiveWorkerProfile || isWorkerSuspended) {
      return setError('Only an active service provider account can create posts.');
    }
    // Guard: caption is required.
    if (!caption.trim()) {
      return setError('Please write a caption.');
    }
    // Guard: total slots must be a positive whole number.
    const slotsValue = Number(totalSlots);
    if (!Number.isInteger(slotsValue) || slotsValue <= 0) {
      return setError('Total slots must be a whole number above 0.');
    }
    // Guard: price must be a number that is 0 or more (simulated test money).
    const priceValue = Number(price);
    if (price.trim() === '' || Number.isNaN(priceValue) || priceValue < 0) {
      return setError('Price must be a number that is 0 or more.');
    }

    setSubmitting(true);
    const result = await createPost(caption, slotsValue, priceValue);
    setSubmitting(false);

    // Guard: show the failure inline and stay on the form.
    if (!result.success) return setError(result.message);
    router.back();
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: 'New Post' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="bodyMedium" style={styles.note}>
          Set the slots and price employers will see for this post.
        </Text>

        <TextInput
          label="Caption"
          mode="outlined"
          value={caption}
          onChangeText={setCaption}
          multiline
          numberOfLines={3}
          style={styles.input}
          outlineStyle={styles.inputOutline}
        />

        <TextInput
          label="Total slots"
          mode="outlined"
          value={totalSlots}
          onChangeText={setTotalSlots}
          keyboardType="number-pad"
          style={styles.input}
          outlineStyle={styles.inputOutline}
        />

        <TextInput
          label="Price (₱)"
          mode="outlined"
          value={price}
          onChangeText={setPrice}
          keyboardType="decimal-pad"
          style={styles.input}
          outlineStyle={styles.inputOutline}
        />

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
          Create Post
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg },
  note: { color: colors.textMuted, marginBottom: spacing.lg },
  input: { marginBottom: spacing.sm, backgroundColor: colors.surface },
  inputOutline: { borderRadius: radius.md },
  button: { borderRadius: radius.pill, marginTop: spacing.md },
  buttonContent: { paddingVertical: spacing.sm },
  buttonLabel: { fontFamily: fonts.bodyBold, fontSize: 16 },
});
