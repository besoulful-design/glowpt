# GLOWPT SUBSCRIPTION AGREEMENT AND TERMS OF SERVICE

> ## ⚠️ DRAFT — NOT FOR EXECUTION
>
> **This document has not been reviewed by an attorney and must not be shown to,
> accepted by, or represented to any clinic until it has been.** It was prepared
> by David Peterson with AI assistance as a starting point to reduce attorney
> drafting time. It is not legal advice.
>
> **Read this together with `BAA-draft-for-attorney-review.md`.** The two are
> companion documents and are intended for review in one sitting. This one
> covers the commercial relationship; that one covers protected health
> information. Section 2 below governs how they fit together.
>
> Items needing a decision are marked **[REVIEW]**. Blanks are `[LIKE THIS]`.
>
> **Draft version:** draft-v1 · **Prepared:** 2026-08-24

---

## CONTEXT FOR COUNSEL

**GlowPT is a low-price, high-volume SaaS product.** The subscription is
**$350 per month** and buyers are small independent physical
therapy clinics. This is a **standard form accepted as presented**, most likely
by clicking through during online sign-up. It is not expected to be negotiated,
and no clinic at this price is expected to have counsel review it.

**The practical consequence:** whatever this document says is final. There is no
redline round in which a limitation of liability could later be introduced. That
is why Sections 12 and 13 are drafted in, rather than left for negotiation.

**What the product does.** A patient of a subscribing clinic completes a daily
check-in of roughly thirty seconds: a mood rating of one to five, what movement
they did, and an optional free-text note. An AI model generates a short
supportive written reflection in response. Clinic staff see engagement
information for their own patients, and receive a weekly summary email. Patients
do not pay; the clinic pays.

**Three risks counsel should look at first**, because they are specific to this
product rather than generic SaaS:

1. **Free-text patient notes are not monitored.** A patient could write
   something indicating a medical emergency, severe deterioration, or self-harm.
   Nobody reads check-ins in real time and the system does not detect or escalate
   such content. Section 4.4 and Section 11 address this. Please treat these as
   the highest-priority provisions in the document.
2. **The daily reflection is machine-generated** and is not reviewed by a
   clinician before the patient sees it.
3. **GlowPT is not a medical device and not clinical care.** It is an engagement
   and adherence tool.

---

This Subscription Agreement and Terms of Service (this "**Agreement**") is
between **FranklinAI Solutions LLC**, a Pennsylvania limited liability company
with a principal place of business at 6210 Ridge Ave #3, Philadelphia,
Pennsylvania 19128 ("**GlowPT**," "**we**," or "**us**"), and the clinic
identified during sign-up ("**Customer**," "**Clinic**," or "**you**").

By clicking to accept, signing an order form, or using the Service, you agree to
this Agreement. If you are accepting on behalf of a clinic, you represent that
you have authority to bind that clinic.

> **[REVIEW]** Acceptance mechanics. The product today captures a checkbox
> during web onboarding. Please confirm what must be captured and retained for
> this to be enforceable: identity of the accepting person, their representation
> of authority, timestamp, and the exact version of the text displayed. The
> application already versions its legal text and stores a version identifier
> per user, so implementing whatever is required is straightforward.

---

## 1. DEFINITIONS

**1.1** "**Service**" means the GlowPT web application at glowpt.app and any
related services we provide to you under this Agreement.

**1.2** "**Authorized User**" means a member of your workforce whom you permit
to access the Service, and a patient of your clinic whom you invite to use the
Service.

**1.3** "**Customer Data**" means data submitted to the Service by you or your
Authorized Users, including patient check-ins.

**1.4** "**PHI**" has the meaning given in the BAA.

**1.5** "**BAA**" means the Business Associate Agreement between the Parties.

**1.6** "**Aggregated Data**" means data derived from the operation of the
Service that is aggregated or de-identified so that it does not identify you,
any Authorized User, or any individual, and cannot reasonably be used to do so.

---

## 2. RELATIONSHIP TO THE BUSINESS ASSOCIATE AGREEMENT

**2.1** The BAA is incorporated into this Agreement by reference and forms part
of it. Your acceptance of this Agreement constitutes acceptance of the BAA.

**2.2** The BAA governs our handling of PHI. **Where this Agreement and the BAA
conflict with respect to PHI, the BAA controls.** For all other matters,
including fees, term, intellectual property, warranties, and limitation of
liability, this Agreement controls.

**2.3** Neither document may be terminated independently of the other.
Termination of this Agreement terminates the BAA, subject to the survival and
data-return provisions of the BAA.

> **[REVIEW]** Section 2.2 is the hinge between the two documents and should be
> read against Section 6.3 of the BAA, which states the same rule from the other
> side. Please confirm the two are consistent and that incorporation by
> reference is effective given click-through acceptance. Please also confirm
> whether the limitation of liability in Section 13 should apply to claims
> arising under the BAA, or whether BAA claims should sit outside the cap. This
> is the single most consequential open question in either document.

---

## 3. THE SERVICE

**3.1 Access.** Subject to this Agreement and payment of fees, we grant you a
non-exclusive, non-transferable right to access and use the Service during the
Term for your internal clinical and administrative purposes.

**3.2 Patients use the Service at no charge.** Patients of your clinic are not
charged. You are responsible for the conduct of your Authorized Users.

**3.3 Changes to the Service.** We may modify or improve the Service. We will
not materially reduce core functionality during a paid term without notice to
you.

**3.4 Availability.** We aim to keep the Service available but do not commit to
a specific uptime percentage.

> **[REVIEW]** Section 3.4 offers no service level commitment. At $350 per
> month with no dedicated infrastructure per clinic, a contractual uptime
> guarantee with credits may not be advisable. Please advise whether to leave
> this as is, or to offer a modest commitment for competitive reasons.

---

## 4. CUSTOMER OBLIGATIONS

**4.1** You are responsible for obtaining any consent, authorization, or notice
required for your patients to participate, and for confirming that use of the
Service is consistent with your own policies and your Notice of Privacy
Practices.

**4.2** You will keep Authorized User credentials secure, and will promptly tell
us of any unauthorized access.

**4.3** You will promptly remove access for any workforce member who should no
longer have it.

**4.4 Clinical responsibility remains yours.** You acknowledge and agree that:

  **(a)** the Service is an engagement and adherence tool and is **not** medical
  care, clinical decision support, diagnosis, treatment, or a medical device;

  **(b)** **we do not monitor check-ins, notes, or any other patient submission
  in real time, and the Service does not detect, flag, or escalate content
  indicating a medical emergency, clinical deterioration, self-harm, or risk to
  any person;**

  **(c)** clinical judgment, patient monitoring, and response to any patient
  need remain solely your responsibility; and

  **(d)** you will tell your patients not to use the Service to report urgent or
  emergency medical concerns, and will direct them to appropriate emergency
  services instead.

**4.5 Acceptable use.** You will not, and will not permit any Authorized User
to: resell or provide the Service to a third party; reverse engineer or attempt
to derive the source code of the Service; use the Service to store or transmit
malicious code; use the Service in violation of law; or use the Service to
attempt to gain unauthorized access to another clinic's data.

> **[REVIEW]** Section 4.4 is, in my judgment as a non-lawyer, the most
> important provision in this document, and the one most likely to matter if
> something goes badly wrong. Please advise whether this allocation of clinical
> responsibility is enforceable and sufficient, whether the disclaimer should
> also appear in the patient-facing interface rather than only in the clinic's
> contract, and whether any of it should be restated in Section 11 or Section 13
> so that it survives independently.

---

## 5. FEES AND PAYMENT

**5.1 Fees.** You will pay the subscription fee of **$350 per month**, or the
amount stated at sign-up.

> **[REVIEW]** The price is settled at **$350 per month**, which matches the
> published price on glowpt.app. The clause states the figure and also refers to
> the amount stated at sign-up, so that a future price change, or a discounted
> or introductory rate for an individual clinic, does not require the agreement
> to be re-executed. Please confirm that dual reference is drafted correctly and
> that the sign-up amount governs where the two differ.

**5.2 Billing.** Fees are billed monthly in advance by the payment method you
provide, and are non-refundable except as expressly stated.

**5.3 Taxes.** Fees are exclusive of taxes. You are responsible for any taxes
other than taxes on our income.

**5.4 Late or failed payment.** If payment fails, we may suspend the Service
after `[NUMBER]` days' written notice. Suspension does not delete Customer Data,
and Section 9.3 export rights continue to apply.

**5.5 Price changes.** We may change fees effective at the start of a renewal
term on at least `[NUMBER]` days' written notice. If you do not accept the
change you may cancel before the renewal date.

> **[REVIEW]** Please confirm 5.4 and 5.5 against Pennsylvania law and against
> any automatic-renewal statutes that apply where the clinic is located. Several
> states regulate auto-renewing subscriptions, including notice and cancellation
> requirements. This is a real compliance exposure for a product sold across
> state lines and I do not know its scope.

---

## 6. TERM, RENEWAL, AND CANCELLATION

**6.1 Term.** This Agreement starts when you first accept it and continues
month to month.

**6.2 Renewal.** The subscription renews automatically each month until
cancelled.

**6.3 Cancellation by you.** You may cancel at any time, effective at the end of
the then-current monthly term. We do not pro-rate partial months.

**6.4 Termination by us.** We may terminate on `[NUMBER]` days' written notice,
or immediately if you materially breach this Agreement and do not cure within
`[NUMBER]` days of notice.

---

## 7. INTELLECTUAL PROPERTY

**7.1 Our property.** We own the Service and all software, designs, and content
in it, and all intellectual property rights in them. Nothing in this Agreement
transfers ownership to you.

**7.2 Your property.** You own Customer Data. You grant us a limited licence to
host, process, and transmit Customer Data solely to provide and support the
Service, and as permitted by the BAA with respect to PHI.

**7.3 Aggregated Data.** We may create and use Aggregated Data to operate and
improve the Service and for our own business purposes. **We will not use PHI to
train, fine-tune, or improve any artificial intelligence model**, consistent
with the BAA.

**7.4 Feedback.** If you give us suggestions, we may use them without
obligation to you.

> **[REVIEW]** Section 7.3 must be consistent with Section 3.4 and Section
> 3.5(c) of the BAA. The intent is that genuinely de-identified operational
> metrics are ours to use, while patient content is never used for model
> training. Please confirm the two documents say the same thing and that the
> de-identification standard referenced in the BAA is the operative one.

---

## 8. CONFIDENTIALITY

**8.1** Each Party may receive confidential information of the other. Each Party
will protect the other's confidential information with at least reasonable care
and will use it only to perform under this Agreement.

**8.2** Confidentiality obligations do not apply to information that is public
through no fault of the receiving Party, was already known without duty of
confidence, is independently developed, or must be disclosed by law.

**8.3** PHI is governed by the BAA, not this Section.

---

## 9. CUSTOMER DATA AND TERMINATION EFFECTS

**9.1** We will maintain reasonable administrative, physical, and technical
safeguards for Customer Data, as further described in the BAA.

**9.2** You are responsible for the accuracy of Customer Data.

**9.3 Export on termination.** For `[NUMBER]` days after termination, we will
make available an export of Customer Data in a commonly used electronic format.
After that period, data is returned or destroyed in accordance with the BAA.

> **[REVIEW]** The export window here and the one in BAA Section 5.4(a) must be
> the same number. Please set one figure and confirm both documents match.

---

## 10. THIRD-PARTY SERVICES

**10.1** The Service runs on third-party infrastructure. Vendors that handle PHI
are bound in writing as described in the BAA. We remain responsible for their
performance in providing the Service.

---

## 11. WARRANTIES AND DISCLAIMERS

**11.1 Limited warranty.** We warrant that the Service will perform materially
as described in our documentation. Your exclusive remedy for breach of this
warranty is for us to correct the problem or, if we cannot, to terminate the
subscription and refund fees for the unused portion of the current month.

**11.2 Disclaimer.** EXCEPT AS EXPRESSLY STATED IN SECTION 11.1, THE SERVICE IS
PROVIDED "AS IS" AND WE DISCLAIM ALL OTHER WARRANTIES, EXPRESS OR IMPLIED,
INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE
UNINTERRUPTED OR ERROR-FREE.

**11.3 No clinical warranty.** WE MAKE NO WARRANTY THAT USE OF THE SERVICE WILL
IMPROVE PATIENT ADHERENCE, PATIENT OUTCOMES, OR ANY CLINICAL OR BUSINESS RESULT.
CONTENT GENERATED BY THE SERVICE, INCLUDING THE DAILY REFLECTION, IS AUTOMATED,
IS NOT REVIEWED BY A CLINICIAN BEFORE DELIVERY, AND IS NOT MEDICAL ADVICE.

> **[REVIEW]** Section 11.3 is deliberately blunt because the product's
> marketing speaks about reducing patient drop-off. Please confirm the
> disclaimer is consistent with the marketing claims made on glowpt.app, and
> flag any marketing language that would undercut it. A disclaimer that
> contradicts the sales pitch is weak.

---

## 12. INDEMNIFICATION

**12.1 By us.** We will defend you against a third-party claim that the Service
infringes that third party's intellectual property rights, and pay damages
finally awarded, provided you notify us promptly and let us control the defence.

**12.2 By you.** You will defend us against a third-party claim arising from
your breach of Section 4, including any claim relating to clinical care, patient
monitoring, or your failure to obtain required patient consent.

> **[REVIEW]** Section 12 is drafted narrowly and mutually. Please advise
> whether this allocation is appropriate at this price point, whether we should
> indemnify for a breach of PHI caused by us, and how that interacts with the
> cap in Section 13 and with the BAA.

---

## 13. LIMITATION OF LIABILITY

**13.1 Exclusion of indirect damages.** NEITHER PARTY IS LIABLE FOR INDIRECT,
INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS OR
LOST DATA, EVEN IF ADVISED OF THE POSSIBILITY.

**13.2 Cap.** EACH PARTY'S TOTAL AGGREGATE LIABILITY ARISING OUT OF OR RELATING
TO THIS AGREEMENT IS LIMITED TO THE FEES PAID BY YOU IN THE `[NUMBER]` MONTHS
IMMEDIATELY PRECEDING THE EVENT GIVING RISE TO THE CLAIM.

**13.3 Exclusions from the cap.** The limits in 13.1 and 13.2 do not apply to
`[LIST]`.

> **[REVIEW] — THIS IS THE PROVISION TO SPEND THE MOST TIME ON.**
>
> Because this is a standard form that will be accepted as presented, this cap
> is the only limitation that will ever exist. There is no negotiation in which
> to add one later.
>
> Specific questions:
> - **What multiple is defensible?** Twelve months of fees at $350 per month is
>   $4,200. That is a very small cap against a HIPAA breach affecting hundreds of
>   patients. A cap that is unreasonably low may be struck down entirely, leaving
>   no cap at all, which would be worse than a realistic one.
> - **Should PHI breach liability sit inside or outside the cap?** This is the
>   question that decides whether the company survives a bad day.
> - **What belongs in 13.3?** Common carve-outs are indemnification obligations,
>   breach of confidentiality, gross negligence, and wilful misconduct.
> - **Does the cap reach claims under the BAA?** See Section 2.2 above.
> - **Is a separate, higher cap appropriate for PHI-related claims**, matched to
>   an insurance limit rather than to fees?

---

## 14. INSURANCE

`[RESERVED]`

> **[REVIEW]** Deliberately left blank. GlowPT does not currently carry cyber
> liability or technology errors and omissions coverage. Please advise whether
> coverage should be obtained before handling real patient data, at what limit,
> and whether any covenant should appear here or be left out until a clinic
> asks. If the answer to Section 13 is that PHI liability should be capped at an
> insured amount, this Section and Section 13.2 need to be drafted together.

---

## 15. GENERAL

**15.1 Changes to this Agreement.** We may update this Agreement. We will give
notice of material changes at least `[NUMBER]` days before they take effect, and
continued use after that date constitutes acceptance.

> **[REVIEW]** Please confirm that unilateral amendment on notice is
> enforceable for a click-through agreement, and what constitutes adequate
> notice. This provision is commonly challenged.

**15.2 Governing law.** This Agreement is governed by the laws of the
Commonwealth of Pennsylvania, without regard to conflict of laws principles.

**15.3 Dispute resolution and venue.** `[RESERVED]`

> **[REVIEW]** Please advise on venue, and on whether arbitration with a class
> action waiver is appropriate. Customers are businesses rather than consumers,
> which affects the analysis.

**15.4 Notices.** Notices to you may be sent to the email address on your
account. Notices to us must be sent to `[NOTICE ADDRESS]`.

> **[REVIEW]** A real notice address is required. The BAA sets breach
> notification deadlines and a deadline without a defined method of notice is a
> practical gap. Please confirm whether email notice is sufficient for both
> documents.

**15.5 Assignment.** You may not assign this Agreement without our written
consent. We may assign it in connection with a merger or sale of substantially
all of our assets.

**15.6 Force majeure.** Neither Party is liable for delay or failure caused by
events beyond its reasonable control.

**15.7 Entire agreement.** This Agreement and the BAA are the entire agreement
between the Parties on this subject and supersede prior discussions.

**15.8 Severability.** If a provision is unenforceable, the rest remains in
effect.

**15.9 No third-party beneficiaries.** Patients and other individuals are not
third-party beneficiaries of this Agreement.

> **[REVIEW]** Please confirm 15.9 is appropriate and enforceable given that
> patients are the primary users of the Service, and whether it creates any
> tension with the patient-facing privacy notice.

---

## 16. ACCEPTANCE

> **[REVIEW] — READ WITH "ACCEPTANCE AND EXECUTION" AT THE END OF THE BAA. THE
> TWO DRAFTS CURRENTLY ASSUME DIFFERENT SIGNING MECHANICS AND MUST BE
> RECONCILED BEFORE EITHER IS USED.**
>
> This Agreement is drafted for **click-through acceptance**, and Section 2.1
> states that accepting it also accepts the BAA. The BAA, however, still carries
> signature blocks. Please choose one model and make both documents match:
>
> - **Both accepted by one click.** Section 16.1 below governs; delete Section
>   16.2 and use Section A of the BAA. This is the only model that works with
>   self-serve web sign-up.
> - **Both signed.** Use Section 16.2 below and Section B of the BAA, and amend
>   Section 2.1 above so it no longer says the click accepts the BAA.
> - **Mixed (this Agreement clicked, BAA signed).** Possible, but Section 2.1
>   must be rewritten, and onboarding gains a manual step.
>
> Please also advise whether the product should generate a dated PDF of whatever
> was accepted, downloadable by the clinic. A covered entity generally needs the
> executed BAA in its own compliance records, and that operational need may
> decide this question regardless of what is legally sufficient.

**16.1 Electronic acceptance.** You accept this Agreement and the BAA by
clicking to accept during sign-up. The individual accepting represents that they
are authorized to bind the Clinic. We record and retain the identity and email
address of the accepting individual, the date and time, and the version
identifier of the text displayed. You may request a copy at any time.

Accepted version: `[SUBSCRIPTION AGREEMENT VERSION IDENTIFIER]`

**16.2 Signature.** *(Use only if the signature model is chosen.)*

**CUSTOMER**

`[CLINIC LEGAL NAME]`

By: ______________________________

Name: `[NAME]`

Title: `[TITLE]`

Date: ______________________________

**GLOWPT**

FranklinAI Solutions LLC

By: ______________________________

Name: David Peterson

Title: `[TITLE]`

Date: ______________________________

---

*End of draft. Not for execution until reviewed by counsel. Read with
`BAA-draft-for-attorney-review.md`.*
