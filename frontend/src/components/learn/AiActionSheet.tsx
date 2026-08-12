import { MessageSquare, Mic, Sparkles } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { AiActionId } from "./AiCompanion";
import { DoubtsPanel } from "./DoubtsPanel";
import type { DoubtItemRef } from "@/lib/api/doubts";

// "discussion" is a real feature (DoubtsPanel). "report" is handled by the
// existing FlagModal in the parent. Only chat/talk are still placeholders.
const placeholders: Record<
  "chat" | "talk",
  { title: string; icon: typeof MessageSquare; blurb: string }
> = {
  chat: {
    title: "AI chat",
    icon: MessageSquare,
    blurb:
      "Ask questions about this lesson and get instant explanations. Your AI study companion is coming soon.",
  },
  talk: {
    title: "AI talk",
    icon: Mic,
    blurb:
      "Have a spoken conversation with your AI tutor — talk through ideas hands-free. Coming soon.",
  },
};

type Props = {
  active: Exclude<AiActionId, "report"> | null;
  onClose: () => void;
  /** Absent when the current item isn't a video — discussion is video-only. */
  doubtContext?: {
    itemRef: DoubtItemRef;
    cohortId?: string;
    moduleId?: string;
    sectionId?: string;
    askAtSeconds: number;
    seekForwardEnabled: boolean;
    currentTime: number;
    onSeek: (seconds: number) => void;
    isInstructor?: boolean;
  };
};

export function AiActionSheet({ active, onClose, doubtContext }: Props) {
  const placeholder =
    active && active !== "discussion" ? placeholders[active] : null;

  return (
    <Sheet open={!!active} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="bg-card text-card-foreground sm:max-w-md">
        {active === "discussion" ? (
          <div className="flex h-full flex-col p-6">
            {doubtContext ? (
              <DoubtsPanel {...doubtContext} />
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Discussion is available on video lessons.
              </p>
            )}
          </div>
        ) : (
          placeholder && (
            <div className="flex h-full flex-col p-6">
              <div className="mb-2 inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <Sparkles className="h-3 w-3" /> AI companion
              </div>
              <div className="mb-4 flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-ai/15 text-ai">
                  <placeholder.icon className="h-5 w-5" />
                </div>
                <h2 className="text-xl font-semibold">{placeholder.title}</h2>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {placeholder.blurb}
              </p>

              <div className="mt-6 rounded-2xl border border-dashed border-border bg-muted/40 p-5 text-center">
                <Sparkles className="mx-auto mb-2 h-6 w-6 text-ai" />
                <p className="text-sm font-medium">Coming soon</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  This experience is being built. Check back shortly.
                </p>
              </div>
            </div>
          )
        )}
      </SheetContent>
    </Sheet>
  );
}

export default AiActionSheet;
