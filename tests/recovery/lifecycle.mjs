import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const outputDir = process.env.RECOVERY_TEST_OUTPUT_DIR || mkdtempSync(join(tmpdir(), 'iq-recovery-test-')), r = createRequire(process.env.RECOVERY_TEST_PACKAGE_JSON || import.meta.url), w = r('@solana/web3.js'), t = r('@solana/spl-token'), sdk = r(process.env.RECOVERY_SDK_MODULE || (() => { throw Error('Set RECOVERY_SDK_MODULE to the bundled matching workflowGate.cjs'); })());
const { Surfnet } = await import(pathToFileURL(process.env.RECOVERY_SURFPOOL_MODULE || r.resolve('@solana/surfpool')).href);
const { Keypair, PublicKey, Transaction, SystemProgram, ComputeBudgetProgram } = w;
const payer = Keypair.generate(), owner = Keypair.generate(), recipient = Keypair.generate(), creator = Keypair.generate(), rogue = Keypair.generate(), nextCreator = Keypair.generate(), program = new PublicKey('8YmcHuCx323RtqC8mzTJ5CH4oVT8mPKJ7xarcPKbdgof');
const surf = Surfnet.startWithConfig({ offline: true, payerSecretKey: payer.secretKey, blockProductionMode: 'clock', slotTimeMs: 100 }), connection = new w.Connection(surf.rpcUrl, { commitment: 'confirmed', wsEndpoint: surf.wsUrl });
assert.equal(new URL(connection.rpcEndpoint).hostname, '127.0.0.1');
const binary = process.env.RECOVERY_PROGRAM_SO || fileURLToPath(new URL('../../target/deploy/agent_workflow_nft.so', import.meta.url));
surf.deploy({ programId: program.toBase58(), soPath: binary });
for (const k of [payer, owner, recipient, creator, rogue, nextCreator])
    surf.fundSol(k.publicKey.toBase58(), 50e9);
mkdirSync(outputDir, { recursive: true });
console.log('Evidence directory:', outputDir);
const receipts = [];
let nonce = 0;
async function send(label, ixs, signers, fail = false) { const block = await connection.getLatestBlockhash(), tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: block.blockhash }).add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: nonce++ }), ...ixs); const compiled = tx.compileMessage(), required = compiled.accountKeys.slice(0, compiled.header.numRequiredSignatures).map(k => k.toBase58()); tx.sign(...[...new Map([payer, ...signers].map(k => [k.publicKey.toBase58(), k])).values()].filter(k => required.includes(k.publicKey.toBase58()))); const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true }); await connection.confirmTransaction({ ...block, signature: sig }, 'confirmed'); const receipt = await connection.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }); assert(receipt); receipts.push({ label, signature: sig, error: receipt.meta.err, logs: receipt.meta.logMessages, requiredSigners: required }); if (fail)
    assert(receipt.meta.err, label + ' expected rejection');
else
    assert.equal(receipt.meta.err, null, label + ' ' + JSON.stringify(receipt.meta.logMessages)); console.log(label, fail ? 'rejected as expected' : 'passed'); return receipt; }
async function amounts(f) { const source = await t.getAccount(connection, f.source, 'confirmed', t.TOKEN_2022_PROGRAM_ID), destinationInfo = await connection.getAccountInfo(f.destination, 'confirmed'), destination = destinationInfo ? t.unpackAccount(f.destination, destinationInfo, t.TOKEN_2022_PROGRAM_ID) : { amount: 0n }, mint = await t.getMint(connection, f.mint, 'confirmed', t.TOKEN_2022_PROGRAM_ID); return [source.amount, destination.amount, mint.supply]; }
const metadataApi = r('@solana/spl-token-metadata'), groupApi = r('@solana/spl-token-group');
const skillsGroup = new PublicKey('BUGHnCh2Pf93tgcxAEfhjd6tUjbY56JrSZdCRXyt7uS5'), workflowsGroup = new PublicKey('6vmWMRWUD34LEjA8eGefegKe5E38WufveMAe2pTm61i8'), treasury = new PublicKey('EWNSTD8tikwqHMcRNuuNbZrnYJUiJdKq9UXLXSEU4wZ1');
function bootstrapGroup(key) { const data = Buffer.alloc(t.getMintLen([t.ExtensionType.TokenGroup])); t.MintLayout.encode({ mintAuthorityOption: 1, mintAuthority: creator.publicKey, supply: 0n, decimals: 0, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, data); data[165] = 1; data.writeUInt16LE(t.ExtensionType.TokenGroup, 166); const packed = Buffer.from(groupApi.packTokenGroup({ updateAuthority: sdk.collectionAuthorityPda(), mint: key, size: 0n, maxSize: 1000n })); data.writeUInt16LE(packed.length, 168); packed.copy(data, 170); surf.setAccount(key.toBase58(), 10e6, data, t.TOKEN_2022_PROGRAM_ID.toBase58()); }
async function publish(label, required = [], price = 100000000n) {
    const key = Keypair.generate(), mint = key.publicKey, group = required.length ? workflowsGroup : skillsGroup, extensions = [t.ExtensionType.NonTransferable, t.ExtensionType.MetadataPointer, t.ExtensionType.GroupMemberPointer], pre = t.getMintLen(extensions), meta = { mint, name: label, symbol: 'LOCAL', uri: 'https://example.invalid/local-fixture', additionalMetadata: [] }, space = pre + 4 + metadataApi.pack(meta).length + t.getMintLen([...extensions, t.ExtensionType.TokenGroupMember]) - pre, rent = await connection.getMinimumBalanceForRentExemption(space), ata = t.getAssociatedTokenAddressSync(mint, creator.publicKey, false, t.TOKEN_2022_PROGRAM_ID);
    await send('create mint ' + label, [SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint, space: pre, lamports: rent, programId: t.TOKEN_2022_PROGRAM_ID }), t.createInitializeMetadataPointerInstruction(mint, creator.publicKey, mint, t.TOKEN_2022_PROGRAM_ID), t.createInitializeGroupMemberPointerInstruction(mint, creator.publicKey, mint, t.TOKEN_2022_PROGRAM_ID), t.createInitializeNonTransferableMintInstruction(mint, t.TOKEN_2022_PROGRAM_ID), t.createInitializeMint2Instruction(mint, 0, creator.publicKey, creator.publicKey, t.TOKEN_2022_PROGRAM_ID), metadataApi.createInitializeInstruction({ programId: t.TOKEN_2022_PROGRAM_ID, metadata: mint, updateAuthority: creator.publicKey, mint, mintAuthority: creator.publicKey, name: meta.name, symbol: meta.symbol, uri: meta.uri }), t.createSetAuthorityInstruction(mint, creator.publicKey, t.AuthorityType.MintTokens, sdk.itemMintAuthorityPda(mint), [], t.TOKEN_2022_PROGRAM_ID), t.createAssociatedTokenAccountInstruction(payer.publicKey, ata, creator.publicKey, mint, t.TOKEN_2022_PROGRAM_ID)], [key, creator]);
    assert.equal(await connection.getAccountInfo(sdk.itemConfigPda(mint)), null);
    await send('publish ' + label, [sdk.publishItemIx({ creator: creator.publicKey, itemMint: mint, requiredSkills: required, price, group })], [creator]);
    const state = await t.getMint(connection, mint, 'confirmed', t.TOKEN_2022_PROGRAM_ID);
    assert.equal(state.supply, 1n);
    assert.equal((await t.getAccount(connection, ata, 'confirmed', t.TOKEN_2022_PROGRAM_ID)).amount, 1n);
    const member = t.getTokenGroupMemberState(state);
    assert(member.group.equals(group));
    const metadata = await t.getTokenMetadata(connection, mint, 'confirmed', t.TOKEN_2022_PROGRAM_ID);
    assert(metadata.updateAuthority.equals(sdk.itemMintAuthorityPda(mint)));
    return { mint, required, price, config: sdk.itemConfigPda(mint), source: t.getAssociatedTokenAddressSync(mint, owner.publicKey, false, t.TOKEN_2022_PROGRAM_ID), destination: t.getAssociatedTokenAddressSync(mint, recipient.publicKey, false, t.TOKEN_2022_PROGRAM_ID) };
}
async function buy(f, buyer, creatorKey = creator.publicKey, fail = false) { const ata = t.getAssociatedTokenAddressSync(f.mint, buyer.publicKey, false, t.TOKEN_2022_PROGRAM_ID); if (!await connection.getAccountInfo(ata))
    await send('create buyer ATA', [t.createAssociatedTokenAccountInstruction(payer.publicKey, ata, buyer.publicKey, f.mint, t.TOKEN_2022_PROGRAM_ID)], []); const before = await connection.getBalance(creatorKey), feeBefore = await connection.getBalance(treasury), buyerBefore = await connection.getBalance(buyer.publicKey); await send(fail ? 'stale creator or missing prerequisite purchase rejected' : 'priced purchase ' + f.mint.toBase58(), [sdk.buyItemIx({ buyer: buyer.publicKey, creator: creatorKey, itemMint: f.mint, requiredSkills: f.required })], [buyer], fail); const fee = f.price * 690n / 10000n; assert.equal(BigInt(await connection.getBalance(creatorKey) - before), fail ? 0n : f.price - fee); assert.equal(BigInt(await connection.getBalance(treasury) - feeBefore), fail ? 0n : fee); assert.equal(BigInt(buyerBefore - await connection.getBalance(buyer.publicKey)), fail ? 0n : f.price); }
try {
    bootstrapGroup(skillsGroup);
    bootstrapGroup(workflowsGroup);
    surf.fundSol(treasury.toBase58(), 1e9);
    const skill = await publish('Local skill'), workflow = await publish('Local workflow', [skill.mint], 200000000n);
    await buy(skill, owner);
    await buy(workflow, owner);
    assert.deepEqual(await amounts(skill), [1n, 0n, 2n]);
    assert.deepEqual(await amounts(workflow), [1n, 0n, 2n]);
    await send('ordinary transfer is rejected', [t.createTransferCheckedInstruction(skill.source, skill.mint, skill.destination, owner.publicKey, 1, 0, [], t.TOKEN_2022_PROGRAM_ID)], [owner], true);
    const workflowIx = sdk.migrateItemIx({ owner: owner.publicKey, recipient: recipient.publicKey, itemMint: workflow.mint, requiredSkills: workflow.required });
    const rentBefore = await connection.getBalance(recipient.publicKey);
    await send('published workflow migration requires migrated prerequisite', [workflowIx], [owner, recipient], true);
    assert.equal(await connection.getAccountInfo(workflow.destination), null);
    assert.equal(await connection.getBalance(recipient.publicKey), rentBefore);
    for (const f of [skill, workflow]) {
        const configBefore = (await connection.getAccountInfo(f.config)).data;
        const creatorBefore = await connection.getBalance(creator.publicKey), treasuryBefore = await connection.getBalance(treasury);
        const receipt = await send('migrate genuinely published ' + (f === skill ? 'skill' : 'workflow'), [sdk.migrateItemIx({ owner: owner.publicKey, recipient: recipient.publicKey, itemMint: f.mint, requiredSkills: f.required })], [owner, recipient]);
        assert.deepEqual(await amounts(f), [0n, 1n, 2n]);
        assert((await connection.getAccountInfo(f.config)).data.equals(configBefore));
        assert.equal(await connection.getBalance(creator.publicKey), creatorBefore);
        assert.equal(await connection.getBalance(treasury), treasuryBefore);
        assert(!receipts.at(-1).requiredSigners.includes(creator.publicKey.toBase58()));
    }
    await buy(workflow, owner, creator.publicKey, true);
    const beforeConfig = (await connection.getAccountInfo(skill.config)).data, metaBefore = await t.getTokenMetadata(connection, skill.mint, 'confirmed', t.TOKEN_2022_PROGRAM_ID);
    await send('rotate publisher of real published skill', [sdk.rotateCreatorIx({ creator: creator.publicKey, newCreator: nextCreator.publicKey, itemMint: skill.mint })], [creator, nextCreator]);
    const afterConfig = (await connection.getAccountInfo(skill.config)).data;
    assert(afterConfig.subarray(0, 41).equals(beforeConfig.subarray(0, 41)));
    assert(afterConfig.subarray(73).equals(beforeConfig.subarray(73)));
    assert(new PublicKey(afterConfig.subarray(41, 73)).equals(nextCreator.publicKey));
    await buy(skill, rogue, creator.publicKey, true);
    const formerBalance = await connection.getBalance(creator.publicKey);
    await buy(skill, rogue, nextCreator.publicKey);
    assert.equal(await connection.getBalance(creator.publicKey), formerBalance);
    const creatorAta = t.getAssociatedTokenAddressSync(skill.mint, creator.publicKey, false, t.TOKEN_2022_PROGRAM_ID), newCreatorAta = t.getAssociatedTokenAddressSync(skill.mint, nextCreator.publicKey, false, t.TOKEN_2022_PROGRAM_ID);
    await send('migrate publisher self copy independently', [sdk.migrateItemIx({ owner: creator.publicKey, recipient: nextCreator.publicKey, itemMint: skill.mint, requiredSkills: [] })], [creator, nextCreator]);
    assert.equal((await t.getAccount(connection, creatorAta, 'confirmed', t.TOKEN_2022_PROGRAM_ID)).amount, 0n);
    assert.equal((await t.getAccount(connection, newCreatorAta, 'confirmed', t.TOKEN_2022_PROGRAM_ID)).amount, 1n);
    assert.equal((await t.getAccount(connection, skill.destination, 'confirmed', t.TOKEN_2022_PROGRAM_ID)).amount, 1n);
    assert.equal((await t.getMint(connection, skill.mint, 'confirmed', t.TOKEN_2022_PROGRAM_ID)).supply, 3n);
    assert.deepEqual(await t.getTokenMetadata(connection, skill.mint, 'confirmed', t.TOKEN_2022_PROGRAM_ID), metaBefore);
    await writeFile(join(outputDir, 'lifecycle-surfpool-proof.json'), JSON.stringify({ scope: 'Offline Surfpool; generated keys; only canonical collection genesis fixtures injected. No ItemConfig or item/token balances injected. Actual Token-2022 mint creation and actual publish/buy/migrate/rotate instructions.', programSha256: createHash('sha256').update(await readFile(binary)).digest('hex'), cases: receipts, proven: ['real skill and workflow publishing', 'official group membership and metadata authority', 'priced purchases and exact protocol split', 'purchased entitlement migrations without publisher signature or repurchase charge', 'workflow prerequisite ordering and failed rent rollback', 'creator rotation preserves config fields and metadata', 'subsequent sales pay new creator', 'publisher self-copy migration distinct from creator rotation', 'customer copy preserved after publisher migration'], sentToPublicNetwork: false }, null, 2) + '\n');
    console.log('Full publish, purchase, migration and payout lifecycle passed.');
}
finally {
    connection._rpcWebSocket.close();
    surf.stop();
}
