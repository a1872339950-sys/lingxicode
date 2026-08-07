# Lingxi Installer Design

## 1. Visual Theme & Atmosphere

Dark navy desktop utility with a restrained technology aesthetic. The installer is a fixed, centered 16:9 window split into a 36% brand rail and a 64% task area. It must feel trustworthy, compact and operational rather than like a marketing page.

## 2. Color Palette & Roles

```css
--window: #07111f;            /* rgb(7, 17, 31) */
--rail: #0a1930;              /* rgb(10, 25, 48) */
--panel: #0c1a2d;             /* rgb(12, 26, 45) */
--panel-raised: #10233c;      /* rgb(16, 35, 60) */
--border: #1d3552;            /* rgb(29, 53, 82) */
--text: #f4f8ff;              /* rgb(244, 248, 255) */
--text-muted: #91a5c2;        /* rgb(145, 165, 194) */
--primary: #2583ff;           /* rgb(37, 131, 255) */
--primary-hover: #4b9aff;     /* rgb(75, 154, 255) */
--cyan: #38c8ff;              /* rgb(56, 200, 255) */
--success: #35d39a;           /* rgb(53, 211, 154) */
--danger: #f04455;            /* rgb(240, 68, 85) */
--danger-hover: #ff5b69;      /* rgb(255, 91, 105) */
--disabled: #314158;          /* rgb(49, 65, 88) */
```

## 3. Typography Rules

Use `Microsoft YaHei UI`, `Noto Sans SC`, `Segoe UI`, sans-serif. No decorative serif fonts. Main title 24-26px/700, section title 14px/600, body 13px/400, helper text 11-12px/400. Chinese body line height is at least 1.7. Letter spacing remains zero.

## 4. Component Stylings

Buttons are 38px high with a 5px corner radius. Primary buttons use the primary color, danger buttons use danger red, and secondary buttons use the raised panel color with a border. Hover brightens the fill; active darkens it; focus adds a 2px cyan outline; disabled uses the disabled color and 55% text opacity.

Inputs are 36px high, 5px radius, panel background and 1px border. Hover strengthens the border, focus uses primary blue, disabled reduces opacity. Cards use 6px radius and a 1px border, with no floating shadow. Checkboxes and switches have clear checked, unchecked, hover, focus and disabled states.

## 5. Layout Principles

Window target: 1040x600 logical pixels, fixed size. Brand rail: 360px. Main area uses 34px horizontal and 28px vertical padding. Spacing scale: 4, 8, 12, 16, 20, 24, 32. Content must fit without scrolling at 100%-150% Windows scale.

## 6. Depth & Elevation

Use borders and controlled contrast for hierarchy. Window shadow is supplied by Windows. Internal panels have no large shadow. Modal uses a dim layer and one 24px soft shadow.

## 7. Animation & Interaction

Interaction level L1. The WebGL brand mark may breathe subtly. Progress fills animate over 280-360ms. Current step and task transitions use opacity only. No scroll effects, cursor replacement or large moving blur. Reduced-motion mode removes continuous rotation and shortens transitions to zero.

## 8. Do's and Don'ts

- Do keep all install and uninstall choices visible without scrolling.
- Do show a four-step route on every task screen.
- Do preserve project data unless explicitly selected for deletion.
- Do expose current task and numeric progress.
- Do keep destructive action red and isolated.
- Do retain keyboard focus visibility.
- Do keep paths selectable and readable.
- Do use consistent left brand artwork across states.
- Don't use light cards on the dark surface.
- Don't nest cards.
- Don't use large rounded pills.
- Don't auto-close the completion screen before the user can read it.
- Don't animate blur or run more than one WebGL scene.
- Don't hide errors behind generic status text.

## 9. Responsive Behavior

This is a fixed desktop installer. At high DPI, WPF scales the logical layout. Minimum supported effective viewport is 1040x600; text wraps inside constrained rows and controls preserve a minimum 44px interaction target where practical. The interface is not intended for phone layouts.
