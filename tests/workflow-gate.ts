// Devnet integration test for the workflow gate.
//
// Flow: enroll 2 skill mints into the official skills collection, give the buyer
// 1 of each, mint a workflow whose authority is the program's mint-auth PDA,
// publish_workflow with those 2 as prerequisites, then:
//   - buy_workflow succeeds for the holder
//   - buy_workflow fails for a wallet missing a skill
//
// Uses the already-built agent-sdk for createSkillMint (it does the Token-2022 +
// TokenGroupMember enrollment our program's verify_collection_member checks).

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createInitializeMint2Instruction,
  createInitializeMintInstruction,
  createInitializeGroupMemberPointerInstruction,
  getMintLen,
  ExtensionType,
} from "@solana/spl-token";
import { createInitializeMemberInstruction } from "@solana/spl-token-group";
import { assert } from "chai";
import * as fs from "fs";

const IDL = JSON.parse(
  fs.readFileSync(process.cwd() + "/target/idl/agent_workflow_nft.json", "utf8"),
);

const PROGRAM_ID = new PublicKey("3ptXj4yuaQG51WTA3SZZ37jGvYFgMhgXnSKWJLASJNkt");
const SKILLS_COLLECTION = new PublicKey("4exdqNEcXixiMzenEBts2cE7qLmMvcVtHCjsZUGBm4Gt");
const RPC = "https://api.devnet.solana.com";

const ITEM_SEED = Buffer.from("item");
const MINT_AUTH_SEED = Buffer.from("mint-auth");

function loadPayer(): Keypair {
  const raw = JSON.parse(fs.readFileSync(process.env.PAYER_PATH!, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

describe("workflow-gate (devnet)", function () {
  this.timeout(300000);

  const conn = new Connection(RPC, "confirmed");
  const payer = loadPayer(); // also the collection update authority (minter) + creator
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(conn, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new Program(IDL as anchor.Idl, provider);

  // signer shape the sdk expects (publicKey + secretKey-bearing keypair).

  let skillA: PublicKey;
  let skillB: PublicKey;
  let itemMint: PublicKey;
  let mintAuthPda: PublicKey;
  const buyer = payer; // the holder; a fresh keypair plays the "missing skill" role

  before("enroll 2 skills + give buyer 1 of each", async () => {
    skillA = await enrollSkill();
    skillB = await enrollSkill();
    await mintOne(skillA, buyer.publicKey);
    await mintOne(skillB, buyer.publicKey);
  });

  it("mints a workflow whose authority is the program PDA", async () => {
    const wf = Keypair.generate();
    itemMint = wf.publicKey;
    [mintAuthPda] = PublicKey.findProgramAddressSync(
      [MINT_AUTH_SEED, itemMint.toBuffer()],
      PROGRAM_ID,
    );
    const len = getMintLen([]);
    const lamports = await conn.getMinimumBalanceForRentExemption(len);
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: itemMint,
        space: len,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeMintInstruction(itemMint, 0, mintAuthPda, null, TOKEN_2022_PROGRAM_ID),
    );
    await provider.sendAndConfirm(tx, [wf]);
  });

  it("publish_workflow stores the prerequisites", async () => {
    const [config] = PublicKey.findProgramAddressSync(
      [ITEM_SEED, itemMint.toBuffer()],
      PROGRAM_ID,
    );
    await program.methods
      .publishItem([skillA, skillB], new BN(0))
      .accounts({
        creator: payer.publicKey,
        itemMint,
        config,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([
        { pubkey: skillA, isWritable: false, isSigner: false },
        { pubkey: skillB, isWritable: false, isSigner: false },
      ])
      .rpc();
    const cfg = await (program.account as any).itemConfig.fetch(config);
    assert.equal(cfg.requiredSkills.length, 2);
  });

  it("buy_workflow succeeds for the holder", async () => {
    const buyerAta = getAssociatedTokenAddressSync(itemMint, buyer.publicKey, false, TOKEN_2022_PROGRAM_ID);
    await ensureAta(buyerAta, buyer.publicKey, itemMint);
    const sig = await buy(buyer.publicKey, [skillA, skillB], buyerAta);
    assert.ok(sig);
  });

  it("buy_workflow fails for a wallet missing a skill", async () => {
    const stranger = Keypair.generate();
    // give the stranger ONLY skillA (missing skillB) + lamports
    await fund(stranger.publicKey);
    await mintOne(skillA, stranger.publicKey);
    const strangerAtaA = getAssociatedTokenAddressSync(skillA, stranger.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const strangerAtaB = getAssociatedTokenAddressSync(skillB, stranger.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const wfAta = getAssociatedTokenAddressSync(itemMint, stranger.publicKey, false, TOKEN_2022_PROGRAM_ID);
    await ensureAta(wfAta, stranger.publicKey, itemMint, stranger);

    let threw = false;
    try {
      const [config] = PublicKey.findProgramAddressSync([ITEM_SEED, itemMint.toBuffer()], PROGRAM_ID);
      await program.methods
        .buyItem()
        .accounts({
          buyer: stranger.publicKey,
          creator: payer.publicKey,
          config,
          itemMint,
          mintAuthority: mintAuthPda,
          buyerItemAta: wfAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([
          { pubkey: strangerAtaA, isWritable: false, isSigner: false },
          { pubkey: strangerAtaB, isWritable: false, isSigner: false }, // doesn't exist → gate fails
        ])
        .signers([stranger])
        .rpc();
    } catch (e) {
      threw = true;
    }
    assert.isTrue(threw, "buy must fail when a required skill is missing");
  });

  // ── helpers ──────────────────────────────────────────────────────────────

  // Create a Token-2022 mint enrolled in SKILLS_COLLECTION (GroupMemberPointer +
  // TokenGroupMember), mirroring the sdk's createSkillMint. payer is the
  // collection's update authority, so it can sign the member enrollment.
  async function enrollSkill(): Promise<PublicKey> {
    const mintKp = Keypair.generate();
    const mint = mintKp.publicKey;
    const ext = [ExtensionType.GroupMemberPointer];
    const preLen = getMintLen(ext);
    const memberLen = getMintLen([...ext, ExtensionType.TokenGroupMember]) - preLen;
    const lamports = await conn.getMinimumBalanceForRentExemption(preLen + memberLen);
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint,
        space: preLen,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeGroupMemberPointerInstruction(mint, payer.publicKey, mint, TOKEN_2022_PROGRAM_ID),
      createInitializeMint2Instruction(mint, 0, payer.publicKey, payer.publicKey, TOKEN_2022_PROGRAM_ID),
      createInitializeMemberInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        member: mint,
        memberMint: mint,
        memberMintAuthority: payer.publicKey,
        group: SKILLS_COLLECTION,
        groupUpdateAuthority: payer.publicKey,
      }),
    );
    await provider.sendAndConfirm(tx, [mintKp]);
    return mint;
  }

  async function mintOne(mint: PublicKey, owner: PublicKey) {
    const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);
    const tx = new Transaction();
    if (!(await conn.getAccountInfo(ata))) {
      tx.add(createAssociatedTokenAccountInstruction(payer.publicKey, ata, owner, mint, TOKEN_2022_PROGRAM_ID));
    }
    tx.add(createMintToInstruction(mint, ata, payer.publicKey, 1, [], TOKEN_2022_PROGRAM_ID));
    await provider.sendAndConfirm(tx, []);
  }

  async function ensureAta(ata: PublicKey, owner: PublicKey, mint: PublicKey, extraSigner?: Keypair) {
    if (await conn.getAccountInfo(ata)) return;
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(payer.publicKey, ata, owner, mint, TOKEN_2022_PROGRAM_ID),
    );
    await provider.sendAndConfirm(tx, []);
  }

  async function fund(to: PublicKey) {
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: to, lamports: 20_000_000 }),
    );
    await provider.sendAndConfirm(tx, []);
  }

  async function buy(buyerPk: PublicKey, skills: PublicKey[], wfAta: PublicKey) {
    const [config] = PublicKey.findProgramAddressSync([ITEM_SEED, itemMint.toBuffer()], PROGRAM_ID);
    const remaining = skills.map((m) => ({
      pubkey: getAssociatedTokenAddressSync(m, buyerPk, false, TOKEN_2022_PROGRAM_ID),
      isWritable: false,
      isSigner: false,
    }));
    return program.methods
      .buyItem()
      .accounts({
        buyer: buyerPk,
        creator: payer.publicKey,
        config,
        itemMint,
        mintAuthority: mintAuthPda,
        buyerItemAta: wfAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(remaining)
      .rpc();
  }
});
