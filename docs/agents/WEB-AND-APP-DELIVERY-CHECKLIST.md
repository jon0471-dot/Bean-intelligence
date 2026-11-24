# CODE GIFTZ — Web and App Delivery Checklist

Run this checklist immediately before declaring any website or application deliverable complete. It is the last pass, executed against the rendered result — not against intentions or source code alone. Every line is pass/fail. A line that cannot be verified in the delivery environment is never ticked silently: it is named in the delivery note as unverified, with the reason.

## 1. How to use this checklist

Work top to bottom after the build. Fix every failure you find, then re-run the affected section. The checklist converts a generated draft into a deliverable: generation without verification is a draft, and a draft is never reported as done. The checklist is cumulative with the quality and honesty gates in the standards set — the gates decide whether the work may be called professional; this checklist decides whether it ships.

## 2. Functional

| Check | Pass condition |
| --- | --- |
| Buttons | Every button performs its visible purpose when clicked. |
| Links | Every link navigates to a real destination; no dead or dangling links. |
| Navigation | Site or app navigation works from every page and every state, including empty and error states. |
| Forms | Every form submits, validates input, and gives clear success and failure feedback. |
| Controls | Every control has its interaction states; anything non-functional is clearly presented as disabled. |
| Data flow | Input travels end to end: entered data is processed and its result is visible in the interface. |

## 3. Responsive

| Check | Pass condition |
| --- | --- |
| Widths | Layout inspected at desktop (~1440/1280px), tablet (~768px) and mobile (~375px). |
| Overflow | No horizontal scrolling and no clipped or collapsed content at any inspected width. |
| Navigation | Navigation is usable at mobile width with a working menu pattern. |
| Touch | Touch targets are comfortable (44px minimum as common practice); text is readable without zoom. |
| Media | Images, video and canvases scale correctly and never break the layout at any width. |

## 4. Visual

| Check | Pass condition |
| --- | --- |
| Overlap | No overlapping or colliding elements anywhere on the page. |
| Assets | No broken images or icons; every asset loads or has a deliberate fallback. |
| Spacing | Spacing follows the token scale consistently across all pages and sections. |
| Type | Typography is consistent: scale, line-height and measure follow the design standard. |
| Colour | Colours match the token system; contrast verified in the actual theme used. |
| Hierarchy | Heading hierarchy is sane on every page; one clear primary action per view. |
| States | Loading, empty, error and success states render correctly, not only the populated happy path. |

## 5. Accessibility

| Check | Pass condition |
| --- | --- |
| Keyboard | The primary flows are operable end to end with the keyboard alone. |
| Focus | Focus is visible on every interactive element; focus order follows the visual order. |
| Labels | Every input has a label; meaningful images have alt text; decoration is aria-hidden. |
| Contrast | Text and meaningful icons pass WCAG AA: 4.5:1 normal text, 3:1 large text. |
| Motion | prefers-reduced-motion is respected: animations skip or fade, ambient canvases fall back to static. |

## 6. Performance

| Check | Pass condition |
| --- | --- |
| Dependencies | No unnecessary heavy dependencies; every vendored or installed library has a demonstrated need. |
| Images | Images are optimized, correctly sized, and not shipped at full resolution. |
| Layout shift | No layout shift on load, and none when content or states arrive. |
| Animation | Animations use compositor-friendly properties (transform, opacity) and leave no jank. |
| Responsiveness | The page remains responsive while animating, including on lower-performance devices. |

## 7. Content

| Check | Pass condition |
| --- | --- |
| Placeholder | No placeholder text, no lorem ipsum, no unfinished copy anywhere. |
| Data | Data is real, or clearly labelled as sample or demo content. |
| Claims | No invented metrics, testimonials, company facts or credentials presented as truth. |
| Specificity | Copy is specific to this product; no generic template prose survives. |
| Consistency | Spelling, capitalisation and terminology are consistent across the deliverable. |

## 8. Technical

| Check | Pass condition |
| --- | --- |
| Build | The real build command runs and passes; the result is recorded truthfully. |
| Tests | Applicable tests run and pass; no test is skipped or weakened to pass. |
| Console | No console errors on load or during the primary flows. |
| Network | No failed network requests (404s, blocked fetches) in the preview. |
| Instructions | The deliverable includes install, build and run instructions that have been verified. |
| Secrets | No secrets, keys or credentials in client code. |

## 9. Delivery honesty

| Check | Pass condition |
| --- | --- |
| Results | Build and test results are reported truthfully — never predicted output presented as actual output. |
| Limitations | Every limitation is named: no backend, demo data, unverified paths, environment constraints. |
| Claims | Every feature claimed as working was exercised in the preview or sandbox, not merely written. |
| Preservation | Existing project content was preserved; nothing was overwritten or deleted unintentionally. |
| Verification | The final answer states what was verified, how it was verified, and what remains unverified. |

## 10. Definition of done

A deliverable is complete only when it has been built, tested in a real browser, and verified — not merely generated. If any section above fails and cannot be fixed, the deliverable may still ship only with those failures named explicitly in the delivery note. Report "done" only when every section passes or its exceptions are named; anything less is a draft, and a draft is labelled as a draft.

---

## Related standards

- [Professional Engineering Standard](./PROFESSIONAL-ENGINEERING-STANDARD.md) — the ten-step workflow that produces what this checklist verifies.
- [Professional UI/UX Design Standard](./PROFESSIONAL-UI-UX-DESIGN-STANDARD.md) — the design rules behind the visual, responsive and accessibility lines.
- [Animation and Interaction Standard](./ANIMATION-AND-INTERACTION-STANDARD.md) — the motion rules behind the performance and reduced-motion lines.
- [Code Quality and Anti-AI-Slop Gates](./CODE-QUALITY-AND-ANTI-AI-SLOP-GATES.md) — the pass/fail gates that run before this checklist.
