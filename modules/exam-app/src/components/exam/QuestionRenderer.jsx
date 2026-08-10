import { useEffect, useRef } from 'react'
import { Keyboard } from './Keyboard.jsx'

export function QuestionRenderer({ question, response, onChange }) {
  const startTimeRef = useRef(Date.now())

  useEffect(() => {
    startTimeRef.current = Date.now()
  }, [question.id])

  const handleOptionChange = (optionId) => {
    if (question.type === 'MCQ') {
      onChange({ selectedOptions: [optionId], isAnswered: true })
    } else if (question.type === 'MSQ') {
      const current = response?.selectedOptions || []
      const next = current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId]
      onChange({ selectedOptions: next, isAnswered: next.length > 0 })
    }
  }

  const handleNatChange = (value) => {
    onChange({ natAnswer: value, isAnswered: value.trim() !== '' })
  }

  const handleKeyboardInput = (key) => {
    if (key === 'Backspace') {
      handleNatChange((response?.natAnswer || '').slice(0, -1))
    } else if (key === 'Clear') {
      handleNatChange('')
    } else if (key === '-') {
      const current = response?.natAnswer || ''
      handleNatChange(current.startsWith('-') ? current.slice(1) : `-${current}`)
    } else {
      handleNatChange((response?.natAnswer || '') + key)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 text-base font-medium leading-relaxed text-foreground">
          <span className="mr-2 text-muted-foreground">Q.</span>
          {question.questionText}
          {question.questionImage && (
            <div className="mt-3">
              <img
                src={question.questionImage}
                alt="Question"
                className="max-h-[420px] w-auto max-w-full rounded-md border border-border object-contain"
              />
            </div>
          )}
        </div>
        <div className="shrink-0 text-right text-sm text-muted-foreground">
          <div>+{question.marks} marks</div>
          {question.negativeMarks > 0 && <div>-{question.negativeMarks} negative</div>}
        </div>
      </div>

      {(question.type === 'MCQ' || question.type === 'MSQ') && question.options && (
        <div className="grid gap-3 sm:grid-cols-2">
          {question.options.map((option) => {
            const isSelected = response?.selectedOptions?.includes(option.id)
            const inputType = question.type === 'MCQ' ? 'radio' : 'checkbox'
            return (
              <label
                key={option.id}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors hover:bg-accent ${
                  isSelected ? 'border-primary bg-primary/5' : 'border-border bg-card'
                }`}
              >
                <input
                  type={inputType}
                  name={question.id}
                  value={option.id}
                  checked={isSelected}
                  onChange={() => handleOptionChange(option.id)}
                  className="mt-1 h-4 w-4 accent-primary"
                />
                <div className="flex-1 space-y-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-bold uppercase text-muted-foreground">
                      {option.id}.
                    </span>
                    {option.text && <span className="text-foreground">{option.text}</span>}
                  </div>
                  {option.image && (
                    <div className="flex h-32 w-full items-center justify-center rounded border border-border bg-background p-1">
                      <img
                        src={option.image}
                        alt={`Option ${option.id}`}
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                  )}
                </div>
              </label>
            )
          })}
        </div>
      )}

      {question.type === 'NAT' && (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Enter your answer ({question.natAnswerType === 'decimal' ? 'decimal' : 'integer'})
            </label>
            <input
              type="text"
              inputMode={question.natAnswerType === 'decimal' ? 'decimal' : 'numeric'}
              value={response?.natAnswer || ''}
              onChange={(e) => handleNatChange(e.target.value)}
              placeholder={question.natAnswerType === 'decimal' ? 'e.g. 3.14' : 'e.g. 42'}
              className="w-full rounded-md border border-input bg-background px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <Keyboard onKey={handleKeyboardInput} type={question.natAnswerType} />
        </div>
      )}
    </div>
  )
}
