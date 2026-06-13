use anchor_lang::prelude::*;

/// On-chain config for one workflow NFT. Created at publish; read at unlock.
///
/// The `required_skills` list lives HERE (on-chain), so the gate is fully
/// self-contained: the unlock instruction reads the prerequisites from this
/// account, not from a client-supplied argument that could be forged.
#[account]
pub struct WorkflowConfig {
    pub bump: u8,
    /// The workflow NFT's Token-2022 mint.
    pub workflow_mint: Pubkey,
    /// The wallet that published this workflow (paid creator on a priced unlock).
    pub creator: Pubkey,
    /// Price in lamports a buyer pays the creator on unlock (0 = free).
    pub price: u64,
    /// The skill mints a wallet MUST hold (≥1 each) to unlock this workflow.
    /// Capped (see MAX_REQUIRED_SKILLS) to bound account size.
    pub required_skills: Vec<Pubkey>,
}

/// Cap the prerequisite list so the account size is bounded and rent is known.
pub const MAX_REQUIRED_SKILLS: usize = 16;

impl WorkflowConfig {
    /// 8 (disc) + 1 (bump) + 32 (mint) + 32 (creator) + 8 (price)
    /// + 4 (vec len) + 32 * MAX_REQUIRED_SKILLS
    pub const SIZE: usize = 8 + 1 + 32 + 32 + 8 + 4 + (32 * MAX_REQUIRED_SKILLS);
}
