use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("requiredSkills exceeds the maximum allowed")]
    TooManyRequiredSkills,
    #[msg("buyer does not hold every required skill (missing at least one)")]
    MissingRequiredSkill,
    #[msg("the provided skill token accounts do not match the required skills")]
    SkillAccountMismatch,
    #[msg("a provided token account is not owned by the buyer")]
    WrongTokenAccountOwner,
    #[msg("a provided token account is not owned by the Token-2022 program (forged?)")]
    NotATokenAccount,
    #[msg("the account is not a valid Token-2022 skill mint")]
    NotASkillMint,
    #[msg("the skill mint is not a member of the official AgentNet skills collection")]
    NotInOfficialCollection,
    #[msg("requiredSkills contains a duplicate skill")]
    DuplicateRequiredSkill,
    #[msg("the buyer already owns this workflow")]
    AlreadyOwned,
    #[msg("the provided fee treasury account does not match the protocol treasury")]
    WrongFeeTreasury,
}
