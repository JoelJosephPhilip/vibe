import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Loader2, Wand2, Scissors, Combine } from "lucide-react";
import { toast } from "sonner";
import { getCoursePlan, updateCoursePlan, editSegmentMap, type CoursePlan, type CourseSectionPlan } from "@/lib/genai-api";

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

interface Props {
  jobId: string;
  videoUrl?: string;
  onApproved: () => void | Promise<void>;
}

export default function CourseStructurePreview({ jobId, videoUrl, onApproved }: Props) {
  const [plan, setPlan] = useState<CoursePlan | null>(null);
  const [sections, setSections] = useState<CourseSectionPlan[]>([]);
  const [moduleName, setModuleName] = useState("");
  const [moduleDescription, setModuleDescription] = useState("");
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

  const saveEdits = async () => {
    setBusy(true);
    try {
      await updateCoursePlan(jobId, {
        moduleName,
        moduleDescription,
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
              <Label htmlFor="moduleName">Module Name</Label>
              <Input id="moduleName" value={moduleName} onChange={e => setModuleName(e.target.value)} />
              <Label htmlFor="moduleDescription">Module Description</Label>
              <Textarea id="moduleDescription" value={moduleDescription} onChange={e => setModuleDescription(e.target.value)} rows={2} />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            1 module &middot; {sections.length} section{sections.length === 1 ? "" : "s"} &middot; {sections.length} quiz{sections.length === 1 ? "" : "es"}
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
              <div className="aspect-video w-full max-w-sm rounded-md overflow-hidden border">
                <iframe
                  className="w-full h-full"
                  src={`https://www.youtube.com/embed/${videoId}?start=${Math.floor(section.segmentStart)}&end=${Math.ceil(section.segmentEnd)}`}
                  title={`Preview: ${section.name}`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      <Card className="border-muted bg-muted/10">
        <CardContent className="py-4 flex justify-end gap-2">
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
