# Draft enquiry to GitHub — does the DPA cover this account?

**Status: DRAFT, NOT SENT.** Written 2026-09-02 for the platform operator to
send. Nothing here commits anyone to anything; it asks three questions and
creates a written record of having asked, which is itself worth having.

## Why this exists

GitHub Actions runners process personal data on our instructions — session
identifiers, retention timestamps, certificate records — and hold a Firebase
admin credential capable of reading the whole database (Annex III row #5).
That is processing on behalf of a controller, so Art. 28(3) GDPR requires a
contract with specified terms.

**Established 2026-09-01, by reading the documents rather than assuming:**

- GitHub's DPA is scoped to *"Online Services"*, defined as *"any service or
  software that GitHub provides You **under a written and executed
  agreement**"*, with *"GitHub Customer Agreement"* meaning *"Your
  agreement(s) for the Online Services"*.
- A free personal account runs on the **GitHub Terms of Service**, which
  carries no Art. 28 language and defers data-protection terms to a Customer
  Agreement or Enterprise addendum for those who hold one.
- GitHub's **General Privacy Statement** puts GitHub as **Controller** for
  users accessing the service directly, and as processor only where *"a school
  or employer supplies your GitHub account"*, governed by a DPA.
- The former **"GitHub DPA for Non-Enterprise Customers" has been retired** —
  its URL now redirects to the privacy-policies index.
- GitHub's customer-terms index says the Customer Agreement *"applies to all
  GitHub Products and Support for customers who **purchase directly from
  GitHub**"*. That **might** mean a self-serve paid plan brings the DPA into
  scope — but it is written around corporate purchasing, and we should not
  spend money on that reading without confirmation. Hence question 2.

The **international transfer** leg is already resolved and is NOT what this
asks about: GitHub, Inc. is an active EU–U.S. Data Privacy Framework
participant covering *"GitHub Free and Subscription Users Data"*, so the
transfer rests on the Commission's adequacy decision of 10 July 2023. Adequacy
answers *where* data may go; it does not supply the Art. 28 contract. Keep the
two apart in any reply — conflating them is the mistake this analysis started
by making.

---

## The message

> **Subject:** Art. 28 GDPR — does the GitHub Data Protection Agreement apply
> to our account?
>
> Hello,
>
> I maintain a public repository under a free personal account. Its GitHub
> Actions workflows process personal data on our instructions: they run
> scheduled maintenance jobs against our own database and handle participant
> identifiers, retention timestamps and certificate records belonging to
> research participants in the EU and Japan. The runners are also supplied
> with a credential to that database.
>
> We are a controller under the GDPR, and this looks to us like processing by
> GitHub on our behalf, which Art. 28(3) requires be governed by a contract.
> I would be grateful for confirmation on three points.
>
> 1. **Does the GitHub Data Protection Agreement apply to our use?** The DPA
>    defines "Online Services" as services provided "under a written and
>    executed agreement", and the Customer Agreement is described as applying
>    to customers who purchase directly from GitHub. It is not clear to us
>    whether a free personal account falls inside either.
>
> 2. **If it does not, is there a route to bring us within it?** In
>    particular, would purchasing GitHub Team place us under the Customer
>    Agreement and therefore the DPA? We would rather understand this before
>    subscribing than after.
>
> 3. **What is GitHub's role for this processing?** Your General Privacy
>    Statement describes GitHub as a controller for users accessing the
>    service directly, and as a processor where an organisation supplies the
>    account. We would like to know which applies to data our own workflows
>    process on our runners.
>
> For completeness, we are not asking about international transfers: we are
> aware GitHub, Inc. is an active EU–U.S. Data Privacy Framework participant
> and we rely on that for the transfer itself. This question is solely about
> the Art. 28 processor contract.
>
> Thank you,
>
> [NAME], [ROLE]
> [INSTITUTION]
> Repository: BasileChretien/canamed-platform

---

## Where to send it

- **GitHub Support**, https://support.github.com — a ticket is the route that
  produces a referenceable record.
- GitHub's DPO contact appears in the General Privacy Statement; the support
  ticket is the better first step because it can be escalated internally.

## When a reply comes

Record the outcome in **Annex III row #5** of `dpa-draft.md`, in the same
change, whichever way it goes:

- **DPA applies** → the gap closes; note the basis and the date.
- **DPA does not apply, Team would fix it** → a costed decision, not a
  technical one.
- **DPA does not apply at all** → the remaining routes are moving the jobs to
  an EEA host (Scaleway is already a papered sub-processor) or a self-hosted
  runner, both of which also remove the transfer.

⚠️ Do not let the row sit saying "enquiry sent" indefinitely. If there is no
substantive reply within a month, that silence is itself the answer for
risk-assessment purposes and should be recorded as such.
