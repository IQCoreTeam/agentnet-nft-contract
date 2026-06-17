use super::accounts::ItemConfig;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Seed prefix for an item's config PDA: ["item", item_mint].
pub const ITEM_SEED: &[u8] = b"item";
/// Seed for the program's mint-authority PDA: ["mint-auth", item_mint].
pub const MINT_AUTH_SEED: &[u8] = b"mint-auth";
/// Seed for the program's collection-authority PDA: ["collection-auth"]. This one
/// global PDA is the update authority of BOTH official TokenGroups (skills and
/// workflows), so the program — not an off-chain minter key — signs member
/// enrollment when an item is published.
pub const COLLECTION_AUTH_SEED: &[u8] = b"collection-auth";

/// publish_item — create the on-chain config (creator, price, required_skills),
/// and record the item mint whose authority is the program's mint-auth PDA.
#[derive(Accounts)]
pub struct PublishItem<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    /// The item NFT mint. Its mint authority MUST already be the mint-auth PDA
    /// (set when the mint was created), so only this program can issue it. `mut`
    /// because publishing mints 1 copy to the creator (supply 0 -> 1).
    #[account(mut)]
    pub item_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = creator,
        seeds = [ITEM_SEED, item_mint.key().as_ref()],
        bump,
        space = ItemConfig::SIZE,
    )]
    pub config: Account<'info, ItemConfig>,

    /// The program's PDA that holds the item mint authority (same one buy_item uses).
    /// CHECK: validated by seeds; used only as the mint authority signer.
    #[account(
        seeds = [MINT_AUTH_SEED, item_mint.key().as_ref()],
        bump,
    )]
    pub mint_authority: UncheckedAccount<'info>,

    /// The creator's token account for the item mint — receives the 1 self-owned copy.
    #[account(
        mut,
        token::mint = item_mint,
        token::authority = creator,
    )]
    pub creator_item_ata: InterfaceAccount<'info, TokenAccount>,

    /// The official TokenGroup the item joins — the skills OR the workflows
    /// collection mint. `mut`: InitializeMember bumps the group's member count.
    /// The handler requires this to be one of the two official collections.
    /// CHECK: a Token-2022 group mint; key validated in the handler.
    #[account(mut)]
    pub group: UncheckedAccount<'info>,

    /// The program PDA that owns both official collections' group update authority.
    /// Signs InitializeMember so membership is stamped on-chain with no off-chain key.
    /// CHECK: validated by seeds; signer only.
    #[account(
        seeds = [COLLECTION_AUTH_SEED],
        bump,
    )]
    pub collection_authority: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// buy_item — verify the buyer holds every required skill (none for a plain
/// skill), pay the creator if priced, then mint 1 token to the buyer using the
/// program's mint-auth PDA.
///
/// The buyer's skill token accounts are passed in `remaining_accounts` (one per
/// required skill, in the same order as `config.required_skills`). For a skill
/// (empty required_skills) there are no remaining accounts and the gate is a no-op.
#[derive(Accounts)]
pub struct BuyItem<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: paid the price (minus fee); matched against config.creator in the handler.
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,

    /// The protocol fee treasury. The handler requires this to equal FEE_TREASURY,
    /// so the fee can't be redirected. Receives FEE_BPS of the price on a priced buy.
    /// CHECK: matched against the FEE_TREASURY constant in the handler.
    #[account(mut)]
    pub fee_treasury: UncheckedAccount<'info>,

    #[account(
        seeds = [ITEM_SEED, item_mint.key().as_ref()],
        bump = config.bump,
        has_one = item_mint,
        has_one = creator,
    )]
    pub config: Account<'info, ItemConfig>,

    #[account(mut)]
    pub item_mint: InterfaceAccount<'info, Mint>,

    /// The program's PDA that holds the item mint authority.
    /// CHECK: validated by seeds; used only as the mint authority signer.
    #[account(
        seeds = [MINT_AUTH_SEED, item_mint.key().as_ref()],
        bump,
    )]
    pub mint_authority: UncheckedAccount<'info>,

    /// The buyer's token account for the item mint (receives the token).
    /// Constrained to THIS mint and owned by the buyer.
    #[account(
        mut,
        token::mint = item_mint,
        token::authority = buyer,
    )]
    pub buyer_item_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    // remaining_accounts: the buyer's skill token accounts, one per required skill.
}
