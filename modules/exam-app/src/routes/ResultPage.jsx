import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import jsPDF from 'jspdf'

function formatUserAnswer(q, r) {
  if (!r) return 'Not Answered'
  if (q.type === 'NAT') return (r.natAnswer || '').trim() || 'Not Answered'
  const sel = r.selectedOptions || []
  if (!sel.length) return 'Not Answered'
  return sel
    .map((id) => {
      const opt = (q.options || []).find((o) => o.id === id)
      return `${id.toUpperCase()}. ${opt?.text ?? ''}`
    })
    .join(' | ')
}

function formatCorrectAnswer(q, key) {
  if (!key) return '-'
  if (q.type === 'NAT') return String(key.correct)
  const arr = Array.isArray(key.correct) ? key.correct : [key.correct]
  return arr
    .map((id) => {
      const opt = (q.options || []).find((o) => o.id === id)
      return `${id.toUpperCase()}. ${opt?.text ?? ''}`
    })
    .join(' | ')
}

function evaluate(q, r, key) {
  if (!key) return 'Not Answered'
  if (q.type === 'NAT') {
    const ans = (r?.natAnswer || '').trim()
    if (!ans) return 'Not Answered'
    return ans === String(key.correct) ? 'Correct' : 'Wrong'
  }
  const sel = r?.selectedOptions || []
  if (!sel.length) return 'Not Answered'
  if (q.type === 'MCQ') {
    const correct = Array.isArray(key.correct) ? key.correct[0] : key.correct
    return sel[0] === correct ? 'Correct' : 'Wrong'
  }
  const a = [...sel].sort().join(',')
  const b = [].concat(key.correct).sort().join(',')
  return a === b ? 'Correct' : 'Wrong'
}

export default function ResultPage() {
  const { attemptId } = useParams()
  const [result, setResult] = useState(null)

  useEffect(() => {
    const raw = sessionStorage.getItem(`result_${attemptId}`)
    if (raw) setResult(JSON.parse(raw))
  }, [attemptId])

  const measureImage = (dataUrl) =>
    new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
      img.onerror = () => resolve({ w: 0, h: 0 })
      img.src = dataUrl
    })

  const imgFormat = (dataUrl) => (dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG')

  const downloadPDF = async () => {
    if (!result) return
    const doc = new jsPDF({ unit: 'pt', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const marginX = 36
    const contentWidth = pageWidth - marginX * 2
    let y = 0

    const candidateId = attemptId.toUpperCase()

    const imgDims = new Map()
    for (const q of result.questions) {
      if (q.questionImage && !imgDims.has(q.questionImage)) {
        imgDims.set(q.questionImage, await measureImage(q.questionImage))
      }
      for (const opt of q.options || []) {
        if (opt.image && !imgDims.has(opt.image)) {
          imgDims.set(opt.image, await measureImage(opt.image))
        }
      }
    }

    const drawWatermark = () => {
      const anyDoc = doc
      anyDoc.saveGraphicsState?.()
      try {
        anyDoc.setGState?.(anyDoc.GState?.({ opacity: 0.08 }))
      } catch {}
      doc.setTextColor(150, 150, 150)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(28)
      for (let wy = 80; wy < pageHeight; wy += 140) {
        for (let wx = 40; wx < pageWidth; wx += 220) {
          doc.text(candidateId, wx, wy, { angle: 30 })
        }
      }
      try {
        anyDoc.setGState?.(anyDoc.GState?.({ opacity: 1 }))
      } catch {}
      anyDoc.restoreGraphicsState?.()
      doc.setTextColor(0, 0, 0)
    }

    const drawHeader = () => {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(15)
      doc.setTextColor(17, 17, 17)
      doc.text(`Mock Result: ${result.examTitle || 'DEMO TEST'}`, pageWidth / 2, 40, {
        align: 'center',
      })
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(11)
      doc.setTextColor(85, 85, 85)
      doc.text(
        `Candidate: ${candidateId}   |   Score: ${result.score} / ${result.totalMarks}`,
        pageWidth / 2,
        58,
        { align: 'center' }
      )
      doc.setDrawColor(220, 220, 220)
      doc.line(marginX, 68, pageWidth - marginX, 68)
      doc.setTextColor(0, 0, 0)
    }

    const newPage = (first = false) => {
      if (!first) doc.addPage()
      drawWatermark()
      drawHeader()
      y = 88
    }

    const ensureSpace = (needed) => {
      if (y + needed > pageHeight - 40) newPage()
    }

    const fitImage = (dataUrl, maxW, maxH) => {
      const dim = imgDims.get(dataUrl) || { w: 0, h: 0 }
      if (!dim.w || !dim.h) return { w: 0, h: 0 }
      const scale = Math.min(maxW / dim.w, maxH / dim.h, 1)
      return { w: dim.w * scale, h: dim.h * scale }
    }

    newPage(true)

    result.questions.forEach((q, i) => {
      const r = result.responses[i]
      const key = result.answers[q.id]
      const status = evaluate(q, r, key)
      const marksAlloc = q.marks ?? 1
      const negAlloc = q.negativeMarks ?? 0

      ensureSpace(40)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.setTextColor(136, 136, 136)
      doc.text(`Section : ${result.examTitle || 'General'}`, marginX, y)
      y += 10

      const cardTop = y
      const leftPad = marginX + 12
      let innerY = cardTop + 18

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(12)
      doc.setTextColor(17, 17, 17)
      doc.text(`Q.${i + 1}`, leftPad, innerY)

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(11)
      if (q.questionText) {
        const qLines = doc.splitTextToSize(q.questionText, contentWidth - 60)
        doc.text(qLines, leftPad + 28, innerY)
        innerY += qLines.length * 14 + 6
      } else {
        innerY += 14
      }

      if (q.questionImage) {
        const { w, h } = fitImage(q.questionImage, contentWidth - 40, 260)
        if (w && h) {
          try {
            doc.addImage(q.questionImage, imgFormat(q.questionImage), leftPad, innerY, w, h)
            innerY += h + 8
          } catch {}
        }
      }

      if (q.type !== 'NAT' && q.options?.length) {
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(10)
        doc.text('Options', leftPad, innerY)
        innerY += 14
        doc.setFont('helvetica', 'normal')
        q.options.forEach((opt) => {
          const label = `${opt.id.toUpperCase()}.  ${opt.text || ''}`.trim()
          const optLines = doc.splitTextToSize(label, contentWidth - 60)
          doc.text(optLines, leftPad + 12, innerY)
          innerY += optLines.length * 13 + 4
          if (opt.image) {
            const { w, h } = fitImage(opt.image, contentWidth - 80, 110)
            if (w && h) {
              try {
                doc.addImage(opt.image, imgFormat(opt.image), leftPad + 24, innerY, w, h)
                innerY += h + 6
              } catch {}
            }
          }
        })
      }

      const chosen =
        q.type === 'NAT'
          ? (r?.natAnswer || '').trim() || '--'
          : (r?.selectedOptions || [])
              .map((s) => s.toUpperCase())
              .join(', ') || '--'
      const correctVal =
        q.type === 'NAT'
          ? String(key?.correct ?? '')
          : (Array.isArray(key?.correct) ? key.correct : [key?.correct])
              .map((s) => (s || '').toUpperCase())
              .join(', ')

      const isCorrect = status === 'Correct'
      const marksObtained =
        status === 'Not Answered' ? '0' : isCorrect ? `+${marksAlloc}` : `-${negAlloc}`
      const markColor = isCorrect
        ? [22, 163, 74]
        : status === 'Wrong'
          ? [220, 38, 38]
          : [17, 17, 17]

      const metaRows = [
        ['Question Type :', q.type],
        ['Question ID :', q.id],
        ['Status :', status === 'Not Answered' ? 'Not Answered' : 'Answered'],
        ['Chosen Option :', chosen],
        ['Correct Option :', correctVal || '-', [22, 163, 74]],
        ['Marks :', marksObtained, markColor],
      ]

      const metaBoxW = 240
      const metaBoxH = metaRows.length * 16 + 14
      const metaX = pageWidth - marginX - 12 - metaBoxW
      const metaY = innerY + 6

      const cardBottom = metaY + metaBoxH + 12

      if (cardBottom > pageHeight - 40) {
        newPage()
      }

      doc.setDrawColor(170, 170, 170)
      doc.setLineWidth(1.2)
      doc.rect(marginX, cardTop, contentWidth, cardBottom - cardTop)

      doc.setDrawColor(153, 153, 153)
      doc.setLineWidth(1)
      doc.roundedRect(metaX, metaY, metaBoxW, metaBoxH, 6, 6)

      doc.setFontSize(10)
      let mY = metaY + 18
      metaRows.forEach(([label, value, color]) => {
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(60, 60, 60)
        doc.text(label, metaX + metaBoxW / 2 - 6, mY, { align: 'right' })
        doc.setFont('helvetica', 'bold')
        if (color) doc.setTextColor(color[0], color[1], color[2])
        else doc.setTextColor(17, 17, 17)
        const valLines = doc.splitTextToSize(String(value), metaBoxW / 2 - 10)
        doc.text(valLines, metaX + metaBoxW / 2, mY)
        mY += 16
      })
      doc.setTextColor(0, 0, 0)

      y = cardBottom + 18
    })

    const pageCount = doc.internal.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)

      doc.setFontSize(9)
      doc.setTextColor(160, 160, 160)
      doc.text('Generated by GATE Portal', pageWidth / 2, pageHeight - 20, {
        align: 'center',
      })
      doc.text(`Page ${i} of ${pageCount}`, pageWidth - marginX, pageHeight - 20, { align: 'right' })
    }

    doc.save(`Mock_Result_${candidateId}.pdf`)
  }

  if (!result) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-center">
        <div>
          <p className="text-muted-foreground">No result found for this attempt.</p>
          <Link to="/" className="mt-4 inline-block text-primary underline">
            Back to home
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-6 rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-card-foreground">Your Result</h1>
          <button
            onClick={downloadPDF}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
          >
            Download Response Sheet (PDF)
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div className="rounded-md border border-border p-3">
            <p className="text-muted-foreground">Score</p>
            <p className="text-2xl font-semibold text-card-foreground">
              {result.score} / {result.totalMarks}
            </p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-muted-foreground">Correct</p>
            <p className="text-2xl font-semibold text-card-foreground">
              {result.correctCount} / {result.total}
            </p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-muted-foreground">Wrong</p>
            <p className="text-2xl font-semibold text-destructive">
              {
                result.questions.filter((q, i) =>
                  evaluate(q, result.responses[i], result.answers[q.id]) === 'Wrong'
                ).length
              }
            </p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-muted-foreground">Unattempted</p>
            <p className="text-2xl font-semibold text-muted-foreground">
              {
                result.questions.filter((q, i) =>
                  evaluate(q, result.responses[i], result.answers[q.id]) === 'Not Answered'
                ).length
              }
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="p-3">Q.No</th>
                <th className="p-3">Question</th>
                <th className="p-3">Your Answer</th>
                <th className="p-3">Correct</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {result.questions.map((q, i) => {
                const r = result.responses[i]
                const key = result.answers[q.id]
                const status = evaluate(q, r, key)
                const color =
                  status === 'Correct'
                    ? 'text-emerald-600'
                    : status === 'Wrong'
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                return (
                  <tr key={q.id} className="border-t border-border align-top">
                    <td className="p-3">{i + 1}</td>
                    <td className="p-3">{q.questionText}</td>
                    <td className="p-3">{formatUserAnswer(q, r)}</td>
                    <td className="p-3">{formatCorrectAnswer(q, key)}</td>
                    <td className={`p-3 font-medium ${color}`}>{status}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <Link
          to="/"
          className="inline-block rounded-md border border-input px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
        >
          Back to home
        </Link>
      </div>
    </div>
  )
}
