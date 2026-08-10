function statusOf(r) {
  if (r.isMarkedForReview && r.isAnswered) return 'answered-marked'
  if (r.isMarkedForReview) return 'review'
  if (r.isAnswered) return 'answered'
  if (r.visited) return 'unanswered'
  return 'unvisited'
}

// Small folded-ribbon bookmark badge, drawn inline so the palette carries no
// icon-library dependency. Scales with the tile so it also works at the
// smaller legend-swatch size.
function RibbonBadge({ size }) {
  const w = size * 0.28
  const h = size * 0.34
  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 14 16"
      style={{ position: 'absolute', top: size * 0.08, right: size * 0.09 }}
    >
      <path
        d="M1 0.5H13V15.2C13 15.62 12.53 15.87 12.18 15.63L7.28 12.28C7.11 12.16 6.89 12.16 6.72 12.28L1.82 15.63C1.47 15.87 1 15.62 1 15.2V0.5Z"
        fill="rgba(255,255,255,0.95)"
      />
    </svg>
  )
}

function Shortcut({ n, status, active, onClick, size = 56 }) {
  const shapes = {
    answered: { background: '#6DB825' },
    unanswered: { background: '#FF5252' },
    review: { background: '#755197' },
    'answered-marked': { background: '#755197' },
    unvisited: { background: '#D9D9D9', color: '#000' },
  }
  const showRibbon = status === 'review' || status === 'answered-marked'
  const base = {
    width: size,
    height: size,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: size >= 40 ? 17 : 12,
    fontWeight: 700,
    color: '#fff',
    cursor: onClick ? 'pointer' : 'default',
    userSelect: 'none',
    position: 'relative',
    borderRadius: size >= 40 ? 12 : 8,
    transition: 'transform 0.12s ease',
    outline: active ? '2px solid #F0A93B' : 'none',
    outlineOffset: 2,
  }
  return (
    <button
      onClick={onClick}
      style={{ ...base, ...shapes[status], border: 'none', padding: 0 }}
      type="button"
      className={onClick ? 'hover:scale-105' : ''}
    >
      <span style={{ position: 'relative', zIndex: 2 }}>{n}</span>
      {showRibbon && <RibbonBadge size={size} />}
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
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg">
      <div className="h-1.5" style={{ background: 'linear-gradient(90deg, #F0A93B, #FCD34D)' }} />
      <div className="p-4">
        <h3 className="mb-3 border-b pb-2 text-center text-[18px] font-semibold text-gray-800">
          Question Palette
        </h3>
        <div
          className="mx-auto grid gap-3"
          style={{ gridTemplateColumns: 'repeat(4, 56px)', width: 'min-content' }}
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
    </div>
  )
}

function LegendRow({ status, label, count }) {
  return (
    <div className="flex items-center gap-2.5">
      <Shortcut n={count} status={status} size={28} />
      <span>{label}</span>
    </div>
  )
}