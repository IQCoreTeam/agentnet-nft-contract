use anchor_lang::prelude::*;

/// The official AgentNet **skills** collection mint (Token-2022 TokenGroup).
/// Only skills enrolled under this group count as prerequisites — a workflow
/// can't require some unrelated token. Set to the real collection mint before
/// deploy; the all-1s System Program address is a deliberate "unset" sentinel.
///
/// Membership is read from each skill mint's TokenGroupMember.group (one account,
/// one compare) — we never enumerate the collection, so this is O(1) per skill
/// regardless of how many skills exist.
#[cfg(not(feature = "devnet"))]
pub const OFFICIAL_SKILLS_COLLECTION: Pubkey = pubkey!("BUGHnCh2Pf93tgcxAEfhjd6tUjbY56JrSZdCRXyt7uS5");
#[cfg(feature = "devnet")]
pub const OFFICIAL_SKILLS_COLLECTION: Pubkey = pubkey!("5TPKvxXTpPVFrj9MUnFUr6XiGFEdtetsTvwRh6bKQ9Qg");

/// The official AgentNet **workflows** collection mint (Token-2022 TokenGroup).
/// Workflows enroll here (skills enroll in OFFICIAL_SKILLS_COLLECTION). publish_item
/// stamps membership on whichever of the two an item belongs to, PDA-signed, so no
/// off-chain minter key is needed.
#[cfg(not(feature = "devnet"))]
pub const OFFICIAL_WORKFLOWS_COLLECTION: Pubkey = pubkey!("6vmWMRWUD34LEjA8eGefegKe5E38WufveMAe2pTm61i8");
#[cfg(feature = "devnet")]
pub const OFFICIAL_WORKFLOWS_COLLECTION: Pubkey = pubkey!("F474VEn2uevpCotRqrPEbZ4XvWyqrqL4iGmNnmp9zvNe");

/// The protocol fee treasury. On every priced buy, FEE_BPS of the price is
/// transferred here and the rest goes to the creator (the fee comes OUT of the
/// price — the buyer pays exactly `price`, the creator nets `price - fee`). The
/// treasury is a fixed constant and the buy instruction requires the passed
/// account to equal it, so the fee can't be redirected.
pub const FEE_TREASURY: Pubkey =
    pubkey!("EWNSTD8tikwqHMcRNuuNbZrnYJUiJdKq9UXLXSEU4wZ1");

/// Protocol fee, in basis points (1 bps = 0.01%). 690 bps = 6.9%.
pub const FEE_BPS: u64 = 690;
