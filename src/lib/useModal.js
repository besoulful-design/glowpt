import { useEffect, useRef } from 'react'

// Everything an open modal has to do, in one place.
//
//   const panelRef = useModal(showInfo, () => setShowInfo(false))
//   ...
//   <div ref={panelRef} role="dialog" aria-modal="true" aria-label="…">
//
// This is the grown-up version of the old useScrollLock. Same reasoning as
// before: the same effect pasted into three screens is exactly how LogoMark and
// the wordmark drifted (see the brand notes in CLAUDE.md). A modal added later
// should call this, not re-type any of it.
//
// Four jobs:
//   1. Freeze the page behind the modal.
//   2. Close on Escape.
//   3. Keep Tab inside the panel, so you cannot tab into the page behind it.
//   4. Put focus in the panel on open, and hand it back on close.
//
// Returns the ref to attach to the panel element (NOT the overlay).
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useModal(active, onClose) {
  const panelRef = useRef(null)

  // onClose is usually an inline arrow, so it is a new function every render.
  // Holding it in a ref keeps the effect below keyed on `active` alone, which
  // means opening a modal does not re-run the whole setup on every keystroke
  // in the form behind it.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!active) return

    const panel = panelRef.current

    // Restore the previous inline value rather than clearing the property, so a
    // closing modal can never unlock a page something else still wants locked.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Remember who opened us, so focus can go home afterwards.
    const opener = document.activeElement

    // Focus the panel itself rather than its first button. The panel is the
    // thing that scrolls, so this puts the arrow keys where the reader expects
    // them, and it stops a screen reader starting the dialog on "Close".
    panel?.focus({ preventScroll: true })

    const visible = el => el.getClientRects().length > 0
    const focusables = () =>
      panel ? Array.from(panel.querySelectorAll(FOCUSABLE)).filter(visible) : []

    const onKeyDown = e => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current?.()
        return
      }
      if (e.key !== 'Tab' || !panel) return

      const items = focusables()
      if (items.length === 0) {
        // Nothing to land on: keep focus on the panel instead of letting it
        // escape to the page behind.
        e.preventDefault()
        panel.focus({ preventScroll: true })
        return
      }

      const first = items[0]
      const last = items[items.length - 1]
      const here = document.activeElement

      // Anything focused outside the panel means focus already leaked (a click
      // on the overlay, say). Pull it back rather than trapping nothing.
      if (!panel.contains(here)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
        return
      }
      // The panel itself sits before its children in DOM order, so a forward
      // Tab from it lands correctly on its own. Only the backward case wraps.
      if (e.shiftKey && (here === first || here === panel)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && here === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = prevOverflow
      // The opener can be gone if the modal closed because the screen changed.
      if (opener instanceof HTMLElement && document.contains(opener)) {
        opener.focus({ preventScroll: true })
      }
    }
  }, [active])

  return panelRef
}
