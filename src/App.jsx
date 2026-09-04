import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './auth'
import { AuthShell, LogoMark, ui } from './screens/AuthShell'
import Landing from './screens/Landing'
import Join from './screens/Join'
import StaffJoin from './screens/StaffJoin'
import Login from './screens/Login'
import Onboard from './screens/Onboard'
import PatientApp from './screens/PatientApp'
import NoClinic from './screens/NoClinic'
import Dashboard from './screens/Dashboard'
import Admin from './screens/Admin'

function Splash() {
  return <AuthShell><LogoMark size={132} /><div style={ui.muted}>Loading…</div></AuthShell>
}

// Decides what a visitor sees at "/": the public landing page when logged out,
// or their app/dashboard when signed in (by role).
function Home() {
  const { session, profile, loading } = useAuth()

  if (loading) return <Splash />
  if (!session) return <Landing />

  const role = profile?.role || 'patient'
  if (role === 'therapist' || role === 'manager') return <Navigate to="/dashboard" replace />
  // A patient with no clinic has nowhere for their check-ins to go — sending them into
  // PatientApp would save entries with clinic_id = null that no dashboard can ever see.
  if (!profile?.clinic_id) return <NoClinic />
  return <PatientApp />
}

function StaffRoute() {
  const { session, profile, loading } = useAuth()
  if (loading) return <Splash />
  if (!session) return <Navigate to="/login" replace />
  const role = profile?.role || 'patient'
  if (role !== 'therapist' && role !== 'manager') return <Navigate to="/" replace />
  return <Dashboard />
}

export default function App() {
  return (
    <Routes>
      <Route path="/join/:slug" element={<Join />} />
      <Route path="/staff/:token" element={<StaffJoin />} />
      <Route path="/onboard" element={<Onboard />} />
      <Route path="/login" element={<Login />} />
      <Route path="/dashboard" element={<StaffRoute />} />
      {/* /admin gates itself against the server, not against a role in the
          token — see Admin.jsx. A non-admin lands back on "/". */}
      <Route path="/admin" element={<Admin />} />
      <Route path="/" element={<Home />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
