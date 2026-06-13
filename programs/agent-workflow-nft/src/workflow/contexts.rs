use super::accounts::WorkflowConfig;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Seed prefix for a workflow's config PDA: ["workflow", workflow_mint].
pub const WORKFLOW_SEED: &[u8] = b"workflow";
/// Seed for the program's mint-authority PDA: ["mint-auth", workflow_mint].
pub const MINT_AUTH_SEED: &[u8] = b"mint-auth";

/// publish_workflow — create the on-chain config holding required_skills, and
/// record the workflow mint whose authority is the program's mint-auth PDA.
#[derive(Accounts)]
pub struct PublishWorkflow<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    /// The workflow NFT mint. Its mint authority MUST already be the mint-auth
    /// PDA (set when the mint was created), so only this program can issue it.
    pub workflow_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = creator,
        seeds = [WORKFLOW_SEED, workflow_mint.key().as_ref()],
        bump,
        space = WorkflowConfig::SIZE,
    )]
    pub config: Account<'info, WorkflowConfig>,

    pub system_program: Program<'info, System>,
}

/// unlock_workflow — verify the buyer holds every required skill (on-chain),
/// pay the creator if priced, then mint 1 workflow token to the buyer using the
/// program's mint-auth PDA.
///
/// The buyer's skill token accounts are passed in `remaining_accounts` (one per
/// required skill, in the same order as `config.required_skills`). The handler
/// checks each: correct mint, owned by buyer, amount ≥ 1.
#[derive(Accounts)]
pub struct UnlockWorkflow<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: paid the price; matched against config.creator in the handler.
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,

    #[account(
        seeds = [WORKFLOW_SEED, workflow_mint.key().as_ref()],
        bump = config.bump,
        has_one = workflow_mint,
        has_one = creator,
    )]
    pub config: Account<'info, WorkflowConfig>,

    #[account(mut)]
    pub workflow_mint: InterfaceAccount<'info, Mint>,

    /// The program's PDA that holds the workflow mint authority.
    /// CHECK: validated by seeds; used only as the mint authority signer.
    #[account(
        seeds = [MINT_AUTH_SEED, workflow_mint.key().as_ref()],
        bump,
    )]
    pub mint_authority: UncheckedAccount<'info>,

    /// The buyer's token account for the workflow mint (receives the token).
    /// Constrained to THIS mint and owned by the buyer, so the token can't be
    /// minted to an unrelated account.
    #[account(
        mut,
        token::mint = workflow_mint,
        token::authority = buyer,
    )]
    pub buyer_workflow_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    // remaining_accounts: the buyer's skill token accounts, one per required skill.
}
