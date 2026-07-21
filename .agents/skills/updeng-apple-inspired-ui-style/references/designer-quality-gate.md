<!-- @author kongweiguang -->

# Apple-inspired Designer Quality Gate

Use this reference when the request is not only to apply Apple-inspired styling, but to make the interface genuinely attractive, premium, coherent, and designer-quality. This file is the aesthetic review layer: it turns visual taste into concrete decisions an implementation agent can apply.

## Table of Contents

- Design North Star
- Designer Workflow
- Composition and Layout
- Visual Hierarchy
- Proportion and Rhythm
- Color and Tone
- Material and Depth
- Typography Craft
- Iconography and Imagery
- Interaction Feel
- Responsive Polish
- Designer Review Scorecard
- Common Aesthetic Failures

## Design North Star

The UI should feel designed, not merely styled. A good result looks calm at first glance, useful after one second, and refined after close inspection.

Prioritize:

- one clear focal point per screen
- quiet confidence instead of visual shouting
- strong alignment and optical balance
- enough negative space for the eye to rest
- readable density without cramped controls
- subtle material hierarchy instead of decorative chrome
- interactions that feel causal and immediate

Avoid:

- filling every area with a card, border, glow, or gradient
- equal visual weight everywhere
- large empty spaces that do not clarify hierarchy
- decorative glass that lowers readability
- random radius, spacing, icon, or shadow values
- "template dashboard" composition

## Designer Workflow

Before implementation, make these decisions:

1. Define the product mood in three words, such as calm, technical, precise.
2. Identify the primary workflow and the one visual focal point of the first screen.
3. Choose the density level: spacious, balanced, or compact.
4. Choose the material stack: app background, navigation material, content material, floating material.
5. Choose one accent color role. Do not use accent everywhere.
6. Decide what should feel native, what should feel product-specific, and what should stay invisible.

During implementation:

- Build from layout skeleton first, then typography, then surfaces, then controls, then motion.
- Review at 100% zoom before polishing details.
- Compare light and dark mode while the layout is still simple.
- Remove one decorative element before adding another.

## Composition and Layout

- Use a stable grid. Align page edges, headers, sidebars, panels, and controls to shared insets.
- Prefer fewer, stronger regions over many similarly weighted boxes.
- Make the primary content region visually dominant through size, position, and quiet surrounding surfaces.
- Leave a small hint of adjacent content when it helps orientation, but avoid split layouts where every region competes.
- Keep dense tools visually ordered with consistent row heights, column rhythm, and predictable gutters.
- Use optical alignment for icons and labels. Icons often need slight visual centering rather than purely mathematical centering.
- Avoid full-page card shells around the entire app. The app window itself is already the frame.

Good composition usually has:

- a clear top or side navigation anchor
- one main working surface
- one secondary supporting surface at most
- floating UI only when it is temporary or contextual
- whitespace that separates groups without needing heavy borders

## Visual Hierarchy

Use a hierarchy ladder:

1. Screen purpose
2. Current location or selected object
3. Primary action or active tool
4. Main content
5. Secondary controls
6. Metadata and helper text
7. Rare or destructive actions

Rules:

- If everything is prominent, nothing is prominent.
- Use size, placement, opacity, and material before using stronger color.
- Make selected state unmistakable, but not loud.
- Give destructive actions a distinct but restrained treatment.
- Do not let helper text, badges, counts, or status labels overpower the main task.

## Proportion and Rhythm

- Establish a small set of repeated measurements for the app: page inset, panel gap, toolbar height, row height, control height, and radius.
- Use 4px increments for spacing, but judge final rhythm visually.
- Keep controls compact in workbench UIs. Large controls make serious tools feel toy-like.
- Keep page titles modest inside apps. Reserve hero-sized type for actual marketing or editorial pages.
- Avoid accidental symmetry. Perfectly equal columns can feel static unless the workflow truly needs equal weight.
- Do not let a sidebar, inspector, or chat panel steal more width than its task deserves.

Useful starting ratios:

- navigation rail: 48px - 72px
- sidebar: 220px - 280px
- inspector or secondary panel: 280px - 360px
- top toolbar: 44px - 56px
- dense row: 32px - 40px
- comfortable row: 44px - 56px

## Color and Tone

- Start from neutral surfaces, then add one accent role.
- Let color communicate state and affordance, not decoration.
- Use subtle temperature: slightly warm light backgrounds and slightly cool dark backgrounds can feel more premium than flat gray.
- Avoid a one-note palette where every object is the same blue, purple, gray, beige, or black.
- Keep semantic colors small and meaningful. Error, warning, success, and info colors should not become decorative themes.
- In dark mode, avoid pure black unless the product specifically needs OLED-style depth. Most app surfaces should sit on near-black.
- In light mode, avoid pure white everywhere. Layer soft off-white backgrounds with elevated translucent or solid panels.

Accent use:

- primary action: yes
- active selection: yes, restrained
- links: yes
- every icon: no
- every border: no
- large backgrounds: usually no

## Material and Depth

- Build depth from a controlled stack: background, navigation, content, floating UI, modal/sheet.
- Glass should feel like a material, not a filter. It needs fill, blur, border, shadow, and contrast.
- Use blur where the content behind the surface helps spatial understanding. Do not blur just to look futuristic.
- Content-heavy surfaces should be mostly solid.
- Floating surfaces need stronger shadow and border than inline panels.
- Avoid mixing many shadow styles on the same screen.
- A premium UI often has less visible depth than expected; the polish comes from subtle consistency.

## Typography Craft

- Use system fonts and a restrained type scale.
- Use line height to create comfort: compact controls can be tight, reading text needs more air.
- Keep labels short. Let layout and control type explain behavior where possible.
- Use weight sparingly. Too many semibold labels make the page noisy.
- Use muted text for metadata, not for important instructions.
- Do not use negative letter spacing for ordinary app UI.
- Avoid all-caps labels except very small section labels, and use them sparingly.
- Ensure long words, paths, filenames, commands, and URLs truncate or wrap intentionally.

## Iconography and Imagery

- Use one icon family and one stroke weight across the app.
- Pair icons with text when the action is uncommon or risky.
- Use icon-only buttons only for common, recognizable actions and provide accessible names.
- Keep icons visually quiet. They support scanning; they should not become decorative illustrations.
- Use real product, content, file, or workflow imagery when imagery is necessary. Avoid generic abstract blobs or decorative vector scenes inside serious apps.

## Interaction Feel

- Every interactive element needs hover, active, focus, disabled, and loading states when applicable.
- Hover should reveal affordance, not move layout.
- Press should feel immediate. Slight scale or color response is enough.
- Opening a menu or panel should feel attached to the trigger.
- Closing should be faster than opening.
- Layout changes should preserve orientation; avoid large unexpected movement.
- Respect reduced motion and keep the reduced-motion version visually complete.

Motion taste:

- hover and press: fast and tiny
- menus: quick fade plus slight movement
- dialogs: soft scale and fade
- panel resize or reveal: smooth but not slow
- loading: only when real waiting is happening

## Responsive Polish

- Design desktop, narrow desktop, and mobile/tablet states intentionally.
- Do not merely stack everything. Reconsider hierarchy at smaller widths.
- Preserve the primary task when space is constrained; collapse secondary tools first.
- Avoid horizontal overflow in tabs, toolbars, tables, file paths, and command areas.
- Keep hit targets usable on touch-capable screens.
- Make truncation meaningful: preserve file extensions, terminal tab names, active project names, and important status text where possible.

## Designer Review Scorecard

Before calling the UI good, score it from 1 to 5:

- First impression: Does it look calm, premium, and intentional within five seconds?
- Focal point: Is the main task visually obvious?
- Hierarchy: Can a user distinguish primary, secondary, and tertiary elements quickly?
- Composition: Are alignment, spacing, and proportions coherent?
- Color: Is accent usage restrained and meaningful?
- Material: Are glass, solid, and floating surfaces used with purpose?
- Typography: Is the text scale readable and native-like?
- Controls: Do buttons, tabs, inputs, and menus feel consistent and humane?
- Motion: Are transitions fast, natural, and non-distracting?
- Theme quality: Do light, dark, and system modes all feel deliberately designed?

If any score is below 4, revise before final delivery. A score below 3 means the style pass is incomplete.

## Common Aesthetic Failures

- The UI uses Apple-like colors but still has generic admin layout.
- Glass is overused, so the app feels noisy and less readable.
- There are too many cards with similar weight.
- The primary action is not visually distinct.
- Icons come from mixed families or sizes.
- Text is technically readable but visually cramped.
- The dark theme is just inverted light mode.
- The accent color appears on too many unrelated elements.
- Motion is smooth but slow, making the app feel heavy.
- The interface looks good in a screenshot but breaks under long labels, real data, narrow widths, or dark mode.
