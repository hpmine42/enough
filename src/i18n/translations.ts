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
      pursuantTo: 'Information pursuant to Section 5 of the German Digital Services Act (DDG)',
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
        'You cannot message each other after declining. The request attempt stays visible for 14 days.',
      accepted: 'Accepted',
      ended: 'Connection ended',
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
      deleteChatForMe: 'Delete chat for me',
      deleteChatConfirmTitle: 'Delete chat?',
      deleteChatConfirmText:
        'The chat is deleted for you. The other person keeps their copy.',
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
      pursuantTo: 'Angaben gemäß § 5 Digitale-Dienste-Gesetz (DDG)',
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
        'Ihr könnt euch danach nicht schreiben. Die Anfrage bleibt 14 Tage sichtbar.',
      accepted: 'Verbunden',
      ended: 'Verbindung beendet',
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
      deleteChatForMe: 'Chat für mich löschen',
      deleteChatConfirmTitle: 'Chat löschen?',
      deleteChatConfirmText:
        'Der Chat wird für dich gelöscht. Die andere Person behält ihren Verlauf.',
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
    },
  },
} as const;
