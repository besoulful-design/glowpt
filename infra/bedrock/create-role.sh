#!/bin/sh
# Creates (or updates) the ONE IAM role that lets GlowPT reach Bedrock.
#
# WHY THIS EXISTS, AND WHY IT IS NOT IN THE CDK STACK
# ---------------------------------------------------
# Bedrock's model quota is per ACCOUNT. On 2026-09-15 every Anthropic Haiku 4.5
# quota in glowpt-prod (463556655381) measured literally 0.0, while the
# management account FranklinAI (456112636877) was fully provisioned and had
# never been tested. So the Lambda stays where it is and BORROWS the management
# account's Bedrock access by assuming this role.
#
# The CDK stack deploys into glowpt-prod and cannot create a role in the
# management account without bootstrapping CDK there, which is a lot of
# machinery for one role. This script is the whole of it instead.
#
# It is IDEMPOTENT: run it as often as you like. It creates the role if it is
# missing and updates both policies every time, so editing the JSON beside it
# and re-running is the way to change permissions.
#
# WHAT IT GRANTS, EXACTLY
#   who  : ONLY arn:aws:iam::463556655381:role/glowpt-ai-response-exec, which is
#          the execution role of the glowpt-ai-response Lambda and nothing else.
#          The trust names the account root with a condition pinning that ARN,
#          rather than the role ARN directly, so the role can be recreated by a
#          CDK deploy without breaking the trust.
#   what : bedrock:InvokeModel on Claude Haiku 4.5 through the US inference
#          profile, and on nothing else. No other model, no other Bedrock API.
#
# It prints no secrets and reads no credentials beyond your SSO session.
#
# Run:  sh /Users/mac/Downloads/glowpt/infra/bedrock/create-role.sh
set -eu

DIR=/Users/mac/Downloads/glowpt/infra/bedrock
PROFILE=franklinai-mgmt
ROLE=GlowptBedrockInvoke

echo "==> Checking for an existing $ROLE role in the management account"
if aws iam get-role --role-name "$ROLE" --profile "$PROFILE" >/dev/null 2>&1; then
  echo "    exists; updating its trust policy"
  aws iam update-assume-role-policy \
    --role-name "$ROLE" \
    --policy-document "file://$DIR/trust-policy.json" \
    --profile "$PROFILE"
else
  echo "    not found; creating it"
  aws iam create-role \
    --role-name "$ROLE" \
    --assume-role-policy-document "file://$DIR/trust-policy.json" \
    --description "Assumed by the glowpt-ai-response Lambda in glowpt-prod to invoke Claude Haiku on Bedrock. The management account holds the quota; glowpt-prod is at zero." \
    --profile "$PROFILE" >/dev/null
fi

echo "==> Writing the Bedrock invoke policy"
aws iam put-role-policy \
  --role-name "$ROLE" \
  --policy-name InvokeHaiku \
  --policy-document "file://$DIR/invoke-policy.json" \
  --profile "$PROFILE"

echo "==> Done. The role ARN the Lambda expects is:"
aws iam get-role --role-name "$ROLE" --profile "$PROFILE" --query 'Role.Arn' --output text
