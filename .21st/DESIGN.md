# ReativaConquistas design context

## Project

Vanilla HTML, CSS and JavaScript application with Cloudflare Worker APIs for payment and entitlement checks. World files are processed locally in the browser. The 3D renderer stays on its dedicated Builder route.

## Direction

Use a calm dark gray and emerald system, with an explicit light preference. Keep Minecraft identity in the tool icons, terminology and occasional material details. Use system sans-serif text, moderate radii, thin borders, flat work surfaces and brief state transitions.

The homepage focuses on selecting a world. After server-backed file validation, show the world editor shell with a desktop sidebar and mobile bottom navigation. Keep tool cards compact and put actual server-backed plans on their own page.

## Shared tokens

- Background `#0b100f`; surface `#121918`; raised surface `#18211f`; hover surface `#1c2825`.
- Border `#293532`; text `#edf4f0`; muted text `#9baaa4`; primary `#39b77b`.
- Success `#62d59a`; warning `#e8b75e`; error `#ed7777`; iron `#a8b2b8`; gold `#e8bd61`; diamond `#75d6dc`.
- Spacing uses a 4px base scale. Radii are 9px, 14px and 20px. Shadows are reserved for overlays.

## Component patterns

- Semantic HTML and existing vanilla JavaScript modules.
- A small public header; searchable tool cards; compact plan cards; native dialogs/details; accessible loading and error states.
- Responsive sidebar navigation becomes a touch-sized mobile bar.
- Builder keeps its existing viewport and uses a mobile control sheet around it.

## Constraints

- Keep the current HTML/CSS/JavaScript stack and preserve existing routes and DOM IDs.
- The Worker remains authoritative for authentication, entitlements, limits, payments and confirmed credits.
- Do not imply a general operation-credit wallet, invented prices, persistent cloud backups or operation history.
- Keep file processing local and the 3D renderer isolated to the Builder page.
- Avoid neon, large gradients, glass effects, excessive badges and decorative motion.

## 21st.dev references adapted

- [Sidebar patterns](https://21st.dev/community/components/explore/sidebar-ui-design)
- [Upload patterns](https://21st.dev/community/components/explore/dev-upload)
- [Pricing patterns](https://21st.dev/community/components/explore/animated-pricing-sections)
- [Modal patterns](https://21st.dev/community/components/explore/react-modal)
- [Mobile navigation patterns](https://21st.dev/community/components/explore/shadcn-bottom-navigation)

React/Tailwind examples are used only as structural references; no registry component or framework dependency is added.
