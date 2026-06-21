import React from 'react';
import { StyleSheet, View } from 'react-native';
import { TextInput } from 'react-native-paper';
import { colors, radius, spacing } from '../../lib/theme';

type Props = {
  query: string;
  onChangeQuery: (text: string) => void;
};

// Bubbly search field for the client feed. Purely presentational — the parent
// owns the query state and runs the actual search against the skill posts.
export default function FeedSearchBar({ query, onChangeQuery }: Props) {
  return (
    <View style={styles.row}>
      <TextInput
        mode="outlined"
        placeholder="Search services…"
        value={query}
        onChangeText={onChangeQuery}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        left={<TextInput.Icon icon="magnify" color={colors.primary} />}
        right={
          query.length > 0 ? (
            <TextInput.Icon icon="close" color={colors.textMuted} onPress={() => onChangeQuery('')} />
          ) : undefined
        }
        style={styles.input}
        outlineStyle={styles.inputOutline}
        outlineColor={colors.primaryBorder}
        activeOutlineColor={colors.primary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginBottom: spacing.xl },
  input: { backgroundColor: colors.surface },
  inputOutline: { borderRadius: radius.pill },
});
