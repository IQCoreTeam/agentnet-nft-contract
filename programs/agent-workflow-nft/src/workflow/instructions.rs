use super::accounts::MAX_REQUIRED_SKILLS;
use super::contexts::{PublishWorkflow, UnlockWorkflow, MINT_AUTH_SEED};
use crate::errors::ErrorCode;
use crate::helpers::verify_collection_member;
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token_2022::spl_token_2022::ID as TOKEN_2022_ID;
use anchor_spl::token_interface::{self, MintTo};

/// Record a workflow's prerequisites on-chain. Each required skill is validated
/// HERE, once, at register time:
///   - it's a real Token-2022 mint in the official skills collection (so a
///     workflow can't require some unrelated token), and
///   - the list has no duplicates (so a buyer can't satisfy [A,A,A] with one A).
/// The skill mints are passed in `remaining_accounts`, one per required_skill,
/// same order. Validating at publish (mints are immutable) keeps unlock cheap —
/// no per-purchase collection re-check, so cost doesn't grow with the catalog.
pub fn publish_workflow(
    ctx: Context<PublishWorkflow>,
    required_skills: Vec<Pubkey>,
    price: u64,
) -> Result<()> {
    require!(!required_skills.is_empty(), ErrorCode::EmptyRequiredSkills);
    require!(
        required_skills.len() <= MAX_REQUIRED_SKILLS,
        ErrorCode::TooManyRequiredSkills
    );
    require!(
        ctx.remaining_accounts.len() == required_skills.len(),
        ErrorCode::SkillAccountMismatch
    );

    for (i, skill) in required_skills.iter().enumerate() {
        // No duplicates.
        require!(
            !required_skills[..i].contains(skill),
            ErrorCode::DuplicateRequiredSkill
        );
        // The passed mint account must BE this skill, and be an official-collection member.
        let mint_acc = &ctx.remaining_accounts[i];
        require_keys_eq!(*mint_acc.key, *skill, ErrorCode::SkillAccountMismatch);
        verify_collection_member(mint_acc)?;
    }

    let config = &mut ctx.accounts.config;
    config.bump = ctx.bumps.config;
    config.workflow_mint = ctx.accounts.workflow_mint.key();
    config.creator = ctx.accounts.creator.key();
    config.price = price;
    config.required_skills = required_skills;
    Ok(())
}

/// Buy (unlock) a workflow. Verify — ON-CHAIN — that the buyer holds every
/// required skill, then pay the creator (if priced) and mint 1 workflow token to
/// the buyer using the program's mint-authority PDA. A client cannot bypass this
/// by sending the raw mint instruction: the mint authority is a PDA only this
/// program can sign for.
pub fn buy_workflow(ctx: Context<UnlockWorkflow>) -> Result<()> {
    let config = &ctx.accounts.config;
    let required = &config.required_skills;

    // One skill token account per required skill, same order, in remaining_accounts.
    require!(
        ctx.remaining_accounts.len() == required.len(),
        ErrorCode::SkillAccountMismatch
    );

    let buyer_key = ctx.accounts.buyer.key();

    // ── the prerequisite gate (on-chain) ───────────────────────────────────
    // Each account MUST be a real Token-2022 token account (owner = Token-2022
    // program) — otherwise a forged look-alike could spoof the balance. Read the
    // fixed SPL layout (mint[0..32], owner[32..64], amount[64..72]). The skill
    // mints were already verified to be official-collection members at publish,
    // so unlock stays cheap: just "real account, right mint, owned by buyer, ≥1".
    for (required_mint, acc_info) in required.iter().zip(ctx.remaining_accounts.iter()) {
        require_keys_eq!(*acc_info.owner, TOKEN_2022_ID, ErrorCode::NotATokenAccount);

        let data = acc_info.try_borrow_data()?;
        require!(data.len() >= 72, ErrorCode::NotATokenAccount);

        let mint = Pubkey::try_from(&data[0..32]).map_err(|_| error!(ErrorCode::SkillAccountMismatch))?;
        let owner = Pubkey::try_from(&data[32..64]).map_err(|_| error!(ErrorCode::WrongTokenAccountOwner))?;
        let amount = u64::from_le_bytes(data[64..72].try_into().unwrap());

        require_keys_eq!(mint, *required_mint, ErrorCode::SkillAccountMismatch);
        require_keys_eq!(owner, buyer_key, ErrorCode::WrongTokenAccountOwner);
        require!(amount >= 1, ErrorCode::MissingRequiredSkill);
    }

    // ── pay the creator (priced unlock) ─────────────────────────────────────
    if config.price > 0 {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.creator.to_account_info(),
                },
            ),
            config.price,
        )?;
    }

    // ── mint 1 workflow token to the buyer (PDA authority) ──────────────────
    let workflow_mint_key = ctx.accounts.workflow_mint.key();
    let auth_bump = ctx.bumps.mint_authority;
    let signer_seeds: &[&[&[u8]]] = &[&[MINT_AUTH_SEED, workflow_mint_key.as_ref(), &[auth_bump]]];

    token_interface::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.workflow_mint.to_account_info(),
                to: ctx.accounts.buyer_workflow_ata.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
            signer_seeds,
        ),
        1,
    )?;

    Ok(())
}
