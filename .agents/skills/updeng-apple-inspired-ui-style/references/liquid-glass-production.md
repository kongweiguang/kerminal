<!-- @author kongweiguang -->

# Liquid Glass 生产实现参考

Use this reference when implementing or reviewing iOS 26+/macOS Tahoe-era Apple-inspired Liquid Glass on the web or in cross-platform UI. The guidance is source-informed by Apple Developer documentation and WWDC25 material, then adapted for production web/app implementation.

## Table of Contents

- Current Direction
- Material Model
- Where To Use It
- Visual Recipe
- CSS Implementation
- SVG/WebGL Enhancement
- Accessibility Fallbacks
- Performance Rules
- Anti-Patterns
- Review Checklist
- Source Links

## Current Direction

Apple describes Liquid Glass as a dynamic material that unifies Apple platform design across controls, navigation, and app structures. The key shift is not "more blur"; it is a distinct functional layer above content. Controls give way to content, adapt to light/dark environments and context, and can fluidly transform as a user moves through an app.

Design implications for web implementation:

- Separate content from controls. Content should be stable and readable; controls can be translucent and adaptive.
- Make glass feel physical through fill, blur, saturation, edge highlight, specular light, shadow, and motion.
- Use concentric geometry: floating controls should harmonize with window/card/device radii.
- Treat glass as a scarce material. Overuse makes the product noisy and less accessible.
- Provide fallbacks for reduced transparency, unsupported `backdrop-filter`, low-power devices, and complex backgrounds.

## Material Model

A convincing Liquid Glass surface usually has six layers:

1. Backdrop context: real content or a subtle environmental background behind the glass.
2. Translucent fill: never fully transparent; keep enough opacity for contrast.
3. Backdrop processing: blur plus saturation; optional brightness/contrast tuning.
4. Edge treatment: low-opacity border, inner highlight, and sometimes a darker lower edge.
5. Depth: soft shadow for elevation, stronger only for floating/modal surfaces.
6. Optical accent: small highlight or sheen that suggests light, not neon.

Recommended web tokens:

```css
:root {
  --glass-fill: rgb(255 255 255 / 0.62);
  --glass-fill-strong: rgb(255 255 255 / 0.78);
  --glass-border: rgb(255 255 255 / 0.52);
  --glass-inner-highlight: rgb(255 255 255 / 0.58);
  --glass-shadow: 0 1px 1px rgb(255 255 255 / 0.45) inset,
    0 12px 36px rgb(0 0 0 / 0.10);
  --glass-blur: 22px;
  --glass-saturate: 180%;
}

.dark {
  --glass-fill: rgb(28 28 30 / 0.58);
  --glass-fill-strong: rgb(36 36 40 / 0.78);
  --glass-border: rgb(255 255 255 / 0.14);
  --glass-inner-highlight: rgb(255 255 255 / 0.10);
  --glass-shadow: 0 1px 1px rgb(255 255 255 / 0.06) inset,
    0 18px 48px rgb(0 0 0 / 0.42);
}
```

## Where To Use It

Use Liquid Glass for:

- navigation bars, sidebars, tab bars, floating toolbars
- compact controls and segmented controls
- search fields and command palettes
- popovers, menus, context menus, toasts
- dialogs, sheets, inspectors
- media controls and transient overlays

Avoid or use solid fallbacks for:

- text-heavy panels
- tables and dense data grids
- terminals, logs, code, diffs, editors
- form-heavy settings pages
- destructive confirmation text
- accessibility-critical status regions

## Visual Recipe

For a normal glass control cluster:

```text
background: translucent fill around 0.56-0.72
blur: 16-28px
saturation: 150-190%
border: 1px light edge
radius: 14-20px, concentric with contained controls
shadow: small inner highlight + soft outer shadow
motion: 140-220ms opacity/transform, no slow drift
```

For a floating dialog or command palette:

```text
background: stronger translucent or near-solid fill around 0.72-0.86
blur: 24-36px
border: 1px, slightly stronger in dark mode
radius: 22-28px
shadow: larger soft shadow
content: labels and body text on solid/control fills if needed
```

For dense apps, prefer "glass shell, solid content":

```text
sidebar/topbar: glass
terminal/table/editor: solid
popover/dialog: glass shell with solid rows or fields
selected row: subtle solid tint, not transparent text over busy content
```

## CSS Implementation

Base class:

```css
.liquid-glass {
  position: relative;
  isolation: isolate;
  background: var(--glass-fill);
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-shadow);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}

.liquid-glass::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  pointer-events: none;
  background:
    linear-gradient(135deg, rgb(255 255 255 / 0.34), transparent 42%),
    radial-gradient(circle at 20% 0%, rgb(255 255 255 / 0.22), transparent 32%);
  opacity: 0.72;
}

.liquid-glass-strong {
  background: var(--glass-fill-strong);
}

@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .liquid-glass {
    background: rgb(var(--surface-elevated-rgb) / 0.96);
  }
}
```

Interactive control example:

```css
.glass-control {
  min-height: 34px;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.36);
  border: 1px solid rgb(255 255 255 / 0.38);
  color: rgb(var(--text-primary-rgb));
  transition: background-color 140ms var(--ease-native),
    transform 100ms var(--ease-native),
    box-shadow 140ms var(--ease-native);
}

.glass-control:hover {
  background: rgb(255 255 255 / 0.48);
}

.glass-control:active {
  transform: scale(0.98);
}

.glass-control:focus-visible {
  outline: none;
  box-shadow: 0 0 0 4px rgb(var(--accent-rgb) / 0.20);
}
```

## SVG/WebGL Enhancement

CSS `backdrop-filter` cannot truly refract content. For high-fidelity hero/showcase surfaces, consider an enhancement layer:

- SVG displacement map for subtle edge distortion.
- Canvas/WebGL shader for specular highlights and refraction.
- CSS fallback that remains acceptable when the enhanced layer is disabled.

Use enhanced refraction only for bounded surfaces and only when performance is measured. Do not introduce a global shader for ordinary app chrome.

## Accessibility Fallbacks

Required:

- Keep text contrast readable after blur with real content behind it.
- Put critical text/icons on a sufficiently opaque fill.
- Add `prefers-reduced-motion` handling.
- Add a reduced-transparency mode if the platform/app exposes one.
- Avoid transparent destructive confirmations and legal/security text.

Recommended CSS:

```css
@media (prefers-reduced-motion: reduce) {
  .liquid-glass,
  .glass-control {
    transition-duration: 0.001ms !important;
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
  }
}

@media (prefers-contrast: more) {
  .liquid-glass {
    background: rgb(var(--surface-elevated-rgb) / 0.96);
    border-color: rgb(var(--border-strong-rgb) / 0.42);
  }
}

[data-reduced-transparency="true"] .liquid-glass {
  background: rgb(var(--surface-elevated-rgb) / 0.98);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
```

## Performance Rules

- Restrict blur to small or medium surfaces.
- Avoid animating blur radius, filter stacks, width, height, top, or left.
- Animate opacity and transform.
- Avoid nested backdrop filters.
- Do not place backdrop-filter on long scrolling lists or full-page wrappers.
- Test on lower-power hardware or throttle rendering when possible.
- Watch for text shimmering, low-resolution blur artifacts, and GPU overdraw.

## Anti-Patterns

- Every card is glass.
- Glass sits behind paragraphs, logs, tables, or code.
- Text floats directly over busy imagery.
- Large neon gradients pretend to be "futuristic Apple".
- Blur is so strong the material looks like milky plastic.
- Borders are too bright, creating chrome outlines everywhere.
- Motion is slow and theatrical instead of causal.
- There is no solid fallback for unsupported backdrop-filter.
- Dark mode uses pure black plus loud blue glow.
- The design copies Apple app layouts or proprietary assets instead of applying principles.

## Review Checklist

Pass all items before calling the implementation production-ready:

```text
Glass is limited to controls/navigation/floating layers.
Dense content remains solid and readable.
Each glass surface has fill, blur, border, shadow, and fallback.
Text contrast works on real backgrounds.
Focus rings are visible on glass.
Reduced motion works.
Reduced transparency or high-contrast fallback works.
No nested glass causes visual noise.
No portal surface ignores theme tokens.
Performance is acceptable while scrolling and opening overlays.
The UI feels product-specific, not a generic glassmorphism demo.
```

## Source Links

- Apple Developer Documentation: Liquid Glass: https://developer.apple.com/documentation/technologyoverviews/liquid-glass
- Apple Developer Documentation: Adopting Liquid Glass: https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass
- Apple Human Interface Guidelines: Materials: https://developer.apple.com/design/human-interface-guidelines/materials
- Apple WWDC25: Meet Liquid Glass: https://developer.apple.com/videos/play/wwdc2025/219/
- Apple Newsroom, June 9 2025: Apple introduces a delightful and elegant new software design: https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/
