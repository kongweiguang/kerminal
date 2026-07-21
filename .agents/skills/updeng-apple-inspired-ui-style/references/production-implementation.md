<!-- @author kongweiguang -->

# Apple-Inspired Production Implementation

Use this reference when turning Apple-inspired direction into production UI code. It consolidates token setup, component recipes, Tailwind/CSS usage, visual QA, and common implementation failures.

## Table of Contents

- Implementation Workflow
- Token Contract
- CSS Starter
- Tailwind Patterns
- Component Recipes
- Theme Requirements
- Motion Requirements
- Ease-Of-Use Requirements
- Responsive Requirements
- QA Commands
- Community Skill Patterns
- Source Links

## Implementation Workflow

1. Inventory existing design tokens, color variables, Tailwind config, CSS modules, theme providers, and component primitives.
2. Add semantic tokens before restyling components.
3. Replace one-off hard-coded `white`, `black`, `zinc`, `slate`, gradient, and shadow classes with semantic surfaces where feasible.
4. Build the layout skeleton with correct density and alignment.
5. Apply typography and icon sizing.
6. Apply material stack: solid content, glass navigation/floating controls, elevated modals.
7. Add complete interactive states: hover, active, focus-visible, disabled, selected, loading, error, empty.
8. Make the primary workflow obvious: first action, next step, confirmation, and recovery.
9. Add fast motion and reduced-motion fallback.
10. Verify real data, long labels, narrow widths, dark mode, and portals.
11. Run the audit script and app tests/build.

## Token Contract

Prefer RGB tuple variables so alpha can be applied at usage sites:

```css
:root {
  --surface-app-rgb: 245 245 247;
  --surface-content-rgb: 255 255 255;
  --surface-elevated-rgb: 255 255 255;
  --surface-control-rgb: 255 255 255;
  --surface-selected-rgb: 10 132 255;
  --text-primary-rgb: 29 29 31;
  --text-secondary-rgb: 60 60 67;
  --text-tertiary-rgb: 60 60 67;
  --border-subtle-rgb: 0 0 0;
  --border-strong-rgb: 0 0 0;
  --accent-rgb: 10 132 255;
  --danger-rgb: 255 69 58;
  --success-rgb: 50 215 75;
  --warning-rgb: 255 214 10;
  --ease-native: cubic-bezier(0.16, 1, 0.3, 1);
}

.dark {
  --surface-app-rgb: 16 16 18;
  --surface-content-rgb: 28 28 30;
  --surface-elevated-rgb: 36 36 40;
  --surface-control-rgb: 44 44 48;
  --text-primary-rgb: 245 245 247;
  --text-secondary-rgb: 235 235 245;
  --text-tertiary-rgb: 235 235 245;
  --border-subtle-rgb: 255 255 255;
  --border-strong-rgb: 255 255 255;
}
```

## CSS Starter

Use `assets/apple-ui-tokens.css` when the project needs a portable starting point. Adapt class names to local conventions instead of forcing global class names into a componentized codebase.

Minimum required utilities:

```css
.apple-app {
  background: rgb(var(--surface-app-rgb));
  color: rgb(var(--text-primary-rgb));
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text",
    "SF Pro Display", "Segoe UI", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

.apple-solid-panel {
  background: rgb(var(--surface-content-rgb) / 0.94);
  border: 1px solid rgb(var(--border-subtle-rgb) / 0.08);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.04),
    0 12px 36px rgb(0 0 0 / 0.06);
}

.apple-focus:focus-visible {
  outline: none;
  box-shadow: 0 0 0 4px rgb(var(--accent-rgb) / 0.20);
}
```

## Tailwind Patterns

Prefer semantic tokens in Tailwind arbitrary values:

```tsx
<main className="min-h-screen bg-[rgb(var(--surface-app-rgb))] text-[rgb(var(--text-primary-rgb))] antialiased">
  <aside className="border-r border-[rgb(var(--border-subtle-rgb)/0.08)] bg-[rgb(var(--surface-elevated-rgb)/0.72)] backdrop-blur-2xl" />
  <section className="rounded-2xl border border-[rgb(var(--border-subtle-rgb)/0.08)] bg-[rgb(var(--surface-content-rgb)/0.94)] shadow-[0_12px_36px_rgb(0_0_0/0.06)]" />
</main>
```

Avoid building the whole UI from raw `bg-white`, `bg-black`, `text-zinc`, `from-blue`, and `shadow-2xl` utilities. Raw utilities are acceptable for quick prototypes but should be consolidated for production.

## Component Recipes

Toolbar:

```text
height: 44-56px
material: glass or softly solid
border: bottom 1px low opacity
controls: 28-34px icon buttons
motion: hover fill, active scale 0.98
overflow: stable, no layout shift
```

Sidebar:

```text
width: 220-280px
material: translucent shell or low-contrast solid
selected item: soft pill or subtle accent fill
labels: 11-12px muted, sparing
icons: 15-17px line icons
```

Command palette:

```text
width: 560-720px desktop, viewport-constrained mobile
position: centered or slightly above center
material: strong glass shell
input: quiet, readable, high focus clarity
rows: 36-44px, icon + title + optional shortcut
keyboard: arrows, enter, escape
```

Data/table/log surfaces:

```text
material: solid
row rhythm: stable
selected state: visible but restrained
font: readable, mono where appropriate
glass: only surrounding toolbar/sidebar/popover
```

Dialogs/sheets:

```text
radius: 22-28px
shadow: floating
entry: opacity + scale 0.98 to 1
close: faster than open
focus: trapped or managed according to framework conventions
```

## Theme Requirements

- Light mode should use soft off-white backgrounds, not pure white everywhere.
- Dark mode should use near-black and elevated dark surfaces, not pure black inversion.
- System mode should follow the existing app mechanism.
- Portal roots for menus, tooltips, dialogs, command palettes, and toasts must inherit theme attributes/classes.
- Do not leave detached surfaces hard-coded to white or black.

## Motion Requirements

Use a shared easing token:

```css
--ease-native: cubic-bezier(0.16, 1, 0.3, 1);
```

Motion defaults:

```text
hover/active: 100-150ms
menu/popover: 140-180ms
dialog/sheet: 160-220ms
larger layout transition: 180-280ms
```

Animate:

```text
opacity
transform
background-color
box-shadow, sparingly
```

Avoid animating:

```text
filter blur
height/width during frequent interactions
box model properties on large surfaces
scroll position without user intent
```

## Ease-Of-Use Requirements

Before polishing visual effects, make the product easier to use:

- First view: show current context, primary object or task, one clear primary action, and useful secondary actions.
- Navigation: keep the current location visible through selected sidebar item, active tab, title, breadcrumb, or object header.
- Command access: provide search or command palette for complex tools; include recent commands/items when useful.
- Progressive disclosure: keep advanced or destructive controls available but not visually dominant.
- Defaults: choose safe defaults and preserve user choices where appropriate.
- State clarity: design loading, empty, partial, syncing, offline, error, disabled, selected, edited, unsaved, and success states.
- Recovery: support undo, cancel, restore, retry, duplicate, or confirmation flows when the action can lose work.
- Accessibility: every icon-only control has an accessible name and tooltip; every form error has text, not color alone.
- Density: serious tools can be compact, but hit targets, row rhythm, and text truncation must remain usable.
- Copy: use short labels that say what the action does; avoid visible instructional text when a familiar control pattern would be clearer.

Run this mental test: a first-time user should know where they are, what changed, what can be clicked, and how to undo or recover from a mistake.

## Responsive Requirements

- Design desktop, narrow desktop, tablet, and mobile states intentionally.
- Collapse secondary panels before harming the main task.
- Use stable dimensions for toolbars, tab bars, grids, boards, counters, and icon buttons.
- Prevent horizontal overflow in paths, URLs, commands, tabs, tables, and segmented controls.
- Preserve file extensions and important suffixes when truncating filenames.
- Do not scale font sizes with viewport width.

## QA Commands

Run the checks available in the repo, commonly:

```bash
npm run lint
npm run test
npm run build
```

Run the bundled style audit:

```bash
uv run --managed-python --python 3.12 --script skills/frontend/updeng-apple-inspired-ui-style/scripts/apple_ui_audit.py <changed-ui-paths>
uv run --managed-python --python 3.12 --script skills/frontend/updeng-apple-inspired-ui-style/scripts/apple_ui_audit.py --strict <changed-ui-paths>
```

Use Playwright or the app's existing browser test setup for visual verification when layout, theme, portal, or responsive behavior changed.

## Community Skill Patterns

Recent public agent-skill repositories around Apple design and Liquid Glass tend to converge on these useful patterns:

- Keep `SKILL.md` focused on triggers and workflow.
- Put detailed platform/API/material guidance in `references/`.
- Include deterministic helpers or scripts when checks are repeatable.
- Use concise checklists and "when to use / when not to use" decision rules.
- Treat Liquid Glass as a specialized material with accessibility and performance constraints, not only a visual preset.
- Include platform-specific fallbacks, especially for SwiftUI/UIKit/AppKit and web implementations.

Apply those patterns here: keep the main skill lean, load references only when needed, and verify the UI with code plus real rendered screens.

## Source Links

Representative public GitHub references for market/context checks:

- Liquid Glass Web/WebGL exploration: https://github.com/iyinchao/liquid-glass-studio
- Apple-inspired Liquid Glass JS effects: https://github.com/dashersw/liquid-glass-js
- Flutter Liquid Glass widgets: https://github.com/sdegenaar/liquid_glass_widgets
- iOS tab bar library tracking iOS 26 Liquid Glass patterns: https://github.com/ChenYilong/CYLTabBarController
