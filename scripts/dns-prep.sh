#!/usr/bin/env bash
# DNS PREP for moving glowpt.app's frontend from Netlify to Amplify Hosting
# (2026-09-13). Runs the two steps that change NOTHING live:
#
#   1. A Route 53 hosted zone for glowpt.app in glowpt-prod, holding an EXACT
#      copy of what Netlify DNS serves today (apex + www still pointing at
#      Netlify, the three SES DKIM CNAMEs, the bounce MX/SPF, DMARC). So the
#      later nameserver switch at GoDaddy changes nothing by itself.
#   2. The Amplify domain association for glowpt.app + www, which requests
#      the certificate and hands back one validation CNAME.
#
# It ends by printing: the four Route 53 nameservers (for GoDaddy, LATER) and
# the certificate validation CNAME (for Netlify DNS, NOW, so the certificate
# issues while Netlify still serves the site).
#
# Re-runnable: every step checks before it creates. Prints no secrets.
# Requires: aws sso login --profile glowpt-prod already done.
set -euo pipefail
P=(--profile glowpt-prod --region us-east-1)
APP_ID=dvewl3gkeo718
DOMAIN=glowpt.app

echo "== 1. Route 53 hosted zone"
ZONE_ID=$(aws route53 list-hosted-zones-by-name --dns-name "$DOMAIN" "${P[@]}" \
  --query "HostedZones[?Name=='${DOMAIN}.'].Id | [0]" --output text)
if [ "$ZONE_ID" = "None" ] || [ -z "$ZONE_ID" ]; then
  ZONE_ID=$(aws route53 create-hosted-zone --name "$DOMAIN" \
    --caller-reference "glowpt-app-$(date +%s)" \
    --hosted-zone-config "Comment=glowpt.app moved from Netlify DNS 2026-09-13 for Amplify Hosting" \
    "${P[@]}" --query 'HostedZone.Id' --output text)
  echo "created zone $ZONE_ID"
else
  echo "zone already exists: $ZONE_ID"
fi
ZONE_ID=${ZONE_ID#/hostedzone/}

echo "== 2. DKIM tokens from SES (public values, safe to print)"
TOKENS=$(aws sesv2 get-email-identity --email-identity "$DOMAIN" "${P[@]}" \
  --query 'DkimAttributes.Tokens' --output text)
echo "$TOKENS"
set -- $TOKENS
[ $# -eq 3 ] || { echo "expected 3 DKIM tokens, got $#"; exit 1; }

echo "== 3. Records: exact copy of today's Netlify DNS zone (UPSERT, re-runnable)"
BATCH=$(mktemp)
cat > "$BATCH" <<JSON
{"Comment":"copy of Netlify DNS zone, 2026-09-13","Changes":[
 {"Action":"UPSERT","ResourceRecordSet":{"Name":"${DOMAIN}.","Type":"A","TTL":300,
   "ResourceRecords":[{"Value":"98.84.224.111"},{"Value":"18.208.88.157"}]}},
 {"Action":"UPSERT","ResourceRecordSet":{"Name":"www.${DOMAIN}.","Type":"A","TTL":300,
   "ResourceRecords":[{"Value":"98.84.224.111"},{"Value":"18.208.88.157"}]}},
 {"Action":"UPSERT","ResourceRecordSet":{"Name":"_dmarc.${DOMAIN}.","Type":"TXT","TTL":300,
   "ResourceRecords":[{"Value":"\"v=DMARC1; p=none;\""}]}},
 {"Action":"UPSERT","ResourceRecordSet":{"Name":"${1}._domainkey.${DOMAIN}.","Type":"CNAME","TTL":300,
   "ResourceRecords":[{"Value":"${1}.dkim.amazonses.com"}]}},
 {"Action":"UPSERT","ResourceRecordSet":{"Name":"${2}._domainkey.${DOMAIN}.","Type":"CNAME","TTL":300,
   "ResourceRecords":[{"Value":"${2}.dkim.amazonses.com"}]}},
 {"Action":"UPSERT","ResourceRecordSet":{"Name":"${3}._domainkey.${DOMAIN}.","Type":"CNAME","TTL":300,
   "ResourceRecords":[{"Value":"${3}.dkim.amazonses.com"}]}},
 {"Action":"UPSERT","ResourceRecordSet":{"Name":"bounce.${DOMAIN}.","Type":"MX","TTL":300,
   "ResourceRecords":[{"Value":"10 feedback-smtp.us-east-1.amazonses.com"}]}},
 {"Action":"UPSERT","ResourceRecordSet":{"Name":"bounce.${DOMAIN}.","Type":"TXT","TTL":300,
   "ResourceRecords":[{"Value":"\"v=spf1 include:amazonses.com ~all\""}]}}
]}
JSON
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch "file://$BATCH" "${P[@]}" \
  --query 'ChangeInfo.Status' --output text
rm -f "$BATCH"

echo "== 4. Amplify domain association (glowpt.app + www -> branch main)"
if aws amplify get-domain-association --app-id "$APP_ID" --domain-name "$DOMAIN" "${P[@]}" >/dev/null 2>&1; then
  echo "already exists"
else
  aws amplify create-domain-association --app-id "$APP_ID" --domain-name "$DOMAIN" \
    --sub-domain-settings '[{"prefix":"","branchName":"main"},{"prefix":"www","branchName":"main"}]' \
    "${P[@]}" --query 'domainAssociation.domainStatus' --output text
fi
echo "waiting for Amplify to hand back the certificate record..."
for i in $(seq 1 30); do
  CERT=$(aws amplify get-domain-association --app-id "$APP_ID" --domain-name "$DOMAIN" "${P[@]}" \
    --query 'domainAssociation.certificateVerificationDNSRecord' --output text)
  [ -n "$CERT" ] && [ "$CERT" != "None" ] && break
  sleep 5
done

echo "== 5. Put the validation CNAME into Route 53 too (so it is there after the switch)"
# CERT looks like: _abc.glowpt.app. CNAME _xyz.acm-validations.aws.
CNAME_NAME=$(echo "$CERT" | awk '{print $1}')
CNAME_VALUE=$(echo "$CERT" | awk '{print $3}')
if [ -n "$CNAME_NAME" ] && [ -n "$CNAME_VALUE" ]; then
  aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" "${P[@]}" --change-batch \
   "{\"Changes\":[{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"$CNAME_NAME\",\"Type\":\"CNAME\",\"TTL\":300,\"ResourceRecords\":[{\"Value\":\"$CNAME_VALUE\"}]}}]}" \
   --query 'ChangeInfo.Status' --output text
fi

echo
echo "=================== RESULT ==================="
echo "Route 53 zone: $ZONE_ID"
echo
echo "NAMESERVERS (for GoDaddy, LATER, at cutover, not now):"
aws route53 get-hosted-zone --id "$ZONE_ID" "${P[@]}" --query 'DelegationSet.NameServers' --output text | tr '\t' '\n'
echo
echo "CERTIFICATE VALIDATION CNAME (add this in Netlify DNS NOW):"
echo "  name : $CNAME_NAME"
echo "  value: $CNAME_VALUE"
echo
echo "Amplify DNS targets for the cutover (apex is an ALIAS, www a CNAME):"
aws amplify get-domain-association --app-id "$APP_ID" --domain-name "$DOMAIN" "${P[@]}" \
  --query 'domainAssociation.{status:domainStatus,records:subDomains[].dnsRecord}' --output json
