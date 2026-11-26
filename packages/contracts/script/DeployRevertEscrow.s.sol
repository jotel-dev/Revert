// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {RevertEscrow} from "../src/RevertEscrow.sol";

contract DeployRevertEscrow is Script {
    function run() external returns (RevertEscrow deployed) {
        bool shouldBroadcast = vm.envOr("BROADCAST", false);
        address usdc = vm.envOr(
            "SUPPORTED_USDC_ADDRESS",
            address(0xcc194e1a843B658526D0D5C431f670028582Ae17)
        );

        if (!shouldBroadcast) {
            address simulatedOwner = vm.envOr("OWNER_ADDRESS", address(0x1000));
            address[] memory simTokens = usdc.code.length > 0 ? _single(usdc) : new address[](0);
            vm.prank(simulatedOwner);
            deployed = new RevertEscrow(simulatedOwner, simTokens);
            console2.log("[DRY-RUN] Broadcast disabled. Set BROADCAST=true to broadcast.");
            console2.log("Simulated RevertEscrow:", address(deployed));
            console2.log("Simulated Owner:", simulatedOwner);
            if (simTokens.length == 0) {
                console2.log("[DRY-RUN] Target token has no code on non-fork EVM:", usdc);
            } else {
                console2.log("Allowed USDC:", usdc);
            }
            return deployed;
        }

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address owner = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);
        deployed = new RevertEscrow(owner, _single(usdc));
        vm.stopBroadcast();

        console2.log("RevertEscrow deployed at:", address(deployed));
        console2.log("Owner:", owner);
        console2.log("Allowed USDC:", usdc);
    }

    function _single(address token) private pure returns (address[] memory arr) {
        arr = new address[](1);
        arr[0] = token;
    }
}
