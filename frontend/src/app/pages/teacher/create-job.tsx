import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTitle, DialogTrigger, DialogHeader, DialogFooter} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ChevronDown, Loader2, Wand2, Sparkles, CheckCircle2 } from "lucide-react";
import { createGenAIJob, convertTranscript, type Transcript } from "@/lib/genai-api";
import { useVideoUpload } from "@/hooks/media-hooks";

const REQUIRED_TRANSCRIPT_FORMAT_HINT =
    "Paste text with a timestamp on its own line before each spoken block -- mm:ss or h:mm:ss " +
    "(e.g. \"12:34\" or \"1:02:15\") -- followed by the text spoken until the next timestamp. " +
    "This gets converted into the pipeline's format: {\"chunks\": [{\"timestamp\": [start, end], \"text\": \"...\"}]}.";

function formatDuration(totalSeconds: number): string {
    const m = Math.floor(totalSeconds / 60);
    const s = Math.round(totalSeconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function GenerateSectionPage() {
    const navigate = useNavigate();
    const [courseId, setCourseId] = useState("");
    const [versionId, setVersionId] = useState("");
    const [moduleId, setModuleId] = useState("");
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [inputMode, setInputMode] = useState<"url" | "upload">("url");
    const [videoUrl, setVideoUrl] = useState("");
    const [questionsPerQuiz, setQuestionsPerQuiz] = useState("3");
    const [maxAttempts, setMaxAttempts] = useState("-1");
    const [isLoading, setIsLoading] = useState(false);
    const [showDialog, setShowDialog] = useState(false);

    // Upload-mode state
    const videoUpload = useVideoUpload();
    const [rawTranscript, setRawTranscript] = useState("");
    const [convertedTranscript, setConvertedTranscript] = useState<Transcript | null>(null);
    const [isConverting, setIsConverting] = useState(false);

    const canUseUploadMode = !!courseId && !!versionId;

    const handleVideoFileChange = async (file: File | null) => {
        if (!file || !canUseUploadMode) return;
        videoUpload.reset();
        await videoUpload.upload(file, { courseId, courseVersionId: versionId });
    };

    const handleConvertTranscript = async () => {
        if (!rawTranscript.trim()) {
            toast.error("Paste a transcript first");
            return;
        }
        setIsConverting(true);
        try {
            const result = await convertTranscript(rawTranscript);
            setConvertedTranscript(result);
            toast.success(`Converted ${result.chunks.length} chunk${result.chunks.length === 1 ? "" : "s"}.`);
        } catch (error) {
            toast.error("Failed to convert transcript", {
                description: error instanceof Error ? error.message : "An unexpected error occurred.",
            });
        } finally {
            setIsConverting(false);
        }
    };

    const handleGenerateSection = async () => {
        if(!!courseId !== !!versionId) {
            toast.error("Course ID and Version ID go together", {
                description: "Provide both to add to an existing course, or leave both blank to auto-create a new one.",
            });
            return;
        }
        if (inputMode === "url" && !videoUrl) {
            toast.error("Missing video URL", {
                description: "Please paste a YouTube URL before generating.",
            });
            return;
        }
        if (inputMode === "upload") {
            if (!videoUpload.asset) {
                toast.error("Upload a video first");
                return;
            }
            if (!convertedTranscript) {
                toast.error("Convert the transcript first");
                return;
            }
        }
        setIsLoading(true);
        try {
            const { jobId } = await createGenAIJob({
                videoUrl: inputMode === "url" ? videoUrl : undefined,
                videoAssetId: inputMode === "upload" ? videoUpload.asset?.assetId : undefined,
                transcript: inputMode === "upload" ? convertedTranscript ?? undefined : undefined,
                courseId: courseId || undefined,
                versionId: versionId || undefined,
                moduleId: moduleId || undefined,
                questionsPerQuiz: questionsPerQuiz ? Number(questionsPerQuiz) : undefined,
                maxAttempts: maxAttempts !== "" ? Number(maxAttempts) : undefined,
            });

            toast.success("Job started successfully!", {
                description: `Your Job has been created with ID: ${jobId}`,
            });
            setShowDialog(false);
            navigate({ to: "/teacher/jobs/$jobId", params: { jobId } });

        } catch (error) {
            toast.error("Error starting job", {
                description: error instanceof Error ? error.message : "An unexpected error occurred.",
            });
        } finally {
            setIsLoading(false);
        }
    };

    const videoSummary = inputMode === "url"
        ? (videoUrl || "-")
        : (videoUpload.asset ? `Uploaded: ${videoUpload.asset.originalFileName}` : "(not uploaded yet)");

    return (
        <div className="max-w-2xl mx-auto p-6">
            <Card className="border-muted bg-muted/10">
                <CardContent className="space-y-4 py-6">
                    <h2 className="text-xl font-semibold flex items-center gap-2">
                        <Wand2 className="h-5 w-5 text-primary" />
                        Generate Course from a Video
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        Paste a YouTube URL, or upload a video and transcript directly. A new course, version, and
                        module are proposed automatically -- you'll review and can edit everything before anything
                        is created for real.
                    </p>

                    <div className="flex gap-2">
                        <Button
                            type="button"
                            variant={inputMode === "url" ? "default" : "outline"}
                            size="sm"
                            onClick={() => setInputMode("url")}
                        >
                            YouTube URL
                        </Button>
                        <Button
                            type="button"
                            variant={inputMode === "upload" ? "default" : "outline"}
                            size="sm"
                            onClick={() => {
                                setInputMode("upload");
                                if (!canUseUploadMode) setShowAdvanced(true);
                            }}
                        >
                            Upload video + transcript
                        </Button>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <button
                                type="button"
                                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                                onClick={() => setShowAdvanced(v => !v)}
                            >
                                <ChevronDown className={`h-4 w-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
                                {inputMode === "upload" ? "Course to add to (required for upload)" : "Advanced: add to an existing course"}
                            </button>
                            {showAdvanced && (
                                <div className="space-y-4 mt-3 pl-1">
                                    <Input
                                        placeholder="Course ID (leave blank to auto-create a new course)"
                                        value={courseId}
                                        onChange={(e) => setCourseId(e.target.value)}
                                    />
                                    <Input
                                        placeholder="Version ID (leave blank to auto-create a new version)"
                                        value={versionId}
                                        onChange={(e) => setVersionId(e.target.value)}
                                    />
                                    <Input
                                        placeholder="Module ID (leave blank to auto-create a new module)"
                                        value={moduleId}
                                        onChange={(e) => setModuleId(e.target.value)}
                                    />
                                </div>
                            )}
                        </div>

                        {inputMode === "url" ? (
                            <Input
                                placeholder="YouTube Video URL"
                                value={videoUrl}
                                onChange={(e) => setVideoUrl(e.target.value)}
                            />
                        ) : !canUseUploadMode ? (
                            <p className="text-sm text-amber-600 dark:text-amber-500">
                                Uploading a video attaches it to a course's video library, so a Course ID and Version ID
                                are required above -- unlike the YouTube-URL flow, this can't auto-create a new course.
                            </p>
                        ) : (
                            <div className="space-y-4">
                                <div>
                                    <Label className="mb-2">Video file</Label>
                                    <Input
                                        type="file"
                                        accept="video/mp4"
                                        onChange={(e) => handleVideoFileChange(e.target.files?.[0] ?? null)}
                                        disabled={videoUpload.phase === "requesting" || videoUpload.phase === "uploading" || videoUpload.phase === "finalizing"}
                                    />
                                    {videoUpload.phase !== "idle" && videoUpload.phase !== "done" && (
                                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                            {videoUpload.phase === "requesting" && "Requesting upload URL..."}
                                            {videoUpload.phase === "uploading" && `Uploading... ${videoUpload.progress}%`}
                                            {videoUpload.phase === "finalizing" && "Finalizing..."}
                                        </p>
                                    )}
                                    {videoUpload.phase === "done" && videoUpload.asset && (
                                        <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-1 flex items-center gap-1">
                                            <CheckCircle2 className="h-3 w-3" />
                                            Uploaded: {videoUpload.asset.originalFileName}
                                        </p>
                                    )}
                                    {videoUpload.phase === "error" && (
                                        <p className="text-xs text-destructive mt-1">{videoUpload.error}</p>
                                    )}
                                </div>

                                <div>
                                    <Label className="mb-2">Transcript</Label>
                                    <Textarea
                                        placeholder="0:00&#10;Hello and welcome...&#10;0:45&#10;Today we are covering..."
                                        value={rawTranscript}
                                        onChange={(e) => { setRawTranscript(e.target.value); setConvertedTranscript(null); }}
                                        rows={6}
                                    />
                                    <p className="text-xs text-muted-foreground mt-1">{REQUIRED_TRANSCRIPT_FORMAT_HINT}</p>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="mt-2"
                                        onClick={handleConvertTranscript}
                                        disabled={isConverting || !rawTranscript.trim()}
                                    >
                                        {isConverting ? (
                                            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Converting with MiniMax...</>
                                        ) : (
                                            <><Sparkles className="h-4 w-4 mr-2" />Convert with MiniMax</>
                                        )}
                                    </Button>
                                    {convertedTranscript && (
                                        <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-1 flex items-center gap-1">
                                            <CheckCircle2 className="h-3 w-3" />
                                            {convertedTranscript.chunks.length} chunk{convertedTranscript.chunks.length === 1 ? "" : "s"} extracted,
                                            covering 0:00–{formatDuration(convertedTranscript.chunks.at(-1)?.timestamp[1] ?? convertedTranscript.chunks.at(-1)?.timestamp[0] ?? 0)}.
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}

                        <div>
                            <Label htmlFor="questionsPerQuiz" className="mb-2">Questions per section</Label>
                            <Input
                                id="questionsPerQuiz"
                                type="number"
                                min="1"
                                value={questionsPerQuiz}
                                onChange={(e) => setQuestionsPerQuiz(e.target.value)}
                            />
                        </div>
                        <div>
                            <Label htmlFor="maxAttempts" className="mb-2">Attempts allowed</Label>
                            <Input
                                id="maxAttempts"
                                type="number"
                                min="-1"
                                value={maxAttempts}
                                onChange={(e) => setMaxAttempts(e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                Maximum attempts allowed (-1 for unlimited)
                            </p>
                        </div>
                    </div>

                    <div className="bg-muted/50 rounded-md p-4 mt-6 text-sm text-foreground shadow-sm space-y-1 border">
                        <p><strong className="text-foreground">Course:</strong> {courseId || "(auto-create)"}</p>
                        <p><strong className="text-foreground">Version:</strong> {versionId || "(auto-create)"}</p>
                        <p><strong className="text-foreground">Video:</strong> {videoSummary}</p>
                        <p><strong className="text-foreground">Module ID:</strong> {moduleId || "(auto-create)"}</p>
                        <p><strong className="text-foreground">Questions per section:</strong> {questionsPerQuiz || "-"}</p>
                        <p><strong className="text-foreground">Attempts allowed:</strong> {maxAttempts === "-1" ? "Unlimited" : maxAttempts || "-"}</p>
                    </div>

                    <Dialog open={showDialog} onOpenChange={setShowDialog}>
                        <DialogTrigger asChild>
                            <Button variant="default" >
                                <Wand2 className="h-5 w-5 mr-2" />
                                Generate Section
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <div className="flex items-center gap-2 mb-4">
                                    <Wand2 className="h-6 w-6 text-primary mb-2" />
                                    <DialogTitle className="text-lg font-semibold">Confirm Section Generation</DialogTitle>
                                </div>
                            </DialogHeader>
                            <div className="text-sm text-muted-foreground space-y-2">
                                <p><strong className="text-foreground">Course:</strong> {courseId || "(auto-create)"}</p>
                                <p><strong className="text-foreground">Version:</strong> {versionId || "(auto-create)"}</p>
                                <p><strong className="text-foreground">Video:</strong> {videoSummary}</p>
                                <p><strong className="text-foreground">Module ID:</strong> {moduleId || "(auto-create)"}</p>
                                <p><strong className="text-foreground">Questions per section:</strong> {questionsPerQuiz}</p>
                                <p><strong className="text-foreground">Attempts allowed:</strong> {maxAttempts === "-1" ? "Unlimited" : maxAttempts}</p>
                            </div>
                            <DialogFooter className="mt-4">
                                <Button variant={"outline"} onClick={() => setShowDialog(false)}>
                                    Cancel
                                </Button>
                                <Button
                                    onClick={handleGenerateSection}
                                    className="default"
                                    disabled={isLoading}
                                >
                                    {isLoading ? (
                                        <>
                                            <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                                            Generating...
                                        </>
                                    ) : (
                                        <>
                                            Generate
                                        </>
                                    )}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </CardContent>
            </Card>
        </div>
    );
}
