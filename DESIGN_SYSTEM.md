# Signal Creative OS design system
Backgrounds #080A0F, #0D1118, #111722. Primary text #F4F7FB; secondary #9BA7B8 (slightly brighter than proposed #8D98A8 for readability). Border white 10%; inputs white 14%. AI violet #8B5CF6 and cyan #22D3EE; success #22C55E; warning #F59E0B; destructive #EF4444. White primary button text uses darker violet #7145D6.

Geist / Noto Sans Armenian / system sans. Body 14–16px; metadata 11–12px; headings 24–52px. Space scale 4/8/12/16/20/24/32/40. Radius 6/9/12/14/16px. Surfaces are mostly solid graphite; utility bar blur 18px. No decorative elevation or neon gradient borders. Buttons >=44px except compact topbar controls. Inputs have visible labels and focus outlines. Status badges include text; colour alone is insufficient.

Desktop dock 80px, utility header 76px. Tablet navigation at top (768–1023px), phone dock at bottom (<768px), mobile header wraps. Workspace max 1600px. Two-column Home and Settings collapse on phone. Studio tabs wrap. Asset grid auto-fills. Dialog maximum height 85dvh, scrolling enabled. Safe-area bottom padding.

Focus outline 2px #A78BFA, skip link to workspace, named icon buttons, aria-current / aria-pressed, polite job announcements, keyboard-native selects. Reduced motion disables animation; mobile and reduced motion do not initialize a WebGL context. Rendered contrast and screen-reader testing still require browser QA.
