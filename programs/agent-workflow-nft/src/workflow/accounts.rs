use anchor_lang::prelude::*;

/// On-chain config for one item NFT (a skill OR a workflow). Created at publish;
/// read at buy.
///
/// `required_skills` is the prerequisite list, stored ON-CHAIN so the gate is
/// self-contained (buy reads it from here, not from a forgeable client argument):
///   - empty  → a plain SKILL (no prerequisite; anyone can buy)
///   - filled → a WORKFLOW (buyer must hold every listed skill)
#[account]
pub struct ItemConfig {
    pub bump: u8,
    /// The item NFT's Token-2022 mint.
    pub item_mint: Pubkey,
    /// The wallet that published this item (paid creator on a priced buy).
    pub creator: Pubkey,
    /// Price in lamports a buyer pays the creator (0 = free).
    pub price: u64,
    /// Prerequisite skill mints (empty for a skill; the gate for a workflow).
    /// Capped (see MAX_REQUIRED_SKILLS) to bound account size.
    pub required_skills: Vec<Pubkey>,
}

/// Cap the prerequisite list so the account size is bounded and rent is known.
pub const MAX_REQUIRED_SKILLS: usize = 16;

impl ItemConfig {
    /// 8 (disc) + 1 (bump) + 32 (mint) + 32 (creator) + 8 (price)
    /// + 4 (vec len) + 32 * MAX_REQUIRED_SKILLS
    pub const SIZE: usize = 8 + 1 + 32 + 32 + 8 + 4 + (32 * MAX_REQUIRED_SKILLS);
}
