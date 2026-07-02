import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import HireCard, { type HireMeta } from './HireCard';
import SuspendedBanner from '../SuspendedBanner';
import { HIRE_STATUS, PAGE_SIZE } from '../../lib/constants';
import { formatDateTime, toTitleCase } from '../../lib/format';
import { getClientSkillHires, type ClientSkillHire } from '../../lib/hireRequests';
import { supabase } from '../../lib/supabase';
import { colors, radius, spacing } from '../../lib/theme';

// Statuses where the locked chat thread is available to open.
const CHAT_OPEN_STATUSES: string[] = [
  HIRE_STATUS.ACCEPTED,
  HIRE_STATUS.IN_PROGRESS,
  HIRE_STATUS.COMPLETED,
  HIRE_STATUS.PAID,
];

// CLIENT HIRES: the client's FULL hire history — one row per hire request, newest
// first (ordered by created_at, the only timestamp set on every row), no filters.
// Each card shows the worker, the scheduled date/time and the work site, plus an
// "Open chat" action once the request is accepted (the locked job conversation).
export default function ClientHires() {
  const router = useRouter();
  const [hires, setHires] = useState<ClientSkillHire[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(async (pageToLoad: number, mode: 'replace' | 'append') => {
    // No status arg => the full history (all statuses), newest first.
    const result = await getClientSkillHires(pageToLoad, PAGE_SIZE);
    setError(result.error);
    setHasMore(result.hasMore);
    setPage(pageToLoad);
    setHires((prev) => {
      const next = mode === 'append' ? [...prev, ...result.hires] : result.hires;
      const seen = new Set<string>();
      return next.filter((h) => (seen.has(h.id) ? false : seen.add(h.id)));
    });
  }, []);

  // Initial load.
  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchPage(0, 'replace');
      setLoading(false);
    })();
  }, [fetchPage]);

  // Realtime: any change to the client's hires refreshes the first page so an
  // acceptance/decline shows up live.
  useEffect(() => {
    const channel = supabase
      .channel(`client-skill-hires-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hire_requests' }, () =>
        fetchPage(0, 'replace')
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchPage]);

  const onEndReached = useCallback(async () => {
    if (loadingMore || loading || !hasMore) return;
    setLoadingMore(true);
    await fetchPage(page + 1, 'append');
    setLoadingMore(false);
  }, [loadingMore, loading, hasMore, page, fetchPage]);

  if (loading && hires.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SuspendedBanner />

      <FlatList
        data={hires}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onEndReachedThreshold={0.4}
        onEndReached={onEndReached}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await fetchPage(0, 'replace');
              setRefreshing(false);
            }}
          />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text variant="bodyMedium">{error ?? 'No hire history yet'}</Text>
          </View>
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footer}>
              <ActivityIndicator />
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const workerName = item.worker_name ? toTitleCase(item.worker_name) : 'Service Provider';
          const meta: HireMeta[] = [
            { icon: 'calendar-outline', text: formatDateTime(item.scheduled_at) || 'No date set' },
            { icon: 'location-outline', text: item.client_location ?? 'No location given' },
          ];
          if (item.status === HIRE_STATUS.REJECTED && item.decline_reason) {
            meta.push({ icon: 'close-circle-outline', text: `Reason: ${item.decline_reason}` });
          }
          return (
            <HireCard
              title={item.post_title ?? 'Skill post'}
              subtitle={workerName}
              avatarLabel={workerName}
              avatarUri={item.worker_avatar_url}
              status={item.status}
              meta={meta}
            >
              {renderAction(item)}
            </HireCard>
          );
        }}
      />
    </View>
  );

  // Decide which action a hire card shows. Accepted (and later) hires can open
  // the locked chat; pending shows a waiting note; rejected shows nothing extra.
  function renderAction(hire: ClientSkillHire) {
    if (hire.status === HIRE_STATUS.PENDING) {
      return (
        <Text variant="bodySmall" style={styles.waiting}>
          Waiting for the service provider to respond…
        </Text>
      );
    }
    const canChat = CHAT_OPEN_STATUSES.includes(hire.status) && !!hire.thread_id;
    const isPaid = hire.status === HIRE_STATUS.PAID;
    // Nothing extra to show once it's neither chat-open nor a paid (completed) hire.
    if (!canChat && !isPaid) return null;
    return (
      <>
        {canChat ? (
          <Button
            mode="contained"
            icon="chat-outline"
            style={styles.action}
            onPress={() =>
              router.push({
                pathname: '/chat/[threadId]',
                params: { threadId: hire.thread_id as string, title: hire.post_title ?? 'Chat' },
              })
            }
          >
            Open chat
          </Button>
        ) : null}
        {isPaid ? (
          <Button
            mode="outlined"
            icon="receipt"
            style={styles.action}
            onPress={() =>
              router.push({ pathname: '/receipt/[hireId]', params: { hireId: hire.id } })
            }
          >
            View receipt
          </Button>
        ) : null}
      </>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  list: { padding: spacing.lg, gap: spacing.md, paddingBottom: 110 },
  action: { marginTop: spacing.md, borderRadius: radius.pill },
  waiting: { marginTop: spacing.md, color: colors.textMuted, fontStyle: 'italic' },
  footer: { paddingVertical: spacing.lg, alignItems: 'center' },
});
