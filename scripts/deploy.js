const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying LEASH with account:", deployer.address);
  console.log(
    "Account balance:",
    hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)),
    "ETH"
  );

  const MockManager = await hre.ethers.getContractFactory("MockERC7710DelegationManager");
  const mockManager = await MockManager.deploy();
  await mockManager.waitForDeployment();
  const mockManagerAddress = await mockManager.getAddress();
  console.log("MockERC7710DelegationManager:", mockManagerAddress);

  // Single-validator threshold so a local / hackathon demo can finalize immediately.
  const verdictThreshold = 1;
  const LEASH = await hre.ethers.getContractFactory("LEASH");
  const leash = await LEASH.deploy(deployer.address, verdictThreshold);
  await leash.waitForDeployment();
  const leashAddress = await leash.getAddress();
  console.log("LEASH:", leashAddress);

  const addValidatorTx = await leash.addValidator(deployer.address);
  await addValidatorTx.wait();

  const setRelayerTx = await leash.setGenLayerRelayer(deployer.address);
  await setRelayerTx.wait();

  const deployedAddresses = {
    network: hre.network.name,
    chainId: Number((await hre.ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    LEASH: leashAddress,
    MockERC7710DelegationManager: mockManagerAddress,
    verdictThreshold,
    deployedAt: new Date().toISOString(),
  };

  const outputPath = path.join(__dirname, "..", "deployed_addresses.json");
  fs.writeFileSync(outputPath, JSON.stringify(deployedAddresses, null, 2) + "\n");
  console.log("Wrote deployed address file:", outputPath);

  console.log("Jury validator + GenLayer relayer:", deployer.address);
  console.log("Verdict threshold:", verdictThreshold);
  console.log("\nDeployment complete.");
  console.log(JSON.stringify(deployedAddresses, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
