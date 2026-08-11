import { useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { BookOpen, Megaphone, Search } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useAuthStore } from "@/store/auth-store"
import { useUserEnrollments } from "@/hooks/hooks"
import { useAnnouncements } from "@/hooks/announcement-hooks"

const MAX_RESULTS_PER_GROUP = 6

interface GlobalSearchModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function GlobalSearchModal({ open, onOpenChange }: GlobalSearchModalProps) {
  const { token, user } = useAuthStore()
  const navigate = useNavigate()
  const [query, setQuery] = useState("")

  // Reuses the same enrollments query the sidebar already fires for the
  // HP-system nav check — React Query dedupes it, no extra request.
  const { data: enrollmentsData } = useUserEnrollments(1, 100, !!token && !!user?.uid)
  const { data: announcements, isLoading: announcementsLoading } = useAnnouncements(
    undefined, undefined, undefined, true,
  )

  const q = query.trim().toLowerCase()

  const courseMatches = q
    ? (enrollmentsData?.enrollments ?? [])
        .filter((e: any) => e?.course?.name?.toLowerCase().includes(q))
        .slice(0, MAX_RESULTS_PER_GROUP)
    : []

  const announcementMatches = q
    ? announcements
        .filter(a => a.title.toLowerCase().includes(q) || a.content.toLowerCase().includes(q))
        .slice(0, MAX_RESULTS_PER_GROUP)
    : []

  const hasResults = courseMatches.length > 0 || announcementMatches.length > 0

  const close = () => {
    setQuery("")
    onOpenChange(false)
  }

  const goToCourse = () => {
    navigate({ to: "/student/courses" })
    close()
  }

  const goToAnnouncement = (id: string) => {
    // No route in this app defines a typed search schema, so avoid TanStack's
    // `search` option; sessionStorage is a simpler, router-agnostic handoff.
    sessionStorage.setItem("pendingAnnouncementHighlight", id)
    navigate({ to: "/student/announcements" })
    close()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Search</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            autoFocus
            placeholder="Search courses and announcements..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="max-h-80 overflow-y-auto space-y-4">
          {!q ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Type to search your courses and announcements.
            </p>
          ) : !hasResults && !announcementsLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No results for &quot;{query}&quot;.
            </p>
          ) : (
            <>
              {courseMatches.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground px-1 mb-1">Courses</p>
                  {courseMatches.map((e: any) => (
                    <button
                      key={e.courseId}
                      onClick={goToCourse}
                      className="w-full flex items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent"
                    >
                      <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{e.course?.name}</p>
                        {e.cohortName && (
                          <p className="text-xs text-muted-foreground truncate">{e.cohortName}</p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {announcementMatches.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground px-1 mb-1">Announcements</p>
                  {announcementMatches.map((a) => (
                    <button
                      key={a._id}
                      onClick={() => goToAnnouncement(a._id)}
                      className="w-full flex items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent"
                    >
                      <Megaphone className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{a.title}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {a.type.replace("_", " ")} · {new Date(a.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
