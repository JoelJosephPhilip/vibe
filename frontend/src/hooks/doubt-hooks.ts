import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';
import {doubtsApi, type DoubtItemRef} from '@/lib/api/doubts';

/** How often the open panel refetches. Polling stands in for websockets. */
const POLL_INTERVAL_MS = 10_000;

export const doubtKeys = {
  item: (ref: DoubtItemRef) => ['doubts', 'item', ref.itemId],
  courseVersion: (courseId: string, courseVersionId: string, status?: string) => [
    'doubts',
    'course',
    courseId,
    courseVersionId,
    status ?? 'ALL',
  ],
};

/**
 * Doubts for the currently-playing video item. Polls only while `enabled` (i.e.
 * the panel is open) so a closed panel costs nothing.
 */
export function useItemDoubts(ref: DoubtItemRef, enabled: boolean) {
  const ready =
    enabled && Boolean(ref.itemId && ref.courseId && ref.courseVersionId);

  const result = useQuery({
    queryKey: doubtKeys.item(ref),
    queryFn: () => doubtsApi.listForItem(ref),
    enabled: ready,
    refetchInterval: ready ? POLL_INTERVAL_MS : false,
  });

  return {...result, doubts: result.data?.items ?? []};
}

export function useAskDoubt(ref: DoubtItemRef) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      content: string;
      videoTimestamp: number;
      cohortId?: string;
      moduleId?: string;
      sectionId?: string;
    }) => doubtsApi.create(ref, body),
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: doubtKeys.item(ref)});
    },
    onError: (e: Error) => toast.error(e.message || 'Could not post your doubt'),
  });
}

export function useReplyToDoubt(onDone?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({doubtId, content}: {doubtId: string; content: string}) =>
      doubtsApi.reply(doubtId, content),
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: ['doubts']});
      onDone?.();
    },
    onError: (e: Error) => toast.error(e.message || 'Could not post your reply'),
  });
}

export function useSetDoubtStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      doubtId,
      status,
    }: {
      doubtId: string;
      status: 'OPEN' | 'RESOLVED';
    }) => doubtsApi.setStatus(doubtId, status),
    onSuccess: () => queryClient.invalidateQueries({queryKey: ['doubts']}),
    onError: (e: Error) => toast.error(e.message || 'Could not update status'),
  });
}

export function useSetDoubtHidden() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({doubtId, isHidden}: {doubtId: string; isHidden: boolean}) =>
      doubtsApi.setHidden(doubtId, isHidden),
    onSuccess: () => queryClient.invalidateQueries({queryKey: ['doubts']}),
    onError: (e: Error) => toast.error(e.message || 'Could not update the doubt'),
  });
}

export function useDeleteDoubt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (doubtId: string) => doubtsApi.remove(doubtId),
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: ['doubts']});
      toast.success('Doubt deleted');
    },
    onError: (e: Error) => toast.error(e.message || 'Could not delete the doubt'),
  });
}

/** All doubts in a course version — the instructor review page. */
export function useCourseDoubts(
  courseId: string,
  courseVersionId: string,
  status: 'OPEN' | 'RESOLVED' | 'ALL' = 'ALL',
) {
  const ready = Boolean(courseId && courseVersionId);
  const result = useQuery({
    queryKey: doubtKeys.courseVersion(courseId, courseVersionId, status),
    queryFn: () => doubtsApi.listForCourseVersion(courseId, courseVersionId, status),
    enabled: ready,
  });
  return {...result, doubts: result.data?.items ?? []};
}

/** mm:ss for a second offset. */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
