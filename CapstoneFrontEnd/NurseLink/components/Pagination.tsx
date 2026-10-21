import React, { useCallback, useMemo, useState, type RefObject } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, type ScrollView } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { Colors, Radius } from '../constants/colors';

/** Every list in the app shows this many rows per page. */
export const PAGE_SIZE = 10;

/**
 * Pages a list client-side. `resetKey` (e.g. the active search/filter) sends
 * the list back to page 1 when the result set changes, so a narrower filter
 * can't strand the view on a page that no longer exists. Changing page
 * scrolls `scrollRef` (the screen's ScrollView) back to the top, so the
 * nurse never has to scroll up by hand after pressing Next.
 */
export function usePagination<T>(
  items: T[],
  options: { pageSize?: number; scrollRef?: RefObject<ScrollView | null>; resetKey?: unknown } = {}
) {
  const { pageSize = PAGE_SIZE, scrollRef, resetKey } = options;
  const [page, setPageState] = useState(1);
  // Reset during render when the key changes (React's recommended pattern
  // for "reset state when a prop changes" — no extra effect pass).
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (lastResetKey !== resetKey) {
    setLastResetKey(resetKey);
    setPageState(1);
  }
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);

  const pageItems = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize]
  );

  const setPage = useCallback(
    (next: number) => {
      setPageState(Math.min(Math.max(1, next), totalPages));
      scrollRef?.current?.scrollTo({ y: 0, animated: true });
      // Screens that scroll the whole document on web (not an inner
      // ScrollView) still land at the top.
      if (Platform.OS === 'web' && typeof window !== 'undefined' && !scrollRef?.current) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },
    [scrollRef, totalPages]
  );

  return { page: safePage, totalPages, pageItems, setPage, total: items.length, pageSize };
}

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  total?: number;
  pageSize?: number;
}

/** Previous / page numbers / Next. Renders nothing when there's only one page. */
export function Pagination({ page, totalPages, onPageChange, total, pageSize = PAGE_SIZE }: PaginationProps) {
  if (totalPages <= 1) return null;

  // At most 7 numbered buttons: first, last, and a window around the current page.
  const numbers: (number | 'gap')[] = [];
  const add = (n: number) => {
    if (!numbers.includes(n)) numbers.push(n);
  };
  add(1);
  for (let n = Math.max(2, page - 2); n <= Math.min(totalPages - 1, page + 2); n += 1) add(n);
  add(totalPages);
  const withGaps: (number | 'gap')[] = [];
  numbers.forEach((n, i) => {
    const prev = numbers[i - 1];
    if (typeof n === 'number' && typeof prev === 'number' && n - prev > 1) withGaps.push('gap');
    withGaps.push(n);
  });

  const first = (page - 1) * pageSize + 1;
  const last = total !== undefined ? Math.min(total, page * pageSize) : page * pageSize;

  return (
    <View style={styles.wrap}>
      {total !== undefined ? (
        <Text style={styles.range}>
          Showing {first}–{last} of {total}
        </Text>
      ) : null}
      <View style={styles.row}>
        <Pressable
          onPress={() => onPageChange(page - 1)}
          disabled={page === 1}
          style={[styles.navBtn, page === 1 && styles.disabled]}
          hitSlop={6}
          accessibilityLabel="Previous page"
        >
          <ChevronLeft size={16} color={page === 1 ? Colors.gray300 : Colors.blue700} />
          <Text style={[styles.navText, page === 1 && styles.navTextDisabled]}>Prev</Text>
        </Pressable>
        {withGaps.map((n, i) =>
          n === 'gap' ? (
            <Text key={`gap-${i}`} style={styles.gap}>…</Text>
          ) : (
            <Pressable
              key={n}
              onPress={() => onPageChange(n)}
              style={[styles.numBtn, n === page && styles.numBtnActive]}
              accessibilityLabel={`Page ${n}`}
              accessibilityState={{ selected: n === page }}
            >
              <Text style={[styles.numText, n === page && styles.numTextActive]}>{n}</Text>
            </Pressable>
          )
        )}
        <Pressable
          onPress={() => onPageChange(page + 1)}
          disabled={page === totalPages}
          style={[styles.navBtn, page === totalPages && styles.disabled]}
          hitSlop={6}
          accessibilityLabel="Next page"
        >
          <Text style={[styles.navText, page === totalPages && styles.navTextDisabled]}>Next</Text>
          <ChevronRight size={16} color={page === totalPages ? Colors.gray300 : Colors.blue700} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 4 },
  range: { fontSize: 12, color: Colors.mutedForeground },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
  navBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 10,
    height: 34,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.blue200,
    backgroundColor: Colors.white,
  },
  disabled: { borderColor: Colors.gray200, backgroundColor: Colors.gray50 },
  navText: { fontSize: 13, fontWeight: '600', color: Colors.blue700 },
  navTextDisabled: { color: Colors.gray300 },
  numBtn: {
    minWidth: 34,
    height: 34,
    paddingHorizontal: 8,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numBtnActive: { backgroundColor: Colors.blue600, borderColor: Colors.blue600 },
  numText: { fontSize: 13, fontWeight: '600', color: Colors.gray700 },
  numTextActive: { color: Colors.white },
  gap: { fontSize: 13, color: Colors.mutedForeground, paddingHorizontal: 2 },
});
