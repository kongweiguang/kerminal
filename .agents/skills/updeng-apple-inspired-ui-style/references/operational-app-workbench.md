<!-- @author kongweiguang -->

# Apple-inspired Operational App Workbench Guidelines

Use this reference when applying the Apple-inspired style to complex productivity apps, developer tools, terminal shells, file managers, AI consoles, settings-heavy desktop apps, or any broad UI refresh that touches navigation, panels, floating surfaces, and motion.

The goal is a native-like workbench: quiet, precise, layered, fast, and human. The interface should feel more considered and technological through material hierarchy, typography, interaction rhythm, and system coherence, not through heavy decoration.

## Design Intent

- Prioritize clarity over spectacle. Users should understand where they are, what is selected, what can be acted on, and what will happen next.
- Treat material as hierarchy. Glass belongs on navigation, floating controls, command palettes, popovers, dialogs, and transient overlays. Dense content such as terminals, logs, tables, file lists, code, and settings rows should usually remain solid and readable.
- Make the UI feel alive through short causal motion: hover, press, focus, open, close, reorder, and selection transitions. Avoid decorative motion that does not explain state.
- Preserve native expectations. A desktop workbench should behave like a high-quality system app, not like a marketing landing page or generic admin dashboard.

## Surface System

- Define semantic material tokens before restyling many components. Prefer project tokens such as `--surface-app`, `--surface-glass`, `--surface-glass-strong`, `--surface-solid`, `--surface-overlay`, `--surface-control`, `--surface-control-hover`, `--surface-selected`, `--border-subtle`, `--border-strong`, `--shadow-popover`, `--focus-ring`, `--motion-fast`, and `--ease-native`.
- Map every material token for light, dark, and system themes. Do not leave portals, detached windows, menus, or toast roots on hard-coded white/black colors.
- Keep the glass budget low. Use one or two visible translucent layers in a region. Avoid nested glass panels and avoid putting cards inside cards.
- Give glass a readable fallback: translucent fill, subtle border, shadow, and enough contrast even when backdrop blur is unsupported or disabled.
- Use stronger solid surfaces for terminal output, logs, editable text, tables, file lists, diff/code views, and compact settings forms.

## Navigation and Tabs

- Top tabs must remain visibly framed controls. Do not let active tabs visually merge into the page by using the same background, missing lower edge, or invisible boundary.
- Active tab state needs one unmistakable signal: selected fill, accent line, stronger text, or elevation. Use one primary signal plus subtle support, not several loud effects.
- Tab close buttons, new-tab buttons, split buttons, and overflow buttons should have stable hit areas and tooltips. Avoid tiny text-only affordances for common actions.
- Primary navigation order should match user workflow: global navigation first, workspace/session controls next, contextual tools near the affected pane, rare/destructive actions last.
- Collapsed sidebars and rails still need semantic labels, focus states, and predictable hover/active behavior.

## Buttons and Controls

- Use familiar icon buttons for common tool actions when an icon exists: close, new, search, settings, split, copy, download, upload, refresh, undo, redo, pin, filter, and more actions.
- Every icon-only control needs an accessible name and hover tooltip. Test selectors should not rely on ambiguous labels when multiple controls share the same visible text.
- Keep compact controls stable. Hover labels, counters, status dots, badges, and loading indicators must not resize the toolbar or shift nearby controls.
- Disabled controls should still communicate purpose and reason through visual state or tooltip when possible.
- Destructive actions should be separated spatially or placed inside confirmation flows, not next to high-frequency neutral actions.

## Floating Surfaces and Portals

- Menus, popovers, command palettes, context menus, dialogs, and toasts must inherit the current light/dark/system theme even when rendered in a portal.
- Use an explicit high stacking layer for transient UI so it appears above terminals, canvases, split panes, editors, and scroll containers.
- Close transient UI on outside click and Escape. If an embedded terminal, canvas, or editor may intercept keyboard events, listen for Escape in the capture phase.
- Do not leave stale hover or menu state after selecting an action, changing focus, switching tabs, or closing a pane.
- Floating surfaces should have clear geometry: min width, max height, scroll behavior, collision-aware placement, and consistent shadow/border treatment.

## Developer and Terminal Workbenches

- Keep terminal, log, and code-reading surfaces solid, high contrast, and stable. Apply glass around these surfaces, not inside dense output.
- AI assistant panels, command bars, and quick actions can use softer glass or elevated materials because they are transient and contextual.
- File lists and remote browser panes need strong row rhythm, selected state, hover state, loading state, empty state, and disabled state.
- Context menus in terminal/editor regions must preserve copy/paste/split/close workflows and must not block native selection or keyboard usage.
- Status bars should be calm and useful: connection state, running tasks, sync, errors, and active profile. Avoid decorative status chips that compete with content.

## Settings and Configuration

- Settings should feel like a native preferences window: category sidebar, readable section headings, grouped rows, direct controls, and concise helper text only where needed.
- Use toggles for boolean settings, segmented controls for mode choices, menus for option sets, sliders/steppers/inputs for numeric values, and explicit buttons for commands.
- Put high-frequency settings near the top. Advanced, destructive, experimental, or rarely changed settings should be lower or grouped separately.
- Preserve keyboard focus and scroll position when navigating between settings categories.

## Motion and Human Feel

- Use short durations for interface motion: roughly 100-180ms for hover/press, 140-220ms for menus/dialogs, and 180-280ms for larger layout transitions.
- Prefer easing that starts and stops softly. Motion should feel responsive, not bouncy by default.
- Animate opacity and transform when possible. Avoid animating layout properties that cause jank unless the framework provides stable layout animation.
- Respect `prefers-reduced-motion`. Reduce or remove nonessential transitions, blur motion, pulse effects, and large panel movement.
- Use loading animation only for real waiting states. Avoid decorative pulsing on stable controls.

## Theme and Accessibility Gate

- Validate light, dark, and system-following themes after any UI pass. A component is not finished until every surface, border, icon, text, focus ring, menu, dialog, and portal remains readable in all themes.
- Avoid ad hoc `white`, `black`, `bg-white/*`, `bg-black/*`, `border-white/*`, `border-black/*`, and one-off focus colors when semantic theme variables are available.
- Text must not overflow buttons, tabs, cards, sidebars, or popovers at narrow widths. Use stable sizing, wrapping, truncation, or responsive layout rules intentionally.
- Focus rings must be visible on glass and solid surfaces. Keyboard navigation should reach all controls in a logical order.
- Keep touch/click targets large enough for desktop precision and touch-capable devices. Avoid controls that only work by exact pixel targeting.

## Verification Checklist

Before considering a broad Apple-inspired UI refresh complete, verify:

- The app builds successfully.
- The app launches in a real browser or desktop shell.
- Light, dark, and system themes render correctly.
- Top tabs remain visible, framed, selectable, closable, and keyboard reachable.
- Sidebars, rails, split panes, and status bars do not overlap content.
- Menus, popovers, dialogs, context menus, toasts, and command palettes open above dense panes and close on outside click and Escape.
- Terminal/editor/file-list workflows still work: selection, copy, paste, split, close, context menu, search, and scroll.
- Settings pages keep native-feeling layout and direct controls.
- Narrow viewport and high-density layouts do not create horizontal overflow or clipped labels.
- Console output has no unexpected runtime errors.
- `prefers-reduced-motion` has an acceptable non-distracting experience.

## Regression Traps

- The active tab frame disappears because its background matches the surrounding shell too closely.
- A popover renders behind a terminal, editor, canvas, or scroll container due to insufficient z-index.
- Escape does not close a menu because a terminal/editor listener stopped propagation.
- A hidden textarea or implementation detail is selected in tests because labels or roles are ambiguous.
- A menu stays open after action selection, tab switch, pane close, or focus loss.
- Portal-rendered UI ignores the current theme.
- Glass is applied to dense content, reducing readability.
- Focus rings are invisible on translucent surfaces.
- Hover labels, counters, or loading states resize fixed toolbars.
- Motion continues when reduced-motion is requested.
