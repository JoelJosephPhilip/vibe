import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  RotateCcw,
  Send,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import HlsVideoPlayer, { type HlsPlayerHandle } from "@/components/HlsVideoPlayer";
import { resolveVideoSource } from "@/types/media.types";
import { useItemById } from "@/hooks/hooks";
import {
  findLessonLocation,
  formatTimestamp,
  useCourseStructure,
  useDeleteDoubt,
  useItemDoubts,
  useReplyToDoubt,
  useSetDoubtHidden,
  useSetDoubtStatus,
} from "@/hooks/doubt-hooks";
import { loadYouTubeIframeApi } from "@/lib/youtube";
import type { Doubt } from "@/lib/api/doubts";
import type { YTPlayerInstance } from "@/types/video.types";
import DoubtHeatTimeline from "./DoubtHeatTimeline";

function getYouTubeId(url: string): string | null {
  const match = url.match(/(?:v=|youtu\.be\/?|embed\/)([\w-]{11})/);
  return match ? match[1] : null;
}

type Props = {
  doubt: Doubt | null;
  onClose: () => void;
  /** Lets the heat timeline switch context to a different doubt on the same video. */
  onSelectDoubt?: (doubt: Doubt) => void;
};

/**
 * Plays the lesson video at the moment a doubt refers to, so an instructor has
 * context before answering.
 *
 * Deliberately NOT the student player (components/video.tsx): that one enforces
 * fullscreen, the proctoring declaration, seek gating and watch-time tracking.
 * An instructor reviewing a question should get plain playback with full
 * controls and no restrictions, and must not write watch-time against their own
 * account.
 */
export function DoubtVideoModal({ doubt, onClose, onSelectDoubt }: Props) {
  const hlsRef = useRef<HlsPlayerHandle>(null);
  const ytPlayerRef = useRef<YTPlayerInstance | null>(null);
  const ytContainerRef = useRef<HTMLDivElement>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [duration, setDuration] = useState(0);
  const [replyText, setReplyText] = useState("");

  const { data, isLoading, error } = useItemById(
    doubt?.courseId || "",
    doubt?.courseVersionId || "",
    doubt?.itemId || "",
    doubt?.moduleId || "",
    doubt?.sectionId || "",
  );

  const { doubts: itemDoubts } = useItemDoubts(
    {
      itemId: doubt?.itemId || "",
      courseId: doubt?.courseId || "",
      courseVersionId: doubt?.courseVersionId || "",
    },
    Boolean(doubt),
  );

  const { data: structure } = useCourseStructure(doubt?.courseVersionId || "");
  const replyToDoubt = useReplyToDoubt(() => setReplyText(""));
  const setStatus = useSetDoubtStatus();
  const setHidden = useSetDoubtHidden();
  const deleteDoubt = useDeleteDoubt();

  const item = (data as any)?.item;
  const details = item?.details;
  const source = resolveVideoSource(details);
  const at = Math.floor(doubt?.videoTimestamp ?? 0);
  const canLookUp = Boolean(doubt?.moduleId && doubt?.sectionId);
  const location = findLessonLocation(structure as any, doubt?.moduleId, doubt?.sectionId);

  // The list this doubt came from can be stale (a reply/resolve elsewhere
  // hasn't reached it yet) — itemDoubts polls, so prefer its copy once loaded.
  const liveDoubt = itemDoubts.find((d) => d._id === doubt?._id) ?? doubt;

  useEffect(() => {
    setReplyText("");
  }, [liveDoubt?._id]);

  // Reset and (re)build the player when the video item changes, not on every
  // doubt — switching to another doubt on the same video should just seek.
  useEffect(() => {
    setPlayerReady(false);
    setDuration(0);
  }, [doubt?.itemId]);

  useEffect(() => {
    if (source !== "YOUTUBE" || !details?.URL || !ytContainerRef.current) return;
    const videoId = getYouTubeId(details.URL);
    if (!videoId) return;

    // YT.Player replaces whatever element it's given with its own iframe,
    // which leaves React's virtual DOM pointing at a node that's no longer
    // there — the next reconcile then crashes with a removeChild error.
    // Handing it a plain element we created ourselves, outside JSX, keeps
    // that swap entirely off React's radar.
    const mountPoint = document.createElement("div");
    mountPoint.className = "h-full w-full";
    ytContainerRef.current.appendChild(mountPoint);

    let cancelled = false;
    loadYouTubeIframeApi().then((YT) => {
      if (cancelled) return;
      const player = new YT.Player(mountPoint, {
        videoId,
        playerVars: { autoplay: 1, start: at, rel: 0 },
        events: {
          onReady: (e) => {
            ytPlayerRef.current = e.target;
            setDuration(e.target.getDuration());
            setPlayerReady(true);
          },
          onStateChange: () => {},
        },
      });
      ytPlayerRef.current = player;
    });

    return () => {
      cancelled = true;
      ytPlayerRef.current?.destroy?.();
      ytPlayerRef.current = null;
      mountPoint.remove();
    };
    // `at` deliberately excluded — this effect (re)builds the player, it
    // shouldn't rerun just because the active doubt's timestamp changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doubt?.itemId, source, details?.URL]);

  // Jump to a different doubt's timestamp without reloading the player.
  useEffect(() => {
    if (!playerReady || !doubt) return;
    if (source === "GCS") hlsRef.current?.seekTo(at, true);
    else ytPlayerRef.current?.seekTo(at, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doubt?._id]);

  const submitReply = () => {
    const content = replyText.trim();
    if (!content || !liveDoubt) return;
    replyToDoubt.mutate({ doubtId: liveDoubt._id, content });
  };

  return (
    <Dialog open={!!doubt} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Lesson context · {formatTimestamp(doubt?.videoTimestamp ?? 0)}
          </DialogTitle>
          {location && (
            <p className="text-xs text-muted-foreground">{location}</p>
          )}
        </DialogHeader>

        <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
          {!canLookUp ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
              This doubt was created before lesson links were recorded, so the
              video can't be opened directly. Newer doubts will jump straight to
              the moment.
            </div>
          ) : isLoading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error || !details ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
              Could not load this lesson video.
            </div>
          ) : source === "GCS" && details.assetId ? (
            <HlsVideoPlayer
              key={doubt?.itemId}
              ref={hlsRef}
              assetId={details.assetId}
              startTime={details.startTime}
              endTime={details.endTime}
              controls
              autoPlay
              className="h-full w-full"
              onReady={(durationSeconds) => {
                hlsRef.current?.seekTo(at, true);
                setDuration(durationSeconds);
                setPlayerReady(true);
              }}
            />
          ) : getYouTubeId(details.URL || "") ? (
            <div key={doubt?.itemId} ref={ytContainerRef} className="h-full w-full" />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
              This lesson has no playable video source.
            </div>
          )}
        </div>

        {duration > 0 && onSelectDoubt && (
          <DoubtHeatTimeline
            doubts={itemDoubts}
            duration={duration}
            activeDoubtId={doubt?._id}
            onJump={onSelectDoubt}
          />
        )}

        {liveDoubt && (
          <div className="space-y-3 border-t pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{liveDoubt.userName}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(liveDoubt.createdAt).toLocaleString()}
              </span>
              {liveDoubt.status === "RESOLVED" && (
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                  Resolved
                </Badge>
              )}
              {liveDoubt.isHidden && (
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                  Hidden
                </Badge>
              )}
            </div>

            <p className="whitespace-pre-line text-sm">{liveDoubt.content}</p>

            {liveDoubt.replies.length > 0 && (
              <div className="space-y-2 border-l-2 pl-3">
                {liveDoubt.replies.map((r) => (
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

            <div className="flex flex-wrap items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() =>
                  setStatus.mutate({
                    doubtId: liveDoubt._id,
                    status: liveDoubt.status === "RESOLVED" ? "OPEN" : "RESOLVED",
                  })
                }
              >
                {liveDoubt.status === "RESOLVED" ? (
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
                  setHidden.mutate({ doubtId: liveDoubt._id, isHidden: !liveDoubt.isHidden })
                }
              >
                {liveDoubt.isHidden ? (
                  <><Eye className="mr-1 h-3 w-3" />Unhide</>
                ) : (
                  <><EyeOff className="mr-1 h-3 w-3" />Hide</>
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                onClick={() =>
                  deleteDoubt.mutate(liveDoubt._id, { onSuccess: onClose })
                }
              >
                <Trash2 className="mr-1 h-3 w-3" />Delete
              </Button>
            </div>

            <div className="flex gap-2">
              <Input
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitReply()}
                placeholder="Answer this doubt..."
              />
              <Button
                disabled={!replyText.trim() || replyToDoubt.isPending}
                onClick={submitReply}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default DoubtVideoModal;
