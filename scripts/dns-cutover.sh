#!/usr/bin/env bash
# THE CUTOVER: point glowpt.app (apex + www) at Amplify Hosting, or back at
# Netlify. Only touches the two site records in the Route 53 zone; the mail
# records (SES DKIM, bounce, DMARC) are never touched by this script.
#
#   bash scripts/dns-cutover.sh status     what the world and Route 53 say now
#   bash scripts/dns-cutover.sh amplify    apex + www -> Amplify (ALIAS to CloudFront)
#   bash scripts/dns-cutover.sh netlify    apex + www -> Netlify's load balancers (ROLLBACK)
#
# ORDER ON CUTOVER DAY (2026-09-13 plan):
#   1. David changes the four nameservers at GoDaddy to the Route 53 ones
#      (printed by `status`). Site keeps serving from Netlify because the
#      Route 53 zone is an exact copy. Wait until `dig NS glowpt.app` shows
#      awsdns names.
#   2. `bash scripts/dns-cutover.sh amplify`. Amplify's domain status goes
#      AWAITING_APP_CNAME -> AVAILABLE within minutes.
#   3. David requests a sign-in code and confirms it arrives (proves the SES
#      records survived the move).
#   4. If anything is wrong: `bash scripts/dns-cutover.sh netlify`.
# Netlify's site stays up untouched for at least a week either way.
set -euo pipefail
P=(--profile glowpt-prod --region us-east-1)
ZONE_ID=Z00899942MO7OU6SOCKAS
DOMAIN=glowpt.app
APP_ID=dvewl3gkeo718
CF=d1zcgq2clp38j4.cloudfront.net          # from `aws amplify get-domain-association`
CF_ZONE=Z2FDTNDATAQYW2                     # CloudFront's fixed hosted zone id for aliases
NETLIFY_A1=98.84.224.111
NETLIFY_A2=18.208.88.157

mode=${1:-status}
case "$mode" in
  status)
    echo "Route 53 nameservers (what GoDaddy must hold):"
    aws route53 get-hosted-zone --id "$ZONE_ID" "${P[@]}" --query 'DelegationSet.NameServers' --output text | tr '\t' '\n'
    echo; echo "Live NS for $DOMAIN:"; dig +short NS "$DOMAIN"
    echo; echo "Live apex answer:"; dig +short "$DOMAIN"
    echo "Live www answer:"; dig +short "www.$DOMAIN"
    echo; echo "Route 53 site records:"
    aws route53 list-resource-record-sets --hosted-zone-id "$ZONE_ID" "${P[@]}" \
      --query "ResourceRecordSets[?Type=='A' && (Name=='${DOMAIN}.' || Name=='www.${DOMAIN}.')].{name:Name,alias:AliasTarget.DNSName,ips:ResourceRecords[].Value}" --output json
    echo "Amplify domain status: $(aws amplify get-domain-association --app-id "$APP_ID" --domain-name "$DOMAIN" "${P[@]}" --query 'domainAssociation.domainStatus' --output text)"
    ;;
  amplify)
    B=$(mktemp); cat > "$B" <<JSON
{"Comment":"cutover: apex + www -> Amplify Hosting","Changes":[
 {"Action":"UPSERT","ResourceRecordSet":{"Name":"${DOMAIN}.","Type":"A",
   "AliasTarget":{"HostedZoneId":"${CF_ZONE}","DNSName":"${CF}","EvaluateTargetHealth":false}}},
 {"Action":"UPSERT","ResourceRecordSet":{"Name":"www.${DOMAIN}.","Type":"A",
   "AliasTarget":{"HostedZoneId":"${CF_ZONE}","DNSName":"${CF}","EvaluateTargetHealth":false}}}
]}
JSON
    aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch "file://$B" "${P[@]}" --query 'ChangeInfo.Status' --output text
    rm -f "$B"; echo "apex + www now ALIAS -> $CF. Re-run with 'status' in a minute."
    ;;
  netlify)
    B=$(mktemp); cat > "$B" <<JSON
{"Comment":"ROLLBACK: apex + www -> Netlify","Changes":[
 {"Action":"UPSERT","ResourceRecordSet":{"Name":"${DOMAIN}.","Type":"A","TTL":300,
   "ResourceRecords":[{"Value":"${NETLIFY_A1}"},{"Value":"${NETLIFY_A2}"}]}},
 {"Action":"UPSERT","ResourceRecordSet":{"Name":"www.${DOMAIN}.","Type":"A","TTL":300,
   "ResourceRecords":[{"Value":"${NETLIFY_A1}"},{"Value":"${NETLIFY_A2}"}]}}
]}
JSON
    aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch "file://$B" "${P[@]}" --query 'ChangeInfo.Status' --output text
    rm -f "$B"; echo "apex + www back on Netlify's load balancers."
    ;;
  *) echo "usage: $0 status|amplify|netlify"; exit 1;;
esac
