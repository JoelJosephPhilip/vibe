import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Wand2 } from "lucide-react";
import { getJobStatus, postJobTask, approveContinueTask } from "@/lib/genai-api";
import CourseStructurePreview from "./ai-gen-components/course-structure-preview";

const STAGE_LABELS: Record<string, string> = {
  audioExtraction: "Audio Extraction",
  transcriptGeneration: "Transcript Generation",
  segmentation: "Segmentation",
  questionGeneration: "Question Generation",
  uploadContent: "Upload Content",
};

const STAGE_ORDER = [
  "audioExtraction",
  "transcriptGeneration",
  "segmentation",
  "questionGeneration",
  "uploadContent",
];

// getJobStatus's jobStatus[stage] values, keyed to the TaskType strings
// postJobTask/approveStartTask expect (see backend TaskType enum).
const STAGE_TASK_TYPE: Record<string, string> = {
  audioExtraction: "AUDIO_EXTRACTION",
  transcriptGeneration: "TRANSCRIPT_GENERATION",
  segmentation: "SEGMENTATION",
  questionGeneration: "QUESTION_GENERATION",
  uploadContent: "UPLOAD_CONTENT",
};

function statusVariant(status?: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "COMPLETED":
      return "default";
    case "RUNNING":
      return "secondary";
    case "FAILED":
    case "STOPPED":
      return "destructive";
    default:
      return "outline";
  }
}

export default function JobStatusPage() {
  const { jobId } = useParams({ strict: false });
  const [job, setJob] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const drivingRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    if (!jobId) return;
    try {
      const data = await getJobStatus(jobId as string);
      setJob(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load job status.");
    } finally {
      setIsLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Auto-advances the job through stages that need an explicit
  // approve/start call (see WebhookController -- the pipeline never
  // auto-advances on its own), except it stops once segmentation is done and
  // question generation hasn't started yet: that's the course-structure
  // preview gate, rendered below instead of driven through.
  const status = job?.jobStatus;
  const atPreviewGate = status?.segmentation === "COMPLETED" && status?.questionGeneration === "PENDING";

  useEffect(() => {
    if (!jobId || !status || atPreviewGate || drivingRef.current) return;

    const advance = async () => {
      drivingRef.current = true;
      try {
        for (let i = 0; i < STAGE_ORDER.length; i++) {
          const stage = STAGE_ORDER[i];
          const stageStatus = status[stage];
          if (stageStatus === "WAITING") {
            await postJobTask(jobId as string, STAGE_TASK_TYPE[stage]);
            break;
          }
          if (stageStatus === "COMPLETED") {
            const nextStage = STAGE_ORDER[i + 1];
            if (nextStage && status[nextStage] === "PENDING") {
              await approveContinueTask(jobId as string);
              break;
            }
          }
        }
      } catch (err) {
        console.error("Pipeline driver step failed:", err);
      } finally {
        drivingRef.current = false;
        fetchStatus();
      }
    };
    advance();
    // status is a plain object recreated on every fetch, so this only needs
    // to re-run when the actual stage values change, not on identity alone --
    // JSON.stringify keeps the dependency array a stable primitive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, JSON.stringify(status), atPreviewGate]);

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading job status...
      </div>
    );
  }

  if (error && !job) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="py-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-4">
      <Card className="border-muted bg-muted/10">
        <CardContent className="space-y-4 py-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-primary" />
              Job Status
            </h2>
            <Button variant="outline" size="sm" onClick={fetchStatus}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>

          <div className="text-sm text-muted-foreground space-y-1">
            <p><strong className="text-foreground">Job ID:</strong> {job?._id}</p>
            <p><strong className="text-foreground">Type:</strong> {job?.type}</p>
            <p><strong className="text-foreground">Video URL:</strong> {job?.url}</p>
            <p><strong className="text-foreground">Created:</strong> {job?.createdAt ? new Date(job.createdAt).toLocaleString() : "-"}</p>
          </div>

          <div className="bg-muted/50 rounded-md p-4 text-sm space-y-1 border">
            <p><strong className="text-foreground">Course ID:</strong> {job?.uploadParameters?.courseId || "-"}</p>
            <p><strong className="text-foreground">Version ID:</strong> {job?.uploadParameters?.versionId || "-"}</p>
            <p><strong className="text-foreground">Module ID:</strong> {job?.uploadParameters?.moduleId || "-"}</p>
          </div>

          <div className="space-y-2">
            {STAGE_ORDER.map((stage) => (
              <div key={stage} className="flex items-center justify-between border rounded-md px-3 py-2">
                <span className="text-sm">{STAGE_LABELS[stage]}</span>
                <Badge variant={statusVariant(job?.jobStatus?.[stage])}>
                  {job?.jobStatus?.[stage] || "UNKNOWN"}
                </Badge>
              </div>
            ))}
          </div>

          {error && (
            <p className="text-xs text-destructive">Last refresh failed: {error}</p>
          )}
        </CardContent>
      </Card>

      {atPreviewGate && (
        <CourseStructurePreview
          jobId={jobId as string}
          videoUrl={job?.url}
          hasExistingCourse={!!job?.uploadParameters?.courseId}
          onApproved={async () => {
            await approveContinueTask(jobId as string);
            fetchStatus();
          }}
        />
      )}
    </div>
  );
}
