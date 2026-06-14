use anchor_lang::prelude::*;

/// The official AgentNet **skills** collection mint (Token-2022 TokenGroup).
/// Only skills enrolled under this group count as prerequisites — a workflow
/// can't require some unrelated token. Set to the real collection mint before
/// deploy; the all-1s System Program address is a deliberate "unset" sentinel.
///
/// Membership is read from each skill mint's TokenGroupMember.group (one account,
/// one compare) — we never enumerate the collection, so this is O(1) per skill
/// regardless of how many skills exist.
pub const OFFICIAL_SKILLS_COLLECTION: Pubkey =
    pubkey!("4exdqNEcXixiMzenEBts2cE7qLmMvcVtHCjsZUGBm4Gt");

/// The protocol fee treasury. On every priced buy, FEE_BPS of the price is
/// transferred here and the rest goes to the creator (the fee comes OUT of the
/// price — the buyer pays exactly `price`, the creator nets `price - fee`). The
/// treasury is a fixed constant and the buy instruction requires the passed
/// account to equal it, so the fee can't be redirected.
pub const FEE_TREASURY: Pubkey =
    pubkey!("EWNSTD8tikwqHMcRNuuNbZrnYJUiJdKq9UXLXSEU4wZ1");

/// Protocol fee, in basis points (1 bps = 0.01%). 690 bps = 6.9%.
pub const FEE_BPS: u64 = 690;
