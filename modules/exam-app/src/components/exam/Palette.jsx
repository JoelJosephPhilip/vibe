function statusOf(r) {
  if (r.isMarkedForReview && r.isAnswered) return 'answered-marked'
  if (r.isMarkedForReview) return 'review'
  if (r.isAnswered) return 'answered'
  if (r.visited) return 'unanswered'
  return 'unvisited'
}

function Shortcut({ n, status, active, onClick, size = 40 }) {
  const base = {
    width: size,
    height: size,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: size >= 40 ? 15 : 12,
    fontWeight: 600,
    color: '#fff',
    cursor: onClick ? 'pointer' : 'default',
    userSelect: 'none',
    position: 'relative',
    transition: 'transform 0.1s',
    outline: active ? '3px solid #3b82f6' : 'none',
    outlineOffset: 2,
  }
  const shapes = {
    answered: {
      background: '#6DB825',
      clipPath: 'polygon(0% 30%, 33.333% 0%, 66.667% 0%, 100% 30%, 100% 100%, 0% 100%)',
    },
    unanswered: {
      background: '#FF5252',
      clipPath: 'polygon(0% 0%, 100% 0%, 100% 70%, 66.667% 100%, 33.333% 100%, 0% 70%)',
    },
    review: { background: '#755197', borderRadius: '50%' },
    'answered-marked': { background: '#755197', borderRadius: '50%' },
    unvisited: { background: '#D9D9D9', color: '#000' },
  }
  return (
    <button
      onClick={onClick}
      style={{ ...base, ...shapes[status], border: 'none', padding: 0 }}
      type="button"
    >
      <span style={{ position: 'relative', zIndex: 2 }}>{n}</span>
      {status === 'answered-marked' && (
        <span
          style={{
            position: 'absolute',
            bottom: 2,
            right: 2,
            width: 10,
            height: 10,
            background: '#6DB825',
            borderRadius: '50%',
            border: '2px solid white',
          }}
        />
      )}
    </button>
  )
}

export function Palette({ total, current, responses, onSelect }) {
  const counts = responses.reduce(
    (acc, r) => {
      const s = statusOf(r)
      if (s === 'answered' || s === 'answered-marked') acc.answered++
      if (s === 'review' || s === 'answered-marked') acc.marked++
      if (s === 'unanswered') acc.notAnswered++
      if (s === 'unvisited') acc.notVisited++
      return acc
    },
    { answered: 0, marked: 0, notAnswered: 0, notVisited: 0 }
  )

  return (
    <div className="rounded-xl border-t-4 border-yellow-500 bg-white p-4 shadow-lg">
      <h3 className="mb-3 border-b pb-2 text-center text-[18px] font-semibold text-gray-800">
        Question Palette
      </h3>
      <div
        className="mx-auto grid gap-2"
        style={{ gridTemplateColumns: 'repeat(4, 40px)', width: 'min-content' }}
      >
        {Array.from({ length: total }).map((_, i) => (
          <Shortcut
            key={i}
            n={i + 1}
            status={statusOf(responses[i] || {})}
            active={i === current}
            onClick={() => onSelect(i)}
          />
        ))}
      </div>
      <div className="mt-4 space-y-2 border-t pt-3 text-sm text-gray-700">
        <LegendRow status="answered" label="Answered" count={counts.answered} />
        <LegendRow status="answered-marked" label="Marked for Review" count={counts.marked} />
        <LegendRow status="unanswered" label="Not Answered" count={counts.notAnswered} />
        <LegendRow status="unvisited" label="Not Visited" count={counts.notVisited} />
      </div>
    </div>
  )
}

function LegendRow({ status, label, count }) {
  return (
    <div className="flex items-center gap-2">
      <Shortcut n="" status={status} size={22} />
      <span>
        {label} ({count})
      </span>
    </div>
  )
}
