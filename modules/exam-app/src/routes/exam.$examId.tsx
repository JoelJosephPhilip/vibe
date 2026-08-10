import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

function CountdownDisplay({ initialSeconds, onExpire }: { initialSeconds: number; onExpire?: () => void }) {
  const [s, setS] = useState(initialSeconds);
  useEffect(() => {
    if (s <= 0) { onExpire?.(); return; }
    const id = setInterval(() => setS((p) => (p <= 1 ? (onExpire?.(), 0) : p - 1)), 1000);
    return () => clearInterval(id);
  }, [s, onExpire]);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return <span>{String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:{String(sec).padStart(2, "0")}</span>;
}


import { Palette } from "@/components/exam/Palette";
import { QuestionRenderer } from "@/components/exam/QuestionRenderer";
import { Calculator } from "@/components/exam/Calculator";
import { examStore } from "@/lib/examStore";

export const Route = createFileRoute("/exam/$examId")({
  head: () => ({
    meta: [
      { title: "Exam — DEMO" },
      { name: "description", content: "Take your DEMO test." },
      { property: "og:title", content: "Exam — DEMO Test" },
      { property: "og:description", content: "Take your DEMO test." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExamPage,
});

function ExamPage() {
  const navigate = useNavigate();
  const { examId } = Route.useParams();
  const examData = examStore.get(examId);

  if (!examData || examData.questions.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-center">
        <div className="max-w-md space-y-3">
          <h1 className="text-2xl font-bold">Test not available</h1>
          <p className="text-sm text-muted-foreground">
            This test does not exist or has no questions yet.
          </p>
          <button
            onClick={() => navigate({ to: "/" })}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Back to home
          </button>
        </div>
      </div>
    );
  }

  const exam = {
    ...examData,
    totalMarks: examStore.totalMarks(examData),
  };
  const questions = examData.questions;
  const answers = examStore.answersMap(examData);
  const subjectName = examData.title;
  const candidateName = examData.candidateName || "DEMO CANDIDATE";
  const candidateRegId = "";
  const headerTitle = examData.headerTitle || "Graduate Aptitude Test in Engineering (GATE 2026)";
  const headerSubtitle = examData.headerSubtitle || "Organizing Institute: Indian Institute of Technology Guwahati";
  const leftBadge = examData.leftBadge || "GATE";
  const rightBadge = examData.rightBadge || "IITG";

  const [currentIndex, setCurrentIndex] = useState(0);
  const [showCalc, setShowCalc] = useState(false);
  const [responses, setResponses] = useState<any[]>(
    questions.map((q) => ({
      question: q.id,
      selectedOptions: [],
      natAnswer: "",
      isMarkedForReview: false,
      isAnswered: false,
      visited: false,
      timeSpent: 0,
    }))
  );

  const [tabSwitches, setTabSwitches] = useState(0);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [showTabWarning, setShowTabWarning] = useState(false);
  const startedAtRef = useRef(Date.now());

  useEffect(() => {
    setResponses((prev) => {
      const next = [...prev];
      if (!next[currentIndex]?.visited) {
        next[currentIndex] = { ...next[currentIndex], visited: true };
      }
      return next;
    });
  }, [currentIndex]);

  useEffect(() => {
    const onBlur = () => {
      setTabSwitches((prev) => prev + 1);
      setShowTabWarning(true);
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);

  const updateResponse = (update: any) => {
    setResponses((prev) => {
      const next = [...prev];
      const merged = { ...next[currentIndex], ...update, visited: true };
      merged.isAnswered =
        (merged.selectedOptions && merged.selectedOptions.length > 0) ||
        (merged.natAnswer && merged.natAnswer.length > 0);
      next[currentIndex] = merged;
      return next;
    });
  };

  const goNext = () => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1));
  const goPrev = () => setCurrentIndex((i) => Math.max(0, i - 1));

  const handleSaveAndNext = () => goNext();
  const handleMarkReviewNext = () => {
    updateResponse({ isMarkedForReview: true });
    goNext();
  };
  const handleClearResponse = () => {
    updateResponse({ selectedOptions: [], natAnswer: "", isAnswered: false });
  };

  const handleSubmit = (_timedOut = false) => {
    let score = 0;
    let correctCount = 0;
    responses.forEach((r, i) => {
      const q = questions[i];
      const key = answers[q.id];
      if (!key) return;
      if (q.type === "NAT") {
        if ((r.natAnswer || "").trim() === key.correct) {
          score += q.marks;
          correctCount++;
        }
      } else if (q.type === "MCQ") {
        const sel = (r.selectedOptions || [])[0];
        const correct = Array.isArray(key.correct) ? key.correct[0] : key.correct;
        if (sel === correct) {
          score += q.marks;
          correctCount++;
        } else if (sel) {
          score -= q.negativeMarks;
        }
      } else if (q.type === "MSQ") {
        const sel = [...(r.selectedOptions || [])].sort().join(",");
        const correct = ([] as string[]).concat(key.correct as any).sort().join(",");
        if (sel === correct && sel.length > 0) {
          score += q.marks;
          correctCount++;
        }
      }
    });
    const attemptId = `local-${Date.now()}`;
    sessionStorage.setItem(
      `result_${attemptId}`,
      JSON.stringify({
        score: Math.max(0, Number(score.toFixed(2))),
        totalMarks: exam.totalMarks,
        correctCount,
        total: questions.length,
        responses,
        questions,
        answers,
      })
    );
    navigate({ to: "/result/$attemptId", params: { attemptId } });
  };

  const currentQuestion = questions[currentIndex];
  const remainingSeconds = Math.max(
    0,
    exam.duration * 60 - Math.floor((Date.now() - startedAtRef.current) / 1000)
  );

  const counts = responses.reduce(
    (acc, r) => {
      if (r.isAnswered && r.isMarkedForReview) acc.answeredMarked++;
      else if (r.isAnswered) acc.answered++;
      else if (r.isMarkedForReview) acc.marked++;
      else if (r.visited) acc.notAnswered++;
      else acc.notVisited++;
      return acc;
    },
    { answered: 0, marked: 0, notAnswered: 0, notVisited: 0, answeredMarked: 0 }
  );

  const watermarkSvg = `data:image/svg+xml,%3Csvg width='350' height='200' xmlns='http://www.w3.org/2000/svg'%3E%3Ctext x='50%25' y='50%25' font-size='24' fill='rgba(0,0,0,0.05)' font-family='Arial' font-weight='bold' text-anchor='middle' transform='rotate(-35, 175, 100)'%3E${encodeURIComponent(subjectName + " " + candidateRegId)}%3C/text%3E%3C/svg%3E`;

  return (
    <div className="flex min-h-screen flex-col bg-[#f0f4f8]" style={{ fontFamily: "Inter, sans-serif" }}>
      {/* Top brand bar */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-1">
        <div className="flex items-center">
          <div className="grid h-12 w-12 place-items-center rounded bg-[#5D54D5] px-1 text-center text-[10px] font-bold leading-tight text-white">
            {leftBadge}
          </div>
        </div>
        <div className="text-center">
          <h1 className="text-lg font-bold uppercase tracking-tight text-[#5D54D5] sm:text-xl">
            {headerTitle}
          </h1>
          <p className="-mt-1 text-[10px] font-bold uppercase tracking-widest text-green-700">
            {headerSubtitle}
          </p>
        </div>
        <div className="flex items-center">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-gray-800 px-1 text-center text-[9px] font-bold leading-tight text-white">
            {rightBadge}
          </div>
        </div>
      </div>

      {/* Dark yellow bar */}
      <div className="flex items-center justify-between bg-[#424242] px-4 py-1 text-sm font-semibold text-[#FFFF00]">
        <span>{subjectName} Mock</span>
        <button
          onClick={() => setShowCalc((s) => !s)}
          className="flex items-center gap-1 text-white transition-colors hover:text-blue-200"
        >
          <span className="text-xs">🖩 Scientific Calculator</span>
        </button>
      </div>

      {/* Sections + timer + candidate */}
      <div className="flex items-stretch border-b border-gray-300 bg-[#F3F3F3]" style={{ minHeight: 86 }}>
        <div className="flex flex-grow flex-col justify-end">
          <div className="px-4 py-1 text-[10px] font-bold uppercase text-gray-600">Sections</div>
          <div className="flex items-center gap-1 px-4">
            <div className="rounded-t-md border border-[#287baf] bg-[#287baf] px-4 py-2 text-sm font-bold text-white">
              {subjectName}
            </div>
          </div>
        </div>

        <div className="flex items-center border-l border-gray-300 bg-white">
          <div className="flex h-full min-w-[150px] flex-col justify-center border-r border-gray-300 px-6 text-right">
            <span className="mb-1 text-[10px] font-bold uppercase text-gray-500">Time Left:</span>
            <div className="text-[22px] font-extrabold leading-none tracking-tighter text-gray-800" style={{ fontFamily: "monospace" }}>
              <CountdownDisplay initialSeconds={remainingSeconds} onExpire={() => handleSubmit(true)} />
            </div>
          </div>

          <div className="flex h-full items-center gap-3 bg-white px-4">
            <div className="flex flex-col justify-center">
              <span className="mb-1 text-[10px] font-bold uppercase leading-none text-gray-500">
                Candidate Name:
              </span>
              <span className="text-[15px] font-bold uppercase leading-tight text-[#1F4E79]">
                {candidateName}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main grid */}
      <main className="w-full flex-grow overflow-y-auto p-4">
        <div className="mx-auto grid h-full max-w-7xl grid-cols-1 gap-4 lg:grid-cols-4">
          <div className="flex flex-col gap-2 lg:col-span-3">
            {/* Question type strip */}
            <div className="flex flex-wrap items-center justify-between gap-2 border border-gray-300 bg-white px-4 py-2 text-[13px] shadow-sm">
              <div className="font-bold text-black">
                Question Type: <span className="font-normal">{currentQuestion?.type}</span>
              </div>
              <div className="flex items-center text-gray-700">
                Marks for correct answer:&nbsp;
                <span className="font-bold text-green-700">{currentQuestion?.marks}</span>
                <span className="mx-2 text-gray-400">|</span>
                Negative Marks:&nbsp;
                <span className="font-bold text-red-700">{currentQuestion?.negativeMarks}</span>
              </div>
            </div>

            {/* Question card */}
            <div className="flex min-h-[450px] flex-col border border-gray-300 bg-white shadow-sm">
              <div className="border-b border-gray-200 px-4 py-2">
                <h2 className="text-[15px] font-bold text-black">
                  Question No. <span>{currentIndex + 1}</span>
                </h2>
              </div>
              <div
                className="relative flex-grow overflow-y-auto p-6"
                style={{
                  backgroundImage: `url("${watermarkSvg}")`,
                  backgroundRepeat: "repeat",
                }}
              >
                <div className="relative z-10">
                  {currentQuestion && (
                    <QuestionRenderer
                      question={currentQuestion as any}
                      response={responses[currentIndex] || {}}
                      onChange={updateResponse}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Palette */}
          <div className="lg:col-span-1">
            <Palette
              total={questions.length}
              current={currentIndex}
              responses={responses}
              onSelect={(i) => setCurrentIndex(i)}
            />
          </div>
        </div>
      </main>

      {/* Footer bar */}
      <footer className="sticky bottom-0 z-10 border-t border-gray-300 bg-gray-100 p-3 shadow-lg">
        <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-4 lg:grid-cols-4">
          <div className="flex justify-between gap-2 lg:col-span-3 lg:border-r lg:border-gray-300 lg:pr-4">
            <div className="flex flex-wrap gap-2">
              <button onClick={handleMarkReviewNext} className="rounded-sm border border-gray-300 bg-white px-4 py-2 text-[13px] font-bold text-gray-700 hover:bg-gray-100">
                Mark for Review &amp; Next
              </button>
              <button onClick={handleClearResponse} className="rounded-sm border border-gray-300 bg-white px-4 py-2 text-[13px] font-bold text-gray-700 hover:bg-gray-100">
                Clear Response
              </button>
              <button onClick={goPrev} disabled={currentIndex === 0} className="rounded-sm border border-gray-300 bg-white px-4 py-2 text-[13px] font-bold text-gray-700 hover:bg-gray-100 disabled:opacity-50">
                &lt;&lt; Previous
              </button>
            </div>
            <div>
              <button onClick={handleSaveAndNext} className="rounded-sm border border-[#1f6491] bg-[#287baf] px-4 py-2 text-[13px] font-bold text-white hover:bg-[#1f6491]">
                Save &amp; Next
              </button>
            </div>
          </div>
          <div className="flex justify-center lg:pl-2">
            <button
              onClick={() => setShowSubmitConfirm(true)}
              className="w-[90%] rounded border border-[#55a0c0] bg-[#66b8d9] py-1.5 text-sm font-bold text-white shadow-sm hover:bg-[#55a0c0]"
            >
              Submit
            </button>
          </div>
        </div>
      </footer>

      {/* Floating calculator */}
      {showCalc && (
        <div className="fixed left-8 top-24 z-50 w-[380px] rounded-md border border-gray-400 bg-[#dadada] shadow-2xl">
          <div className="flex items-center justify-between bg-[#5D54D5] px-3 py-1.5 text-white">
            <span className="text-sm font-semibold">Scientific Calculator</span>
            <button onClick={() => setShowCalc(false)} className="text-lg">×</button>
          </div>
          <div className="p-2">
            <Calculator />
          </div>
        </div>
      )}

      {/* Submit modal — GATE style */}
      {showSubmitConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-[600px] rounded bg-white shadow-2xl">
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-2xl font-bold text-[#445b73]">Submit quiz</h2>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 p-6">
              <SummaryItem status="answered" count={counts.answered} label="Answered" />
              <SummaryItem status="unanswered" count={counts.notAnswered} label="Not Answered" />
              <SummaryItem status="unvisited" count={counts.notVisited} label="Not Visited" />
              <SummaryItem status="review" count={counts.marked} label="Marked for Review" />
              <SummaryItem
                status="answered-marked"
                count={counts.answeredMarked}
                label="Answered & Marked for Review (will be evaluated)"
              />
            </div>
            <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4">
              <button
                onClick={() => setShowSubmitConfirm(false)}
                className="border border-gray-300 bg-white px-6 py-2 text-lg text-gray-700 shadow-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSubmit(false)}
                className="bg-[#172b4d] px-6 py-2 text-lg font-semibold text-white shadow-sm hover:bg-[#0f1d33]"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}

      {showTabWarning && (
        <div className="fixed bottom-4 right-4 z-50 rounded-md bg-destructive px-4 py-3 text-sm text-destructive-foreground shadow-lg">
          <p className="font-semibold">Warning: Tab switching detected ({tabSwitches})</p>
          <p className="text-xs">Repeated switching may be reported to the admin.</p>
          <button onClick={() => setShowTabWarning(false)} className="mt-2 text-xs underline">
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function SummaryItem({ status, count, label }: { status: string; count: number; label: string }) {
  const shapes: Record<string, React.CSSProperties> = {
    answered: {
      background: "#6DB825",
      clipPath: "polygon(0% 30%, 33.333% 0%, 66.667% 0%, 100% 30%, 100% 100%, 0% 100%)",
    },
    unanswered: {
      background: "#FF5252",
      clipPath: "polygon(0% 0%, 100% 0%, 100% 70%, 66.667% 100%, 33.333% 100%, 0% 70%)",
    },
    review: { background: "#755197", borderRadius: "50%" },
    "answered-marked": { background: "#755197", borderRadius: "50%" },
    unvisited: { background: "#D9D9D9", color: "#000" },
  };
  const isDark = status !== "unvisited";
  return (
    <div className="flex items-center gap-4">
      <div
        className="relative grid place-items-center"
        style={{
          width: 56,
          height: 56,
          fontSize: 22,
          fontWeight: 700,
          color: isDark ? "#fff" : "#000",
          ...shapes[status],
        }}
      >
        <span style={{ position: "relative", zIndex: 2 }}>{count}</span>
        {status === "answered-marked" && (
          <span
            style={{
              position: "absolute",
              bottom: 3,
              right: 3,
              width: 14,
              height: 14,
              background: "#6DB825",
              borderRadius: "50%",
              border: "2px solid white",
            }}
          />
        )}
      </div>
      <span className="text-gray-600">{label}</span>
    </div>
  );
}
