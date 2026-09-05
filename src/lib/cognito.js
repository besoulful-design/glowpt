// GlowPT auth: Amazon Cognito passwordless email OTP, from the browser.
//
// Replaces Supabase auth. Cognito does ONE job: prove who a user is and hand
// back a stable subject id (the "sub"). It carries no roles and makes no access
// decisions - RLS in the database is the authorization boundary.
//
// Two single-code flows, both PROVEN live against the pool (2026-08-22):
//   RETURNING USER (login):
//     beginSignIn -> InitiateAuth(USER_AUTH, EMAIL_OTP) emails an 8-digit code
//     confirm     -> RespondToAuthChallenge(EMAIL_OTP) -> tokens
//   NEW USER (join / onboard / staff), and anyone who abandoned one earlier:
//     beginSignUp -> SignUp (no password) emails a 6-digit confirmation code
//     confirm     -> ConfirmSignUp(code, clientMetadata) [fires the post-confirm
//                    Lambda that attaches the clinic] -> returns a Session ->
//                    InitiateAuth(USER_AUTH, Session) auto-signs-in -> tokens
//                    (NO second code).
//
// The clinic-attach metadata rides in ClientMetadata on ConfirmSignUp (the
// post-confirmation Lambda reads it there, verified in Phase 2).

import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  SignUpCommand,
  ConfirmSignUpCommand,
  ResendConfirmationCodeCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { COGNITO_CLIENT_ID, AWS_REGION } from '../config';

const client = new CognitoIdentityProviderClient({ region: AWS_REGION });

// -- Token storage. localStorage, matching the previous Supabase posture (this is
//    a drop-in; httpOnly cookies would be a larger change, noted for later). The
//    ID token is what the API authorizer validates (aud = client id). --
const STORE_KEY = 'glowpt.auth';

function saveTokens(auth) {
  // auth = AuthenticationResult from Cognito.
  const now = Math.floor(Date.now() / 1000);
  localStorage.setItem(
    STORE_KEY,
    JSON.stringify({
      idToken: auth.IdToken,
      accessToken: auth.AccessToken,
      // A refresh response omits RefreshToken; keep the existing one.
      refreshToken: auth.RefreshToken || readStore()?.refreshToken || null,
      expiresAt: now + (auth.ExpiresIn || 3600),
    }),
  );
}

function readStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  } catch {
    return null;
  }
}

function clearTokens() {
  localStorage.removeItem(STORE_KEY);
}

// Decode a JWT payload (no verification needed here - the API Gateway authorizer
// is what actually verifies the signature; this is only for reading sub/email
// to drive the UI).
function decode(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(payload))));
  } catch {
    return null;
  }
}

/** The signed-in user derived from the stored ID token, or null. */
export function currentUser() {
  const store = readStore();
  if (!store?.idToken) return null;
  const claims = decode(store.idToken);
  if (!claims?.sub) return null;
  return { id: claims.sub, email: claims.email };
}

/**
 * A valid ID token for the API call, refreshing if it is expired/near expiry.
 * Returns null if the user is not signed in (or the refresh fails).
 */
export async function getIdToken() {
  const store = readStore();
  if (!store?.idToken) return null;
  const now = Math.floor(Date.now() / 1000);
  if (store.expiresAt && store.expiresAt - 60 > now) return store.idToken;

  // Expired (or within 60s): refresh with the refresh token.
  if (!store.refreshToken) {
    clearTokens();
    return null;
  }
  try {
    const out = await client.send(
      new InitiateAuthCommand({
        ClientId: COGNITO_CLIENT_ID,
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        AuthParameters: { REFRESH_TOKEN: store.refreshToken },
      }),
    );
    if (out.AuthenticationResult) {
      saveTokens(out.AuthenticationResult);
      return out.AuthenticationResult.IdToken;
    }
  } catch {
    /* fall through to sign-out */
  }
  clearTokens();
  return null;
}

// ---------------------------------------------------------------------------
// Flow starters. Each returns a `pending` object handed to confirm().
// ---------------------------------------------------------------------------

/** Returning user: send an email OTP. */
export async function beginSignIn(email) {
  const out = await client.send(
    new InitiateAuthCommand({
      ClientId: COGNITO_CLIENT_ID,
      AuthFlow: 'USER_AUTH',
      AuthParameters: { USERNAME: email, PREFERRED_CHALLENGE: 'EMAIL_OTP' },
    }),
  );
  return { kind: 'signin', email, session: out.Session, challenge: out.ChallengeName };
}

/**
 * New user: create the (passwordless) account. `clientMetadata` carries the
 * clinic-attach flow (e.g. { flow:'join', clinic_slug, full_name, consent_version })
 * and is replayed on confirm, where the post-confirmation Lambda reads it.
 *
 * If the email already has an account, Cognito throws UsernameExistsException.
 * We then work out whether that account was ever confirmed and pick the right
 * flow: see the comment in the catch, which is where a real bug lived.
 */
export async function beginSignUp(email, clientMetadata = {}) {
  try {
    await client.send(
      new SignUpCommand({
        ClientId: COGNITO_CLIENT_ID,
        Username: email,
        // Passwordless: the pool allows omitting the password entirely.
        UserAttributes: [{ Name: 'email', Value: email }],
        ClientMetadata: clientMetadata,
      }),
    );
    return { kind: 'signup', email, clientMetadata };
  } catch (err) {
    if (err?.name !== 'UsernameExistsException') throw err;

    // The address already has a Cognito account. There are two very different
    // reasons for that, and they need different flows.
    //
    // (1) SOMEONE STARTED THIS AND WALKED AWAY at the code screen. SignUp
    //     creates the account immediately, in an UNCONFIRMED state, so the
    //     address is taken even though nothing was completed. The right move is
    //     to FINISH that sign-up, because ConfirmSignUp is what fires the
    //     post-confirmation Lambda that attaches the clinic. Falling straight
    //     to sign-in skips it, leaving an authenticated user with no identity
    //     row and no clinic, on the NoClinic screen. (That is exactly what
    //     happened to a real invited patient on 2026-09-05.)
    //
    // (2) A GENUINE RETURNING USER. Sign them in, as before.
    //
    // Cognito will not tell us which, by design, so we ask indirectly:
    // ResendConfirmationCode succeeds only for an unconfirmed account and
    // throws InvalidParameterException ("User is already confirmed") otherwise.
    try {
      await client.send(
        new ResendConfirmationCodeCommand({
          ClientId: COGNITO_CLIENT_ID,
          Username: email,
          ClientMetadata: clientMetadata,
        }),
      );
      // Unconfirmed: a fresh 6-digit confirmation code is on its way, and
      // confirm() will run the proper ConfirmSignUp path.
      return { kind: 'signup', email, clientMetadata };
    } catch {
      // Already confirmed, or the resend was refused for any other reason.
      // Sign-in is the correct fallback and is never worse than before.
    }
    const pending = await beginSignIn(email);
    return { ...pending, clientMetadata }; // keep metadata for the re-attach net
  }
}

/**
 * Complete a flow with the emailed code. Returns the signed-in user.
 */
export async function confirm(pending, code) {
  if (pending.kind === 'signup') {
    // 1) Confirm the account (fires the post-confirmation Lambda, which attaches
    //    the clinic using the ClientMetadata replayed here).
    const confirmed = await client.send(
      new ConfirmSignUpCommand({
        ClientId: COGNITO_CLIENT_ID,
        Username: pending.email,
        ConfirmationCode: code,
        ClientMetadata: pending.clientMetadata || {},
      }),
    );
    // 2) Auto-sign-in with the returned session - no second code.
    const authed = await client.send(
      new InitiateAuthCommand({
        ClientId: COGNITO_CLIENT_ID,
        AuthFlow: 'USER_AUTH',
        AuthParameters: { USERNAME: pending.email },
        Session: confirmed.Session,
      }),
    );
    if (!authed.AuthenticationResult) {
      throw new Error('Sign-in did not complete after confirmation.');
    }
    saveTokens(authed.AuthenticationResult);
    return currentUser();
  }

  // Returning user: answer the EMAIL_OTP challenge.
  const out = await client.send(
    new RespondToAuthChallengeCommand({
      ClientId: COGNITO_CLIENT_ID,
      ChallengeName: 'EMAIL_OTP',
      Session: pending.session,
      ChallengeResponses: { USERNAME: pending.email, EMAIL_OTP_CODE: code },
    }),
  );
  if (!out.AuthenticationResult) {
    throw new Error('That code did not complete sign-in.');
  }
  saveTokens(out.AuthenticationResult);
  return currentUser();
}

/** Re-send the code. Returns a fresh `pending` (the session rotates). */
export async function resend(pending) {
  if (pending.kind === 'signup') {
    await client.send(
      new ResendConfirmationCodeCommand({
        ClientId: COGNITO_CLIENT_ID,
        Username: pending.email,
        ClientMetadata: pending.clientMetadata || {},
      }),
    );
    return pending; // sign-up confirm is not session-bound
  }
  // Sign-in: a fresh InitiateAuth issues a new code + session.
  return beginSignIn(pending.email);
}

export function signOut() {
  clearTokens();
}
