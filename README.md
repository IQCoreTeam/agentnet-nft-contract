# agent-workflow-nft

On-chain gate for AgentNet **workflow** NFTs. Skills are plain Token-2022 mints
bought freely; a *workflow* can only be minted to a wallet that **holds every
required skill**. The standard can't express a conditional mint on a mint, so this
small Anchor program does the one thing it can't: the workflow mint's authority is
a program PDA, and the only path to a workflow token is `buy_workflow`, which
checks the prerequisites on-chain first.

> Skills do NOT use this program. Only workflows go through here.

## Instructions

- **`publish_workflow(required_skills, price)`** — store the prerequisites in a
  config PDA. Each required skill is validated *once, here*: it must be a real
  Token-2022 mint in the official skills collection, and the list must have no
  duplicates. Validating at publish (mints are immutable) keeps `buy` cheap — no
  per-purchase collection re-check, so cost doesn't grow with the catalog.
- **`buy_workflow()`** — verify on-chain that the buyer holds every required skill
  (each skill token account: owned by the Token-2022 program, right mint, owned by
  buyer, amount ≥ 1), pay the creator if priced, then mint 1 workflow token to the
  buyer via the program's mint-authority PDA.

The buyer's skill token accounts are passed in `remaining_accounts`, one per
required skill, in the same order as the config's `required_skills`.

## How membership is checked (O(1), no collection scan)

A skill mint carries its own `TokenGroupMember.group`. We read that one field and
compare it to the official collection — we never enumerate the collection, so the
check is O(1) per skill no matter how large the collection grows.

## Deployment (devnet)

- Program: `3ptXj4yuaQG51WTA3SZZ37jGvYFgMhgXnSKWJLASJNkt`
- Official skills collection: `4exdqNEcXixiMzenEBts2cE7qLmMvcVtHCjsZUGBm4Gt`
  (set in `constants.rs::OFFICIAL_SKILLS_COLLECTION`)

```bash
anchor build
anchor deploy --provider.cluster devnet
```

Built with Anchor 0.32.1.
