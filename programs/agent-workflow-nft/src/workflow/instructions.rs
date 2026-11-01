use super::accounts::MAX_REQUIRED_SKILLS;
use super::contexts::{BuyItem, MigrateItem, PublishItem, COLLECTION_AUTH_SEED, MINT_AUTH_SEED};
use crate::constants::{
    FEE_BPS, FEE_TREASURY, OFFICIAL_SKILLS_COLLECTION, OFFICIAL_WORKFLOWS_COLLECTION,
};
use crate::errors::ErrorCode;
use crate::helpers::verify_collection_member;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use anchor_lang::system_program;
use anchor_spl::token_2022::spl_token_2022::extension::{
    non_transferable::NonTransferable, BaseStateWithExtensions, StateWithExtensions,
};
use anchor_spl::token_2022::spl_token_2022::ID as TOKEN_2022_ID;
use anchor_spl::token_interface::{self, MintTo};
use spl_pod::optional_keys::OptionalNonZeroPubkey;
use spl_token_metadata_interface::instruction::update_authority as token_metadata_update_authority;

/// Register an item (skill or workflow) on-chain: store creator, price, and the
/// prerequisite list in the config PDA.
///   - required_skills EMPTY  → a skill (no prerequisite).
///   - required_skills FILLED → a workflow. Each is validated HERE, once: a real
///     Token-2022 mint in the official skills collection, no duplicates. Passed in
///     `remaining_accounts`, one per required_skill, same order.
/// Validating at publish (mints are immutable) keeps buy cheap — no per-purchase
/// collection re-check, so cost doesn't grow with the catalog.
pub fn publish_item(
    ctx: Context<PublishItem>,
    required_skills: Vec<Pubkey>,
    price: u64,
) -> Result<()> {
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
    config.item_mint = ctx.accounts.item_mint.key();
    config.creator = ctx.accounts.creator.key();
    config.price = price;
    config.required_skills = required_skills;

    // ── enroll the item into its official TokenGroup (PDA-signed) ───────────
    // Membership powers off-chain discovery (the indexer filters mints by their
    // TokenGroupMember.group) and the on-chain prerequisite check. The program's
    // collection-authority PDA is the group update authority, so the stamp needs
    // NO off-chain minter key; the item's mint-auth PDA co-signs as the member's
    // mint authority (it owns the mint by publish time). Done before the self-mint
    // (supply still 0). `group` must be one of the two official collections.
    let item_mint_key = ctx.accounts.item_mint.key();
    let auth_bump = ctx.bumps.mint_authority;
    let group_key = ctx.accounts.group.key();
    require!(
        group_key == OFFICIAL_SKILLS_COLLECTION || group_key == OFFICIAL_WORKFLOWS_COLLECTION,
        ErrorCode::NotInOfficialCollection
    );
    let coll_auth_bump = ctx.bumps.collection_authority;
    let enroll_seeds: &[&[&[u8]]] = &[
        &[MINT_AUTH_SEED, item_mint_key.as_ref(), &[auth_bump]],
        &[COLLECTION_AUTH_SEED, &[coll_auth_bump]],
    ];
    invoke_signed(
        &spl_token_group_interface::instruction::initialize_member(
            &TOKEN_2022_ID,
            &item_mint_key,                           // member
            &item_mint_key,                           // member_mint
            &ctx.accounts.mint_authority.key(),       // member_mint_authority (mint-auth PDA)
            &group_key,                               // group
            &ctx.accounts.collection_authority.key(), // group_update_authority (PDA)
        ),
        &[
            ctx.accounts.item_mint.to_account_info(),
            ctx.accounts.mint_authority.to_account_info(),
            ctx.accounts.group.to_account_info(),
            ctx.accounts.collection_authority.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        ],
        enroll_seeds,
    )?;

    // ── mint 1 item token to the creator (PDA authority) ────────────────────
    // The author owns the first copy of what they publish (supply 0 -> 1), so they
    // can use/note their own skill and the count is honest. No fee here — this is a
    // self-mint at publish, not a priced buy_item.
    let signer_seeds: &[&[&[u8]]] = &[&[MINT_AUTH_SEED, item_mint_key.as_ref(), &[auth_bump]]];

    token_interface::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.item_mint.to_account_info(),
                to: ctx.accounts.creator_item_ata.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
            signer_seeds,
        ),
        1,
    )?;

    // Freeze the item on-chain: the creator signs publish, so hand its metadata update
    // authority to the mint-auth PDA here. No instruction signs that PDA for an edit yet,
    // so the item is immutable and no client can register a still-editable item.
    invoke(
        &token_metadata_update_authority(
            &TOKEN_2022_ID,
            &item_mint_key,
            &ctx.accounts.creator.key(),
            OptionalNonZeroPubkey(ctx.accounts.mint_authority.key()),
        ),
        &[
            ctx.accounts.item_mint.to_account_info(),
            ctx.accounts.creator.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        ],
    )?;

    Ok(())
}

fn verify_required_skills(
    required: &[Pubkey],
    holder: Pubkey,
    accounts: &[AccountInfo<'_>],
) -> Result<()> {
    // One skill token account per required skill, same order, in remaining_accounts.
    // (Empty for a skill → no gate.)
    require!(
        accounts.len() == required.len(),
        ErrorCode::SkillAccountMismatch
    );

    let buyer_key = holder;

    // ── the prerequisite gate (on-chain) ───────────────────────────────────
    // Each account MUST be a real Token-2022 token account (owner = Token-2022
    // program) — otherwise a forged look-alike could spoof the balance. Read the
    // fixed SPL layout (mint[0..32], owner[32..64], amount[64..72]). The skill
    // mints were already verified to be official-collection members at publish,
    // so buy stays cheap: just "real account, right mint, owned by buyer, ≥1".
    for (required_mint, acc_info) in required.iter().zip(accounts.iter()) {
        require_keys_eq!(*acc_info.owner, TOKEN_2022_ID, ErrorCode::NotATokenAccount);

        let data = acc_info.try_borrow_data()?;
        require!(data.len() >= 72, ErrorCode::NotATokenAccount);

        let mint =
            Pubkey::try_from(&data[0..32]).map_err(|_| error!(ErrorCode::SkillAccountMismatch))?;
        let owner = Pubkey::try_from(&data[32..64])
            .map_err(|_| error!(ErrorCode::WrongTokenAccountOwner))?;
        let amount = u64::from_le_bytes(data[64..72].try_into().unwrap());

        require_keys_eq!(mint, *required_mint, ErrorCode::SkillAccountMismatch);
        require_keys_eq!(owner, buyer_key, ErrorCode::WrongTokenAccountOwner);
        require!(amount >= 1, ErrorCode::MissingRequiredSkill);
    }

    Ok(())
}

/// Buy an item. For a workflow, verify ON-CHAIN that the buyer holds every
/// required skill (a skill has none, so the gate is a no-op). Then pay the creator
/// (if priced) and mint 1 token to the buyer using the program's mint-auth PDA. A
/// client cannot bypass this with a raw mint instruction: the mint authority is a
/// PDA only this program can sign for.
pub fn buy_item(ctx: Context<BuyItem>) -> Result<()> {
    let config = &ctx.accounts.config;
    verify_required_skills(
        &config.required_skills,
        ctx.accounts.buyer.key(),
        ctx.remaining_accounts,
    )?;

    // ── pay out (priced buy): protocol fee + creator, both OUT of the price ───
    // The buyer pays exactly `price`. FEE_BPS goes to the fixed treasury, the
    // remainder to the creator. The treasury account is required to equal the
    // FEE_TREASURY constant, so the fee can't be skipped or redirected.
    if config.price > 0 {
        require_keys_eq!(
            ctx.accounts.fee_treasury.key(),
            FEE_TREASURY,
            ErrorCode::WrongFeeTreasury
        );

        // 6.9% of the price (integer math; the creator gets the rounding remainder).
        let fee = (config.price as u128 * FEE_BPS as u128 / 10_000u128) as u64;
        let to_creator = config.price - fee;

        if fee > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.buyer.to_account_info(),
                        to: ctx.accounts.fee_treasury.to_account_info(),
                    },
                ),
                fee,
            )?;
        }

        if to_creator > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.buyer.to_account_info(),
                        to: ctx.accounts.creator.to_account_info(),
                    },
                ),
                to_creator,
            )?;
        }
    }

    // ── mint 1 item token to the buyer (PDA authority) ──────────────────────
    let item_mint_key = ctx.accounts.item_mint.key();
    let auth_bump = ctx.bumps.mint_authority;
    let signer_seeds: &[&[&[u8]]] = &[&[MINT_AUTH_SEED, item_mint_key.as_ref(), &[auth_bump]]];

    token_interface::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.item_mint.to_account_info(),
                to: ctx.accounts.buyer_item_ata.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
            signer_seeds,
        ),
        1,
    )?;

    Ok(())
}

pub fn migrate_item(ctx: Context<MigrateItem>) -> Result<()> {
    verify_required_skills(
        &ctx.accounts.config.required_skills,
        ctx.accounts.recipient.key(),
        ctx.remaining_accounts,
    )?;
    require_keys_neq!(
        ctx.accounts.owner.key(),
        ctx.accounts.recipient.key(),
        ErrorCode::SameMigrationOwner
    );
    require!(
        ctx.accounts.source.amount == 1 && ctx.accounts.destination.amount == 0,
        ErrorCode::InvalidMigrationBalance
    );
    require!(
        ctx.accounts.item_mint.decimals == 0,
        ErrorCode::InvalidMigrationMint
    );
    {
        let account = ctx.accounts.item_mint.to_account_info();
        let data = account.try_borrow_data()?;
        let mint =
            StateWithExtensions::<anchor_spl::token_2022::spl_token_2022::state::Mint>::unpack(
                &data,
            )?;
        require!(
            mint.get_extension::<NonTransferable>().is_ok(),
            ErrorCode::InvalidMigrationMint
        );
    }

    // Both CPIs share one transaction: failed issuance rolls the burn back.
    token_interface::burn_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token_interface::BurnChecked {
                mint: ctx.accounts.item_mint.to_account_info(),
                from: ctx.accounts.source.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        1,
        0,
    )?;
    let mint = ctx.accounts.item_mint.key();
    let seeds: &[&[&[u8]]] = &[&[MINT_AUTH_SEED, mint.as_ref(), &[ctx.bumps.mint_authority]]];
    token_interface::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.item_mint.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
            seeds,
        ),
        1,
    )
}
