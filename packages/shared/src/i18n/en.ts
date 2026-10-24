/**
 * All words that visitors and link editors read, in English. This is the file other languages copy.
 * See docs/TRANSLATING.md. Placeholders like {field} must stay exactly as they are in every language.
 */
export const en = {
  // ---- The public page ----
  "public.report": "Report this page",
  "public.badge": "Made with Linkbeam",
  "public.noLinks": "No links yet.",
  "public.notFound.title": "This page does not exist",
  "public.notFound.body": "The name may be spelled differently, or the page may have been removed.",
  "public.notFound.home": "Go to Linkbeam",
  "public.error.title": "This page is not working right now",
  "public.error.body": "Something went wrong on our side. Nothing is lost. Please try again in a moment.",
  "public.error.retry": "Try again",
  "public.title.withName": "{name} (@{username}) | Linkbeam",
  "public.title.plain": "@{username} | Linkbeam",
  "public.description.default": "{name}'s links, all in one place.",

  // ---- Link types ----
  "link.kind.url": "Website link",
  "link.kind.whatsapp": "WhatsApp chat",
  "link.kind.coffee": "Buy me a coffee",
  "link.kind.call": "Phone call",
  "link.kind.email": "Email",
  "link.kind.map": "Map location",

  "link.target.url.label": "Web address",
  "link.target.url.placeholder": "https://example.com",
  "link.target.url.hint": "Starts with https://",
  "link.target.url.empty": "Add a web address.",
  "link.target.url.invalid": "This is not a valid web address. Start with https://",

  "link.target.whatsapp.label": "WhatsApp number",
  "link.target.whatsapp.placeholder": "+2348012345678",
  "link.target.whatsapp.hint": "Include the country code, for example +234",
  "link.target.whatsapp.empty": "Add a WhatsApp number.",
  "link.target.whatsapp.invalid": "This is not a valid WhatsApp number. Start with + and the country code, for example +2348012345678.",

  "link.target.coffee.label": "Your Buy Me a Coffee address",
  "link.target.coffee.placeholder": "https://buymeacoffee.com/your-name",
  "link.target.coffee.hint": "Optional. The address of your own page on Buy Me a Coffee. Linkbeam does not handle any money.",
  "link.target.coffee.empty": "Add the address of your Buy Me a Coffee page.",
  "link.target.coffee.invalid": "This is not a Buy Me a Coffee address. It looks like https://buymeacoffee.com/your-name",

  "link.target.call.label": "Phone number",
  "link.target.call.placeholder": "+2348012345678",
  "link.target.call.hint": "Include the country code, for example +234",
  "link.target.call.empty": "Add a phone number.",
  "link.target.call.invalid": "This is not a valid phone number. Start with + and the country code, for example +2348012345678.",

  "link.target.email.label": "Email address",
  "link.target.email.placeholder": "you@example.com",
  "link.target.email.hint": "People will write to this address",
  "link.target.email.empty": "Add an email address.",
  "link.target.email.invalid": "This is not a valid email address, for example name@example.com.",

  "link.target.map.label": "Address or map link",
  "link.target.map.placeholder": "12 Herbert Macaulay Way, Yaba, Lagos",
  "link.target.map.hint": "Type the address, or paste a link from your map app",
  "link.target.map.empty": "Add an address or a map link.",
  "link.target.map.invalid": "This is not a valid address or map link. Use letters and numbers, or a link that starts with https://",

  "link.title.empty": "Add a title.",
  "link.title.tooLong": "Use 60 characters or fewer.",
  "link.whatsapp.message": "First message (optional)",

} as const;

export type MessageKey = keyof typeof en;
