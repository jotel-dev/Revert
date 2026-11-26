// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {RevertEscrow} from "../src/RevertEscrow.sol";

contract DeployRevertEscrow is Script {
    function run() external returns (RevertEscrow deployed) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address owner = vm.addr(deployerKey);
        address usdc = vm.envAddress("SUPPORTED_USDC_ADDRESS");

        address[] memory tokens = new address[](1);
        tokens[0] = usdc;

        vm.startBroadcast(deployerKey);
        deployed = new RevertEscrow(owner, tokens);
        vm.stopBroadcast();

        console2.log("RevertEscrow deployed at:", address(deployed));
        console2.log("Owner:", owner);
        console2.log("Allowed USDC:", usdc);
    }
}
