import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import ClientSkillCard from './ClientSkillCard';
import FeedSearchBar from './FeedSearchBar';
import SuspendedBanner from '../SuspendedBanner';
import { PAGE_SIZE } from '../../lib/constants';
import { getReviewCountsForWorkers, type ReviewStats } from '../../lib/ratings';
import { supabase } from '../../lib/supabase';
import { getSkillPostsForClientFeed, type ClientSkillPost } from '../../lib/workerPosts';
import { colors, spacing } from '../../lib/theme';

// CLIENT FEED: a live, paginated list of every worker's active skill posts (read
// from the price-free public_worker_posts view). Each card shows the poster's
// profile picture, AI title + summary and slot count. Tapping opens the detail.
export default function ClientFeed() {
  const router = useRouter();
  const [posts, setPosts] = useState<ClientSkillPost[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // worker_id -> { count, avg }, shown as stars + total on each card.
  const [reviewStats, setReviewStats] = useState<Map<string, ReviewStats>>(new Map());

  const [query, setQuery] = useState('');
  // Mirror the latest query into a ref so the realtime + loadMore callbacks read
  // the current value without being re-created on every keystroke.
  const queryRef = useRef(query);

  // Fetch one page. 'replace' resets the list; 'append' adds the next page.
  const fetchPage = useCallback(async (pageToLoad: number, mode: 'replace' | 'append') => {
    const result = await getSkillPostsForClientFeed(pageToLoad, PAGE_SIZE, queryRef.current);
    setError(result.error);
    setHasMore(result.hasMore);
    setPage(pageToLoad);
    setPosts((prev) =>
      mode === 'append' ? dedupeById([...prev, ...result.posts]) : result.posts
    );

    // Pull the review stats for this page's workers and merge them in (append)
    // or replace them (fresh load) so each card can show stars + "(N reviews)".
    const stats = await getReviewCountsForWorkers(result.posts.map((p) => p.worker_id));
    setReviewStats((prev) => (mode === 'append' ? new Map([...prev, ...stats]) : stats));
  }, []);

  // Initial load + debounced reload whenever the search changes.
  useEffect(() => {
    queryRef.current = query;
    const timer = setTimeout(
      async () => {
        setLoading(true);
        await fetchPage(0, 'replace');
        setLoading(false);
      },
      query ? 300 : 0
    );
    return () => clearTimeout(timer);
  }, [query, fetchPage]);

  // Realtime: any change to worker_posts re-pulls the first page so new posts
  // and slot counts show up live.
  useEffect(() => {
    const channel = supabase
      .channel(`client-feed-worker-posts-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'worker_posts' }, () => {
        fetchPage(0, 'replace');
      })
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

  return (
    <View style={styles.container}>
      <SuspendedBanner />
      {/* Pinned above the list so it's always visible and the input never loses
          focus on re-render (which happens if it lives inside ListHeaderComponent). */}
      <View style={styles.searchWrap}>
        <FeedSearchBar query={query} onChangeQuery={setQuery} />
      </View>
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
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
          loading ? (
            <View style={styles.empty}>
              <ActivityIndicator />
            </View>
          ) : (
            <View style={styles.empty}>
              <Text variant="bodyMedium" style={styles.emptyText}>
                {error ??
                  (query.trim()
                    ? 'No posts match your search.'
                    : 'No skill posts yet. Pull to refresh.')}
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footer}>
              <ActivityIndicator />
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const stats = reviewStats.get(item.worker_id);
          return (
            <ClientSkillCard
              post={item}
              reviewCount={stats?.count ?? 0}
              reviewAvg={stats?.avg ?? 0}
              onPress={() => router.push({ pathname: '/worker-post/[id]', params: { id: item.id } })}
            />
          );
        }}
      />
    </View>
  );
}

// Keep the first occurrence of each id when appending pages (a realtime update
// mid-scroll can otherwise duplicate a row across page boundaries).
function dedupeById(list: ClientSkillPost[]): ClientSkillPost[] {
  const seen = new Set<string>();
  const out: ClientSkillPost[] = [];
  for (const item of list) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  searchWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  list: { padding: spacing.lg, gap: spacing.md, paddingBottom: 110 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxxl },
  emptyText: { color: colors.textMuted },
  footer: { paddingVertical: spacing.lg, alignItems: 'center' },
});
