import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Loader2, Wand2, Scissors, Combine, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  getCoursePlan,
  updateCoursePlan,
  editSegmentMap,
  regenerateCoursePlan,
  regenerateSection,
  type CoursePlan,
  type CourseSectionPlan,
} from "@/lib/genai-api";
import { loadYouTubeIframeApi } from "@/lib/youtube";
import type { YTPlayerInstance } from "@/types/video.types";

function getYouTubeId(url?: string): string | null {
  if (!url) return null;
  const match = url.match(/(?:v=|youtu\.be\/?)([\w-]{11})/);
  return match ? match[1] : null;
}

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// A plain <iframe src="...&end=..."> looks like it should stop at `end`, but
// YouTube's embed `end` param is unreliable on its own -- confirmed live:
// playback just continues past it. Driving a real YT.Player and polling
// getCurrentTime() to call pauseVideo() ourselves is what actually stops it.
function SegmentPreviewPlayer({
  videoId,
  segmentStart,
  segmentEnd,
  title,
}: {
  videoId: string;
  segmentStart: number;
  segmentEnd: number;
  title: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayerInstance | null>(null);

  useEffect(() => {
    let cancelled = false;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    loadYouTubeIframeApi().then(YT => {
      if (cancelled || !containerRef.current) return;
      playerRef.current = new YT.Player(containerRef.current, {
        videoId,
        playerVars: { start: Math.floor(segmentStart), end: Math.ceil(segmentEnd), rel: 0 },
        events: {
          onReady: () => {},
          onStateChange: e => {
            if (pollInterval) {
              clearInterval(pollInterval);
              pollInterval = null;
            }
            if (e.data === YT.PlayerState.PLAYING) {
              pollInterval = setInterval(() => {
                const current = playerRef.current?.getCurrentTime?.();
                if (typeof current === "number" && current >= segmentEnd) {
                  playerRef.current?.pauseVideo?.();
                  if (pollInterval) {
                    clearInterval(pollInterval);
                    pollInterval = null;
                  }
                }
              }, 250);
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
      if (pollInterval) clearInterval(pollInterval);
      playerRef.current?.destroy?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, segmentStart, segmentEnd]);

  return (
    <div className="aspect-video w-full max-w-sm rounded-md overflow-hidden border">
      <div ref={containerRef} className="w-full h-full" title={`Preview: ${title}`} />
    </div>
  );
}

interface Props {
  jobId: string;
  videoUrl?: string;
  // Jobs started without a pre-existing courseId/versionId propose (and, on
  // approval, auto-create) their own Course + CourseVersion -- see
  // GenAIService's course auto-create block in uploadContent.
  hasExistingCourse: boolean;
  onApproved: () => void | Promise<void>;
}

export default function CourseStructurePreview({ jobId, videoUrl, hasExistingCourse, onApproved }: Props) {
  const [plan, setPlan] = useState<CoursePlan | null>(null);
  const [sections, setSections] = useState<CourseSectionPlan[]>([]);
  const [moduleName, setModuleName] = useState("");
  const [moduleDescription, setModuleDescription] = useState("");
  const [courseName, setCourseName] = useState("");
  const [courseDescription, setCourseDescription] = useState("");
  const [versionName, setVersionName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoId = getYouTubeId(videoUrl);

  const fetchPlan = async () => {
    setLoading(true);
    try {
      const data = await getCoursePlan(jobId);
      setPlan(data);
      setSections(data.sections);
      setModuleName(data.moduleName);
      setModuleDescription(data.moduleDescription);
      setCourseName(data.courseName ?? "");
      setCourseDescription(data.courseDescription ?? "");
      setVersionName(data.versionName ?? "");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load course plan.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const updateSectionField = (index: number, field: "name" | "description", value: string) => {
    setSections(prev => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  };

  // Sections map 1:1 onto segmentMap entries (keyed by segmentEnd), so merging
  // or splitting sections is just editing that boundary list -- the backend
  // regenerates AI names only for the boundaries that actually changed.
  const applySegmentMapEdit = async (newSegmentMap: number[]) => {
    setBusy(true);
    try {
      await editSegmentMap(jobId, newSegmentMap);
      await fetchPlan();
    } catch (err) {
      toast.error("Failed to update sections", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setBusy(false);
    }
  };

  const mergeWithNext = (index: number) => {
    if (index >= sections.length - 1) return;
    const newSegmentMap = sections.map(s => s.segmentEnd).filter((_, i) => i !== index);
    applySegmentMapEdit(newSegmentMap);
  };

  const splitSection = (index: number) => {
    const section = sections[index];
    const midpoint = Math.round((section.segmentStart + section.segmentEnd) / 2);
    if (midpoint <= section.segmentStart || midpoint >= section.segmentEnd) {
      toast.error("This section is too short to split.");
      return;
    }
    const newSegmentMap = [...sections.map(s => s.segmentEnd), midpoint].sort((a, b) => a - b);
    applySegmentMapEdit(newSegmentMap);
  };

  // There's no concept of "exclude this time range from the video" in the
  // data model -- segmentMap always tiles the full video with no gaps -- so
  // "delete" a section the same way the model allows removing one at all:
  // drop its boundary, folding its time range into a neighbor. Prefers the
  // next section; the last section merges backward into the previous one
  // instead, since it has no "next" to fold into.
  const deleteSection = (index: number) => {
    if (sections.length <= 1) {
      toast.error("Can't delete the only section.");
      return;
    }
    if (index < sections.length - 1) {
      mergeWithNext(index);
    } else {
      mergeWithNext(index - 1);
    }
  };

  const regenerateOneSection = async (index: number) => {
    setBusy(true);
    try {
      await regenerateSection(jobId, sections[index].segmentEnd);
      await fetchPlan();
      toast.success("Section regenerated.");
    } catch (err) {
      toast.error("Failed to regenerate section", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setBusy(false);
    }
  };

  const regenerateAll = async () => {
    setBusy(true);
    try {
      await regenerateCoursePlan(jobId);
      await fetchPlan();
      toast.success("Course structure regenerated.");
    } catch (err) {
      toast.error("Failed to regenerate course structure", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setBusy(false);
    }
  };

  const saveEdits = async () => {
    setBusy(true);
    try {
      await updateCoursePlan(jobId, {
        moduleName,
        moduleDescription,
        ...(hasExistingCourse ? {} : { courseName, courseDescription, versionName }),
        sections: sections.map(({ segmentEnd, name, description }) => ({ segmentEnd, name, description })),
      });
      toast.success("Changes saved.");
    } catch (err) {
      toast.error("Failed to save changes", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    setBusy(true);
    try {
      await updateCoursePlan(jobId, {
        moduleName,
        moduleDescription,
        ...(hasExistingCourse ? {} : { courseName, courseDescription, versionName }),
        sections: sections.map(({ segmentEnd, name, description }) => ({ segmentEnd, name, description })),
      });
      await onApproved();
    } catch (err) {
      toast.error("Failed to approve course", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Card className="border-muted bg-muted/10">
        <CardContent className="py-6 flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Generating course structure preview...
        </CardContent>
      </Card>
    );
  }

  if (error || !plan) {
    return (
      <Card className="border-destructive/50 bg-destructive/5">
        <CardContent className="py-6 text-sm text-destructive">{error ?? "Could not load course plan."}</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-muted bg-muted/10">
        <CardContent className="space-y-4 py-6">
          <div className="flex items-start gap-4">
            {videoId && (
              <img
                src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}
                alt="Video thumbnail"
                className="w-40 rounded-md border shrink-0"
              />
            )}
            <div className="flex-1 space-y-2">
              {!hasExistingCourse && (
                <>
                  <Label htmlFor="courseName">Course Title</Label>
                  <Input id="courseName" value={courseName} onChange={e => setCourseName(e.target.value)} />
                  <Label htmlFor="courseDescription">Course Description</Label>
                  <Textarea id="courseDescription" value={courseDescription} onChange={e => setCourseDescription(e.target.value)} rows={2} />
                  <Label htmlFor="versionName">Version Label</Label>
                  <Input id="versionName" value={versionName} onChange={e => setVersionName(e.target.value)} />
                </>
              )}
              <Label htmlFor="moduleName">Module Name</Label>
              <Input id="moduleName" value={moduleName} onChange={e => setModuleName(e.target.value)} />
              <Label htmlFor="moduleDescription">Module Description</Label>
              <Textarea id="moduleDescription" value={moduleDescription} onChange={e => setModuleDescription(e.target.value)} rows={2} />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {hasExistingCourse ? "" : "1 new course · "}1 module &middot; {sections.length} section{sections.length === 1 ? "" : "s"} &middot; {sections.length} quiz{sections.length === 1 ? "" : "es"}
            {plan.questionsPerQuiz ? ` · ${plan.questionsPerQuiz} questions each` : ""}
            {plan.maxAttempts != null ? ` · ${plan.maxAttempts === -1 ? "unlimited" : plan.maxAttempts} attempts` : ""}
          </p>
        </CardContent>
      </Card>

      {sections.map((section, index) => (
        <Card key={section.segmentEnd} className="border-muted">
          <CardContent className="py-6 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {formatSeconds(section.segmentStart)} &ndash; {formatSeconds(section.segmentEnd)}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={busy} onClick={() => regenerateOneSection(index)}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                  Regenerate
                </Button>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => splitSection(index)}>
                  <Scissors className="h-3.5 w-3.5 mr-1" />
                  Split
                </Button>
                {index < sections.length - 1 && (
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => mergeWithNext(index)}>
                    <Combine className="h-3.5 w-3.5 mr-1" />
                    Merge with next
                  </Button>
                )}
                <Button variant="outline" size="sm" disabled={busy} onClick={() => deleteSection(index)}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Delete
                </Button>
              </div>
            </div>

            <Input
              value={section.name}
              onChange={e => updateSectionField(index, "name", e.target.value)}
              placeholder="Section name"
            />
            <Textarea
              value={section.description}
              onChange={e => updateSectionField(index, "description", e.target.value)}
              placeholder="Section description"
              rows={2}
            />

            {section.transcriptExcerpt && (
              <p className="text-xs text-muted-foreground line-clamp-2">{section.transcriptExcerpt}</p>
            )}

            {videoId && (
              <SegmentPreviewPlayer
                videoId={videoId}
                segmentStart={section.segmentStart}
                segmentEnd={section.segmentEnd}
                title={section.name}
              />
            )}
          </CardContent>
        </Card>
      ))}

      <Card className="border-muted bg-muted/10">
        <CardContent className="py-4 flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={regenerateAll}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Regenerate entire structure
          </Button>
          <Button variant="outline" disabled={busy} onClick={saveEdits}>
            Save edits
          </Button>
          <Button disabled={busy} onClick={approve}>
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />}
            Approve &amp; Generate Course
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
