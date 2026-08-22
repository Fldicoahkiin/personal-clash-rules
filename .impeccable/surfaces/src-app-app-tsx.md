---
version: 1
slug: "src-app-app-tsx"
primary_target: "src/app/App.tsx"
related_targets: ["src/app/components/RouteTester.tsx","src/app/styles.css"]
---

# Homepage

- Scope: public responsive web app; operate mode.
- Audience: one person maintaining routing rules and importing a private subscription.
- Job: test a URL, see the matched rule and policy, then import a subscription or edit rules.
- Primary action: test the URL entered in the first viewport.
- Proof: the tester loads the same files published under `public/rules/`.
- Constraints: no orange; concise Chinese copy; no client-specific product positioning; no secrets.
- Direction: rule atlas structure with a functional railway interlocking path.
- Memorable moment: URL, concrete rule, policy group, and explicit `DIRECT` or `PROXY` result appear as one route.
- Approved comp: `.impeccable/mocks/route-rail/overview.webp`.
- Approved change: ordinary stations stay teal or unfilled; only the concrete-rule station uses a text-labeled green hit or red miss signal.
- Client assets: use the 20px official product icons in `public/client-icons/`; provenance and license boundaries stay in `THIRD_PARTY_NOTICES.md` and each PNG's XMP metadata.
