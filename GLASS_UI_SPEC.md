# FIXBYTE INDIA — Glassmorphism UI Requirements

## Visual direction
Use a premium, modern glassmorphism interface aligned with the FIXBYTE INDIA wordmark: deep navy, turquoise, and purple accents. Preserve contrast and accessibility; glass effects must never reduce text readability.

## Glass buttons
- Frosted/translucent surface with backdrop blur where supported.
- Subtle 1px semi-transparent border and restrained shadow.
- Smooth hover transition with a gentle brand-color glow and slight lift.
- Press/active state with a subtle inset/scale effect.
- Visible keyboard focus ring; disabled/loading states must be clear.
- Keep touch targets comfortable on mobile and provide a solid fallback when backdrop-filter is unsupported.

## Apply consistently
- Primary and secondary CTA buttons, navigation actions, login/signup controls.
- Customer dashboard cards, project status panels, payment options, UPI/UTR submission panel, support-ticket actions, enquiry/meeting booking dialogs, admin controls, and notification panels.
- Use glass sparingly on dense tables/forms so content remains legible.

## Motion and accessibility
- Use short, consistent transitions; avoid excessive motion.
- Respect prefers-reduced-motion.
- Maintain WCAG-friendly text contrast and clear focus indicators.
- Test desktop, tablet, and mobile breakpoints.

## Implementation note
This file records the approved design requirement. It is not itself the production CSS implementation; wire the styles into the actual frontend assets after extracting and inspecting the existing public frontend archive. Do not replace or delete the existing frontend archive or database as part of this step.
