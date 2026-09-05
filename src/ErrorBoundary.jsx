import { Component } from 'react'
import * as cognito from './lib/cognito'
import { BRAND } from './screens/AuthShell'

// The app's one error boundary.
//
// ⚠️ WHY THIS EXISTS. Until 2026-09-05 there was none, so ANY exception thrown
// while React was rendering unmounted the whole tree and left a blank page with
// nothing on it at all. That is not a theoretical risk: one check-in stored with
// feeling = 0 made the clinic dashboard look up a face that does not exist, and
// every manager and therapist in that clinic got a blank screen after sign-in,
// with no way for them or for us to tell what had happened.
//
// This does NOT make crashes harmless, and it is not a substitute for fixing
// one. It converts "the app is dead" into a message that says so, keeps a way
// out on screen, and puts the real error somewhere a person can read it.
//
// It sits OUTSIDE the router and the auth provider so it catches a crash in any
// of them, which is also why it signs out through lib/cognito directly rather
// than through the auth context: at the moment it renders, that context may be
// exactly what is broken.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, showDetail: false }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Loud, and in the place the docs already tell David to look. Keep this a
    // console.error rather than a log: it is the difference between a report of
    // "it went blank" and a report we can act on.
    console.error('GlowPT crashed while rendering:', error, info?.componentStack)
  }

  render() {
    const { error, showDetail } = this.state
    if (!error) return this.props.children

    return (
      <div style={s.page}>
        <div style={s.panel}>
          <img src="/favicon.svg" alt="" aria-hidden="true" width={96} height={96} style={s.mark} />
          <div style={s.title}>Something went wrong.</div>
          <div style={s.body}>
            This screen could not load. Nothing you have already saved is affected. Reloading usually fixes it.
          </div>
          <button style={s.btn} onClick={() => window.location.reload()}>Reload GlowPT →</button>
          {/* If a reload lands straight back here, the crash is tied to this
              account's data and reloading will keep failing. Signing out is the
              way out of that loop, which is why it is on screen and not just
              advice. */}
          <button
            style={s.quiet}
            onClick={() => { try { cognito.signOut() } catch { /* already gone */ } window.location.href = '/' }}
          >
            Sign Out
          </button>
          {/* Hidden by default, deliberately. A patient does not need to read a
              stack trace, and this app handles PHI so nothing technical belongs
              on screen uninvited. But a screenshot of a blank page told us
              nothing at all today, and one line of this would have told us
              everything, so it is one tap away. */}
          <button style={s.detailToggle} onClick={() => this.setState({ showDetail: !showDetail })}>
            {showDetail ? 'Hide Details' : 'Show Details'}
          </button>
          {showDetail && (
            <div style={s.detail}>{String(error?.message || error)}</div>
          )}
        </div>
      </div>
    )
  }
}

const s = {
  page: { minHeight: '100vh', background: '#0d1825', color: '#f5efe4', fontFamily: "'DM Sans', sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center' },
  panel: { maxWidth: '380px', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' },
  mark: { borderRadius: '23%', boxShadow: '0 0 29px rgba(245,168,26,0.3)', marginBottom: '20px' },
  title: { fontFamily: "'Fraunces', serif", fontStyle: 'normal', fontSize: '26px', lineHeight: 1.35, marginBottom: '10px' },
  body: { fontSize: '15px', lineHeight: 1.5, color: 'rgba(245,239,228,0.6)', marginBottom: '24px' },
  btn: { width: '100%', maxWidth: '240px', background: BRAND, color: '#0d1825', border: 'none', borderRadius: '6px', padding: '14px 20px', fontSize: '15px', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' },
  quiet: { marginTop: '14px', background: 'transparent', border: 'none', color: 'rgba(245,239,228,0.5)', fontSize: '13px', fontFamily: 'inherit', cursor: 'pointer', textDecoration: 'underline' },
  detailToggle: { marginTop: '20px', background: 'transparent', border: 'none', color: 'rgba(245,239,228,0.3)', fontSize: '12px', fontFamily: 'inherit', cursor: 'pointer' },
  detail: { marginTop: '10px', fontSize: '12px', lineHeight: 1.5, color: 'rgba(245,239,228,0.45)', fontFamily: 'ui-monospace, Consolas, monospace', wordBreak: 'break-word', background: 'rgba(245,239,228,0.04)', border: '1px solid rgba(245,239,228,0.08)', borderRadius: '4px', padding: '10px 12px', textAlign: 'left' },
}
