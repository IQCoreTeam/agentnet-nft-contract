# Local recovery integration tests

These scripts run the candidate SBF program in **offline Surfpool**, with fresh in-memory keys. They do not accept a public RPC URL or use a personal wallet. Both assert the selected RPC is loopback. Run them after building the contract and bundling the matching SDK candidate's `packages/core/src/nft/workflowGate.ts` as CommonJS.

## Dependencies and invocation

Use Node, Surfpool 1.6.1 (`@solana/surfpool`), and the normal Solana JS dependencies: `@solana/web3.js`, `@solana/spl-token`, `@solana/spl-token-group`, `@solana/spl-token-metadata`. Install them in a disposable test environment if the repository's dependencies do not supply them. No dependency changes are required for production.

```sh
cargo build-sbf --manifest-path programs/agent-workflow-nft/Cargo.toml -- --locked
# In the companion AgentNet checkout, bundle the matching candidate:
esbuild packages/core/src/nft/workflowGate.ts --bundle --platform=node --packages=external --format=cjs --outfile=/tmp/workflowGate.cjs
# From this contract checkout:
RECOVERY_SDK_MODULE=/tmp/workflowGate.cjs node tests/recovery/migration.mjs
RECOVERY_SDK_MODULE=/tmp/workflowGate.cjs node tests/recovery/lifecycle.mjs
```

Optional environment variables: `RECOVERY_TEST_PACKAGE_JSON` chooses dependency resolution from a disposable environment's package.json; `RECOVERY_SURFPOOL_MODULE` chooses an installed Surfpool ESM entry; `RECOVERY_PROGRAM_SO` chooses the built candidate binary; `RECOVERY_TEST_OUTPUT_DIR` chooses where JSON evidence is written. Otherwise output uses a fresh OS temporary directory and the binary is `target/deploy/agent_workflow_nft.so`.

## Coverage and fixture boundaries

`migration.mjs` injects ItemConfig fixtures to isolate missing signatures, wrong owners and mints, occupied destinations, same-wallet attempts, mint-failure rollback, replay, prerequisite checks, ATA rent rollback and creator rotation. Successful self-service migration requires no publisher signature. It also verifies the existing buy prerequisite path.

`lifecycle.mjs` injects only the two fixed-address collection genesis accounts needed to bootstrap an isolated network. It creates real Token-2022 mints and uses the program to publish skills and workflows, buy them with exact creator/protocol payments, migrate bought copies with unchanged supply and no resale-price charge, rotate creator identity, direct subsequent payments to the new creator, and migrate the publisher's own copy independently. It never injects ItemConfig records or item/token balances.

The tests use actual Token-2022 instructions/CPIs. They are local integration evidence, not mainnet deployment acceptance or an independent security audit. Integration into the project's normal CI and matching IDL generation remain review work before release. The older `tests/workflow-gate.ts` suite is separate and may use an external payer/network; these scripts do not invoke it.
