import {formatTimestamp} from '@/hooks/doubt-hooks';
import type {Doubt} from '@/lib/api/doubts';

/** Buckets a bit under 40s wide on a 25min lesson — coarse enough to cluster, fine enough to navigate. */
const BUCKET_COUNT = 40;

type Bucket = {startSeconds: number; doubts: Doubt[]};

function buildBuckets(doubts: Doubt[], duration: number): Bucket[] {
  const bucketSize = duration / BUCKET_COUNT;
  const buckets: Bucket[] = Array.from({length: BUCKET_COUNT}, (_, i) => ({
    startSeconds: i * bucketSize,
    doubts: [],
  }));
  for (const d of doubts) {
    const idx = Math.min(BUCKET_COUNT - 1, Math.max(0, Math.floor(d.videoTimestamp / bucketSize)));
    buckets[idx].doubts.push(d);
  }
  return buckets.filter((b) => b.doubts.length > 0);
}

/** Same >5-questions cutoff the instructor already uses to judge "this needs attention". */
function heatColor(count: number): string {
  if (count >= 5) return 'hsl(0, 85%, 55%)';
  if (count >= 2) return 'hsl(30, 90%, 55%)';
  return 'hsl(45, 85%, 65%)';
}

type Props = {
  doubts: Doubt[];
  duration: number;
  activeDoubtId?: string;
  onJump: (doubt: Doubt) => void;
};

export default function DoubtHeatTimeline({doubts, duration, activeDoubtId, onJump}: Props) {
  if (!duration || duration <= 0 || doubts.length === 0) return null;

  const buckets = buildBuckets(doubts, duration);
  const active = doubts.find((d) => d._id === activeDoubtId);

  return (
    <div className="mt-3">
      <div className="relative h-3 w-full rounded-full bg-muted">
        {buckets.map((b) => (
          <button
            key={b.startSeconds}
            type="button"
            title={`${b.doubts.length} doubt${b.doubts.length > 1 ? 's' : ''} near ${formatTimestamp(b.startSeconds)}`}
            className="absolute top-0 h-full rounded-full transition-opacity hover:opacity-80"
            style={{
              left: `${(b.startSeconds / duration) * 100}%`,
              width: `${100 / BUCKET_COUNT}%`,
              backgroundColor: heatColor(b.doubts.length),
            }}
            onClick={() =>
              onJump([...b.doubts].sort((a, c) => a.videoTimestamp - c.videoTimestamp)[0])
            }
          />
        ))}
        {active && (
          <div
            className="pointer-events-none absolute -top-1 h-5 w-0.5 -translate-x-1/2 bg-foreground"
            style={{left: `${(active.videoTimestamp / duration) * 100}%`}}
          />
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {doubts.length} doubt{doubts.length === 1 ? '' : 's'} on this video — red spots have 5+
        questions clustered together. Click a spot to jump there.
      </p>
    </div>
  );
}
