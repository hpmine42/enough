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
  providerName: 'Jakob Gregory',

  address: {
    street: 'Schwalbstraße 5',
    postalCode: '53332',
    city: 'Bornheim',
    country: 'Deutschland',
  },

  contact: {
    email: 'hpmine@web.de',
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
