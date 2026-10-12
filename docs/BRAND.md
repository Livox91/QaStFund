# QastFund brand system

QastFund is positioned as employer-enabled lending and peer-to-peer funding.
The brand promise is **“Finance that moves with you.”**

## Core identity

- Primary: forest green `#0D302B`
- Accent: emerald `#10B981`
- Canvas: warm off-white `#F5F5EF`
- Surface: soft white `#FCFCF8`
- Typography: Inter when available, followed by the existing system sans-serif
  stack
- Mark: a rounded forest tile containing a Q-shaped ring and emerald tail

Application code should use the semantic Tailwind utilities declared in
`src/app/globals.css`: `brand`, `brand-hover`, `brand-soft`, `brand-muted`,
`brand-border`, `accent`, `accent-hover`, `canvas`, and `surface`. Shared UI
components own primary interaction styling; feature screens should avoid
introducing one-off brand hex values.

The code-native mark lives in `src/shared/ui/brand-mark.tsx`. The browser icon
is `src/app/icon.svg`. Product copy should use **QastFund** as one word with a
capital Q and F. Internal protocol, contract, database, environment-variable,
route, and historical audit identifiers retain their existing names for
compatibility.
