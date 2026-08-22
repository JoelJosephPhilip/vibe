import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogFooter } from "@/components/ui/dialog";
import { Loader2, RefreshCw, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { listMyJobs, deleteJob } from "@/lib/genai-api";

function overallStatus(jobStatus?: Record<string, string>): string {
  if (!jobStatus) return "UNKNOWN";
  const values = Object.values(jobStatus);
  if (values.includes("FAILED")) return "FAILED";
  if (values.includes("RUNNING")) return "RUNNING";
  if (values.every((v) => v === "COMPLETED")) return "COMPLETED";
  return "WAITING";
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "COMPLETED":
      return "default";
    case "RUNNING":
      return "secondary";
    case "FAILED":
      return "destructive";
    default:
      return "outline";
  }
}

export default function JobsListPage() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [jobToDelete, setJobToDelete] = useState<any>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchJobs = async () => {
    try {
      const data = await listMyJobs();
      setJobs(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load jobs.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  const handleDelete = async () => {
    if (!jobToDelete) return;
    setIsDeleting(true);
    try {
      await deleteJob(jobToDelete._id);
      toast.success("Job deleted");
      setJobToDelete(null);
      await fetchJobs();
    } catch (err) {
      toast.error("Failed to delete job", {
        description: err instanceof Error ? err.message : "An unexpected error occurred.",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Wand2 className="h-5 w-5 text-primary" />
          My genAI Jobs
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchJobs}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Link to="/teacher/jobs/create">
            <Button variant="default" size="sm">
              <Wand2 className="h-4 w-4 mr-2" />
              New Job
            </Button>
          </Link>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading jobs...
        </div>
      )}

      {error && !isLoading && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {!isLoading && !error && jobs.length === 0 && (
        <Card className="border-muted bg-muted/10">
          <CardContent className="py-6 text-sm text-muted-foreground">
            No jobs yet. Click "New Job" to generate a section from a YouTube URL.
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {jobs.map((job) => {
          const status = overallStatus(job.jobStatus);
          return (
            <Card key={job._id} className="hover:bg-muted/30 transition-colors">
              <CardContent className="py-3 flex items-center justify-between gap-2">
                <Link
                  to="/teacher/jobs/$jobId"
                  params={{ jobId: job._id }}
                  className="min-w-0 flex-1"
                >
                  <p className="text-sm font-medium truncate">{job.url}</p>
                  <p className="text-xs text-muted-foreground">
                    {job._id} · {job.createdAt ? new Date(job.createdAt).toLocaleString() : "-"}
                  </p>
                </Link>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={statusVariant(status)}>{status}</Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setJobToDelete(job)}
                    aria-label="Delete job"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!jobToDelete} onOpenChange={(open) => !open && setJobToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this job?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {jobToDelete?.url}
            <br />
            This permanently removes the job and its task data. This cannot be undone.
          </p>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setJobToDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
