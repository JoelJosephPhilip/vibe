import { useCallback, useEffect, useState } from 'react'

/**
 * Exam security hook.
 *
 * - Forces fullscreen (auto request + re-prompt when the candidate exits)
 * - Disables right-click / context menu
 * - Blocks dev-tools + view-source + print shortcuts
 * - Disables copy / cut / paste and text selection + drag
 *
 * Usage:
 *   const { isFullscreen, requestFullscreen } = useExamSecurity(true)
 */
export function useExamSecurity(enabled = true) {
  const [isFullscreen, setIsFullscreen] = useState(false)

  const requestFullscreen = useCallback(async () => {
    const el = document.documentElement
    try {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' })
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen()
      else if (el.msRequestFullscreen) await el.msRequestFullscreen()
    } catch {
      /* browser refused (needs a user gesture) — the overlay button will retry */
    }
  }, [])

  const exitFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen()
      else if (document.webkitFullscreenElement && document.webkitExitFullscreen)
        document.webkitExitFullscreen()
    } catch {}
  }, [])

  useEffect(() => {
    if (!enabled) return

    // ---- fullscreen tracking -------------------------------------------
    const syncFs = () => {
      const active = !!(document.fullscreenElement || document.webkitFullscreenElement)
      setIsFullscreen(active)
    }
    document.addEventListener('fullscreenchange', syncFs)
    document.addEventListener('webkitfullscreenchange', syncFs)
    syncFs()

    // try once on mount (works when the page was opened by a user click)
    const t = setTimeout(() => {
      if (!document.fullscreenElement) requestFullscreen()
    }, 150)

    // Elements where the candidate is legitimately allowed to type/select —
    // e.g. the extra-time code box. Selection-blocking and user-select:none
    // on an ancestor is a known WebKit/mobile bug: it can stop the caret
    // from appearing and the virtual keyboard from opening on tap, even
    // though the input technically receives focus. So these are carved out.
    const FIELD_SELECTOR = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]'
    const isFormField = (e) => typeof e.target?.closest === 'function' && e.target.closest(FIELD_SELECTOR)

    // ---- right click ----------------------------------------------------
    const onContextMenu = (e) => {
      if (isFormField(e)) return
      e.preventDefault()
    }

    // ---- copy / cut / paste / drag / select -----------------------------
    const block = (e) => {
      e.preventDefault()
      return false
    }
    const blockUnlessField = (e) => {
      if (isFormField(e)) return
      e.preventDefault()
      return false
    }

    // ---- keyboard shortcuts ---------------------------------------------
    const onKeyDown = (e) => {
      const k = (e.key || '').toLowerCase()
      const ctrl = e.ctrlKey || e.metaKey

      // F12 / dev tools
      if (k === 'f12') return block(e)
      // Ctrl+Shift+I / J / C / K  (inspector, console, picker, firefox console)
      if (ctrl && e.shiftKey && ['i', 'j', 'c', 'k'].includes(k)) return block(e)
      // Ctrl+U view-source, Ctrl+S save, Ctrl+P print, Ctrl+F find
      if (ctrl && ['u', 's', 'p'].includes(k)) return block(e)
      // Ctrl+C / X / V / A
      if (ctrl && ['c', 'x', 'v', 'a'].includes(k)) return block(e)
      // PrintScreen
      if (k === 'printscreen') {
        try {
          navigator.clipboard?.writeText('')
        } catch {}
        return block(e)
      }
      // Esc while in fullscreen — let the browser handle it, overlay will show
    }

    // ---- block printing --------------------------------------------------
    const onBeforePrint = (e) => e.preventDefault?.()

    document.addEventListener('contextmenu', onContextMenu)
    document.addEventListener('copy', blockUnlessField)
    document.addEventListener('cut', blockUnlessField)
    document.addEventListener('paste', blockUnlessField)
    document.addEventListener('dragstart', blockUnlessField)
    document.addEventListener('selectstart', blockUnlessField)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('beforeprint', onBeforePrint)

    // Re-enable selection/caret specifically inside form fields. The
    // body-wide user-select:none below is what actually breaks the mobile
    // keyboard, so this !important rule (which beats a non-important inline
    // style) is the real fix — the JS handlers above are the secondary line
    // of defense against copy/paste elsewhere on the page.
    const selectionStyle = document.createElement('style')
    selectionStyle.setAttribute('data-exam-security', 'field-select')
    selectionStyle.textContent = `${FIELD_SELECTOR} { -webkit-user-select: text !important; user-select: text !important; }`
    document.head.appendChild(selectionStyle)

    // hide content from print output as a fallback
    const printStyle = document.createElement('style')
    printStyle.setAttribute('data-exam-security', 'print')
    printStyle.textContent = `@media print { body { display: none !important; } }`
    document.head.appendChild(printStyle)

    const prevUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    document.body.style.webkitUserSelect = 'none'

    return () => {
      clearTimeout(t)
      document.removeEventListener('fullscreenchange', syncFs)
      document.removeEventListener('webkitfullscreenchange', syncFs)
      document.removeEventListener('contextmenu', onContextMenu)
      document.removeEventListener('copy', blockUnlessField)
      document.removeEventListener('cut', blockUnlessField)
      document.removeEventListener('paste', blockUnlessField)
      document.removeEventListener('dragstart', blockUnlessField)
      document.removeEventListener('selectstart', blockUnlessField)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('beforeprint', onBeforePrint)
      printStyle.remove()
      selectionStyle.remove()
      document.body.style.userSelect = prevUserSelect
      document.body.style.webkitUserSelect = prevUserSelect
      exitFullscreen()
    }
  }, [enabled, requestFullscreen, exitFullscreen])

  return { isFullscreen, requestFullscreen, exitFullscreen }
}

/**
 * Opens a URL in a separate, chrome-less exam window (kiosk-like popup).
 * Falls back to a normal new tab if popups are blocked.
 */
export function openExamWindow(url) {
  const w = window.screen.availWidth
  const h = window.screen.availHeight
  const features = [
    `width=${w}`,
    `height=${h}`,
    'left=0',
    'top=0',
    'menubar=no',
    'toolbar=no',
    'location=no',
    'status=no',
    'resizable=yes',
    'scrollbars=yes',
  ].join(',')

  const win = window.open(url, 'vibe_exam_window', features)
  if (!win) {
    alert('Please allow pop-ups for this site to start the test.')
    return null
  }
  win.focus()
  return win
}