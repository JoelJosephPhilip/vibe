import {useState} from "react";
import {Loader2, MessagesSquare, Send, Trash2, Eye, EyeOff, CheckCircle2, RotateCcw} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Badge} from "@/components/ui/badge";
import {cn} from "@/utils/utils";
import {useAuthStore} from "@/store/auth-store";
import {
  formatTimestamp,
  useAskDoubt,
  useDeleteDoubt,
  useItemDoubts,
  useReplyToDoubt,
  useSetDoubtHidden,
  useSetDoubtStatus,
} from "@/hooks/doubt-hooks";
import type {Doubt, DoubtItemRef} from "@/lib/api/doubts";

type Props = {
  itemRef: DoubtItemRef;
  cohortId?: string;
  moduleId?: string;
  sectionId?: string;
  /** Playback position captured when the panel opened. */
  askAtSeconds: number;
  /** Mirrors the player's own rule — forward seeking may be disabled. */
  seekForwardEnabled: boolean;
  /** Current playback position, to decide if a jump would be a forward seek. */
  currentTime: number;
  onSeek: (seconds: number) => void;
  /** Instructors get moderation controls. */
  isInstructor?: boolean;
};

export function DoubtsPanel({
  itemRef,
  cohortId,
  moduleId,
  sectionId,
  askAtSeconds,
  seekForwardEnabled,
  currentTime,
  onSeek,
  isInstructor = false,
}: Props) {
  const {user} = useAuthStore();
  const {doubts, isLoading} = useItemDoubts(itemRef, true);
  const [text, setText] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  const askDoubt = useAskDoubt(itemRef);
  const replyToDoubt = useReplyToDoubt(() => {
    setReplyingTo(null);
    setReplyText("");
  });
  const setStatus = useSetDoubtStatus();
  const setHidden = useSetDoubtHidden();
  const deleteDoubt = useDeleteDoubt();

  const submit = () => {
    const content = text.trim();
    if (!content) return;
    askDoubt.mutate(
      {content, videoTimestamp: askAtSeconds, cohortId, moduleId, sectionId},
      {onSuccess: () => setText("")},
    );
  };

  const submitReply = (doubtId: string) => {
    const content = replyText.trim();
    if (!content) return;
    replyToDoubt.mutate({doubtId, content});
  };

  // Jumping to a later moment would be a forward seek — the player blocks those
  // when seekForwardEnabled is off, so don't offer it as a clickable action.
  const canJumpTo = (d: Doubt) =>
    seekForwardEnabled || d.videoTimestamp <= currentTime;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-ai/15 text-ai">
          <MessagesSquare className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">Discussion</h2>
          <p className="text-xs text-muted-foreground">
            {doubts.length === 0
              ? "No doubts yet on this video"
              : `${doubts.length} doubt${doubts.length === 1 ? "" : "s"} on this video`}
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : doubts.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Be the first to ask a doubt about this lesson.
          </p>
        ) : (
          doubts.map((d) => (
            <div
              key={d._id}
              className={cn(
                "rounded-xl border border-border bg-muted/30 p-3",
                d.isHidden && "opacity-60",
              )}
            >
              <div className="mb-1 flex items-center gap-2">
                {canJumpTo(d) ? (
                  <button
                    onClick={() => onSeek(d.videoTimestamp)}
                    title="Jump to this moment"
                    className="rounded bg-ai/15 px-1.5 py-0.5 font-mono text-xs text-ai hover:bg-ai/25"
                  >
                    {formatTimestamp(d.videoTimestamp)}
                  </button>
                ) : (
                  <span
                    title="Seeking forward is disabled for this course"
                    className="cursor-not-allowed rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
                  >
                    {formatTimestamp(d.videoTimestamp)}
                  </span>
                )}
                <span className="truncate text-xs font-medium">{d.userName}</span>
                {d.status === "RESOLVED" && (
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
                <div className="mt-2 space-y-2 border-l-2 border-border pl-3">
                  {d.replies.map((r) => (
                    <div key={r._id}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium">{r.userName}</span>
                        {r.role === "INSTRUCTOR" && (
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

              <div className="mt-2 flex flex-wrap items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setReplyingTo(replyingTo === d._id ? null : d._id)}
                >
                  Reply
                </Button>

                {isInstructor && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() =>
                        setStatus.mutate({
                          doubtId: d._id,
                          status: d.status === "RESOLVED" ? "OPEN" : "RESOLVED",
                        })
                      }
                    >
                      {d.status === "RESOLVED" ? (
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
                  </>
                )}

                {(isInstructor || d.userId === user?.uid) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                    onClick={() => deleteDoubt.mutate(d._id)}
                  >
                    <Trash2 className="mr-1 h-3 w-3" />Delete
                  </Button>
                )}
              </div>

              {replyingTo === d._id && (
                <div className="mt-2 flex gap-2">
                  <Input
                    autoFocus
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submitReply(d._id)}
                    placeholder="Write a reply..."
                    className="h-8"
                  />
                  <Button
                    size="sm"
                    className="h-8"
                    disabled={!replyText.trim() || replyToDoubt.isPending}
                    onClick={() => submitReply(d._id)}
                  >
                    <Send className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="mt-3 border-t border-border pt-3">
        <p className="mb-1.5 text-xs text-muted-foreground">
          Asking at{" "}
          <span className="font-mono text-ai">{formatTimestamp(askAtSeconds)}</span>
        </p>
        <div className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Ask a doubt about this moment..."
            maxLength={2000}
          />
          <Button disabled={!text.trim() || askDoubt.isPending} onClick={submit}>
            {askDoubt.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default DoubtsPanel;
