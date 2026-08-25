# BUSINESS ASSOCIATE AGREEMENT

> ## ⚠️ DRAFT — NOT FOR EXECUTION
>
> **This document has not been reviewed by an attorney and must not be sent to,
> signed by, or represented to any clinic until it has been.** It was prepared
> by David Peterson with AI assistance as a starting point to reduce attorney
> drafting time. It is not legal advice.
>
> **Read this together with `Subscription-Agreement-draft-for-attorney-review.md`.**
> The two are companion documents intended for review in one sitting. That one
> covers the commercial relationship (price, term, IP, warranties, limitation of
> liability); this one covers protected health information. Section 6.3 below and
> Section 2 of that document govern how they fit together.
>
> It is modelled on the required elements of a business associate contract at
> **45 CFR 164.504(e)** and on the sample business associate agreement
> provisions published by the U.S. Department of Health and Human Services.
> Those samples are a floor, not a finished contract: they do not address
> indemnification, limitation of liability, insurance, governing law, or
> dispute resolution, all of which a real agreement needs and all of which are
> business decisions rather than compliance boilerplate.
>
> Items needing a decision are marked **[REVIEW]**. Blanks are marked
> `[LIKE THIS]`.
>
> **Draft version:** draft-v1 · **Prepared:** 2026-08-24

---

## QUESTIONS FOR COUNSEL

Context that changes the usual answers: **GlowPT is a low-price, high-volume
SaaS product.** The subscription is roughly **$300 per month** and the buyers
are small independent physical therapy clinics. This agreement is intended to
be a **standard form that the clinic signs as presented.** It is not expected to
be negotiated, and no clinic at this price point is expected to have counsel
redline it. Please answer with that in mind rather than assuming a negotiated
enterprise contract.

**1. Where do the risk terms belong, given there is no negotiation phase?**
Because nothing here gets redlined, whatever this document says is final. There
is no later round in which a limitation of liability could be introduced.
Should the **limitation of liability** and **indemnification** sit in this BAA,
in a separate subscription agreement, or in both? What cap is defensible for a
single-member LLC at this price point, and should breach-related liability be
carved out of it or inside it?

**2. Do the two documents fit together correctly?**
A companion **Subscription Agreement and Terms of Service** now exists in draft
(`Subscription-Agreement-draft-for-attorney-review.md`) and should be reviewed
at the same time. It incorporates this BAA by reference. Section 6.3 of this
draft and Section 2.2 of that one state the precedence rule from opposite sides:
the BAA controls for PHI, the Subscription Agreement controls for everything
else. Please confirm the two are consistent, that incorporation by reference is
effective given click-through acceptance, and that nothing falls between them.

**2a. Does the liability cap in the Subscription Agreement reach claims under
this BAA?** This is the most consequential open question across both documents.
A cap tied to twelve months of fees is roughly $3,600, which is very small
against a breach affecting hundreds of patients. Please advise whether PHI
liability should sit inside that cap, outside it, or under a separate higher cap
matched to an insurance limit.

**3. Can this be accepted online, or does it need a signature?**
The product onboards clinics through a web form. Today the clinic checks a box
to confirm it has reviewed a plain-language summary. Is **click-through
acceptance** sufficient to form a binding BAA, or is a wet or electronic
signature required? If click-through is acceptable, what must the interface
capture and retain as evidence (identity of the person accepting, their
authority to bind the clinic, timestamp, the exact version of the text shown)?
The application already versions its legal text and records a consent version
per user.

**4. Insurance.** Is cyber liability and/or technology errors and omissions
coverage required or strongly advised before handling real patient data? At
what limit, for a company of this size? Should an insurance covenant appear in
this agreement, or be left out until a clinic asks?

**5. Who signs for Business Associate?** FranklinAI Solutions LLC is a
single-member LLC. Please confirm the correct title for the signature block.

**6. Anything in this draft that should not be here.** This draft was prepared
without legal training. Please flag any provision that is unenforceable,
inadvisable, or that promises something a small vendor should not promise.

---

This Business Associate Agreement (this "**Agreement**") is entered into as of
`[EFFECTIVE DATE]` (the "**Effective Date**") by and between:

**`[CLINIC LEGAL NAME]`**, a `[STATE]` `[ENTITY TYPE]` with a principal place of
business at `[CLINIC ADDRESS]` ("**Covered Entity**"); and

**FranklinAI Solutions LLC**, a Pennsylvania limited liability company with a
principal place of business at 6210 Ridge Ave #3, Philadelphia, Pennsylvania
19128 ("**Business Associate**").

Covered Entity and Business Associate are each a "**Party**" and together the
"**Parties**."

## RECITALS

**A.** Covered Entity is a health care provider and a covered entity as defined
under HIPAA.

**B.** Business Associate provides Covered Entity with GlowPT, a patient
engagement service through which Covered Entity's patients record a daily
wellness check-in and receive an automatically generated written reflection,
and through which Covered Entity's workforce views engagement information about
its own patients (the "**Services**").

**C.** In providing the Services, Business Associate creates, receives,
maintains, or transmits Protected Health Information on behalf of Covered
Entity, and is therefore a business associate of Covered Entity.

**D.** The Parties enter into this Agreement to comply with the Privacy,
Security, Breach Notification, and Enforcement Rules at 45 CFR Parts 160 and
164 (the "**HIPAA Rules**").

NOW, THEREFORE, the Parties agree as follows.

---

## 1. DEFINITIONS

**1.1** Capitalized terms used but not defined in this Agreement have the
meanings given to them in the HIPAA Rules. This includes, without limitation:
Breach, Data Aggregation, Designated Record Set, Disclosure, Health Care
Operations, Individual, Minimum Necessary, Notice of Privacy Practices,
Protected Health Information, Required By Law, Secretary, Security Incident,
Subcontractor, Unsecured Protected Health Information, and Use.

**1.2** "**HIPAA**" means the Health Insurance Portability and Accountability
Act of 1996, as amended by the Health Information Technology for Economic and
Clinical Health Act (the "HITECH Act"), and their implementing regulations.

**1.3** "**PHI**" means Protected Health Information that Business Associate
creates, receives, maintains, or transmits for or on behalf of Covered Entity
under this Agreement.

**1.4** "**Service Data**" means data generated by Business Associate's systems
that does not identify any Individual and cannot reasonably be used to identify
any Individual, including aggregate usage and performance metrics.

> **[REVIEW]** The definition of Service Data in 1.4 exists to support Section
> 3.4 (de-identified data). Counsel should confirm the definition is tight
> enough that it cannot be read to cover anything that is in fact PHI.

---

## 2. OBLIGATIONS OF BUSINESS ASSOCIATE

**2.1 Limits on Use and Disclosure.** Business Associate shall not Use or
Disclose PHI other than as permitted or required by this Agreement or as
Required By Law. Business Associate shall not Use or Disclose PHI in a manner
that would violate Subpart E of 45 CFR Part 164 if done by Covered Entity,
except as set forth in Sections 3.2 and 3.3.

**2.2 Safeguards.** Business Associate shall use appropriate administrative,
physical, and technical safeguards, and shall comply with Subpart C of 45 CFR
Part 164 with respect to electronic PHI, to prevent Use or Disclosure of PHI
other than as provided by this Agreement. Without limiting the foregoing,
Business Associate shall:

  **(a)** encrypt PHI in transit and at rest;

  **(b)** restrict access to PHI so that a member of Covered Entity's workforce
  may access only records associated with Covered Entity, and, where Covered
  Entity has assigned a patient to a specific clinician, only that clinician's
  assigned patients and Covered Entity's administrative personnel;

  **(c)** record an access log entry when a member of Covered Entity's
  workforce views patient information through the Services; and

  **(d)** maintain the safeguards described in this Section 2.2 for so long as
  Business Associate holds PHI.

> **[REVIEW]** Subsections (a) through (d) describe controls the Services
> actually implement today. Counsel should advise whether committing to
> specific technical controls in the contract is desirable, or whether a
> general standard is preferable so that the controls can evolve without
> amendment. A middle path is to move (a) through (d) to an exhibit that can be
> updated by notice.

**2.3 Minimum Necessary.** Business Associate shall limit its Use, Disclosure,
and request of PHI to the minimum necessary to accomplish the intended purpose,
consistent with 45 CFR 164.502(b) and 164.514(d).

**2.4 Mitigation.** Business Associate shall mitigate, to the extent
practicable, any harmful effect known to it of a Use or Disclosure of PHI by
Business Associate in violation of this Agreement.

**2.5 Reporting.** Business Associate shall report to Covered Entity:

  **(a)** any Use or Disclosure of PHI not provided for by this Agreement of
  which it becomes aware, without unreasonable delay and in no case later than
  `[NUMBER]` days after discovery;

  **(b)** any Breach of Unsecured PHI, without unreasonable delay and in no
  case later than `[NUMBER]` days after discovery, in accordance with 45 CFR
  164.410; and

  **(c)** any Security Incident of which it becomes aware. The Parties
  acknowledge that unsuccessful attempts at unauthorized access that are
  routinely blocked and result in no unauthorized access to PHI (such as
  routine port scans, failed log-in attempts, and denial-of-service attempts
  that do not result in unauthorized access) need not be reported individually;
  this paragraph constitutes notice of the ongoing existence of such attempts.

**2.6 Contents of Breach Notice.** A report under Section 2.5(b) shall include,
to the extent known at the time and supplemented promptly as further
information becomes available: the identification of each Individual whose
Unsecured PHI has been, or is reasonably believed to have been, accessed,
acquired, Used, or Disclosed; a description of what happened; the date of the
Breach and the date of discovery; the types of PHI involved; and the steps
Business Associate is taking to investigate, mitigate, and protect against
further Breaches.

> **[REVIEW]** The blanks in 2.5(a) and 2.5(b) are business decisions. Many
> agreements use five business days or ten calendar days. Note that Covered
> Entity's own deadline to notify Individuals runs from discovery under 45 CFR
> 164.404, so a shorter period here protects Covered Entity. Counsel should
> also advise whether Business Associate should bear the cost of Individual
> notification where a Breach is caused by Business Associate, which is a
> negotiated point and is deliberately not addressed above.

**2.7 Subcontractors.** In accordance with 45 CFR 164.502(e)(1)(ii) and
164.308(b)(2), Business Associate shall ensure that any Subcontractor that
creates, receives, maintains, or transmits PHI on behalf of Business Associate
agrees in writing to restrictions and conditions at least as restrictive as
those that apply to Business Associate under this Agreement.

**2.8 Disclosure of Subcontractors.** As of the Effective Date, Business
Associate uses the following Subcontractors that may handle PHI:

| Subcontractor | Function | Written agreement |
|---|---|---|
| Amazon Web Services, Inc. | Cloud hosting, database, authentication, transactional email, and the Amazon Bedrock service used to generate the daily reflection | AWS Business Associate Addendum, executed and effective 2026-08-02 |

Business Associate shall notify Covered Entity before adding a Subcontractor
that will handle PHI.

> **[REVIEW]** Two points. First, the table must be accurate on the day of
> signature. It reflects the architecture after the pending migration of the
> AI reflection to Amazon Bedrock; **until that change is deployed to
> production, the reflection is generated by Anthropic, PBC and the table is
> wrong.** Do not execute this agreement against the current production
> configuration without correcting the table and confirming the corresponding
> written agreement is in place. Second, counsel should advise whether
> notification of new Subcontractors should be a right to object or merely
> notice.

**2.9 Access to PHI.** Business Associate shall, within `[NUMBER]` days of a
written request from Covered Entity, make available PHI in a Designated Record
Set to Covered Entity as necessary to satisfy Covered Entity's obligations
under 45 CFR 164.524.

**2.10 Amendment of PHI.** Business Associate shall, within `[NUMBER]` days of
a written request from Covered Entity, make any amendment to PHI in a
Designated Record Set as directed by Covered Entity, as necessary to satisfy
Covered Entity's obligations under 45 CFR 164.526.

**2.11 Accounting of Disclosures.** Business Associate shall maintain and make
available to Covered Entity, within `[NUMBER]` days of a written request, the
information required to provide an accounting of Disclosures as necessary to
satisfy Covered Entity's obligations under 45 CFR 164.528.

**2.12 Individual Requests Received Directly.** If Business Associate receives a
request directly from an Individual for access to, amendment of, or an
accounting of Disclosures of that Individual's PHI, Business Associate shall
forward the request to Covered Entity within `[NUMBER]` days and shall not
respond substantively except at Covered Entity's direction. The Parties
acknowledge that Covered Entity, not Business Associate, is responsible for
responding to such requests.

**2.13 Covered Entity Obligations Performed by Business Associate.** To the
extent Business Associate is to carry out an obligation of Covered Entity under
Subpart E of 45 CFR Part 164, Business Associate shall comply with the
requirements of Subpart E that apply to Covered Entity in the performance of
that obligation.

**2.14 Availability of Records to the Secretary.** Business Associate shall make
its internal practices, books, and records relating to the Use and Disclosure
of PHI available to the Secretary for purposes of determining Covered Entity's
compliance with the HIPAA Rules. Business Associate shall notify Covered Entity
of any such request, unless prohibited by law.

**2.15 Workforce.** Business Associate shall ensure that members of its
workforce who have access to PHI are trained on their obligations with respect
to PHI and are subject to sanctions for violations.

---

## 3. PERMITTED USES AND DISCLOSURES BY BUSINESS ASSOCIATE

**3.1 Provision of the Services.** Business Associate may Use and Disclose PHI
as necessary to perform the Services for Covered Entity, and as otherwise
permitted by this Agreement.

**3.2 Management and Administration.** Business Associate may Use PHI for the
proper management and administration of Business Associate, and to carry out
its legal responsibilities. Business Associate may Disclose PHI for those
purposes only if the Disclosure is Required By Law, or if Business Associate
obtains reasonable assurances from the person to whom the PHI is disclosed that
it will be held confidentially and Used or further Disclosed only as Required
By Law or for the purpose for which it was disclosed, and that the person will
notify Business Associate of any instance of which it is aware in which the
confidentiality of the information has been breached.

**3.3 Data Aggregation.** Business Associate may Use PHI to provide Data
Aggregation services relating to the Health Care Operations of Covered Entity,
as permitted by 45 CFR 164.504(e)(2)(i)(B).

**3.4 De-identified Data and Service Data.** Business Associate may de-identify
PHI in accordance with 45 CFR 164.514(a) through (c), and may Use Service Data
and properly de-identified data for its own purposes, including improving and
operating the Services.

**3.5 Prohibited Uses.** Notwithstanding anything to the contrary, Business
Associate shall not:

  **(a)** sell PHI, or receive remuneration in exchange for PHI, except as
  permitted by 45 CFR 164.502(a)(5)(ii);

  **(b)** Use or Disclose PHI for marketing or advertising purposes;

  **(c)** Use PHI to train, fine-tune, or otherwise improve any machine learning
  or artificial intelligence model, whether its own or a third party's, except
  where the model is used solely to provide the Services to Covered Entity; or

  **(d)** Use or Disclose PHI of one Covered Entity for the benefit of, or in
  the provision of services to, any other customer.

> **[REVIEW]** Section 3.5(c) is deliberately broad because the Services send
> patient text to a third-party model to generate the daily reflection. Counsel
> should confirm the wording is consistent with the terms of the AWS Business
> Associate Addendum and with Amazon Bedrock's published data handling terms,
> and that Business Associate can in fact comply. Section 3.4 and Section
> 3.5(c) should be read together to confirm they do not conflict.

---

## 4. OBLIGATIONS OF COVERED ENTITY

**4.1** Covered Entity shall notify Business Associate of any limitation in
Covered Entity's Notice of Privacy Practices, of any change in or revocation of
an Individual's permission to Use or Disclose PHI, and of any restriction on
the Use or Disclosure of PHI that Covered Entity has agreed to or is required
to abide by under 45 CFR 164.522, in each case to the extent the limitation,
change, revocation, or restriction may affect Business Associate's Use or
Disclosure of PHI.

**4.2** Covered Entity shall not request Business Associate to Use or Disclose
PHI in any manner that would not be permissible under the HIPAA Rules if done
by Covered Entity, except as permitted by Sections 3.2 and 3.3.

**4.3** Covered Entity is solely responsible for obtaining any consent,
authorization, or notice required for its patients to participate in the
Services, and for the accuracy of the patient information it or its patients
submit.

**4.4** Covered Entity shall promptly notify Business Associate of any workforce
member whose access to the Services should be terminated.

---

## 5. TERM AND TERMINATION

**5.1 Term.** This Agreement takes effect on the Effective Date and continues
until terminated in accordance with this Section 5, or until all PHI is
returned or destroyed in accordance with Section 5.4.

**5.2 Termination for Cause.** Covered Entity may terminate this Agreement and
the underlying service agreement if Business Associate materially breaches this
Agreement and fails to cure the breach within `[NUMBER]` days of written notice.
If cure is not possible, Covered Entity may terminate immediately. If neither
termination nor cure is feasible, Covered Entity shall report the violation to
the Secretary.

**5.3 Termination for Convenience.** Either Party may terminate this Agreement
on `[NUMBER]` days' written notice, provided that termination of this Agreement
also terminates the underlying service agreement.

**5.4 Effect of Termination.** Upon termination, Business Associate shall:

  **(a)** for a period of `[NUMBER]` days following termination, make available
  to Covered Entity a export of Covered Entity's data in a commonly used
  electronic format;

  **(b)** thereafter return to Covered Entity or destroy all PHI that Business
  Associate or its Subcontractors maintain in any form, and retain no copies;
  and

  **(c)** if return or destruction is infeasible, notify Covered Entity in
  writing of the conditions that make it infeasible, extend the protections of
  this Agreement to that PHI, and limit further Uses and Disclosures to the
  purposes that make return or destruction infeasible, for so long as the PHI
  is retained.

**5.5 Survival.** Sections 2.14, 5.4, 5.5, and any provision that by its nature
should survive, survive termination of this Agreement.

> **[REVIEW]** Section 5.4(b) should be reconciled with Business Associate's
> backup retention. If encrypted backups persist for a defined period after
> deletion, say so here rather than promising deletion the systems cannot
> deliver. Counsel should confirm the actual backup retention period and insert
> it. This is a common source of a promise that is quietly false.

---

## 6. GENERAL PROVISIONS

**6.1 Regulatory References.** A reference in this Agreement to a section of the
HIPAA Rules means the section as in effect or as amended.

**6.2 Amendment.** The Parties agree to take such action as is necessary to
amend this Agreement from time to time as is necessary for Covered Entity to
comply with the HIPAA Rules. Any other amendment must be in writing and signed
by both Parties.

**6.3 Interpretation and Precedence.** Any ambiguity in this Agreement shall be
resolved to permit compliance with the HIPAA Rules. This Agreement is
incorporated into and forms part of the GlowPT Subscription Agreement and Terms
of Service between the Parties (the "**Subscription Agreement**"). **In the
event of a conflict between this Agreement and the Subscription Agreement with
respect to PHI, this Agreement controls.** For all other matters, including
fees, term, intellectual property, warranties, and limitation of liability, the
Subscription Agreement controls. Neither document may be terminated
independently of the other.

**6.4 No Third-Party Beneficiaries.** Nothing in this Agreement confers any
rights on any person other than the Parties and their respective successors and
permitted assigns.

**6.5 Governing Law.** This Agreement is governed by the laws of
`[STATE]`, without regard to its conflict of laws principles.

**6.6 Counterparts and Electronic Signature.** This Agreement may be executed in
counterparts and by electronic signature, each of which is deemed an original.

> **[REVIEW] — PROVISIONS DELIBERATELY OMITTED.** The following are not in this
> draft because they are business and risk decisions, not HIPAA compliance
> boilerplate, and should be drafted by counsel with the Parties' input:
>
> - **Indemnification.** Who bears the cost of a Breach, and on what terms.
> - **Limitation of liability.** Whether the underlying service agreement's cap
>   applies to this Agreement, and whether Breach-related liability is carved
>   out of that cap. This is frequently the single most negotiated term.
> - **Insurance.** Whether cyber liability coverage is required, and at what
>   limits.
> - **Dispute resolution and venue.**
> - **Assignment.**
> - **Notice provisions.** Addresses and method for formal notice, which
>   matters because Section 2.5 runs on deadlines.
>
> **Update 2026-08-24:** these terms are now drafted in the companion
> Subscription Agreement (Sections 12, 13, 14, 15.3, and 15.4). They remain
> absent *here* deliberately. Counsel should decide whether that is the right
> home for them, or whether any should be restated in this BAA so they clearly
> reach PHI-related claims. Counsel should also review both drafts against
> Pennsylvania law and against `[STATE]` law where the clinic is located.

---

## SIGNATURES

**COVERED ENTITY**

`[CLINIC LEGAL NAME]`

By: ______________________________

Name: `[NAME]`

Title: `[TITLE]`

Date: ______________________________

**BUSINESS ASSOCIATE**

FranklinAI Solutions LLC

By: ______________________________

Name: David Peterson

Title: `[TITLE]`

Date: ______________________________

---

*End of draft. Not for execution until reviewed by counsel.*
