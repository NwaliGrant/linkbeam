-- Stage 3: Design tab settings. Defaults match the look every account had before this migration.

ALTER TABLE users ADD COLUMN button_shape TEXT NOT NULL DEFAULT 'pill' CHECK (button_shape IN ('pill', 'rounded', 'square'));

ALTER TABLE users ADD COLUMN font_pair TEXT NOT NULL DEFAULT 'friendly' CHECK (font_pair IN ('friendly', 'clean'));

ALTER TABLE users ADD COLUMN bg_style TEXT NOT NULL DEFAULT 'solid' CHECK (bg_style IN ('solid', 'gradient', 'pattern'));

-- The small "Made with Linkbeam" link on the public page. The owner can hide it.
ALTER TABLE users ADD COLUMN show_badge INTEGER NOT NULL DEFAULT 1 CHECK (show_badge IN (0, 1));
