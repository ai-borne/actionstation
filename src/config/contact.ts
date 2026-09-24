/** SSOT for the public contact details (support, privacy, billing, refunds, Razorpay KYC). */
export const CONTACT_EMAIL = 'founder@ai-borne.in';

/** Phone in E.164 form, for `tel:` links. */
export const CONTACT_PHONE_E164 = '+918936995020';

/** Phone as shown to people. */
export const CONTACT_PHONE_DISPLAY = '+91 89369 95020';

/** Registered office (virtual office), one entry per printed line. */
export const CONTACT_ADDRESS_LINES = [
    'Pranidi (20B), Near D Mart',
    'Pune, Maharashtra 411045',
    'India',
] as const;

/** Parent brand shown on the Razorpay checkout and bank statements. */
export const PAYMENT_PROCESSOR_BRAND = 'ai-borne';
