import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import HlsVideoPlayer, { type HlsPlayerHandle } from "@/components/HlsVideoPlayer";
import { resolveVideoSource } from "@/types/media.types";
import { useItemById } from "@/hooks/hooks";
import { formatTimestamp, useItemDoubts } from "@/hooks/doubt-hooks";
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

  const item = (data as any)?.item;
  const details = item?.details;
  const source = resolveVideoSource(details);
  const at = Math.floor(doubt?.videoTimestamp ?? 0);
  const canLookUp = Boolean(doubt?.moduleId && doubt?.sectionId);

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

  return (
    <Dialog open={!!doubt} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Lesson context · {formatTimestamp(doubt?.videoTimestamp ?? 0)}
          </DialogTitle>
        </DialogHeader>

        {doubt && (
          <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <span className="font-medium">{doubt.userName}:</span> {doubt.content}
          </p>
        )}

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
      </DialogContent>
    </Dialog>
  );
}

export default DoubtVideoModal;
