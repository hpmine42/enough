/**
 * Public imprint details.
 *
 * Replace every value in square brackets before publishing. The optional
 * fields below are only rendered when they contain a value.
 *
 * This template covers common details for a German imprint, but the exact
 * requirements depend on the operator and the service. Have the completed
 * text checked if you are unsure which information applies to you.
 */
export const imprintConfig = {
  providerName: '[Vor- und Nachname oder vollständiger Firmenname]',

  address: {
    street: '[Straße und Hausnummer]',
    postalCode: '[PLZ]',
    city: '[Ort]',
    country: 'Deutschland',
  },

  contact: {
    email: '[deine E-Mail-Adresse]',
    phone: '[deine Telefonnummer]',
  },

  // For companies or organizations, for example: "Max Mustermann"
  representedBy: '',

  // Complete these fields only if the provider is entered in a register.
  register: {
    name: '', // e.g. "Handelsregister"
    court: '', // e.g. "Amtsgericht Berlin-Charlottenburg"
    number: '', // e.g. "HRB 123456 B"
  },

  // Complete only if a VAT identification number has been issued.
  vatId: '',

  // Complete only if § 18(2) MStV applies to editorial/journalistic content.
  editoriallyResponsible: {
    name: '',
    address: '',
  },
} as const;
