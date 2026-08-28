import { useEffect } from 'react'

// Freeze the page behind an open modal.
//
// One shared hook on purpose. The same three-line effect pasted into three
// screens is exactly how LogoMark and the wordmark drifted before (see the brand
// notes in CLAUDE.md) — a modal added later should call this, not re-type it.
//
// It restores the PREVIOUS inline value instead of clearing the property, so a
// closing modal can never unlock a page something else still wants locked.
export function useScrollLock(active) {
  useEffect(() => {
    if (!active) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [active])
}
