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
