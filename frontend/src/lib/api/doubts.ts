/**
 * Client for the per-video doubts API.
 *
 * Hand-written for the same reason as lib/api/peer-reviews.ts — these routes are
 * new and not in the committed OpenAPI spec yet.
 */

const BASE_URL = `${import.meta.env.VITE_BASE_URL}/doubts`;

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('firebase-auth-token');
  return {
    'Content-Type': 'application/json',
    ...(token ? {Authorization: `Bearer ${token}`} : {}),
  };
}

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {...getAuthHeaders(), ...(options?.headers || {})},
    credentials: 'include',
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.message || `Request failed (${res.status})`);
  }
  return res.json();
}

export interface DoubtReply {
  _id: string;
  userId: string;
  userName: string;
  role: 'STUDENT' | 'INSTRUCTOR';
  content: string;
  isHidden: boolean;
  createdAt: string;
}

export interface Doubt {
  _id: string;
  itemId: string;
  courseId: string;
  courseVersionId: string;
  /** Present on doubts created after the instructor "View" action shipped. */
  moduleId?: string;
  sectionId?: string;
  userId: string;
  userName: string;
  /** Seconds into the video this doubt refers to. */
  videoTimestamp: number;
  content: string;
  status: 'OPEN' | 'RESOLVED';
  isHidden: boolean;
  createdAt: string;
  replies: DoubtReply[];
}

/** Identifies the video item a doubt belongs to. */
export interface DoubtItemRef {
  itemId: string;
  courseId: string;
  courseVersionId: string;
}

export const doubtsApi = {
  listForItem: (ref: DoubtItemRef) => {
    const params = new URLSearchParams({
      courseId: ref.courseId,
      courseVersionId: ref.courseVersionId,
    });
    return apiFetch<{items: Doubt[]}>(
      `${BASE_URL}/items/${ref.itemId}?${params.toString()}`,
    );
  },

  create: (
    ref: DoubtItemRef,
    body: {
      content: string;
      videoTimestamp: number;
      cohortId?: string;
      moduleId?: string;
      sectionId?: string;
    },
  ) =>
    apiFetch<Doubt>(`${BASE_URL}/items/${ref.itemId}`, {
      method: 'POST',
      body: JSON.stringify({
        courseId: ref.courseId,
        courseVersionId: ref.courseVersionId,
        ...body,
      }),
    }),

  reply: (doubtId: string, content: string) =>
    apiFetch<DoubtReply>(`${BASE_URL}/${doubtId}/replies`, {
      method: 'POST',
      body: JSON.stringify({content}),
    }),

  setStatus: (doubtId: string, status: 'OPEN' | 'RESOLVED') =>
    apiFetch<{success: boolean}>(`${BASE_URL}/${doubtId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({status}),
    }),

  setHidden: (doubtId: string, isHidden: boolean) =>
    apiFetch<{success: boolean}>(`${BASE_URL}/${doubtId}/hide`, {
      method: 'PATCH',
      body: JSON.stringify({isHidden}),
    }),

  remove: (doubtId: string) =>
    apiFetch<{success: boolean}>(`${BASE_URL}/${doubtId}`, {method: 'DELETE'}),

  listForCourseVersion: (
    courseId: string,
    courseVersionId: string,
    status?: 'OPEN' | 'RESOLVED' | 'ALL',
  ) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    const qs = params.toString();
    return apiFetch<{items: Doubt[]}>(
      `${BASE_URL}/courses/${courseId}/versions/${courseVersionId}${qs ? `?${qs}` : ''}`,
    );
  },
};
