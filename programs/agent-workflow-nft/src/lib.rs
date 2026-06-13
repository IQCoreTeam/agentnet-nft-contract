use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod helpers;
pub mod workflow;

pub use errors::ErrorCode;
pub use workflow::contexts::*;

declare_id!("3ptXj4yuaQG51WTA3SZZ37jGvYFgMhgXnSKWJLASJNkt");

/// AgentNet workflow NFT gate.
///
/// A workflow can only be unlocked by a wallet that holds EVERY required skill.
/// We don't deploy our own NFT standard — skills/workflows are standard Token-2022
/// mints. What this program adds is the one thing the standard can't enforce on a
/// mint: a *conditional* mint. The workflow mint's authority is a PDA only this
/// program can sign for, so the sole way to get a workflow token is through
/// `unlock_workflow`, which checks the prerequisites on-chain first.
///
/// Skills do NOT use this program — a skill is bought freely. Only workflows,
/// which gate on owning their constituent skills, go through here.
#[program]
pub mod agent_workflow_nft {
    use super::*;

    /// Record a workflow's required skills + price on-chain (config PDA).
    /// The workflow mint's authority must already be the mint-auth PDA.
    pub fn publish_workflow(
        ctx: Context<PublishWorkflow>,
        required_skills: Vec<Pubkey>,
        price: u64,
    ) -> Result<()> {
        workflow::instructions::publish_workflow(ctx, required_skills, price)
    }

    /// Buy a workflow: verify the buyer holds every required skill (on-chain),
    /// pay the creator if priced, then mint 1 workflow token to the buyer.
    pub fn buy_workflow(ctx: Context<UnlockWorkflow>) -> Result<()> {
        workflow::instructions::buy_workflow(ctx)
    }
}
