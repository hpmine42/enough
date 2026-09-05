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
      intro: 'Information on the processing of personal data in the enough. messenger.',
      lastUpdated: 'Last updated: 5 September 2026',

      sectionOverviewTitle: '1. Overview and Core Principles',
      sectionOverviewText:
        'enough. is designed with a radical focus on privacy and data minimization ("Less, but enough."). We do not track users, do not use analytics or tracking cookies, display no advertisements, and do not request browser notification permissions. Peer-to-peer conversations are end-to-end encrypted so that nobody — including the operator and hosting provider — can read your peer messages.',

      sectionControllerTitle: '2. Controller and Contact',
      sectionControllerIntro: 'The controller responsible for data processing in connection with this service is:',

      sectionAccountTitle: '3. Account and Profile Data',
      sectionAccountText:
        'When you register an account, we process your email address, chosen @username, optional display name, and password. Passwords are cryptographically hashed using bcrypt via Supabase Auth and are never stored or visible in plaintext. Your @username and display name are visible to other registered users when they search for you or communicate with you. Your internal user ID, username, and account creation date are immutable.',

      sectionE2eeTitle: '4. End-to-End Encryption (E2EE)',
      sectionE2eeText:
        'All one-to-one peer conversations are end-to-end encrypted using the Signal Protocol (PQXDH and Double Ratchet with post-quantum Kyber-1024 key encapsulation) via @getmaapp/signal-wasm. Messages are encrypted in your browser before transmission. The server receives and persists only opaque ciphertext envelopes. Private cryptographic keys never leave your device. Public cryptographic prekeys (identity public keys, signed prekeys, one-time prekeys, and Kyber prekeys) are stored on the server to enable asynchronous session handshakes.',
      sectionE2eeExceptions:
        'Documented exceptions: "My Notes" (the personal self-notepad chat) stores notes in plaintext on the database since there is no second participant. System events (e.g. notifications when a contact changes their display name or deletes their account) contain non-confidential metadata only.',

      sectionLocalStorageTitle: '5. Local Storage and IndexedDB',
      sectionLocalStorageText:
        'Your cryptographic identity, private prekeys, Double Ratchet session states, and decrypted message history are stored locally in your browser\'s IndexedDB (database "enough-crypto") and sealed with AES-256-GCM under a non-extractable device key. Offline Read Mode stores sealed local snapshots of your recent conversations and messages so you can read them without network connectivity. LocalStorage is strictly used for non-sensitive UI preferences (theme mode and selected language).',

      sectionBackendTitle: '6. Backend, Database and Realtime',
      sectionBackendText:
        'The backend infrastructure is provided via Supabase (PostgreSQL database, Supabase Auth, PostgREST API, and WebSockets for Realtime updates). Strict Row-Level Security (RLS) policies and database triggers ensure that users can only access data belonging to their own account and active connections.',

      sectionContactTitle: '7. Contact Form and Email Communication',
      sectionContactText:
        'If you submit a message through the contact form on the Imprint page, your name (if provided), email address, and message text are processed server-side via a secure edge function to deliver your inquiry to the operator via email. Inquiries are not permanently stored in the messenger database.',

      sectionDeletionTitle: '8. Data Retention and Account Deletion',
      sectionDeletionText:
        'You can delete your account at any time in the settings ("Delete Account"). Deleting your account removes your profile, frees your @username for new registrations, cascades your authentication record, marks existing chats with peers as ended, and removes your local cryptographic keys and cached data from the device. "Delete for everyone" clears message content on the server within 24 hours. "Delete for me" hides messages locally for your account.',

      sectionRightsTitle: '9. Data Subject Rights (GDPR)',
      sectionRightsText:
        'Under the European General Data Protection Regulation (GDPR), you have the right to access (Art. 15), rectification (Art. 16), erasure (Art. 17), restriction of processing (Art. 18), data portability (Art. 20), and objection (Art. 21). You also have the right to lodge a complaint with a competent data protection supervisory authority.',
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
      intro: 'Informationen über die Verarbeitung personenbezogener Daten im enough. Messenger.',
      lastUpdated: 'Stand: 5. September 2026',

      sectionOverviewTitle: '1. Überblick und Grundsätze',
      sectionOverviewText:
        'enough. basiert auf dem Grundsatz der Datenminimierung („Weniger, aber genug.“). Wir betreiben kein Tracking, setzen keine Analyse- oder Werbe-Cookies ein, blenden keine Werbung ein und fordern keine Browser-Berechtigungen für Push-Benachrichtigungen an. Alle 1:1-Chats zwischen Nutzern sind Ende-zu-Ende verschlüsselt, sodass niemand — auch nicht der Betreiber oder Hosting-Anbieter — deine Chat-Inhalte mitlesen kann.',

      sectionControllerTitle: '2. Verantwortlicher und Kontakt',
      sectionControllerIntro: 'Verantwortlicher für die Datenverarbeitung im Sinne der Datenschutz-Grundverordnung (DSGVO) ist:',

      sectionAccountTitle: '3. Account- und Profildaten',
      sectionAccountText:
        'Bei der Registrierung verarbeiten wir deine E-Mail-Adresse, deinen gewählten @username, einen optionalen Anzeigenamen sowie dein Passwort. Passwörter werden über Supabase Auth mittels bcrypt kryptografisch gehasht und niemals im Klartext gespeichert. Dein @username und dein Anzeigename sind für andere registrierte Nutzer bei der Suche und in Konversationen sichtbar. Die interne User-ID, der Username und das Erstellungsdatum sind unveränderlich.',

      sectionE2eeTitle: '4. Ende-zu-Ende-Verschlüsselung (E2EE)',
      sectionE2eeText:
        'Alle 1:1-Peer-Konversationen sind mittels Signal-Protokoll (PQXDH und Double Ratchet mit Post-Quantum Kyber-1024 Key Encapsulation via @getmaapp/signal-wasm) Ende-zu-Ende verschlüsselt. Nachrichten werden direkt im Browser vor dem Absenden verschlüsselt. Der Server speichert für Peer-Nachrichten ausschließlich opake Chiffrate. Private Schlüssel verlassen niemals dein Endgerät. Öffentliche PreKey-Materialien (Identity-Keys, Signed-PreKeys, One-Time-PreKeys, Kyber-PreKeys) werden auf dem Server bereitgestellt, um asynchrone Handshakes zu ermöglichen.',
      sectionE2eeExceptions:
        'Dokumentierte Ausnahmen: „My Notes“ (der persönliche Notiz-Chat) speichert Notizen im Klartext in der Datenbank, da kein zweiter Kommunikationspartner existiert. System-Ereignisse (z. B. wenn ein Kontakt seinen Namen ändert oder sein Konto löscht) enthalten ausschließlich unkritische Metadaten.',

      sectionLocalStorageTitle: '5. Lokale Speicherung und IndexedDB',
      sectionLocalStorageText:
        'Deine kryptografische Identität, privaten Schlüssel, Ratchet-Zustände und entschlüsselten Nachrichten werden lokal in der IndexedDB deines Browsers (Datenbank „enough-crypto“) gespeichert und mittels AES-256-GCM versiegelt. Der Offline Read Mode speichert versiegelte lokale Snapshots der Chat-Übersicht und der letzten 40 Nachrichten pro Konversation. Der LocalStorage wird ausschließlich für unkritische UI-Einstellungen (Darstellungsmodus und Sprachauswahl) verwendet.',

      sectionBackendTitle: '6. Backend, Datenbank und Realtime',
      sectionBackendText:
        'Die Backend-Infrastruktur wird über Supabase bereitgestellt (PostgreSQL-Datenbank, Supabase Auth, PostgREST-API und WebSockets für Realtime-Aktualisierungen). Strikte Row-Level-Security-Richtlinien (RLS) und Datenbank-Trigger stellen sicher, dass Nutzer nur auf Daten ihres eigenen Kontos und aktiver Verbindungen zugreifen können.',

      sectionContactTitle: '7. Kontaktformular und E-Mail-Kommunikation',
      sectionContactText:
        'Wenn du das Kontaktformular im Impressum nutzt, werden dein Name (optional), deine E-Mail-Adresse und deine Nachricht serverseitig über eine Edge Function verarbeitet, um dein Anliegen per E-Mail an den Betreiber zu übermitteln. Die Anfragen werden nicht dauerhaft in der Messenger-Datenbank gespeichert.',

      sectionDeletionTitle: '8. Datenlöschung und Account-Löschung',
      sectionDeletionText:
        'Du kannst dein Konto jederzeit in den Einstellungen löschen („Konto löschen“). Dadurch wird dein Profil entfernt, der @username für Neuregistrierungen freigegeben, dein Auth-Eintrag gelöscht, bestehende Chats mit Kontakten als beendet markiert und alle lokalen kryptografischen Schlüssel sowie gespeicherten Daten vom Endgerät entfernt. „Für alle löschen“ entfernt Nachrichteninhalte innerhalb von 24 Stunden auf dem Server. „Für mich löschen“ verbirgt Nachrichten nur lokal.',

      sectionRightsTitle: '9. Betroffenenrechte (DSGVO)',
      sectionRightsText:
        'Nach der DSGVO hast du das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch (Art. 21). Zudem steht dir ein Beschwerderecht bei einer zuständigen Datenschutz-Aufsichtsbehörde zu.',
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
