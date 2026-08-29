# Bedrock quota escalation — follow-up on case 178761116000010

Paste the block below as a **new correspondence on the existing case**
(Support Center -> Support cases -> case 178761116000010 -> Reply).

---

Following up on this case, opened 2026-08-24. It is still showing Unassigned
after five days and no one has contacted me. Re-tested today, 2026-08-29:
nothing has changed.

Account: 463556655381 (glowpt-prod). Region: us-east-1.

WHAT IS WRONG
Every on-demand Bedrock inference quota on this account has an applied value
of 0, so every inference call fails. Measured today:

  75 of 77 on-demand model inference quotas read 0.
  The only two that are not zero are AI21 Jamba 1.5 Large (1 request/minute)
  and Nova Reel concurrent requests (10), which are AWS's own low defaults
  for those models, not a grant.

For Anthropic Claude Haiku 4.5, the model I need:

  L-6120CF2D  Model invocation max tokens per day
              applied 0            AWS default 3,600,000,000
  L-CCA5DF70  Cross-region inference requests per minute
              applied 0            AWS default 10,000
  L-58BE175A  Cross-region inference tokens per minute
              applied 0            AWS default 5,000,000

Every Converse call returns:
  ThrottlingException: Too many tokens per day, please wait before trying again.
Reproduced in us-east-1, us-east-2 and us-west-2.

WHAT I HAVE ALREADY RULED OUT, SO PLEASE DO NOT SEND ME BACK ROUND THESE LOOPS

1. It is not model access. bedrock get-foundation-model-availability for
   anthropic.claude-haiku-4-5-20251001-v1 returns:
     agreementAvailability      AVAILABLE
     authorizationStatus        AUTHORIZED
     entitlementAvailability    AVAILABLE
     regionAvailability         AVAILABLE
   The Marketplace agreement has been ACTIVE since 2026-08-23.

2. It is not the Anthropic use case form. It is submitted and registered;
   bedrock get-use-case-for-model-access returns the saved form.

3. It is not specific to Anthropic or to any one provider. Amazon's own
   us.amazon.nova-micro-v1:0 fails identically on this account.

4. It is not unpopulated quota data. Batch inference quotas on this same
   account carry normal non-zero values (100,000 records, 5 GB job size),
   including for Claude Haiku 4.5. Only on-demand inference is zeroed.

5. It is not account verification. In August, us-east-2 briefly returned the
   "your account is currently being verified" message. That cleared on its own
   on 2026-08-24 and has not returned. RDS, Lambda, Cognito and SES have all
   run normally on this account in us-east-1 for weeks.

THE CONTRADICTION I MOST WANT EXPLAINED
Service Quotas will not accept an increase request at or below the default:

  request-service-quota-increase on L-CCA5DF70 returns
  "You must provide a quota value greater than the default quota value of 10000.0"

So Service Quotas believes this account is already entitled to the standard
default values, while the applied values are 0 and every call throttles. Two
AWS systems disagree about the same account. I have deliberately filed no
quota increase request, because I do not need an increase and asking for more
than the default would misrepresent my usage.

WHAT I AM ASKING FOR
Please set this account's on-demand Bedrock inference quotas to the standard
AWS default values. I am not requesting an increase above default. My actual
usage is roughly one short model call per patient per day.

BUSINESS IMPACT
I am a single-member LLC building a patient engagement app for physical
therapy clinics. I moved this workload to AWS specifically so that Bedrock
would fall under my existing AWS Business Associate Addendum, which has been
Active at the organization level since 2026-08-02. The application is written
and tested and cannot go live on Bedrock while these quotas are 0. This has
been blocked for five days with no contact.

If this case is in the wrong queue, please route it rather than closing it.
