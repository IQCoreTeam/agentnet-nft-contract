use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod helpers;
pub mod workflow;

pub use errors::ErrorCode;
pub use workflow::contexts::*;

declare_id!("8YmcHuCx323RtqC8mzTJ5CH4oVT8mPKJ7xarcPKbdgof");

/// AgentNet item NFT gate (skills AND workflows).
///
/// We don't deploy our own NFT standard — items are standard Token-2022 mints.
/// What this program adds is the one thing the standard can't enforce on a mint:
/// a *conditional* mint. Every item mint's authority is a PDA only this program
/// can sign for, so the sole way to get a token is `buy_item`.
///
/// One model covers both: an item's `required_skills` is empty for a **skill**
/// (anyone can buy) and filled for a **workflow** (buyer must hold every listed
/// skill). The gate loop simply runs zero times for a skill.
#[program]
pub mod agent_workflow_nft {
    use super::*;

    /// Register an item: store creator, price, and required_skills in a config
    /// PDA. Empty required_skills = a skill; filled = a workflow. The item mint's
    /// authority must already be the mint-auth PDA.
    pub fn publish_item(
        ctx: Context<PublishItem>,
        required_skills: Vec<Pubkey>,
        price: u64,
    ) -> Result<()> {
        workflow::instructions::publish_item(ctx, required_skills, price)
    }

    /// Buy an item: verify the buyer holds every required skill (none for a
    /// skill), pay the creator if priced, then mint 1 token to the buyer.
    pub fn buy_item(ctx: Context<BuyItem>) -> Result<()> {
        workflow::instructions::buy_item(ctx)
    }
}
