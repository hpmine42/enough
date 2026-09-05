/**
 * Centralized localization. All user-facing strings live here.
 * English is the default language; German is the second language.
 * Adding a language = adding one object with the same keys.
 */

export type Lang = 'en' | 'de';

// Leaf-key union of the en dictionary, e.g. 'auth.login' | 'home.nothingHere' | …
type PathImpl<T, K extends keyof T> = K extends string
  ? T[K] extends string
    ? K
    : K | `${K}.${PathImpl<T[K], keyof T[K]>}`
  : never;
export type TranslationKey = PathImpl<
  (typeof translations)['en'],
  keyof (typeof translations)['en']
>;

export const translations = {
  en: {
    // brand / common
    brand: 'enough.',
    loading: '…',
    cancel: 'Cancel',
    confirm: 'Confirm',
    save: 'Save',
    saved: 'Saved',
    close: 'Close',
    back: 'Back',
    settings: 'Settings',
    search: 'Search',

    // auth screens
    auth: {
      email: 'Email',
      password: 'Password',
      confirmPassword: 'Confirm password',
      username: 'Username',
      displayName: 'Display name',
      login: 'Log in',
      register: 'Register',
      registerTitle: 'Create account',
      noAccount: 'No account yet?',
      haveAccount: 'Already have an account?',
      forgotPassword: 'Forgot password?',
      passwordMismatch: 'The passwords do not match.',
      usernameInvalid:
        'Usernames are 3–20 characters: lowercase letters, numbers, underscore.',
      usernameTaken: 'This username is already taken.',
      usernameAvailable: 'This username is available.',
      usernamePermanent:
        'Choose your username carefully — it cannot be changed after registration.',
      checkingUsername: 'Checking…',
      usernameRequired: 'Please enter a username.',
      displayNameRequired: 'Please enter a display name.',
      emailInvalid: 'Please enter a valid email address.',
      confirmTitle: 'Check your email',
      confirmText:
        'We sent a confirmation link to your email address. Please confirm it, then log in.',
      confirmResend: 'Resend confirmation email',
      confirmResent: 'A new confirmation email has been sent.',
      backToLogin: 'Back to log in',
      forgotTitle: 'Reset password',
      forgotText: 'Enter your email address and we will send you a reset link.',
      sendResetLink: 'Send reset link',
      resetSent:
        'If an account exists for this address, a reset link is on its way.',
      resetTitle: 'New password',
      resetText: 'Choose a new password for your account.',
      setNewPassword: 'Set new password',
      resetSuccess: 'Your password has been changed.',
      theme: 'Theme',
      language: 'Language',
    },

    // home
    home: {
      nothingHere: 'Nothing here yet.',
      startChat: 'Start a chat by searching for people in the settings.',
      settingsLabel: 'Settings',
      themeLabel: 'Toggle theme',
    },

    // legal notice / imprint
    legal: {
      legal: 'Legal',
      imprint: 'Imprint',
      privacy: 'Privacy Policy',
      privacyShort: 'Privacy',
      imprintLinkText: 'View Imprint',
      privacyLinkText: 'View Privacy Policy',
      pursuantTo: 'Information pursuant to Section 5 of the German Digital Services Act (DDG)',
      lastUpdated: 'Last updated: 19 August 2026',
      templateNoticeTitle: 'Template — update before publishing',
      templateNotice:
        'Replace every value in square brackets in src/config/imprint.ts with your own details. Empty optional fields are hidden automatically.',
      provider: 'Service provider',
      representedBy: 'Represented by',
      contact: 'Contact',
      email: 'Email',
      phone: 'Phone',
      registerEntry: 'Register entry',
      registerCourt: 'Register court',
      registerNumber: 'Register number',
      vatId: 'VAT identification number',
      editoriallyResponsible: 'Editorial responsibility pursuant to Section 18(2) MStV',
    },

    // contact form
    contact: {
      title: 'Contact form',
      subtitle: 'Send a message to the operator of enough.',
      nameLabel: 'Name (optional)',
      namePlaceholder: 'Your name',
      emailLabel: 'Email address',
      emailPlaceholder: 'you@example.com',
      messageLabel: 'Message',
      messagePlaceholder: 'Write your message here…',
      submit: 'Send message',
      sending: 'Sending…',
      success: 'Thank you for your message. It has been sent to the operator.',
      sendAnother: 'Send another message',
      sendFailed: 'Failed to send message. Please try again later or contact us directly via email.',
      errorEmailRequired: 'Please enter your email address.',
      errorEmailInvalid: 'Please enter a valid email address.',
      errorMessageRequired: 'Please enter a message.',
      errorMessageTooShort: 'Please enter a message (at least 10 characters).',
      errorMessageTooLong: 'Message must be at most 5,000 characters.',
      errorNameTooLong: 'Name must be at most 100 characters.',
      privacyNote:
        'The information entered above will only be processed to handle and respond to your inquiry.',
    },

    // privacy policy
    privacy: {
      kicker: 'Privacy',
      title: 'Privacy Policy',
      intro:
        'How the enough. messenger processes personal data — described against what this application actually does.',
      lastUpdated: 'Last updated: 5 September 2026',
      tocTitle: 'Contents',
      sectionOverviewTitle: '1. What enough. is — and what it is not',
      sectionOverviewText:
        'enough. is a private one-to-one text messenger. You register with an email address, choose a permanent @username, send a connection request to one other registered person, and then write end-to-end encrypted text messages in that single conversation. There are no group chats, no voice or video calls, no feed, no posts, no public profile pages, no advertising, no analytics and no push notifications — the app never asks for browser notification permission and stores no device tokens.',
      sectionOverviewText2:
        'That has consequences for this policy, so they are stated up front: enough. itself sets no cookies, loads no third-party scripts, fonts, widgets or tracking pixels (its Content-Security-Policy restricts requests to the origin the app is served from plus the Supabase endpoint of the instance), shows your conversation partner no read receipts (your read position is stored in your own row alone, which the database policies make unreadable for anyone else), requests no address book, camera, microphone or location permission, stores no media, and has no payment or billing data because the service is free. Where data exists, it is described in the sections below; features that a typical messenger policy lists but that enough. does not run are not described here.',
      sectionControllerTitle: '2. Controller and contact',
      sectionControllerIntro:
        'The controller for the processing described in this policy, within the meaning of the GDPR, is:',
      sectionControllerText:
        'This address is the contact point for data protection questions, for requests under Articles 15 to 21 GDPR and for complaints. Vulnerability reports can additionally be sent through the security contact published at /.well-known/security.txt.',
      sectionCategoriesTitle: '3. Categories of personal data',
      sectionCategoriesText:
        'Account and authentication data: email address, @username, display name, password (only as a salted one-way hash inside Supabase Auth), an immutable internal user ID, the account creation time, and the technical records Supabase Auth keeps for sessions, email confirmation, email changes and password resets.',
      sectionCategoriesText2:
        'Published cryptographic material: your identity public key, your signed prekey, your one-time prekeys and your post-quantum (Kyber) prekeys — public halves and signatures only, never private keys. Message content: for conversations with other people only the opaque encrypted envelope. Conversation and routing metadata: who is connected to whom, message timestamps and sizes, request states, your own read marker, your own deletion markers, blocks. Contact data: what you type into the contact form. Access data at the frontend host: what a static file server normally sees (section 9).',
      sectionCategoriesText3:
        'Not processed: precise geolocation, contacts, calendar, photos, payment data, advertising identifiers, behavioural profiles or product analytics of how you use the app. Chat content is inside ciphertext that the operator cannot read; the contact form is not encrypted, so please do not send special categories of data (Article 9 GDPR) there.',
      sectionLegalBasisTitle: '4. Legal bases',
      sectionLegalBasisText:
        'Everything that is necessary to provide the account and the messaging itself — account data, published public key material, ciphertexts, connection and delivery metadata, read and deletion markers — is processed on the basis of Article 6(1)(b) GDPR (performance of the contract). The deletion operations you trigger in the settings rest on the same basis.',
      sectionLegalBasisText2:
        'Processing that serves the delivery of the static frontend, the technical operation of the infrastructure, and abuse prevention is based on Article 6(1)(f) GDPR (legitimate interest in a secure, available and minimally equipped service). Contact-form inquiries are handled under Article 6(1)(f) GDPR, and under Article 6(1)(b) GDPR where the inquiry concerns the start or the performance of the account.',
      sectionLegalBasisText3:
        'We do not rely on consent (Article 6(1)(a) GDPR) for any feature of enough. — there is no consent-managed analytics, no advertising and no optional tracking that could be switched on — so there is no consent to withdraw. Automated decision-making, including profiling within the meaning of Article 22 GDPR, does not take place.',
      sectionAccountTitle: '5. Registration, profile and authentication',
      sectionAccountText:
        'Registration requires an email address, a password, an @username and a display name. The email address is used for login, for the confirmation email, for an optional email change and for password-reset links; these emails are sent by Supabase Auth through the email service configured for the project, so that service also learns the address. The password itself is handed to Supabase Auth and stored only as a one-way hash — it never reaches the application tables. The display name (at most 60 characters) and the @username are handed to Supabase Auth as sign-up metadata, and a database trigger writes them into your profile row.',
      sectionAccountText2:
        'Visibility towards other users: on this instance every signed-in user can read every profile row (@username, display name, internal user ID), because the settings search and the rendering of names in chats depend on it. Anyone who types the beginning of your @username will find you. The registration form additionally uses a public availability check, so even a person without an account can technically test whether a specific @username is taken. There are no profile pages, avatars, bios, follower lists or public message boards.',
      sectionAccountText3:
        'The @username cannot be changed after registration, so choose it carefully. The display name can be changed at any time under Settings; each change writes an unencrypted system event into every accepted conversation, because your peers have to see it and only the database can generate it for all of them at once. The registration form requires at least 6 characters and the auth service applies its own password policy on top; two-factor authentication is not offered.',
      sectionE2eeTitle: '6. End-to-end encryption, keys and metadata',
      sectionE2eeText:
        'Every conversation with another person is end-to-end encrypted. Your browser encrypts the text before anything is transmitted, using primitives of the Signal Protocol — a PQXDH handshake (X25519 combined with Kyber-1024 key encapsulation) and a Double Ratchet — through the pinned WebAssembly engine @getmaapp/signal-wasm. What the server receives and stores in the column messages.ciphertext is an opaque envelope: the backend cannot read the message text, and it cannot meaningfully alter it either, because database triggers reject any change to a stored ciphertext other than clearing it. If encryption is not available — an unsupported browser, a session that cannot be established, a state conflict — the message is not sent at all. There is no automatic fallback to plaintext.',
      sectionE2eeMetadata:
        'What encryption does not hide: end-to-end encryption protects the content of a message, not the metadata around it. The database stores, and the operator can therefore see, the sender and recipient user IDs, the conversation ID, the creation timestamp and the byte length of every message, the connection graph with its request states and timestamps, the public key material of every account including which one-time prekey was consumed by whom, and your own read marker, deletion markers and blocks. While a chat is open your client subscribes to Realtime updates for that conversation, so the infrastructure can observe that a client of your account is listening at that moment. The public prekeys are stored on the server because a peer otherwise could not start a session while you are offline.',
      sectionE2eeLimits:
        'Limits you should know about: enough. offers no independent key verification — no safety numbers and no QR-code comparison — so the first session of a conversation trusts the prekey bundle that the backend serves (trust on first use). End-to-end encryption does not protect a compromised device: whatever you can read on your screen, malware or a malicious browser extension can read too. There is exactly one cryptographic device per account and there is no key backup and no recovery phrase: if you clear the browser data, switch to another browser or lose the device, the local keys and the local message cache are gone, past messages stay unreadable, and the next visit generates a new identity.',
      sectionE2eeExceptions:
        'Documented exceptions, by design: My Notes (your personal notepad) is a self-chat without a second participant and is stored unencrypted in your own database rows. System events (a name change, an accepted connection request, a deleted account) are unencrypted metadata. On an instance where conversations existed before encryption was enabled, those older rows may still contain plaintext and are displayed as legacy messages.',
      sectionBackendTitle: '7. Backend infrastructure (Supabase)',
      sectionBackendText:
        'The backend of this instance is a Supabase project, and every part of it that enough. uses is listed here: Supabase Auth for registration, login, email confirmation and password reset; PostgreSQL for profiles, connections, messages, read markers, deletion markers, blocks and public key material; PostgREST as the data API in front of those tables; Row-Level Security plus database triggers as the actual authorization layer; Supabase Realtime (WebSocket) to push new rows into an open conversation; Supabase Edge Functions for exactly one function, the contact form. Database triggers additionally maintain invariants such as the system events mentioned above. Supabase Storage is not used, and no file or media upload exists.',
      sectionBackendText2:
        'The project runs in the AWS region eu-central-1 (Frankfurt am Main, Germany). Supabase documents that the primary Postgres database, the Auth service and Storage objects of a project are hosted in the region selected for that project, and that the region choice alone does not settle a data-residency assessment, because backups, logs, Edge Function execution and sub-processors can involve other locations. Supabase, Inc. acts as our processor for this data; it publishes a Data Processing Agreement under Article 28 GDPR (including EU Standard Contractual Clauses) and a list of sub-processors, and the operator is responsible for concluding and keeping that contract current.',
      sectionBackendLogs:
        'Access, connection and log data: each request to the data API, to Auth and to Realtime carries your access or refresh token and your IP address, and leaves the requested path, HTTP method, headers, timestamps and error codes at the network layer, for delivery, rate limiting and abuse defence. Supabase does not publish a fixed retention period for these technical logs, so we do not state one; the published Data Processing Agreement provides that the data Supabase processes for us is deleted once the platform agreement ends and a 30-day export period has passed. Database backups exist only to the extent the plan and configuration of the project provide them — so deleted content can persist in a backup for the provider\'s backup window before it is rotated out.',
      sectionLocalStorageTitle: '8. Data on your device — and cookies',
      sectionLocalStorageText:
        'A large part of the state of enough. lives on your device, and it is not the same thing as cookies. The app itself sets no cookies at all; nothing in enough. depends on cookie storage. What it uses instead is IndexedDB, LocalStorage, a single sessionStorage flag and the service-worker cache.',
      sectionLocalStorageText2:
        'IndexedDB (database "enough-crypto", stores for state, prekeys, ratchet sessions and sealing keys): your identity key pair and prekey material, the Double Ratchet session states, the sealed message cache (the plaintext of the messages you have read or sent on this device, so that they stay readable) and the sealed Offline Read Mode snapshots (your conversation list and the last 40 messages of an opened chat, with their metadata). All of it is sealed with AES-256-GCM under a non-extractable per-account key held in the same database, and the private identity key is itself a non-extractable Web Crypto key. None of this is ever transmitted to the backend.',
      sectionLocalStorageText3:
        'LocalStorage (plain, small values only): the appearance mode ("enough-theme"), the language ("enough-lang") and the "Enter sends" preference ("enough-enter-to-send"); your local mirrors of your own deletion markers and read markers ("enough-deletions-<userID>" and "enough-read-<userID>"); and the Supabase Auth session under "sb-<project-ref>-auth-token", which holds the access token, the refresh token and basic profile data, together with the short-lived PKCE verifier used during sign-up and password reset. sessionStorage carries one technical flag used when the service worker updates. The service worker caches only the static files of the app shell (HTML, JS, CSS, icons, manifest) — no messages, no tokens, no cross-origin responses.',
      sectionLocalStorageText4:
        'Consequence for you: this data is on your device and the operator cannot read it. You control it through your browser. Clearing site data logs you out and, irreversibly, removes your keys and your local message cache; the chat history itself remains in the database as ciphertext, but it stays unreadable without those keys. Exporting or migrating your device data is therefore something only you can do.',
      sectionHostingTitle: '9. Delivery of the web app (GitHub Pages)',
      sectionHostingText:
        'The frontend is a static web app (HTML, JavaScript, CSS, icons, manifest, service worker) delivered by GitHub Pages from https://hpmine42.github.io/enough/. GitHub Pages is a service of GitHub, Inc. and, for users in the EEA, of GitHub B.V. No GitHub account is needed to use enough., no GitHub login is involved, and the app neither reads nor writes GitHub account data: the browser simply downloads the files and then talks to the Supabase endpoint of the instance.',
      sectionHostingText2:
        'What GitHub processes when the app is loaded: GitHub documents that when a GitHub Pages site is visited the visitor\'s IP address is logged and stored for security purposes, whether or not the visitor is signed into GitHub. Every delivery additionally involves the requested path, the timestamp, the usual request headers (user agent, accepted encodings, a referer if your browser sends one) and the status with which the request is answered. The purpose is delivery of the files plus protection of the platform against abuse and overload. Legal basis on our side: Article 6(1)(f) GDPR.',
      sectionHostingText3:
        'Retention: GitHub does not publish a fixed retention period for these access logs. The GitHub General Privacy Statement describes purpose-based retention — personal data is kept as long as an account is active and as needed to fulfil contractual obligations, comply with legal requirements, resolve disputes and enforce agreements — so no concrete number can be given for the delivery of this app. Two further points follow from that: for this access data GitHub is a controller in its own right and not a processor on our instructions, which means the operator can neither read nor delete those logs; and GitHub\'s own websites set cookies, which is irrelevant for the Pages assets but not for a visit to github.com.',
      sectionContactTitle: '10. Contact form and email delivery (Resend)',
      sectionContactText:
        'The contact form is on the imprint page. When you submit it, we process the name (optional, at most 100 characters), your email address, your message (10 to 5,000 characters) and the time of the inquiry. The form also sends a hidden honeypot field and the moment the form was opened, both used only to recognise automated submissions. The request goes to the Supabase Edge Function send-contact-email, which validates everything again on the server, limits each IP address to five submissions per ten minutes, strips CRLF and control characters from header values, escapes the message for the HTML part, and never accepts a recipient address from the request body — the destination is a server-side configuration value, so the function cannot be used as an open mail relay. The error messages are deliberately generic, and if the mail provider rejects the message the function logs the HTTP status only, not your input.',
      sectionContactText2:
        'The IP address appears in this flow as a key in an in-memory rate-limit table of one function instance: it is not written to any database table, it is not part of the email, and it disappears when that instance ends. Nothing from the contact form is stored in the messenger tables, and no account is needed to use the form.',
      sectionContactResend:
        'The inquiry is delivered as an ordinary email — end-to-end encryption does not apply to email — to the operator\'s mailbox via the API of the email service Resend, whose contracting entity is Plus Five Five, Inc., 2261 Market Street #5039, San Francisco, CA 94114, USA. Resend publishes the following for its own processing: customer data including message content and delivery logs is stored in the United States; while the operator\'s account is active, email and log data are retained for 30 days on the standard plans; after termination, remaining customer data is deleted within 90 days; backups are kept for 7 days; and an individual message can be requested for earlier removal. In the operator\'s own mailbox the inquiry is kept as long as the exchange requires and is then deleted. The reply address is the email you provided, so answers arrive as normal email.',
      sectionContactResend2:
        'Two details belong to this flow: Supabase runs an Edge Function by default in the region closest to the person making the request, which may lie outside the EU, so the contact data is not guaranteed to stay in the EU for the duration of that request; and Resend documents that the sending region of a domain controls routing only, not the storage location. The transfer to the United States rests on Resend\'s Data Processing Addendum, which includes EU Standard Contractual Clauses, and on Resend\'s participation in the EU-U.S. Data Privacy Framework, as Resend publishes it.',
      sectionRetentionTitle: '11. How long data is stored',
      sectionRetentionText:
        'enough. has no expiry dates for chat content: a message ciphertext stays in the database until it is deleted through the app, and no automatic cleanup runs in the background. Correspondingly, this policy contains no general statutory retention periods: the service is free, so there are no invoices or commercial letters to keep, and the operator has no employment or customer relationship with you from which retention duties could be derived. Data is stored as long as it is needed for the purpose described above — that is, for as long as your account exists — and is then removed as described in section 12.',
      sectionRetentionText2:
        'Concrete periods for the individual pieces of data: pending and declined connection requests are marked expired by the database once they are 14 days old, while the row with its state and timestamps remains so that a later request reuses the same pair. Read markers are one timestamp per conversation and are kept until the conversation or the account is gone. Your one-time prekeys remain published until they are consumed, and the consumption record (which account, when) remains with the row; the signed prekey is rotated every 30 days and the previous row is kept, marked inactive. Blocks persist until you lift them or one of the two accounts is deleted. Contact emails live in the operator\'s mailbox and, for up to 30 days, in the delivery logs of Resend as published there. Data on your device remains until you clear it.',
      sectionDeletionTitle: '12. Deletion: account, single messages, whole chats',
      sectionDeletionText:
        'You can delete your account yourself at any time under Settings → Account → "Delete account" (you confirm by typing your @username). That call runs the database function delete_own_account(), which in one transaction writes an unencrypted "@username deleted their account" system message into each accepted conversation, marks those conversations as ended so that nothing can be written into them any more, deletes your profile row — which frees your @username for a later registration — and deletes your auth account. Cascades then remove your per-user rows: read markers, delete-for-me markers, chat cutoffs, blocks and all of your prekey and device records. Afterwards the app wipes the local cryptographic state and the local message cache of that account on your device and clears the session. The local cleanup is best-effort and runs after the server-side deletion is committed.',
      sectionDeletionText2:
        'What account deletion deliberately does not do: it does not erase the history your peers still have. Messages and connections survive the deletion of an account by design, because otherwise one person leaving would destroy another person\'s chat. That means the ciphertexts you sent, their timestamps and the reference to your former internal user ID remain inside those conversations, and the decrypted copies on the devices of your peers remain there as well — neither you nor the operator can remove them retroactively. If you need that, ask the other person to delete the chat or the individual messages on their side.',
      sectionDeletionText3:
        'Single messages: "Delete for everyone" is available to the sender within 24 hours of sending and is enforced in the database, not only in the interface: in one update the ciphertext is cleared to an empty string and the row is marked as deleted, once, only by the sender, only inside the window, and it cannot be undone or edited. The content is then gone from the database, while the remaining row (ID, conversation, sender, timestamps) is shown to both sides as a deleted-message notice, because the other participant has to learn that the message was removed. This operation cannot reach copies that the recipient has already cached or decrypted locally. "Delete for me" leaves the content untouched for the peer and stores a per-user deletion marker; the message simply stops being displayed to you. "Delete chat for me" stores a hidden-until cutoff per conversation: everything at or before it is hidden for you, later messages still arrive, and the cutoff survives a renewed connection with the same person. My Notes can be cleared completely, which removes the self-chat and its messages on the server.',
      sectionTransfersTitle: '13. Recipients and transfers to third countries',
      sectionTransfersText:
        'Your data is not sold, not shared with advertisers, and not disclosed to other users beyond what the architecture itself makes visible. Recipients are: Supabase, Inc. (database, authentication, Realtime, the contact-form function); GitHub (delivery of the static files, plus its own sub-processors and infrastructure operators); the email service Resend, whose contracting entity is Plus Five Five, Inc. (delivery of the contact email); the email provider of the operator\'s mailbox; and, where the operator is legally obliged to disclose data, the competent authority — for a private operator this will normally run through the processors\' own legal processes rather than through a disclosure routine at enough.',
      sectionTransfersText2:
        'Transfers are described per recipient instead of as a blanket sentence: GitHub — Pages assets are served from GitHub\'s globally distributed infrastructure, with the company seated in the USA; for its own transfers GitHub publishes reliance on its EU-U.S. Data Privacy Framework self-certification and on Standard Contractual Clauses in its Data Protection Agreement. Supabase — the primary database and Auth service of this instance are located in the EU (AWS eu-central-1, Frankfurt), so the messenger data is not stored in a third country; Supabase, Inc. is nevertheless a US company whose support and platform operations can involve access from the USA, and Supabase\'s published Data Processing Agreement incorporates EU Standard Contractual Clauses (Module Two and, where relevant, Module Three) for such transfers; we have not verified a separate adequacy certification for Supabase and therefore do not claim one. Resend — storage in the USA, transfer under Resend\'s Data Processing Addendum (SCCs) and, additionally, its EU-U.S. Data Privacy Framework participation, as published by Resend. Supabase Edge Functions — the contact-form function runs in the region closest to the requester, which can be a third country; that is inherent to the current architecture and is disclosed here rather than papered over. Any future recipient or tracking feature would require a new version of this policy first.',
      sectionSecurityTitle: '14. Security measures — and what they do not cover',
      sectionSecurityText:
        'Server side: authorization through Row-Level Security policies and database triggers rather than through client checks, no service-role or secret key in the browser, fail-closed rules for authentication and for cryptographic state, normalisation and length limits enforced in the database as well as in the form, input handling at the plaintext boundary only (stored ciphertext is never rewritten), HTML escaping and CRLF filtering in the contact function, and a Content-Security-Policy without third-party origins. Client side: non-extractable keys, AES-256-GCM sealing of local state under per-account keys with record-bound additional data, an atomic compare-and-swap for ratchet state so that a failed commit sends nothing, and a pinned WebAssembly crypto engine whose artifact hashes are verified by checksum in the build pipeline.',
      sectionSecurityText2:
        'What is not covered: the confidentiality of data in transit depends on TLS between your browser and GitHub or Supabase; there is no two-factor authentication, no device attestation and no encrypted backup; metadata (who writes to whom, when and how often) is not hidden from the server; and there is no protection against a compromised or manipulated device. enough. is a small private project: it has no in-house security team, no external penetration test, no certification and no published bug-bounty or reward programme — reports go to the contact address in the imprint or to /.well-known/security.txt.',
      sectionRightsTitle: '15. Your rights',
      sectionRightsText:
        'You have the right to information (Article 15 GDPR), to rectification (Article 16), to erasure (Article 17), to restriction of processing (Article 18), to data portability (Article 20) and to object (Article 21) GDPR, and the right to lodge a complaint with a supervisory authority (Article 77 GDPR). Withdrawal of a consent is not applicable, because no processing is based on consent; an objection under Article 21 targets the legitimate-interest processing described above, while the messaging itself rests on the contract, which you can end at any time by deleting your account.',
      sectionRightsText2:
        'How these rights work in a messenger with end-to-end encryption: most of it you can exercise yourself in the settings — the display name, email address and password are editable, and deleting the account is the fastest route to erasure. For everything else, write to the address in section 2. In response to an information or portability request we can provide the database rows about you in a structured, machine-readable form (profile row, connections, your read, deletion and block markers, your public key records) — but we cannot hand out message contents: the operator holds no private keys and cannot decrypt the stored ciphertexts, and the decrypted copies exist only on your own device. Where an entry is only present as ciphertext, erasure is carried out by deleting the account or the row itself.',
      sectionRightsAuthority:
        'The supervisory authority competent for the operator in North Rhine-Westphalia is: the State Commissioner for Data Protection and Freedom of Information North Rhine-Westphalia (Landesbeauftragte für Datenschutz und Informationsfreiheit Nordrhein-Westfalen, LDI NRW), Kavalleriestraße 2–4, 40213 Düsseldorf, Germany, phone +49 211 38424-0, poststelle@ldi.nrw.de, www.ldi.nrw.de. Under Article 77(1) GDPR you may also complain to the supervisory authority of your habitual place of residence, your place of work or the place of the alleged infringement.',
      sectionChangesTitle: '16. Changes to this policy; other instances',
      sectionChangesText:
        'This text describes the upstream enough. instance operated by the controller above. If the app gains or removes a feature, the affected section is rewritten rather than extended with generic clauses, and material changes are published here with a new date at the top; there is no separate acceptance dialog and no notification on chat. The policy lives in the public source repository together with the code it describes.',
      sectionChangesText2:
        'If you host enough. yourself, you are an independent controller for your own users: your Supabase project, your hosting, your imprint and your policy are yours, and this text is a starting point that has to be aligned with your actual configuration.',
      referencesLabel: 'Published sources for the provider statements above',
      refGitHubPrivacy: 'GitHub: General Privacy Statement',
      refGitHubPages: 'GitHub Docs: GitHub Pages and data collection',
      refSupabaseDpa: 'Supabase: Data Processing Agreement',
      refSupabaseGdpr: 'Supabase Docs: GDPR compliance and data residency',
      refResendGdpr: 'Resend: GDPR, storage location and retention',
      refSource: 'enough. source code and documentation',
    },

    // settings
    settingsScreen: {
      title: 'Settings',
      profile: 'Profile',
      displayName: 'Display name',
      username: 'Username',
      email: 'Email',
      editEmail: 'Change email',
      newEmail: 'New email',
      changeEmailSubmit: 'Send verification link',
      emailChangeConfirmTitle: 'Change email address?',
      emailChangeConfirmText:
        'You can change your email address here. After you enter the new address, we send a confirmation link to it. The change only takes effect once you confirm it via that link.',
      emailChangeSent:
        'A verification link was sent to the new address. It becomes active after you confirm it.',
      changePassword: 'Change password',
      changePasswordConfirmTitle: 'Change password?',
      changePasswordConfirmText:
        'You will need to confirm your current password before choosing a new one.',
      currentPassword: 'Current password',
      newPassword: 'New password',
      changePasswordSubmit: 'Change password',
      passwordChanged: 'Your password has been changed.',
      people: 'People',
      activeConnections: 'Active connections',
      activeConnectionsEmpty: 'No active connections yet.',
      searchPeople: 'Search people',
      searchPlaceholder: 'Search by @username',
      searchEmpty: 'Type a username to find people.',
      searchNoResults: 'No one found.',
      language: 'Language',
      appearance: 'Appearance',
      light: 'Light',
      dark: 'Dark',
      system: 'System',
      chat: 'Chat',
      enterToSend: 'Enter to send',
      enterToSendHint: 'Enter sends the message. Shift + Enter makes a new line.',
      myNotes: 'My Notes',
      myNotesHint: 'A private chat with yourself.',
      myNotesError: 'My Notes could not be set up.',
      myNotesUpgradeRequired:
        'My Notes requires the latest database update (migrations 0003 and 0005).',
      account: 'Account',
      signOut: 'Sign out',
      signOutTitle: 'Sign out?',
      signOutText: 'You will have to log in again to use enough.',
      deleteAccount: 'Delete account',
      deleteAccountHint: 'Permanently delete your account.',
      deleteAccountTitle: 'Delete account?',
      deleteAccountText:
        'This permanently deletes your account and cannot be undone. Your username becomes available again. Your chats stay visible to the other person, but they can no longer message you.',
      deleteAccountConfirm: 'Delete account',
      deleteAccountTypeHint: 'Type {username} to confirm.',
      footer: 'Version',
      github: 'GitHub',
    },

    // connection request / chat states
    connection: {
      requestTitle: 'Connection request',
      requestInfo:
        'The person who sent this request must be accepted before you can reply.',
      requestInfoLabel: 'Connection request details',
      accept: 'Accept',
      decline: 'Decline',
      cancelRequest: 'Cancel request',
      requestSent: 'Request sent',
      requestDeclined: 'Request declined',
      requestDeclinedNote: 'The request attempt expires on {date}.',
      requestExpired: 'Request expired',
      requestAgain: 'Send request again',
      requestCanceled: 'Request canceled',
      declinedTitle: 'Decline request?',
      declinedText:
        'If you decline, this person can send another request within the next 14 days. “Decline and block” prevents further requests until you unblock them.',
      accepted: 'Accepted',
      ended: 'Connection ended',
    },

    // blocking
    block: {
      title: 'Blocked users',
      hint: 'Manage who can send you requests and messages.',
      empty: 'You have not blocked anyone.',
      status: 'Blocked',
      unblock: 'Unblock',
      blockUser: 'Block user',
      blockTitle: 'Block @{username}?',
      blockText:
        'This person can no longer message you or send connection requests until you unblock them.',
      declineAndBlock: 'Decline and block',
      byYou: 'You have blocked this user. You can unblock them in Settings.',
      byThem:
        'This user has blocked you. You can send a new request once they unblock you.',
      blockedByYouChat:
        'You have blocked this user. Unblock them to chat again.',
      blockedByThemChat:
        'You were blocked. You can chat again once this user unblocks you.',
    },

    // offline read mode (v0.3.x)
    offline: {
      banner: 'You are offline. Showing locally stored data.',
      unreachable: 'No connection to the server. Showing locally stored data.',
      composerDisabled: 'You are offline. Messages can be sent again once you are back online.',
      actionUnavailable: 'Not available offline.',
      noCachedChat: 'This conversation is not available offline.',
      olderUnavailable: 'Older messages are not available offline.',
    },

    // chat
    chat: {
      backLabel: 'Back',
      composerPlaceholder: 'Message',
      sendLabel: 'Send',
      unavailable: 'This conversation is not available.',
      deletedForEveryoneSelf: 'You deleted this message.',
      deletedForEveryoneOther: '@{username} deleted this message.',
      nameChange: '{old} changed their name to {new}.',
      acceptedConnection: '@{username} accepted your connection.',
      acceptedConnectionSelf: 'You accepted the connection.',
      deletedAccount: 'Deleted account',
      deletedAccountMessage: '@{username} deleted their account.',
      deletedAccountNote: 'This account was deleted. You can no longer message this person.',
      noMessages: 'No messages yet.',
      loadingOlder: 'Loading…',
      you: 'You',
      encryptedPreview: 'Encrypted message',
      undecryptable: 'Couldn’t decrypt this message.',
      e2eeUnavailable:
        'Secure messaging is unavailable in this browser. Update or reopen the app to send messages.',
      e2eeFailed: 'Message could not be encrypted. It was not sent.',
      deleteChatForMe: 'Delete chat for me',
      deleteChatConfirmTitle: 'Delete chat?',
      deleteChatConfirmText:
        'If you delete this chat, the entire previous conversation disappears for you. The other person keeps their history. A later new connection does not restore the history that was removed for you.',
      chatDeleted: 'The chat was deleted for you.',
      newMessages: 'New messages',
      myNotesClearTitle: 'Clear this chat and disable My Notes?',
      myNotesClearText:
        'You can re-enable My Notes later in Settings.',
      myNotesTag: 'Private',
    },

    // message actions
    message: {
      copy: 'Copy',
      copied: 'Copied',
      deleteForEveryone: 'Delete for everyone',
      deleteForEveryoneTitle: 'Delete for everyone?',
      deleteForEveryoneText:
        'The message is removed for both of you.',
      deleteForMe: 'Delete for me',
      deleteForMeTitle: 'Delete for me?',
      deleteForMeText: 'The message is hidden for you. The other person keeps it.',
      deleteError: 'The message could not be deleted.',
      deleteForEveryoneError: 'The message could not be deleted for everyone.',
    },

    // unread
    unread: {
      down: 'Scroll to latest',
      unreadCount: '{count} new',
    },

    // errors (mapped from Supabase / network)
    errors: {
      generic: 'Something went wrong. Please try again.',
      network: 'No connection to the server.',
      invalidCredentials: 'Email or password is incorrect.',
      emailNotConfirmed: 'Please confirm your email address before logging in.',
      emailNotFound: 'No account found with this email address.',
      wrongPassword: 'The password is incorrect.',
      emailTaken: 'This email address is already registered.',
      weakPassword: 'The password is too weak.',
      samePassword:
        'The new password must be different from your current password.',
      profileCreate: 'The profile could not be created.',
      noProfile: 'No profile found.',
      usernameTaken: 'This username is already taken.',
      usernameSave: 'The username could not be saved.',
      connectionExists: 'This connection already exists.',
      connectionFailed: 'The request could not be sent.',
      acceptFailed: 'The request could not be accepted.',
      declineFailed: 'The request could not be declined.',
      cancelFailed: 'The request could not be canceled.',
      messageFailed: 'The message could not be sent.',
      notConfigured: 'The connection to the database is not configured.',
      notConfiguredHint:
        'Please create a .env file with VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (see .env.example).',
      sendResetFailed: 'The reset link could not be sent.',
      passwordChangeFailed: 'The password could not be changed.',
      emailChangeFailed: 'The email could not be changed.',
      displayNameFailed: 'The display name could not be saved.',
      searchFailed: 'The search failed.',
      permissionDenied: 'You are not allowed to do that.',
      sessionExpired: 'Your session expired. Please log in again.',
      chatDeleteFailed: 'The chat could not be deleted.',
      notesFailed: 'My Notes could not be set up.',
      blockedRequest: 'This is not possible because of a block.',
      crashTitle: 'Something went wrong.',
      crashHint: 'Please reload the app to continue.',
      reload: 'Reload',
      loadFailed: 'Data could not be loaded.',
      messagesLoadFailed: 'Messages could not be loaded.',
      retry: 'Try again',
    },
  },

  de: {
    brand: 'enough.',
    loading: '…',
    cancel: 'Abbrechen',
    confirm: 'Bestätigen',
    save: 'Speichern',
    saved: 'Gespeichert',
    close: 'Schließen',
    back: 'Zurück',
    settings: 'Einstellungen',
    search: 'Suchen',
    auth: {
      email: 'E-Mail',
      password: 'Passwort',
      confirmPassword: 'Passwort bestätigen',
      username: 'Benutzername',
      displayName: 'Anzeigename',
      login: 'Anmelden',
      register: 'Registrieren',
      registerTitle: 'Konto erstellen',
      noAccount: 'Noch kein Konto?',
      haveAccount: 'Schon ein Konto?',
      forgotPassword: 'Passwort vergessen?',
      passwordMismatch: 'Die Passwörter stimmen nicht überein.',
      usernameInvalid:
        'Benutzernamen haben 3–20 Zeichen: Kleinbuchstaben, Zahlen, Unterstrich.',
      usernameTaken: 'Dieser Benutzername ist bereits vergeben.',
      usernameAvailable: 'Dieser Benutzername ist verfügbar.',
      usernamePermanent:
        'Wähle deinen Benutzernamen sorgfältig – er kann nach der Registrierung nicht mehr geändert werden.',
      checkingUsername: 'Prüfen…',
      usernameRequired: 'Bitte gib einen Benutzernamen ein.',
      displayNameRequired: 'Bitte gib einen Anzeigenamen ein.',
      emailInvalid: 'Bitte gib eine gültige E-Mail-Adresse ein.',
      confirmTitle: 'Prüfe deine E-Mail',
      confirmText:
        'Wir haben einen Bestätigungslink an deine E-Mail-Adresse geschickt. Bitte bestätige ihn und melde dich dann an.',
      confirmResend: 'Bestätigungsmail erneut senden',
      confirmResent: 'Eine neue Bestätigungsmail wurde gesendet.',
      backToLogin: 'Zurück zur Anmeldung',
      forgotTitle: 'Passwort zurücksetzen',
      forgotText: 'Gib deine E-Mail-Adresse ein und wir senden dir einen Link.',
      sendResetLink: 'Link senden',
      resetSent:
        'Wenn zu dieser Adresse ein Konto existiert, ist ein Link unterwegs.',
      resetTitle: 'Neues Passwort',
      resetText: 'Wähle ein neues Passwort für dein Konto.',
      setNewPassword: 'Passwort setzen',
      resetSuccess: 'Dein Passwort wurde geändert.',
      theme: 'Darstellung',
      language: 'Sprache',
    },

    home: {
      nothingHere: 'Noch nichts hier.',
      startChat:
        'Starte einen Chat, indem du in den Einstellungen nach Personen suchst.',
      settingsLabel: 'Einstellungen',
      themeLabel: 'Darstellung wechseln',
    },

    legal: {
      legal: 'Rechtliches',
      imprint: 'Impressum',
      privacy: 'Datenschutzerklärung',
      privacyShort: 'Datenschutz',
      imprintLinkText: 'Zum Impressum',
      privacyLinkText: 'Zur Datenschutzerklärung',
      pursuantTo: 'Angaben gemäß § 5 Digitale-Dienste-Gesetz (DDG)',
      lastUpdated: 'Stand: 19. August 2026',
      templateNoticeTitle: 'Vorlage – vor Veröffentlichung anpassen',
      templateNotice:
        'Ersetze in src/config/imprint.ts alle Angaben in eckigen Klammern durch deine eigenen Daten. Leere optionale Felder werden automatisch ausgeblendet.',
      provider: 'Diensteanbieter',
      representedBy: 'Vertreten durch',
      contact: 'Kontakt',
      email: 'E-Mail',
      phone: 'Telefon',
      registerEntry: 'Registereintrag',
      registerCourt: 'Registergericht',
      registerNumber: 'Registernummer',
      vatId: 'Umsatzsteuer-Identifikationsnummer',
      editoriallyResponsible: 'Redaktionell verantwortlich gemäß § 18 Abs. 2 MStV',
    },

    // contact form
    contact: {
      title: 'Kontaktformular',
      subtitle: 'Sende eine Nachricht an den Betreiber von enough.',
      nameLabel: 'Name (optional)',
      namePlaceholder: 'Dein Name',
      emailLabel: 'E-Mail-Adresse',
      emailPlaceholder: 'du@example.com',
      messageLabel: 'Nachricht',
      messagePlaceholder: 'Schreibe hier deine Nachricht…',
      submit: 'Nachricht senden',
      sending: 'Wird gesendet…',
      success: 'Vielen Dank für deine Nachricht. Sie wurde an den Betreiber übermittelt.',
      sendAnother: 'Weitere Nachricht senden',
      sendFailed: 'Nachricht konnte nicht gesendet werden. Bitte versuche es später erneut oder kontaktiere uns direkt per E-Mail.',
      errorEmailRequired: 'Bitte gib deine E-Mail-Adresse ein.',
      errorEmailInvalid: 'Bitte gib eine gültige E-Mail-Adresse ein.',
      errorMessageRequired: 'Bitte gib eine Nachricht ein.',
      errorMessageTooShort: 'Bitte gib eine Nachricht ein (mindestens 10 Zeichen).',
      errorMessageTooLong: 'Die Nachricht darf maximal 5.000 Zeichen lang sein.',
      errorNameTooLong: 'Der Name darf maximal 100 Zeichen lang sein.',
      privacyNote:
        'Die eingegebenen Daten werden ausschließlich zur Bearbeitung und Beantwortung deiner Anfrage verarbeitet.',
    },

    // privacy policy
    privacy: {
      kicker: 'Datenschutz',
      title: 'Datenschutzerklärung',
      intro:
        'Wie der enough. Messenger personenbezogene Daten verarbeitet — beschrieben am tatsächlichen Verhalten dieser Anwendung.',
      lastUpdated: 'Stand: 5. September 2026',
      tocTitle: 'Inhalt',
      sectionOverviewTitle: '1. Was enough. ist — und was nicht',
      sectionOverviewText:
        'enough. ist ein privater 1:1-Text-Messenger. Du registrierst dich mit einer E-Mail-Adresse, wählst einen dauerhaften @benutzernamen, schickst einer anderen registrierten Person eine Anfrage und schreibst danach Ende-zu-Ende-verschlüsselte Textnachrichten in genau diesem einen Chat. Es gibt keine Gruppenchats, keine Sprach- und Videoanrufe, keinen Feed, keine Beiträge, keine öffentlichen Profilseiten, keine Werbung, keine Analyse und keine Push-Benachrichtigungen — die App fragt zu keinem Zeitpunkt nach einer Browser-Berechtigung für Benachrichtigungen und speichert keine Geräte-Token.',
      sectionOverviewText2:
        'Das hat Folgen für diese Erklärung, und sie stehen deshalb vorn: enough. setzt selbst keine Cookies, lädt keine Skripte, Schriften, Widgets oder Tracking-Pixel von Dritten (die Content-Security-Policy beschränkt die Anfragen auf die Herkunft der App und den Supabase-Endpunkt der Instanz), zeigt deinem Gegenüber keine Lesebestätigungen (dein Lesestatus steht nur in deiner eigenen Zeile und steht nach den Datenbankrichtlinien für niemanden sonst offen), verlangt kein Adressbuch, keine Kamera, kein Mikrofon und keinen Standort, speichert keine Medien und kennt keine Zahlungsdaten, weil der Dienst kostenlos ist. Wo Daten existieren, werden sie in den Abschnitten unten beschrieben; wo eine Verarbeitung, die eine übliche Messenger-Erklärung aufführt, in enough. nicht existiert, beschreiben wir sie bewusst nicht.',
      sectionControllerTitle: '2. Verantwortlicher und Kontakt',
      sectionControllerIntro:
        'Verantwortlicher für die in dieser Erklärung beschriebenen Verarbeitungen im Sinne der DSGVO ist:',
      sectionControllerText:
        'Diese Adresse ist der Ansprechpunkt für Fragen zum Datenschutz, für Anträge nach den Artikeln 15 bis 21 DSGVO und für Beschwerden. Für Sicherheitslücken gibt es zusätzlich die unter /.well-known/security.txt veröffentlichte Meldeadresse.',
      sectionCategoriesTitle: '3. Kategorien personenbezogener Daten',
      sectionCategoriesText:
        'Konto- und Authentifizierungsdaten: E-Mail-Adresse, @benutzername, Anzeigename, Passwort (nur als gehashter Wert in Supabase Auth), eine unveränderliche interne Benutzer-ID, der Zeitpunkt der Kontoanlage sowie die technischen Datensätze, die Supabase Auth für Sitzungen, E-Mail-Bestätigung, E-Mail-Änderung und Passwort-Reset führt.',
      sectionCategoriesText2:
        'Veröffentlichtes Schlüsselmaterial: öffentlicher Identity-Key, Signed-PreKey, One-Time-PreKeys und Post-Quantum-PreKeys (Kyber) — ausschließlich öffentliche Anteile und Signaturen, niemals private Schlüssel. Nachrichteninhalte: in Unterhaltungen mit anderen Personen ausschließlich das opake, verschlüsselte Paket. Verkehrs- und Routing-Metadaten: wer mit wem verbunden ist, Zeitstempel und Größe der Nachrichten, Anfragestatus, dein eigener Lesemarkierer, deine eigenen Löschmarkierer, Blockierungen. Kontaktdaten: was du im Kontaktformular eingibst. Zugriffsdaten beim Frontend-Host: das, was ein statischer Dateiserver üblicherweise sieht (Abschnitt 9).',
      sectionCategoriesText3:
        'Nicht verarbeitet: genauer Standort, Kontakte, Kalender, Fotos, Zahlungsdaten, Werbe-IDs, Nutzungsverhalten für Produktentscheidungen; kein Profiling. Chat-Inhalte stecken in Chiffraten, die der Betreiber nicht lesen kann; das Kontaktformular ist nicht verschlüsselt — schicke dort bitte keine besonderen Kategorien personenbezogener Daten (Art. 9 DSGVO).',
      sectionLegalBasisTitle: '4. Rechtsgrundlagen',
      sectionLegalBasisText:
        'Alles, was zur Bereitstellung des Kontos und des Messengers erforderlich ist — Kontodaten, veröffentlichte öffentliche Schlüssel, Chiffrate, Verkehrs- und Zustell-Metadaten, Lese- und Löschmarkierer — verarbeiten wir auf Grundlage von Art. 6 Abs. 1 lit. b DSGVO (Erfüllung des Nutzungsvertrags). Auch die Löschvorgänge, die du in den Einstellungen auslöst, beruhen auf dieser Grundlage.',
      sectionLegalBasisText2:
        'Verarbeitungen, die der Auslieferung der statischen Web-App, dem technischen Betrieb und der Missbrauchsabwehr dienen, beruhen auf Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einem sicheren, verfügbaren und möglichst sparsam ausgestatteten Dienst). Anfragen über das Kontaktformular behandeln wir nach Art. 6 Abs. 1 lit. f DSGVO, nach Art. 6 Abs. 1 lit. b DSGVO, soweit sie die Begründung oder Durchführung des Nutzungsverhältnisses betreffen.',
      sectionLegalBasisText3:
        'Eine Einwilligung (Art. 6 Abs. 1 lit. a DSGVO) nutzen wir für keine Funktion von enough. — es gibt kein zustimmungspflichtes Tracking, keine Werbung und keine optionale Analyse, die man einschalten könnte — es gibt also auch nichts zu widerrufen. Automatisierte Entscheidungen einschließlich Profiling im Sinne von Art. 22 DSGVO finden nicht statt.',
      sectionAccountTitle: '5. Registrierung, Profil und Anmeldung',
      sectionAccountText:
        'Für die Registrierung brauchst du eine E-Mail-Adresse, ein Passwort, einen @benutzernamen und einen Anzeigenamen. Die E-Mail-Adresse verwenden wir zum Anmelden, für die Bestätigungs-Mail, für eine optionale Adressänderung und für Reset-Links; diese Mails versendet Supabase Auth über den für das Projekt konfigurierten E-Mail-Dienst, der dadurch die Adresse ebenfalls erfährt. Das Passwort selbst geht an Supabase Auth und wird nur als Hash gespeichert — niemals in den Anwendungstabellen. Anzeigename (maximal 60 Zeichen) und @benutzername werden beim Sign-up als Metadaten an Supabase Auth übergeben; ein Trigger in der Datenbank schreibt sie in deine Profilzeile.',
      sectionAccountText2:
        'Sichtbarkeit gegenüber anderen Nutzern: In dieser Instanz kann jede angemeldete Person jede Profilzeile lesen (@benutzername, Anzeigename, interne Benutzer-ID), weil die Suche in den Einstellungen und die Namensanzeige in Chats darauf angewiesen sind. Wer den Anfang deines @benutzernamens tippt, findet dich. Das Registrierungsformular nutzt außerdem eine öffentliche Verfügbarkeitsprüfung, sodass technisch auch ohne Konto testbar ist, ob ein bestimmter @benutzername bereits vergeben ist. Es gibt keine Profilseiten, keine Avatare, keine Biografien, keine Follower-Listen und keine öffentlichen Pinnwände.',
      sectionAccountText3:
        'Den @benutzernamen kannst du nach der Registrierung nicht ändern — wähle ihn also mit Bedacht. Den Anzeigenamen änderst du jederzeit in den Einstellungen; jede Änderung schreibt ein unverschlüsseltes System-Ereignis in jede akzeptierte Unterhaltung, weil die anderen Beteiligten es sehen müssen und nur die Datenbank es für alle gleichzeitig erzeugen kann. Das Registrierungsformular verlangt mindestens 6 Zeichen, und der Authentifizierungsdienst wendet zusätzlich seine eigene Passwortrichtlinie an; Zwei-Faktor-Authentifizierung wird nicht angeboten.',
      sectionE2eeTitle: '6. Ende-zu-Ende-Verschlüsselung, Schlüssel und Metadaten',
      sectionE2eeText:
        'Jede Unterhaltung mit einer anderen Person ist Ende-zu-Ende verschlüsselt. Dein Browser verschlüsselt den Text, bevor etwas übertragen wird, nach dem Signal Protocol — PQXDH-Handshake (X25519 kombiniert mit Kyber-1024-Kapselung) und Double Ratchet — über die festgelegte WebAssembly-Engine @getmaapp/signal-wasm. Was der Server empfängt und in der Spalte messages.ciphertext speichert, ist ein opakes Paket: Das Backend kann den Nachrichtentext nicht lesen und auch nicht sinnvoll verändern, denn Datenbank-Trigger weisen jede Änderung eines gespeicherten Chiffrats zurück, die nicht das Löschen ist. Wenn Verschlüsselung nicht verfügbar ist — ein nicht unterstützter Browser, eine nicht herstellbare Sitzung, ein Konflikt im Sitzungszustand — wird die Nachricht gar nicht gesendet. Es gibt keinen automatischen Rückfall auf Klartext.',
      sectionE2eeMetadata:
        'Was die Verschlüsselung nicht verbirgt: Ende-zu-Ende-Verschlüsselung schützt den Inhalt einer Nachricht, nicht die Metadaten darum. Die Datenbank speichert — und der Betreiber kann deshalb sehen — Absender- und Empfänger-Benutzer-IDs, die Verbindungs-ID, den Zeitstempel und die Byte-Größe jeder Nachricht, den Verbindungsgraphen mit Anfragestatus und Zeitstempeln, die öffentlichen Schlüsselmaterialien aller Konten einschließlich der Information, welcher One-Time-PreKey von wem verbraucht wurde, dazu deine eigenen Lese- und Löschmarkierer und Blockierungen. Während ein Chat offen ist, hält dein Client eine Realtime-Subscription für diese Unterhaltung, sodass die Infrastruktur in diesem Moment sieht, dass ein Client deines Kontos zuhört. Die öffentlichen PreKeys liegen auf dem Server, weil dein Gegenüber sonst keine Sitzung aufbauen könnte, wenn du offline bist.',
      sectionE2eeLimits:
        'Grenzen, die du kennen solltest: enough. bietet keine unabhängige Schlüsselverifikation — keine Sicherheitsnummern und kein QR-Vergleich — die erste Sitzung einer Unterhaltung vertraut daher dem PreKey-Bündel, das das Backend ausliefert (trust on first use). Ende-zu-Ende-Verschlüsselung schützt kein kompromittiertes Gerät: Was du auf dem Bildschirm lesen kannst, können Schadsoftware oder eine bösartige Browser-Erweiterung auch. Pro Konto gibt es genau ein kryptografisches Gerät, und es gibt weder ein Schlüssel-Backup noch eine Wiederherstellungsphrase: Löscht du die Browser-Daten, wechselst den Browser oder verlierst das Gerät, sind die lokalen Schlüssel und der lokale Nachrichtencache weg, ältere Nachrichten bleiben unlesbar, und beim nächsten Besuch entsteht eine neue Identität.',
      sectionE2eeExceptions:
        'Dokumentierte Ausnahmen, die so gewollt sind: Meine Notizen (das persönliche Notizbuch) sind ein Selbst-Chat ohne zweite Person und werden unverschlüsselt in deinen eigenen Datenbankzeilen gespeichert. System-Ereignisse (Namensänderung, akzeptierte Anfrage, gelöschtes Konto) sind unverschlüsselte Metadaten. Auf einer Instanz, auf der es Unterhaltungen schon vor der Aktivierung der Verschlüsselung gab, können diese älteren Zeilen noch Klartext enthalten; sie werden weiterhin als Klartext aus der Vor-Verschlüsselungszeit angezeigt.',
      sectionBackendTitle: '7. Backend-Infrastruktur (Supabase)',
      sectionBackendText:
        'Das Backend dieser Instanz ist ein Supabase-Projekt, und jeder Teil davon, den enough. nutzt, steht hier: Supabase Auth für Registrierung, Anmeldung, E-Mail-Bestätigung und Passwort-Reset; PostgreSQL für Profile, Verbindungen, Nachrichten, Lese- und Löschmarkierer, Blockierungen und die öffentlichen Schlüsselmaterialien; PostgREST als Daten-API auf diesen Tabellen; Row-Level Security plus Datenbank-Trigger als eigentliche Autorisierungsschicht; Supabase Realtime (WebSocket), um neue Zeilen in einen offenen Chat zu liefern; Supabase Edge Functions für genau eine Funktion, das Kontaktformular. Trigger erzeugen zusätzlich die oben genannten System-Ereignisse. Supabase Storage wird nicht genutzt; es gibt keinen Datei- oder Medien-Upload.',
      sectionBackendText2:
        'Das Projekt läuft in der AWS-Region eu-central-1 (Frankfurt am Main, Deutschland). Supabase dokumentiert, dass die primäre Postgres-Datenbank, der Auth-Dienst und Storage-Objekte eines Projekts in der gewählten Region gehostet werden, und dass die Regionenwahl nur den Speicherort festlegt und keinen Nachweis der Einhaltung von Datenschutzvorschriften ersetzt, weil Backups, Logs, die Ausführung von Edge Functions und Sub-Prozessoren weitere Standorte betreffen können. Supabase, Inc. ist in diesem Verhältnis unser Auftragsverarbeiter; das Unternehmen veröffentlicht eine Datenverarbeitungsvereinbarung nach Art. 28 DSGVO (einschließlich EU-Standardvertragsklauseln) und eine Sub-Prozessor-Liste, und der Betreiber ist dafür verantwortlich, diese Vereinbarung abzuschließen und aktuell zu halten.',
      sectionBackendLogs:
        'Zugriffs-, Verbindungs- und Logdaten: Jede Anfrage an die Daten-API, an Auth und an Realtime trägt dein Zugriffs- oder Refresh-Token sowie deine IP-Adresse und hinterlässt in der Netzschicht den angefragten Pfad, die HTTP-Methode, Header, Zeitstempel und Fehlercodes — zur Zustellung, zum Rate-Limiting und zur Missbrauchsabwehr. Für diese technischen Logs veröffentlicht Supabase keine feste Aufbewahrungsfrist, deshalb nennen wir keine; die veröffentlichte Datenverarbeitungsvereinbarung sieht vor, dass die für uns verarbeiteten Daten gelöscht werden, wenn die Plattformvereinbarung endet und eine 30-tägige Exportfrist verstrichen ist. Datenbank-Backups existieren nur, soweit Tarif und Konfiguration des Projekts sie vorsehen — gelöschte Inhalte können deshalb bis zum Ende des Backup-Zeitraums beim Anbieter nachwirkend vorhanden sein.',
      sectionLocalStorageTitle: '8. Daten auf deinem Gerät — und Cookies',
      sectionLocalStorageText:
        'Ein großer Teil des Zustands von enough. liegt auf deinem Gerät, und das ist nicht dasselbe wie Cookies. Die App selbst setzt keinerlei Cookies; keine Funktion hängt an einem Cookie. Verwendet werden stattdessen IndexedDB, LocalStorage, ein einzelner sessionStorage-Wert und der Service-Worker-Cache.',
      sectionLocalStorageText2:
        'IndexedDB (Datenbank „enough-crypto“ mit den Stores für Zustand, PreKeys, Ratchet-Sitzungen und Versiegelungsschlüssel): dein Identitätsschlüsselpaar und PreKey-Material, die Double-Ratchet-Sitzungszustände, der versiegelte Nachrichtencache (der Klartext der auf diesem Gerät gelesenen und geschriebenen Nachrichten, damit sie lesbar bleiben) und die versiegelten Snapshots des Offline-Lesemodus (deine Chat-Übersicht und die letzten 40 Nachrichten eines geöffneten Chats inklusive ihrer Metadaten). All das ist mit AES-256-GCM unter einem nicht exportierbaren Konto-Schlüssel in derselben Datenbank versiegelt; der private Identity-Key ist selbst ein nicht exportierbarer Web-Crypto-Schlüssel. Keiner dieser Werte wird an das Backend übertragen.',
      sectionLocalStorageText3:
        'LocalStorage (unverschlüsselt, nur kleine Werte): Darstellungsmodus („enough-theme“), Sprache („enough-lang“) und die Einstellung „Enter sendet“ („enough-enter-to-send“); deine lokalen Spiegel deiner eigenen Lösch- und Lesemarkierer („enough-deletions-<Benutzer-ID>“ und „enough-read-<Benutzer-ID>“); außerdem die Supabase-Auth-Sitzung unter „sb-<projekt-ref>-auth-token“ mit Access-Token, Refresh-Token und grundlegenden Profildaten sowie der kurzlebige PKCE-Verifier für Registrierung und Passwort-Reset. sessionStorage enthält einen einzigen technischen Marker für Service-Worker-Aktualisierungen. Der Service Worker cached ausschließlich die statischen Dateien der App (HTML, JS, CSS, Icons, Manifest) — keine Nachrichten, keine Token, keine Antworten von anderen Herkunften.',
      sectionLocalStorageText4:
        'Was das für dich bedeutet: Diese Daten liegen bei dir, und der Betreiber kann sie nicht lesen. Du kontrollierst sie über den Browser. „Websitedaten löschen“ meldet dich ab und entfernt unwiderruflich deine Schlüssel und deinen lokalen Nachrichtencache; die Chat-Historie selbst bleibt als Chiffrat in der Datenbank, ist aber ohne diese Schlüssel nicht mehr lesbar. Ein Export oder eine Migration deiner Geräte-Daten ist deshalb ausschließlich etwas, das du selbst tun kannst.',
      sectionHostingTitle: '9. Auslieferung der Web-App (GitHub Pages)',
      sectionHostingText:
        'Das Frontend ist eine statische Web-App (HTML, JavaScript, CSS, Icons, Manifest, Service Worker), ausgeliefert von GitHub Pages über https://hpmine42.github.io/enough/. GitHub Pages ist ein Dienst der GitHub, Inc. und für Nutzer im EWR der GitHub B.V. Für enough. brauchst du kein GitHub-Konto, es findet keine GitHub-Anmeldung statt, und die App liest und schreibt keine GitHub-Kontodaten: Der Browser lädt die Dateien und spricht anschließend den Supabase-Endpunkt der Instanz an.',
      sectionHostingText2:
        'Was GitHub beim Laden der App verarbeitet: GitHub dokumentiert, dass beim Besuch einer GitHub-Pages-Seite die IP-Adresse des Besuchs protokolliert und zu Sicherheitszwecken gespeichert wird — unabhängig davon, ob die Person bei GitHub angemeldet ist. Für jede Auslieferung werden außerdem der angefragte Pfad, der Zeitstempel, die üblichen Request-Header (User-Agent, akzeptierte Kodierungen, ggf. eine Referrer-URL) und der Antwortstatus verarbeitet. Zweck ist die Auslieferung der Dateien und der Schutz der Plattform vor Missbrauch und Überlastung. Rechtsgrundlage unsererseits: Art. 6 Abs. 1 lit. f DSGVO.',
      sectionHostingText3:
        'Speicherdauer: Für diese Zugriffslogs veröffentlicht GitHub keine feste Frist. Das GitHub Privacy Statement beschreibt eine zweckbezogene Aufbewahrung — personenbezogene Daten bleiben gespeichert, solange das Konto aktiv ist und soweit vertragliche Pflichten, gesetzliche Anforderungen, Streitigkeiten und die Durchsetzung von Vereinbarungen es erfordern — weshalb sich für die Auslieferung dieser App keine konkrete Zahl angeben lässt. Zwei weitere Punkte folgen daraus: Bei diesen Zugriffsdaten ist GitHub eigener Verantwortlicher und nicht unser Auftragsverarbeiter, der Betreiber kann diese Logs also weder einsehen noch löschen; und GitHub setzt auf den eigenen Webseiten Cookies, was für die Pages-Auslieferung keine Rolle spielt, für einen Besuch von github.com aber schon.',
      sectionContactTitle: '10. Kontaktformular und E-Mail-Versand (Resend)',
      sectionContactText:
        'Das Kontaktformular befindet sich auf der Impressum-Seite. Wenn du das Formular absendest, verarbeiten wir den (optionalen) Namen (maximal 100 Zeichen), deine E-Mail-Adresse, deine Nachricht (10 bis 5.000 Zeichen) und den Zeitpunkt der Anfrage. Das Formular sendet außerdem ein verstecktes Honeypot-Feld und den Zeitpunkt, zu dem es geöffnet wurde — beides nur zur Erkennung automatisierter Einsendungen. Die Anfrage geht an die Supabase Edge Function send-contact-email, die serverseitig alles erneut prüft, pro IP-Adresse fünf Einsendungen in zehn Minuten zulässt, CRLF- und Steuerzeichen aus Header-Werten entfernt, den Nachrichtentext für den HTML-Teil maskiert und niemals einen Empfänger aus dem Requestbody akzeptiert — der Zielwert steht in einer Server-Konfiguration, die Funktion ist also kein offenes Mail-Relay. Fehlermeldungen sind bewusst allgemein gehalten; lehnt der Mail-Dienst die Nachricht ab, protokolliert die Funktion nur den HTTP-Status, nicht deine Eingabe.',
      sectionContactText2:
        'Die IP-Adresse kommt in diesem Ablauf nur als Schlüssel einer Rate-Limit-Tabelle im Arbeitsspeicher einer Funktionsinstanz vor: Sie wird in keine Datenbanktabelle geschrieben, ist nicht Teil der E-Mail und verschwindet mit dem Ende dieser Instanz. Aus dem Kontaktformular wird nichts in den Chat-Tabellen gespeichert, und für die Nutzung des Formulars ist kein Konto nötig.',
      sectionContactResend:
        'Die Anfrage wird als normale E-Mail zugestellt — Ende-zu-Ende-Verschlüsselung gilt für E-Mail nicht — an das Postfach des Betreibers, über die API des E-Mail-Dienstes Resend; dessen vertragliches Unternehmen ist Plus Five Five, Inc., 2261 Market Street #5039, San Francisco, CA 94114, USA. Resend veröffentlicht für seine eigene Verarbeitung Folgendes: Kundendaten einschließlich Nachrichteninhalt und Zustellungs-Logs werden in den USA gespeichert; solange das Konto des Betreibers aktiv ist, werden E-Mail- und Logdaten in den Standard-Tarifen 30 Tage aufbewahrt; nach einer Beendigung werden verbleibende Kundendaten innerhalb von 90 Tagen gelöscht; Backups werden 7 Tage gehalten; für die frühere Entfernung einer einzelnen Nachricht kann eine Anfrage gestellt werden. Im Postfach des Betreibers bleibt die Anfrage, solange der Austausch sie braucht, und wird danach gelöscht. Antwortadresse ist die von dir angegebene E-Mail-Adresse, Antworten laufen also als normale E-Mail zurück.',
      sectionContactResend2:
        'Zwei Angaben gehören zu diesem Ablauf: Supabase führt eine Edge Function standardmäßig in der Region, die der anfragenden Person am nächsten liegt — das kann außerhalb der EU liegen, sodass Kontaktangaben für die Dauer dieser Anfrage nicht in der EU verbleiben müssen. Und Resend dokumentiert, dass die Sende-Region einer Domain nur das Routing steuert, nicht den Speicherort. Die Übermittlung in die USA stützt sich auf die Datenverarbeitungsvereinbarung von Resend mit EU-Standardvertragsklauseln und zusätzlich auf die Teilnahme von Resend am EU-US Data Privacy Framework, wie von Resend veröffentlicht.',
      sectionRetentionTitle: '11. Wie lange Daten gespeichert werden',
      sectionRetentionText:
        'enough. hat kein Verfallsdatum für Chat-Inhalte: Ein Chiffrat bleibt in der Datenbank, bis es über die App gelöscht wird, und es läuft kein automatischer Aufräumjob. Entsprechend enthält diese Erklärung keine allgemeinen gesetzlichen Aufbewahrungsfristen: Der Dienst ist kostenlos, es gibt also keine Rechnungen und Geschäftsbriefe, und der Betreiber hat kein Beschäftigungs- oder Kundenverhältnis mit dir, aus dem sich Aufbewahrungspflichten ableiten ließen. Daten werden gespeichert, solange sie für den oben genannten Zweck nötig sind — also solange dein Konto besteht — und danach wie in Abschnitt 12 beschrieben entfernt.',
      sectionRetentionText2:
        'Konkrete Fristen für die einzelnen Daten: Offene und abgelehnte Verbindungsanfragen markiert die Datenbank nach 14 Tagen als „abgelaufen“, die Zeile mit Status und Zeitstempeln bleibt aber bestehen, damit eine spätere Anfrage dieselbe Zeile des Paars nutzt. Lesemarkierer sind ein Zeitstempel pro Unterhaltung und bleiben, bis die Verbindung oder das Konto weg ist. Deine One-Time-PreKeys bleiben veröffentlicht, bis sie verbraucht sind, und der Verbrauchsvermerk (welches Konto, wann) bleibt an der Zeile; der Signed-PreKey wird alle 30 Tage rotiert, der vorherige Datensatz bleibt als inaktiv erhalten. Blockierungen bestehen, bis du sie aufhebst oder eines der beiden Konten gelöscht wird. Kontakt-Mails liegen im Postfach des Betreibers und, nach den Angaben von Resend, bis zu 30 Tage in dessen Zustellungs-Logs. Daten auf deinem Gerät bleiben, bis du sie löschst.',
      sectionDeletionTitle: '12. Löschen: Konto, einzelne Nachrichten, ganze Chats',
      sectionDeletionText:
        'Du kannst dein Konto jederzeit selbst löschen, in den Einstellungen → Konto → „Konto löschen“ (Bestätigung durch Eingabe deines @benutzernamens). Dieser Aufruf führt die Datenbankfunktion delete_own_account() aus, die in einer Transaktion ein unverschlüsseltes System-Ereignis „@benutzername hat das Konto gelöscht“ in jede akzeptierte Unterhaltung schreibt, diese Unterhaltungen auf „ended“ setzt, sodass nichts mehr hineingeschrieben werden kann, dein Profil löscht — wodurch dein @benutzername wieder frei wird — und deinen Auth-Datensatz entfernt. Kaskaden löschen danach deine personenbezogenen Zeilen: Lesemarkierer, Löschmarkierer für einzelne Nachrichten, Löschschnitte ganzer Chats, Blockierungen sowie alle deine PreKey- und Geräte-Datensätze. Anschließend entfernt die App den lokalen kryptografischen Zustand und den lokalen Nachrichtencache dieses Kontos auf deinem Gerät und leert die Sitzung. Diese lokale Bereinigung ist ein best-effort-Schritt und läuft erst nach der bestätigten serverseitigen Löschung.',
      sectionDeletionText2:
        'Was die Kontolöschung bewusst nicht tut: Sie löscht nicht die Historie, die deine Partner noch haben. Nachrichten und Verbindungen überleben das Löschen eines Kontos, weil sonst ein einzelner Abschied die Chat-Historie einer anderen Person zerstören würde. Das heißt: Die von dir gesendeten Chiffrate, ihre Zeitstempel und der Verweis auf deine frühere interne Benutzer-ID bleiben in diesen Unterhaltungen, und die entschlüsselten Kopien auf den Geräten deiner Partner bleiben ebenfalls dort — weder du noch der Betreiber können das nachträglich entfernen. Wenn das nötig ist, wende dich an die andere Person, damit sie den Chat oder einzelne Nachrichten dort löscht.',
      sectionDeletionText3:
        'Einzelne Nachrichten: „Für alle löschen“ steht dem Absender 24 Stunden nach dem Senden zur Verfügung und wird in der Datenbank durchgesetzt, nicht nur im Interface: In einem einzigen Update wird das Chiffrat auf einen leeren Wert gesetzt und die Zeile als gelöscht markiert — einmalig, nur vom Absender, nur innerhalb des Zeitfensters, und nicht rückgängig zu machen oder zu bearbeiten. Der Inhalt ist dann aus der Datenbank entfernt, die Restzeile (ID, Unterhaltung, Absender, Zeitstempel) wird beiden Seiten als gelöschte Nachricht angezeigt, weil dein Gegenüber erfahren muss, dass die Nachricht entfernt wurde. Kopien, die der Empfänger lokal gecacht oder entschlüsselt hat, erreicht dieser Vorgang nicht. „Für mich löschen“ lässt den Inhalt für dein Gegenüber unberührt und speichert einen personenbezogenen Löschmarkierer; die Nachricht wird dir nur nicht mehr angezeigt. „Chat für mich löschen“ speichert pro Unterhaltung einen Löschschnitt: Alle Nachrichten bis zu diesem Zeitpunkt sind für dich verborgen, spätere kommen weiter an, und der Schnitt überlebt eine erneute Verbindung mit derselben Person. Meine Notizen lassen sich vollständig leeren; dabei wird der Selbst-Chat samt seiner Nachrichten auf dem Server entfernt.',
      sectionTransfersTitle: '13. Empfänger und Übermittlungen in Drittländer',
      sectionTransfersText:
        'Deine Daten werden nicht verkauft, nicht an Werbetreibende gegeben und gegenüber anderen Nutzern nur so weit offengelegt, wie die Architektur es sichtbar macht. Empfänger sind: Supabase, Inc. (Datenbank, Authentifizierung, Realtime, die Kontaktformular-Funktion); GitHub (Auslieferung der statischen Dateien samt eigener Sub-Prozessoren); der E-Mail-Dienst Resend, vertragliches Unternehmen Plus Five Five, Inc. (Zustellung der Kontakt-Mail); der E-Mail-Anbieter des Betreiber-Postfachs; und soweit der Betreiber gesetzlich zur Offenlegung verpflichtet ist, die zuständige Behörde — bei einem privaten Betreiber läuft das in der Regel über die Verfahren der Anbieter statt über eine Auskunftsroutine bei enough.',
      sectionTransfersText2:
        'Übermittlungen werden pro Empfänger beschrieben statt in einem Pauschalsatz: GitHub — Pages-Auslieferung über die global verteilte Infrastruktur von GitHub mit Sitz in den USA; für eigene Drittlandübermittlungen veröffentlicht GitHub die Selbstzertifizierung nach dem EU-US Data Privacy Framework und Standardvertragsklauseln in seiner Datenvereinbarung. Supabase — primäre Datenbank und Auth-Dienst dieser Instanz liegen in der EU (AWS eu-central-1, Frankfurt), die Messenger-Daten werden also nicht in einem Drittland gespeichert; Supabase, Inc. ist dennoch ein US-Unternehmen, dessen Support- und Plattformbetrieb Zugriffe aus den USA betreffen kann, und die veröffentlichte Datenverarbeitungsvereinbarung von Supabase enthält EU-Standardvertragsklauseln (Modul zwei, soweit relevant Modul drei) für solche Fälle; eine eigenständige Angemessenheits-Zertifizierung von Supabase haben wir nicht geprüft und behaupten sie deshalb nicht. Resend — Speicherung in den USA, Übermittlung auf Basis der Datenverarbeitungsvereinbarung von Resend (SCCs) und zusätzlich dessen DPF-Teilnahme, wie von Resend veröffentlicht. Supabase Edge Functions — die Kontaktformular-Funktion läuft in der Region nahe der anfragenden Person, die ein Drittland sein kann; das folgt aus der gewählten Architektur und wird hier offengelegt statt verschwiegen. Jeder zusätzliche Empfänger oder Tracking-Mechanismus würde vorher eine neue Fassung dieser Erklärung erfordern.',
      sectionSecurityTitle: '14. Sicherheitsmaßnahmen — und was sie nicht abdecken',
      sectionSecurityText:
        'Serverseitig: Autorisierung über Row-Level-Security-Richtlinien und Datenbank-Trigger statt über Prüfungen im Client, kein Service-Role- oder Secret-Key im Browser, fail-closed-Regeln für Authentifizierung und kryptografischen Zustand, Normalisierung und Längenbegrenzung sowohl in der Datenbank als auch im Formular, Eingabehärtung nur an der Klartext-Grenze (gespeicherte Chiffrate werden nie umgeschrieben), HTML-Escaping und CRLF-Filter in der Kontaktformular-Funktion sowie eine Content-Security-Policy ohne Dritt-Herkünfte. Clientseitig: nicht exportierbare Schlüssel, AES-256-GCM-Versiegelung des lokalen Zustands unter kontobezogenen Schlüsseln mit datensatzgebundenen Zusatzdaten, ein atomarer Vergleich-und-Austausch für den Ratchet-Zustand, sodass ein fehlgeschlagener Commit nichts sendet, und eine festgelegte WebAssembly-Krypto-Engine, deren Artefakt-Hashes in der Build-Pipeline geprüft werden.',
      sectionSecurityText2:
        'Nicht abgedeckt: Die Vertraulichkeit auf dem Übertragungsweg hängt an TLS zwischen deinem Browser und GitHub bzw. Supabase; es gibt keine Zwei-Faktor-Authentifizierung, keine Geräte-Attestation und kein verschlüsseltes Backup; Metadaten (wer schreibt wann wie oft mit wem) bleiben vor dem Server nicht verborgen; und gegen ein kompromittiertes oder manipuliertes Gerät hilft keine Verschlüsselung. enough. ist ein kleines privates Projekt: ohne eigenes Sicherheitsteam, ohne externen Penetrationstest, ohne Zertifizierung und ohne veröffentlichtes Bug-Bounty- oder Prämienprogramm — Meldungen gehen an die Kontaktadresse im Impressum oder an /.well-known/security.txt.',
      sectionRightsTitle: '15. Deine Rechte',
      sectionRightsText:
        'Dir stehen das Recht auf Auskunft (Art. 15 DSGVO), auf Berichtigung (Art. 16), auf Löschung (Art. 17), auf Einschränkung der Verarbeitung (Art. 18), auf Datenübertragbarkeit (Art. 20) und auf Widerspruch (Art. 21) DSGVO zu, außerdem das Recht auf Beschwerde bei einer Aufsichtsbehörde (Art. 77 DSGVO). Ein Widerruf ist nicht anwendbar, weil keine Verarbeitung auf einer Einwilligung beruht; ein Widerspruch nach Art. 21 richtet sich gegen die oben beschriebenen berechtigten Interessen, während die Messenger-Nutzung selbst auf dem Vertrag beruht, den du mit der Kontolöschung jederzeit beenden kannst.',
      sectionRightsText2:
        'Wie diese Rechte in einem Ende-zu-Ende-verschlüsselten Messenger praktisch funktionieren: Das meiste kannst du in den Einstellungen selbst erledigen — Anzeigename, E-Mail-Adresse und Passwort sind änderbar, und die Kontolöschung ist der schnellste Weg zur Löschung. Für alles andere schreibe an die Adresse in Abschnitt 2. Bei Auskunfts- oder Übertragbarkeitsanfragen können wir die Datenbankzeilen über dich in strukturierter, maschinenlesbarer Form herausgeben (Profilzeile, Verbindungen, deine Lese-, Lösch- und Blockiermarkierer, deine öffentlichen Schlüsseldatensätze) — aber nicht die Nachrichteninhalte: Der Betreiber hält keine privaten Schlüssel und kann gespeicherte Chiffrate nicht entschlüsseln, und entschlüsselte Kopien existieren nur auf deinem eigenen Gerät. Wo ein Eintrag nur noch als Chiffrat existiert, erfolgt die Löschung durch Entfernen des Kontos oder der Zeile.',
      sectionRightsAuthority:
        'Zuständige Aufsichtsbehörde für den Betreiber in Nordrhein-Westfalen ist: Die Landesbeauftragte für Datenschutz und Informationsfreiheit Nordrhein-Westfalen (LDI NRW), Kavalleriestraße 2–4, 40213 Düsseldorf, Telefon 0211 38424-0, poststelle@ldi.nrw.de, www.ldi.nrw.de. Nach Art. 77 Abs. 1 DSGVO kannst du dich auch an die Aufsichtsbehörde deines gewöhnlichen Aufenthaltsorts, deines Arbeitsorts oder des Ortes der behaupteten Verletzung wenden.',
      sectionChangesTitle: '16. Änderungen dieser Erklärung; andere Instanzen',
      sectionChangesText:
        'Dieser Text beschreibt die Upstream-Instanz von enough., betrieben von dem oben genannten Verantwortlichen. Wenn die App eine Funktion erhält oder entfernt, wird der betroffene Abschnitt umgeschrieben statt um Generikklauseln ergänzt; wesentliche Änderungen erscheinen hier mit neuem Datum oben auf der Seite. Es gibt keinen gesonderten Zustimmungs-Dialog und keine Mitteilung im Chat. Die Erklärung liegt zusammen mit dem beschriebenen Code im öffentlichen Repository.',
      sectionChangesText2:
        'Wenn du enough. selbst hostest, bist du für deine Nutzer eigenständiger Verantwortlicher: Dein Supabase-Projekt, dein Hosting, dein Impressum und deine Datenschutzerklärung gehören dir, und dieser Text ist ein Ausgangspunkt, der an deine tatsächliche Konfiguration angepasst werden muss.',
      referencesLabel: 'Veröffentlichte Quellen für die Anbieterangaben oben',
      refGitHubPrivacy: 'GitHub: Datenschutzerklärung (General Privacy Statement)',
      refGitHubPages: 'GitHub Docs: GitHub Pages und Datenerhebung',
      refSupabaseDpa: 'Supabase: Datenverarbeitungsvereinbarung (DPA)',
      refSupabaseGdpr: 'Supabase Docs: DSGVO-Compliance und Datenspeicherort',
      refResendGdpr: 'Resend: GDPR, Speicherort und Aufbewahrung',
      refSource: 'Quellcode und Dokumentation von enough.',
    },

    settingsScreen: {
      title: 'Einstellungen',
      profile: 'Profil',
      displayName: 'Anzeigename',
      username: 'Benutzername',
      email: 'E-Mail',
      editEmail: 'E-Mail ändern',
      newEmail: 'Neue E-Mail',
      changeEmailSubmit: 'Bestätigungslink senden',
      emailChangeConfirmTitle: 'E-Mail-Adresse ändern?',
      emailChangeConfirmText:
        'Du kannst deine E-Mail-Adresse hier ändern. Nach der Eingabe senden wir einen Bestätigungslink an die neue Adresse. Die Änderung wird erst wirksam, wenn du sie über diesen Link bestätigst.',
      emailChangeSent:
        'Ein Bestätigungslink wurde an die neue Adresse gesendet. Sie wird nach Bestätigung aktiv.',
      changePassword: 'Passwort ändern',
      changePasswordConfirmTitle: 'Passwort ändern?',
      changePasswordConfirmText:
        'Bestätige zuerst dein aktuelles Passwort, bevor du ein neues festlegst.',
      currentPassword: 'Aktuelles Passwort',
      newPassword: 'Neues Passwort',
      changePasswordSubmit: 'Passwort ändern',
      passwordChanged: 'Dein Passwort wurde geändert.',
      people: 'Personen',
      activeConnections: 'Aktive Verbindungen',
      activeConnectionsEmpty: 'Noch keine aktiven Verbindungen.',
      searchPeople: 'Personen suchen',
      searchPlaceholder: 'Nach @benutzername suchen',
      searchEmpty: 'Gib einen Benutzernamen ein, um Personen zu finden.',
      searchNoResults: 'Keine Person gefunden.',
      language: 'Sprache',
      appearance: 'Darstellung',
      light: 'Hell',
      dark: 'Dunkel',
      system: 'System',
      chat: 'Chat',
      enterToSend: 'Enter zum Senden',
      enterToSendHint: 'Enter sendet die Nachricht. Shift + Enter fügt eine Zeile ein.',
      myNotes: 'Meine Notizen',
      myNotesHint: 'Ein privater Chat mit dir selbst.',
      myNotesError: 'Meine Notizen konnten nicht eingerichtet werden.',
      myNotesUpgradeRequired:
        'Meine Notizen benötigen das aktuelle Datenbank-Update (Migrationen 0003 und 0005).',
      account: 'Konto',
      signOut: 'Abmelden',
      signOutTitle: 'Abmelden?',
      signOutText: 'Du musst dich wieder anmelden, um enough. zu nutzen.',
      deleteAccount: 'Konto löschen',
      deleteAccountHint: 'Dein Konto dauerhaft löschen.',
      deleteAccountTitle: 'Konto löschen?',
      deleteAccountText:
        'Das löscht dein Konto dauerhaft und kann nicht rückgängig gemacht werden. Dein Benutzername wird wieder frei. Deine Chats bleiben für die andere Person sichtbar, aber sie kann dir nicht mehr schreiben.',
      deleteAccountConfirm: 'Konto löschen',
      deleteAccountTypeHint: 'Gib {username} ein, um zu bestätigen.',
      footer: 'Version',
      github: 'GitHub',
    },

    connection: {
      requestTitle: 'Verbindungsanfrage',
      requestInfo:
        'Du kannst erst antworten, wenn du die Anfrage angenommen hast.',
      requestInfoLabel: 'Details zur Verbindungsanfrage',
      accept: 'Annehmen',
      decline: 'Ablehnen',
      cancelRequest: 'Anfrage zurückziehen',
      requestSent: 'Anfrage gesendet',
      requestDeclined: 'Anfrage abgelehnt',
      requestDeclinedNote: 'Die Anfrage läuft am {date} ab.',
      requestExpired: 'Anfrage abgelaufen',
      requestAgain: 'Erneut anfragen',
      requestCanceled: 'Anfrage zurückgezogen',
      declinedTitle: 'Anfrage ablehnen?',
      declinedText:
        'Wenn du ablehnst, kann diese Person innerhalb der nächsten 14 Tage erneut anfragen. Mit „Ablehnen und blockieren“ kann sie dir erst wieder Anfragen senden, wenn du sie freigibst.',
      accepted: 'Verbunden',
      ended: 'Verbindung beendet',
    },

    // blocking
    block: {
      title: 'Blockierte Nutzer',
      hint: 'Verwalte, wer dir Anfragen und Nachrichten senden darf.',
      empty: 'Du hast niemanden blockiert.',
      status: 'Blockiert',
      unblock: 'Freigeben',
      blockUser: 'Nutzer blockieren',
      blockTitle: '@{username} blockieren?',
      blockText:
        'Diese Person kann dir bis zur Freigabe keine Nachrichten oder Verbindungsanfragen mehr senden.',
      declineAndBlock: 'Ablehnen und blockieren',
      byYou:
        'Du hast diesen Nutzer blockiert. Du kannst ihn in den Einstellungen wieder freigeben.',
      byThem:
        'Dieser Nutzer hat dich blockiert. Du kannst ihm erst wieder eine Anfrage senden, wenn er dich freigibt.',
      blockedByYouChat:
        'Du hast diesen Nutzer blockiert. Gib ihn frei, um wieder zu schreiben.',
      blockedByThemChat:
        'Du wurdest blockiert. Du kannst erst wieder schreiben, wenn dieser Nutzer dich freigibt.',
    },

    // offline read mode (v0.3.x)
    offline: {
      banner: 'Du bist offline. Es werden lokal gespeicherte Daten angezeigt.',
      unreachable: 'Keine Verbindung zum Server. Es werden lokal gespeicherte Daten angezeigt.',
      composerDisabled: 'Du bist offline. Nachrichten können wieder gesendet werden, sobald du online bist.',
      actionUnavailable: 'Offline nicht verfügbar.',
      noCachedChat: 'Diese Unterhaltung ist offline nicht verfügbar.',
      olderUnavailable: 'Ältere Nachrichten sind offline nicht verfügbar.',
    },

    chat: {
      backLabel: 'Zurück',
      composerPlaceholder: 'Nachricht',
      sendLabel: 'Senden',
      unavailable: 'Diese Unterhaltung ist nicht verfügbar.',
      deletedForEveryoneSelf: 'Du hast diese Nachricht gelöscht.',
      deletedForEveryoneOther: '@{username} hat diese Nachricht gelöscht.',
      nameChange: '{old} heißt jetzt {new}.',
      acceptedConnection: '@{username} hat deine Verbindungsanfrage angenommen.',
      acceptedConnectionSelf: 'Du hast die Verbindungsanfrage angenommen.',
      deletedAccount: 'Gelöschtes Konto',
      deletedAccountMessage: '@{username} hat sein Konto gelöscht.',
      deletedAccountNote:
        'Dieses Konto wurde gelöscht. Du kannst dieser Person nicht mehr schreiben.',
      noMessages: 'Noch keine Nachrichten.',
      loadingOlder: 'Laden…',
      you: 'Du',
      encryptedPreview: 'Verschlüsselte Nachricht',
      undecryptable: 'Diese Nachricht konnte nicht entschlüsselt werden.',
      e2eeUnavailable:
        'Sichere Nachrichten sind in diesem Browser nicht verfügbar. Aktualisiere oder öffne die App erneut, um Nachrichten zu senden.',
      e2eeFailed: 'Die Nachricht konnte nicht verschlüsselt werden und wurde nicht gesendet.',
      deleteChatForMe: 'Chat für mich löschen',
      deleteChatConfirmTitle: 'Chat löschen?',
      deleteChatConfirmText:
        'Wenn du diesen Chat löschst, verschwindet der gesamte bisherige Chatverlauf für dich. Beim anderen Benutzer bleibt der Verlauf erhalten. Eine spätere neue Verbindung stellt den für dich entfernten Verlauf nicht wieder her.',
      chatDeleted: 'Der Chat wurde für dich gelöscht.',
      newMessages: 'Neue Nachrichten',
      myNotesClearTitle: 'Diesen Chat leeren und Meine Notizen deaktivieren?',
      myNotesClearText:
        'Du kannst Meine Notizen später in den Einstellungen wieder aktivieren.',
      myNotesTag: 'Privat',
    },

    message: {
      copy: 'Kopieren',
      copied: 'Kopiert',
      deleteForEveryone: 'Für alle löschen',
      deleteForEveryoneTitle: 'Für alle löschen?',
      deleteForEveryoneText:
        'Die Nachricht wird für euch beide entfernt.',
      deleteForMe: 'Für mich löschen',
      deleteForMeTitle: 'Für mich löschen?',
      deleteForMeText: 'Die Nachricht wird für dich ausgeblendet. Die andere Person behält sie.',
      deleteError: 'Die Nachricht konnte nicht gelöscht werden.',
      deleteForEveryoneError: 'Die Nachricht konnte nicht für alle gelöscht werden.',
    },

    unread: {
      down: 'Nach unten scrollen',
      unreadCount: '{count} neu',
    },

    errors: {
      generic: 'Etwas ist schiefgelaufen. Bitte versuche es erneut.',
      network: 'Keine Verbindung zum Server.',
      invalidCredentials: 'E-Mail oder Passwort ist falsch.',
      emailNotConfirmed: 'Bitte bestätige zuerst deine E-Mail-Adresse.',
      emailNotFound: 'Kein Konto mit dieser E-Mail-Adresse gefunden.',
      wrongPassword: 'Das Passwort ist falsch.',
      emailTaken: 'Diese E-Mail-Adresse ist bereits registriert.',
      weakPassword: 'Das Passwort ist zu schwach.',
      samePassword:
        'Das neue Passwort muss sich vom bisherigen Passwort unterscheiden.',
      profileCreate: 'Das Profil konnte nicht erstellt werden.',
      noProfile: 'Kein Profil gefunden.',
      usernameTaken: 'Dieser Benutzername ist bereits vergeben.',
      usernameSave: 'Der Benutzername konnte nicht gespeichert werden.',
      connectionExists: 'Diese Verbindung besteht bereits.',
      connectionFailed: 'Die Anfrage konnte nicht gesendet werden.',
      acceptFailed: 'Die Anfrage konnte nicht angenommen werden.',
      declineFailed: 'Die Anfrage konnte nicht abgelehnt werden.',
      cancelFailed: 'Die Anfrage konnte nicht zurückgezogen werden.',
      messageFailed: 'Die Nachricht konnte nicht gesendet werden.',
      notConfigured: 'Die Verbindung zur Datenbank ist nicht konfiguriert.',
      notConfiguredHint:
        'Bitte lege eine .env-Datei mit VITE_SUPABASE_URL und VITE_SUPABASE_PUBLISHABLE_KEY an (siehe .env.example).',
      sendResetFailed: 'Der Link konnte nicht gesendet werden.',
      passwordChangeFailed: 'Das Passwort konnte nicht geändert werden.',
      emailChangeFailed: 'Die E-Mail konnte nicht geändert werden.',
      displayNameFailed: 'Der Anzeigename konnte nicht gespeichert werden.',
      searchFailed: 'Die Suche ist fehlgeschlagen.',
      permissionDenied: 'Dazu bist du nicht berechtigt.',
      sessionExpired: 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.',
      chatDeleteFailed: 'Der Chat konnte nicht gelöscht werden.',
      notesFailed: 'Meine Notizen konnten nicht eingerichtet werden.',
      blockedRequest: 'Das ist wegen einer Blockierung nicht möglich.',
      crashTitle: 'Etwas ist schiefgelaufen.',
      crashHint: 'Bitte lade die App neu, um fortzufahren.',
      reload: 'Neu laden',
      loadFailed: 'Daten konnten nicht geladen werden.',
      messagesLoadFailed: 'Nachrichten konnten nicht geladen werden.',
      retry: 'Erneut versuchen',
    },
  },
} as const;
