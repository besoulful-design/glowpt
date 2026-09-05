// GlowPT data API client. Every call hits the HTTP API Gateway; authenticated
// calls carry the Cognito ID token, which the gateway authorizer verifies before
// the Lambda stamps the sub into a transaction and RLS scopes the rows.
//
// Route map lives in infra/lambda/api/index.ts. No identifier (id, email) ever
// goes in a URL path/query - identity is the token; entity ids travel in the body.

import { API_BASE_URL } from '../config';
import { getIdToken } from './cognito';

/** An API error carrying the HTTP status and the server's error code. */
export class ApiError extends Error {
  constructor(status, code, detail) {
    super(detail || code || `HTTP ${status}`);
    this.status = status;
    this.code = code;
  }
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';

  if (auth) {
    const token = await getIdToken();
    if (!token) throw new ApiError(401, 'unauthenticated');
    headers['authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new ApiError(res.status, data?.error, data?.detail);
  }
  return data;
}

// -- Public (no token): resolve a clinic for /join. --
export const getClinicBySlug = (slug) =>
  request(`/clinics/by-slug/${encodeURIComponent(slug)}`, { auth: false });

// -- Me (profile / consents / check-ins) --
export const getMe = () => request('/me');
export const updateMe = (fullName) =>
  request('/me', { method: 'PATCH', body: { full_name: fullName } });
export const recordConsent = (version) =>
  request('/me/consents', { method: 'POST', body: { version } });
export const getMyCheckins = (since) =>
  request(`/me/checkins${since ? `?since=${encodeURIComponent(since)}` : ''}`);
export const saveCheckin = (payload) =>
  request('/me/checkins', { method: 'POST', body: payload });

// -- Clinic (dashboard) --
export const getClinic = () => request('/clinic');
export const getRoster = () => request('/clinic/roster');
export const getTherapists = () => request('/clinic/therapists');
export const getInvites = () => request('/clinic/invites');

// -- RPCs (bodies carry entity ids, never the URL) --
export const provisionClinic = (name, slug) =>
  request('/rpc/provision-clinic', { method: 'POST', body: { name, slug } });
export const joinClinic = (slug, fullName, consentVersion) =>
  request('/rpc/join-clinic', {
    method: 'POST',
    body: { slug, full_name: fullName, consent_version: consentVersion },
  });
// Public, like getClinicBySlug: read before the person has an account, so the
// staff sign-up page can name the clinic and role. The token in the URL is the
// invite's own identifier, not an identifier for a person.
export const getStaffInvite = (token) =>
  request(`/staff-invites/${encodeURIComponent(token)}`, { auth: false });
// token is optional. With one, this is someone following an invite link; without
// one, it is auth.jsx's blind safety net. Either way the database requires the
// caller's verified email to match the invite, so the token alone grants nothing.
export const acceptStaffInvite = (token = null) =>
  request('/rpc/accept-staff-invite', { method: 'POST', body: { token } });
export const invitePatient = (email, fullName) =>
  request('/rpc/invite-patient', { method: 'POST', body: { email, full_name: fullName } });
// Separate from acceptStaffInvite because this door records consent and that
// one deliberately cannot; the database refuses each the other's invites.
export const acceptPatientInvite = (token, consentVersion) =>
  request('/rpc/accept-patient-invite', {
    method: 'POST',
    body: { token, consent_version: consentVersion },
  });
export const inviteStaff = (email, fullName, role = 'therapist') =>
  request('/rpc/invite-staff', {
    method: 'POST',
    body: { email, full_name: fullName, role },
  });
export const assignTherapist = (patientId, therapistId) =>
  request('/rpc/assign-therapist', {
    method: 'POST',
    body: { patient_id: patientId, therapist_id: therapistId },
  });
export const dischargePatient = (patientId) =>
  request('/rpc/discharge-patient', { method: 'POST', body: { patient_id: patientId } });
export const restorePatient = (patientId) =>
  request('/rpc/restore-patient', { method: 'POST', body: { patient_id: patientId } });

// -- ai-response (the reflection; same shape as before: { prompt } -> { response }) --
export const aiResponse = (prompt) =>
  request('/ai-response', { method: 'POST', body: { prompt } });

// -- Platform admin (cross-clinic). The API carries the same Cognito token as
// every other call; the DB decides whether the caller is an admin, so a
// non-admin gets a 403 from the server, not a hidden button. --
export const getAdminMe = () => request('/admin/me');
export const listAllClinics = () => request('/admin/clinics');
export const setClinicActive = (clinicId, active) =>
  request('/admin/clinics/activation', { method: 'POST', body: { clinic_id: clinicId, active } });
export const recordClinicBaa = (clinicId, version) =>
  request('/admin/clinics/baa', { method: 'POST', body: { clinic_id: clinicId, version } });
