use crate::constants::OFFICIAL_SKILLS_COLLECTION;
use crate::errors::ErrorCode;
use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{BaseStateWithExtensions, StateWithExtensions},
    state::Mint as MintState,
    ID as TOKEN_2022_ID,
};
use spl_token_group_interface::state::TokenGroupMember;

/// Verify a skill mint belongs to the official AgentNet skills collection.
///
/// Reads the mint's own `TokenGroupMember.group` (ONE account, ONE compare) — we
/// never enumerate the collection, so cost is O(1) per skill no matter how large
/// the collection grows. Reused by publish (validate prerequisites at register
/// time) and anywhere else a "is this a real skill?" check is needed.
///
/// Also confirms the account is genuinely owned by the Token-2022 program, so a
/// forged look-alike account can't pass.
pub fn verify_collection_member(mint_acc: &AccountInfo) -> Result<()> {
    require_keys_eq!(*mint_acc.owner, TOKEN_2022_ID, ErrorCode::NotASkillMint);

    let data = mint_acc.try_borrow_data()?;
    let state = StateWithExtensions::<MintState>::unpack(&data)
        .map_err(|_| error!(ErrorCode::NotASkillMint))?;
    let member = state
        .get_extension::<TokenGroupMember>()
        .map_err(|_| error!(ErrorCode::NotInOfficialCollection))?;

    require_keys_eq!(member.group, OFFICIAL_SKILLS_COLLECTION, ErrorCode::NotInOfficialCollection);
    Ok(())
}
