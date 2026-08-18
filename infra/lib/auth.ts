import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';

export interface AuthProps {
  /**
   * The SES configuration set that forces TLS on delivery (from the Email
   * construct). Cognito routes its one-time-code emails through it, so the
   * login codes get the same encryption-in-transit guarantee as everything else.
   */
  configurationSetName: string;
}

/**
 * GlowPT authentication: a Cognito user pool that emails a 6-digit sign-in code.
 *
 * This replaces Supabase passwordless email OTP. Cognito does exactly ONE job:
 * prove who a user is and hand back a stable subject id (the "sub"). It carries
 * NO roles and makes NO access decisions. Row-level security in the database
 * stays the sole authorization boundary (migration Rule 3). Design:
 * glowpt-aws-phase2-auth-design.md.
 *
 * Passwordless, in one browser tab:
 *   - Sign-in identifier is email; there is no username and no phone.
 *   - The pool runs the Essentials feature plan (required for choice-based auth)
 *     with email one-time-password enabled as a first auth factor.
 *   - IMPORTANT reconciliation with the design doc: Cognito REQUIRES that PASSWORD
 *     appear in allowedFirstAuthFactors (you cannot list only emailOtp). So the
 *     pool lists password AND emailOtp. But the app client below enables ONLY the
 *     USER_AUTH (choice-based) flow, not the password flows, and users are signed
 *     up with no password. Net effect: no patient ever sets or is prompted for a
 *     password, and password sign-in is not reachable through our client.
 *   - No Hosted UI / managed login (that path forces passwords). The React app
 *     drives the flow with the AWS SDK, keeping everything in one tab.
 */
export class Auth extends Construct {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthProps) {
    super(scope, id);

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'glowpt-users',

      // Essentials is the minimum plan that supports choice-based / passwordless.
      featurePlan: cognito.FeaturePlan.ESSENTIALS,

      // Email is the identity. Case-insensitive so Grace@x and grace@x are one user.
      signInAliases: { email: true },
      signInCaseSensitive: false,
      standardAttributes: { email: { required: true, mutable: true } },
      autoVerify: { email: true },

      // Accounts are created from the app (the three clinic paths in the design).
      selfSignUpEnabled: true,

      // Passwordless: allow the email one-time code as a first auth factor.
      // password: true is mandatory (Cognito rejects a factor list without it);
      // it is neutralised by the client only enabling USER_AUTH, below.
      signInPolicy: {
        allowedFirstAuthFactors: { password: true, emailOtp: true },
      },

      // The email OTP is itself the single factor; no separate MFA.
      mfa: cognito.Mfa.OFF,

      // Sign-in codes go out through SES on the verified glowpt.app domain,
      // via the TLS-required configuration set. Cognito's built-in mailer is
      // dev-only (about 50/day); SES is the real path.
      email: cognito.UserPoolEmail.withSES({
        fromEmail: 'no-reply@glowpt.app',
        fromName: 'GlowPT',
        sesRegion: 'us-east-1',
        sesVerifiedDomain: 'glowpt.app',
        configurationSetName: props.configurationSetName,
      }),

      // No password means nothing to recover; recovery would only reintroduce a
      // password path. Patients re-enter via their clinic link.
      accountRecovery: cognito.AccountRecovery.NONE,

      // This pool holds real people. Do not let a stack teardown delete it.
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // The single public browser client the React app uses.
    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: 'glowpt-web',

      // Public client (browser): no secret to keep, since a SPA cannot hold one.
      generateSecret: false,

      // ONLY choice-based USER_AUTH. Deliberately NOT userPassword / userSrp:
      // password sign-in is not offered through this client at all.
      authFlows: { user: true },

      // No Hosted UI / managed login, so turn OFF all OAuth flows (CDK would
      // otherwise default the authorization-code AND implicit grants on with a
      // placeholder callback). The app authenticates via the SDK's USER_AUTH
      // flow, which uses no OAuth grant and no callback URL.
      oAuth: {
        flows: {
          authorizationCodeGrant: false,
          implicitCodeGrant: false,
          clientCredentials: false,
        },
      },

      // Do not reveal whether an email is registered. This matters here beyond
      // the usual: a "yes" would confirm someone is a GlowPT (PT) patient.
      preventUserExistenceErrors: true,

      enableTokenRevocation: true,
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],

      // Token lifetimes are a Phase 5 (frontend) decision; defaults for now
      // (1h access/id, 30d refresh).
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito user pool id',
    });
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito app client id the React app initialises with',
    });
  }
}
