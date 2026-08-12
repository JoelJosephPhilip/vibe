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
import { formatTimestamp } from "@/hooks/doubt-hooks";
import type { Doubt } from "@/lib/api/doubts";

function getYouTubeId(url: string): string | null {
  const match = url.match(/(?:v=|youtu\.be\/?|embed\/)([\w-]{11})/);
  return match ? match[1] : null;
}

type Props = {
  doubt: Doubt | null;
  onClose: () => void;
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
export function DoubtVideoModal({ doubt, onClose }: Props) {
  const hlsRef = useRef<HlsPlayerHandle>(null);
  const [hlsSeeded, setHlsSeeded] = useState(false);

  const { data, isLoading, error } = useItemById(
    doubt?.courseId || "",
    doubt?.courseVersionId || "",
    doubt?.itemId || "",
    doubt?.moduleId || "",
    doubt?.sectionId || "",
  );

  useEffect(() => {
    setHlsSeeded(false);
  }, [doubt?._id]);

  const item = (data as any)?.item;
  const details = item?.details;
  const source = resolveVideoSource(details);
  const at = Math.floor(doubt?.videoTimestamp ?? 0);

  const canLookUp = Boolean(doubt?.moduleId && doubt?.sectionId);

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
              ref={hlsRef}
              assetId={details.assetId}
              startTime={details.startTime}
              endTime={details.endTime}
              controls
              autoPlay
              className="h-full w-full"
              onReady={() => {
                // Seek once, after the media is actually ready to accept it.
                if (!hlsSeeded) {
                  hlsRef.current?.seekTo(at, true);
                  setHlsSeeded(true);
                }
              }}
            />
          ) : getYouTubeId(details.URL || "") ? (
            <iframe
              key={`${doubt?._id}-${at}`}
              className="h-full w-full"
              src={`https://www.youtube.com/embed/${getYouTubeId(details.URL)}?start=${at}&autoplay=1&rel=0`}
              title="Lesson video"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
              This lesson has no playable video source.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default DoubtVideoModal;
