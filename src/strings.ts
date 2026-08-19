/**
 * Every user-visible string in the app.
 *
 * §2 requires this file so Malayalam can be added later "without touching components".
 * The contract components rely on: import `t` and read a key. Nothing else in `src/` or
 * `app/` should contain an English sentence destined for the screen.
 *
 * v1 ships English only (§15.4). Adding a language means adding a dictionary below and a
 * way to pick it — no component changes.
 */

export type Locale = 'en' | 'ml';

const en = {
  appName: 'CraftyDocs',

  // Navigation / tabs
  tabHome: 'Home',
  tabDocuments: 'Documents',
  tabClients: 'Clients',
  tabMore: 'More',

  // Generic actions
  save: 'Save',
  saved: 'Saved',
  cancel: 'Cancel',
  done: 'Done',
  delete: 'Delete',
  edit: 'Edit',
  add: 'Add',
  close: 'Close',
  retry: 'Try again',
  undo: 'Undo',
  search: 'Search',
  clear: 'Clear',
  remove: 'Remove',
  replace: 'Replace',
  optional: 'optional',
  none: 'None',
  all: 'All',
  copyDetails: 'Copy details',
  archive: 'Archive',
  unarchive: 'Restore',
  confirm: 'Confirm',

  // Home
  homeNewQuotation: 'New Quotation',
  homeNewInvoice: 'New Invoice',
  homeNewReceipt: 'New Receipt',
  homeQuotationsPending: 'Quotations pending',
  homeInvoicesUnpaid: 'Invoices unpaid',
  homeOutstanding: 'Total outstanding',
  homeRecent: 'Recent',
  homeNoRecent: 'Nothing here yet. Create your first document above.',
  homeCompleteProfile: 'Add your business details so they appear on every document.',
  homeCompleteProfileAction: 'Complete profile',

  // Document types
  quotation: 'Quotation',
  invoice: 'Invoice',
  receipt: 'Receipt',
  quotations: 'Quotations',
  invoices: 'Invoices',
  receipts: 'Receipts',

  // Editor sections
  editorHeader: 'Details',
  editorClient: 'Client',
  editorItems: 'Items',
  editorCharges: 'Discount, tax & charges',
  editorPayment: 'Payment received',
  editorNotes: 'Notes',
  editorTerms: 'Terms & conditions',
  editorCustomFields: 'Extra fields',
  editorBlocks: "What's included",

  documentNumber: 'Number',
  numberNotYetAssigned: 'Assigned when you share or send this',
  numberNext: 'next',
  numberOverride: 'Set number manually',
  numberDuplicateWarning: 'This number is already used by another document of this type.',
  issueDate: 'Issue date',
  validUntil: 'Valid until',
  dueDate: 'Due date',
  paymentDate: 'Payment date',

  clientPick: 'Choose a client',
  clientNone: 'No client / walk-in',
  clientNoneHint: 'The client block is left off this document.',
  clientAddNew: 'Add a new client',
  clientSearch: 'Search clients',
  clientEmpty: 'No clients yet.',

  itemsAddFromCatalogue: 'Add from catalogue',
  itemsAddCustom: 'Add custom line',
  itemsEmpty: 'No items yet. Add one to get started.',
  itemsPriceMode: 'Price mode',
  itemsPriceModeCatalogue: 'Catalogue',
  itemsPriceModeManual: 'Manual',
  itemName: 'Description',
  itemQty: 'Qty',
  itemUnit: 'Unit',
  itemRate: 'Rate',
  itemAmount: 'Amount',
  itemDiscount: 'Line discount',
  itemTax: 'Tax',
  itemHsn: 'HSN/SAC',
  itemFree: 'Mark as complimentary',
  itemFreeLabel: 'FREE',
  itemBadgeAuto: 'Catalogue price',
  itemBadgeEdited: 'Edited',
  itemBadgeCustom: 'Custom',
  itemUpdateCatalogue: 'Update catalogue price to {amount}?',
  itemUpdateCatalogueDone: 'Catalogue price updated.',
  itemDeleted: 'Line removed.',

  chargesDiscount: 'Discount',
  chargesDiscountNone: 'No discount',
  chargesDiscountPercent: 'Percentage',
  chargesDiscountAmount: 'Fixed amount',
  chargesShipping: 'Delivery / shipping',
  chargesTaxMode: 'Tax',
  chargesTaxNone: 'No tax',
  chargesTaxIntra: 'CGST + SGST (same state)',
  chargesTaxInter: 'IGST (other state)',
  chargesTaxFlat: 'Single tax rate',
  chargesRoundOff: 'Round off to the nearest rupee',

  totalsSubtotal: 'Subtotal',
  totalsDiscount: 'Discount',
  totalsTaxable: 'Taxable value',
  totalsCgst: 'CGST',
  totalsSgst: 'SGST',
  totalsIgst: 'IGST',
  totalsTax: 'Tax',
  totalsShipping: 'Delivery',
  totalsRoundOff: 'Round off',
  totalsGrand: 'Total',
  totalsPaid: 'Received',
  totalsBalance: 'Balance due',
  totalsInWords: 'Amount in words',

  preview: 'Preview',
  export: 'Share / Export',
  exportFormat: 'Format',
  exportPdf: 'PDF',
  exportDocx: 'Word (DOCX)',
  exportImage: 'Image',
  exportTemplate: 'Template',
  exportShare: 'Share',
  exportSave: 'Save to Downloads',
  exportPrint: 'Print',
  exportWorking: 'Preparing your document…',
  exportSavedTo: 'Saved to your Downloads folder.',
  exportFailed: 'Could not create the file.',
  exportNoItems: 'Add at least one item before exporting.',
  exportImageJpg: 'Use JPG (smaller, better for WhatsApp)',

  // Status
  statusDraft: 'Draft',
  statusSent: 'Sent',
  statusAccepted: 'Accepted',
  statusRejected: 'Rejected',
  statusExpired: 'Expired',
  statusPartiallyPaid: 'Part paid',
  statusPaid: 'Paid',
  statusOverdue: 'Overdue',
  statusCancelled: 'Cancelled',
  statusIssued: 'Issued',
  markAsSent: 'Mark as sent',
  markAsAccepted: 'Mark as accepted',
  markAsRejected: 'Mark as rejected',
  markAsIssued: 'Issue receipt',
  cancelDocument: 'Cancel document',

  // Conversions
  convertToInvoice: 'Create invoice from this',
  convertToReceipt: 'Record payment & create receipt',
  duplicate: 'Duplicate',
  convertedFrom: 'Created from',
  convertedTo: 'Led to',

  // Payments
  paymentAmount: 'Amount received',
  paymentMethod: 'Method',
  paymentReference: 'Reference / UTR / cheque no.',
  paymentMethodCash: 'Cash',
  paymentMethodUpi: 'UPI',
  paymentMethodBank: 'Bank transfer',
  paymentMethodCheque: 'Cheque',
  paymentMethodCard: 'Card',
  paymentMethodOther: 'Other',
  paymentsRecorded: 'Payments recorded',
  paymentAdd: 'Record a payment',

  // Documents list
  documentsSearch: 'Search number, client or item',
  documentsEmpty: 'No documents match this filter.',
  documentsSortDate: 'Date',
  documentsSortAmount: 'Amount',
  documentsFilterFrom: 'From',
  documentsFilterTo: 'To',

  // Onboarding / business
  onboardingWelcome: 'Welcome',
  onboardingIntro:
    'Set up your business once and it appears on every quotation, invoice and receipt you make.',
  onboardingStart: 'Get started',
  onboardingSkip: 'Skip for now',
  businessName: 'Business name',
  businessTagline: 'Tagline',
  businessAddress: 'Address',
  businessAddressLine1: 'Address line 1',
  businessAddressLine2: 'Address line 2',
  businessCity: 'City',
  businessState: 'State',
  businessPincode: 'PIN code',
  businessPhone: 'Phone',
  businessEmail: 'Email',
  businessWebsite: 'Website',
  businessGstin: 'GSTIN',
  businessGstinHint: 'Leave blank if you are not GST registered — no GST fields will appear.',
  businessGstinInvalid: 'This does not look like a valid GSTIN. You can still save it.',
  businessPan: 'PAN',
  businessBank: 'Bank details',
  bankName: 'Bank name',
  bankAccountName: 'Account name',
  bankAccountNo: 'Account number',
  bankIfsc: 'IFSC',
  upiId: 'UPI ID',
  upiQrToggle: 'Show a UPI payment QR on invoices',

  // Logo & signature
  logo: 'Logo',
  logoAdd: 'Add your logo',
  logoPickGallery: 'Choose from gallery',
  logoPickCamera: 'Take a photo',
  logoTooLarge: 'That image is larger than 8 MB. Please choose a smaller one.',
  logoUnsupported: 'Please choose a PNG, JPG or WebP image.',
  signature: 'Signature',
  signatureDraw: 'Draw it',
  signatureUpload: 'Upload a photo',
  signatureDrawHint: 'Sign with your finger in the box below.',
  signatureUse: 'Use this signature',
  signatureClear: 'Clear',
  signatureRemoveBackground: 'Remove the paper background',
  signatureThreshold: 'Background removal',
  signatureLabel: 'Signature label',
  signatureNone: 'No signature yet — documents will print a blank signing line.',

  // Catalogue
  catalogue: 'Item & service catalogue',
  catalogueAdd: 'Add an item',
  catalogueEmpty: 'Your catalogue is empty.',
  catalogueSearch: 'Search the catalogue',
  catalogueFavourite: 'Favourite',
  catalogueDefaultRate: 'Default rate',
  catalogueCategory: 'Category',
  catalogueTimesUsed: 'used {count} times',
  catalogueSelectedCount: '{count} selected',
  catalogueAddSelected: 'Add {count} item(s)',
  catalogueRateZeroHint: 'Set your own rates here — the starter items ship at ₹0.',

  // Settings
  settings: 'Settings',
  settingsBusiness: 'Business profile',
  settingsBranding: 'Logo, signature & template',
  settingsCatalogue: 'Item catalogue',
  settingsTax: 'Tax rates',
  settingsNumbering: 'Document numbering',
  settingsTerms: 'Terms & conditions',
  settingsCustomFields: 'Extra fields',
  settingsBackup: 'Backup & restore',
  settingsAbout: 'About',
  settingsTemplate: 'Template',
  settingsAccent: 'Accent colour',
  settingsDefaults: 'Document defaults',

  numberingPrefix: 'Prefix',
  numberingSuffix: 'Suffix',
  numberingIncludeFy: 'Include the financial year',
  numberingFyFormat: 'Financial year format',
  numberingPadWidth: 'Digits',
  numberingNextSeq: 'Next number',
  numberingResetRule: 'Restart numbering',
  numberingResetNever: 'Never',
  numberingResetYearly: 'Every 1 April',
  numberingPreview: 'Preview',
  numberingGaps: 'Missing numbers: {list}',

  termsAdd: 'Add a terms block',
  termsTitle: 'Title',
  termsBody: 'Terms text',
  termsDefault: 'Use by default',
  termsPick: 'Choose saved terms',
  termsEditForThis: 'Edit for this document only',

  customFieldsAdd: 'Add a field',
  customFieldLabel: 'Label',
  customFieldType: 'Type',
  customFieldTypeText: 'Text',
  customFieldTypeNumber: 'Number',
  customFieldTypeDate: 'Date',
  customFieldAppliesTo: 'Applies to',
  customFieldShowOnDocument: 'Print on the document',

  backupExport: 'Create a backup file',
  backupImport: 'Restore from a backup',
  backupExportDone: 'Backup created.',
  backupImportWarning:
    'Restoring replaces everything currently in the app — all documents, clients and settings. This cannot be undone.',
  backupImportDone: 'Restore complete.',
  backupImportInvalid: 'That file is not a CraftyDocs backup.',
  backupImportNewer:
    'That backup was made by a newer version of the app and cannot be restored here.',

  aboutPrivacy:
    'CraftyDocs works entirely on this phone. It has no analytics, no crash reporting and makes no network calls of any kind. Your documents never leave the device unless you share them yourself.',
  aboutVersion: 'Version',
  aboutOwner: 'Made for The Crafty Pixels, Kangarapady, Ernakulam.',

  // Blocks (§7.4)
  blockClient: 'Client details',
  blockHsn: 'HSN/SAC column',
  blockUnit: 'Unit column',
  blockTax: 'Tax columns',
  blockBank: 'Bank details',
  blockUpiQr: 'UPI QR code',
  blockSignature: 'Signature',
  blockTerms: 'Terms & conditions',
  blockNotes: 'Notes',
  blockAmountInWords: 'Amount in words',
  blockDiscountRow: 'Discount row',
  blockShippingRow: 'Delivery row',
  blockRoundOffRow: 'Round-off row',
  blockFooter: 'Footer line',
  blockDescriptions: 'Item descriptions',
  blockTaxSummary: 'Tax summary table',

  // Errors and confirmations
  errorGeneric: 'Something went wrong.',
  errorLoadDocument: 'This document could not be opened.',
  confirmDeleteDocument: 'Delete this document? This cannot be undone.',
  confirmDeleteClient: 'Delete this client?',
  confirmDeleteItem: 'Delete this catalogue item?',
  confirmCancelReceipt:
    'Cancel this receipt? The record is kept but marked cancelled — issued receipts are never deleted.',
  receiptLockedNotice: 'This receipt has been issued and can no longer be edited.',
  permissionMediaExplain:
    'To save a copy in your Downloads folder, CraftyDocs needs permission to write to your device storage.',
  permissionCameraExplain: 'To photograph your logo or signature, CraftyDocs needs camera access.',
  permissionDenied: 'Permission was not granted, so the file could not be saved.',
} as const;

export type StringKey = keyof typeof en;

/**
 * Malayalam placeholder.
 *
 * Intentionally empty in v1: keys fall back to English, so an untranslated key shows
 * readable text rather than a missing-string marker.
 */
const ml: Partial<Record<StringKey, string>> = {};

const DICTIONARIES: Record<Locale, Partial<Record<StringKey, string>>> = { en, ml };

let activeLocale: Locale = 'en';

export function setLocale(locale: Locale): void {
  activeLocale = locale;
}

export function getLocale(): Locale {
  return activeLocale;
}

/**
 * Look up a string, substituting `{placeholders}`.
 *
 * Falls back to English and then to the key itself, so a missing translation degrades to
 * something legible instead of a blank space in the middle of an invoice screen.
 */
export function t(key: StringKey, params?: Readonly<Record<string, string | number>>): string {
  const template = DICTIONARIES[activeLocale][key] ?? en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
