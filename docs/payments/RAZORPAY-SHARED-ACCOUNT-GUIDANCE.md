# Razorpay Shared-Account Guidance (advice log)

> **Status: Historical (advice log, partly superseded).** Current state is in `PAYMENT-STATE.md`. Corrections to the advice below, as of 2026-09-25:
> - Order tag is `notes.source` (not `app_source`).
> - The real SSBMax host is `ssbmax.ai` (`ssbmax.in` redirects).
> - Apps do not have to share the same mode: test and live are separate. ActionStation is live; SSBMax is on test keys.
> - Each webhook registration has its own secret, so the apps need not share one (the advice below assumed they do).
> - The shared live key pair is still shared, so key regeneration must be coordinated.

Q1 : i have 2-3 websites which need Razorpay integration. should i use different logins for Razorpay, or keep one login and add website links in one login id? whats recommended?
A1 : You can do either, but the recommended approach depends entirely on how your businesses are legally structured and branded. Razorpay supports both methods.

**Option 1: One Account, Multiple Websites**
You can add multiple website links under a single Razorpay account (via **Account & Settings** -> **Add Website link**).

* **Best for:** Websites operating under the same legal business entity, sharing the same bank account, PAN, and GST.
* **Pros:** You only need to complete the KYC process once. You get a unified dashboard for all transactions, reports, and settlements.
* **Cons:** Customers will see the same overarching business/brand name on the checkout screen and their bank statements. If your websites have drastically different brand names, this can confuse customers and lead to chargebacks.

**Option 2: Multiple Accounts, Same Email & Phone**
Razorpay allows you to create multiple distinct merchant accounts using the exact same email address and phone number. You can toggle between them using the "Switch Merchant" option in the profile menu.

* **Best for:** Websites that are separate legal entities, require funds to be routed to different bank accounts, or have completely distinct brand identities.
* **Pros:** Keeps accounting completely separate. Customers will see the specific website's brand name on their bank statements, preventing confusion.
* **Cons:** You must complete the KYC verification process and provide business documents for each account individually.

**The Verdict:**
If these 2-3 websites are just different storefronts for the exact same company and bank account, use **one login** and add the additional URLs. If they are separate businesses or you need the checkout to display different company names, create **multiple accounts** under your existing email.

---

Q2 : i am a solo developer. my brand website is www.ai-borne.in. now i have two web apps, one is www.ssbmax.in & other is www.actionstation.in.
the login id for website is my gmail oauth. i have my personal bank account only.so whats should be my approach?
A2 : Since you are operating with a single personal bank account as a solo developer, you should definitely use **one Razorpay account and add all your website links to it**.

Setting up multiple accounts requires going through the KYC process for each one. Doing that multiple times with the exact same personal PAN and savings account is redundant and can sometimes cause verification delays.

Here is the most practical approach for your setup:

* **The KYC Strategy:** Complete your Razorpay KYC as an "Individual" or "Unregistered Business." This allows you to legally route your payment gateway settlements directly into your personal bank account.
* **The Dashboard Setup:** Log in with your Gmail OAuth, navigate to **Account & Settings**, and add `www.ai-borne.in`, `www.ssbmax.in`, and `www.actionstation.in` under the same dashboard. You'll generate separate API keys for each if needed, but the money all flows to one place.
* **The Branding Fix:** Because everything runs through one account, all your customers will see the same merchant name on their bank statements and UPI apps. Set your Razorpay display name to your parent brand: **ai-borne**.

To prevent customer confusion and chargebacks, just add a brief note on the checkout pages of SSBMax and ActionStation (e.g., *"Payments securely processed by ai-borne"*). This ties your apps back to your studio's identity perfectly.

---

Q3 : but what happens to different webhooks of each of the website? won't it cause conflicts?
A3 : Yes, sharing one account means Razorpay will broadcast the exact same webhook events to all the webhook URLs you configure in your dashboard.

If a customer buys a subscription on SSBMax, Razorpay will send that "Payment Successful" webhook to both the SSBMax server *and* the ActionStation server. If the ActionStation server rejects the webhook (because it doesn't recognize the order ID), Razorpay will flag it as a failure, keep retrying, and eventually disable your webhooks entirely.

To prevent conflicts while keeping everything under one account, you just need to implement a simple routing rule in your code:

**1. Tag your orders using the `notes` object**
When you generate a Razorpay Order ID from your backend, pass a custom identifier in the `notes` object.

* For SSBMax: `notes: { "app_source": "ssbmax" }`
* For ActionStation: `notes: { "app_source": "actionstation" }`

**2. Filter webhooks at the server level**
In the webhook handler endpoint of each application, check the `notes` object inside the incoming JSON payload before processing the database update.

**3. Always return a 200 OK (Crucial)**
If the ActionStation server receives a webhook tagged with `"app_source": "ssbmax"`, it should simply ignore the payload but **immediately return a `200 OK` status code** to Razorpay. This tells Razorpay "Message received, you can stop retrying," preventing it from disabling your webhook URLs.

*Note: Since you are using one account, both of your web apps will also share the exact same Razorpay Key ID and Key Secret for API calls.*

---

Q4 : thats a solid advice you have given. any other important info you'll like to give me, for this issue, that we have discussed for far?
A4 : Yes, there are a few critical compliance and technical details you must know before you apply, as Razorpay has very strict activation rules.

Here are the most important things to keep in mind for your setup:

**1. Mandatory Website Legal Pages (Crucial for Approval)**
Razorpay will not activate your account to accept live payments unless every single website URL you submit (`ai-borne.in`, `ssbmax.in`, `actionstation.in`) has specific legal pages publicly accessible. You must link these in the footer of every website:

* **Privacy Policy:** Must specify what data you collect and why.
* **Terms of Service**
* **Refund & Cancellation Policy:** Even if you do not offer refunds (e.g., for digital goods), you must explicitly state that on a dedicated page.
* **Contact Us:** This must include an email address, a phone number, and a physical contact address. Since you are a solo developer, you can use a virtual office address if you don't want to list your home address, but an address is mandatory.

**2. Exact Name Matching**
The single most common reason for KYC rejection is mismatched names. Because you are setting this up using a personal bank account, ensure that the name on your PAN Card matches the name on your Bank Account exactly. If your PAN says "Sunil Suresh Pawar" but your bank statement says "Sunil Pawar," Razorpay's automated compliance checks might flag or delay your onboarding.

**3. Clear Pricing Display**
Razorpay manually reviews your websites to ensure there are no misleading advertisements. Your products and subscription tiers on SSBMax and ActionStation must have clear descriptions, and the pricing must be visibly displayed in INR before the user reaches the Razorpay checkout screen.

**4. Securing the Shared Webhooks**
Since your web apps will share the same webhook events, they will also share the same **Webhook Secret**. When your SSBMax or ActionStation server receives a webhook payload, you must calculate the SHA256 HMAC signature using your Webhook Secret and compare it against the `X-Razorpay-Signature` header sent by Razorpay. Never process a database update without verifying this signature first, as this prevents malicious actors from sending fake payment success payloads to your endpoints.

---