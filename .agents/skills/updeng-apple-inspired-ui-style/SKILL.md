---
name: updeng-apple-inspired-ui-style
description: |
  Apple-inspired/Liquid Glass 视觉体系、tokens、响应式、可访问性和确定性页面审计。
  用于用户或既有设计明确要求 Apple-inspired/Liquid Glass 风格，或按该既定风格审计实现的任务；不要把它当作默认前端审美套用。
---

<!-- @author kongweiguang -->

# Apple-Inspired UI Style

Create Apple-inspired interfaces that feel production-ready: clear, calm, premium, native-like, technologically current, and usable under real content. Do not clone Apple apps, copy Apple assets, or treat glass as decoration. Use Apple design principles as art direction: content first, controls as a distinct layer, hardware-aware geometry, restrained color, fluid interaction, and rigorous accessibility.

## Design Philosophy

Treat Apple-inspired design as a usability philosophy before a visual style:

- Clarity: Make the next useful action obvious without explaining the interface in copy.
- Deference: Let content, work, and user intent dominate; let chrome recede.
- Depth: Use layers, motion, and material to explain hierarchy and spatial relationships.
- Directness: Controls should feel attached to the object or region they affect.
- Continuity: Navigation, transitions, and state changes should preserve orientation.
- Forgiveness: Make destructive actions rare, separated, confirmable, and recoverable.
- Familiarity: Use native-feeling control patterns so users do not need to learn a custom UI language.
- Delight through utility: Use Liquid Glass, motion, and polish to make the product feel easier and more alive, not to decorate empty space.

When there is tension between aesthetics and usability, choose usability and refine the aesthetics around it.

## Operating Mode

When this skill is used:

1. Inspect the existing app, design system, components, tokens, themes, and interaction patterns before changing UI.
2. Define the screen's primary job, density level, focal point, and material stack.
3. Identify the user's shortest successful path: first view, first action, confirmation, recovery, and next step.
4. Implement semantic tokens first, then layout, typography, surfaces, controls, motion, and responsive states.
5. Use Liquid Glass only for controls, navigation, overlays, and transient UI unless the product explicitly needs a showcase surface.
6. Keep dense content mostly solid: terminals, code, logs, tables, editors, diff views, long forms, and file lists.
7. Verify light mode, dark mode, system mode if present, reduced motion, reduced transparency if supported, narrow viewports, keyboard focus, and real data overflow.
8. Run the bundled audit script when editing a codebase with CSS/TS/JS/HTML files.

## Read The Right Reference

Load only the references needed for the task:

- For Liquid Glass, iOS 26+/macOS Tahoe-era material, CSS/SVG/WebGL approximations, and accessibility-safe glass: read `references/liquid-glass-production.md`.
- For implementation recipes, tokens, Tailwind/CSS patterns, component states, and verification commands: read `references/production-implementation.md`.
- For dense developer tools, terminal/file-management apps, settings-heavy desktop apps, tabs, portals, and regressions: read `references/operational-app-workbench.md`.
- For aesthetic review, composition, visual hierarchy, and final designer-grade scoring: read `references/designer-quality-gate.md`.

Reusable assets:

- Copy or adapt `assets/apple-ui-tokens.css` when the project lacks a strong token layer.
- Run `uv run --managed-python --python 3.12 --script scripts/apple_ui_audit.py <paths...>` after implementation to catch common Apple-style regressions.

## Non-Negotiable Design Rules

- Make content the visual center. Controls and navigation should serve the task.
- Make the common path short and visible. Avoid hiding primary actions behind menus, hover-only controls, or ambiguous icons.
- Design empty, loading, error, disabled, selected, edited, syncing, and success states as first-class UI.
- Use progressive disclosure: show essential controls first, advanced controls when context or user intent demands them.
- Use system typography: `-apple-system`, `BlinkMacSystemFont`, `SF Pro Text`, `SF Pro Display`, `Segoe UI`, `system-ui`, `sans-serif`; use `SF Mono`, `Menlo`, `Monaco`, `Consolas`, or an existing mono stack for code.
- Build hierarchy with space, type, opacity, material, and motion before color.
- Use one primary accent role, usually Apple blue `#0A84FF`, plus small semantic colors.
- Keep the palette neutral but not one-note. Avoid all-blue, all-purple, all-slate, all-beige, or all-black designs.
- Use consistent radii: controls 10-12px, list rows 10-14px, cards 14-18px, panels 18-22px, dialogs/sheets 22-28px.
- Use thin borders and layered soft shadows. Avoid heavy dashboard shadows and thick dividers.
- Use icons from the project's icon library; prefer thin 15-18px line icons at 1.5-2px stroke.
- Prefer familiar icon buttons for common tools; add accessible names and tooltips for icon-only controls.
- Keep animations fast and causal: hover 100-150ms, popovers/dialogs 140-220ms, larger layout changes 180-280ms.
- Respect `prefers-reduced-motion`; avoid decorative loops, excessive bounce, large movement, flashing, and particle effects.
- Never let glass reduce readability. Text, icons, and controls must remain legible over real backgrounds.
- Do not use glass everywhere. One or two visible translucent layers per region is usually the upper limit.
- Do not put cards inside cards or wrap the whole app in a giant card shell.
- Do not create a SaaS marketing hero when the user asked for an app/tool/workbench.

## Apple-Like Material Stack

Use semantic layers instead of ad hoc color classes:

```text
app background       quiet off-white or near-black foundation
content surface      mostly solid, readable work area
navigation material  translucent or softly solid sidebars/top bars
control material     compact buttons, segmented controls, search, tabs
floating material    popovers, menus, command palettes, dialogs, toasts
modal material       strongest elevation, clear focus, accessible contrast
```

Recommended token names:

```text
--surface-app
--surface-content
--surface-elevated
--surface-glass
--surface-glass-strong
--surface-control
--surface-control-hover
--surface-selected
--border-subtle
--border-strong
--text-primary
--text-secondary
--text-tertiary
--accent
--focus-ring
--shadow-soft
--shadow-floating
--ease-native
```

## Liquid Glass Direction

Liquid Glass is a functional material layer, not a generic frosted-card style. It should feel like adaptive glass: translucent fill, blur, saturation, edge highlight, depth, specular shine, and subtle morphing. Use it where controls float above content or where navigation should recede behind the user's work.

Good uses:

- floating toolbar
- navigation bar
- sidebar/inspector shell
- tab bar
- segmented controls
- search field or command palette
- popover/context menu/dropdown
- dialog/sheet/toast
- media controls
- small showcase widgets

Risky uses:

- tables
- code blocks
- terminal output
- long body text
- dense forms
- logs
- entire page backgrounds
- nested cards

If the task asks for "liquid glass", read `references/liquid-glass-production.md` before implementing.

## Component Expectations

Buttons:

- 28-40px tall depending on density.
- Rounded 10-14px.
- Quiet secondary and ghost states.
- Primary button uses accent sparingly.
- Active state may scale to `0.98`; avoid layout movement.
- Label commands with verbs. Icon-only buttons are acceptable only for common actions and must have accessible names/tooltips.

Inputs:

- 34-40px tall.
- Soft fill, subtle border, visible focus ring.
- Preserve readability over glass by using an inner solid/control fill.

Tabs and segmented controls:

- Active state must be unmistakable but not loud.
- Stable hit areas for close, add, split, overflow, and tool actions.
- Do not let active tabs merge into the shell through invisible boundaries.

Menus/popovers:

- Collision-aware placement.
- Max height and scroll behavior.
- Escape and outside-click close.
- Portal content inherits theme.

Settings:

- Native preference layout: category sidebar, grouped rows, direct controls.
- Use toggles, segmented controls, menus, sliders, steppers, and inputs according to setting type.
- Keep destructive/advanced settings separated.

## Ease-Of-Use Rules

Design the interface so a new user can succeed without reading documentation:

- Put the primary workflow in the first viewport or first focused panel.
- Keep labels short, concrete, and action-oriented.
- Use defaults that let the user proceed safely.
- Keep navigation location visible: selected item, active tab, current object, or breadcrumb.
- Put object-specific actions near the object; put global actions in global chrome.
- Prefer inline validation and recovery over blocking errors.
- Preserve user work during navigation, refresh, reconnect, and theme changes when the app architecture allows it.
- Make keyboard use complete for productivity, developer, AI, and workbench UIs.
- Keep command palettes and search forgiving: fuzzy matching, recent items, grouped commands, and clear empty results where feasible.
- Avoid novelty controls for routine tasks. Use standard buttons, menus, segmented controls, toggles, sliders, tabs, sheets, and popovers.

## Verification Gate

Before final delivery, verify:

```text
The app builds and launches.
The first screen communicates where the user is, what matters, and what to do next.
Primary workflows are reachable without hunting through hidden controls.
Light, dark, and system themes are coherent.
Text contrast remains readable on solid and glass surfaces.
Focus states are visible on every interactive component.
Reduced motion is supported.
Reduced transparency or a solid fallback is available when possible.
No labels, filenames, URLs, paths, tabs, buttons, or toolbar controls overflow.
Menus, dialogs, popovers, command palettes, and toasts render above editors/terminals/canvases.
Keyboard navigation reaches controls in logical order.
The UI still works with realistic data, empty states, loading states, error states, and narrow widths.
Common mistakes are recoverable or clearly explained.
The final screen scores at least 4/5 on the designer quality gate.
```

Run:

```bash
uv run --managed-python --python 3.12 --script skills/frontend/updeng-apple-inspired-ui-style/scripts/apple_ui_audit.py <changed-ui-paths>
```

Use `--strict` when the user explicitly asks for production readiness or when the UI pass is broad.

## Final Taste Test

The result should look quiet at first glance, useful after one second, and refined under inspection. It should feel current with Apple's Liquid Glass era while still being accessible, fast, and product-specific.
