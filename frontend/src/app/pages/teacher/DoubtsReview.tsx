import {useState} from 'react';
import {Loader2, MessagesSquare, RefreshCw, Send, CheckCircle2, RotateCcw, Eye, EyeOff, Trash2, PlayCircle} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Badge} from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {useCourseStore} from '@/store/course-store';
import {
  formatTimestamp,
  useCourseDoubts,
  useDeleteDoubt,
  useReplyToDoubt,
  useSetDoubtHidden,
  useSetDoubtStatus,
} from '@/hooks/doubt-hooks';
import CourseBackButton from './CourseBackButton';
import DoubtVideoModal from './components/DoubtVideoModal';
import type {Doubt} from '@/lib/api/doubts';

const STATUS_FILTERS = ['ALL', 'OPEN', 'RESOLVED'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export default function DoubtsReview() {
  const {currentCourse} = useCourseStore();
  const courseId = currentCourse?.courseId || '';
  const courseVersionId = currentCourse?.versionId || '';

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('OPEN');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [viewing, setViewing] = useState<Doubt | null>(null);

  const {doubts, isLoading, isFetching, refetch} = useCourseDoubts(
    courseId,
    courseVersionId,
    statusFilter,
  );

  const replyToDoubt = useReplyToDoubt(() => {
    setReplyingTo(null);
    setReplyText('');
  });
  const setStatus = useSetDoubtStatus();
  const setHidden = useSetDoubtHidden();
  const deleteDoubt = useDeleteDoubt();

  const submitReply = (doubtId: string) => {
    const content = replyText.trim();
    if (!content) return;
    replyToDoubt.mutate({doubtId, content});
  };

  if (!courseId || !courseVersionId) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <CourseBackButton />
        <p className="py-16 text-center text-sm text-muted-foreground">
          Select a course to review its doubts.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <CourseBackButton />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Student Doubts</h1>
          <p className="text-sm text-muted-foreground">
            Questions students asked on video lessons in this course.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as StatusFilter)}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === 'ALL' ? 'All' : s === 'OPEN' ? 'Open' : 'Resolved'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : doubts.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed py-16 text-center">
          <MessagesSquare className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
          <h3 className="text-lg font-semibold text-muted-foreground">
            No doubts to show
          </h3>
          <p className="mt-1 text-sm text-muted-foreground/80">
            {statusFilter === 'OPEN'
              ? 'No open doubts — everything has been answered.'
              : 'Students have not asked any doubts yet.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {doubts.map((d) => (
            <div
              key={d._id}
              className={`rounded-xl border p-4 ${d.isHidden ? 'opacity-60' : ''}`}
            >
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {formatTimestamp(d.videoTimestamp)}
                </span>
                <span className="text-sm font-medium">{d.userName}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(d.createdAt).toLocaleString()}
                </span>
                {d.status === 'RESOLVED' && (
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                    Resolved
                  </Badge>
                )}
                {d.isHidden && (
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                    Hidden
                  </Badge>
                )}
              </div>

              <p className="whitespace-pre-line text-sm">{d.content}</p>

              {d.replies.length > 0 && (
                <div className="mt-3 space-y-2 border-l-2 pl-3">
                  {d.replies.map((r) => (
                    <div key={r._id}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium">{r.userName}</span>
                        {r.role === 'INSTRUCTOR' && (
                          <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                            Instructor
                          </Badge>
                        )}
                      </div>
                      <p className="whitespace-pre-line text-sm text-muted-foreground">
                        {r.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setViewing(d)}
                >
                  <PlayCircle className="mr-1 h-3 w-3" />View
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setReplyingTo(replyingTo === d._id ? null : d._id)}
                >
                  Reply
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() =>
                    setStatus.mutate({
                      doubtId: d._id,
                      status: d.status === 'RESOLVED' ? 'OPEN' : 'RESOLVED',
                    })
                  }
                >
                  {d.status === 'RESOLVED' ? (
                    <><RotateCcw className="mr-1 h-3 w-3" />Reopen</>
                  ) : (
                    <><CheckCircle2 className="mr-1 h-3 w-3" />Resolve</>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() =>
                    setHidden.mutate({doubtId: d._id, isHidden: !d.isHidden})
                  }
                >
                  {d.isHidden ? (
                    <><Eye className="mr-1 h-3 w-3" />Unhide</>
                  ) : (
                    <><EyeOff className="mr-1 h-3 w-3" />Hide</>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                  onClick={() => deleteDoubt.mutate(d._id)}
                >
                  <Trash2 className="mr-1 h-3 w-3" />Delete
                </Button>
              </div>

              {replyingTo === d._id && (
                <div className="mt-2 flex gap-2">
                  <Input
                    autoFocus
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submitReply(d._id)}
                    placeholder="Answer this doubt..."
                  />
                  <Button
                    disabled={!replyText.trim() || replyToDoubt.isPending}
                    onClick={() => submitReply(d._id)}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <DoubtVideoModal
        doubt={viewing}
        onClose={() => setViewing(null)}
        onSelectDoubt={setViewing}
      />
    </div>
  );
}
