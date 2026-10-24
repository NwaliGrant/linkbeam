# Adding a language to Linkbeam

Linkbeam keeps its words in translation files, so people who speak other languages (French, Yoruba, Hausa, Igbo, Swahili and more) can add them without touching the program code. English comes first. Pidgin is not part of the plan.

## What is translated today

The words on the **public page** (report link, "Made with Linkbeam", the "page not found" page) and the words in the **link editor** (link types, address boxes, hints, error messages) are in `packages/shared/src/i18n/en.ts`.

The rest of the dashboard (sign-in, setup, design, stats, settings and share tabs) still has its English text inside the components. Moving it is tracked as B-032 in `docs/BACKLOG.md`. Messages sent back by the API (for example "Please sign in to continue.") are English only for now.

## How to add a language

1. Copy `packages/shared/src/i18n/en.ts` to a new file named with the language code, for example `fr.ts`.
2. Change the name inside from `en` to `fr`, and remove `as const` and the `MessageKey` line at the bottom. Type it as `Messages` instead:
   ```ts
   import type { Messages } from "./index";
   export const fr: Messages = { /* ... */ };
   ```
3. Translate every **value** (the text on the right). Never change a **key** (the text on the left).
4. Keep every `{placeholder}` exactly as it is, for example `{name}` or `{username}`. You may move it inside the sentence.
5. Add the language in `packages/shared/src/i18n/index.ts`:
   ```ts
   import { fr } from "./fr";
   export const LOCALES: Record<string, Messages> = { en, fr };
   ```
6. Run `pnpm test`. The tests fail if a key is missing, a key is extra, a message is empty, or a `{placeholder}` was lost. Fix what they report.

## Not done yet

Choosing a language (for a page owner, or for a visitor) is not built. A language file only takes effect when the program is told to use it. Adding that choice is tracked as B-033.

## Writing guidance

- Use short, plain sentences. The people reading them are often on a phone, and for many English is a second language.
- Do not translate the name "Linkbeam".
- Keep the same tone: friendly and clear, never blaming the person for a mistake.
