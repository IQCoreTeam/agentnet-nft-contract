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
async function fixture(label, destinationAmount = 0, required = [], withDestination = true) { const mint = Keypair.generate(), len = t.getMintLen([t.ExtensionType.NonTransferable]), rent = await connection.getMinimumBalanceForRentExemption(len), source = t.getAssociatedTokenAddressSync(mint.publicKey, owner.publicKey, false, t.TOKEN_2022_PROGRAM_ID), destination = t.getAssociatedTokenAddressSync(mint.publicKey, recipient.publicKey, false, t.TOKEN_2022_PROGRAM_ID), auth = sdk.itemMintAuthorityPda(mint.publicKey), config = sdk.itemConfigPda(mint.publicKey), bump = PublicKey.findProgramAddressSync([Buffer.from('item'), mint.publicKey.toBuffer()], program)[1]; await send('fixture ' + label, [SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, space: len, lamports: rent, programId: t.TOKEN_2022_PROGRAM_ID }), t.createInitializeNonTransferableMintInstruction(mint.publicKey, t.TOKEN_2022_PROGRAM_ID), t.createInitializeMint2Instruction(mint.publicKey, 0, creator.publicKey, creator.publicKey, t.TOKEN_2022_PROGRAM_ID), t.createAssociatedTokenAccountInstruction(payer.publicKey, source, owner.publicKey, mint.publicKey, t.TOKEN_2022_PROGRAM_ID), ...(withDestination ? [t.createAssociatedTokenAccountInstruction(payer.publicKey, destination, recipient.publicKey, mint.publicKey, t.TOKEN_2022_PROGRAM_ID)] : []), t.createMintToCheckedInstruction(mint.publicKey, source, creator.publicKey, 1, 0, [], t.TOKEN_2022_PROGRAM_ID), ...(destinationAmount ? [t.createMintToCheckedInstruction(mint.publicKey, destination, creator.publicKey, destinationAmount, 0, [], t.TOKEN_2022_PROGRAM_ID)] : []), t.createSetAuthorityInstruction(mint.publicKey, creator.publicKey, t.AuthorityType.MintTokens, auth, [], t.TOKEN_2022_PROGRAM_ID)], [mint, creator]); const bytes = Buffer.alloc(597); createHash('sha256').update('account:ItemConfig').digest().copy(bytes, 0, 0, 8); bytes[8] = bump; mint.publicKey.toBuffer().copy(bytes, 9); creator.publicKey.toBuffer().copy(bytes, 41); bytes.writeBigUInt64LE(0n, 73); bytes.writeUInt32LE(required.length, 81); required.forEach((k, i) => k.toBuffer().copy(bytes, 85 + i * 32)); surf.setAccount(config.toBase58(), 10e6, bytes, program.toBase58()); return { mint: mint.publicKey, source, destination, auth, config, required }; }
const migrate = f => sdk.migrateItemIx({ owner: owner.publicKey, recipient: recipient.publicKey, itemMint: f.mint, requiredSkills: f.required });
async function amounts(f) { const source = await t.getAccount(connection, f.source, 'confirmed', t.TOKEN_2022_PROGRAM_ID), destinationInfo = await connection.getAccountInfo(f.destination, 'confirmed'), destination = destinationInfo ? t.unpackAccount(f.destination, destinationInfo, t.TOKEN_2022_PROGRAM_ID) : { amount: 0n }, mint = await t.getMint(connection, f.mint, 'confirmed', t.TOKEN_2022_PROGRAM_ID); return [source.amount, destination.amount, mint.supply]; }
try {
    const f = await fixture('source');
    const before = await amounts(f);
    const originalConfig = (await connection.getAccountInfo(f.config)).data;
    await send('token holder cannot rotate publisher identity', [sdk.rotateCreatorIx({ creator: owner.publicKey, newCreator: recipient.publicKey, itemMint: f.mint })], [owner, recipient], true);
    assert((await connection.getAccountInfo(f.config)).data.equals(originalConfig));
    for (const [label, index, signers] of [['missing owner signature', 1, [creator, recipient]]]) {
        const ix = migrate(f);
        ix.keys[index].isSigner = false;
        await send(label, [ix], signers, true);
        assert.deepEqual(await amounts(f), before);
    }
    const noRecipient = migrate(f);
    noRecipient.keys[0].pubkey = payer.publicKey;
    noRecipient.keys[2].isSigner = false;
    await send('missing recipient consent', [noRecipient], [owner, creator], true);
    assert.deepEqual(await amounts(f), before);
    const wrongOwner = migrate(f);
    wrongOwner.keys[1].pubkey = rogue.publicKey;
    await send('wrong source owner cannot migrate the copy', [wrongOwner], [rogue, recipient], true);
    assert.deepEqual(await amounts(f), before);
    const same = sdk.migrateItemIx({ owner: owner.publicKey, recipient: owner.publicKey, itemMint: f.mint, requiredSkills: f.required });
    await send('same wallet rejected', [same], [owner, creator], true);
    assert.deepEqual(await amounts(f), before);
    const other = await fixture('other mint');
    const forged = migrate(f);
    forged.keys[6].pubkey = other.source;
    await send('wrong mint source rejected', [forged], [owner, recipient, creator], true);
    assert.deepEqual(await amounts(f), before);
    await send('freeze destination to test rollback', [t.createFreezeAccountInstruction(f.destination, f.mint, creator.publicKey, [], t.TOKEN_2022_PROGRAM_ID)], [creator]);
    await send('failed issuance rolls burn back', [migrate(f)], [owner, recipient, creator], true);
    assert.deepEqual(await amounts(f), before);
    await send('thaw destination', [t.createThawAccountInstruction(f.destination, f.mint, creator.publicKey, [], t.TOKEN_2022_PROGRAM_ID)], [creator]);
    const dependency = await fixture('workflow migration dependency', 0, [f.mint]);
    await send('workflow migration requires destination prerequisites', [migrate(dependency)], [owner, recipient, creator], true);
    assert.deepEqual(await amounts(dependency), [1n, 0n, 1n]);
    await send('self-service migration without publisher signature', [migrate(f)], [owner, recipient, creator]);
    assert.deepEqual(await amounts(f), [0n, 1n, 1n]);
    assert((await connection.getAccountInfo(f.config)).data.equals(originalConfig));
    await send('workflow migration succeeds after prerequisite migration', [migrate(dependency)], [owner, recipient, creator]);
    assert.deepEqual(await amounts(dependency), [0n, 1n, 1n]);
    await send('replay cannot mint another copy', [migrate(f)], [owner, recipient, creator], true);
    assert.deepEqual(await amounts(f), [0n, 1n, 1n]);
    const occupied = await fixture('occupied recipient', 1);
    await send('existing destination entitlement rejected', [migrate(occupied)], [owner, recipient, creator], true);
    assert.deepEqual(await amounts(occupied), [1n, 1n, 2n]);
    const wf = await fixture('workflow with migrated prerequisite', 0, [f.mint]);
    await send('new holder passes real on-chain prerequisite gate', [sdk.buyItemIx({ buyer: recipient.publicKey, creator: creator.publicKey, itemMint: wf.mint, requiredSkills: [f.mint] })], [recipient]);
    await send('old holder fails on-chain prerequisite after migration', [sdk.buyItemIx({ buyer: owner.publicKey, creator: creator.publicKey, itemMint: wf.mint, requiredSkills: [f.mint] })], [owner], true);
    const fresh = await fixture('new ATA creation', 0, [], false);
    assert.equal(await connection.getAccountInfo(fresh.destination), null);
    const recipientBefore = await connection.getBalance(recipient.publicKey);
    await send('migration creates and funds destination ATA', [migrate(fresh)], [owner, recipient, creator]);
    assert.deepEqual(await amounts(fresh), [0n, 1n, 1n]);
    assert.equal(recipientBefore - await connection.getBalance(recipient.publicKey), (await connection.getAccountInfo(fresh.destination)).lamports);
    const empty = await fixture('failed ATA initialization rollback', 0, [], false);
    await send('empty source fixture', [t.createBurnCheckedInstruction(empty.source, empty.mint, owner.publicKey, 1, 0, [], t.TOKEN_2022_PROGRAM_ID)], [owner]);
    const rentBefore = await connection.getBalance(recipient.publicKey);
    await send('failed migration rolls destination ATA rent back', [migrate(empty)], [owner, recipient, creator], true);
    assert.equal(await connection.getAccountInfo(empty.destination), null);
    assert.equal(await connection.getBalance(recipient.publicKey), rentBefore);
    const rotate = sdk.rotateCreatorIx({ creator: creator.publicKey, newCreator: nextCreator.publicKey, itemMint: other.mint });
    const missing = Object.assign(Object.create(Object.getPrototypeOf(rotate)), rotate, { keys: rotate.keys.map(k => ({ ...k })) });
    missing.keys[1].isSigner = false;
    await send('creator rotation needs destination acceptance', [missing], [creator], true);
    const configBefore = (await connection.getAccountInfo(other.config)).data;
    await send('both creators consent to payout rotation', [rotate], [creator, nextCreator]);
    const config = (await connection.getAccountInfo(other.config)).data;
    assert.equal(new PublicKey(config.subarray(41, 73)).toBase58(), nextCreator.publicKey.toBase58());
    assert.equal(config.readBigUInt64LE(73), 0n);
    assert(config.subarray(0, 41).equals(configBefore.subarray(0, 41)));
    assert(config.subarray(73).equals(configBefore.subarray(73)));
    await send('old creator cannot retake creator record', [sdk.rotateCreatorIx({ creator: creator.publicKey, newCreator: rogue.publicKey, itemMint: other.mint })], [creator, rogue], true);
    await writeFile(join(outputDir, 'migration-surfpool-proof.json'), JSON.stringify({ scope: 'Offline Surfpool; generated keys only; real Token-2022 mint/burn CPIs; program-owned ItemConfig fixtures injected to isolate migration, not a publish/deployment test', program: program.toBase58(), programSha256: createHash('sha256').update(await readFile(binary)).digest('hex'), sourceRevision: 'd3fd248f8599a0a3b11b7c2ee1662eae6a30be08 + local migration candidate', sdkSource: 'existing workflowGate.ts plus local builders', cases: receipts, finalMigrationBalances: { old: '0', new: '1', supply: '1' }, publisherApprovalRequired: false, proven: ['owner and recipient consent without issuer approval', 'destination ATA creation and payer rent', 'failed migration rolls ATA rent back', 'workflow migration preserves prerequisite gate', 'canonical ATA/mint constraints', 'failed mint rolls burn back', 'supply conserved', 'replay rejected', 'new prerequisite gate works', 'old prerequisite gate fails', 'two-party creator rotation'] }, null, 2) + '\n');
    console.log('Migration, rollback, gating and creator-rotation proofs passed');
}
finally {
    connection._rpcWebSocket.close();
    surf.stop();
}
