import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogTitle, DialogTrigger, DialogHeader, DialogFooter} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ChevronDown, Loader2, Wand2 } from "lucide-react";
import { createGenAIJob } from "@/lib/genai-api";

export default function GenerateSectionPage() {
    const navigate = useNavigate();
    const [courseId, setCourseId] = useState("");
    const [versionId, setVersionId] = useState("");
    const [moduleId, setModuleId] = useState("");
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [videoUrl, setVideoUrl] = useState("");
    const [questionsPerQuiz, setQuestionsPerQuiz] = useState("3");
    const [maxAttempts, setMaxAttempts] = useState("-1");
    const [isLoading, setIsLoading] = useState(false);
    const [showDialog, setShowDialog] = useState(false);


    const handleGenerateSection = async () => {
        if(!videoUrl) {
            toast.error("Missing video URL", {
                description: "Please paste a YouTube URL before generating.",
            });
            return;
        }
        setIsLoading(true);
        try {
            const { jobId } = await createGenAIJob({
                videoUrl,
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
    return (
        <div className="max-w-2xl mx-auto p-6">
            <Card className="border-muted bg-muted/10">
                <CardContent className="space-y-4 py-6">
                    <h2 className="text-xl font-semibold flex items-center gap-2">
                        <Wand2 className="h-5 w-5 text-primary" />
                        Generate Course from YouTube URL
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        Paste a YouTube URL below. A new course, version, and module are proposed automatically --
                        you'll review and can edit everything (including the title) before anything is created for real.
                    </p>

                    <div className="space-y-4">
                        <Input
                            placeholder="YouTube Video URL"
                            value={videoUrl}
                            onChange={(e) => setVideoUrl(e.target.value)}
                            className="mb-4"
                        />
                        <div>
                            <button
                                type="button"
                                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                                onClick={() => setShowAdvanced(v => !v)}
                            >
                                <ChevronDown className={`h-4 w-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
                                Advanced: add to an existing course
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
                        <p><strong className="text-foreground">Video URL:</strong> {videoUrl || "-"}</p>
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
                                <p><strong className="text-foreground">Video URL:</strong> {videoUrl}</p>
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
