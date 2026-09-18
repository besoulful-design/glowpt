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
// ⚠️ NAMES TRAVEL AS TWO FIELDS EVERYWHERE. Nothing in the app splits a name
// on a space any more; first_name is what the person is called (and the only
// part the AI prompt ever sees) and last_name is what tells two patients with
// the same first name apart on the roster.
//
// lastName is optional here: omitting it leaves the stored surname alone rather
// than clearing it, which is what lets the join screen send back a corrected
// first name without blanking the surname the clinic entered.
export const updateMe = (firstName, lastName) =>
  request('/me', {
    method: 'PATCH',
    body: { first_name: firstName, ...(lastName != null ? { last_name: lastName } : {}) },
  });
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
// Both names are REQUIRED, for staff and patients alike since 2026-09-15. The
// rule is enforced in the database, so a bad call is refused there, not merely
// here.
export const invitePatient = (email, firstName, lastName) =>
  request('/rpc/invite-patient', {
    method: 'POST',
    body: { email, first_name: firstName, last_name: lastName },
  });
// Separate from acceptStaffInvite because this door records consent and that
// one deliberately cannot; the database refuses each the other's invites.
export const acceptPatientInvite = (token, consentVersion) =>
  request('/rpc/accept-patient-invite', {
    method: 'POST',
    body: { token, consent_version: consentVersion },
  });
export const inviteStaff = (email, firstName, lastName, role = 'therapist') =>
  request('/rpc/invite-staff', {
    method: 'POST',
    body: { email, first_name: firstName, last_name: lastName, role },
  });
export const assignTherapist = (patientId, therapistId) =>
  request('/rpc/assign-therapist', {
    method: 'POST',
    body: { patient_id: patientId, therapist_id: therapistId },
  });
export const dischargePatient = (patientId) =>
  request('/rpc/discharge-patient', { method: 'POST', body: { patient_id: patientId } });

// Manager-only, patients-only, and BOTH names are required. Enforced in the
// database (rename_patient), not merely here.
export const renamePatient = (patientId, firstName, lastName) =>
  request('/rpc/rename-patient', {
    method: 'POST',
    body: { patient_id: patientId, first_name: firstName, last_name: lastName },
  });
export const restorePatient = (patientId) =>
  request('/rpc/restore-patient', { method: 'POST', body: { patient_id: patientId } });
// Cancel a pending invite. Until this existed an invite sent to the wrong
// address stayed live for its full 14 days with no way to shut it.
export const revokeInvite = (email) =>
  request('/rpc/revoke-invite', { method: 'POST', body: { email } });
// Permanent, and only for someone enrolled by mistake: the SQL refuses anyone
// who is not already discharged or who has ever checked in.
export const purgePatient = (patientId) =>
  request('/rpc/purge-patient', { method: 'POST', body: { patient_id: patientId } });

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
// Clearing a BAA date entered by mistake. The database refuses it while the
// clinic is switched on, because the activation gate now requires that record.
export const clearClinicBaa = (clinicId) =>
  request('/admin/clinics/baa/clear', { method: 'POST', body: { clinic_id: clinicId } });
// The clinic lifecycle (2026-09-16), the same shape as the patient roster's:
// archive is reversible, export hands the records back, delete is permanent and
// only possible once archived. Every guard is in the database.
export const archiveClinic = (clinicId, archived) =>
  request('/admin/clinics/archive', { method: 'POST', body: { clinic_id: clinicId, archived } });
// ⚠️ Returns the clinic's FULL records, PHI included. The screen that calls this
// says so, and the database logs that it happened.
export const exportClinic = (clinicId) =>
  request('/admin/clinics/export', { method: 'POST', body: { clinic_id: clinicId } });
export const deleteClinic = (clinicId) =>
  request('/admin/clinics/delete', { method: 'POST', body: { clinic_id: clinicId } });
