<!-- M21 model-role response for project A (verbatim record of the response
     that the product pipeline parses with parseFiles). Consumed context:
     CODE GIFTZ SYSTEM_PROMPT + the engine brief at
     validation/m21/project-a-landing/plan/brief.md + the user request. -->

Here's your Nebula landing page — a complete React app using the attached kit components (SplitText, BlurText, CountUp, ScrollReveal, AnimatedContent, VantaBackground), the GSAP patterns from the brief (entrance timeline with the branded CustomEase curve, batched scroll reveal, text reveal, hover lift, desktop-only scroll scrub), and the Birds Vanta background. Everything runs offline, degrades honestly (WebGL fallback, reduced motion), and is responsive down to phone widths.

The hero runs the Birds background through the attached `VantaBackground` (it self-manages lazy init, cleanup, WebGL fallback and reduced motion); entrance/scroll/text/hover/scrub motion comes from the pattern hooks in `lib/motion.ts`. Typography, cards, pricing and FAQ are custom semantic HTML styled in `styles.css` with a fluid type scale. Run it with your preferred bundler (the attached `package.json` carries the pinned dependencies).

<!-- end of M21 model-role response for project A -->