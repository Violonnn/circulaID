import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Card, Text } from 'react-native-paper';
import PlaceholderImage from '../PlaceholderImage';
import StatusBadge from '../StatusBadge';
import type { ChatThread } from '../../lib/chat';
import { toTitleCase } from '../../lib/format';
import { colors, radius, shadow, spacing } from '../../lib/theme';

function initials(name: string | null): string {
  if (!name) return '–';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join('') || '–';
}

// One conversation row in the chat list. All fields come from the ChatThread the
// list already fetched (counterparty_name, post_caption, hire_status).
//
// TODO(read-state): the schema has no per-thread unread / last-message-read
// data, so we can't show a real "read" receipt here. Once messages carry a
// read_at (or a thread has unread_count), add an unread dot + read check below.
export default function ConversationRow({
  thread,
  onPress,
}: {
  thread: ChatThread;
  onPress: () => void;
}) {
  // Names are title-cased at the source, but title-case here too so any older
  // or generic value still displays consistently capitalized.
  const name = thread.counterparty_name ? toTitleCase(thread.counterparty_name) : 'Chat';
  return (
    <Card style={styles.card} onPress={onPress} mode="elevated">
      <Card.Content style={styles.content}>
        <PlaceholderImage
          label={initials(name)}
          uri={thread.counterparty_avatar_url}
          width={48}
          height={48}
          borderRadius={24}
        />
        <View style={styles.body}>
          <Text variant="titleMedium" numberOfLines={1} style={styles.name}>
            {name}
          </Text>
          <Text variant="bodySmall" numberOfLines={1} style={styles.caption}>
            {thread.post_caption ?? 'Hire conversation'}
          </Text>
        </View>
        <View style={styles.right}>
          <StatusBadge status={thread.hire_status} />
          <Ionicons name="chevron-forward" size={18} color={colors.primary} />
        </View>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, backgroundColor: colors.surface, ...shadow.card },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  body: { flex: 1, gap: 2 },
  name: { fontWeight: '700' },
  caption: { color: colors.textMuted },
  right: { alignItems: 'flex-end', gap: spacing.xs + 2 },
});
