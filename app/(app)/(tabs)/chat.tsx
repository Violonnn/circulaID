import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import ConversationRow from '../../../components/chat/ConversationRow';
import SuspendedBanner from '../../../components/SuspendedBanner';
import ScreenTitle from '../../../components/ui/ScreenTitle';
import { getChatThreads, type ChatThread } from '../../../lib/chat';
import { PAGE_SIZE } from '../../../lib/constants';
import { useAuth } from '../../../lib/auth-context';
import { useRole } from '../../../lib/role-context';
import { supabase } from '../../../lib/supabase';
import { colors, spacing } from '../../../lib/theme';

// CHAT TAB (Step 7): the list of threads the user is part of (as client or
// worker), limited to hires that are accepted or later. Tapping a thread opens
// the conversation. The list is role-agnostic — it always shows every thread the
// user belongs to.
export default function ChatTab() {
  const router = useRouter();
  const { session } = useAuth();
  const { activeRole } = useRole();
  const currentUserId = session?.user?.id ?? null;
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch one page. 'replace' resets the list; 'append' adds the next page. The
  // list is scoped to the active role (client vs worker), filtered at the query.
  const fetchPage = useCallback(
    async (pageToLoad: number, mode: 'replace' | 'append') => {
      // Guard: no signed-in user -> don't run the query, just show the empty state.
      if (!currentUserId) {
        setThreads([]);
        setHasMore(false);
        setError(null);
        return;
      }
      const result = await getChatThreads(activeRole, pageToLoad, PAGE_SIZE);
      setError(result.error);
      setHasMore(result.hasMore);
      setPage(pageToLoad);
      setThreads((prev) => {
        const next = mode === 'append' ? [...prev, ...result.threads] : result.threads;
        const seen = new Set<string>();
        return next.filter((t) => (seen.has(t.id) ? false : seen.add(t.id)));
      });
    },
    [activeRole, currentUserId]
  );

  const load = useCallback(async () => {
    setLoading(true);
    await fetchPage(0, 'replace');
    setLoading(false);
    setRefreshing(false);
  }, [fetchPage]);

  useEffect(() => {
    load();
  }, [load]);

  const onEndReached = useCallback(async () => {
    if (loadingMore || loading || !hasMore) return;
    setLoadingMore(true);
    await fetchPage(page + 1, 'append');
    setLoadingMore(false);
  }, [loadingMore, loading, hasMore, page, fetchPage]);

  // Realtime: a newly-accepted hire creates a thread; reflect that live.
  useEffect(() => {
    // Unique topic per mount so a remount never reuses a still-active channel
    // (adding listeners after subscribe() throws).
    const channel = supabase
      .channel(`chat-threads-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_threads' }, () =>
        fetchPage(0, 'replace')
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hire_requests' }, () =>
        fetchPage(0, 'replace')
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchPage]);

  if (loading) {
    return (
      <View style={styles.container}>
        <ScreenTitle title="Chat" />
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenTitle title="Chat" />
      <SuspendedBanner />
      <FlatList
        data={threads}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onEndReachedThreshold={0.4}
        onEndReached={onEndReached}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
          />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text variant="bodyMedium">
              {error ?? 'No chats yet. A thread opens once a hire is accepted.'}
            </Text>
          </View>
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footer}>
              <ActivityIndicator />
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <ConversationRow
            thread={item}
            onPress={() =>
              router.push({
                pathname: '/chat/[threadId]',
                params: { threadId: item.id, title: item.counterparty_name ?? 'Chat' },
              })
            }
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  list: { padding: spacing.lg, gap: spacing.md, paddingBottom: 110 },
  footer: { paddingVertical: spacing.lg, alignItems: 'center' },
});
