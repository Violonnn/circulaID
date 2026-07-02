import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Button, Dialog, HelperText, Portal, Text, TextInput } from 'react-native-paper';
import { colors, fonts } from '../lib/theme';

type Props = {
  visible: boolean;
  submitting: boolean;
  onDismiss: () => void;
  onSubmit: (rating: number, comment: string) => void;
};

// A simple 1–5 star picker + optional comment. The rating is validated here
// (must pick a star) before the parent is allowed to submit; the data layer and
// the database CHECK constraint enforce the 1–5 range again.
export default function RatingDialog({ visible, submitting, onDismiss, onSubmit }: Props) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');

  function handleSubmit() {
    // Guard: a star must be chosen.
    if (rating < 1 || rating > 5) {
      return setError('Please tap a star from 1 to 5.');
    }
    setError('');
    onSubmit(rating, comment);
  }

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss}>
        <Dialog.Title>Rate this service provider</Dialog.Title>
        <Dialog.Content>
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((value) => (
              <Pressable key={value} onPress={() => setRating(value)}>
                <MaterialCommunityIcons
                  name={value <= rating ? 'star' : 'star-outline'}
                  size={36}
                  color={colors.star}
                />
              </Pressable>
            ))}
          </View>
          <Text variant="bodySmall" style={styles.hint}>
            {rating ? `${rating} of 5 stars` : 'Tap to rate'}
          </Text>
          <TextInput
            label="Comment (optional)"
            mode="outlined"
            value={comment}
            onChangeText={setComment}
            multiline
            style={styles.input}
          />
          <HelperText type="error" visible={!!error}>
            {error}
          </HelperText>
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onDismiss} disabled={submitting}>
            Cancel
          </Button>
          <Button mode="contained" onPress={handleSubmit} loading={submitting} disabled={submitting}>
            Submit
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  stars: { flexDirection: 'row', justifyContent: 'center', gap: 4, marginVertical: 8 },
  hint: { textAlign: 'center', color: colors.textMuted, fontFamily: fonts.bodyMedium, marginBottom: 12 },
  input: { marginTop: 4 },
});
