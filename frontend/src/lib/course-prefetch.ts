import { queryClient } from "@/lib/client";
import { api } from "@/lib/openapi";

type PrefetchArgs = { courseId: string; versionId: string; cohortId?: string };

/**
 * Warms the exact same React Query cache entries course-page.tsx's hooks
 * read from (useCourseVersionById, useUserProgress, useModuleProgress,
 * useGetEthicsConsent, useItemsBySectionId, useItemById), so a dashboard
 * card mounting ahead of time means clicking its Continue button finds
 * everything already cached instead of waterfalling through loading states
 * after the navigation.
 *
 * Every init object below is copied verbatim from the corresponding hook in
 * hooks.ts / system-notification-hooks.ts — queryOptions()'s queryKey is
 * [method, path, init], hashed by exact shape (a present-but-empty `query`
 * is a different key than no `query` at all), so any drift from the real
 * hook's shape here is a silent cache miss, not a type error.
 */
export async function prefetchCourseLaunch({ courseId, versionId, cohortId }: PrefetchArgs) {
  if (!courseId || !versionId) return;

  // Fire-and-forget: course version + module progress + ethics consent.
  // prefetchQuery swallows errors on its own, which is what we want for a
  // best-effort warm-up triggered just from a card being on screen.
  void queryClient.prefetchQuery(
    api.queryOptions("get", "/courses/versions/{id}", {
      params: { path: { id: versionId }, ...(cohortId ? { query: { cohortId } } : {}) },
    } as any),
  );
  void queryClient.prefetchQuery(
    api.queryOptions("get", `/users/progress/courses/${courseId}/versions/${versionId}/modules` as any, {
      params: { path: { courseId, versionId }, query: { cohortId } },
    } as any),
  );
  void queryClient.prefetchQuery(
    api.queryOptions("get", "/users/enrollments/courses/{courseId}/versions/{versionId}/ethics-consent" as any, {
      params: { path: { courseId, versionId } },
    } as any),
  );

  // The progress call tells us *which* item the student left off on, so it's
  // awaited (fetchQuery returns the data; prefetchQuery doesn't) while
  // everything else here is fire-and-forget.
  try {
    const progress: any = await queryClient.fetchQuery(
      api.queryOptions("get", "/users/progress/courses/{courseId}/versions/{courseVersionId}", {
        params: { path: { courseId, courseVersionId: versionId }, query: { cohortId } },
      } as any),
    );

    const moduleId = progress?.currentModule;
    const sectionId = progress?.currentSection;
    const itemId = progress?.currentItem;
    if (!moduleId || !sectionId) return;

    void queryClient.prefetchQuery(
      api.queryOptions("get", "/courses/versions/{versionId}/modules/{moduleId}/sections/{sectionId}/items", {
        params: { path: { versionId, moduleId, sectionId }, ...(cohortId ? { query: { cohortId } } : {}) },
      } as any),
    );

    if (itemId) {
      void queryClient.prefetchQuery(
        api.queryOptions(
          "get",
          "/courses/{courseId}/versions/{versionId}/modules/{moduleId}/sections/{sectionId}/item/{itemId}",
          {
            params: {
              path: { courseId, versionId, itemId, moduleId, sectionId },
              ...(cohortId ? { query: { cohortId } } : {}),
            },
          } as any,
        ),
      );
    }
  } catch {
    // Best-effort warm-up only — course-page's own hooks fetch normally if this failed.
  }
}
