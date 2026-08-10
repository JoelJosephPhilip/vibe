import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { examStore, type Exam, type Question, type QuestionType } from "@/lib/examStore";
import { fileToDataUrl } from "@/lib/imageUtils";

export const Route = createFileRoute("/admin/$examId")({
  head: () => ({
    meta: [
      { title: "Edit Test — Admin" },
      { name: "description", content: "Edit questions and settings for this mock test." },
    ],
  }),
  component: EditExamPage,
});

const emptyQuestion = (): Omit<Question, "id"> => ({
  type: "MCQ",
  questionText: "",
  options: [
    { id: "a", text: "" },
    { id: "b", text: "" },
    { id: "c", text: "" },
    { id: "d", text: "" },
  ],
  correctOptions: [],
  marks: 1,
  negativeMarks: 0,
  natAnswerType: "integer",
});

function EditExamPage() {
  const { examId } = Route.useParams();
  const navigate = useNavigate();
  const [exam, setExam] = useState<Exam | undefined>(() => examStore.get(examId));

  useEffect(() => {
    const refresh = () => setExam(examStore.get(examId));
    refresh();
    window.addEventListener("exam_store_updated", refresh);
    return () => window.removeEventListener("exam_store_updated", refresh);
  }, [examId]);

  if (!exam) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-lg font-medium">Test not found.</p>
          <Link to="/admin" className="mt-2 inline-block text-sm text-primary underline">
            Back to admin
          </Link>
        </div>
      </div>
    );
  }

  const totalMarks = examStore.totalMarks(exam);

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link to="/admin" className="text-xs text-primary underline">
              ← All tests
            </Link>
            <h1 className="mt-1 text-2xl font-bold text-foreground">{exam.title}</h1>
            <p className="text-sm text-muted-foreground">
              {exam.questions.length} questions · {totalMarks} marks · {exam.duration} min ·{" "}
              {exam.published ? "Published" : "Draft"}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => examStore.togglePublish(exam.id)}
              disabled={!exam.published && exam.questions.length === 0}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {exam.published ? "Unpublish" : "Publish"}
            </button>
            {exam.published && (
              <button
                onClick={() => navigate({ to: "/exam/$examId", params: { examId: exam.id } })}
                className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                Preview
              </button>
            )}
          </div>
        </header>

        <ExamSettings exam={exam} />
        <QuestionsSection exam={exam} />
        <AddQuestionForm examId={exam.id} />
      </div>
    </div>
  );
}

function ExamSettings({ exam }: { exam: Exam }) {
  const [title, setTitle] = useState(exam.title);
  const [duration, setDuration] = useState(exam.duration);
  const [passingMarks, setPassingMarks] = useState(exam.passingMarks);
  const [negativeMarking, setNegativeMarking] = useState(exam.negativeMarking);
  const [instructions, setInstructions] = useState(exam.instructions);
  const [headerTitle, setHeaderTitle] = useState(exam.headerTitle ?? "");
  const [headerSubtitle, setHeaderSubtitle] = useState(exam.headerSubtitle ?? "");
  const [leftBadge, setLeftBadge] = useState(exam.leftBadge ?? "");
  const [rightBadge, setRightBadge] = useState(exam.rightBadge ?? "");
  const [candidateName, setCandidateName] = useState(exam.candidateName ?? "");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setTitle(exam.title);
    setDuration(exam.duration);
    setPassingMarks(exam.passingMarks);
    setNegativeMarking(exam.negativeMarking);
    setInstructions(exam.instructions);
    setHeaderTitle(exam.headerTitle ?? "");
    setHeaderSubtitle(exam.headerSubtitle ?? "");
    setLeftBadge(exam.leftBadge ?? "");
    setRightBadge(exam.rightBadge ?? "");
    setCandidateName(exam.candidateName ?? "");
  }, [exam.id]);

  const save = () => {
    examStore.update(exam.id, {
      title, duration, passingMarks, negativeMarking, instructions,
      headerTitle, headerSubtitle, leftBadge, rightBadge, candidateName,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <section className="rounded-md border border-border bg-card p-4 shadow-sm">
      <h2 className="mb-3 font-semibold text-foreground">Test settings</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Duration (minutes)</span>
          <input
            type="number"
            min={1}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value) || 1)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Passing marks</span>
          <input
            type="number"
            min={0}
            value={passingMarks}
            onChange={(e) => setPassingMarks(Number(e.target.value) || 0)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 pt-6">
          <input
            type="checkbox"
            checked={negativeMarking}
            onChange={(e) => setNegativeMarking(e.target.checked)}
          />
          <span className="text-sm">Enable negative marking</span>
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">Instructions</span>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={4}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
      </div>

      <h3 className="mb-2 mt-6 text-sm font-semibold text-foreground">Exam header (shown on the test page)</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">Header title (main)</span>
          <input
            value={headerTitle}
            onChange={(e) => setHeaderTitle(e.target.value)}
            placeholder="e.g. Graduate Aptitude Test in Engineering (GATE 2026)"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">Header subtitle</span>
          <input
            value={headerSubtitle}
            onChange={(e) => setHeaderSubtitle(e.target.value)}
            placeholder="e.g. Organizing Institute: IIT Guwahati"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Left badge text</span>
          <input
            value={leftBadge}
            onChange={(e) => setLeftBadge(e.target.value)}
            placeholder="GATE"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Right badge text</span>
          <input
            value={rightBadge}
            onChange={(e) => setRightBadge(e.target.value)}
            placeholder="IITG"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">Candidate name</span>
          <input
            value={candidateName}
            onChange={(e) => setCandidateName(e.target.value)}
            placeholder="e.g. DEMO CANDIDATE"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={save}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Save settings
        </button>
        {saved && <span className="text-xs text-green-600">Saved ✓</span>}
      </div>
    </section>
  );
}

function QuestionsSection({ exam }: { exam: Exam }) {
  return (
    <section>
      <h2 className="mb-3 font-semibold text-foreground">Questions ({exam.questions.length})</h2>
      {exam.questions.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No questions yet. Add your first question below.
        </p>
      ) : (
        <ul className="space-y-3">
          {exam.questions.map((q, i) => (
            <QuestionRow key={q.id} examId={exam.id} question={q} index={i} />
          ))}
        </ul>
      )}
    </section>
  );
}

function QuestionRow({ examId, question, index }: { examId: string; question: Question; index: number }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="rounded-md border border-border bg-card p-4 shadow-sm">
      {!editing ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded bg-muted px-2 py-0.5 font-mono">Q{index + 1}</span>
              <span className="rounded bg-primary/10 px-2 py-0.5 font-medium text-primary">
                {question.type}
              </span>
              <span>+{question.marks}</span>
              {question.negativeMarks > 0 && <span>−{question.negativeMarks}</span>}
            </div>
            <p className="text-sm text-foreground">{question.questionText}</p>
            {question.questionImage && (
              <img
                src={question.questionImage}
                alt="Question"
                className="mt-2 max-h-48 rounded border border-border object-contain"
              />
            )}
            {question.type !== "NAT" && (
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {question.options.map((o) => (
                  <li
                    key={o.id}
                    className={
                      "flex items-center gap-2 " +
                      (question.correctOptions.includes(o.id) ? "font-semibold text-green-700" : "")
                    }
                  >
                    <span>
                      {o.id.toUpperCase()}. {o.text} {question.correctOptions.includes(o.id) && "✓"}
                    </span>
                    {o.image && (
                      <img src={o.image} alt="" className="h-10 w-16 rounded border object-contain" />
                    )}
                  </li>
                ))}
              </ul>
            )}
            {question.type === "NAT" && (
              <p className="mt-2 text-xs text-muted-foreground">
                Correct answer: <span className="font-semibold text-green-700">{question.correctOptions[0]}</span>
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <button
              onClick={() => setEditing(true)}
              className="rounded border border-input bg-background px-2 py-1 text-xs hover:bg-accent"
            >
              Edit
            </button>
            <button
              onClick={() => {
                if (confirm("Delete this question?")) examStore.removeQuestion(examId, question.id);
              }}
              className="rounded border border-red-300 bg-white px-2 py-1 text-xs text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <QuestionForm
          initial={question}
          onCancel={() => setEditing(false)}
          onSubmit={(patch) => {
            examStore.updateQuestion(examId, question.id, patch);
            setEditing(false);
          }}
        />
      )}
    </li>
  );
}

function AddQuestionForm({ examId }: { examId: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-md border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary"
      >
        + Add question
      </button>
    );
  }
  return (
    <div className="rounded-md border border-border bg-card p-4 shadow-sm">
      <h3 className="mb-3 font-semibold text-foreground">New question</h3>
      <QuestionForm
        initial={emptyQuestion()}
        onCancel={() => setOpen(false)}
        onSubmit={(data) => {
          examStore.addQuestion(examId, data as Omit<Question, "id">);
          setOpen(false);
        }}
      />
    </div>
  );
}

function QuestionForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: Omit<Question, "id"> | Question;
  onSubmit: (q: Omit<Question, "id">) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<QuestionType>(initial.type);
  const [questionText, setQuestionText] = useState(initial.questionText);
  const [questionImage, setQuestionImage] = useState<string | undefined>(initial.questionImage);
  const [options, setOptions] = useState(initial.options.length ? initial.options : [
    { id: "a", text: "" },
    { id: "b", text: "" },
    { id: "c", text: "" },
    { id: "d", text: "" },
  ]);
  const [correct, setCorrect] = useState<string[]>(initial.correctOptions);
  const [marks, setMarks] = useState(initial.marks);
  const [negativeMarks, setNegativeMarks] = useState(initial.negativeMarks);
  const [natAnswer, setNatAnswer] = useState(
    initial.type === "NAT" ? initial.correctOptions[0] ?? "" : ""
  );
  const [natType, setNatType] = useState<"integer" | "decimal">(
    initial.natAnswerType ?? "integer"
  );
  const [uploading, setUploading] = useState(false);

  const uploadQuestionImage = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      setQuestionImage(await fileToDataUrl(file, { maxDim: 1400, quality: 0.85 }));
    } catch {
      alert("Failed to load image");
    } finally {
      setUploading(false);
    }
  };

  const uploadOptionImage = async (optId: string, file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      // Normalize option images to a uniform size so all option thumbnails match.
      const dataUrl = await fileToDataUrl(file, { maxDim: 400, quality: 0.85 });
      setOptions((prev) => prev.map((o) => (o.id === optId ? { ...o, image: dataUrl } : o)));
    } catch {
      alert("Failed to load image");
    } finally {
      setUploading(false);
    }
  };

  const toggleCorrect = (id: string) => {
    if (type === "MCQ") setCorrect([id]);
    else setCorrect((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const submit = () => {
    const hasQText = questionText.trim().length > 0;
    if (!hasQText && !questionImage) return alert("Add question text or a question image");
    if (type === "NAT") {
      if (!natAnswer.trim()) return alert("Correct numeric answer is required");
      onSubmit({
        type,
        questionText: questionText.trim(),
        questionImage,
        options: [],
        correctOptions: [natAnswer.trim()],
        marks,
        negativeMarks,
        natAnswerType: natType,
      });
    } else {
      const cleanOptions = options.filter((o) => o.text.trim() || o.image);
      if (cleanOptions.length < 2) return alert("At least 2 options required (text or image)");
      if (correct.length === 0) return alert("Select at least one correct option");
      onSubmit({
        type,
        questionText: questionText.trim(),
        questionImage,
        options: cleanOptions,
        correctOptions: correct.filter((c) => cleanOptions.some((o) => o.id === c)),
        marks,
        negativeMarks,
      });
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Type</span>
          <select
            value={type}
            onChange={(e) => {
              const t = e.target.value as QuestionType;
              setType(t);
              setCorrect([]);
            }}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="MCQ">MCQ (single)</option>
            <option value="MSQ">MSQ (multiple)</option>
            <option value="NAT">NAT (numeric)</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Marks</span>
          <input
            type="number"
            min={0}
            step={0.5}
            value={marks}
            onChange={(e) => setMarks(Number(e.target.value) || 0)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Negative marks</span>
          <input
            type="number"
            min={0}
            step={0.01}
            value={negativeMarks}
            onChange={(e) => setNegativeMarks(Number(e.target.value) || 0)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        {type === "NAT" && (
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Answer type</span>
            <select
              value={natType}
              onChange={(e) => setNatType(e.target.value as "integer" | "decimal")}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="integer">Integer</option>
              <option value="decimal">Decimal</option>
            </select>
          </label>
        )}
      </div>

      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">Question text (optional if image provided)</span>
        <textarea
          value={questionText}
          onChange={(e) => setQuestionText(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </label>

      <div className="rounded-md border border-dashed border-border p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Question image (optional)</span>
          <div className="flex items-center gap-2">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => uploadQuestionImage(e.target.files?.[0] ?? null)}
              className="text-xs"
            />
            {questionImage && (
              <button
                type="button"
                onClick={() => setQuestionImage(undefined)}
                className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
              >
                Remove
              </button>
            )}
          </div>
        </div>
        {questionImage && (
          <img
            src={questionImage}
            alt="Question preview"
            className="max-h-64 rounded border border-border object-contain"
          />
        )}
      </div>


      {type !== "NAT" ? (
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Options ({type === "MCQ" ? "select 1 correct" : "select all correct"})
          </p>
          <div className="space-y-2">
            {options.map((o, i) => (
              <div key={o.id} className="rounded-md border border-border p-2">
                <div className="flex items-center gap-2">
                  <input
                    type={type === "MCQ" ? "radio" : "checkbox"}
                    checked={correct.includes(o.id)}
                    onChange={() => toggleCorrect(o.id)}
                    name="correct-option"
                  />
                  <span className="w-6 text-xs font-bold uppercase">{o.id}</span>
                  <input
                    value={o.text}
                    onChange={(e) => {
                      const next = [...options];
                      next[i] = { ...o, text: e.target.value };
                      setOptions(next);
                    }}
                    placeholder={`Option ${o.id.toUpperCase()} text (or leave blank if using image)`}
                    className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  />
                </div>
                <div className="mt-2 flex items-center gap-2 pl-10">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => uploadOptionImage(o.id, e.target.files?.[0] ?? null)}
                    className="text-xs"
                  />
                  {o.image && (
                    <>
                      <img src={o.image} alt="" className="h-12 w-20 rounded border object-contain" />
                      <button
                        type="button"
                        onClick={() =>
                          setOptions((prev) => prev.map((x) => (x.id === o.id ? { ...x, image: undefined } : x)))
                        }
                        className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Correct numeric answer</span>
          <input
            value={natAnswer}
            onChange={(e) => setNatAnswer(e.target.value)}
            placeholder="e.g. 42 or 3.14"
            className="mt-1 w-56 rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
      )}

      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={submit}
          disabled={uploading}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "Save question"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
