// GlowPT frontend config (AWS stack).
//
// These are all PUBLIC values that ship in the browser bundle anyway (the API
// base URL, the Cognito app-client id, the region) - exactly like the Supabase
// URL + anon key were. Real security is the Cognito authorizer + RLS, not hiding
// these. Overridable by Netlify build env (VITE_*) so staging can point elsewhere.

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  'https://byaepos5vl.execute-api.us-east-1.amazonaws.com';

export const COGNITO_CLIENT_ID =
  import.meta.env.VITE_COGNITO_CLIENT_ID || '6upb217er13tibbke4qbalhbji';

export const AWS_REGION = import.meta.env.VITE_AWS_REGION || 'us-east-1';
